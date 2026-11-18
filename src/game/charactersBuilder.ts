import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type CharacterRole = 'officer' | 'lookout' | 'gentleman' | 'lady';
export type CharacterGait = 'idle' | 'walk' | 'run';

export interface DeckWaypoint {
  x: number;
  y: number;
  z: number;
  pauseSec?: number;
}

export interface DeckCharacter {
  group: THREE.Group;
  bodyRoot: THREE.Group;
  torsoGroup: THREE.Group;
  headGroup: THREE.Group;
  leftArmHip: THREE.Group;
  leftElbow: THREE.Group;
  rightArmHip: THREE.Group;
  rightElbow: THREE.Group;
  leftLegHip: THREE.Group;
  leftKnee: THREE.Group;
  rightLegHip: THREE.Group;
  rightKnee: THREE.Group;
  skirtMesh: THREE.Mesh | null;
  lifejacket: THREE.Group;
  role: CharacterRole;
  gait: CharacterGait;
  route: DeckWaypoint[];
  musterTarget: DeckWaypoint | null;
  waypointIdx: number;
  pauseTimer: number;
  walkSpeed: number;
  runSpeed: number;
  strideCycle: number;
  phase: number;
  baseRotY: number;
  posX: number;
  posY: number;
  posZ: number;
}

export interface LifeboatRig {
  side: -1 | 1;
  index: number;
  baseZ: number;
  lowerStart: number;
  lowerDuration: number;
  homeParent: THREE.Group;
  davitForeArm: THREE.Group;
  davitAftArm: THREE.Group;
  ropeFore: THREE.Mesh;
  ropeAft: THREE.Mesh;
  boatGroup: THREE.Group;
  occupantsGroup: THREE.Group;
  oarsGroup: THREE.Group;
  lanternMesh: THREE.Mesh;
  detached: boolean;
  rescued: boolean;
  splashX: number;
  splashZ: number;
}

export interface RescueProgressResult {
  boatsRecovered: number;
  survivorsRescued: number;
}

export interface CrewAndLifeboatSystem {
  characters: DeckCharacter[];
  totalCharacterCount: number;
  lifeboats: LifeboatRig[];
  updateCruising: (time: number, dt: number, floodingPct: number) => void;
  updateSinking: (
    time: number,
    dt: number,
    sinkProgress: number,
    shipRoot: THREE.Group,
  ) => number;
  updateRescue: (
    time: number,
    dt: number,
    stage: 'waiting' | 'approaching' | 'boarding' | 'complete',
    boardingProgress: number,
    carpathiaRoot: THREE.Group,
    boardingStationsLocal: Array<{ x: number; y: number; z: number; side: -1 | 1 }>,
    shipRoot: THREE.Group,
  ) => RescueProgressResult;
  reset: () => void;
  setLanternPower: (power: number) => void;
  dispose: () => void;
}

type CrowdKind = 'crew' | 'gentleman' | 'lady';

interface CrowdActor {
  kind: CrowdKind;
  allIdx: number;
  roleIdx: number;
  startX: number;
  startY: number;
  startZ: number;
  endX: number;
  endY: number;
  endZ: number;
  musterX: number;
  musterY: number;
  musterZ: number;
  posX: number;
  posY: number;
  posZ: number;
  rotY: number;
  baseRotY: number;
  goingForward: boolean;
  isWalker: boolean;
  pauseTimer: number;
  walkSpeed: number;
  runSpeed: number;
  strideCycle: number;
  phase: number;
  scaleH: number;
  scaleW: number;
}

// Pre-allocated math helpers (zero per-frame GC across all 1,000 characters)
const _tmpWorldPos = new THREE.Vector3();
const _vPos = new THREE.Vector3();
const _vScale = new THREE.Vector3();
const _qRot = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _pelvisMat = new THREE.Matrix4();
const _torsoMat = new THREE.Matrix4();
const _headMat = new THREE.Matrix4();
const _localMat = new THREE.Matrix4();
const _partMat = new THREE.Matrix4();
const _zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Normalizes geometries to identical attributes (position + normal) before merging.
 */
function normalizeAndMerge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = parts.map((src) => {
    const g = src.index ? src.toNonIndexed() : src.clone();
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    return g;
  });
  const merged = mergeGeometries(prepared, false);
  for (const g of prepared) g.dispose();
  if (!merged) {
    throw new Error('Failed to merge character part geometries');
  }
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Builds a double-ended sculpted wooden whaleboat hull geometry (no capsule primitives).
 */
function buildRealisticLifeboatHullGeo(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const zStations = 14;
  const uStations = 11;
  const halfLen = 3.1;
  const maxHalfBeam = 0.94;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let zi = 0; zi <= zStations; zi++) {
    const t = zi / zStations;
    const z = THREE.MathUtils.lerp(-halfLen, halfLen, t);
    const beamEnv = Math.pow(Math.sin(t * Math.PI), 0.68);
    const sheerRaise = Math.pow(Math.abs(t - 0.5) * 2, 2.2) * 0.28;

    for (let ui = 0; ui <= uStations; ui++) {
      const s = (ui / uStations) * 2 - 1;
      const absS = Math.abs(s);
      const flare = Math.pow(absS, 0.72);
      const x = Math.sign(s) * flare * maxHalfBeam * beamEnv;
      const y = -0.44 + Math.pow(absS, 1.85) * (0.86 + sheerRaise);
      positions.push(x, y, z);
      uvs.push(t * 3, ui / uStations);
    }
  }

  const stride = uStations + 1;
  for (let zi = 0; zi < zStations; zi++) {
    for (let ui = 0; ui < uStations; ui++) {
      const a = zi * stride + ui;
      const b = (zi + 1) * stride + ui;
      const c = (zi + 1) * stride + (ui + 1);
      const d = zi * stride + (ui + 1);
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

export function createCrewAndLifeboats(
  bowContent: THREE.Group,
  sternContent: THREE.Group,
  whitePaintMat: THREE.Material,
  teakDeckMat: THREE.Material,
  breakZ = 90.0,
): CrewAndLifeboatSystem {
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

  // =========================================================================
  // REALISTIC FABRICS, SKIN, HAIR & LIFEJACKET MATERIALS
  // =========================================================================
  const officerNavyMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x131d2f, roughness: 0.68, metalness: 0.06 }),
  );
  const officerTrouserMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x0f1624, roughness: 0.72, metalness: 0.04 }),
  );
  const officerGoldMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0xd9ad4e, roughness: 0.24, metalness: 0.88 }),
  );
  const shirtWhiteMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: 0.62 }),
  );
  const capBlackVisorMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x0b0e14, roughness: 0.22, metalness: 0.15 }),
  );
  const skinTones = [
    trackMat(new THREE.MeshStandardMaterial({ color: 0xe2b698, roughness: 0.68 })),
    trackMat(new THREE.MeshStandardMaterial({ color: 0xd7a786, roughness: 0.7 })),
    trackMat(new THREE.MeshStandardMaterial({ color: 0xebbda0, roughness: 0.66 })),
  ];
  const hairMats = [
    trackMat(new THREE.MeshStandardMaterial({ color: 0x241913, roughness: 0.85 })),
    trackMat(new THREE.MeshStandardMaterial({ color: 0x452d1d, roughness: 0.84 })),
    trackMat(new THREE.MeshStandardMaterial({ color: 0x6b5c50, roughness: 0.82 })),
  ];
  const bootLeatherMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x161210, roughness: 0.42, metalness: 0.08 }),
  );
  const gentlemanCoatMats = [
    trackMat(new THREE.MeshStandardMaterial({ color: 0x1d232d, roughness: 0.76 })),
    trackMat(new THREE.MeshStandardMaterial({ color: 0x362a21, roughness: 0.78 })),
    trackMat(new THREE.MeshStandardMaterial({ color: 0x29323a, roughness: 0.74 })),
    trackMat(new THREE.MeshStandardMaterial({ color: 0x423a32, roughness: 0.78 })),
  ];
  const ladyCoatMats = [
    trackMat(new THREE.MeshStandardMaterial({ color: 0x5c212c, roughness: 0.72 })),
    trackMat(new THREE.MeshStandardMaterial({ color: 0x233d4b, roughness: 0.72 })),
    trackMat(new THREE.MeshStandardMaterial({ color: 0x4a3d56, roughness: 0.72 })),
    trackMat(new THREE.MeshStandardMaterial({ color: 0xa38767, roughness: 0.72 })),
    trackMat(new THREE.MeshStandardMaterial({ color: 0x25443a, roughness: 0.74 })),
  ];
  const lifejacketMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0xebe0c7, roughness: 0.84 }),
  );
  const strapMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x7c6a4c, roughness: 0.88 }),
  );
  const ropeMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x9c8259, roughness: 0.9 }));
  const boatLanternMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffe4a3,
      emissive: 0xffa73b,
      emissiveIntensity: 1.8,
      roughness: 0.3,
    }),
  );

  // White-base tintable materials for InstancedMesh crowd (instanceColor multiplies cleanly)
  const instClothMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.74, metalness: 0.04 }),
  );
  const instSkinMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.68 }),
  );
  const instHairMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }),
  );

  // =========================================================================
  // SCULPTED ANATOMICAL LATHE & EXTRUDED HUMAN GEOMETRIES (Zero Boxes/Cubes)
  // =========================================================================
  const coatTorsoPts = [
    new THREE.Vector2(0.155, -0.18),
    new THREE.Vector2(0.135, -0.02),
    new THREE.Vector2(0.168, 0.24),
    new THREE.Vector2(0.19, 0.43),
    new THREE.Vector2(0.085, 0.51),
    new THREE.Vector2(0.068, 0.56),
  ];
  const coatTorsoGeo = trackGeo(new THREE.LatheGeometry(coatTorsoPts, 14));
  coatTorsoGeo.scale(1.12, 1.0, 0.78);

  const ladyBodicePts = [
    new THREE.Vector2(0.115, -0.04),
    new THREE.Vector2(0.105, 0.04),
    new THREE.Vector2(0.145, 0.24),
    new THREE.Vector2(0.155, 0.42),
    new THREE.Vector2(0.075, 0.5),
    new THREE.Vector2(0.06, 0.55),
  ];
  const ladyBodiceGeo = trackGeo(new THREE.LatheGeometry(ladyBodicePts, 14));
  ladyBodiceGeo.scale(1.08, 1.0, 0.76);

  const skirtPts = [
    new THREE.Vector2(0.28, -0.82),
    new THREE.Vector2(0.25, -0.58),
    new THREE.Vector2(0.2, -0.32),
    new THREE.Vector2(0.145, -0.1),
    new THREE.Vector2(0.118, 0.02),
  ];
  const skirtGeo = trackGeo(new THREE.LatheGeometry(skirtPts, 14));
  skirtGeo.scale(1.05, 1.0, 0.92);

  const upperArmPts = [
    new THREE.Vector2(0.048, -0.27),
    new THREE.Vector2(0.056, -0.12),
    new THREE.Vector2(0.068, 0.0),
    new THREE.Vector2(0.03, 0.03),
  ];
  const upperArmGeo = trackGeo(new THREE.LatheGeometry(upperArmPts, 10));

  const forearmPts = [
    new THREE.Vector2(0.042, -0.24),
    new THREE.Vector2(0.05, -0.1),
    new THREE.Vector2(0.048, 0.0),
  ];
  const forearmGeo = trackGeo(new THREE.LatheGeometry(forearmPts, 10));
  const handGeo = trackGeo(new THREE.SphereGeometry(0.04, 8, 8));
  handGeo.scale(0.85, 1.25, 0.65);

  const thighPts = [
    new THREE.Vector2(0.066, -0.4),
    new THREE.Vector2(0.082, -0.2),
    new THREE.Vector2(0.092, 0.0),
  ];
  const thighGeo = trackGeo(new THREE.LatheGeometry(thighPts, 10));

  const shinPts = [
    new THREE.Vector2(0.045, -0.38),
    new THREE.Vector2(0.058, -0.18),
    new THREE.Vector2(0.065, 0.0),
  ];
  const shinGeo = trackGeo(new THREE.LatheGeometry(shinPts, 10));

  const bootShape = new THREE.Shape();
  bootShape.moveTo(-0.042, -0.05);
  bootShape.lineTo(0.042, -0.05);
  bootShape.quadraticCurveTo(0.046, 0.08, 0.034, 0.17);
  bootShape.quadraticCurveTo(0, 0.21, -0.034, 0.17);
  bootShape.quadraticCurveTo(-0.046, 0.08, -0.042, -0.05);
  const bootGeo = trackGeo(
    new THREE.ExtrudeGeometry(bootShape, {
      depth: 0.065,
      bevelEnabled: true,
      bevelThickness: 0.015,
      bevelSize: 0.012,
      bevelSegments: 2,
    }),
  );
  bootGeo.rotateX(-Math.PI / 2);

  const neckGeo = trackGeo(new THREE.CylinderGeometry(0.054, 0.064, 0.11, 10));
  const craniumGeo = trackGeo(new THREE.SphereGeometry(0.105, 12, 10));
  craniumGeo.scale(0.92, 1.12, 1.0);
  const jawGeo = trackGeo(new THREE.SphereGeometry(0.078, 10, 8));
  jawGeo.scale(0.88, 0.9, 0.95);
  const noseGeo = trackGeo(new THREE.ConeGeometry(0.018, 0.045, 6));
  noseGeo.rotateX(-Math.PI / 2);
  const hairCapGeo = trackGeo(new THREE.SphereGeometry(0.11, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.58));
  hairCapGeo.scale(0.94, 1.08, 1.04);

  const capCrownPts = [
    new THREE.Vector2(0.106, 0.0),
    new THREE.Vector2(0.112, 0.04),
    new THREE.Vector2(0.135, 0.085),
    new THREE.Vector2(0.125, 0.105),
    new THREE.Vector2(0.0, 0.112),
  ];
  const officerCapCrownGeo = trackGeo(new THREE.LatheGeometry(capCrownPts, 12));
  const capVisorGeo = trackGeo(
    new THREE.CylinderGeometry(0.108, 0.115, 0.014, 10, 1, false, -Math.PI * 0.38, Math.PI * 0.76),
  );
  const capBadgeGeo = trackGeo(new THREE.SphereGeometry(0.018, 6, 6));

  const bowlerCrownGeo = trackGeo(
    new THREE.SphereGeometry(0.112, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.54),
  );
  const hatBrimPts = [
    new THREE.Vector2(0.105, 0.0),
    new THREE.Vector2(0.155, -0.01),
    new THREE.Vector2(0.165, 0.012),
  ];
  const gentBrimGeo = trackGeo(new THREE.LatheGeometry(hatBrimPts, 12));
  const ladyBrimPts = [
    new THREE.Vector2(0.105, 0.0),
    new THREE.Vector2(0.24, -0.025),
    new THREE.Vector2(0.26, -0.015),
  ];
  const ladyBrimGeo = trackGeo(new THREE.LatheGeometry(ladyBrimPts, 14));

  const collarGeo = trackGeo(new THREE.ConeGeometry(0.095, 0.14, 8));
  collarGeo.scale(1.0, 1.0, 0.45);
  const buttonGeo = trackGeo(new THREE.SphereGeometry(0.014, 6, 6));
  const corkRibGeo = trackGeo(new THREE.CapsuleGeometry(0.038, 0.17, 4, 8));
  const vestStrapGeo = trackGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.34, 6));

  // =========================================================================
  // MERGED INSTANCED-RIG PART GEOMETRIES (Same Sculpted Silhouettes!)
  // =========================================================================
  const instHeadSkinGeo = trackGeo(
    (() => {
      const p1 = neckGeo.clone();
      p1.translate(0, 0.02, 0);
      const p2 = craniumGeo.clone();
      p2.translate(0, 0.14, 0);
      const p3 = jawGeo.clone();
      p3.translate(0, 0.085, -0.025);
      const p4 = noseGeo.clone();
      p4.translate(0, 0.13, -0.105);
      const m = normalizeAndMerge([p1, p2, p3, p4]);
      p1.dispose();
      p2.dispose();
      p3.dispose();
      p4.dispose();
      return m;
    })(),
  );

  const instHairGeo = trackGeo(
    (() => {
      const p = hairCapGeo.clone();
      p.rotateX(0.18);
      p.translate(0, 0.155, 0.01);
      const m = normalizeAndMerge([p]);
      p.dispose();
      return m;
    })(),
  );

  const instArmGeo = trackGeo(
    (() => {
      const p1 = upperArmGeo.clone();
      const p2 = forearmGeo.clone();
      p2.rotateX(0.22); // slight natural elbow bend forward toward -Z
      p2.translate(0, -0.27, 0);
      const p3 = handGeo.clone();
      p3.translate(0, -0.52, -0.055);
      const m = normalizeAndMerge([p1, p2, p3]);
      p1.dispose();
      p2.dispose();
      p3.dispose();
      return m;
    })(),
  );

  const instLegGeo = trackGeo(
    (() => {
      const p1 = thighGeo.clone();
      const p2 = shinGeo.clone();
      p2.translate(0, -0.4, 0);
      const p3 = bootGeo.clone();
      p3.translate(0, -0.81, 0.01);
      const m = normalizeAndMerge([p1, p2, p3]);
      p1.dispose();
      p2.dispose();
      p3.dispose();
      return m;
    })(),
  );

  const instTorsoGeo = trackGeo(normalizeAndMerge([coatTorsoGeo]));
  const instSkirtGeo = trackGeo(
    (() => {
      const p = skirtGeo.clone();
      p.translate(0, -0.02, 0);
      const m = normalizeAndMerge([p]);
      p.dispose();
      return m;
    })(),
  );

  const instHatGentGeo = trackGeo(
    (() => {
      const p1 = bowlerCrownGeo.clone();
      p1.translate(0, 0.21, 0);
      const p2 = gentBrimGeo.clone();
      p2.translate(0, 0.21, 0);
      const m = normalizeAndMerge([p1, p2]);
      p1.dispose();
      p2.dispose();
      return m;
    })(),
  );

  const instHatLadyGeo = trackGeo(
    (() => {
      const p1 = bowlerCrownGeo.clone();
      p1.scale(0.95, 0.75, 0.95);
      p1.translate(0, 0.215, 0);
      const p2 = ladyBrimGeo.clone();
      p2.translate(0, 0.215, 0);
      const m = normalizeAndMerge([p1, p2]);
      p1.dispose();
      p2.dispose();
      return m;
    })(),
  );

  const instHatCrewGeo = trackGeo(
    (() => {
      const p1 = officerCapCrownGeo.clone();
      p1.scale(0.94, 0.94, 0.94);
      p1.translate(0, 0.21, 0);
      const p2 = capVisorGeo.clone();
      p2.rotateY(Math.PI);
      p2.rotateX(-0.14);
      p2.translate(0, 0.205, -0.02);
      const m = normalizeAndMerge([p1, p2]);
      p1.dispose();
      p2.dispose();
      return m;
    })(),
  );

  const instVestGeo = trackGeo(
    (() => {
      const parts: THREE.BufferGeometry[] = [];
      for (const zSide of [-0.145, 0.145]) {
        for (const rx of [-0.095, 0, 0.095]) {
          const rib = corkRibGeo.clone();
          rib.translate(rx, 0.21, zSide);
          parts.push(rib);
        }
      }
      for (const sx of [-0.11, 0.11]) {
        const strap = vestStrapGeo.clone();
        strap.rotateX(Math.PI / 2);
        strap.translate(sx, 0.36, 0);
        parts.push(strap);
      }
      const m = normalizeAndMerge(parts);
      parts.forEach((p) => p.dispose());
      return m;
    })(),
  );

  // =========================================================================
  // 1. 14 FULL-RIG HERO CREW & OFFICERS (Bridge, Crow's Nest, Forecastle, Boat Deck, Docking Bridge)
  // =========================================================================
  const characters: DeckCharacter[] = [];

  const spawnCharacter = (
    role: CharacterRole,
    route: DeckWaypoint[],
    gait: CharacterGait,
    variantIdx: number,
    musterTarget: DeckWaypoint | null,
    initialRotY = 0,
  ): DeckCharacter => {
    const start = route[0];
    const group = new THREE.Group();
    group.position.set(start.x, start.y, start.z);
    group.rotation.y = initialRotY;

    const bodyRoot = new THREE.Group();
    bodyRoot.position.y = 0.85;
    group.add(bodyRoot);

    const coatMat =
      role === 'officer' || role === 'lookout'
        ? officerNavyMat
        : role === 'gentleman'
          ? gentlemanCoatMats[variantIdx % gentlemanCoatMats.length]
          : ladyCoatMats[variantIdx % ladyCoatMats.length];
    const legMat =
      role === 'officer' || role === 'lookout'
        ? officerTrouserMat
        : gentlemanCoatMats[(variantIdx + 1) % gentlemanCoatMats.length];
    const skinMat = skinTones[variantIdx % skinTones.length];
    const hairMat = hairMats[variantIdx % hairMats.length];

    const torsoGroup = new THREE.Group();
    bodyRoot.add(torsoGroup);

    const torsoMesh = new THREE.Mesh(role === 'lady' ? ladyBodiceGeo : coatTorsoGeo, coatMat);
    torsoMesh.castShadow = true;
    torsoGroup.add(torsoMesh);

    const shirtCollar = new THREE.Mesh(collarGeo, shirtWhiteMat);
    shirtCollar.rotation.x = Math.PI;
    shirtCollar.position.set(0, 0.46, -0.075);
    torsoGroup.add(shirtCollar);

    if (role === 'officer' || role === 'gentleman') {
      for (let bi = 0; bi < 3; bi++) {
        for (const bx of [-0.036, 0.036]) {
          const btn = new THREE.Mesh(buttonGeo, role === 'officer' ? officerGoldMat : coatMat);
          btn.position.set(bx, 0.06 + bi * 0.11, -0.128);
          torsoGroup.add(btn);
        }
      }
      if (role === 'officer') {
        for (const ex of [-0.18, 0.18]) {
          const ep = new THREE.Mesh(corkRibGeo, officerGoldMat);
          ep.scale.set(0.55, 0.45, 0.55);
          ep.rotation.z = Math.PI / 2;
          ep.position.set(ex, 0.45, 0);
          torsoGroup.add(ep);
        }
      }
    }

    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0.57, 0);
    torsoGroup.add(headGroup);

    const neck = new THREE.Mesh(neckGeo, skinMat);
    neck.position.y = 0.02;
    headGroup.add(neck);

    const cranium = new THREE.Mesh(craniumGeo, skinMat);
    cranium.position.y = 0.14;
    cranium.castShadow = true;
    headGroup.add(cranium);

    const jaw = new THREE.Mesh(jawGeo, skinMat);
    jaw.position.set(0, 0.085, -0.025);
    headGroup.add(jaw);

    const nose = new THREE.Mesh(noseGeo, skinMat);
    nose.position.set(0, 0.13, -0.105);
    headGroup.add(nose);

    const hair = new THREE.Mesh(hairCapGeo, hairMat);
    hair.position.set(0, 0.155, 0.01);
    hair.rotation.x = 0.18;
    headGroup.add(hair);

    if (role === 'officer') {
      const cap = new THREE.Mesh(officerCapCrownGeo, shirtWhiteMat);
      cap.position.set(0, 0.21, 0);
      headGroup.add(cap);
      const visor = new THREE.Mesh(capVisorGeo, capBlackVisorMat);
      visor.position.set(0, 0.21, -0.02);
      visor.rotation.y = Math.PI;
      visor.rotation.x = -0.14;
      headGroup.add(visor);
      const badge = new THREE.Mesh(capBadgeGeo, officerGoldMat);
      badge.position.set(0, 0.255, -0.115);
      headGroup.add(badge);
    } else if (role === 'lookout') {
      const cap = new THREE.Mesh(officerCapCrownGeo, officerNavyMat);
      cap.position.set(0, 0.21, 0);
      cap.scale.setScalar(0.92);
      headGroup.add(cap);
      const visor = new THREE.Mesh(capVisorGeo, capBlackVisorMat);
      visor.position.set(0, 0.205, -0.02);
      visor.rotation.y = Math.PI;
      headGroup.add(visor);
    } else if (role === 'gentleman') {
      const bowler = new THREE.Mesh(bowlerCrownGeo, coatMat);
      bowler.position.y = 0.21;
      headGroup.add(bowler);
      const brim = new THREE.Mesh(gentBrimGeo, coatMat);
      brim.position.y = 0.21;
      headGroup.add(brim);
    } else {
      const crown = new THREE.Mesh(bowlerCrownGeo, coatMat);
      crown.position.y = 0.215;
      crown.scale.set(0.95, 0.75, 0.95);
      headGroup.add(crown);
      const brim = new THREE.Mesh(ladyBrimGeo, coatMat);
      brim.position.y = 0.215;
      headGroup.add(brim);
    }

    const makeArm = (side: -1 | 1) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * (role === 'lady' ? 0.17 : 0.205), 0.41, 0);
      torsoGroup.add(shoulder);

      const upper = new THREE.Mesh(upperArmGeo, coatMat);
      upper.castShadow = true;
      shoulder.add(upper);

      const elbow = new THREE.Group();
      elbow.position.set(0, -0.27, 0);
      shoulder.add(elbow);

      const fore = new THREE.Mesh(forearmGeo, coatMat);
      fore.castShadow = true;
      elbow.add(fore);

      const hand = new THREE.Mesh(handGeo, skinMat);
      hand.position.set(0, -0.26, 0);
      elbow.add(hand);

      return { shoulder, elbow };
    };
    const leftArm = makeArm(-1);
    const rightArm = makeArm(1);

    const makeLeg = (side: -1 | 1) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.095, -0.04, 0);
      bodyRoot.add(hip);

      const thigh = new THREE.Mesh(thighGeo, legMat);
      thigh.castShadow = true;
      hip.add(thigh);

      const knee = new THREE.Group();
      knee.position.set(0, -0.4, 0);
      hip.add(knee);

      const shin = new THREE.Mesh(shinGeo, legMat);
      shin.castShadow = true;
      knee.add(shin);

      const boot = new THREE.Mesh(bootGeo, bootLeatherMat);
      boot.position.set(0, -0.42, 0.01);
      boot.castShadow = true;
      knee.add(boot);

      return { hip, knee };
    };
    const leftLeg = makeLeg(-1);
    const rightLeg = makeLeg(1);

    let skirtMesh: THREE.Mesh | null = null;
    if (role === 'lady') {
      skirtMesh = new THREE.Mesh(skirtGeo, coatMat);
      skirtMesh.position.y = -0.02;
      skirtMesh.castShadow = true;
      bodyRoot.add(skirtMesh);
    }

    const lifejacket = new THREE.Group();
    for (const zSide of [-0.145, 0.145]) {
      for (const rx of [-0.095, 0, 0.095]) {
        const rib = new THREE.Mesh(corkRibGeo, lifejacketMat);
        rib.position.set(rx, 0.21, zSide);
        lifejacket.add(rib);
      }
    }
    for (const sx of [-0.11, 0.11]) {
      const strap = new THREE.Mesh(vestStrapGeo, strapMat);
      strap.rotation.x = Math.PI / 2;
      strap.position.set(sx, 0.36, 0);
      lifejacket.add(strap);
    }
    lifejacket.visible = false;
    torsoGroup.add(lifejacket);

    const targetParent = start.z < breakZ ? bowContent : sternContent;
    targetParent.add(group);

    const ch: DeckCharacter = {
      group,
      bodyRoot,
      torsoGroup,
      headGroup,
      leftArmHip: leftArm.shoulder,
      leftElbow: leftArm.elbow,
      rightArmHip: rightArm.shoulder,
      rightElbow: rightArm.elbow,
      leftLegHip: leftLeg.hip,
      leftKnee: leftLeg.knee,
      rightLegHip: rightLeg.hip,
      rightKnee: rightLeg.knee,
      skirtMesh,
      lifejacket,
      role,
      gait,
      route,
      musterTarget,
      waypointIdx: route.length > 1 ? 1 : 0,
      pauseTimer: 0,
      walkSpeed: role === 'officer' ? 1.55 : 1.35 + (variantIdx % 3) * 0.18,
      runSpeed: 3.9 + (variantIdx % 4) * 0.32,
      strideCycle: variantIdx * 1.1,
      phase: (start.x * 1.7 + start.z * 0.9) % (Math.PI * 2),
      baseRotY: initialRotY,
      posX: start.x,
      posY: start.y,
      posZ: start.z,
    };
    characters.push(ch);
    return ch;
  };

  // 1-2: Wheelhouse Watch Officers
  spawnCharacter(
    'officer',
    [
      { x: 1.55, y: 13.06, z: -0.35, pauseSec: 2.2 },
      { x: 1.65, y: 13.06, z: 0.75, pauseSec: 1.6 },
      { x: 0.95, y: 13.06, z: 0.85, pauseSec: 2.5 },
    ],
    'walk',
    0,
    null,
    0.2,
  );
  spawnCharacter(
    'officer',
    [
      { x: -1.45, y: 13.06, z: 0.1, pauseSec: 2.4 },
      { x: -1.9, y: 13.06, z: 1.4, pauseSec: 2.0 },
    ],
    'walk',
    1,
    null,
    -0.2,
  );
  // 3-4: Port & Starboard Bridge Wing Officers
  spawnCharacter(
    'officer',
    [
      { x: 7.4, y: 13.06, z: -0.5, pauseSec: 1.4 },
      { x: 14.3, y: 13.06, z: -0.5, pauseSec: 2.8 },
    ],
    'walk',
    2,
    { x: 11.4, y: 12.88, z: 9.0 },
  );
  spawnCharacter(
    'officer',
    [
      { x: -7.4, y: 13.06, z: -0.5, pauseSec: 1.6 },
      { x: -14.3, y: 13.06, z: -0.5, pauseSec: 2.5 },
    ],
    'walk',
    3,
    { x: -11.4, y: 12.88, z: 9.0 },
  );
  // 5-6: Crow's Nest Lookouts
  spawnCharacter('lookout', [{ x: -0.3, y: 25.4, z: -22.55 }], 'idle', 0, null, 0.08);
  spawnCharacter('lookout', [{ x: 0.3, y: 25.4, z: -22.45 }], 'idle', 1, null, -0.08);
  // 7-8: Forecastle Anchor Watch Crewmen
  spawnCharacter(
    'officer',
    [
      { x: -2.2, y: 9.2, z: -56.0, pauseSec: 2.0 },
      { x: -5.4, y: 9.2, z: -38.0, pauseSec: 1.5 },
    ],
    'walk',
    4,
    { x: -9.5, y: 12.88, z: 10.0 },
  );
  spawnCharacter(
    'officer',
    [
      { x: 2.2, y: 9.2, z: -59.0, pauseSec: 2.2 },
      { x: 5.2, y: 9.2, z: -39.0, pauseSec: 1.8 },
    ],
    'walk',
    5,
    { x: 9.5, y: 12.88, z: 10.0 },
  );
  // 9-10: Aft Docking Bridge Watch Officers (sternContent)
  spawnCharacter(
    'officer',
    [
      { x: -4.8, y: 10.52, z: 172.5, pauseSec: 2.4 },
      { x: 4.8, y: 10.52, z: 172.5, pauseSec: 2.4 },
    ],
    'walk',
    6,
    { x: -9.5, y: 12.88, z: 130.0 },
  );
  spawnCharacter(
    'officer',
    [
      { x: 1.6, y: 10.52, z: 172.4, pauseSec: 3.0 },
      { x: -1.6, y: 10.52, z: 172.6, pauseSec: 2.8 },
    ],
    'walk',
    7,
    { x: 9.5, y: 12.88, z: 130.0 },
  );
  // 11-14: Boat Deck Quartermasters overseeing port & starboard Welin Davit Clusters
  spawnCharacter(
    'officer',
    [
      { x: 11.1, y: 12.88, z: 9.0, pauseSec: 1.8 },
      { x: 11.1, y: 12.88, z: 36.5, pauseSec: 1.8 },
    ],
    'walk',
    8,
    { x: 11.4, y: 12.88, z: 18.2 },
  );
  spawnCharacter(
    'officer',
    [
      { x: -11.1, y: 12.88, z: 36.5, pauseSec: 1.8 },
      { x: -11.1, y: 12.88, z: 9.0, pauseSec: 1.8 },
    ],
    'walk',
    9,
    { x: -11.4, y: 12.88, z: 18.2 },
  );
  spawnCharacter(
    'officer',
    [
      { x: 11.1, y: 12.88, z: 102.0, pauseSec: 1.8 },
      { x: 11.1, y: 12.88, z: 130.0, pauseSec: 1.8 },
    ],
    'walk',
    10,
    { x: 11.4, y: 12.88, z: 111.7 },
  );
  spawnCharacter(
    'officer',
    [
      { x: -11.1, y: 12.88, z: 130.0, pauseSec: 1.8 },
      { x: -11.1, y: 12.88, z: 102.0, pauseSec: 1.8 },
    ],
    'walk',
    11,
    { x: -11.4, y: 12.88, z: 111.7 },
  );

  // =========================================================================
  // 2. 986 INSTANCED ARTICULATED PASSENGERS & CREW (14 Hero + 986 Crowd = 1,000)
  // =========================================================================
  const rand = mulberry32(19120414);

  const skinPalette = [0xe4b99b, 0xd8a888, 0xecc0a3, 0xcf9b7a, 0xf0cbb2];
  const hairPalette = [0x1c1410, 0x3b2619, 0x5c4230, 0x7b6b5e, 0xa89f96];
  const gentCoatPalette = [0x1a2029, 0x2f251e, 0x26313a, 0x3d352d, 0x242934, 0x4b3b2d];
  const ladyDressPalette = [0x61222e, 0x223e4d, 0x4b3d59, 0x9c8060, 0x24463b, 0x7c4632, 0x314a63];
  const trouserPalette = [0x121720, 0x1e2024, 0x2a2622, 0x18212b];

  interface HalfCrowdBatch {
    halfContent: THREE.Group;
    actors: CrowdActor[];
    torsoInst: THREE.InstancedMesh;
    headInst: THREE.InstancedMesh;
    hairInst: THREE.InstancedMesh;
    leftArmInst: THREE.InstancedMesh;
    rightArmInst: THREE.InstancedMesh;
    leftLegInst: THREE.InstancedMesh;
    rightLegInst: THREE.InstancedMesh;
    vestInst: THREE.InstancedMesh;
    skirtInst: THREE.InstancedMesh;
    hatLadyInst: THREE.InstancedMesh;
    hatGentInst: THREE.InstancedMesh;
    hatCrewInst: THREE.InstancedMesh;
    ladyIndices: number[];
    gentIndices: number[];
    crewIndices: number[];
  }

  interface ActorSeedSpec {
    kind: CrowdKind;
    startX: number;
    startY: number;
    startZ: number;
    endX: number;
    endY: number;
    endZ: number;
    musterX: number;
    musterY: number;
    musterZ: number;
    isWalker: boolean;
    facingYaw?: number;
  }

  const fwdSeeds: ActorSeedSpec[] = [];
  const aftSeeds: ActorSeedSpec[] = [];

  const pickKind = (crewWeight: number): CrowdKind => {
    const r = rand();
    if (r < crewWeight) return 'crew';
    return r < crewWeight + (1 - crewWeight) * 0.52 ? 'gentleman' : 'lady';
  };

  // --- Forward Boat Deck Wings & Sun Courtyards (250 characters, z = 3..88) ---
  for (let i = 0; i < 250; i++) {
    const side: -1 | 1 = i % 2 === 0 ? 1 : -1;
    const isCourtyard = i % 5 === 0;
    const kind = pickKind(0.16);
    if (isCourtyard) {
      const band = i % 3;
      const czMin = band === 0 ? 21.5 : band === 1 ? 52.5 : 82.5;
      const czMax = band === 0 ? 26.8 : band === 1 ? 62.5 : 87.5;
      const x0 = THREE.MathUtils.lerp(-10.8, 10.8, rand());
      const z0 = THREE.MathUtils.lerp(czMin, czMax, rand());
      const x1 = THREE.MathUtils.clamp(x0 + (rand() - 0.5) * 8, -11.0, 11.0);
      const z1 = THREE.MathUtils.lerp(czMin, czMax, rand());
      const mSide: -1 | 1 = x0 >= 0 ? 1 : -1;
      const boatZ = [8.5, 18.2, 27.9, 37.6][i % 4];
      fwdSeeds.push({
        kind,
        startX: x0,
        startY: 12.88,
        startZ: z0,
        endX: x1,
        endY: 12.88,
        endZ: z1,
        musterX: mSide * (10.5 + rand() * 1.1),
        musterY: 12.88,
        musterZ: boatZ + (rand() - 0.5) * 4.4,
        isWalker: rand() < 0.52,
        facingYaw: rand() * Math.PI * 2,
      });
    } else {
      const laneX = side * (7.6 + rand() * 3.5);
      const z0 = THREE.MathUtils.lerp(4.0, 86.5, rand());
      const span = THREE.MathUtils.lerp(12, 34, rand()) * (rand() < 0.5 ? 1 : -1);
      const z1 = THREE.MathUtils.clamp(z0 + span, 3.0, 87.5);
      const boatZ = [8.5, 18.2, 27.9, 37.6][i % 4];
      fwdSeeds.push({
        kind,
        startX: laneX,
        startY: 12.88,
        startZ: z0,
        endX: side * (7.6 + rand() * 3.5),
        endY: 12.88,
        endZ: z1,
        musterX: side * (10.4 + rand() * 1.2),
        musterY: 12.88,
        musterZ: boatZ + (rand() - 0.5) * 4.4,
        isWalker: rand() < 0.68,
        facingYaw: side > 0 ? -Math.PI / 2 : Math.PI / 2,
      });
    }
  }

  // --- Forward A-Deck Covered Promenade Port & Starboard (134 characters, z = -7..87) ---
  for (let i = 0; i < 134; i++) {
    const side: -1 | 1 = i % 2 === 0 ? 1 : -1;
    const kind = pickKind(0.12);
    const x0 = side * (11.95 + rand() * 0.9);
    const z0 = THREE.MathUtils.lerp(-6.5, 86.5, rand());
    const z1 = THREE.MathUtils.clamp(z0 + (rand() < 0.5 ? 1 : -1) * (14 + rand() * 26), -6.5, 87.0);
    fwdSeeds.push({
      kind,
      startX: x0,
      startY: 9.86,
      startZ: z0,
      endX: side * (11.95 + rand() * 0.9),
      endY: 9.86,
      endZ: z1,
      musterX: side * (12.1 + rand() * 0.8),
      musterY: 9.86,
      musterZ: THREE.MathUtils.lerp(6, 44, rand()),
      isWalker: rand() < 0.65,
      facingYaw: side > 0 ? -Math.PI / 2 : Math.PI / 2,
    });
  }

  // --- Forward Well Deck 3rd-Class Passengers & Crew (134 characters, z = -33.5..-11) ---
  for (let i = 0; i < 134; i++) {
    const side: -1 | 1 = i % 2 === 0 ? 1 : -1;
    const kind = pickKind(0.24);
    const isCrossAisle = i % 4 === 0;
    const x0 = isCrossAisle ? THREE.MathUtils.lerp(-9.5, 9.5, rand()) : side * (4.4 + rand() * 5.8);
    const z0 = isCrossAisle
      ? i % 8 === 0
        ? THREE.MathUtils.lerp(-33.5, -31.8, rand())
        : THREE.MathUtils.lerp(-24.8, -21.8, rand())
      : THREE.MathUtils.lerp(-33.2, -11.4, rand());
    const x1 = isCrossAisle ? THREE.MathUtils.clamp(x0 + (rand() - 0.5) * 8, -9.8, 9.8) : side * (4.4 + rand() * 5.6);
    const z1 = isCrossAisle ? z0 : THREE.MathUtils.clamp(z0 + (rand() - 0.5) * 14, -33.2, -11.4);
    const mSide: -1 | 1 = x0 >= 0 ? 1 : -1;
    fwdSeeds.push({
      kind,
      startX: x0,
      startY: 6.62,
      startZ: z0,
      endX: x1,
      endY: 6.62,
      endZ: z1,
      musterX: mSide * (11.8 + rand() * 0.9),
      musterY: 9.86,
      musterZ: THREE.MathUtils.lerp(-4, 24, rand()),
      isWalker: rand() < 0.58,
      facingYaw: rand() * Math.PI * 2,
    });
  }

  // --- Forecastle Deck Crew & Sightseers (68 characters, z = -66..-36) ---
  for (let i = 0; i < 68; i++) {
    const kind = pickKind(0.45);
    const z0 = THREE.MathUtils.lerp(-64.5, -37.0, rand());
    const t0 = THREE.MathUtils.clamp((z0 + 68) / 33, 0, 1);
    const maxW0 = THREE.MathUtils.lerp(1.9, 9.2, t0);
    let x0 = (rand() * 2 - 1) * maxW0;
    if (Math.abs(z0 + 55) < 2.2 && Math.abs(Math.abs(x0) - 3.4) < 1.3) {
      x0 = Math.sign(x0 || 1) * 5.5;
    }
    const z1 = THREE.MathUtils.clamp(z0 + (rand() - 0.5) * 10, -64.5, -37.0);
    const t1 = THREE.MathUtils.clamp((z1 + 68) / 33, 0, 1);
    const maxW1 = THREE.MathUtils.lerp(1.9, 9.2, t1);
    const x1 = (rand() * 2 - 1) * maxW1;
    fwdSeeds.push({
      kind,
      startX: x0,
      startY: 9.2,
      startZ: z0,
      endX: x1,
      endY: 9.2,
      endZ: z1,
      musterX: (x0 >= 0 ? 1 : -1) * (8.2 + rand() * 2.4),
      musterY: 9.2,
      musterZ: THREE.MathUtils.lerp(-44, -37, rand()),
      isWalker: rand() < 0.5,
      facingYaw: rand() * Math.PI * 2,
    });
  }

  // --- Aft Boat Deck & Sun Courtyards (136 characters, z = 92..147) ---
  for (let i = 0; i < 136; i++) {
    const side: -1 | 1 = i % 2 === 0 ? 1 : -1;
    const isCourtyard = i % 4 === 0;
    const kind = pickKind(0.15);
    const boatZ = [102.0, 111.7, 121.4, 131.1][i % 4];
    if (isCourtyard) {
      const zMin = i % 8 === 0 ? 113.5 : 131.5;
      const zMax = i % 8 === 0 ? 117.5 : 134.8;
      const x0 = THREE.MathUtils.lerp(-10.5, 10.5, rand());
      const z0 = THREE.MathUtils.lerp(zMin, zMax, rand());
      aftSeeds.push({
        kind,
        startX: x0,
        startY: 12.88,
        startZ: z0,
        endX: THREE.MathUtils.clamp(x0 + (rand() - 0.5) * 7, -10.8, 10.8),
        endY: 12.88,
        endZ: THREE.MathUtils.lerp(zMin, zMax, rand()),
        musterX: (x0 >= 0 ? 1 : -1) * (10.5 + rand() * 1.1),
        musterY: 12.88,
        musterZ: boatZ + (rand() - 0.5) * 4.2,
        isWalker: rand() < 0.55,
        facingYaw: rand() * Math.PI * 2,
      });
    } else {
      const z0 = THREE.MathUtils.lerp(93.0, 145.0, rand());
      const z1 = THREE.MathUtils.clamp(z0 + (rand() < 0.5 ? 1 : -1) * (10 + rand() * 24), 93.0, 145.5);
      aftSeeds.push({
        kind,
        startX: side * (7.3 + rand() * 3.8),
        startY: 12.88,
        startZ: z0,
        endX: side * (7.3 + rand() * 3.8),
        endY: 12.88,
        endZ: z1,
        musterX: side * (10.4 + rand() * 1.2),
        musterY: 12.88,
        musterZ: boatZ + (rand() - 0.5) * 4.2,
        isWalker: rand() < 0.66,
        facingYaw: side > 0 ? -Math.PI / 2 : Math.PI / 2,
      });
    }
  }

  // --- Aft A-Deck Promenade (90 characters, z = 92..145) ---
  for (let i = 0; i < 90; i++) {
    const side: -1 | 1 = i % 2 === 0 ? 1 : -1;
    const kind = pickKind(0.12);
    const z0 = THREE.MathUtils.lerp(92.5, 144.0, rand());
    const z1 = THREE.MathUtils.clamp(z0 + (rand() < 0.5 ? 1 : -1) * (10 + rand() * 22), 92.5, 144.5);
    aftSeeds.push({
      kind,
      startX: side * (11.95 + rand() * 0.85),
      startY: 9.86,
      startZ: z0,
      endX: side * (11.95 + rand() * 0.85),
      endY: 9.86,
      endZ: z1,
      musterX: side * (12.1 + rand() * 0.8),
      musterY: 9.86,
      musterZ: THREE.MathUtils.lerp(100, 134, rand()),
      isWalker: rand() < 0.64,
      facingYaw: side > 0 ? -Math.PI / 2 : Math.PI / 2,
    });
  }

  // --- Aft Well Deck 3rd-Class Passengers & Crew (104 characters, z = 149..169) ---
  for (let i = 0; i < 104; i++) {
    const side: -1 | 1 = i % 2 === 0 ? 1 : -1;
    const kind = pickKind(0.22);
    const x0 = side * (4.3 + rand() * 5.4);
    const z0 = THREE.MathUtils.lerp(149.2, 168.5, rand());
    aftSeeds.push({
      kind,
      startX: x0,
      startY: 6.62,
      startZ: z0,
      endX: side * (4.3 + rand() * 5.2),
      endY: 6.62,
      endZ: THREE.MathUtils.clamp(z0 + (rand() - 0.5) * 12, 149.2, 168.5),
      musterX: side * (11.8 + rand() * 0.8),
      musterY: 9.86,
      musterZ: THREE.MathUtils.lerp(126, 143, rand()),
      isWalker: rand() < 0.56,
      facingYaw: rand() * Math.PI * 2,
    });
  }

  // --- Poop Deck Passengers & Watchmen (70 characters, z = 171..191) ---
  for (let i = 0; i < 70; i++) {
    const kind = pickKind(0.18);
    const z0 = THREE.MathUtils.lerp(174.5, 190.5, rand());
    const t0 = THREE.MathUtils.clamp((193 - z0) / 19, 0, 1);
    const maxW0 = THREE.MathUtils.lerp(2.4, 8.6, t0);
    const x0 = (rand() * 2 - 1) * maxW0;
    const z1 = THREE.MathUtils.clamp(z0 + (rand() - 0.5) * 9, 174.5, 190.5);
    const t1 = THREE.MathUtils.clamp((193 - z1) / 19, 0, 1);
    const maxW1 = THREE.MathUtils.lerp(2.4, 8.6, t1);
    const x1 = (rand() * 2 - 1) * maxW1;
    aftSeeds.push({
      kind,
      startX: x0,
      startY: 8.4,
      startZ: z0,
      endX: x1,
      endY: 8.4,
      endZ: z1,
      musterX: (x0 >= 0 ? 1 : -1) * (4.0 + rand() * 3.6),
      musterY: 8.4,
      musterZ: THREE.MathUtils.lerp(174.5, 184.0, rand()),
      isWalker: rand() < 0.52,
      facingYaw: rand() * Math.PI * 2,
    });
  }

  const createHalfCrowdBatch = (
    halfContent: THREE.Group,
    seeds: ActorSeedSpec[],
  ): HalfCrowdBatch => {
    const n = seeds.length;
    const actors: CrowdActor[] = [];
    const ladyIndices: number[] = [];
    const gentIndices: number[] = [];
    const crewIndices: number[] = [];

    for (let i = 0; i < n; i++) {
      const s = seeds[i];
      let roleIdx = 0;
      if (s.kind === 'lady') {
        roleIdx = ladyIndices.length;
        ladyIndices.push(i);
      } else if (s.kind === 'gentleman') {
        roleIdx = gentIndices.length;
        gentIndices.push(i);
      } else {
        roleIdx = crewIndices.length;
        crewIndices.push(i);
      }
      const dx = s.endX - s.startX;
      const dz = s.endZ - s.startZ;
      const initialYaw = s.isWalker && Math.hypot(dx, dz) > 0.2 ? Math.atan2(-dx, -dz) : s.facingYaw ?? 0;

      actors.push({
        kind: s.kind,
        allIdx: i,
        roleIdx,
        startX: s.startX,
        startY: s.startY,
        startZ: s.startZ,
        endX: s.endX,
        endY: s.endY,
        endZ: s.endZ,
        musterX: s.musterX,
        musterY: s.musterY,
        musterZ: s.musterZ,
        posX: s.startX,
        posY: s.startY,
        posZ: s.startZ,
        rotY: initialYaw,
        baseRotY: initialYaw,
        goingForward: true,
        isWalker: s.isWalker,
        pauseTimer: rand() * 1.8,
        walkSpeed: s.kind === 'crew' ? 1.45 + rand() * 0.28 : 1.15 + rand() * 0.34,
        runSpeed: 3.55 + rand() * 0.95,
        strideCycle: rand() * Math.PI * 2,
        phase: rand() * Math.PI * 2,
        scaleH: 0.92 + rand() * 0.14,
        scaleW: s.kind === 'lady' ? 0.88 + rand() * 0.1 : 0.94 + rand() * 0.12,
      });
    }

    const makeInst = (geo: THREE.BufferGeometry, mat: THREE.Material, count: number) => {
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      halfContent.add(mesh);
      return mesh;
    };

    const torsoInst = makeInst(instTorsoGeo, instClothMat, n);
    const headInst = makeInst(instHeadSkinGeo, instSkinMat, n);
    const hairInst = makeInst(instHairGeo, instHairMat, n);
    const leftArmInst = makeInst(instArmGeo, instClothMat, n);
    const rightArmInst = makeInst(instArmGeo, instClothMat, n);
    const leftLegInst = makeInst(instLegGeo, instClothMat, n);
    const rightLegInst = makeInst(instLegGeo, instClothMat, n);
    const vestInst = makeInst(instVestGeo, lifejacketMat, n);

    const skirtInst = makeInst(instSkirtGeo, instClothMat, ladyIndices.length);
    const hatLadyInst = makeInst(instHatLadyGeo, instClothMat, ladyIndices.length);
    const hatGentInst = makeInst(instHatGentGeo, instClothMat, gentIndices.length);
    const hatCrewInst = makeInst(instHatCrewGeo, instClothMat, crewIndices.length);

    const tmpColor = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const actor = actors[i];
      const skinHex = skinPalette[Math.floor(rand() * skinPalette.length)];
      const hairHex = hairPalette[Math.floor(rand() * hairPalette.length)];
      let coatHex = 0x131d2f;
      let trouserHex = 0x0f1624;
      let hatHex = 0x131d2f;

      if (actor.kind === 'gentleman') {
        coatHex = gentCoatPalette[Math.floor(rand() * gentCoatPalette.length)];
        trouserHex = trouserPalette[Math.floor(rand() * trouserPalette.length)];
        hatHex = coatHex;
      } else if (actor.kind === 'lady') {
        coatHex = ladyDressPalette[Math.floor(rand() * ladyDressPalette.length)];
        trouserHex = coatHex;
        hatHex = coatHex;
      } else {
        // Crew: Navy officers, stewards in white jackets, or seamen in dark sweaters
        const isSteward = i % 3 === 0;
        coatHex = isSteward ? 0xdcd7cb : 0x152033;
        trouserHex = 0x0e1522;
        hatHex = i % 5 === 0 ? 0xf0ece0 : 0x141d2c;
      }

      tmpColor.setHex(coatHex);
      torsoInst.setColorAt(i, tmpColor);
      leftArmInst.setColorAt(i, tmpColor);
      rightArmInst.setColorAt(i, tmpColor);

      tmpColor.setHex(trouserHex);
      leftLegInst.setColorAt(i, tmpColor);
      rightLegInst.setColorAt(i, tmpColor);

      tmpColor.setHex(skinHex);
      headInst.setColorAt(i, tmpColor);

      tmpColor.setHex(hairHex);
      hairInst.setColorAt(i, tmpColor);

      tmpColor.setHex(hatHex);
      if (actor.kind === 'lady') {
        tmpColor.setHex(coatHex);
        skirtInst.setColorAt(actor.roleIdx, tmpColor);
        hatLadyInst.setColorAt(actor.roleIdx, tmpColor);
      } else if (actor.kind === 'gentleman') {
        hatGentInst.setColorAt(actor.roleIdx, tmpColor);
      } else {
        hatCrewInst.setColorAt(actor.roleIdx, tmpColor);
      }
    }

    for (const inst of [
      torsoInst,
      headInst,
      hairInst,
      leftArmInst,
      rightArmInst,
      leftLegInst,
      rightLegInst,
      skirtInst,
      hatLadyInst,
      hatGentInst,
      hatCrewInst,
    ]) {
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    }

    return {
      halfContent,
      actors,
      torsoInst,
      headInst,
      hairInst,
      leftArmInst,
      rightArmInst,
      leftLegInst,
      rightLegInst,
      vestInst,
      skirtInst,
      hatLadyInst,
      hatGentInst,
      hatCrewInst,
      ladyIndices,
      gentIndices,
      crewIndices,
    };
  };

  const fwdBatch = createHalfCrowdBatch(bowContent, fwdSeeds);
  const aftBatch = createHalfCrowdBatch(sternContent, aftSeeds);
  const batches = [fwdBatch, aftBatch];

  const writeActorMatrices = (
    batch: HalfCrowdBatch,
    a: CrowdActor,
    moving: boolean,
    isRunning: boolean,
    showVest: boolean,
    time: number,
    checkSubmerged: boolean,
  ) => {
    if (checkSubmerged) {
      _tmpWorldPos.set(a.posX, a.posY, a.posZ).applyMatrix4(batch.halfContent.matrixWorld);
      if (_tmpWorldPos.y < -0.95) {
        const idx = a.allIdx;
        batch.torsoInst.setMatrixAt(idx, _zeroMat);
        batch.headInst.setMatrixAt(idx, _zeroMat);
        batch.hairInst.setMatrixAt(idx, _zeroMat);
        batch.leftArmInst.setMatrixAt(idx, _zeroMat);
        batch.rightArmInst.setMatrixAt(idx, _zeroMat);
        batch.leftLegInst.setMatrixAt(idx, _zeroMat);
        batch.rightLegInst.setMatrixAt(idx, _zeroMat);
        batch.vestInst.setMatrixAt(idx, _zeroMat);
        if (a.kind === 'lady') {
          batch.skirtInst.setMatrixAt(a.roleIdx, _zeroMat);
          batch.hatLadyInst.setMatrixAt(a.roleIdx, _zeroMat);
        } else if (a.kind === 'gentleman') {
          batch.hatGentInst.setMatrixAt(a.roleIdx, _zeroMat);
        } else {
          batch.hatCrewInst.setMatrixAt(a.roleIdx, _zeroMat);
        }
        return;
      }
    }

    const c = a.strideCycle;
    const strideAmp = moving ? (isRunning ? 0.72 : 0.4) : 0;
    const armAmp = moving ? (isRunning ? 0.85 : 0.34) : 0;
    const bob = moving
      ? Math.abs(Math.sin(c)) * (isRunning ? 0.07 : 0.025) - (isRunning ? 0.035 : 0)
      : Math.sin(time * 1.6 + a.phase) * 0.006;

    const torsoPitch = moving ? (isRunning ? -0.22 : -0.05) : 0;
    const torsoYaw = moving
      ? Math.sin(c) * (isRunning ? 0.12 : 0.05)
      : Math.sin(time * 0.65 + a.phase) * 0.05;
    const headYaw = moving
      ? Math.sin(time * (isRunning ? 4.2 : 0.9) + a.phase) * 0.14
      : Math.sin(time * 0.95 + a.phase * 1.3) * 0.32;

    const swingL = moving ? Math.sin(c) * strideAmp : 0;
    const swingR = -swingL;

    // 1. Pelvis matrix in halfContent space
    _euler.set(0, a.rotY, 0);
    _qRot.setFromEuler(_euler);
    _pelvisMat.compose(
      _vPos.set(a.posX, a.posY + (0.85 + bob) * a.scaleH, a.posZ),
      _qRot,
      _vScale.set(a.scaleW, a.scaleH, a.scaleW),
    );

    // Legs
    _euler.set(swingL, 0, 0);
    _qRot.setFromEuler(_euler);
    _localMat.compose(_vPos.set(-0.095, -0.04, 0), _qRot, _vScale.set(1, 1, 1));
    _partMat.multiplyMatrices(_pelvisMat, _localMat);
    batch.leftLegInst.setMatrixAt(a.allIdx, _partMat);

    _euler.set(swingR, 0, 0);
    _qRot.setFromEuler(_euler);
    _localMat.compose(_vPos.set(0.095, -0.04, 0), _qRot, _vScale.set(1, 1, 1));
    _partMat.multiplyMatrices(_pelvisMat, _localMat);
    batch.rightLegInst.setMatrixAt(a.allIdx, _partMat);

    if (a.kind === 'lady') {
      _euler.set(moving ? Math.sin(c) * (isRunning ? 0.14 : 0.07) : 0, 0, 0);
      _qRot.setFromEuler(_euler);
      _localMat.compose(_vPos.set(0, 0, 0), _qRot, _vScale.set(1, 1, 1));
      _partMat.multiplyMatrices(_pelvisMat, _localMat);
      batch.skirtInst.setMatrixAt(a.roleIdx, _partMat);
    }

    // 2. Torso matrix
    _euler.set(torsoPitch, torsoYaw, 0);
    _qRot.setFromEuler(_euler);
    _localMat.compose(
      _vPos.set(0, 0, 0),
      _qRot,
      _vScale.set(a.kind === 'lady' ? 0.9 : 1, 1, a.kind === 'lady' ? 0.92 : 1),
    );
    _torsoMat.multiplyMatrices(_pelvisMat, _localMat);
    batch.torsoInst.setMatrixAt(a.allIdx, _torsoMat);

    if (showVest) {
      batch.vestInst.setMatrixAt(a.allIdx, _torsoMat);
    } else {
      batch.vestInst.setMatrixAt(a.allIdx, _zeroMat);
    }

    // Arms
    const armX = a.kind === 'lady' ? 0.17 : 0.205;
    _euler.set(moving ? swingR * armAmp : Math.sin(time * 0.9 + a.phase) * 0.04, 0, 0.09);
    _qRot.setFromEuler(_euler);
    _localMat.compose(_vPos.set(-armX, 0.41, 0), _qRot, _vScale.set(1, 1, 1));
    _partMat.multiplyMatrices(_torsoMat, _localMat);
    batch.leftArmInst.setMatrixAt(a.allIdx, _partMat);

    _euler.set(moving ? swingL * armAmp : -Math.sin(time * 0.9 + a.phase) * 0.04, 0, -0.09);
    _qRot.setFromEuler(_euler);
    _localMat.compose(_vPos.set(armX, 0.41, 0), _qRot, _vScale.set(1, 1, 1));
    _partMat.multiplyMatrices(_torsoMat, _localMat);
    batch.rightArmInst.setMatrixAt(a.allIdx, _partMat);

    // 3. Head matrix
    _euler.set(0, headYaw, 0);
    _qRot.setFromEuler(_euler);
    _localMat.compose(_vPos.set(0, 0.57, 0), _qRot, _vScale.set(1, 1, 1));
    _headMat.multiplyMatrices(_torsoMat, _localMat);

    batch.headInst.setMatrixAt(a.allIdx, _headMat);
    batch.hairInst.setMatrixAt(a.allIdx, _headMat);

    if (a.kind === 'lady') {
      batch.hatLadyInst.setMatrixAt(a.roleIdx, _headMat);
    } else if (a.kind === 'gentleman') {
      batch.hatGentInst.setMatrixAt(a.roleIdx, _headMat);
    } else {
      batch.hatCrewInst.setMatrixAt(a.roleIdx, _headMat);
    }
  };

  const stepCrowdBatch = (
    batch: HalfCrowdBatch,
    dt: number,
    time: number,
    showVest: boolean,
    emergencyRun: boolean,
    checkSubmerged: boolean,
  ) => {
    const actors = batch.actors;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      let moving = false;

      if (emergencyRun) {
        const dx = a.musterX - a.posX;
        const dz = a.musterZ - a.posZ;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.35) {
          moving = true;
          const step = Math.min(dist, a.runSpeed * dt);
          const dirX = dx / dist;
          const dirZ = dz / dist;
          a.posX += dirX * step;
          a.posZ += dirZ * step;
          a.posY = THREE.MathUtils.damp(a.posY, a.musterY, 5, dt);
          const desiredYaw = Math.atan2(-dirX, -dirZ);
          let dy = desiredYaw - a.rotY;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          a.rotY += dy * Math.min(1, dt * 6);
          a.strideCycle += a.runSpeed * dt * 2.65;
        }
      } else if (a.isWalker) {
        const tx = a.goingForward ? a.endX : a.startX;
        const ty = a.goingForward ? a.endY : a.startY;
        const tz = a.goingForward ? a.endZ : a.startZ;
        const dx = tx - a.posX;
        const dz = tz - a.posZ;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.35) {
          if (a.pauseTimer <= 0) a.pauseTimer = 1.4 + (i % 3) * 0.6;
          a.pauseTimer -= dt;
          if (a.pauseTimer <= 0) a.goingForward = !a.goingForward;
        } else {
          moving = true;
          const step = Math.min(dist, a.walkSpeed * dt);
          const dirX = dx / dist;
          const dirZ = dz / dist;
          a.posX += dirX * step;
          a.posZ += dirZ * step;
          a.posY = THREE.MathUtils.damp(a.posY, ty, 5, dt);
          const desiredYaw = Math.atan2(-dirX, -dirZ);
          let dy = desiredYaw - a.rotY;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          a.rotY += dy * Math.min(1, dt * 6);
          a.strideCycle += a.walkSpeed * dt * 3.1;
        }
      }

      writeActorMatrices(batch, a, moving, emergencyRun && moving, showVest, time, checkSubmerged);
    }

    batch.torsoInst.instanceMatrix.needsUpdate = true;
    batch.headInst.instanceMatrix.needsUpdate = true;
    batch.hairInst.instanceMatrix.needsUpdate = true;
    batch.leftArmInst.instanceMatrix.needsUpdate = true;
    batch.rightArmInst.instanceMatrix.needsUpdate = true;
    batch.leftLegInst.instanceMatrix.needsUpdate = true;
    batch.rightLegInst.instanceMatrix.needsUpdate = true;
    batch.vestInst.instanceMatrix.needsUpdate = true;
    batch.skirtInst.instanceMatrix.needsUpdate = true;
    batch.hatLadyInst.instanceMatrix.needsUpdate = true;
    batch.hatGentInst.instanceMatrix.needsUpdate = true;
    batch.hatCrewInst.instanceMatrix.needsUpdate = true;
  };

  // Populate initial frame-0 poses for all 986 instanced characters
  for (const batch of batches) {
    stepCrowdBatch(batch, 0, 0, false, false, false);
  }

  // =========================================================================
  // 3. 16 MAIN LIFEBOATS (8 PORT, 8 STARBOARD) ON WELIN QUADRANT DAVITS
  // =========================================================================
  const lifeboats: LifeboatRig[] = [];
  const boatHullGeo = trackGeo(buildRealisticLifeboatHullGeo());
  const boatGunwaleGeo = trackGeo(new THREE.TorusGeometry(0.92, 0.052, 6, 20));
  boatGunwaleGeo.scale(1.0, 3.25, 1.0);
  boatGunwaleGeo.rotateX(Math.PI / 2);

  const thwartGeo = trackGeo(new THREE.BoxGeometry(1.32, 0.06, 0.28));
  const keelGeo = trackGeo(new THREE.BoxGeometry(0.1, 0.12, 6.2));
  const oarShaftGeo = trackGeo(new THREE.CylinderGeometry(0.022, 0.024, 2.8, 6));
  const oarBladeGeo = trackGeo(new THREE.BoxGeometry(0.11, 0.52, 0.02));
  const pulleyGeo = trackGeo(new THREE.CylinderGeometry(0.14, 0.14, 0.08, 10));
  pulleyGeo.rotateZ(Math.PI / 2);

  const makeWelinDavitGeo = (side: -1 | 1) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(side * 0.1, 1.0, 0),
      new THREE.Vector3(side * 0.36, 1.9, 0),
      new THREE.Vector3(side * 0.85, 2.32, 0),
      new THREE.Vector3(side * 1.18, 2.2, 0),
    ]);
    return trackGeo(new THREE.TubeGeometry(curve, 12, 0.09, 8, false));
  };
  const davitGeoPort = makeWelinDavitGeo(-1);
  const davitGeoStbd = makeWelinDavitGeo(1);

  const ropeGeo = trackGeo(new THREE.CylinderGeometry(0.026, 0.026, 1.0, 6));
  const lanternGeo = trackGeo(new THREE.SphereGeometry(0.13, 8, 8));

  const boatZStations = [8.5, 18.2, 27.9, 37.6, 102.0, 111.7, 121.4, 131.1];

  for (const side of [-1, 1] as const) {
    for (let b = 0; b < boatZStations.length; b++) {
      const bz = boatZStations[b];
      const homeParent = bz < breakZ ? bowContent : sternContent;

      const makeDavitArm = (dz: number) => {
        const arm = new THREE.Group();
        arm.position.set(side * 12.15, 12.84, bz + dz);
        const swanNeck = new THREE.Mesh(side < 0 ? davitGeoPort : davitGeoStbd, whitePaintMat);
        swanNeck.castShadow = true;
        arm.add(swanNeck);
        const block = new THREE.Mesh(pulleyGeo, officerNavyMat);
        block.position.set(side * 1.16, 2.12, 0);
        arm.add(block);
        homeParent.add(arm);
        return arm;
      };
      const davitForeArm = makeDavitArm(-2.65);
      const davitAftArm = makeDavitArm(2.65);

      // Boat Deck Keel Chock Cradles supporting each stowed lifeboat flush on deck (y = 12.86..13.52)
      for (const cz of [-1.75, 1.75]) {
        const chock = new THREE.Mesh(thwartGeo, teakDeckMat);
        chock.scale.set(0.85, 9.5, 0.72);
        chock.position.set(side * 12.95, 13.15, bz + cz);
        homeParent.add(chock);
      }

      const ropeFore = new THREE.Mesh(ropeGeo, ropeMat);
      ropeFore.position.set(side * 13.15, 14.52, bz - 2.65);
      ropeFore.scale.set(1, 0.92, 1);
      homeParent.add(ropeFore);

      const ropeAft = new THREE.Mesh(ropeGeo, ropeMat);
      ropeAft.position.set(side * 13.15, 14.52, bz + 2.65);
      ropeAft.scale.set(1, 0.92, 1);
      homeParent.add(ropeAft);

      const boatGroup = new THREE.Group();
      boatGroup.position.set(side * 12.95, 13.85, bz);

      const hull = new THREE.Mesh(boatHullGeo, whitePaintMat);
      hull.castShadow = true;
      boatGroup.add(hull);

      const keel = new THREE.Mesh(keelGeo, teakDeckMat);
      keel.position.y = -0.44;
      boatGroup.add(keel);

      const gunwale = new THREE.Mesh(boatGunwaleGeo, teakDeckMat);
      gunwale.position.y = 0.4;
      boatGroup.add(gunwale);

      for (const tz of [-1.6, -0.55, 0.55, 1.6]) {
        const thw = new THREE.Mesh(thwartGeo, teakDeckMat);
        thw.position.set(0, 0.22, tz);
        thw.scale.x = Math.abs(tz) > 1.2 ? 0.7 : 1.0;
        boatGroup.add(thw);
      }

      const occupantsGroup = new THREE.Group();
      occupantsGroup.visible = false;
      for (let oi = -2; oi <= 2; oi++) {
        const seatX = oi % 2 === 0 ? 0.22 : -0.22;
        const seatZ = oi * 0.92;
        const occMat = oi === 0 ? officerNavyMat : gentlemanCoatMats[(b + oi + 6) % gentlemanCoatMats.length];

        const torso = new THREE.Mesh(coatTorsoGeo, occMat);
        torso.scale.set(0.86, 0.86, 0.86);
        torso.position.set(seatX, 0.42, seatZ);
        occupantsGroup.add(torso);

        for (const zOff of [-0.12, 0.12]) {
          for (const rx of [-0.07, 0, 0.07]) {
            const rib = new THREE.Mesh(corkRibGeo, lifejacketMat);
            rib.scale.setScalar(0.84);
            rib.position.set(seatX + rx, 0.58, seatZ + zOff);
            occupantsGroup.add(rib);
          }
        }

        const hd = new THREE.Mesh(craniumGeo, skinTones[(b + oi + 5) % skinTones.length]);
        hd.position.set(seatX, 0.94, seatZ);
        occupantsGroup.add(hd);
      }
      boatGroup.add(occupantsGroup);

      const oarsGroup = new THREE.Group();
      oarsGroup.visible = false;
      for (const oarSide of [-1, 1]) {
        for (const oz of [-0.95, 0.0, 0.95]) {
          const oarPivot = new THREE.Group();
          oarPivot.position.set(oarSide * 0.78, 0.42, oz);
          const shaft = new THREE.Mesh(oarShaftGeo, teakDeckMat);
          shaft.rotation.z = oarSide * 1.15;
          shaft.position.set(oarSide * 1.15, -0.4, 0);
          oarPivot.add(shaft);
          const blade = new THREE.Mesh(oarBladeGeo, teakDeckMat);
          blade.rotation.z = oarSide * 1.15;
          blade.position.set(oarSide * 2.45, -0.95, 0);
          oarPivot.add(blade);
          oarsGroup.add(oarPivot);
        }
      }
      boatGroup.add(oarsGroup);

      const lanternMesh = new THREE.Mesh(lanternGeo, boatLanternMat);
      lanternMesh.position.set(0, 0.74, -2.8);
      lanternMesh.visible = false;
      boatGroup.add(lanternMesh);

      homeParent.add(boatGroup);

      const isForwardBoat = bz < breakZ;
      lifeboats.push({
        side,
        index: b,
        baseZ: bz,
        lowerStart: isForwardBoat
          ? 0.02 + b * 0.036 + (side > 0 ? 0.01 : 0)
          : 0.07 + (b - 4) * 0.042 + (side > 0 ? 0.012 : 0),
        lowerDuration: isForwardBoat ? 0.22 : 0.24,
        homeParent,
        davitForeArm,
        davitAftArm,
        ropeFore,
        ropeAft,
        boatGroup,
        occupantsGroup,
        oarsGroup,
        lanternMesh,
        detached: false,
        rescued: false,
        splashX: side * 17.5,
        splashZ: bz,
      });
    }
  }

  // =========================================================================
  // ARTICULATED WALKING / RUNNING KINEMATICS FOR HERO CHARACTERS
  // =========================================================================
  const animateLimbGait = (ch: DeckCharacter, speedFactor: number, isRunning: boolean, time: number) => {
    if (speedFactor < 0.05) {
      ch.bodyRoot.position.y = 0.85 + Math.sin(time * 1.7 + ch.phase) * 0.008;
      ch.torsoGroup.rotation.x = THREE.MathUtils.damp(ch.torsoGroup.rotation.x, 0, 8, 0.03);
      ch.torsoGroup.rotation.y = Math.sin(time * 0.6 + ch.phase) * 0.04;
      ch.leftLegHip.rotation.x = THREE.MathUtils.damp(ch.leftLegHip.rotation.x, 0, 8, 0.03);
      ch.rightLegHip.rotation.x = THREE.MathUtils.damp(ch.rightLegHip.rotation.x, 0, 8, 0.03);
      ch.leftKnee.rotation.x = THREE.MathUtils.damp(ch.leftKnee.rotation.x, 0.04, 8, 0.03);
      ch.rightKnee.rotation.x = THREE.MathUtils.damp(ch.rightKnee.rotation.x, 0.04, 8, 0.03);

      if (ch.role === 'lookout') {
        ch.leftArmHip.rotation.set(1.15, 0, 0.25);
        ch.rightArmHip.rotation.set(1.15, 0, -0.25);
        ch.leftElbow.rotation.x = 1.4;
        ch.rightElbow.rotation.x = 1.4;
      } else {
        ch.leftArmHip.rotation.set(Math.sin(time * 0.8 + ch.phase) * 0.04, 0, 0.08);
        ch.rightArmHip.rotation.set(-Math.sin(time * 0.8 + ch.phase) * 0.04, 0, -0.08);
        ch.leftElbow.rotation.x = 0.14;
        ch.rightElbow.rotation.x = 0.14;
      }
      ch.headGroup.rotation.y = Math.sin(time * 0.95 + ch.phase * 1.4) * 0.28;
      return;
    }

    const c = ch.strideCycle;
    const strideAmp = isRunning ? 0.82 : 0.44;
    const armAmp = isRunning ? 0.95 : 0.38;
    const bobAmp = isRunning ? 0.075 : 0.028;

    ch.bodyRoot.position.y = 0.85 + Math.abs(Math.sin(c)) * bobAmp - (isRunning ? 0.04 : 0);
    ch.torsoGroup.rotation.x = isRunning ? -0.24 : -0.05;
    ch.torsoGroup.rotation.y = Math.sin(c) * (isRunning ? 0.14 : 0.06);

    const swingL = Math.sin(c) * strideAmp;
    const swingR = -swingL;
    ch.leftLegHip.rotation.x = swingL;
    ch.rightLegHip.rotation.x = swingR;

    ch.leftKnee.rotation.x = -Math.max(0.05, Math.cos(c) * (isRunning ? 1.15 : 0.58) + 0.15);
    ch.rightKnee.rotation.x = -Math.max(0.05, -Math.cos(c) * (isRunning ? 1.15 : 0.58) + 0.15);

    ch.leftArmHip.rotation.set(swingR * armAmp, 0, 0.09);
    ch.rightArmHip.rotation.set(swingL * armAmp, 0, -0.09);
    const elbowBend = isRunning ? 1.42 : 0.28;
    ch.leftElbow.rotation.x = elbowBend + Math.max(0, Math.sin(c)) * 0.25;
    ch.rightElbow.rotation.x = elbowBend + Math.max(0, -Math.sin(c)) * 0.25;

    if (ch.skirtMesh) {
      ch.skirtMesh.rotation.x = Math.sin(c) * (isRunning ? 0.16 : 0.08);
    }
    ch.headGroup.rotation.y = isRunning ? Math.sin(time * 4.5 + ch.phase) * 0.18 : Math.sin(time * 0.8 + ch.phase) * 0.12;
  };

  const stepCharacterMovement = (
    ch: DeckCharacter,
    dt: number,
    time: number,
    emergencyRun: boolean,
  ) => {
    if (ch.route.length <= 1 && !(emergencyRun && ch.musterTarget)) {
      animateLimbGait(ch, 0, false, time);
      return;
    }

    let target: DeckWaypoint;
    let isRunning = false;

    if (emergencyRun && ch.musterTarget) {
      target = ch.musterTarget;
      isRunning = true;
    } else {
      target = ch.route[ch.waypointIdx];
    }

    const dx = target.x - ch.posX;
    const dz = target.z - ch.posZ;
    const dist = Math.hypot(dx, dz);

    if (dist < 0.35) {
      if (emergencyRun && ch.musterTarget) {
        animateLimbGait(ch, 0, false, time);
        return;
      }
      if (ch.pauseTimer <= 0) {
        ch.pauseTimer = target.pauseSec ?? 1.5;
      }
      ch.pauseTimer -= dt;
      animateLimbGait(ch, 0, false, time);
      if (ch.pauseTimer <= 0) {
        ch.waypointIdx = (ch.waypointIdx + 1) % ch.route.length;
      }
      return;
    }

    const moveSpeed = isRunning ? ch.runSpeed : ch.walkSpeed;
    const step = Math.min(dist, moveSpeed * dt);
    const dirX = dx / dist;
    const dirZ = dz / dist;

    ch.posX += dirX * step;
    ch.posZ += dirZ * step;
    ch.posY = THREE.MathUtils.damp(ch.posY, target.y, 6, dt);
    ch.group.position.set(ch.posX, ch.posY, ch.posZ);

    const desiredYaw = Math.atan2(-dirX, -dirZ);
    let deltaYaw = desiredYaw - ch.group.rotation.y;
    while (deltaYaw > Math.PI) deltaYaw -= Math.PI * 2;
    while (deltaYaw < -Math.PI) deltaYaw += Math.PI * 2;
    ch.group.rotation.y += deltaYaw * Math.min(1, dt * 7);

    ch.strideCycle += moveSpeed * dt * (isRunning ? 2.65 : 3.2);
    animateLimbGait(ch, 1, isRunning, time);
  };

  const updateCruising = (time: number, dt: number, floodingPct: number) => {
    const showVests = floodingPct > 28;
    const emergencyRun = floodingPct > 38;
    for (const ch of characters) {
      ch.lifejacket.visible = showVests;
      stepCharacterMovement(ch, dt, time, emergencyRun);
    }
    for (const batch of batches) {
      stepCrowdBatch(batch, dt, time, showVests, emergencyRun, false);
    }
  };

  const updateSinking = (
    time: number,
    dt: number,
    sinkProgress: number,
    shipRoot: THREE.Group,
  ): number => {
    shipRoot.updateMatrixWorld(true);

    // 1. All 1,000 characters put on cork lifejackets & sprint to muster stations
    for (const ch of characters) {
      ch.lifejacket.visible = true;
      stepCharacterMovement(ch, dt, time, true);
      ch.group.getWorldPosition(_tmpWorldPos);
      ch.group.visible = _tmpWorldPos.y > -0.95;
    }
    for (const batch of batches) {
      stepCrowdBatch(batch, dt, time, true, true, true);
    }

    // 2. Animate 16 Sculpted Lifeboats swinging out, lowering on ropes & rowing clear
    let launchedCount = 0;

    for (const lb of lifeboats) {
      const localT = THREE.MathUtils.clamp((sinkProgress - lb.lowerStart) / lb.lowerDuration, 0, 1);
      if (localT <= 0.001) continue;

      lb.occupantsGroup.visible = true;
      lb.lanternMesh.visible = true;

      const swingT = THREE.MathUtils.clamp(localT / 0.22, 0, 1);
      lb.davitForeArm.rotation.z = -lb.side * swingT * 0.44;
      lb.davitAftArm.rotation.z = -lb.side * swingT * 0.44;

      const xOut = THREE.MathUtils.lerp(lb.side * 12.95, lb.side * 17.2, swingT);
      const boatWaterY = 0.38 + Math.sin(time * 1.4 + lb.index) * 0.14;

      lb.davitForeArm.getWorldPosition(_tmpWorldPos);
      shipRoot.worldToLocal(_tmpWorldPos);
      const davitTopWorldY = _tmpWorldPos.y + 2.13;

      const lowerT = THREE.MathUtils.clamp((localT - 0.18) / 0.64, 0, 1);
      const targetBoatWorldY = THREE.MathUtils.lerp(
        Math.max(boatWaterY, davitTopWorldY - 1.1),
        boatWaterY,
        lowerT,
      );

      const onWater = lowerT >= 0.96 || targetBoatWorldY <= boatWaterY + 0.18;

      if (onWater) {
        launchedCount++;
        if (!lb.detached) {
          lb.detached = true;
          lb.boatGroup.getWorldPosition(_tmpWorldPos);
          shipRoot.worldToLocal(_tmpWorldPos);
          lb.splashX = lb.side * Math.max(17.5, Math.abs(_tmpWorldPos.x));
          lb.splashZ = _tmpWorldPos.z;
          lb.homeParent.remove(lb.boatGroup);
          shipRoot.add(lb.boatGroup);
          lb.ropeFore.visible = false;
          lb.ropeAft.visible = false;
          lb.oarsGroup.visible = true;
        }
        const rowT = THREE.MathUtils.clamp((localT - 0.78) / 0.22, 0, 1);
        const extraDrift = Math.max(0, sinkProgress - (lb.lowerStart + lb.lowerDuration * 0.85)) * 46;
        lb.boatGroup.position.set(
          lb.splashX + lb.side * (rowT * 6.5 + extraDrift),
          boatWaterY,
          lb.splashZ + (lb.index - 3.5) * 1.6 * rowT,
        );
        lb.boatGroup.rotation.set(
          Math.sin(time * 1.5 + lb.index) * 0.04,
          lb.side * (0.25 + rowT * 0.45),
          Math.cos(time * 1.2 + lb.index) * 0.05,
        );
        const rowSweep = Math.sin(time * 2.8 + lb.index);
        for (let oi = 0; oi < lb.oarsGroup.children.length; oi++) {
          const oar = lb.oarsGroup.children[oi];
          oar.rotation.y = rowSweep * 0.35;
          oar.rotation.x = Math.cos(time * 2.8 + lb.index) * 0.16;
        }
      } else {
        const dropBelowDavit = Math.max(0, davitTopWorldY - targetBoatWorldY);
        const localY = Math.min(13.85, 14.95 - dropBelowDavit);
        lb.boatGroup.position.set(xOut, localY, lb.baseZ);

        const halfPivot = lb.homeParent.parent;
        const halfPitch = halfPivot ? halfPivot.rotation.x : 0;
        const roll = halfPivot?.parent ? halfPivot.parent.rotation.z : 0;
        lb.boatGroup.rotation.set(-halfPitch * 0.55, 0, -roll * 0.7);

        const ropeTop = 14.95;
        const ropeBot = lb.boatGroup.position.y + 0.4;
        const ropeLen = Math.max(0.2, ropeTop - ropeBot);
        const ropeMidY = (ropeTop + ropeBot) * 0.5;

        lb.ropeFore.visible = true;
        lb.ropeFore.position.set(xOut, ropeMidY, lb.baseZ - 2.65);
        lb.ropeFore.scale.set(1, ropeLen, 1);

        lb.ropeAft.visible = true;
        lb.ropeAft.position.set(xOut, ropeMidY, lb.baseZ + 2.65);
        lb.ropeAft.scale.set(1, ropeLen, 1);
      }
    }

    return launchedCount;
  };

  const updateRescue = (
    time: number,
    dt: number,
    stage: 'waiting' | 'approaching' | 'boarding' | 'complete',
    boardingProgress: number,
    carpathiaRoot: THREE.Group,
    boardingStationsLocal: Array<{ x: number; y: number; z: number; side: -1 | 1 }>,
    shipRoot: THREE.Group,
  ): RescueProgressResult => {
    shipRoot.updateMatrixWorld(true);
    carpathiaRoot.updateMatrixWorld(true);

    let boatsRecovered = 0;
    let fractionalSurvivors = 0;

    for (let i = 0; i < lifeboats.length; i++) {
      const lb = lifeboats[i];
      if (!lb.detached) {
        lb.detached = true;
        lb.homeParent.remove(lb.boatGroup);
        shipRoot.add(lb.boatGroup);
        lb.ropeFore.visible = false;
        lb.ropeAft.visible = false;
        lb.oarsGroup.visible = true;
        lb.lanternMesh.visible = true;
      }

      const waveIdx = Math.floor(i / 4);
      const slotIdx = i % boardingStationsLocal.length;
      const st = boardingStationsLocal[slotIdx];
      const boatWaterY = 0.38 + Math.sin(time * 1.4 + lb.index + i * 0.3) * 0.14;

      if (stage === 'waiting' || stage === 'approaching') {
        lb.occupantsGroup.visible = true;
        lb.rescued = false;
        // Gentle idle station-keeping bob over the sinking site
        const idleX = lb.boatGroup.position.x + Math.sin(time * 0.25 + i) * 0.12 * dt;
        const idleZ = lb.boatGroup.position.z + Math.cos(time * 0.2 + i) * 0.12 * dt;
        lb.boatGroup.position.set(idleX, boatWaterY, idleZ);
        lb.boatGroup.rotation.set(
          Math.sin(time * 1.3 + i) * 0.045,
          lb.side * 0.55 + Math.sin(time * 0.3 + i) * 0.08,
          Math.cos(time * 1.1 + i) * 0.055,
        );
        const sweep = Math.sin(time * 1.5 + i) * 0.18;
        for (let oi = 0; oi < lb.oarsGroup.children.length; oi++) {
          const oar = lb.oarsGroup.children[oi];
          oar.rotation.y = sweep;
          oar.rotation.x = Math.cos(time * 1.5 + i) * 0.08;
        }
        continue;
      }

      // Boarding or Complete: each lifeboat rows cleanly to its Carpathia gangway ladder, transfers survivors, then clears astern
      const tStart = waveIdx * 0.16;
      const tDock = tStart + 0.18;
      const tUnloadDone = tDock + 0.14;

      const isUnloaded = boardingProgress >= tUnloadDone;
      const isDocking = boardingProgress >= tStart;

      // Target coordinate in Carpathia local space -> world -> shipRoot local space
      const carpLocalX = isUnloaded
        ? st.side * (14.5 + waveIdx * 3.4)
        : st.x + st.side * (1.2 + (waveIdx % 2) * 0.35);
      const carpLocalZ = isUnloaded ? 44 + waveIdx * 10 + (slotIdx % 2) * 7 : st.z;

      _tmpWorldPos.set(carpLocalX, boatWaterY, carpLocalZ).applyMatrix4(carpathiaRoot.matrixWorld);
      shipRoot.worldToLocal(_tmpWorldPos);

      const dx = _tmpWorldPos.x - lb.boatGroup.position.x;
      const dz = _tmpWorldPos.z - lb.boatGroup.position.z;
      const dist = Math.hypot(dx, dz);
      const isMoving = isDocking && dist > 1.1;

      if (isMoving) {
        const speed = isUnloaded ? 3.8 : 6.4;
        const step = Math.min(dist, speed * dt);
        lb.boatGroup.position.x += (dx / dist) * step;
        lb.boatGroup.position.z += (dz / dist) * step;
        const targetYaw = Math.atan2(-dx, -dz);
        let dy = targetYaw - lb.boatGroup.rotation.y;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        lb.boatGroup.rotation.y += dy * Math.min(1, dt * 3.5);
      }

      lb.boatGroup.position.y = boatWaterY;
      lb.boatGroup.rotation.x = Math.sin(time * 1.4 + i) * 0.035;
      lb.boatGroup.rotation.z = Math.cos(time * 1.1 + i) * 0.04;

      const rowAmp = isMoving ? 0.38 : 0.06;
      const rowSweep = Math.sin(time * (isMoving ? 3.1 : 1.1) + i) * rowAmp;
      for (let oi = 0; oi < lb.oarsGroup.children.length; oi++) {
        const oar = lb.oarsGroup.children[oi];
        oar.rotation.y = rowSweep;
        oar.rotation.x = Math.cos(time * (isMoving ? 3.1 : 1.1) + i) * (isMoving ? 0.16 : 0.04);
      }

      // Transfer survivors as boat holds beside Carpathia's ladder
      const unloadProgress = THREE.MathUtils.clamp(
        (boardingProgress - tDock) / (tUnloadDone - tDock),
        0,
        1,
      );
      if (unloadProgress >= 0.85 || dist < 4.5 && boardingProgress >= tUnloadDone * 0.92) {
        lb.rescued = true;
      }
      if (lb.rescued) {
        boatsRecovered += 1;
        fractionalSurvivors += 1;
        lb.occupantsGroup.visible = false;
      } else {
        lb.occupantsGroup.visible = true;
        if (boardingProgress > tDock && dist < 8.5) {
          fractionalSurvivors += unloadProgress * 0.85;
        }
      }
    }

    const survivorsRescued = Math.min(712, Math.round((fractionalSurvivors / lifeboats.length) * 712));
    return { boatsRecovered, survivorsRescued };
  };

  const reset = () => {
    for (const ch of characters) {
      const start = ch.route[0];
      ch.posX = start.x;
      ch.posY = start.y;
      ch.posZ = start.z;
      ch.waypointIdx = ch.route.length > 1 ? 1 : 0;
      ch.pauseTimer = 0;
      ch.group.visible = true;
      ch.lifejacket.visible = false;
      ch.group.position.set(start.x, start.y, start.z);
      ch.group.rotation.y = ch.baseRotY;
    }

    for (const batch of batches) {
      for (const a of batch.actors) {
        a.posX = a.startX;
        a.posY = a.startY;
        a.posZ = a.startZ;
        a.rotY = a.baseRotY;
        a.goingForward = true;
        a.pauseTimer = 0;
      }
      stepCrowdBatch(batch, 0, 0, false, false, false);
    }

    for (const lb of lifeboats) {
      if (lb.detached) {
        lb.boatGroup.parent?.remove(lb.boatGroup);
        lb.homeParent.add(lb.boatGroup);
        lb.detached = false;
      }
      lb.rescued = false;
      lb.davitForeArm.rotation.set(0, 0, 0);
      lb.davitAftArm.rotation.set(0, 0, 0);
      lb.ropeFore.visible = true;
      lb.ropeFore.position.set(lb.side * 13.15, 14.52, lb.baseZ - 2.65);
      lb.ropeFore.scale.set(1, 0.92, 1);
      lb.ropeAft.visible = true;
      lb.ropeAft.position.set(lb.side * 13.15, 14.52, lb.baseZ + 2.65);
      lb.ropeAft.scale.set(1, 0.92, 1);
      lb.occupantsGroup.visible = false;
      lb.oarsGroup.visible = false;
      lb.lanternMesh.visible = false;
      lb.boatGroup.position.set(lb.side * 12.95, 13.85, lb.baseZ);
      lb.boatGroup.rotation.set(0, 0, 0);
    }
  };

  const setLanternPower = (power: number) => {
    boatLanternMat.emissiveIntensity = 0.6 + 1.4 * THREE.MathUtils.clamp(power, 0, 1);
  };

  const dispose = () => {
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
  };

  return {
    characters,
    totalCharacterCount: characters.length + fwdBatch.actors.length + aftBatch.actors.length,
    lifeboats,
    updateCruising,
    updateSinking,
    updateRescue,
    reset,
    setLanternPower,
    dispose,
  };
}
