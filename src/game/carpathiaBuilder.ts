import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ProceduralTextureSet } from './textures';

export const CARPATHIA_BREAK_Z = 10.0;

export interface CarpathiaRig {
  root: THREE.Group;
  hullMeshGroup: THREE.Group;
  bowGroup: THREE.Group;
  sternGroup: THREE.Group;
  boardingStationsLocal: Array<{ x: number; y: number; z: number; side: -1 | 1 }>;
  setRescueState: (
    time: number,
    boardedRatio: number,
    laddersDeployed: boolean,
    searchlightSweep: boolean,
  ) => void;
  setBreakupVisual: (broken: boolean, emberPower?: number) => void;
  reset: () => void;
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
  curveLenFore = 0.65,
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

  const hullMeshGroup = new THREE.Group();
  root.add(hullMeshGroup);

  const bowGroup = new THREE.Group();
  bowGroup.position.set(0, 0, CARPATHIA_BREAK_Z);
  hullMeshGroup.add(bowGroup);
  const bowContent = new THREE.Group();
  bowContent.position.set(0, 0, -CARPATHIA_BREAK_Z);
  bowGroup.add(bowContent);

  const sternGroup = new THREE.Group();
  sternGroup.position.set(0, 0, CARPATHIA_BREAK_Z);
  hullMeshGroup.add(sternGroup);
  const sternContent = new THREE.Group();
  sternContent.position.set(0, 0, -CARPATHIA_BREAK_Z);
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
  const tornSteelMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1c222a,
      roughness: 0.72,
      metalness: 0.65,
      side: THREE.DoubleSide,
    }),
  );
  const tornRustMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x4d251a,
      roughness: 0.86,
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
  // 1. LOFTED 170m CUNARD HULL (SPLIT AT CARPATHIA_BREAK_Z), DECKS & SUPERSTRUCTURE
  // =========================================================================
  const fwdHullZ = [
    -85, -80, -72, -62, -50, -48.2, -48, -40, -30.2, -30, -16, 0, CARPATHIA_BREAK_Z,
  ];
  const aftHullZ = [CARPATHIA_BREAK_Z, 18, 36, 51.8, 52, 66, 77, 85];

  for (const [stations, targetGrp] of [
    [fwdHullZ, bowContent],
    [aftHullZ, sternContent],
  ] as const) {
    const upperHull = new THREE.Mesh(trackGeo(buildLoftedHull(stations, 7, 0.36, 1.0)), steelHullMat);
    upperHull.castShadow = !isSoftwareGl;
    upperHull.receiveShadow = true;
    targetGrp.add(upperHull);

    const lowerHull = new THREE.Mesh(trackGeo(buildLoftedHull(stations, 4, 0.0, 0.37)), antiFoulMat);
    lowerHull.scale.set(0.999, 1, 0.9995);
    targetGrp.add(lowerHull);
  }

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
    bowContent.add(plate);
  }

  // Hull-conforming Forecastle, Forward Well Deck, Midships Weather Deck & Poop Teak Decks
  const foreDeck = new THREE.Mesh(
    trackGeo(buildCarpathiaWeatherDeck([-85, -80, -72, -62, -52, -48], 0.05, 0.4, -0.02)),
    teakMat,
  );
  bowContent.add(foreDeck);

  const fwdWellDeck = new THREE.Mesh(
    trackGeo(buildCarpathiaWeatherDeck([-48, -43, -37, -30], 0.06, 0.38, -0.02)),
    teakMat,
  );
  bowContent.add(fwdWellDeck);

  const mainPromenadeBow = new THREE.Mesh(
    trackGeo(buildCarpathiaWeatherDeck([-30, -16, 0, CARPATHIA_BREAK_Z], 0.06, 0.42, 0.0)),
    teakMat,
  );
  bowContent.add(mainPromenadeBow);

  const mainPromenadeStern = new THREE.Mesh(
    trackGeo(buildCarpathiaWeatherDeck([CARPATHIA_BREAK_Z, 18, 36, 52], 0.06, 0.42, 0.0)),
    teakMat,
  );
  sternContent.add(mainPromenadeStern);

  const poopDeck = new THREE.Mesh(
    trackGeo(buildCarpathiaWeatherDeck([52, 60, 70, 79, 85], 0.06, 0.4, -0.02)),
    teakMat,
  );
  sternContent.add(poopDeck);

  // Break Bulkhead Walls
  const foreBreakWall = new THREE.Mesh(trackGeo(buildCurvedHouse(8.4, -48.4, -47.6, 2.35, 0.15)), whiteMat);
  foreBreakWall.position.y = 5.35;
  bowContent.add(foreBreakWall);

  const wellHatchCoaming = new THREE.Mesh(trackGeo(buildCurvedHouse(2.5, -42.5, -35.5, 0.72, 0.25)), whiteMat);
  wellHatchCoaming.position.y = 5.42;
  bowContent.add(wellHatchCoaming);
  const wellHatchCover = new THREE.Mesh(trackGeo(buildCurvedHouse(2.3, -42.2, -35.8, 0.2, 0.2)), teakMat);
  wellHatchCover.position.y = 6.14;
  bowContent.add(wellHatchCover);

  const poopBreakWall = new THREE.Mesh(trackGeo(buildCurvedHouse(8.6, 51.6, 52.5, 1.4, 0.15)), whiteMat);
  poopBreakWall.position.y = 5.5;
  sternContent.add(poopBreakWall);

  // Hull-conforming Perimeter Railings
  const addCarpRailSeg = (
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
    for (const off of [0.36, 0.68, 0.98]) {
      const bar = new THREE.Mesh(
        trackGeo(new THREE.CylinderGeometry(0.036, 0.036, len, 6)),
        off > 0.9 ? teakMat : whiteMat,
      );
      bar.position.set((x1 + x2) * 0.5, (y1 + y2) * 0.5 + off, (z1 + z2) * 0.5);
      bar.rotation.x = Math.PI / 2;
      bar.rotation.z = -Math.atan2(dx, dz);
      targetGrp.add(bar);
    }
  };
  const addCarpHullRail = (targetGrp: THREE.Group, zList: number[]) => {
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < zList.length; i++) {
        const z = zList[i];
        const { beam, sheerY, flare } = sampleCarpathiaStation(z);
        const rx = side * Math.max(0, beam * (1 + flare) - 0.15);
        const ry = sheerY + 0.06;
        const post = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.045, 0.045, 1.0, 6)), whiteMat);
        post.position.set(rx, ry + 0.5, z <= -82 ? z - 1.25 : z);
        targetGrp.add(post);
        if (i < zList.length - 1) {
          const nz = zList[i + 1];
          const nxSt = sampleCarpathiaStation(nz);
          const nrx = side * Math.max(0, nxSt.beam * (1 + nxSt.flare) - 0.15);
          addCarpRailSeg(
            targetGrp,
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
  addCarpHullRail(bowContent, [-84.5, -76, -65, -55, -48.3]);
  addCarpHullRail(bowContent, [-47.5, -39, -30.5]);
  addCarpHullRail(sternContent, [52.5, 62, 72, 80, 84.5]);

  // Midships Superstructure (Bridge Deck, Boat Deck & Promenade Roof) — seamlessly split at CARPATHIA_BREAK_Z
  const bHouseBow = new THREE.Mesh(
    trackGeo(buildCurvedHouse(8.9, -29.0, CARPATHIA_BREAK_Z, 2.8, 1.0, 0)),
    whiteMat,
  );
  bHouseBow.position.y = 5.62;
  bHouseBow.castShadow = !isSoftwareGl;
  bowContent.add(bHouseBow);

  const bHouseStern = new THREE.Mesh(
    trackGeo(buildCurvedHouse(8.9, CARPATHIA_BREAK_Z, 46.0, 2.8, 0, 1.0)),
    whiteMat,
  );
  bHouseStern.position.y = 5.62;
  bHouseStern.castShadow = !isSoftwareGl;
  sternContent.add(bHouseStern);

  const boatDeckFloorBow = new THREE.Mesh(
    trackGeo(buildCurvedHouse(9.35, -29.5, CARPATHIA_BREAK_Z, 0.26, 1.0, 0)),
    teakMat,
  );
  boatDeckFloorBow.position.y = 8.42;
  bowContent.add(boatDeckFloorBow);

  const boatDeckFloorStern = new THREE.Mesh(
    trackGeo(buildCurvedHouse(9.35, CARPATHIA_BREAK_Z, 46.5, 0.26, 0, 1.0)),
    teakMat,
  );
  boatDeckFloorStern.position.y = 8.42;
  sternContent.add(boatDeckFloorStern);

  // Boat Deck Teak-Capped Railings (split cleanly)
  for (const side of [-1, 1] as const) {
    addCarpRailSeg(bowContent, side * 9.2, 8.68, -28.0, side * 9.2, 8.68, CARPATHIA_BREAK_Z);
    addCarpRailSeg(sternContent, side * 9.2, 8.68, CARPATHIA_BREAK_Z, side * 9.2, 8.68, 45.0);
    for (let pz = -26; pz <= 44; pz += 7.0) {
      const bPost = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.045, 0.045, 0.98, 6)), whiteMat);
      bPost.position.set(side * 9.2, 9.16, pz);
      (pz <= CARPATHIA_BREAK_Z ? bowContent : sternContent).add(bPost);
    }
  }

  const aHouseBow = new THREE.Mesh(
    trackGeo(buildCurvedHouse(7.1, -21.5, CARPATHIA_BREAK_Z, 2.45, 0.7, 0)),
    whiteMat,
  );
  aHouseBow.position.y = 8.66;
  bowContent.add(aHouseBow);

  const aHouseStern = new THREE.Mesh(
    trackGeo(buildCurvedHouse(7.1, CARPATHIA_BREAK_Z, 38.5, 2.45, 0, 0.7)),
    whiteMat,
  );
  aHouseStern.position.y = 8.66;
  sternContent.add(aHouseStern);

  const aDeckRoofBow = new THREE.Mesh(
    trackGeo(buildCurvedHouse(7.35, -22.0, CARPATHIA_BREAK_Z, 0.24, 0.7, 0)),
    teakMat,
  );
  aDeckRoofBow.position.y = 11.1;
  bowContent.add(aDeckRoofBow);

  const aDeckRoofStern = new THREE.Mesh(
    trackGeo(buildCurvedHouse(7.35, CARPATHIA_BREAK_Z, 39.0, 0.24, 0, 0.7)),
    teakMat,
  );
  aDeckRoofStern.position.y = 11.1;
  sternContent.add(aDeckRoofStern);

  // Wheelhouse, Enclosed Bridge Wing Cabs & Cantilevered Support Knees (z = -20 -> bowContent)
  const bridgeWingDeck = new THREE.Mesh(trackGeo(buildCurvedHouse(10.8, -23.2, -20.0, 0.28, 0.25)), teakMat);
  bridgeWingDeck.position.y = 11.08;
  bowContent.add(bridgeWingDeck);

  for (const sx of [-6.8, -3.6, 3.6, 6.8]) {
    const sup = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.11, 0.14, 2.65, 8)), whiteMat);
    sup.position.set(sx, 9.85, -22.2);
    bowContent.add(sup);
  }

  const bridgeHouse = new THREE.Mesh(trackGeo(buildCurvedHouse(4.2, -23.3, -18.5, 2.38, 0.35)), whiteMat);
  bridgeHouse.position.y = 11.32;
  bowContent.add(bridgeHouse);

  const bridgeRoof = new THREE.Mesh(trackGeo(buildCurvedHouse(4.4, -23.5, -18.3, 0.18, 0.35)), teakMat);
  bridgeRoof.position.y = 13.7;
  bowContent.add(bridgeRoof);

  const bridgeWinCenter = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(5.6, 0.68, 0.14)), warmGlowMat);
  bridgeWinCenter.position.set(0, 12.65, -23.32);
  bowContent.add(bridgeWinCenter);

  const slBase = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.14, 0.22, 0.36, 10)), brassMat);
  slBase.position.set(-4.5, 13.78, -21.0);
  bowContent.add(slBase);

  for (const side of [-1, 1] as const) {
    const wingWall = new THREE.Mesh(trackGeo(buildCurvedHouse(3.3, -23.15, -22.8, 1.12, 0.1)), whiteMat);
    wingWall.position.set(side * 7.45, 11.34, 0);
    bowContent.add(wingWall);

    addCarpRailSeg(bowContent, side * 4.2, 11.36, -20.1, side * 10.65, 11.36, -20.1);

    const wingCab = new THREE.Mesh(trackGeo(buildCurvedHouse(0.42, -23.1, -20.1, 1.18, 0.15)), whiteMat);
    wingCab.position.set(side * 10.55, 11.34, 0);
    bowContent.add(wingCab);

    const nav = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.24, 10, 10)),
      side < 0 ? portRedMat : stbdGreenMat,
    );
    nav.position.set(side * 10.65, 12.62, -22.4);
    bowContent.add(nav);
  }

  // =========================================================================
  // 2. SINGLE TOWERING CUNARD FUNNEL + FIDLEY CASING + 4 TILTED SCHOONER MASTS
  // =========================================================================
  const fidleyBase = new THREE.Mesh(trackGeo(buildCurvedHouse(2.9, 1.6, 9.9, 0.95, 0.5)), whiteMat);
  fidleyBase.position.y = 11.2;
  bowContent.add(fidleyBase);

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
  bowContent.add(funnelGroup);

  for (const [tx, tz, bx, bz] of [
    [-1.8, 4.8, -8.5, 2.0],
    [1.8, 4.8, 8.5, 2.0],
    [-1.8, 7.6, -8.5, 9.8],
    [1.8, 7.6, 8.5, 9.8],
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
    bowContent.add(guy);
  }

  // 4 Tall Cunard Schooner Masts (z = -46, -15, 28, 60)
  const mastZList = [-46.0, -15.0, 28.0, 60.0];
  const mastTilt = 0.05;
  const mastGeo = trackGeo(new THREE.CylinderGeometry(0.14, 0.3, 31.6, 12));
  const mastCollarGeo = trackGeo(new THREE.CylinderGeometry(0.4, 0.54, 0.65, 12));
  const lanternGeo = trackGeo(new THREE.SphereGeometry(0.24, 10, 10));
  const mastTops: Array<THREE.Vector3> = [];

  for (let m = 0; m < mastZList.length; m++) {
    const mz = mastZList[m];
    const targetGrp = mz <= CARPATHIA_BREAK_Z ? bowContent : sternContent;
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
    targetGrp.add(mastGrp);

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
      targetGrp.add(stay);
    }
  }

  const aerialsGroup = new THREE.Group();
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
    aerialsGroup.add(aerial);
  }
  bowContent.add(aerialsGroup);

  // Stern Red Ensign Flag
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
  sternContent.add(ensignGroup);

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
      const boatParent = lbz <= CARPATHIA_BREAK_Z ? bowContent : sternContent;
      for (const dz of [-2.3, 2.3]) {
        const dv = new THREE.Mesh(cDavitGeo, whiteMat);
        dv.position.set(side * 8.15, 8.65, lbz + dz);
        dv.scale.x = side;
        boatParent.add(dv);
      }
      const chock = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.1, 0.42, 3.6)), teakMat);
      chock.position.set(side * 8.65, 8.85, lbz);
      boatParent.add(chock);

      const cb = new THREE.Mesh(cBoatHullGeo, whiteMat);
      cb.position.set(side * 8.65, 9.05, lbz);
      boatParent.add(cb);
    }
  }

  // =========================================================================
  // 2B. JAGGED INTERNAL FRACTURE BULKHEADS AT z = CARPATHIA_BREAK_Z
  // =========================================================================
  const buildFractureBulkhead = (dirZ: -1 | 1): THREE.Group => {
    const cap = new THREE.Group();
    cap.position.set(0, 0, CARPATHIA_BREAK_Z);

    const { beam, sheerY } = sampleCarpathiaStation(CARPATHIA_BREAK_Z);
    const hullFaceShape = new THREE.Shape();
    hullFaceShape.moveTo(0, -5.0);
    hullFaceShape.quadraticCurveTo(beam * 0.85, -3.4, beam * 0.98, 0.8);
    hullFaceShape.lineTo(beam * 1.02, sheerY);
    hullFaceShape.lineTo(8.9, sheerY);
    hullFaceShape.lineTo(8.9, 8.42);
    hullFaceShape.lineTo(7.1, 8.42);
    hullFaceShape.lineTo(7.1, 11.1);
    hullFaceShape.lineTo(-7.1, 11.1);
    hullFaceShape.lineTo(-7.1, 8.42);
    hullFaceShape.lineTo(-8.9, 8.42);
    hullFaceShape.lineTo(-8.9, sheerY);
    hullFaceShape.lineTo(-beam * 1.02, sheerY);
    hullFaceShape.lineTo(-beam * 0.98, 0.8);
    hullFaceShape.quadraticCurveTo(-beam * 0.85, -3.4, 0, -5.0);
    hullFaceShape.closePath();

    const plate = new THREE.Mesh(trackGeo(new THREE.ShapeGeometry(hullFaceShape)), tornSteelMat);
    plate.position.z = -dirZ * 0.08;
    cap.add(plate);

    for (const dy of [-2.2, 0.8, 3.4, 5.65, 8.45, 11.1]) {
      const w = dy < 6 ? 18.2 : dy < 9 ? 17.6 : 14.0;
      const slab = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w, 0.24, 0.95)), tornRustMat);
      slab.position.set(0, dy, dirZ * 0.2);
      cap.add(slab);
    }

    for (let ji = 0; ji < 12; ji++) {
      const xPos = -8.6 + ji * 1.56;
      const yPos = -3.4 + ((ji * 5) % 12) * 1.15;
      const jutLen = 0.55 + ((ji * 11) % 6) * 0.24;
      const shard = new THREE.Mesh(
        trackGeo(new THREE.ConeGeometry(0.34 + (ji % 3) * 0.14, jutLen, 4)),
        ji % 2 === 0 ? tornSteelMat : tornRustMat,
      );
      shard.rotation.x = dirZ * (Math.PI / 2 + ((ji % 5) - 2) * 0.14);
      shard.rotation.z = ((ji % 4) - 1.5) * 0.22;
      shard.position.set(xPos, yPos, dirZ * (jutLen * 0.45 + 0.1));
      cap.add(shard);
    }

    for (const [ex, ey] of [
      [-3.5, 2.2],
      [3.5, 2.2],
      [-4.2, 6.8],
      [4.2, 6.8],
    ]) {
      const ember = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(2.4, 1.2)), breakEmberMat);
      ember.position.set(ex, ey, dirZ * 0.25);
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
  // 3. WARM PORTHOLES, RESCUE FLOODLIGHTS & 4 BOARDING GANGWAY LADDERS
  // =========================================================================
  const portholeGeo = trackGeo(new THREE.CircleGeometry(0.24, 10));
  const phBow: Array<{ x: number; y: number; z: number; ry: number; sx: number }> = [];
  const phStern: Array<{ x: number; y: number; z: number; ry: number; sx: number }> = [];
  const pushPh = (p: { x: number; y: number; z: number; ry: number; sx: number }) => {
    if (p.z <= CARPATHIA_BREAK_Z) phBow.push(p);
    else phStern.push(p);
  };
  for (const side of [-1, 1]) {
    for (let z = -66; z <= 74; z += 4.5) {
      const { beam, sheerY } = sampleCarpathiaStation(z);
      const { beam: beamNext } = sampleCarpathiaStation(z + 1.5);
      const slopeAngle = Math.atan2((beamNext - beam) * side, 1.5);
      pushPh({
        x: side * (beam * 0.99 + 0.05),
        y: sheerY - 1.5,
        z,
        ry: (side > 0 ? Math.PI / 2 : -Math.PI / 2) - slopeAngle,
        sx: 1,
      });
    }
    for (let z = -27; z <= 44; z += 3.2) {
      pushPh({
        x: side * 8.97,
        y: 7.12,
        z,
        ry: side > 0 ? Math.PI / 2 : -Math.PI / 2,
        sx: 1.7,
      });
    }
    for (let z = -20; z <= 37; z += 3.2) {
      pushPh({
        x: side * 7.17,
        y: 9.88,
        z,
        ry: side > 0 ? Math.PI / 2 : -Math.PI / 2,
        sx: 1.7,
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
      dummy.scale.set(p.sx, 1, 1);
      dummy.updateMatrix();
      phInst.setMatrixAt(i, dummy.matrix);
    }
    phInst.instanceMatrix.needsUpdate = true;
    targetGrp.add(phInst);
  }

  const deckGlowLight = new THREE.PointLight(0xffbe73, 12.0, 120, 1.25);
  deckGlowLight.position.set(0, 14.5, 6);
  bowContent.add(deckGlowLight);

  const rescueTarget = new THREE.Object3D();
  rescueTarget.position.set(-45, 0, 10);
  bowContent.add(rescueTarget);

  const rescueSpot = new THREE.SpotLight(0xedf7ff, 120, 260, Math.PI / 8, 0.55, 1.1);
  rescueSpot.position.set(-4.5, 14.0, -21.0);
  rescueSpot.target = rescueTarget;
  bowContent.add(rescueSpot);

  // 4 Illuminated Side Boarding Jacob's Ladders / Gangways (2 Port, 2 Starboard)
  const boardingStationsLocal: Array<{ x: number; y: number; z: number; side: -1 | 1 }> = [
    { x: -10.8, y: 0.4, z: -8.0, side: -1 },
    { x: -10.8, y: 0.4, z: 22.0, side: -1 },
    { x: 10.8, y: 0.4, z: -8.0, side: 1 },
    { x: 10.8, y: 0.4, z: 22.0, side: 1 },
  ];
  const bowLaddersGroup = new THREE.Group();
  const sternLaddersGroup = new THREE.Group();
  bowLaddersGroup.visible = false;
  sternLaddersGroup.visible = false;
  const ropeRailGeo = trackGeo(new THREE.CylinderGeometry(0.035, 0.035, 6.2, 6));
  const rungGeo = trackGeo(new THREE.BoxGeometry(0.18, 0.06, 0.95));
  const stageGeo = trackGeo(new THREE.BoxGeometry(1.1, 0.14, 1.6));
  const upperLandingGeo = trackGeo(new THREE.BoxGeometry(1.5, 0.16, 1.8));

  for (const st of boardingStationsLocal) {
    const g = new THREE.Group();
    g.position.set(st.side * 9.85, 3.2, st.z);

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

    (st.z <= CARPATHIA_BREAK_Z ? bowLaddersGroup : sternLaddersGroup).add(g);
  }
  bowContent.add(bowLaddersGroup);
  sternContent.add(sternLaddersGroup);

  // =========================================================================
  // 4. CARPATHIA CREW + 160 RESCUED TITANIC SURVIVORS (SPLIT BOW & STERN)
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
  interface CarpSurvivorSpot {
    x: number;
    y: number;
    z: number;
    ry: number;
    phase: number;
    onLadder?: number;
    orderIdx: number;
    isStern: boolean;
    localIdx: number;
  }
  const bowSurvSpots: CarpSurvivorSpot[] = [];
  const sternSurvSpots: CarpSurvivorSpot[] = [];

  for (let i = 0; i < MAX_SURVIVOR_FIGURES; i++) {
    const isClimbing = i % 10 === 0;
    const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
    let spotBase: { x: number; y: number; z: number; ry: number; phase: number; onLadder?: number };
    if (isClimbing) {
      const st = boardingStationsLocal[i % boardingStationsLocal.length];
      spotBase = {
        x: st.side * 10.15,
        y: 1.2 + ((i * 7) % 5) * 0.9,
        z: st.z + ((i % 3) - 1) * 0.25,
        ry: st.side > 0 ? Math.PI / 2 : -Math.PI / 2,
        phase: i * 0.9,
        onLadder: i % boardingStationsLocal.length,
      };
    } else if (i % 3 === 0) {
      spotBase = {
        x: side * (7.6 + ((i * 13) % 13) * 0.1),
        y: 8.68,
        z: -22 + ((i * 19) % 62),
        ry: side > 0 ? -Math.PI / 2 : Math.PI / 2,
        phase: i * 1.3,
      };
    } else {
      spotBase = {
        x: side * (7.2 + ((i * 11) % 17) * 0.1),
        y: 5.66,
        z: -28 + ((i * 23) % 74),
        ry: side > 0 ? -Math.PI / 2 : Math.PI / 2,
        phase: i * 1.1,
      };
    }
    const isStern = spotBase.z > CARPATHIA_BREAK_Z;
    const targetArr = isStern ? sternSurvSpots : bowSurvSpots;
    targetArr.push({
      ...spotBase,
      orderIdx: i,
      isStern,
      localIdx: targetArr.length,
    });
  }

  const bowSurvBodyInst = new THREE.InstancedMesh(bodyGeo, bodyMat, bowSurvSpots.length);
  const bowSurvHeadInst = new THREE.InstancedMesh(headGeo, headMat, bowSurvSpots.length);
  const bowSurvVestInst = new THREE.InstancedMesh(vestGeo, vestMat, bowSurvSpots.length);
  const sternSurvBodyInst = new THREE.InstancedMesh(bodyGeo, bodyMat, sternSurvSpots.length);
  const sternSurvHeadInst = new THREE.InstancedMesh(headGeo, headMat, sternSurvSpots.length);
  const sternSurvVestInst = new THREE.InstancedMesh(vestGeo, vestMat, sternSurvSpots.length);

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

  // Carpathia's own 18 visible deck crewmen split across bow & stern halves
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
  const bowCrew = crewSpots.filter((c) => c[2] <= CARPATHIA_BREAK_Z);
  const sternCrew = crewSpots.filter((c) => c[2] > CARPATHIA_BREAK_Z);
  tmpCol.setHex(0x131d2f);
  for (const [list, targetGrp] of [
    [bowCrew, bowContent],
    [sternCrew, sternContent],
  ] as const) {
    const cBody = new THREE.InstancedMesh(bodyGeo, bodyMat, list.length);
    const cHead = new THREE.InstancedMesh(headGeo, headMat, list.length);
    cBody.frustumCulled = false;
    cHead.frustumCulled = false;
    for (let i = 0; i < list.length; i++) {
      const [cx, cy, cz, ry] = list[i];
      cBody.setColorAt(i, tmpCol);
      _euler.set(0, ry, 0);
      _qRot.setFromEuler(_euler);
      _mat4.compose(_vPos.set(cx, cy, cz), _qRot, _vScale.set(1, 1, 1));
      cBody.setMatrixAt(i, _mat4);
      cHead.setMatrixAt(i, _mat4);
    }
    if (cBody.instanceColor) cBody.instanceColor.needsUpdate = true;
    cBody.instanceMatrix.needsUpdate = true;
    cHead.instanceMatrix.needsUpdate = true;
    targetGrp.add(cBody, cHead);
  }

  const setRescueState = (
    time: number,
    boardedRatio: number,
    laddersDeployed: boolean,
    searchlightSweep: boolean,
  ) => {
    bowLaddersGroup.visible = laddersDeployed;
    sternLaddersGroup.visible = laddersDeployed;

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
    for (const [arr, bInst, hInst, vInst] of [
      [bowSurvSpots, bowSurvBodyInst, bowSurvHeadInst, bowSurvVestInst],
      [sternSurvSpots, sternSurvBodyInst, sternSurvHeadInst, sternSurvVestInst],
    ] as const) {
      for (let i = 0; i < arr.length; i++) {
        const sp = arr[i];
        if (sp.orderIdx >= visibleCount) {
          bInst.setMatrixAt(i, _zeroMat);
          hInst.setMatrixAt(i, _zeroMat);
          vInst.setMatrixAt(i, _zeroMat);
        } else {
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
      deckGlowLight.intensity = 1.5;
      rescueSpot.intensity = 10;
    }
  };

  const reset = () => {
    hullMeshGroup.position.set(0, 0, 0);
    hullMeshGroup.rotation.set(0, 0, 0);
    bowGroup.position.set(0, 0, CARPATHIA_BREAK_Z);
    bowGroup.rotation.set(0, 0, 0);
    sternGroup.position.set(0, 0, CARPATHIA_BREAK_Z);
    sternGroup.rotation.set(0, 0, 0);
    warmGlowMat.emissiveIntensity = 1.9;
    deckGlowLight.intensity = 12.0;
    setBreakupVisual(false, 0);
  };

  return {
    root,
    hullMeshGroup,
    bowGroup,
    sternGroup,
    boardingStationsLocal,
    setRescueState,
    setBreakupVisual,
    reset,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}

