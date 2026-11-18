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
  const includeKeel = yMinFrac <= 0.001;

  const evalVertex = (z: number, side: number, frac: number): [number, number, number, number, number] => {
    const { beam, sheerY, flare } = sampleCarpathiaStation(z);
    const vCoord = (z + 85) / 170;
    const y = THREE.MathUtils.lerp(-5.2, sheerY, frac);
    let widthRatio: number;
    if (frac < 0.28) {
      widthRatio = Math.sin(((frac / 0.28) * Math.PI) / 2) * 0.88;
    } else {
      const up = (frac - 0.28) / 0.72;
      widthRatio = 0.88 + up * 0.12 + up * up * flare;
    }
    const bowRake = z <= -82 ? -(frac * 1.3) : 0;
    return [side * beam * widthRatio, y, z + bowRake, vCoord * 6, frac];
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

function buildCarpathiaWeatherDeck(
  zSamples: number[],
  yTopOffset = 0.06,
  thickness = 0.36,
  edgeExpand = 0.0,
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringPts = 5;

  for (let zi = 0; zi < zSamples.length; zi++) {
    const z = zSamples[zi];
    const { beam, sheerY, flare } = sampleCarpathiaStation(z);
    const halfW = Math.max(0.05, beam * (1 + flare) + edgeExpand);
    const bowRake = z <= -82 ? -1.3 : 0;
    const zz = z + bowRake;
    const yTop = sheerY + yTopOffset;
    const yBot = yTop - thickness;
    const vCoord = (z + 85) / 170;

    positions.push(-halfW, yBot, zz);
    uvs.push(0, vCoord * 9);
    positions.push(-halfW, yTop, zz);
    uvs.push(0.15, vCoord * 9);
    positions.push(0, yTop + 0.06, zz);
    uvs.push(0.5, vCoord * 9);
    positions.push(halfW, yTop, zz);
    uvs.push(0.85, vCoord * 9);
    positions.push(halfW, yBot, zz);
    uvs.push(1.0, vCoord * 9);
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
  // 1. LOFTED 170m CUNARD HULL, WEATHER DECKS, RAILINGS & SUPERSTRUCTURE
  // =========================================================================
  const zStations = [
    -85, -80, -72, -62, -50, -48.2, -48, -40, -30.2, -30, -16, 0, 18, 36, 51.8, 52, 66, 77, 85,
  ];
  const upperHull = new THREE.Mesh(trackGeo(buildLoftedHull(zStations, 7, 0.36, 1.0)), steelHullMat);
  upperHull.castShadow = !isSoftwareGl;
  upperHull.receiveShadow = true;
  root.add(upperHull);

  const lowerHull = new THREE.Mesh(trackGeo(buildLoftedHull(zStations, 4, 0.0, 0.37)), antiFoulMat);
  lowerHull.scale.set(0.999, 1, 0.9995);
  root.add(lowerHull);

  // Bow gold "CARPATHIA" nameplates flush against port & starboard flare
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
    plate.position.set(side * ((cb1 + cb2) * 0.5 + 0.06), 6.2, -70.0);
    plate.rotation.y = (side > 0 ? Math.PI / 2 : -Math.PI / 2) + side * carpBowYaw;
    root.add(plate);
  }

  // Hull-conforming Forecastle, Forward Well Deck, Midships Weather Deck & Poop Teak Decks
  const foreDeck = new THREE.Mesh(
    trackGeo(buildCarpathiaWeatherDeck([-85, -80, -72, -62, -52, -48], 0.05, 0.4, -0.02)),
    teakMat,
  );
  root.add(foreDeck);

  const fwdWellDeck = new THREE.Mesh(
    trackGeo(buildCarpathiaWeatherDeck([-48, -43, -37, -30], 0.06, 0.38, -0.02)),
    teakMat,
  );
  root.add(fwdWellDeck);

  const mainPromenade = new THREE.Mesh(
    trackGeo(buildCarpathiaWeatherDeck([-30, -16, 0, 18, 36, 52], 0.06, 0.42, 0.0)),
    teakMat,
  );
  root.add(mainPromenade);

  const poopDeck = new THREE.Mesh(
    trackGeo(buildCarpathiaWeatherDeck([52, 60, 70, 79, 85], 0.06, 0.4, -0.02)),
    teakMat,
  );
  root.add(poopDeck);

  // Break Bulkhead Walls sealing Forecastle-to-Well (-48), Well-to-Midships (-30) & Midships-to-Poop (+52)
  const foreBreakWall = new THREE.Mesh(trackGeo(buildCurvedHouse(8.4, -48.4, -47.6, 2.35, 0.15)), whiteMat);
  foreBreakWall.position.y = 5.35;
  root.add(foreBreakWall);

  const wellHatchCoaming = new THREE.Mesh(trackGeo(buildCurvedHouse(2.5, -42.5, -35.5, 0.72, 0.25)), whiteMat);
  wellHatchCoaming.position.y = 5.42;
  root.add(wellHatchCoaming);
  const wellHatchCover = new THREE.Mesh(trackGeo(buildCurvedHouse(2.3, -42.2, -35.8, 0.2, 0.2)), teakMat);
  wellHatchCover.position.y = 6.14;
  root.add(wellHatchCover);

  const poopBreakWall = new THREE.Mesh(trackGeo(buildCurvedHouse(8.6, 51.6, 52.5, 1.4, 0.15)), whiteMat);
  poopBreakWall.position.y = 5.5;
  root.add(poopBreakWall);

  // Hull-conforming Perimeter Railings on Forecastle, Well Deck, Boat Deck & Poop
  const addCarpRailSeg = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dy, dz);
    for (const off of [0.36, 0.68, 0.98]) {
      const bar = new THREE.Mesh(
        trackGeo(new THREE.CylinderGeometry(0.036, 0.036, len, 6)),
        off > 0.9 ? teakMat : whiteMat,
      );
      bar.position.set((x1 + x2) * 0.5, (y1 + y2) * 0.5 + off, (z1 + z2) * 0.5);
      bar.rotation.x = Math.PI / 2;
      bar.rotation.z = -Math.atan2(dx, dz);
      root.add(bar);
    }
  };
  const addCarpHullRail = (zList: number[]) => {
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < zList.length; i++) {
        const z = zList[i];
        const { beam, sheerY, flare } = sampleCarpathiaStation(z);
        const rx = side * Math.max(0, beam * (1 + flare) - 0.15);
        const ry = sheerY + 0.06;
        const post = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.045, 0.045, 1.0, 6)), whiteMat);
        post.position.set(rx, ry + 0.5, z <= -82 ? z - 1.25 : z);
        root.add(post);
        if (i < zList.length - 1) {
          const nz = zList[i + 1];
          const nxSt = sampleCarpathiaStation(nz);
          const nrx = side * Math.max(0, nxSt.beam * (1 + nxSt.flare) - 0.15);
          addCarpRailSeg(
            rx,
            ry,
            z <= -82 ? z - 1.25 : z,
            nrx,
            nxSt.sheerY + 0.06,
            nz <= -82 ? nz - 1.25 : nz,
          );
        }
      }
    }
  };
  addCarpHullRail([-84.5, -76, -65, -55, -48.3]);
  addCarpHullRail([-47.5, -39, -30.5]);
  addCarpHullRail([52.5, 62, 72, 80, 84.5]);

  // Midships Superstructure (Bridge Deck, Boat Deck & Promenade Roof)
  const bHouse = new THREE.Mesh(trackGeo(buildCurvedHouse(8.9, -29.0, 46.0, 2.8, 1.0)), whiteMat);
  bHouse.position.y = 5.62;
  bHouse.castShadow = !isSoftwareGl;
  root.add(bHouse);

  const boatDeckFloor = new THREE.Mesh(trackGeo(buildCurvedHouse(9.35, -29.5, 46.5, 0.26, 1.0)), teakMat);
  boatDeckFloor.position.y = 8.42;
  root.add(boatDeckFloor);

  // Boat Deck Teak-Capped Railings
  for (const side of [-1, 1] as const) {
    addCarpRailSeg(side * 9.2, 8.68, -28.0, side * 9.2, 8.68, 45.0);
    for (let pz = -26; pz <= 44; pz += 7.0) {
      const bPost = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.045, 0.045, 0.98, 6)), whiteMat);
      bPost.position.set(side * 9.2, 9.16, pz);
      root.add(bPost);
    }
  }

  const aHouse = new THREE.Mesh(trackGeo(buildCurvedHouse(7.1, -21.5, 38.5, 2.45, 0.7)), whiteMat);
  aHouse.position.y = 8.66;
  root.add(aHouse);

  // Solid Deckhouse Roof above A-House sealing funnel fidley & bridge base cleanly
  const aDeckRoof = new THREE.Mesh(trackGeo(buildCurvedHouse(7.35, -22.0, 39.0, 0.24, 0.7)), teakMat);
  aDeckRoof.position.y = 11.1;
  root.add(aDeckRoof);

  // Wheelhouse, Enclosed Bridge Wing Cabs & Cantilevered Support Knees (z = -20)
  const bridgeWingDeck = new THREE.Mesh(trackGeo(buildCurvedHouse(10.8, -23.2, -20.0, 0.28, 0.25)), teakMat);
  bridgeWingDeck.position.y = 11.08;
  root.add(bridgeWingDeck);

  // Support pillars & knees under the forward bridge overhang (-23.2 to -21.5)
  for (const sx of [-6.8, -3.6, 3.6, 6.8]) {
    const sup = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.11, 0.14, 2.65, 8)), whiteMat);
    sup.position.set(sx, 9.85, -22.2);
    root.add(sup);
  }

  const bridgeHouse = new THREE.Mesh(trackGeo(buildCurvedHouse(4.2, -23.3, -18.5, 2.38, 0.35)), whiteMat);
  bridgeHouse.position.y = 11.32;
  root.add(bridgeHouse);

  const bridgeRoof = new THREE.Mesh(trackGeo(buildCurvedHouse(4.4, -23.5, -18.3, 0.18, 0.35)), teakMat);
  bridgeRoof.position.y = 13.7;
  root.add(bridgeRoof);

  // Curved glowing bridge windows flush across front face of bridgeHouse
  const bridgeWinCenter = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(5.6, 0.68, 0.14)), warmGlowMat);
  bridgeWinCenter.position.set(0, 12.65, -23.32);
  root.add(bridgeWinCenter);

  // Searchlight projector pedestal & barrel atop Carpathia's wheelhouse roof
  const slBase = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.14, 0.22, 0.36, 10)), brassMat);
  slBase.position.set(-4.5, 13.78, -21.0);
  root.add(slBase);

  for (const side of [-1, 1] as const) {
    // Wing front dodger wall spanning seamlessly from bridgeHouse (4.2m) to wing cab (10.75m)
    const wingWall = new THREE.Mesh(trackGeo(buildCurvedHouse(3.3, -23.15, -22.8, 1.12, 0.1)), whiteMat);
    wingWall.position.set(side * 7.45, 11.34, 0);
    root.add(wingWall);

    // Aft bridge wing railing
    addCarpRailSeg(side * 4.2, 11.36, -20.1, side * 10.65, 11.36, -20.1);

    // Enclosed Wing Cab supporting port/starboard navigation lights (no floating spheres!)
    const wingCab = new THREE.Mesh(trackGeo(buildCurvedHouse(0.42, -23.1, -20.1, 1.18, 0.15)), whiteMat);
    wingCab.position.set(side * 10.55, 11.34, 0);
    root.add(wingCab);

    const nav = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.24, 10, 10)),
      side < 0 ? portRedMat : stbdGreenMat,
    );
    nav.position.set(side * 10.65, 12.62, -22.4);
    root.add(nav);
  }

  // =========================================================================
  // 2. SINGLE TOWERING CUNARD FUNNEL + FIDLEY CASING + 4 TILTED SCHOONER MASTS
  // =========================================================================
  // Boiler Fidley Casing anchoring funnel seamlessly onto A-Deck roof
  const fidleyBase = new THREE.Mesh(trackGeo(buildCurvedHouse(2.9, 1.6, 10.4, 0.95, 0.5)), whiteMat);
  fidleyBase.position.y = 11.2;
  root.add(fidleyBase);

  const funnelGroup = new THREE.Group();
  funnelGroup.position.set(0, 11.45, 6.0);
  funnelGroup.rotation.x = 0.075;
  funnelGroup.scale.set(0.86, 1, 1.15);

  const funnelShaft = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(2.15, 2.52, 13.4, 28)), cunardRedMat);
  funnelShaft.position.y = 5.8;
  funnelShaft.castShadow = !isSoftwareGl;
  funnelGroup.add(funnelShaft);

  const topBlackBand = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(2.2, 2.15, 3.0, 28)), blackBandMat);
  topBlackBand.position.y = 13.8;
  funnelGroup.add(topBlackBand);

  const funnelTopLip = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(2.18, 0.11, 8, 28)), blackBandMat);
  funnelTopLip.rotation.x = Math.PI / 2;
  funnelTopLip.position.y = 15.32;
  funnelGroup.add(funnelTopLip);

  const funnelFlueCap = new THREE.Mesh(trackGeo(new THREE.CircleGeometry(2.02, 24)), blackBandMat);
  funnelFlueCap.rotation.x = -Math.PI / 2;
  funnelFlueCap.position.y = 15.18;
  funnelGroup.add(funnelFlueCap);

  for (const by of [8.2, 10.4]) {
    const thinBand = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(2.3, 2.32, 0.36, 28)), blackBandMat);
    thinBand.position.y = by;
    funnelGroup.add(thinBand);
  }

  const whistlePipe = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.12, 0.14, 14.8, 8)), brassMat);
  whistlePipe.position.set(0, 6.8, -2.38);
  funnelGroup.add(whistlePipe);
  root.add(funnelGroup);

  // Funnel steel guy wires anchored down to Boat Deck
  for (const [tx, tz, bx, bz] of [
    [-1.8, 4.8, -8.5, 2.0],
    [1.8, 4.8, 8.5, 2.0],
    [-1.8, 7.6, -8.5, 11.5],
    [1.8, 7.6, 8.5, 11.5],
  ]) {
    const guy = new THREE.Mesh(
      trackGeo(
        new THREE.TubeGeometry(
          new THREE.LineCurve3(new THREE.Vector3(tx, 24.4, tz + 1.0), new THREE.Vector3(bx, 8.72, bz)),
          3,
          0.028,
          5,
          false,
        ),
      ),
      stayMat,
    );
    root.add(guy);
  }

  // 4 Tall Cunard Schooner Masts (z = -46, -15, 28, 60) built in tilted MastGroups so yards/lamps/aerials never float
  const mastZList = [-46.0, -15.0, 28.0, 60.0];
  const mastTilt = 0.05;
  const mastGeo = trackGeo(new THREE.CylinderGeometry(0.14, 0.3, 31.6, 12));
  const mastCollarGeo = trackGeo(new THREE.CylinderGeometry(0.4, 0.54, 0.65, 12));
  const lanternGeo = trackGeo(new THREE.SphereGeometry(0.24, 10, 10));
  const mastTops: Array<THREE.Vector3> = [];

  for (let m = 0; m < mastZList.length; m++) {
    const mz = mastZList[m];
    const baseY = m === 0 ? 5.2 : m === 3 ? 6.4 : 11.1;
    const mastGrp = new THREE.Group();
    mastGrp.position.set(0, baseY, mz);
    mastGrp.rotation.x = mastTilt;

    const collar = new THREE.Mesh(mastCollarGeo, whiteMat);
    collar.position.y = 0.32;
    mastGrp.add(collar);

    const mastLenAboveBase = 36.5 - baseY;
    const mast = new THREE.Mesh(mastGeo, mastBuffMat);
    mast.scale.y = mastLenAboveBase / 31.6;
    mast.position.y = mastLenAboveBase * 0.5;
    mastGrp.add(mast);

    if (m === 0 || m === 2) {
      const yard = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.06, 0.09, 9.6, 8)), mastBuffMat);
      yard.rotation.z = Math.PI / 2;
      yard.position.set(0, 27.5 - baseY, 0);
      mastGrp.add(yard);

      const mastLamp = new THREE.Mesh(lanternGeo, warmGlowMat);
      mastLamp.position.set(0, 25.0 - baseY, -0.26);
      mastGrp.add(mastLamp);
    }
    root.add(mastGrp);

    // Exact top & mid-mast coordinates along tilted axis for shrouds and wireless aerials
    const topWorldY = baseY + mastLenAboveBase * Math.cos(mastTilt);
    const topWorldZ = mz + mastLenAboveBase * Math.sin(mastTilt);
    mastTops.push(new THREE.Vector3(0, topWorldY, topWorldZ));

    const stayH = 29.0 - baseY;
    const stayY = baseY + stayH * Math.cos(mastTilt);
    const stayZ = mz + stayH * Math.sin(mastTilt);
    const anchorY = m === 0 ? 5.4 : m === 3 ? 6.6 : 8.72;
    const anchorX = m === 0 ? 8.0 : m === 3 ? 6.8 : 9.1;
    for (const sx of [-anchorX, anchorX]) {
      const stay = new THREE.Mesh(
        trackGeo(
          new THREE.TubeGeometry(
            new THREE.LineCurve3(new THREE.Vector3(0, stayY, stayZ), new THREE.Vector3(sx, anchorY, mz + 3)),
            3,
            0.03,
            5,
            false,
          ),
        ),
        stayMat,
      );
      root.add(stay);
    }
  }
  for (const ax of [-0.45, 0.45]) {
    const aerial = new THREE.Mesh(
      trackGeo(
        new THREE.TubeGeometry(
          new THREE.LineCurve3(
            new THREE.Vector3(ax, mastTops[0].y - 0.3, mastTops[0].z),
            new THREE.Vector3(ax, mastTops[3].y - 0.3, mastTops[3].z),
          ),
          3,
          0.024,
          5,
          false,
        ),
      ),
      stayMat,
    );
    root.add(aerial);
  }

  // Stern Red Ensign Flag (assembled in tilted staff group so flag never separates)
  const ensignGroup = new THREE.Group();
  ensignGroup.position.set(0, 6.8, 83.8);
  ensignGroup.rotation.x = 0.18;
  const ensignStaff = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.04, 0.07, 5.2, 8)), whiteMat);
  ensignStaff.position.y = 2.6;
  ensignGroup.add(ensignStaff);
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
  ensignFlag.position.set(0.02, 4.4, 1.4);
  ensignFlag.rotation.y = Math.PI / 2;
  ensignGroup.add(ensignFlag);
  root.add(ensignGroup);

  // 8 Stowed Cunard Lifeboats in Welin Davits along Boat Deck (z = -10, 4, 18, 32)
  const cBoatHullGeo = trackGeo(buildCurvedHouse(0.85, -2.7, 2.7, 0.65, 0.9));
  const cDavitCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.2, 1.2, 0),
    new THREE.Vector3(0.75, 1.85, 0),
  ]);
  const cDavitGeo = trackGeo(new THREE.TubeGeometry(cDavitCurve, 8, 0.07, 6, false));
  for (const side of [-1, 1] as const) {
    for (const lbz of [-10, 4, 18, 32]) {
      for (const dz of [-2.3, 2.3]) {
        const dv = new THREE.Mesh(cDavitGeo, whiteMat);
        dv.position.set(side * 8.15, 8.65, lbz + dz);
        dv.scale.x = side;
        root.add(dv);
      }
      const chock = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.1, 0.42, 3.6)), teakMat);
      chock.position.set(side * 8.65, 8.85, lbz);
      root.add(chock);

      const cb = new THREE.Mesh(cBoatHullGeo, whiteMat);
      cb.position.set(side * 8.65, 9.05, lbz);
      root.add(cb);
    }
  }

  // =========================================================================
  // 3. WARM PORTHOLES, RESCUE FLOODLIGHTS & 4 BOARDING GANGWAY LADDERS
  // =========================================================================
  const portholeGeo = trackGeo(new THREE.CircleGeometry(0.24, 10));
  const phCoords: Array<{ x: number; y: number; z: number; ry: number; sx: number }> = [];
  for (const side of [-1, 1]) {
    for (let z = -66; z <= 74; z += 4.5) {
      const { beam, sheerY } = sampleCarpathiaStation(z);
      const { beam: beamNext } = sampleCarpathiaStation(z + 1.5);
      const slopeAngle = Math.atan2((beamNext - beam) * side, 1.5);
      phCoords.push({
        x: side * (beam * 0.99 + 0.05),
        y: sheerY - 1.5,
        z,
        ry: (side > 0 ? Math.PI / 2 : -Math.PI / 2) - slopeAngle,
        sx: 1,
      });
    }
    for (let z = -27; z <= 44; z += 3.2) {
      phCoords.push({
        x: side * 8.97,
        y: 7.12,
        z,
        ry: side > 0 ? Math.PI / 2 : -Math.PI / 2,
        sx: 1.7,
      });
    }
    for (let z = -20; z <= 37; z += 3.2) {
      phCoords.push({
        x: side * 7.17,
        y: 9.88,
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
  rescueSpot.position.set(-4.5, 14.0, -21.0);
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
  const upperLandingGeo = trackGeo(new THREE.BoxGeometry(1.5, 0.16, 1.8));

  for (const st of boardingStationsLocal) {
    const g = new THREE.Group();
    g.position.set(st.side * 9.85, 3.2, st.z);

    // Upper deck-to-ladder landing bridge spanning from promenade deck edge out to the ladder top
    const upperLanding = new THREE.Mesh(upperLandingGeo, teakMat);
    upperLanding.position.set(-st.side * 0.4, 2.48, 0);
    g.add(upperLanding);

    for (const rz of [-0.42, 0.42]) {
      const rope = new THREE.Mesh(ropeRailGeo, stayMat);
      rope.position.set(st.side * 0.25, 0, rz);
      g.add(rope);
    }
    for (let r = 0; r < 11; r++) {
      const rung = new THREE.Mesh(rungGeo, teakMat);
      rung.position.set(st.side * 0.25, -2.5 + r * 0.52, 0);
      g.add(rung);
    }
    const stage = new THREE.Mesh(stageGeo, teakMat);
    stage.position.set(st.side * 0.55, -2.4, 0);
    g.add(stage);

    const lamp = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.18, 8, 8)), warmGlowMat);
    lamp.position.set(st.side * 0.55, -1.65, 0.65);
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
      // Boat Deck lining railings (y = 8.68 flush on boatDeckFloor)
      survivorSpots.push({
        x: side * (7.6 + ((i * 13) % 13) * 0.1),
        y: 8.68,
        z: -22 + ((i * 19) % 62),
        ry: side > 0 ? -Math.PI / 2 : Math.PI / 2,
        phase: i * 1.3,
      });
    } else {
      // Main Promenade & Weather deck (y = 5.66 flush on mainPromenade)
      survivorSpots.push({
        x: side * (7.2 + ((i * 11) % 17) * 0.1),
        y: 5.66,
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

  // Carpathia's own 18 visible deck crewmen always standing flush on bridge wings, bow & gangways
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
    [-8.8, 11.36, -21.5, -Math.PI / 2],
    [8.8, 11.36, -21.5, Math.PI / 2],
    [-1.4, 11.36, -22.2, 0],
    [1.4, 11.36, -22.2, 0],
    [-2.5, 7.75, -62.0, 0.2],
    [2.5, 7.75, -62.0, -0.2],
    [-9.2, 5.66, -8.5, -Math.PI / 2],
    [-9.2, 5.66, -7.2, -Math.PI / 2],
    [-9.2, 5.66, 21.5, -Math.PI / 2],
    [-9.2, 5.66, 22.8, -Math.PI / 2],
    [9.2, 5.66, -8.5, Math.PI / 2],
    [9.2, 5.66, -7.2, Math.PI / 2],
    [9.2, 5.66, 21.5, Math.PI / 2],
    [9.2, 5.66, 22.8, Math.PI / 2],
    [-8.6, 8.68, -4.0, -Math.PI / 2],
    [-8.6, 8.68, 20.0, -Math.PI / 2],
    [8.6, 8.68, -4.0, Math.PI / 2],
    [8.6, 8.68, 20.0, Math.PI / 2],
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
