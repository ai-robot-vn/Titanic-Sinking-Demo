import * as THREE from 'three';

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
  davitForeArm: THREE.Group;
  davitAftArm: THREE.Group;
  ropeFore: THREE.Mesh;
  ropeAft: THREE.Mesh;
  boatGroup: THREE.Group; // attached to hullMeshGroup while in davits, moved to shipRoot when waterborne
  occupantsGroup: THREE.Group;
  oarsGroup: THREE.Group;
  lanternMesh: THREE.Mesh;
  detached: boolean;
}

export interface CrewAndLifeboatSystem {
  characters: DeckCharacter[];
  lifeboats: LifeboatRig[];
  updateCruising: (time: number, dt: number, floodingPct: number) => void;
  updateSinking: (
    time: number,
    dt: number,
    sinkProgress: number,
    hullMeshGroup: THREE.Group,
    shipRoot: THREE.Group,
  ) => number;
  reset: (hullMeshGroup: THREE.Group) => void;
  setLanternPower: (power: number) => void;
  dispose: () => void;
}

/**
 * Builds a double-ended sculpted wooden whaleboat hull geometry (no capsule primitives).
 */
function buildRealisticLifeboatHullGeo(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const zStations = 14;
  const uStations = 11; // across keel-to-gunwale cross-section (-5 .. +5)
  const halfLen = 3.1; // ~9.1m (30 ft) Olympic-class wooden lifeboat scaled appropriately for 269m liner
  const maxHalfBeam = 0.94;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let zi = 0; zi <= zStations; zi++) {
    const t = zi / zStations; // 0 bow -> 1 stern
    const z = THREE.MathUtils.lerp(-halfLen, halfLen, t);
    const beamEnv = Math.pow(Math.sin(t * Math.PI), 0.68);
    const sheerRaise = Math.pow(Math.abs(t - 0.5) * 2, 2.2) * 0.28;

    for (let ui = 0; ui <= uStations; ui++) {
      const s = (ui / uStations) * 2 - 1; // -1 port gunwale, 0 keel, +1 stbd gunwale
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
  hullMeshGroup: THREE.Group,
  whitePaintMat: THREE.Material,
  teakDeckMat: THREE.Material,
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

  // =========================================================================
  // SCULPTED ANATOMICAL LATHE & EXTRUDED HUMAN GEOMETRIES (Zero Boxes/Cubes)
  // =========================================================================
  // Tailored double-breasted / Edwardian coat torso (origin at waist y=0 to collar y=0.52)
  const coatTorsoPts = [
    new THREE.Vector2(0.155, -0.18), // flared coat hem
    new THREE.Vector2(0.135, -0.02), // cinched waist
    new THREE.Vector2(0.168, 0.24), // ribcage
    new THREE.Vector2(0.19, 0.43), // broad shoulder line
    new THREE.Vector2(0.085, 0.51), // collar slope
    new THREE.Vector2(0.068, 0.56), // neck base
  ];
  const coatTorsoGeo = trackGeo(new THREE.LatheGeometry(coatTorsoPts, 14));
  coatTorsoGeo.scale(1.12, 1.0, 0.78); // oval human cross-section (wider side-to-side than front-to-back)

  // Fitted lady bodice
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

  // Flowing pleated Edwardian bell skirt (origin at waist y=0 downward to ankles y=-0.82)
  const skirtPts = [
    new THREE.Vector2(0.28, -0.82),
    new THREE.Vector2(0.25, -0.58),
    new THREE.Vector2(0.2, -0.32),
    new THREE.Vector2(0.145, -0.1),
    new THREE.Vector2(0.118, 0.02),
  ];
  const skirtGeo = trackGeo(new THREE.LatheGeometry(skirtPts, 16));
  skirtGeo.scale(1.05, 1.0, 0.92);

  // Upper Arm & Forearm (tapered organic sleeves pivoted at shoulder & elbow!)
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

  // Articulated Thigh & Calf/Shin (pivoted at hip & knee!)
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

  // Sculpted Leather Shoe / Boot (oriented forward toward -Z)
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
  bootGeo.rotateX(-Math.PI / 2); // +Y in shape becomes -Z (forward toe!)

  // Sculpted Head, Neck, Hair & Hats
  const neckGeo = trackGeo(new THREE.CylinderGeometry(0.054, 0.064, 0.11, 10));
  const craniumGeo = trackGeo(new THREE.SphereGeometry(0.105, 14, 12));
  craniumGeo.scale(0.92, 1.12, 1.0);
  const jawGeo = trackGeo(new THREE.SphereGeometry(0.078, 10, 10));
  jawGeo.scale(0.88, 0.9, 0.95);
  const noseGeo = trackGeo(new THREE.ConeGeometry(0.018, 0.045, 6));
  noseGeo.rotateX(-Math.PI / 2);
  const hairCapGeo = trackGeo(new THREE.SphereGeometry(0.11, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.58));
  hairCapGeo.scale(0.94, 1.08, 1.04);

  // Officer Peaked Cap Crown + Visor + Gold Cap Badge
  const capCrownPts = [
    new THREE.Vector2(0.106, 0.0),
    new THREE.Vector2(0.112, 0.04),
    new THREE.Vector2(0.135, 0.085),
    new THREE.Vector2(0.125, 0.105),
    new THREE.Vector2(0.0, 0.112),
  ];
  const officerCapCrownGeo = trackGeo(new THREE.LatheGeometry(capCrownPts, 14));
  const capVisorGeo = trackGeo(new THREE.CylinderGeometry(0.108, 0.115, 0.014, 12, 1, false, -Math.PI * 0.38, Math.PI * 0.76));
  const capBadgeGeo = trackGeo(new THREE.SphereGeometry(0.018, 6, 6));

  // Gentleman Bowler & Lady Wide-Brimmed Hat
  const bowlerCrownGeo = trackGeo(new THREE.SphereGeometry(0.112, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.54));
  const hatBrimPts = [
    new THREE.Vector2(0.105, 0.0),
    new THREE.Vector2(0.155, -0.01),
    new THREE.Vector2(0.165, 0.012),
  ];
  const gentBrimGeo = trackGeo(new THREE.LatheGeometry(hatBrimPts, 16));
  const ladyBrimPts = [
    new THREE.Vector2(0.105, 0.0),
    new THREE.Vector2(0.24, -0.025),
    new THREE.Vector2(0.26, -0.015),
  ];
  const ladyBrimGeo = trackGeo(new THREE.LatheGeometry(ladyBrimPts, 18));

  // Sculpted Collar V-Shirt & Brass Coat Buttons
  const collarGeo = trackGeo(new THREE.ConeGeometry(0.095, 0.14, 8));
  collarGeo.scale(1.0, 1.0, 0.45);
  const buttonGeo = trackGeo(new THREE.SphereGeometry(0.014, 6, 6));

  // Realistic Segmented Cork Lifejacket Rib Geometry
  const corkRibGeo = trackGeo(new THREE.CapsuleGeometry(0.038, 0.17, 4, 8));
  const vestStrapGeo = trackGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.34, 6));

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
    bodyRoot.position.y = 0.85; // pelvis height above deck
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

    // Pelvis / Torso
    const torsoGroup = new THREE.Group();
    bodyRoot.add(torsoGroup);

    const torsoMesh = new THREE.Mesh(role === 'lady' ? ladyBodiceGeo : coatTorsoGeo, coatMat);
    torsoMesh.castShadow = true;
    torsoGroup.add(torsoMesh);

    // White shirt collar & brass uniform buttons
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

    // Articulated Head & Face
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

    // Articulated Left & Right Arms (Shoulder -> Upper Arm -> Elbow -> Forearm -> Hand)
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

    // Articulated Left & Right Legs (Hip -> Thigh -> Knee -> Shin -> Boot)
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

    // Realistic Segmented Cork Lifejacket (hidden until flooding/sinking)
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

    hullMeshGroup.add(group);

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

  // =========================================================================
  // 1. WHEELHOUSE, BRIDGE WINGS, CROW'S NEST & FORECASTLE CREW (269m SCALE)
  // =========================================================================
  // Quartermaster / First Officer Murdoch pacing between Helm & Starboard Telegraph
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
  // Junior Watch Officer checking Port Telegraph & Chart Table
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
  // Starboard & Port Bridge Wing Officers walking patrol out along 15m wings
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
  // Two Crow's Nest Lookouts (y = 25.4, z = -22.5)
  spawnCharacter('lookout', [{ x: -0.3, y: 25.4, z: -22.55 }], 'idle', 0, null, 0.08);
  spawnCharacter('lookout', [{ x: 0.3, y: 25.4, z: -22.45 }], 'idle', 1, null, -0.08);
  // Forecastle Anchor Watch Crewmen walking along 39m forecastle deck
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

  // =========================================================================
  // 2. WALKING & RUNNING PASSENGERS ALONG 158m BOAT DECK, PROMENADE & POOP
  // =========================================================================
  const passengerRoutes: Array<{
    role: CharacterRole;
    route: DeckWaypoint[];
    muster: DeckWaypoint;
  }> = [
    // Starboard Boat Deck Forward & Aft Strollers
    {
      role: 'gentleman',
      route: [
        { x: 10.2, y: 12.88, z: 6.0, pauseSec: 1.2 },
        { x: 10.5, y: 12.88, z: 38.0, pauseSec: 1.5 },
      ],
      muster: { x: 11.4, y: 12.88, z: 8.5 },
    },
    {
      role: 'lady',
      route: [
        { x: 9.6, y: 12.88, z: 9.0, pauseSec: 1.4 },
        { x: 9.9, y: 12.88, z: 40.0, pauseSec: 1.6 },
      ],
      muster: { x: 11.1, y: 12.88, z: 18.0 },
    },
    {
      role: 'gentleman',
      route: [
        { x: 10.4, y: 12.88, z: 46.0, pauseSec: 1.0 },
        { x: 10.1, y: 12.88, z: 88.0, pauseSec: 1.6 },
      ],
      muster: { x: 11.3, y: 12.88, z: 27.5 },
    },
    {
      role: 'lady',
      route: [
        { x: 9.8, y: 12.88, z: 92.0, pauseSec: 1.8 },
        { x: 10.4, y: 12.88, z: 54.0, pauseSec: 1.2 },
      ],
      muster: { x: 11.2, y: 12.88, z: 102.0 },
    },
    {
      role: 'gentleman',
      route: [
        { x: 9.4, y: 12.88, z: 98.0, pauseSec: 1.5 },
        { x: 10.5, y: 12.88, z: 138.0, pauseSec: 1.5 },
      ],
      muster: { x: 11.3, y: 12.88, z: 112.0 },
    },
    {
      role: 'lady',
      route: [
        { x: 10.0, y: 12.88, z: 140.0, pauseSec: 1.4 },
        { x: 9.6, y: 12.88, z: 106.0, pauseSec: 1.6 },
      ],
      muster: { x: 11.1, y: 12.88, z: 122.0 },
    },
    // Port Boat Deck Forward & Aft Strollers
    {
      role: 'lady',
      route: [
        { x: -10.2, y: 12.88, z: 8.0, pauseSec: 1.4 },
        { x: -10.5, y: 12.88, z: 42.0, pauseSec: 1.6 },
      ],
      muster: { x: -11.3, y: 12.88, z: 18.0 },
    },
    {
      role: 'gentleman',
      route: [
        { x: -9.8, y: 12.88, z: 48.0, pauseSec: 1.0 },
        { x: -10.4, y: 12.88, z: 94.0, pauseSec: 2.0 },
      ],
      muster: { x: -11.4, y: 12.88, z: 27.5 },
    },
    {
      role: 'lady',
      route: [
        { x: -10.2, y: 12.88, z: 96.0, pauseSec: 1.4 },
        { x: -9.6, y: 12.88, z: 62.0, pauseSec: 1.8 },
      ],
      muster: { x: -11.2, y: 12.88, z: 102.0 },
    },
    {
      role: 'gentleman',
      route: [
        { x: -9.6, y: 12.88, z: 104.0, pauseSec: 1.2 },
        { x: -10.6, y: 12.88, z: 140.0, pauseSec: 1.5 },
      ],
      muster: { x: -11.4, y: 12.88, z: 122.0 },
    },
    // A-Deck Promenade Long Strolls along 158m sheltered deck
    {
      role: 'gentleman',
      route: [
        { x: 12.4, y: 9.86, z: -2.0, pauseSec: 1.5 },
        { x: 12.4, y: 9.86, z: 64.0, pauseSec: 1.5 },
      ],
      muster: { x: 12.0, y: 9.86, z: 24.0 },
    },
    {
      role: 'lady',
      route: [
        { x: 12.3, y: 9.86, z: 72.0, pauseSec: 1.8 },
        { x: 12.3, y: 9.86, z: 16.0, pauseSec: 1.4 },
      ],
      muster: { x: 12.0, y: 9.86, z: 36.0 },
    },
    {
      role: 'gentleman',
      route: [
        { x: 12.4, y: 9.86, z: 82.0, pauseSec: 1.0 },
        { x: 12.4, y: 9.86, z: 138.0, pauseSec: 1.5 },
      ],
      muster: { x: 12.0, y: 9.86, z: 112.0 },
    },
    {
      role: 'lady',
      route: [
        { x: -12.4, y: 9.86, z: 4.0, pauseSec: 1.5 },
        { x: -12.4, y: 9.86, z: 72.0, pauseSec: 1.5 },
      ],
      muster: { x: -12.0, y: 9.86, z: 28.0 },
    },
    {
      role: 'gentleman',
      route: [
        { x: -12.3, y: 9.86, z: 134.0, pauseSec: 1.4 },
        { x: -12.3, y: 9.86, z: 68.0, pauseSec: 1.8 },
      ],
      muster: { x: -12.0, y: 9.86, z: 110.0 },
    },
    // Stern Poop Deck Passengers (z = 172..193, y = 8.4)
    {
      role: 'gentleman',
      route: [
        { x: -3.2, y: 8.4, z: 188.0, pauseSec: 2.2 },
        { x: 3.1, y: 8.4, z: 186.5, pauseSec: 2.2 },
      ],
      muster: { x: -2.2, y: 8.4, z: 171.0 },
    },
    {
      role: 'lady',
      route: [
        { x: -2.0, y: 8.4, z: 189.0, pauseSec: 2.0 },
        { x: 3.4, y: 8.4, z: 187.5, pauseSec: 2.0 },
      ],
      muster: { x: 2.2, y: 8.4, z: 171.0 },
    },
    {
      role: 'gentleman',
      route: [
        { x: 4.2, y: 8.4, z: 174.0, pauseSec: 1.6 },
        { x: -4.2, y: 8.4, z: 175.0, pauseSec: 1.6 },
      ],
      muster: { x: 3.0, y: 8.4, z: 170.5 },
    },
  ];

  passengerRoutes.forEach((p, idx) => {
    spawnCharacter(p.role, p.route, 'walk', idx, p.muster);
  });

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

  // Curved S-shaped Welin Davit Arm using TubeGeometry
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

  // Authentic Titanic boat clusters: 4 forward + 4 aft on each side = 16 main boats
  const boatZStations = [8.5, 18.2, 27.9, 37.6, 102.0, 111.7, 121.4, 131.1];

  for (const side of [-1, 1] as const) {
    for (let b = 0; b < boatZStations.length; b++) {
      const bz = boatZStations[b];

      const makeDavitArm = (dz: number) => {
        const arm = new THREE.Group();
        arm.position.set(side * 12.15, 12.82, bz + dz);
        const swanNeck = new THREE.Mesh(side < 0 ? davitGeoPort : davitGeoStbd, whitePaintMat);
        swanNeck.castShadow = true;
        arm.add(swanNeck);
        const block = new THREE.Mesh(pulleyGeo, officerNavyMat);
        block.position.set(side * 1.16, 2.12, 0);
        arm.add(block);
        hullMeshGroup.add(arm);
        return arm;
      };
      const davitForeArm = makeDavitArm(-2.65);
      const davitAftArm = makeDavitArm(2.65);

      const ropeFore = new THREE.Mesh(ropeGeo, ropeMat);
      ropeFore.visible = false;
      hullMeshGroup.add(ropeFore);
      const ropeAft = new THREE.Mesh(ropeGeo, ropeMat);
      ropeAft.visible = false;
      hullMeshGroup.add(ropeAft);

      // Sculpted Double-Ended 9.1m Wooden Lifeboat
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

      // Seated Realistic Occupants with Segmented Cork Lifejackets
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

      // Animated Rowing Oars (visible when waterborne)
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

      hullMeshGroup.add(boatGroup);

      lifeboats.push({
        side,
        index: b,
        baseZ: bz,
        lowerStart: 0.03 + b * 0.046 + (side > 0 ? 0.012 : 0),
        davitForeArm,
        davitAftArm,
        ropeFore,
        ropeAft,
        boatGroup,
        occupantsGroup,
        oarsGroup,
        lanternMesh,
        detached: false,
      });
    }
  }

  // =========================================================================
  // ARTICULATED WALKING / RUNNING KINEMATICS & WAYPOINT NAVIGATION
  // =========================================================================
  const animateLimbGait = (ch: DeckCharacter, speedFactor: number, isRunning: boolean, time: number) => {
    if (speedFactor < 0.05) {
      // Natural idle stance (subtle breathing & head scan)
      ch.bodyRoot.position.y = 0.85 + Math.sin(time * 1.7 + ch.phase) * 0.008;
      ch.torsoGroup.rotation.x = THREE.MathUtils.damp(ch.torsoGroup.rotation.x, 0, 8, 0.03);
      ch.torsoGroup.rotation.y = Math.sin(time * 0.6 + ch.phase) * 0.04;
      ch.leftLegHip.rotation.x = THREE.MathUtils.damp(ch.leftLegHip.rotation.x, 0, 8, 0.03);
      ch.rightLegHip.rotation.x = THREE.MathUtils.damp(ch.rightLegHip.rotation.x, 0, 8, 0.03);
      ch.leftKnee.rotation.x = THREE.MathUtils.damp(ch.leftKnee.rotation.x, 0.04, 8, 0.03);
      ch.rightKnee.rotation.x = THREE.MathUtils.damp(ch.rightKnee.rotation.x, 0.04, 8, 0.03);

      if (ch.role === 'lookout') {
        // Holding binoculars up toward horizon
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

    // Pelvis vertical bounce (twice per full stride cycle) + subtle sway
    ch.bodyRoot.position.y = 0.85 + Math.abs(Math.sin(c)) * bobAmp - (isRunning ? 0.04 : 0);
    ch.torsoGroup.rotation.x = isRunning ? -0.24 : -0.05; // lean forward into -Z travel
    ch.torsoGroup.rotation.y = Math.sin(c) * (isRunning ? 0.14 : 0.06);

    // Opposite hip swing (forward leg rotates around +X toward -Z)
    const swingL = Math.sin(c) * strideAmp;
    const swingR = -swingL;
    ch.leftLegHip.rotation.x = swingL;
    ch.rightLegHip.rotation.x = swingR;

    // Knee bends backward (negative rotation.x around knee joint) during recovery swing
    ch.leftKnee.rotation.x = -Math.max(0.05, Math.cos(c) * (isRunning ? 1.15 : 0.58) + 0.15);
    ch.rightKnee.rotation.x = -Math.max(0.05, -Math.cos(c) * (isRunning ? 1.15 : 0.58) + 0.15);

    // Counter-swinging arms + bent elbows (forward arm bends toward -Z = positive X)
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
    // Stationary lookouts stay at post
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
        // Reached lifeboat muster point: pace nervously / look toward davits
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

    // Character faces -Z locally -> yaw to face (dirX, dirZ) is atan2(-dirX, -dirZ)
    const desiredYaw = Math.atan2(-dirX, -dirZ);
    let deltaYaw = desiredYaw - ch.group.rotation.y;
    while (deltaYaw > Math.PI) deltaYaw -= Math.PI * 2;
    while (deltaYaw < -Math.PI) deltaYaw += Math.PI * 2;
    ch.group.rotation.y += deltaYaw * Math.min(1, dt * 7);

    // Advance stride phase proportional to actual distance walked/ran
    ch.strideCycle += (moveSpeed * dt) * (isRunning ? 2.65 : 3.2);
    animateLimbGait(ch, 1, isRunning, time);
  };

  const updateCruising = (time: number, dt: number, floodingPct: number) => {
    const showVests = floodingPct > 28;
    const emergencyRun = floodingPct > 38;
    for (const ch of characters) {
      ch.lifejacket.visible = showVests;
      stepCharacterMovement(ch, dt, time, emergencyRun);
    }
  };

  const updateSinking = (
    time: number,
    dt: number,
    sinkProgress: number,
    hullGroup: THREE.Group,
    shipRoot: THREE.Group,
  ): number => {
    // 1. Characters put on lifejackets & sprint along decks to Boat Deck muster points
    for (const ch of characters) {
      ch.lifejacket.visible = true;
      stepCharacterMovement(ch, dt, time, true);
      const worldY = ch.posY + hullGroup.position.y;
      ch.group.visible = worldY > -1.2;
    }

    // 2. Animate 12 Sculpted Lifeboats swinging out, lowering on ropes & rowing clear
    let launchedCount = 0;
    const hullY = hullGroup.position.y;
    const hullPitch = hullGroup.rotation.x;
    const hullRoll = hullGroup.rotation.z;

    for (const lb of lifeboats) {
      const localT = THREE.MathUtils.clamp((sinkProgress - lb.lowerStart) / 0.36, 0, 1);
      if (localT <= 0.001) continue;

      lb.occupantsGroup.visible = true;
      lb.lanternMesh.visible = true;

      const swingT = THREE.MathUtils.clamp(localT / 0.22, 0, 1);
      lb.davitForeArm.rotation.z = -lb.side * swingT * 0.44;
      lb.davitAftArm.rotation.z = -lb.side * swingT * 0.44;

      const xOut = THREE.MathUtils.lerp(lb.side * 12.95, lb.side * 17.2, swingT);
      const davitDeckWorldY =
        14.95 + hullY - lb.baseZ * Math.sin(hullPitch) + lb.side * 14.0 * Math.sin(hullRoll);
      const boatWaterY = 0.38 + Math.sin(time * 1.4 + lb.index) * 0.14;

      const lowerT = THREE.MathUtils.clamp((localT - 0.18) / 0.64, 0, 1);
      const targetBoatWorldY = THREE.MathUtils.lerp(
        Math.max(boatWaterY, davitDeckWorldY - 1.1),
        boatWaterY,
        lowerT,
      );

      const onWater = lowerT >= 0.96 || targetBoatWorldY <= boatWaterY + 0.15;

      if (onWater) {
        launchedCount++;
        if (!lb.detached) {
          lb.detached = true;
          hullGroup.remove(lb.boatGroup);
          shipRoot.add(lb.boatGroup);
          lb.ropeFore.visible = false;
          lb.ropeAft.visible = false;
          lb.oarsGroup.visible = true;
        }
        const rowT = THREE.MathUtils.clamp((localT - 0.78) / 0.22, 0, 1);
        const extraDrift = Math.max(0, sinkProgress - (lb.lowerStart + 0.34)) * 34;
        lb.boatGroup.position.set(
          lb.side * (17.5 + rowT * 6.0 + extraDrift),
          boatWaterY,
          lb.baseZ + (lb.index - 3.5) * 1.4 * rowT,
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
        const localY =
          targetBoatWorldY -
          hullY +
          lb.baseZ * Math.sin(hullPitch) -
          lb.side * 14.0 * Math.sin(hullRoll);
        lb.boatGroup.position.set(xOut, Math.min(13.85, localY), lb.baseZ);
        lb.boatGroup.rotation.set(-hullPitch * 0.5, 0, -hullRoll * 0.7);

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

  const reset = (hullGroup: THREE.Group) => {
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

    for (const lb of lifeboats) {
      if (lb.detached) {
        lb.boatGroup.parent?.remove(lb.boatGroup);
        hullGroup.add(lb.boatGroup);
        lb.detached = false;
      }
      lb.davitForeArm.rotation.set(0, 0, 0);
      lb.davitAftArm.rotation.set(0, 0, 0);
      lb.ropeFore.visible = false;
      lb.ropeAft.visible = false;
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
    lifeboats,
    updateCruising,
    updateSinking,
    reset,
    setLanternPower,
    dispose,
  };
}
