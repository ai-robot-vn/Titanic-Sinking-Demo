import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ProceduralTextureSet } from './textures';

export const WARSHIP_BREAK_Z = 10.5;

export interface WarshipRescueOptions {
  laddersDeployed: boolean;
  boardedRatio: number;
  combatAim?: {
    targetLocalX: number;
    targetLocalZ: number;
    firingFlash: number;
  };
}

export interface WarshipRig {
  root: THREE.Group;
  hullMeshGroup: THREE.Group;
  bowGroup: THREE.Group;
  sternGroup: THREE.Group;
  boardingStationsLocal: Array<{ x: number; y: number; z: number; side: -1 | 1 }>;
  setNavalState: (
    time: number,
    speedKnots: number,
    nightMix: number,
    searchlightSweep: boolean,
    sweepTargetLocalX?: number,
    sweepTargetLocalZ?: number,
    rescueOptions?: WarshipRescueOptions,
  ) => void;
  setBreakupVisual: (broken: boolean, emberPower?: number) => void;
  reset: () => void;
  dispose: () => void;
}

const _mat4 = new THREE.Matrix4();
const _vPos = new THREE.Vector3();
const _vScale = new THREE.Vector3(1, 1, 1);
const _qRot = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);

// 146 m Royal Navy Dreadnought / Armored Cruiser Escort (z = -73 bow .. +73 stern, max half-beam = 11.6 m)
function sampleWarshipStation(z: number): {
  beam: number;
  sheerY: number;
  flare: number;
} {
  let beam = 11.6;
  let flare = 0.04;

  if (z < -22) {
    const t = THREE.MathUtils.clamp((z - -73) / 51, 0, 1);
    beam = 11.6 * Math.pow(Math.sin((t * Math.PI) / 2), 0.72);
    flare = 0.22 * (1 - t) + 0.04;
  } else if (z > 32) {
    const t = THREE.MathUtils.clamp((73 - z) / 41, 0, 1);
    beam = 11.6 * Math.pow(Math.sin((t * Math.PI) / 2), 0.65);
    flare = 0.12 * (1 - t) + 0.03;
  }

  let sheerY = 5.1;
  if (z <= -18.1) {
    const t = THREE.MathUtils.clamp((-18.1 - z) / 54.9, 0, 1);
    sheerY = 6.9 + t * 1.25;
  } else if (z > 48) {
    const t = THREE.MathUtils.clamp((z - 48) / 25, 0, 1);
    sheerY = 5.1 + t * 0.45;
  }

  return { beam, sheerY, flare };
}

function buildWarshipHull(
  zSamples: number[],
  yLevels: number,
  yMinFrac: number,
  yMaxFrac: number,
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const includeKeel = yMinFrac <= 0.001;

  const evalVertex = (
    z: number,
    side: number,
    frac: number,
  ): [number, number, number, number, number] => {
    const { beam, sheerY, flare } = sampleWarshipStation(z);
    const vCoord = (z + 73) / 146;
    const y = THREE.MathUtils.lerp(-5.0, sheerY, frac);
    let widthRatio: number;
    if (frac < 0.26) {
      widthRatio = Math.sin(((frac / 0.26) * Math.PI) / 2) * 0.9;
    } else {
      const up = (frac - 0.26) / 0.74;
      widthRatio = 0.9 + up * 0.1 + up * up * flare;
    }
    const bowProjection =
      z <= -70 ? (frac < 0.35 ? -1.45 * (1 - frac / 0.35) : -(frac - 0.35) * 0.75) : 0;
    return [side * beam * widthRatio, y, z + bowProjection, vCoord * 5.5, frac];
  };

  if (includeKeel) {
    const ringPts = yLevels * 2 + 1;
    for (let zi = 0; zi < zSamples.length; zi++) {
      const z = zSamples[zi];
      for (let j = yLevels; j >= 1; j--) {
        const frac = THREE.MathUtils.lerp(yMinFrac, yMaxFrac, j / yLevels);
        const [x, y, zz, u, v] = evalVertex(z, -1, frac);
        positions.push(x, y, zz);
        uvs.push(u, v);
      }
      const [kx, ky, kz, ku, kv] = evalVertex(z, 0, yMinFrac);
      positions.push(kx, ky, kz);
      uvs.push(ku, kv);
      for (let j = 1; j <= yLevels; j++) {
        const frac = THREE.MathUtils.lerp(yMinFrac, yMaxFrac, j / yLevels);
        const [x, y, zz, u, v] = evalVertex(z, 1, frac);
        positions.push(x, y, zz);
        uvs.push(u, v);
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
  } else {
    const sidePts = yLevels + 1;
    for (const side of [-1, 1] as const) {
      const baseVertex = positions.length / 3;
      for (let zi = 0; zi < zSamples.length; zi++) {
        const z = zSamples[zi];
        for (let j = 0; j <= yLevels; j++) {
          const frac = THREE.MathUtils.lerp(yMinFrac, yMaxFrac, j / yLevels);
          const [x, y, zz, u, v] = evalVertex(z, side, frac);
          positions.push(x, y, zz);
          uvs.push(u, v);
        }
      }
      for (let zi = 0; zi < zSamples.length - 1; zi++) {
        for (let ri = 0; ri < sidePts - 1; ri++) {
          const a = baseVertex + zi * sidePts + ri;
          const b = baseVertex + (zi + 1) * sidePts + ri;
          const c = baseVertex + (zi + 1) * sidePts + (ri + 1);
          const d = baseVertex + zi * sidePts + (ri + 1);
          if (side > 0) {
            indices.push(a, b, d);
            indices.push(b, c, d);
          } else {
            indices.push(a, d, b);
            indices.push(b, d, c);
          }
        }
      }
    }
  }

  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildWarshipWeatherDeck(
  zSamples: number[],
  yTopOffset = 0.05,
  thickness = 0.38,
  edgeExpand = -0.02,
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringPts = 5;

  for (let zi = 0; zi < zSamples.length; zi++) {
    const z = zSamples[zi];
    const { beam, sheerY, flare } = sampleWarshipStation(z);
    const halfW = Math.max(0.05, beam * (1 + flare) + edgeExpand);
    const bowRake = z <= -70 ? -0.45 : 0;
    const zz = z + bowRake;
    const yTop = sheerY + yTopOffset;
    const yBot = yTop - thickness;
    const vCoord = (z + 73) / 146;

    positions.push(-halfW, yBot, zz);
    uvs.push(0, vCoord * 8);
    positions.push(-halfW, yTop, zz);
    uvs.push(0.15, vCoord * 8);
    positions.push(0, yTop + 0.06, zz);
    uvs.push(0.5, vCoord * 8);
    positions.push(halfW, yTop, zz);
    uvs.push(0.85, vCoord * 8);
    positions.push(halfW, yBot, zz);
    uvs.push(1.0, vCoord * 8);
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

  const addCap = (zi: number, flip: boolean) => {
    const base = zi * ringPts;
    if (flip) {
      indices.push(base + 0, base + 1, base + 2);
      indices.push(base + 0, base + 2, base + 3);
      indices.push(base + 0, base + 3, base + 4);
    } else {
      indices.push(base + 0, base + 2, base + 1);
      indices.push(base + 0, base + 3, base + 2);
      indices.push(base + 0, base + 4, base + 3);
    }
  };
  addCap(0, false);
  addCap(zSamples.length - 1, true);

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
  curveLenFore = 0.55,
  curveLenAft = curveLenFore,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const yFront = -zMin;
  const yBack = -zMax;
  if (curveLenFore > 0.01) {
    shape.moveTo(-halfWidth, yFront - curveLenFore);
    shape.quadraticCurveTo(-halfWidth, yFront, 0, yFront);
    shape.quadraticCurveTo(halfWidth, yFront, halfWidth, yFront - curveLenFore);
  } else {
    shape.moveTo(-halfWidth, yFront);
    shape.lineTo(halfWidth, yFront);
  }
  if (curveLenAft > 0.01) {
    shape.lineTo(halfWidth, yBack + curveLenAft);
    shape.quadraticCurveTo(halfWidth, yBack, 0, yBack);
    shape.quadraticCurveTo(-halfWidth, yBack, -halfWidth, yBack + curveLenAft);
  } else {
    shape.lineTo(halfWidth, yBack);
    shape.lineTo(-halfWidth, yBack);
  }
  shape.closePath();

  const isSplitFace = curveLenFore <= 0.01 || curveLenAft <= 0.01;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: !isSplitFace,
    bevelThickness: isSplitFace ? 0 : 0.05,
    bevelSize: isSplitFace ? 0 : 0.05,
    bevelSegments: isSplitFace ? 1 : 2,
    curveSegments: 10,
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
  if (!merged) throw new Error('Failed to merge warship crew mesh');
  merged.computeBoundingSphere();
  return merged;
}

export function buildWarshipShip(
  textures: ProceduralTextureSet,
  isSoftwareGl: boolean,
): WarshipRig {
  const root = new THREE.Group();
  const hullMeshGroup = new THREE.Group();
  root.add(hullMeshGroup);

  const bowGroup = new THREE.Group();
  bowGroup.position.set(0, 0, WARSHIP_BREAK_Z);
  hullMeshGroup.add(bowGroup);
  const bowContent = new THREE.Group();
  bowContent.position.set(0, 0, -WARSHIP_BREAK_Z);
  bowGroup.add(bowContent);

  const sternGroup = new THREE.Group();
  sternGroup.position.set(0, 0, WARSHIP_BREAK_Z);
  hullMeshGroup.add(sternGroup);
  const sternContent = new THREE.Group();
  sternContent.position.set(0, 0, -WARSHIP_BREAK_Z);
  sternGroup.add(sternContent);

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

  // Royal Navy Admiralty Dreadnought / Armored Cruiser Materials
  const navalGreyMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.steelHullAlbedo,
      normalMap: textures.steelHullNormal,
      normalScale: new THREE.Vector2(0.9, 0.9),
      color: 0x6c7782,
      roughness: 0.56,
      metalness: 0.42,
      side: THREE.DoubleSide,
    }),
  );
  const armorDarkGreyMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x454e57,
      roughness: 0.44,
      metalness: 0.62,
    }),
  );
  const antiFoulMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x621c1c,
      roughness: 0.68,
      metalness: 0.14,
      side: THREE.DoubleSide,
    }),
  );
  const funnelBlackMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x15191f,
      roughness: 0.42,
      metalness: 0.65,
    }),
  );
  const gunmetalMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x2a313a,
      roughness: 0.3,
      metalness: 0.8,
    }),
  );
  const teakMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.teakDeckAlbedo,
      normalMap: textures.teakDeckNormal,
      roughness: 0.84,
      metalness: 0.02,
    }),
  );
  const creamBoatMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xe6e0d2,
      roughness: 0.58,
      metalness: 0.05,
    }),
  );
  const mastBuffMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x8e9296,
      roughness: 0.5,
      metalness: 0.45,
    }),
  );
  const brassMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xd8aa4c,
      roughness: 0.22,
      metalness: 0.88,
    }),
  );
  const warmGlowMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffe4aa,
      emissive: 0xffaa42,
      emissiveIntensity: 1.5,
      roughness: 0.28,
    }),
  );
  const portRedMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xff4242,
      emissive: 0xef4444,
      emissiveIntensity: 2.2,
    }),
  );
  const stbdGreenMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x34d399,
      emissive: 0x10b981,
      emissiveIntensity: 2.2,
    }),
  );
  const stayMat = trackMat(new THREE.MeshBasicMaterial({ color: 0x45505e }));
  const tornSteelMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x2a313a,
      roughness: 0.72,
      metalness: 0.65,
      side: THREE.DoubleSide,
    }),
  );
  const tornRustMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x52281c,
      roughness: 0.85,
      metalness: 0.35,
      side: THREE.DoubleSide,
    }),
  );
  const breakEmberMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xff9f45,
      emissive: 0xff5a1f,
      emissiveIntensity: 0,
      roughness: 0.4,
      side: THREE.DoubleSide,
    }),
  );

  // =========================================================================
  // 1. LOFTED 146 m ADMIRALTY GREY HULL (SPLIT AT WARSHIP_BREAK_Z) & DECKS
  // =========================================================================
  const fwdZ = [-73, -68, -60, -50, -38, -28, -18.2, -18.0, -8, 4, WARSHIP_BREAK_Z];
  const aftZ = [WARSHIP_BREAK_Z, 18, 32, 46, 58, 67, 73];
  for (const [stations, targetGrp] of [
    [fwdZ, bowContent],
    [aftZ, sternContent],
  ] as const) {
    const upperHull = new THREE.Mesh(trackGeo(buildWarshipHull(stations, 7, 0.37, 1.0)), navalGreyMat);
    upperHull.castShadow = !isSoftwareGl;
    upperHull.receiveShadow = true;
    targetGrp.add(upperHull);

    const lowerHull = new THREE.Mesh(trackGeo(buildWarshipHull(stations, 4, 0.0, 0.38)), antiFoulMat);
    lowerHull.scale.set(0.999, 1, 0.9995);
    targetGrp.add(lowerHull);
  }

  const forecastleDeck = new THREE.Mesh(
    trackGeo(buildWarshipWeatherDeck([-73, -68, -60, -50, -38, -28, -18.0], 0.05, 0.4, -0.02)),
    teakMat,
  );
  bowContent.add(forecastleDeck);

  const quarterDeckBow = new THREE.Mesh(
    trackGeo(buildWarshipWeatherDeck([-18.0, -8, 4, WARSHIP_BREAK_Z], 0.05, 0.4, -0.02)),
    teakMat,
  );
  bowContent.add(quarterDeckBow);

  const quarterDeckStern = new THREE.Mesh(
    trackGeo(buildWarshipWeatherDeck([WARSHIP_BREAK_Z, 18, 32, 46, 58, 67, 73], 0.05, 0.4, -0.02)),
    teakMat,
  );
  sternContent.add(quarterDeckStern);

  const breakBulkhead = new THREE.Mesh(trackGeo(buildCurvedHouse(11.3, -18.5, -17.6, 2.0, 0.18)), navalGreyMat);
  breakBulkhead.position.y = 4.95;
  bowContent.add(breakBulkhead);

  // Hull-conforming Perimeter Deck Railings
  const addRailSeg = (
    targetGrp: THREE.Group,
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
  ) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dy, dz);
    for (const off of [0.36, 0.68, 0.96]) {
      const bar = new THREE.Mesh(
        trackGeo(new THREE.CylinderGeometry(0.032, 0.032, len, 6)),
        off > 0.9 ? mastBuffMat : stayMat,
      );
      bar.position.set((x1 + x2) * 0.5, (y1 + y2) * 0.5 + off, (z1 + z2) * 0.5);
      bar.rotation.x = Math.PI / 2;
      bar.rotation.z = -Math.atan2(dx, dz);
      targetGrp.add(bar);
    }
  };
  const addHullRail = (targetGrp: THREE.Group, zList: number[]) => {
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < zList.length; i++) {
        const z = zList[i];
        const { beam, sheerY, flare } = sampleWarshipStation(z);
        const rx = side * Math.max(0, beam * (1 + flare) - 0.18);
        const ry = sheerY + 0.05;
        const post = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.04, 0.04, 0.98, 6)), armorDarkGreyMat);
        post.position.set(rx, ry + 0.49, z <= -70 ? z - 0.45 : z);
        targetGrp.add(post);
        if (i < zList.length - 1) {
          const nz = zList[i + 1];
          const nxSt = sampleWarshipStation(nz);
          const nrx = side * Math.max(0, nxSt.beam * (1 + nxSt.flare) - 0.18);
          addRailSeg(
            targetGrp,
            rx,
            ry,
            z <= -70 ? z - 0.45 : z,
            nrx,
            nxSt.sheerY + 0.05,
            nz <= -70 ? nz - 0.45 : nz,
          );
        }
      }
    }
  };
  addHullRail(bowContent, [-72.5, -62, -50, -36, -24, -18.3]);
  addHullRail(bowContent, [-17.6, -6, 8, WARSHIP_BREAK_Z]);
  addHullRail(sternContent, [WARSHIP_BREAK_Z, 22, 36, 50, 62, 72.2]);

  // Bower Anchors & Forecastle Anchor Capstans
  for (const side of [-1, 1] as const) {
    const anchor = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.45, 1.85, 1.2)), gunmetalMat);
    anchor.position.set(side * 4.5, 6.2, -62.5);
    anchor.rotation.z = side * 0.25;
    bowContent.add(anchor);

    const capstan = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.62, 0.78, 0.95, 12)), gunmetalMat);
    capstan.position.set(side * 2.1, 8.2, -57.5);
    bowContent.add(capstan);
  }

  // =========================================================================
  // 2. ARMORED SUPERSTRUCTURE, CONNING TOWER, COMPASS BRIDGE & SEARCHLIGHT
  // =========================================================================
  const lowerCitadelBow = new THREE.Mesh(
    trackGeo(buildCurvedHouse(6.6, -33.0, WARSHIP_BREAK_Z, 2.75, 0.85, 0)),
    navalGreyMat,
  );
  lowerCitadelBow.position.y = 5.05;
  lowerCitadelBow.castShadow = !isSoftwareGl;
  bowContent.add(lowerCitadelBow);

  const lowerCitadelStern = new THREE.Mesh(
    trackGeo(buildCurvedHouse(6.6, WARSHIP_BREAK_Z, 26.5, 2.75, 0, 0.85)),
    navalGreyMat,
  );
  lowerCitadelStern.position.y = 5.05;
  lowerCitadelStern.castShadow = !isSoftwareGl;
  sternContent.add(lowerCitadelStern);

  const citadelDeckBow = new THREE.Mesh(
    trackGeo(buildCurvedHouse(6.8, -33.3, WARSHIP_BREAK_Z, 0.24, 0.85, 0)),
    teakMat,
  );
  citadelDeckBow.position.y = 7.8;
  bowContent.add(citadelDeckBow);

  const citadelDeckStern = new THREE.Mesh(
    trackGeo(buildCurvedHouse(6.8, WARSHIP_BREAK_Z, 26.8, 0.24, 0, 0.85)),
    teakMat,
  );
  citadelDeckStern.position.y = 7.8;
  sternContent.add(citadelDeckStern);

  // Forward Superstructure Tier & Armored Conning Tower (all in bowContent)
  const fwdSuper = new THREE.Mesh(trackGeo(buildCurvedHouse(4.9, -30.5, -14.0, 2.55, 0.65)), navalGreyMat);
  fwdSuper.position.y = 7.98;
  fwdSuper.castShadow = !isSoftwareGl;
  bowContent.add(fwdSuper);

  const fwdSuperRoof = new THREE.Mesh(trackGeo(buildCurvedHouse(5.15, -30.8, -13.8, 0.22, 0.65)), teakMat);
  fwdSuperRoof.position.y = 10.52;
  bowContent.add(fwdSuperRoof);

  const conningTower = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(2.15, 2.35, 2.5, 18)), armorDarkGreyMat);
  conningTower.position.set(0, 11.75, -28.6);
  bowContent.add(conningTower);
  const conningCap = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(1.75, 2.25, 0.58, 18)), armorDarkGreyMat);
  conningCap.position.set(0, 13.25, -28.6);
  bowContent.add(conningCap);

  const bridgeWingDeck = new THREE.Mesh(trackGeo(buildCurvedHouse(11.1, -27.2, -23.4, 0.26, 0.25)), teakMat);
  bridgeWingDeck.position.y = 13.1;
  bowContent.add(bridgeWingDeck);

  for (const sx of [-8.8, -5.6, 5.6, 8.8]) {
    const pillar = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.11, 0.14, 5.3, 8)), navalGreyMat);
    pillar.position.set(sx, 10.45, -25.2);
    bowContent.add(pillar);
  }

  const chartHouse = new THREE.Mesh(trackGeo(buildCurvedHouse(3.8, -26.8, -21.2, 2.25, 0.35)), navalGreyMat);
  chartHouse.position.y = 13.34;
  bowContent.add(chartHouse);

  const chartRoof = new THREE.Mesh(trackGeo(buildCurvedHouse(4.0, -27.0, -21.0, 0.2, 0.35)), teakMat);
  chartRoof.position.y = 15.58;
  bowContent.add(chartRoof);

  const bridgeWindows = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(5.2, 0.56, 0.14)), warmGlowMat);
  bridgeWindows.position.set(0, 14.52, -26.85);
  bowContent.add(bridgeWindows);

  for (const side of [-1, 1] as const) {
    const wingWall = new THREE.Mesh(trackGeo(buildCurvedHouse(3.6, -27.15, -26.75, 1.05, 0.1)), navalGreyMat);
    wingWall.position.set(side * 7.4, 13.35, 0);
    bowContent.add(wingWall);

    addRailSeg(bowContent, side * 3.8, 13.36, -23.5, side * 11.0, 13.36, -23.5);

    const wingCab = new THREE.Mesh(trackGeo(buildCurvedHouse(0.45, -27.1, -23.5, 1.12, 0.12)), navalGreyMat);
    wingCab.position.set(side * 10.8, 13.35, 0);
    bowContent.add(wingCab);

    const nav = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.22, 10, 10)),
      side < 0 ? portRedMat : stbdGreenMat,
    );
    nav.position.set(side * 10.95, 14.62, -25.6);
    bowContent.add(nav);
  }

  // Naval Searchlight Projector & Sweeping SpotLight atop Compass Bridge Roof
  const slPedestal = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.16, 0.24, 0.42, 10)), brassMat);
  slPedestal.position.set(0, 15.88, -25.4);
  bowContent.add(slPedestal);

  const slDrum = new THREE.Group();
  slDrum.position.set(0, 16.32, -25.4);
  const slHousing = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.38, 0.38, 0.82, 14)), armorDarkGreyMat);
  slHousing.rotation.x = Math.PI / 2;
  slDrum.add(slHousing);
  const slLens = new THREE.Mesh(trackGeo(new THREE.CircleGeometry(0.34, 14)), warmGlowMat);
  slLens.rotation.y = Math.PI;
  slLens.position.z = -0.42;
  slDrum.add(slLens);
  bowContent.add(slDrum);

  const navalSpotTarget = new THREE.Object3D();
  navalSpotTarget.position.set(0, 1.5, -145);
  bowContent.add(navalSpotTarget);

  const navalSpotLight = new THREE.SpotLight(0xeef7ff, 12, 340, Math.PI / 10, 0.55, 1.1);
  navalSpotLight.position.set(0, 16.32, -25.8);
  navalSpotLight.target = navalSpotTarget;
  bowContent.add(navalSpotLight);

  // =========================================================================
  // 3. FOUR TWIN 12-INCH MAIN TURRETS (A, P, Q, Y) + SECONDARY CASEMATE GUNS
  // =========================================================================
  const muzzleFlashMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0.95,
    }),
  );
  const muzzleFlashGeo = trackGeo(new THREE.SphereGeometry(0.95, 8, 8));

  const buildTwinTurret = (
    defaultYaw: number,
  ): { group: THREE.Group; defaultYaw: number; flashes: THREE.Mesh[] } => {
    const turretGrp = new THREE.Group();
    turretGrp.rotation.y = defaultYaw;

    const barbette = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(3.4, 3.65, 1.35, 20)), armorDarkGreyMat);
    barbette.position.y = 0.42;
    turretGrp.add(barbette);

    const tShape = new THREE.Shape();
    tShape.moveTo(-2.7, -2.9);
    tShape.lineTo(2.7, -2.9);
    tShape.lineTo(3.2, -0.6);
    tShape.lineTo(2.8, 2.8);
    tShape.lineTo(-2.8, 2.8);
    tShape.lineTo(-3.2, -0.6);
    tShape.closePath();

    const hoodGeo = trackGeo(
      new THREE.ExtrudeGeometry(tShape, {
        depth: 1.85,
        bevelEnabled: true,
        bevelThickness: 0.25,
        bevelSize: 0.22,
        bevelSegments: 2,
      }),
    );
    hoodGeo.rotateX(-Math.PI / 2);
    const hood = new THREE.Mesh(hoodGeo, armorDarkGreyMat);
    hood.position.y = 1.0;
    hood.castShadow = !isSoftwareGl;
    turretGrp.add(hood);

    const rfBox = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(2.6, 0.5, 1.1)), navalGreyMat);
    rfBox.position.set(0, 3.15, 0.9);
    turretGrp.add(rfBox);

    const barrelGeo = trackGeo(new THREE.CylinderGeometry(0.18, 0.34, 8.6, 12));
    barrelGeo.rotateX(Math.PI / 2);
    const mantletGeo = trackGeo(new THREE.BoxGeometry(0.95, 0.85, 0.85));
    const flashes: THREE.Mesh[] = [];

    for (const bx of [-1.05, 1.05]) {
      const mantlet = new THREE.Mesh(mantletGeo, gunmetalMat);
      mantlet.position.set(bx, 1.92, -2.95);
      turretGrp.add(mantlet);

      const barrel = new THREE.Mesh(barrelGeo, gunmetalMat);
      barrel.position.set(bx, 2.16, -6.95);
      barrel.rotation.x = 0.065;
      barrel.castShadow = !isSoftwareGl;
      turretGrp.add(barrel);

      const flash = new THREE.Mesh(muzzleFlashGeo, muzzleFlashMat);
      flash.scale.set(0.9, 0.9, 2.4);
      flash.position.set(bx, 2.45, -11.9);
      flash.visible = false;
      turretGrp.add(flash);
      flashes.push(flash);
    }

    return { group: turretGrp, defaultYaw, flashes };
  };

  const turretA = buildTwinTurret(0);
  turretA.group.position.set(0, 7.25, -45.5);
  bowContent.add(turretA.group);

  const turretP = buildTwinTurret(Math.PI * 0.16);
  turretP.group.position.set(-7.6, 5.15, 3.5);
  bowContent.add(turretP.group);

  const turretQ = buildTwinTurret(-Math.PI * 0.16);
  turretQ.group.position.set(7.6, 5.15, 3.5);
  bowContent.add(turretQ.group);

  const turretY = buildTwinTurret(Math.PI);
  turretY.group.position.set(0, 5.08, 49.0);
  sternContent.add(turretY.group);

  for (const side of [-1, 1] as const) {
    const sponson = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(3.75, 3.2, 2.2, 16)), navalGreyMat);
    sponson.position.set(side * 7.6, 4.15, 3.5);
    bowContent.add(sponson);
  }

  const secBarrelGeo = trackGeo(new THREE.CylinderGeometry(0.08, 0.13, 3.2, 8));
  secBarrelGeo.rotateZ(Math.PI / 2);
  for (const side of [-1, 1] as const) {
    for (const gz of [-26, -10, 20]) {
      const targetGrp = gz <= WARSHIP_BREAK_Z ? bowContent : sternContent;
      const shield = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.55, 0.6, 0.85, 8)), armorDarkGreyMat);
      shield.position.set(side * 6.4, 8.22, gz);
      targetGrp.add(shield);

      const gun = new THREE.Mesh(secBarrelGeo, gunmetalMat);
      gun.position.set(side * 7.75, 8.32, gz);
      targetGrp.add(gun);
    }
  }

  // =========================================================================
  // 4. THREE ROYAL NAVY FUNNELS + TWO TRIPOD FIGHTING MASTS + WHITE ENSIGN
  // =========================================================================
  const fidleyBow = new THREE.Mesh(
    trackGeo(buildCurvedHouse(2.7, -14.5, WARSHIP_BREAK_Z, 1.1, 0.5, 0)),
    armorDarkGreyMat,
  );
  fidleyBow.position.y = 7.9;
  bowContent.add(fidleyBow);

  const fidleyStern = new THREE.Mesh(
    trackGeo(buildCurvedHouse(2.7, WARSHIP_BREAK_Z, 22.8, 1.1, 0, 0.5)),
    armorDarkGreyMat,
  );
  fidleyStern.position.y = 7.9;
  sternContent.add(fidleyStern);

  const funnelZList = [-10.5, 4.5, 19.5];
  for (let f = 0; f < funnelZList.length; f++) {
    const fz = funnelZList[f];
    const targetGrp = fz <= WARSHIP_BREAK_Z ? bowContent : sternContent;
    const fGrp = new THREE.Group();
    fGrp.position.set(0, 8.85, fz);
    fGrp.rotation.x = 0.04;
    fGrp.scale.set(0.84, 1, 1.18);

    const shaft = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(1.75, 2.02, 9.6, 22)), navalGreyMat);
    shaft.position.y = 4.6;
    shaft.castShadow = !isSoftwareGl;
    fGrp.add(shaft);

    const blackTop = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(1.8, 1.76, 2.35, 22)), funnelBlackMat);
    blackTop.position.y = 10.5;
    fGrp.add(blackTop);

    const rim = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(1.78, 0.09, 8, 22)), funnelBlackMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 11.68;
    fGrp.add(rim);

    const grate = new THREE.Mesh(trackGeo(new THREE.CircleGeometry(1.66, 20)), funnelBlackMat);
    grate.rotation.x = -Math.PI / 2;
    grate.position.y = 11.54;
    fGrp.add(grate);

    const steamPipe = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.11, 0.13, 11.2, 8)), brassMat);
    steamPipe.position.set(0, 5.4, -1.96);
    fGrp.add(steamPipe);

    targetGrp.add(fGrp);

    for (const [tx, bx, bz] of [
      [-1.4, -6.3, fz - 2.6],
      [1.4, 6.3, fz - 2.6],
      [-1.4, -6.3, fz + 2.8],
      [1.4, 6.3, fz + 2.8],
    ]) {
      const guy = new THREE.Mesh(
        trackGeo(
          new THREE.TubeGeometry(
            new THREE.LineCurve3(new THREE.Vector3(tx, 18.6, fz + 0.5), new THREE.Vector3(bx, 8.05, bz)),
            3,
            0.026,
            5,
            false,
          ),
        ),
        stayMat,
      );
      targetGrp.add(guy);
    }
  }

  // Twin Heavy Tripod Fighting Masts (Foremast z = -20.5 -> bow, Mainmast z = 31.0 -> stern)
  const mastConfigs = [
    { z: -20.5, baseY: 10.6, topY: 32.5, spotY: 23.8 },
    { z: 31.0, baseY: 5.1, topY: 30.5, spotY: 21.8 },
  ];
  const mastTops: THREE.Vector3[] = [];
  for (const mc of mastConfigs) {
    const targetGrp = mc.z <= WARSHIP_BREAK_Z ? bowContent : sternContent;
    const mastH = mc.topY - mc.baseY;
    const pole = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.16, 0.36, mastH, 12)),
      mastBuffMat,
    );
    pole.position.set(0, mc.baseY + mastH * 0.5, mc.z);
    pole.castShadow = !isSoftwareGl;
    targetGrp.add(pole);

    for (const sx of [-1, 1] as const) {
      const legCurve = new THREE.LineCurve3(
        new THREE.Vector3(sx * 3.4, mc.baseY - 0.1, mc.z + 4.8),
        new THREE.Vector3(sx * 0.26, mc.spotY - 0.4, mc.z),
      );
      const leg = new THREE.Mesh(trackGeo(new THREE.TubeGeometry(legCurve, 4, 0.18, 8, false)), mastBuffMat);
      targetGrp.add(leg);
    }

    const spotPlatform = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(1.55, 1.25, 1.15, 12)), armorDarkGreyMat);
    spotPlatform.position.set(0, mc.spotY, mc.z);
    targetGrp.add(spotPlatform);

    const yard = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.06, 0.09, 9.2, 8)), mastBuffMat);
    yard.rotation.z = Math.PI / 2;
    yard.position.set(0, mc.topY - 5.2, mc.z);
    targetGrp.add(yard);

    const mastLamp = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.22, 8, 8)), warmGlowMat);
    mastLamp.position.set(0, mc.topY - 6.8, mc.z - 0.28);
    targetGrp.add(mastLamp);

    mastTops.push(new THREE.Vector3(0, mc.topY - 0.3, mc.z));
  }

  const aerialsGroup = new THREE.Group();
  for (const ax of [-0.4, 0.4]) {
    const aerial = new THREE.Mesh(
      trackGeo(
        new THREE.TubeGeometry(
          new THREE.LineCurve3(
            new THREE.Vector3(ax, mastTops[0].y, mastTops[0].z),
            new THREE.Vector3(ax, mastTops[1].y, mastTops[1].z),
          ),
          3,
          0.022,
          5,
          false,
        ),
      ),
      stayMat,
    );
    aerialsGroup.add(aerial);
  }
  bowContent.add(aerialsGroup);

  // Stern Royal Navy White Ensign Flag
  const ensignGroup = new THREE.Group();
  ensignGroup.position.set(0, 5.55, 71.2);
  ensignGroup.rotation.x = 0.2;
  const ensignStaff = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.04, 0.07, 5.4, 8)), mastBuffMat);
  ensignStaff.position.y = 2.7;
  ensignGroup.add(ensignStaff);
  const ensignFlag = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(3.2, 1.6)),
    trackMat(
      new THREE.MeshStandardMaterial({
        map: textures.whiteEnsignFlag,
        roughness: 0.72,
        side: THREE.DoubleSide,
      }),
    ),
  );
  ensignFlag.position.set(0.02, 4.5, 1.6);
  ensignFlag.rotation.y = Math.PI / 2;
  ensignGroup.add(ensignFlag);
  sternContent.add(ensignGroup);

  // Stowed Naval Steam Pinnaces / Cutters on Citadel Boat Deck
  const boatHullGeo = trackGeo(buildCurvedHouse(0.82, -2.5, 2.5, 0.62, 0.85));
  for (const side of [-1, 1] as const) {
    for (const bz of [-4, 14]) {
      const targetGrp = bz <= WARSHIP_BREAK_Z ? bowContent : sternContent;
      const chock = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.1, 0.4, 3.2)), teakMat);
      chock.position.set(side * 5.2, 8.15, bz);
      targetGrp.add(chock);
      const boat = new THREE.Mesh(boatHullGeo, creamBoatMat);
      boat.position.set(side * 5.2, 8.35, bz);
      targetGrp.add(boat);
    }
  }

  // =========================================================================
  // 4B. JAGGED INTERNAL FRACTURE BULKHEADS AT z = WARSHIP_BREAK_Z
  // =========================================================================
  const buildFractureBulkhead = (dirZ: -1 | 1): THREE.Group => {
    const cap = new THREE.Group();
    cap.position.set(0, 0, WARSHIP_BREAK_Z);

    const { beam, sheerY } = sampleWarshipStation(WARSHIP_BREAK_Z);
    const hullFaceShape = new THREE.Shape();
    hullFaceShape.moveTo(0, -4.8);
    hullFaceShape.quadraticCurveTo(beam * 0.86, -3.2, beam * 0.98, 0.9);
    hullFaceShape.lineTo(beam * 1.02, sheerY);
    hullFaceShape.lineTo(6.6, sheerY);
    hullFaceShape.lineTo(6.6, 7.8);
    hullFaceShape.lineTo(2.7, 7.8);
    hullFaceShape.lineTo(2.7, 9.0);
    hullFaceShape.lineTo(-2.7, 9.0);
    hullFaceShape.lineTo(-2.7, 7.8);
    hullFaceShape.lineTo(-6.6, 7.8);
    hullFaceShape.lineTo(-6.6, sheerY);
    hullFaceShape.lineTo(-beam * 1.02, sheerY);
    hullFaceShape.lineTo(-beam * 0.98, 0.9);
    hullFaceShape.quadraticCurveTo(-beam * 0.86, -3.2, 0, -4.8);
    hullFaceShape.closePath();

    const plate = new THREE.Mesh(trackGeo(new THREE.ShapeGeometry(hullFaceShape)), tornSteelMat);
    plate.position.z = -dirZ * 0.08;
    cap.add(plate);

    for (const dy of [-2.2, 0.8, 3.1, 5.1, 7.85]) {
      const w = dy < 5.5 ? 21.6 : 13.0;
      const slab = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w, 0.24, 0.95)), tornRustMat);
      slab.position.set(0, dy, dirZ * 0.2);
      cap.add(slab);
    }

    for (let ji = 0; ji < 13; ji++) {
      const xPos = -10.2 + ji * 1.7;
      const yPos = -3.4 + ((ji * 5) % 10) * 1.1;
      const jutLen = 0.55 + ((ji * 11) % 6) * 0.24;
      const shard = new THREE.Mesh(
        trackGeo(new THREE.ConeGeometry(0.36 + (ji % 3) * 0.14, jutLen, 4)),
        ji % 2 === 0 ? tornSteelMat : tornRustMat,
      );
      shard.rotation.x = dirZ * (Math.PI / 2 + ((ji % 5) - 2) * 0.14);
      shard.rotation.z = ((ji % 4) - 1.5) * 0.22;
      shard.position.set(xPos, yPos, dirZ * (jutLen * 0.45 + 0.1));
      cap.add(shard);
    }

    for (const [ex, ey] of [
      [-4.2, 1.8],
      [4.2, 1.8],
      [-3.0, 6.2],
      [3.0, 6.2],
    ]) {
      const ember = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(2.6, 1.2)), breakEmberMat);
      ember.position.set(ex, ey, dirZ * 0.24);
      if (dirZ < 0) ember.rotation.y = Math.PI;
      cap.add(ember);
    }

    cap.visible = false;
    return cap;
  };

  const bowBreakCap = buildFractureBulkhead(1);
  bowContent.add(bowBreakCap);
  const sternBreakCap = buildFractureBulkhead(-1);
  sternContent.add(sternBreakCap);

  // =========================================================================
  // 5. HULL & CITADEL PORTHOLES + 24 ROYAL NAVY CREWMEN (SPLIT BOW & STERN)
  // =========================================================================
  const portholeGeo = trackGeo(new THREE.CircleGeometry(0.2, 10));
  const phBow: Array<{ x: number; y: number; z: number; ry: number }> = [];
  const phStern: Array<{ x: number; y: number; z: number; ry: number }> = [];
  const pushPh = (p: { x: number; y: number; z: number; ry: number }) => {
    if (p.z <= WARSHIP_BREAK_Z) phBow.push(p);
    else phStern.push(p);
  };
  for (const side of [-1, 1]) {
    for (let z = -54; z <= 62; z += 5.2) {
      const { beam, sheerY } = sampleWarshipStation(z);
      const { beam: beamNext } = sampleWarshipStation(z + 1.5);
      const slopeAngle = Math.atan2((beamNext - beam) * side, 1.5);
      pushPh({
        x: side * (beam * 0.99 + 0.05),
        y: sheerY - 1.35,
        z,
        ry: (side > 0 ? Math.PI / 2 : -Math.PI / 2) - slopeAngle,
      });
    }
    for (let z = -29; z <= 22; z += 4.2) {
      pushPh({
        x: side * 6.66,
        y: 6.45,
        z,
        ry: side > 0 ? Math.PI / 2 : -Math.PI / 2,
      });
    }
  }
  const dummy = new THREE.Object3D();
  for (const [list, targetGrp] of [
    [phBow, bowContent],
    [phStern, sternContent],
  ] as const) {
    if (list.length === 0) continue;
    const phInst = new THREE.InstancedMesh(portholeGeo, warmGlowMat, list.length);
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.ry, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      phInst.setMatrixAt(i, dummy.matrix);
    }
    phInst.instanceMatrix.needsUpdate = true;
    targetGrp.add(phInst);
  }

  // 24 Royal Navy Officers & Seamen split cleanly across bow & stern halves
  const personTorso = trackGeo(new THREE.CylinderGeometry(0.16, 0.14, 0.68, 8));
  personTorso.translate(0, 1.08, 0);
  const personLegs = trackGeo(new THREE.CylinderGeometry(0.12, 0.1, 0.78, 8));
  personLegs.translate(0, 0.39, 0);
  const personHead = trackGeo(new THREE.SphereGeometry(0.11, 8, 8));
  personHead.translate(0, 1.54, 0);
  const navyCap = trackGeo(new THREE.CylinderGeometry(0.14, 0.12, 0.09, 10));
  navyCap.translate(0, 1.65, 0);

  const crewBodyGeo = trackGeo(normalizeAndMerge([personLegs, personTorso]));
  const crewHeadGeo = trackGeo(normalizeAndMerge([personHead]));
  const crewCapGeo = trackGeo(normalizeAndMerge([navyCap]));

  const navyUniformMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x162235, roughness: 0.72 }));
  const skinMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xe6bca0, roughness: 0.68 }));
  const capWhiteMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.55 }));

  const allCrewSpots: Array<[number, number, number, number]> = [
    [-8.5, 13.36, -25.4, 0.15],
    [-6.2, 13.36, -25.6, 0],
    [6.2, 13.36, -25.6, 0],
    [8.5, 13.36, -25.4, -0.15],
    [-1.8, 13.36, -26.2, 0],
    [1.8, 13.36, -26.2, 0],
    [-3.2, 7.65, -56.0, 0.1],
    [3.2, 7.65, -56.0, -0.1],
    [-4.8, 7.35, -39.0, -Math.PI / 2],
    [4.8, 7.35, -39.0, Math.PI / 2],
    [-0.7, 24.4, -20.5, 0],
    [0.7, 24.4, -20.5, 0],
    [-6.2, 5.15, -10.0, -Math.PI / 2],
    [6.2, 5.15, -10.0, Math.PI / 2],
    [-6.2, 5.15, 18.0, -Math.PI / 2],
    [6.2, 5.15, 18.0, Math.PI / 2],
    [-5.4, 5.15, 36.0, -0.3],
    [5.4, 5.15, 36.0, 0.3],
    [-4.6, 5.2, 58.0, -0.25],
    [4.6, 5.2, 58.0, 0.25],
    [-2.4, 5.35, 65.5, 0.1],
    [2.4, 5.35, 65.5, -0.1],
    [-4.2, 8.05, -22.0, -Math.PI / 2],
    [4.2, 8.05, -22.0, Math.PI / 2],
  ];

  const bowCrewSpots = allCrewSpots.filter((c) => c[2] <= WARSHIP_BREAK_Z);
  const sternCrewSpots = allCrewSpots.filter((c) => c[2] > WARSHIP_BREAK_Z);

  const bowCrewBodyInst = new THREE.InstancedMesh(crewBodyGeo, navyUniformMat, bowCrewSpots.length);
  const bowCrewHeadInst = new THREE.InstancedMesh(crewHeadGeo, skinMat, bowCrewSpots.length);
  const bowCrewCapInst = new THREE.InstancedMesh(crewCapGeo, capWhiteMat, bowCrewSpots.length);
  const sternCrewBodyInst = new THREE.InstancedMesh(crewBodyGeo, navyUniformMat, sternCrewSpots.length);
  const sternCrewHeadInst = new THREE.InstancedMesh(crewHeadGeo, skinMat, sternCrewSpots.length);
  const sternCrewCapInst = new THREE.InstancedMesh(crewCapGeo, capWhiteMat, sternCrewSpots.length);

  for (const inst of [
    bowCrewBodyInst,
    bowCrewHeadInst,
    bowCrewCapInst,
    sternCrewBodyInst,
    sternCrewHeadInst,
    sternCrewCapInst,
  ]) {
    inst.frustumCulled = false;
  }
  bowContent.add(bowCrewBodyInst, bowCrewHeadInst, bowCrewCapInst);
  sternContent.add(sternCrewBodyInst, sternCrewHeadInst, sternCrewCapInst);

  // =========================================================================
  // 6. RESCUE BOARDING LADDERS, FLOODLIGHT & SURVIVORS IN CORK LIFEJACKETS
  // =========================================================================
  const rescueDeckLight = new THREE.PointLight(0xffcb80, 0, 110, 1.3);
  rescueDeckLight.position.set(0, 13.5, 22);
  sternContent.add(rescueDeckLight);

  const boardingStationsLocal: Array<{ x: number; y: number; z: number; side: -1 | 1 }> = [
    { x: -12.6, y: 0.4, z: 9.0, side: -1 },
    { x: -12.6, y: 0.4, z: 34.0, side: -1 },
    { x: 12.6, y: 0.4, z: 9.0, side: 1 },
    { x: 12.6, y: 0.4, z: 34.0, side: 1 },
  ];

  const bowLaddersGroup = new THREE.Group();
  const sternLaddersGroup = new THREE.Group();
  bowLaddersGroup.visible = false;
  sternLaddersGroup.visible = false;
  const ropeRailGeo = trackGeo(new THREE.CylinderGeometry(0.035, 0.035, 5.6, 6));
  const rungGeo = trackGeo(new THREE.BoxGeometry(0.18, 0.06, 0.95));
  const stageGeo = trackGeo(new THREE.BoxGeometry(1.15, 0.14, 1.65));
  const upperLandingGeo = trackGeo(new THREE.BoxGeometry(1.6, 0.16, 1.85));
  const ladderLampGeo = trackGeo(new THREE.SphereGeometry(0.18, 8, 8));

  for (const st of boardingStationsLocal) {
    const g = new THREE.Group();
    g.position.set(st.side * 11.75, 2.85, st.z);

    const upperLanding = new THREE.Mesh(upperLandingGeo, teakMat);
    upperLanding.position.set(-st.side * 0.45, 2.32, 0);
    g.add(upperLanding);

    for (const rz of [-0.42, 0.42]) {
      const rope = new THREE.Mesh(ropeRailGeo, stayMat);
      rope.position.set(st.side * 0.25, 0, rz);
      g.add(rope);
    }
    for (let r = 0; r < 10; r++) {
      const rung = new THREE.Mesh(rungGeo, teakMat);
      rung.position.set(st.side * 0.25, -2.3 + r * 0.5, 0);
      g.add(rung);
    }
    const stage = new THREE.Mesh(stageGeo, teakMat);
    stage.position.set(st.side * 0.58, -2.2, 0);
    g.add(stage);

    const lamp = new THREE.Mesh(ladderLampGeo, warmGlowMat);
    lamp.position.set(st.side * 0.58, -1.45, 0.65);
    g.add(lamp);

    (st.z <= WARSHIP_BREAK_Z ? bowLaddersGroup : sternLaddersGroup).add(g);
  }
  bowContent.add(bowLaddersGroup);
  sternContent.add(sternLaddersGroup);

  const corkVest = trackGeo(new THREE.CylinderGeometry(0.2, 0.19, 0.38, 10));
  corkVest.translate(0, 1.15, 0);
  const survBodyGeo = trackGeo(normalizeAndMerge([personLegs, personTorso]));
  const survHeadGeo = trackGeo(normalizeAndMerge([personHead]));
  const survVestGeo = trackGeo(normalizeAndMerge([corkVest]));

  const survBodyMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 }));
  const survVestMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xefe3c8, roughness: 0.85 }));

  const MAX_SURVIVOR_FIGURES = 96;
  interface WarshipSurvSpot {
    x: number;
    y: number;
    z: number;
    ry: number;
    phase: number;
    onLadder?: number;
    orderIdx: number;
  }
  const bowSurvSpots: WarshipSurvSpot[] = [];
  const sternSurvSpots: WarshipSurvSpot[] = [];

  for (let i = 0; i < MAX_SURVIVOR_FIGURES; i++) {
    const isClimbing = i % 12 === 0;
    const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
    let spotBase: { x: number; y: number; z: number; ry: number; phase: number; onLadder?: number };
    if (isClimbing) {
      const st = boardingStationsLocal[i % boardingStationsLocal.length];
      spotBase = {
        x: st.side * 12.0,
        y: 1.0 + ((i * 5) % 4) * 0.9,
        z: st.z + ((i % 3) - 1) * 0.24,
        ry: st.side > 0 ? Math.PI / 2 : -Math.PI / 2,
        phase: i * 0.9,
        onLadder: i % boardingStationsLocal.length,
      };
    } else if (i % 4 === 0) {
      spotBase = {
        x: side * (3.6 + ((i * 7) % 18) * 0.12),
        y: 8.04,
        z: -10 + ((i * 13) % 34),
        ry: side > 0 ? -Math.PI / 2 : Math.PI / 2,
        phase: i * 1.2,
      };
    } else {
      const zSlot = 8 + ((i * 11) % 34);
      spotBase = {
        x: side * (7.2 + ((i * 13) % 28) * 0.11),
        y: 5.15,
        z: zSlot,
        ry: side > 0 ? -Math.PI / 2 : Math.PI / 2,
        phase: i * 1.05,
      };
    }
    (spotBase.z <= WARSHIP_BREAK_Z ? bowSurvSpots : sternSurvSpots).push({
      ...spotBase,
      orderIdx: i,
    });
  }

  const bowSurvBodyInst = new THREE.InstancedMesh(survBodyGeo, survBodyMat, bowSurvSpots.length);
  const bowSurvHeadInst = new THREE.InstancedMesh(survHeadGeo, skinMat, bowSurvSpots.length);
  const bowSurvVestInst = new THREE.InstancedMesh(survVestGeo, survVestMat, bowSurvSpots.length);
  const sternSurvBodyInst = new THREE.InstancedMesh(survBodyGeo, survBodyMat, sternSurvSpots.length);
  const sternSurvHeadInst = new THREE.InstancedMesh(survHeadGeo, skinMat, sternSurvSpots.length);
  const sternSurvVestInst = new THREE.InstancedMesh(survVestGeo, survVestMat, sternSurvSpots.length);

  for (const inst of [
    bowSurvBodyInst,
    bowSurvHeadInst,
    bowSurvVestInst,
    sternSurvBodyInst,
    sternSurvHeadInst,
    sternSurvVestInst,
  ]) {
    inst.frustumCulled = false;
  }

  const coatColors = [0x1c2430, 0x3a2a22, 0x5c232d, 0x243e4d, 0x4b3d57, 0x26443b, 0x8c7355];
  const tmpCol = new THREE.Color();
  for (const [arr, bInst, hInst, vInst] of [
    [bowSurvSpots, bowSurvBodyInst, bowSurvHeadInst, bowSurvVestInst],
    [sternSurvSpots, sternSurvBodyInst, sternSurvHeadInst, sternSurvVestInst],
  ] as const) {
    for (let i = 0; i < arr.length; i++) {
      tmpCol.setHex(coatColors[arr[i].orderIdx % coatColors.length]);
      bInst.setColorAt(i, tmpCol);
      bInst.setMatrixAt(i, _zeroMat);
      hInst.setMatrixAt(i, _zeroMat);
      vInst.setMatrixAt(i, _zeroMat);
    }
    if (bInst.instanceColor) bInst.instanceColor.needsUpdate = true;
    bInst.instanceMatrix.needsUpdate = true;
    hInst.instanceMatrix.needsUpdate = true;
    vInst.instanceMatrix.needsUpdate = true;
  }

  bowContent.add(bowSurvBodyInst, bowSurvHeadInst, bowSurvVestInst);
  sternContent.add(sternSurvBodyInst, sternSurvHeadInst, sternSurvVestInst);

  const setNavalState = (
    time: number,
    _speedKnots: number,
    nightMix: number,
    searchlightSweep: boolean,
    sweepTargetLocalX?: number,
    sweepTargetLocalZ?: number,
    rescueOptions?: WarshipRescueOptions,
  ) => {
    const clampedNight = THREE.MathUtils.clamp(nightMix, 0, 1);
    warmGlowMat.emissiveIntensity = 0.35 + clampedNight * 1.65;

    const combatAim = rescueOptions?.combatAim;
    const flashAlpha = combatAim ? THREE.MathUtils.clamp(combatAim.firingFlash, 0, 1) : 0;
    muzzleFlashMat.opacity = flashAlpha;

    const aimTurretYaw = (tx: number, tz: number, px: number, pz: number) =>
      Math.atan2(-(tx - px), -(tz - pz));

    if (combatAim) {
      const yawA = aimTurretYaw(combatAim.targetLocalX, combatAim.targetLocalZ, 0, -45.5);
      const yawP = aimTurretYaw(combatAim.targetLocalX, combatAim.targetLocalZ, -7.6, 3.5);
      const yawQ = aimTurretYaw(combatAim.targetLocalX, combatAim.targetLocalZ, 7.6, 3.5);
      const yawY = aimTurretYaw(combatAim.targetLocalX, combatAim.targetLocalZ, 0, 49.0);
      turretA.group.rotation.y = yawA;
      turretP.group.rotation.y = yawP;
      turretQ.group.rotation.y = yawQ;
      turretY.group.rotation.y = yawY;
    } else {
      turretA.group.rotation.y = Math.sin(time * 0.14) * 0.22;
      turretP.group.rotation.y = turretP.defaultYaw + Math.sin(time * 0.11 + 1.2) * 0.18;
      turretQ.group.rotation.y = turretQ.defaultYaw - Math.sin(time * 0.11 + 0.6) * 0.18;
      turretY.group.rotation.y = turretY.defaultYaw + Math.sin(time * 0.13 + 2.1) * 0.2;
    }

    const showFlash = flashAlpha > 0.06;
    const allTurrets = [turretA, turretP, turretQ, turretY];
    for (let ti = 0; ti < allTurrets.length; ti++) {
      const fls = allTurrets[ti].flashes;
      for (let fi = 0; fi < fls.length; fi++) {
        fls[fi].visible = showFlash && (ti === 0 || ti === (combatAim && combatAim.targetLocalX < 0 ? 1 : 2));
        if (fls[fi].visible) {
          fls[fi].scale.set(0.9 + flashAlpha * 0.8, 0.9 + flashAlpha * 0.8, 2.2 + flashAlpha * 1.8);
        }
      }
    }

    const laddersDeployed = Boolean(rescueOptions?.laddersDeployed);
    const boardedRatio = rescueOptions?.boardedRatio ?? 0;
    bowLaddersGroup.visible = laddersDeployed;
    sternLaddersGroup.visible = laddersDeployed;
    rescueDeckLight.intensity = laddersDeployed ? 14.0 : searchlightSweep ? 5.5 : 0;

    if (searchlightSweep) {
      const tx = sweepTargetLocalX !== undefined ? sweepTargetLocalX : Math.sin(time * 0.85) * 42;
      const tz = sweepTargetLocalZ !== undefined ? sweepTargetLocalZ : -145;
      navalSpotTarget.position.set(tx, 1.5, tz);
      slDrum.rotation.y = Math.atan2(-tx, Math.max(10, -tz));
      navalSpotLight.intensity = 170;
    } else if (clampedNight > 0.55) {
      const tx = Math.sin(time * 0.55) * 28;
      navalSpotTarget.position.set(tx, 2.0, -165);
      slDrum.rotation.y = Math.atan2(-tx, 140);
      navalSpotLight.intensity = 42 * clampedNight;
    } else {
      navalSpotTarget.position.set(0, 2.0, -145);
      slDrum.rotation.y = 0;
      navalSpotLight.intensity = 4;
    }

    _vScale.set(1, 1, 1);
    for (const [arr, bInst, hInst, cInst] of [
      [bowCrewSpots, bowCrewBodyInst, bowCrewHeadInst, bowCrewCapInst],
      [sternCrewSpots, sternCrewBodyInst, sternCrewHeadInst, sternCrewCapInst],
    ] as const) {
      for (let i = 0; i < arr.length; i++) {
        const [cx, cy, cz, ry] = arr[i];
        const sway = Math.sin(time * 1.15 + i * 0.9) * 0.015;
        const look = Math.sin(time * 0.65 + i * 1.4) * 0.16;
        _euler.set(0, ry + look, 0);
        _qRot.setFromEuler(_euler);
        _mat4.compose(_vPos.set(cx, cy + sway, cz), _qRot, _vScale);
        bInst.setMatrixAt(i, _mat4);
        hInst.setMatrixAt(i, _mat4);
        cInst.setMatrixAt(i, _mat4);
      }
      bInst.instanceMatrix.needsUpdate = true;
      hInst.instanceMatrix.needsUpdate = true;
      cInst.instanceMatrix.needsUpdate = true;
    }

    const visibleSurvivors = Math.round(
      THREE.MathUtils.clamp(boardedRatio, 0, 1) * MAX_SURVIVOR_FIGURES,
    );
    for (const [arr, bInst, hInst, vInst] of [
      [bowSurvSpots, bowSurvBodyInst, bowSurvHeadInst, bowSurvVestInst],
      [sternSurvSpots, sternSurvBodyInst, sternSurvHeadInst, sternSurvVestInst],
    ] as const) {
      for (let i = 0; i < arr.length; i++) {
        const sp = arr[i];
        if (sp.orderIdx >= visibleSurvivors) {
          bInst.setMatrixAt(i, _zeroMat);
          hInst.setMatrixAt(i, _zeroMat);
          vInst.setMatrixAt(i, _zeroMat);
        } else {
          const swayY = Math.sin(time * 1.4 + sp.phase) * 0.014;
          let climbOffset = 0;
          if (sp.onLadder !== undefined && laddersDeployed) {
            climbOffset = ((time * 0.55 + sp.phase) % 1) * 2.0;
          }
          _euler.set(0, sp.ry + Math.sin(time * 0.8 + sp.phase) * 0.15, 0);
          _qRot.setFromEuler(_euler);
          _mat4.compose(
            _vPos.set(sp.x, sp.y + swayY + climbOffset, sp.z),
            _qRot,
            _vScale,
          );
          bInst.setMatrixAt(i, _mat4);
          hInst.setMatrixAt(i, _mat4);
          vInst.setMatrixAt(i, _mat4);
        }
      }
      bInst.instanceMatrix.needsUpdate = true;
      hInst.instanceMatrix.needsUpdate = true;
      vInst.instanceMatrix.needsUpdate = true;
    }
  };

  const setBreakupVisual = (broken: boolean, emberPower = 0) => {
    bowBreakCap.visible = broken;
    sternBreakCap.visible = broken;
    aerialsGroup.visible = !broken;
    breakEmberMat.emissiveIntensity = broken ? THREE.MathUtils.clamp(emberPower, 0, 1.5) : 0;
    if (broken && emberPower <= 0.15) {
      warmGlowMat.emissiveIntensity = 0.2;
      navalSpotLight.intensity = 0;
      rescueDeckLight.intensity = 0;
    }
  };

  const reset = () => {
    root.visible = true;
    hullMeshGroup.position.set(0, 0, 0);
    hullMeshGroup.rotation.set(0, 0, 0);
    bowGroup.position.set(0, 0, WARSHIP_BREAK_Z);
    bowGroup.rotation.set(0, 0, 0);
    sternGroup.position.set(0, 0, WARSHIP_BREAK_Z);
    sternGroup.rotation.set(0, 0, 0);
    setBreakupVisual(false, 0);
  };

  return {
    root,
    hullMeshGroup,
    bowGroup,
    sternGroup,
    boardingStationsLocal,
    setNavalState,
    setBreakupVisual,
    reset,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}

