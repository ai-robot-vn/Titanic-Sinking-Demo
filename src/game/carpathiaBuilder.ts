import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ProceduralTextureSet } from './textures';

export interface CarpathiaRig {
  root: THREE.Group;
  boardingStationsLocal: Array<{ x: number; y: number; z: number; side: -1 | 1 }>;
  setRescueState: (
    time: number,
    boardedRatio: number,
    laddersDeployed: boolean,
    searchlightSweep: boolean,
  ) => void;
  dispose: () => void;
}

const _mat4 = new THREE.Matrix4();
const _vPos = new THREE.Vector3();
const _vScale = new THREE.Vector3();
const _qRot = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);

function sampleCarpathiaStation(z: number): {
  beam: number;
  sheerY: number;
  flare: number;
} {
  let beam = 9.8;
  let flare = 0.05;

  if (z < -26) {
    const t = THREE.MathUtils.clamp((z - -85) / 59, 0, 1);
    beam = 9.8 * Math.pow(Math.sin((t * Math.PI) / 2), 0.78);
    flare = 0.24 * (1 - t) + 0.04;
  } else if (z > 42) {
    const t = THREE.MathUtils.clamp((85 - z) / 43, 0, 1);
    beam = 9.8 * Math.pow(Math.sin((t * Math.PI) / 2), 0.68);
    flare = 0.14 * (1 - t) + 0.04;
  }

  let sheerY = 5.6;
  if (z < -48) {
    const t = THREE.MathUtils.clamp((-48 - z) / 37, 0, 1);
    sheerY = 7.4 + t * 0.8;
  } else if (z < -30) {
    sheerY = 5.4;
  } else if (z > 52) {
    const t = THREE.MathUtils.clamp((z - 52) / 33, 0, 1);
    sheerY = 6.4 + t * 0.75;
  }

  return { beam, sheerY, flare };
}

function buildLoftedHull(
  zSamples: number[],
  yLevels: number,
  yMinFrac: number,
  yMaxFrac: number,
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringPts = yLevels * 2 + 1;

  for (let zi = 0; zi < zSamples.length; zi++) {
    const z = zSamples[zi];
    const { beam, sheerY, flare } = sampleCarpathiaStation(z);
    const vCoord = (z + 85) / 170;

    const addVertex = (side: number, frac: number) => {
      const y = THREE.MathUtils.lerp(-5.2, sheerY, frac);
      let widthRatio: number;
      if (frac < 0.28) {
        widthRatio = Math.sin(((frac / 0.28) * Math.PI) / 2) * 0.88;
      } else {
        const up = (frac - 0.28) / 0.72;
        widthRatio = 0.88 + up * 0.12 + up * up * flare;
      }
      const bowRake = z <= -82 ? -(frac * 1.3) : 0;
      positions.push(side * beam * widthRatio, y, z + bowRake);
      uvs.push(vCoord * 6, frac);
    };

    for (let j = yLevels; j >= 1; j--) {
      addVertex(-1, THREE.MathUtils.lerp(yMinFrac, yMaxFrac, j / yLevels));
    }
    addVertex(0, yMinFrac);
    for (let j = 1; j <= yLevels; j++) {
      addVertex(1, THREE.MathUtils.lerp(yMinFrac, yMaxFrac, j / yLevels));
    }
  }

  for (let zi = 0; zi < zSamples.length - 1; zi++) {
    for (let ri = 0; ri < ringPts - 1; ri++) {
      const a = zi * ringPts + ri;
      const b = (zi + 1) * ringPts + ri;
      const c = (zi + 1) * ringPts + (ri + 1);
      const d = zi * ringPts + (ri + 1);
      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildCurvedHouse(
  halfWidth: number,
  zMin: number,
  zMax: number,
  height: number,
  curveLen = 0.65,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const yFront = -zMin;
  const yBack = -zMax;
  shape.moveTo(-halfWidth, yFront - curveLen);
  shape.quadraticCurveTo(-halfWidth, yFront, 0, yFront);
  shape.quadraticCurveTo(halfWidth, yFront, halfWidth, yFront - curveLen);
  shape.lineTo(halfWidth, yBack + curveLen);
  shape.quadraticCurveTo(halfWidth, yBack, 0, yBack);
  shape.quadraticCurveTo(-halfWidth, yBack, -halfWidth, yBack + curveLen);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 2,
    curveSegments: 12,
  });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function normalizeAndMerge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prep = parts.map((src) => {
    const g = src.index ? src.toNonIndexed() : src.clone();
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    return g;
  });
  const merged = mergeGeometries(prep, false);
  for (const g of prep) g.dispose();
  if (!merged) throw new Error('Failed to merge Carpathia survivor mesh');
  merged.computeBoundingSphere();
  return merged;
}

export function buildCarpathiaShip(
  textures: ProceduralTextureSet,
  isSoftwareGl: boolean,
): CarpathiaRig {
  const root = new THREE.Group();
  root.visible = false;

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  // Cunard Line Materials
  const steelHullMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.steelHullAlbedo,
      normalMap: textures.steelHullNormal,
      normalScale: new THREE.Vector2(1.0, 1.0),
      color: 0x161c24,
      roughness: 0.48,
      metalness: 0.48,
      side: THREE.DoubleSide,
    }),
  );
  const antiFoulMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x6b1b1e,
      roughness: 0.65,
      metalness: 0.14,
      side: THREE.DoubleSide,
    }),
  );
  const whiteMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0xedeae0, roughness: 0.6, metalness: 0.04 }),
  );
  const teakMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.teakDeckAlbedo,
      normalMap: textures.teakDeckNormal,
      roughness: 0.82,
      metalness: 0.02,
    }),
  );
  const cunardRedMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0xc23828, roughness: 0.52, metalness: 0.08 }),
  );
  const blackBandMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x12161d, roughness: 0.45, metalness: 0.6 }),
  );
  const mastBuffMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0xc79b5c, roughness: 0.58, metalness: 0.08 }),
  );
  const brassMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0xd9ad54, roughness: 0.22, metalness: 0.88 }),
  );
  const warmGlowMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffe4aa,
      emissive: 0xffaa42,
      emissiveIntensity: 1.9,
      roughness: 0.28,
    }),
  );
  const portRedMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xff4242,
      emissive: 0xef4444,
      emissiveIntensity: 2.3,
    }),
  );
  const stbdGreenMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x34d399,
      emissive: 0x10b981,
      emissiveIntensity: 2.3,
    }),
  );
  const stayMat = trackMat(new THREE.MeshBasicMaterial({ color: 0x4b5868 }));

  // =========================================================================
  // 1. LOFTED 170m CUNARD HULL, DECKS & SUPERSTRUCTURE
  // =========================================================================
  const zStations = [
    -85, -80, -72, -62, -50, -40, -30, -16, 0, 18, 36, 52, 66, 77, 85,
  ];
  const upperHull = new THREE.Mesh(trackGeo(buildLoftedHull(zStations, 7, 0.36, 1.0)), steelHullMat);
  upperHull.castShadow = !isSoftwareGl;
  upperHull.receiveShadow = true;
  root.add(upperHull);

  const lowerHull = new THREE.Mesh(trackGeo(buildLoftedHull(zStations, 4, 0.0, 0.39)), antiFoulMat);
  lowerHull.scale.set(0.996, 1, 0.998);
  root.add(lowerHull);

  // Bow gold "CARPATHIA" nameplates on port & starboard flare
  const carpNameMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.hullNameplateCarpathia,
      transparent: true,
      alphaTest: 0.08,
      roughness: 0.32,
      metalness: 0.65,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      side: THREE.DoubleSide,
    }),
  );
  const nameGeo = trackGeo(new THREE.PlaneGeometry(5.8, 1.45));
  const { beam: cb1 } = sampleCarpathiaStation(-73);
  const { beam: cb2 } = sampleCarpathiaStation(-67);
  const carpBowYaw = Math.atan2(cb2 - cb1, 6.0);
  for (const side of [-1, 1] as const) {
    const plate = new THREE.Mesh(nameGeo, carpNameMat);
    plate.position.set(side * ((cb1 + cb2) * 0.5 + 0.35), 6.2, -70.0);
    plate.rotation.y = (side > 0 ? Math.PI / 2 : -Math.PI / 2) + side * carpBowYaw;
    root.add(plate);
  }

  // Forecastle, Main Promenade & Poop Teak Decks
  const foreDeck = new THREE.Mesh(trackGeo(buildCurvedHouse(7.8, -82, -48, 0.22, 3.2)), teakMat);
  foreDeck.position.y = 7.3;
  root.add(foreDeck);

  const mainPromenade = new THREE.Mesh(trackGeo(buildCurvedHouse(9.5, -30, 52, 0.24, 1.4)), teakMat);
  mainPromenade.position.y = 5.6;
  root.add(mainPromenade);

  const poopDeck = new THREE.Mesh(trackGeo(buildCurvedHouse(7.6, 52, 84, 0.22, 2.2)), teakMat);
  poopDeck.position.y = 6.6;
  root.add(poopDeck);

  // Midships Superstructure (Bridge Deck & Boat Deck)
  const bHouse = new THREE.Mesh(trackGeo(buildCurvedHouse(8.9, -24, 44, 2.55, 1.0)), whiteMat);
  bHouse.position.y = 5.82;
  bHouse.castShadow = !isSoftwareGl;
  root.add(bHouse);

  const boatDeckFloor = new THREE.Mesh(trackGeo(buildCurvedHouse(9.35, -25, 45, 0.24, 1.0)), teakMat);
  boatDeckFloor.position.y = 8.35;
  root.add(boatDeckFloor);

  const aHouse = new THREE.Mesh(trackGeo(buildCurvedHouse(7.1, -21, 38, 2.4, 0.8)), whiteMat);
  aHouse.position.y = 8.58;
  root.add(aHouse);

  // Wheelhouse & Cantilevered Bridge Wings (z = -20)
  const bridgeHouse = new THREE.Mesh(trackGeo(buildCurvedHouse(4.2, -23.5, -18.5, 2.35, 0.5)), whiteMat);
  bridgeHouse.position.y = 10.95;
  root.add(bridgeHouse);

  const bridgeWingDeck = new THREE.Mesh(trackGeo(buildCurvedHouse(10.8, -23.2, -20.2, 0.26, 0.3)), teakMat);
  bridgeWingDeck.position.y = 10.85;
  root.add(bridgeWingDeck);

  const bridgeWindows = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(7.6, 0.72, 0.2)), warmGlowMat);
  bridgeWindows.position.set(0, 12.25, -23.5);
  root.add(bridgeWindows);

  for (const side of [-1, 1] as const) {
    const nav = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.24, 10, 10)),
      side < 0 ? portRedMat : stbdGreenMat,
    );
    nav.position.set(side * 10.7, 12.0, -22.2);
    root.add(nav);
  }

  // =========================================================================
  // 2. SINGLE TOWERING CUNARD RED-AND-BLACK FUNNEL + 4 SCHOONER MASTS
  // =========================================================================
  const funnelGroup = new THREE.Group();
  funnelGroup.position.set(0, 10.95, 6.0);
  funnelGroup.rotation.x = 0.075;
  funnelGroup.scale.set(0.86, 1, 1.15);

  const funnelShaft = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(2.15, 2.48, 12.5, 28)), cunardRedMat);
  funnelShaft.position.y = 6.25;
  funnelShaft.castShadow = !isSoftwareGl;
  funnelGroup.add(funnelShaft);

  const topBlackBand = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(2.2, 2.15, 3.0, 28)), blackBandMat);
  topBlackBand.position.y = 13.8;
  funnelGroup.add(topBlackBand);

  for (const by of [8.2, 10.4]) {
    const thinBand = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(2.3, 2.32, 0.36, 28)), blackBandMat);
    thinBand.position.y = by;
    funnelGroup.add(thinBand);
  }

  const whistlePipe = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.12, 0.14, 14.0, 8)), brassMat);
  whistlePipe.position.set(0, 7.2, -2.38);
  funnelGroup.add(whistlePipe);
  root.add(funnelGroup);

  // 4 Tall Cunard Schooner Masts (z = -46, -15, 28, 60) + Steaming Lights + Aerials
  const mastZList = [-46.0, -15.0, 28.0, 60.0];
  const mastGeo = trackGeo(new THREE.CylinderGeometry(0.14, 0.3, 31.0, 12));
  const lanternGeo = trackGeo(new THREE.SphereGeometry(0.24, 10, 10));
  for (let m = 0; m < mastZList.length; m++) {
    const mz = mastZList[m];
    const mast = new THREE.Mesh(mastGeo, mastBuffMat);
    mast.position.set(0, 21.0, mz);
    mast.rotation.x = 0.05;
    root.add(mast);

    if (m === 0 || m === 2) {
      const yard = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.06, 0.09, 9.6, 8)), mastBuffMat);
      yard.rotation.z = Math.PI / 2;
      yard.position.set(0, 27.5, mz);
      root.add(yard);

      const mastLamp = new THREE.Mesh(lanternGeo, warmGlowMat);
      mastLamp.position.set(0, 25.0, mz - 0.3);
      root.add(mastLamp);
    }

    for (const sx of [-7.5, 7.5]) {
      const stay = new THREE.Mesh(
        trackGeo(new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(0, 31, mz), new THREE.Vector3(sx, 6.5, mz + 3)), 3, 0.03, 5, false)),
        stayMat,
      );
      root.add(stay);
    }
  }
  for (const ax of [-0.6, 0.6]) {
    const aerial = new THREE.Mesh(
      trackGeo(new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(ax, 36.2, -46), new THREE.Vector3(ax, 35.8, 60)), 3, 0.024, 5, false)),
      stayMat,
    );
    root.add(aerial);
  }

  // Stern Red Ensign Flag
  const ensignStaff = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.04, 0.07, 5.2, 8)), whiteMat);
  ensignStaff.position.set(0, 9.5, 83.8);
  ensignStaff.rotation.x = 0.18;
  root.add(ensignStaff);
  const ensignFlag = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(2.8, 1.4)),
    trackMat(
      new THREE.MeshStandardMaterial({
        map: textures.redEnsignFlag,
        roughness: 0.72,
        side: THREE.DoubleSide,
      }),
    ),
  );
  ensignFlag.position.set(0.05, 11.2, 85.4);
  ensignFlag.rotation.y = Math.PI / 2 + 0.1;
  root.add(ensignFlag);

  // =========================================================================
  // 3. WARM PORTHOLES, RESCUE FLOODLIGHTS & 4 BOARDING GANGWAY LADDERS
  // =========================================================================
  const portholeGeo = trackGeo(new THREE.CircleGeometry(0.24, 10));
  const phCoords: Array<{ x: number; y: number; z: number; ry: number; sx: number }> = [];
  for (const side of [-1, 1]) {
    for (let z = -66; z <= 74; z += 4.5) {
      const { beam, sheerY } = sampleCarpathiaStation(z);
      phCoords.push({
        x: side * (beam * 0.99 + 0.08),
        y: sheerY - 1.5,
        z,
        ry: side > 0 ? Math.PI / 2 : -Math.PI / 2,
        sx: 1,
      });
    }
    for (let z = -22; z <= 40; z += 3.2) {
      phCoords.push({
        x: side * 9.0,
        y: 7.15,
        z,
        ry: side > 0 ? Math.PI / 2 : -Math.PI / 2,
        sx: 1.7,
      });
      phCoords.push({
        x: side * 7.2,
        y: 9.85,
        z,
        ry: side > 0 ? Math.PI / 2 : -Math.PI / 2,
        sx: 1.7,
      });
    }
  }
  const phInst = new THREE.InstancedMesh(portholeGeo, warmGlowMat, phCoords.length);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < phCoords.length; i++) {
    const p = phCoords[i];
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.ry, 0);
    dummy.scale.set(p.sx, 1, 1);
    dummy.updateMatrix();
    phInst.setMatrixAt(i, dummy.matrix);
  }
  phInst.instanceMatrix.needsUpdate = true;
  root.add(phInst);

  // Deck Illumination + Rescue Searchlight Sweeping Waves
  const deckGlowLight = new THREE.PointLight(0xffbe73, 12.0, 120, 1.25);
  deckGlowLight.position.set(0, 14.5, 6);
  root.add(deckGlowLight);

  const rescueTarget = new THREE.Object3D();
  rescueTarget.position.set(-45, 0, 10);
  root.add(rescueTarget);

  const rescueSpot = new THREE.SpotLight(0xedf7ff, 120, 260, Math.PI / 8, 0.55, 1.1);
  rescueSpot.position.set(-4.5, 13.5, -21.0);
  rescueSpot.target = rescueTarget;
  root.add(rescueSpot);

  // 4 Illuminated Side Boarding Jacob's Ladders / Gangways (2 Port, 2 Starboard)
  const boardingStationsLocal: Array<{ x: number; y: number; z: number; side: -1 | 1 }> = [
    { x: -10.8, y: 0.4, z: -8.0, side: -1 },
    { x: -10.8, y: 0.4, z: 22.0, side: -1 },
    { x: 10.8, y: 0.4, z: -8.0, side: 1 },
    { x: 10.8, y: 0.4, z: 22.0, side: 1 },
  ];
  const laddersGroup = new THREE.Group();
  laddersGroup.visible = false;
  const ropeRailGeo = trackGeo(new THREE.CylinderGeometry(0.035, 0.035, 6.2, 6));
  const rungGeo = trackGeo(new THREE.BoxGeometry(0.18, 0.06, 0.95));
  const stageGeo = trackGeo(new THREE.BoxGeometry(1.1, 0.14, 1.6));

  for (const st of boardingStationsLocal) {
    const g = new THREE.Group();
    g.position.set(st.side * 9.85, 3.2, st.z);

    for (const rz of [-0.42, 0.42]) {
      const rope = new THREE.Mesh(ropeRailGeo, stayMat);
      rope.position.set(st.side * 0.15, 0, rz);
      g.add(rope);
    }
    for (let r = 0; r < 11; r++) {
      const rung = new THREE.Mesh(rungGeo, teakMat);
      rung.position.set(st.side * 0.15, -2.5 + r * 0.52, 0);
      g.add(rung);
    }
    const stage = new THREE.Mesh(stageGeo, teakMat);
    stage.position.set(st.side * 0.45, -2.4, 0);
    g.add(stage);

    const lamp = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.18, 8, 8)), warmGlowMat);
    lamp.position.set(st.side * 0.45, -1.65, 0.65);
    g.add(lamp);

    laddersGroup.add(g);
  }
  root.add(laddersGroup);

  // =========================================================================
  // 4. CARPATHIA CREW + 160 RESCUED TITANIC SURVIVORS IN LIFEJACKETS (InstancedMesh)
  // =========================================================================
  const personTorso = trackGeo(new THREE.CylinderGeometry(0.16, 0.14, 0.68, 8));
  personTorso.translate(0, 1.08, 0);
  const personLegs = trackGeo(new THREE.CylinderGeometry(0.12, 0.1, 0.78, 8));
  personLegs.translate(0, 0.39, 0);
  const personHead = trackGeo(new THREE.SphereGeometry(0.11, 8, 8));
  personHead.translate(0, 1.54, 0);
  const corkVest = trackGeo(new THREE.CylinderGeometry(0.2, 0.19, 0.38, 10));
  corkVest.translate(0, 1.15, 0);

  const bodyGeo = trackGeo(normalizeAndMerge([personLegs, personTorso]));
  const headGeo = trackGeo(normalizeAndMerge([personHead]));
  const vestGeo = trackGeo(normalizeAndMerge([corkVest]));

  const bodyMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 }));
  const headMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xe6bca0, roughness: 0.68 }));
  const vestMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xefe3c8, roughness: 0.85 }));

  const MAX_SURVIVOR_FIGURES = 160;
  const survivorSpots: Array<{
    x: number;
    y: number;
    z: number;
    ry: number;
    phase: number;
    onLadder?: number;
  }> = [];

  for (let i = 0; i < MAX_SURVIVOR_FIGURES; i++) {
    const isClimbing = i % 10 === 0;
    const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
    if (isClimbing) {
      const st = boardingStationsLocal[i % boardingStationsLocal.length];
      survivorSpots.push({
        x: st.side * 10.15,
        y: 1.2 + ((i * 7) % 5) * 0.9,
        z: st.z + ((i % 3) - 1) * 0.25,
        ry: st.side > 0 ? Math.PI / 2 : -Math.PI / 2,
        phase: i * 0.9,
        onLadder: i % boardingStationsLocal.length,
      });
    } else if (i % 3 === 0) {
      // Boat Deck lining railings
      survivorSpots.push({
        x: side * (7.6 + ((i * 13) % 14) * 0.1),
        y: 8.6,
        z: -22 + ((i * 19) % 62),
        ry: side > 0 ? -Math.PI / 2 : Math.PI / 2,
        phase: i * 1.3,
      });
    } else {
      // Main Promenade & Forecastle/Well deck
      survivorSpots.push({
        x: side * (7.2 + ((i * 11) % 18) * 0.1),
        y: 5.84,
        z: -28 + ((i * 23) % 74),
        ry: side > 0 ? -Math.PI / 2 : Math.PI / 2,
        phase: i * 1.1,
      });
    }
  }

  const survBodyInst = new THREE.InstancedMesh(bodyGeo, bodyMat, MAX_SURVIVOR_FIGURES);
  const survHeadInst = new THREE.InstancedMesh(headGeo, headMat, MAX_SURVIVOR_FIGURES);
  const survVestInst = new THREE.InstancedMesh(vestGeo, vestMat, MAX_SURVIVOR_FIGURES);
  survBodyInst.frustumCulled = false;
  survHeadInst.frustumCulled = false;
  survVestInst.frustumCulled = false;

  const coatColors = [0x1c2430, 0x3a2a22, 0x5c232d, 0x243e4d, 0x4b3d57, 0x26443b, 0x8c7355];
  const tmpCol = new THREE.Color();
  for (let i = 0; i < MAX_SURVIVOR_FIGURES; i++) {
    tmpCol.setHex(coatColors[i % coatColors.length]);
    survBodyInst.setColorAt(i, tmpCol);
    survBodyInst.setMatrixAt(i, _zeroMat);
    survHeadInst.setMatrixAt(i, _zeroMat);
    survVestInst.setMatrixAt(i, _zeroMat);
  }
  if (survBodyInst.instanceColor) survBodyInst.instanceColor.needsUpdate = true;
  survBodyInst.instanceMatrix.needsUpdate = true;
  survHeadInst.instanceMatrix.needsUpdate = true;
  survVestInst.instanceMatrix.needsUpdate = true;

  root.add(survBodyInst);
  root.add(survHeadInst);
  root.add(survVestInst);

  // Carpathia's own 18 visible deck crewmen always standing on bridge wings, bow & gangways
  const crewCount = 18;
  const crewBodyInst = new THREE.InstancedMesh(bodyGeo, bodyMat, crewCount);
  const crewHeadInst = new THREE.InstancedMesh(headGeo, headMat, crewCount);
  crewBodyInst.frustumCulled = false;
  crewHeadInst.frustumCulled = false;
  tmpCol.setHex(0x131d2f);
  for (let i = 0; i < crewCount; i++) {
    crewBodyInst.setColorAt(i, tmpCol);
  }
  if (crewBodyInst.instanceColor) crewBodyInst.instanceColor.needsUpdate = true;

  const crewSpots: Array<[number, number, number, number]> = [
    [-8.8, 11.1, -21.5, -Math.PI / 2],
    [8.8, 11.1, -21.5, Math.PI / 2],
    [-1.4, 11.1, -22.2, 0],
    [1.4, 11.1, -22.2, 0],
    [-2.5, 7.52, -62.0, 0.2],
    [2.5, 7.52, -62.0, -0.2],
    [-9.2, 5.84, -8.5, -Math.PI / 2],
    [-9.2, 5.84, -7.2, -Math.PI / 2],
    [-9.2, 5.84, 21.5, -Math.PI / 2],
    [-9.2, 5.84, 22.8, -Math.PI / 2],
    [9.2, 5.84, -8.5, Math.PI / 2],
    [9.2, 5.84, -7.2, Math.PI / 2],
    [9.2, 5.84, 21.5, Math.PI / 2],
    [9.2, 5.84, 22.8, Math.PI / 2],
    [-8.6, 8.6, -4.0, -Math.PI / 2],
    [-8.6, 8.6, 20.0, -Math.PI / 2],
    [8.6, 8.6, -4.0, Math.PI / 2],
    [8.6, 8.6, 20.0, Math.PI / 2],
  ];
  for (let i = 0; i < crewSpots.length; i++) {
    const [cx, cy, cz, ry] = crewSpots[i];
    _euler.set(0, ry, 0);
    _qRot.setFromEuler(_euler);
    _mat4.compose(_vPos.set(cx, cy, cz), _qRot, _vScale.set(1, 1, 1));
    crewBodyInst.setMatrixAt(i, _mat4);
    crewHeadInst.setMatrixAt(i, _mat4);
  }
  crewBodyInst.instanceMatrix.needsUpdate = true;
  crewHeadInst.instanceMatrix.needsUpdate = true;
  root.add(crewBodyInst);
  root.add(crewHeadInst);

  const setRescueState = (
    time: number,
    boardedRatio: number,
    laddersDeployed: boolean,
    searchlightSweep: boolean,
  ) => {
    laddersGroup.visible = laddersDeployed;

    if (searchlightSweep) {
      const sweepZ = 10 + Math.sin(time * 0.75) * 42;
      rescueTarget.position.set(-55, 0.5, sweepZ);
      rescueSpot.intensity = 160;
    } else {
      rescueTarget.position.set(-22, 0.5, 6);
      rescueSpot.intensity = 95;
    }

    const visibleCount = Math.round(
      THREE.MathUtils.clamp(boardedRatio, 0, 1) * MAX_SURVIVOR_FIGURES,
    );
    for (let i = 0; i < MAX_SURVIVOR_FIGURES; i++) {
      if (i >= visibleCount) {
        survBodyInst.setMatrixAt(i, _zeroMat);
        survHeadInst.setMatrixAt(i, _zeroMat);
        survVestInst.setMatrixAt(i, _zeroMat);
      } else {
        const sp = survivorSpots[i];
        const swayY = Math.sin(time * 1.4 + sp.phase) * 0.015;
        let climbOffset = 0;
        if (sp.onLadder !== undefined && laddersDeployed) {
          climbOffset = ((time * 0.55 + sp.phase) % 1) * 2.2;
        }
        _euler.set(0, sp.ry + Math.sin(time * 0.8 + sp.phase) * 0.15, 0);
        _qRot.setFromEuler(_euler);
        _mat4.compose(
          _vPos.set(sp.x, sp.y + swayY + climbOffset, sp.z),
          _qRot,
          _vScale.set(1, 1, 1),
        );
        survBodyInst.setMatrixAt(i, _mat4);
        survHeadInst.setMatrixAt(i, _mat4);
        survVestInst.setMatrixAt(i, _mat4);
      }
    }
    survBodyInst.instanceMatrix.needsUpdate = true;
    survHeadInst.instanceMatrix.needsUpdate = true;
    survVestInst.instanceMatrix.needsUpdate = true;
  };

  return {
    root,
    boardingStationsLocal,
    setRescueState,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
