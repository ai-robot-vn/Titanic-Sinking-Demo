import * as THREE from 'three';
import { createCrewAndLifeboats, CrewAndLifeboatSystem } from './charactersBuilder';
import { ProceduralTextureSet } from './textures';

export const BREAK_Z = 90.0;

export interface TitanicShipRig {
  root: THREE.Group;
  hullMeshGroup: THREE.Group;
  bowGroup: THREE.Group;
  sternGroup: THREE.Group;
  bowContent: THREE.Group;
  sternContent: THREE.Group;
  helmWheel: THREE.Group;
  compassCard: THREE.Mesh;
  telegraphLever: THREE.Group;
  telegraphLeverPort: THREE.Group;
  searchlightHead: THREE.Group;
  searchlightTarget: THREE.Object3D;
  rudderNeedle: THREE.Mesh;
  clinometerNeedle: THREE.Mesh;
  warmBridgeLight: THREE.PointLight;
  crewAndLifeboats: CrewAndLifeboatSystem;
  setPowerLevel: (power: number) => void;
  setWheelhouseFloodLevel: (level: number) => void;
  setBreakupVisual: (broken: boolean, emberPower?: number) => void;
  dispose: () => void;
}

/**
 * Evaluates true 1:1 scale RMS Titanic hull half-beam (max 14.0m / 28m beam)
 * and sheer height from Bow Stem (z = -74.0) to Cruiser Stern (z = +195.1) -> 269.1m LOA.
 */
function sampleHullStation(z: number): {
  beam: number;
  sheerY: number;
  flareFactor: number;
} {
  let beam = 14.0;
  let flareFactor = 0.06;

  if (z < -10) {
    // Forward bow taper (-74 to -10)
    const t = THREE.MathUtils.clamp((z - -74) / 64, 0, 1);
    beam = 14.0 * Math.pow(Math.sin((t * Math.PI) / 2), 0.78);
    flareFactor = 0.26 * (1 - t) + 0.05;
  } else if (z > 136) {
    // Graceful cruiser stern taper (+136 to +195.1)
    const t = THREE.MathUtils.clamp((195.1 - z) / 59.1, 0, 1);
    beam = 14.0 * Math.pow(Math.sin((t * Math.PI) / 2), 0.65);
    flareFactor = 0.14 * (1 - t) + 0.04;
  }

  let sheerY = 6.8;
  if (z < -35) {
    // Forecastle deck sheer rise
    const t = THREE.MathUtils.clamp((-35 - z) / 39, 0, 1);
    sheerY = 9.0 + t * 1.1;
  } else if (z < -10) {
    // Forward well deck
    sheerY = 6.5;
  } else if (z > 148 && z < 170) {
    // Aft well deck
    sheerY = 6.5;
  } else if (z >= 170) {
    // Poop deck sheer rise
    const t = THREE.MathUtils.clamp((z - 170) / 25.1, 0, 1);
    sheerY = 8.2 + t * 0.9;
  }

  return { beam, sheerY, flareFactor };
}

/**
 * Builds a watertight lofted 3D hull surface between yMinFrac and yMaxFrac.
 * When yMinFrac > 0, port and starboard flanks are lofted as separate ribbons
 * so the lower waterline edge never pinches inward to x = 0.
 */
function buildLoftedHullSection(
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
    const { beam, sheerY, flareFactor } = sampleHullStation(z);
    const vCoord = (z + 74) / 269.1;
    const yBottom = -6.5;
    const yTop = sheerY;
    const y = THREE.MathUtils.lerp(yBottom, yTop, frac);

    let widthRatio: number;
    if (frac < 0.28) {
      widthRatio = Math.sin(((frac / 0.28) * Math.PI) / 2) * 0.88;
    } else {
      const up = (frac - 0.28) / 0.72;
      widthRatio = 0.88 + up * 0.12 + up * up * flareFactor;
    }

    const bowRake = z <= -72.0 ? -(frac * 1.9) : 0;
    const x = side * beam * widthRatio;
    return [x, y, z + bowRake, vCoord * 8.0, frac];
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

/**
 * Builds a hull-conforming solid weather deck slab directly from sampleHullStation(z)
 * with top, underside, and side skirt so decks meet the outer hull sheer with zero gaps.
 */
function buildLoftedWeatherDeck(
  zSamples: number[],
  yTopOffset = 0.04,
  thickness = 0.42,
  edgeExpand = 0.04,
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  // Cross-section ring (5 pts): port-bot, port-top, center-top, stbd-top, stbd-bot
  const ringPts = 5;

  for (let zi = 0; zi < zSamples.length; zi++) {
    const z = zSamples[zi];
    const { beam, sheerY, flareFactor } = sampleHullStation(z);
    const halfW = Math.max(0.05, beam * (1 + flareFactor) + edgeExpand);
    const bowRake = z <= -72.0 ? -1.9 : 0;
    const zz = z + bowRake;
    const yTop = sheerY + yTopOffset;
    const yBot = yTop - thickness;
    const vCoord = (z + 74) / 269.1;

    positions.push(-halfW, yBot, zz);
    uvs.push(0, vCoord * 12);
    positions.push(-halfW, yTop, zz);
    uvs.push(0.15, vCoord * 12);
    positions.push(0, yTop + 0.08, zz); // gentle historic deck camber
    uvs.push(0.5, vCoord * 12);
    positions.push(halfW, yTop, zz);
    uvs.push(0.85, vCoord * 12);
    positions.push(halfW, yBot, zz);
    uvs.push(1.0, vCoord * 12);
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

  // Cap fore & aft ends so well-deck steps are watertight
  const addEndCap = (zi: number, flip: boolean) => {
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
  addEndCap(0, false);
  addEndCap(zSamples.length - 1, true);

  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Helper to create a curved superstructure/deckhouse footprint ExtrudeGeometry.
 */
function buildCurvedDeckhouseGeo(
  halfWidth: number,
  zMin: number,
  zMax: number,
  height: number,
  bowCurveLen: number,
  aftCurveLen: number,
  bevel = 0.08,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const yFront = -zMin;
  const yBack = -zMax;
  shape.moveTo(-halfWidth, yFront - bowCurveLen);
  shape.quadraticCurveTo(-halfWidth, yFront, 0, yFront);
  shape.quadraticCurveTo(halfWidth, yFront, halfWidth, yFront - bowCurveLen);
  shape.lineTo(halfWidth, yBack + aftCurveLen);
  shape.quadraticCurveTo(halfWidth, yBack, 0, yBack);
  shape.quadraticCurveTo(-halfWidth, yBack, -halfWidth, yBack + aftCurveLen);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 14,
  });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/**
 * Builds a sculpted 3- or 4-blade manganese-bronze marine propeller.
 */
function buildPropellerGroup(
  trackGeo: <T extends THREE.BufferGeometry>(g: T) => T,
  bronzeMat: THREE.Material,
  bladeCount: number,
  radius: number,
): THREE.Group {
  const group = new THREE.Group();
  const hubGeo = trackGeo(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.0, -0.45),
        new THREE.Vector2(0.32, -0.34),
        new THREE.Vector2(0.38, 0.14),
        new THREE.Vector2(0.24, 0.48),
        new THREE.Vector2(0.0, 0.58),
      ],
      14,
    ),
  );
  hubGeo.rotateX(Math.PI / 2);
  group.add(new THREE.Mesh(hubGeo, bronzeMat));

  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0, 0);
  bladeShape.quadraticCurveTo(radius * 0.38, radius * 0.35, radius * 0.25, radius * 0.85);
  bladeShape.quadraticCurveTo(0, radius * 1.05, -radius * 0.26, radius * 0.82);
  bladeShape.quadraticCurveTo(-radius * 0.32, radius * 0.35, 0, 0);

  const bladeGeo = trackGeo(
    new THREE.ExtrudeGeometry(bladeShape, {
      depth: 0.07,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.02,
      bevelSegments: 2,
    }),
  );

  for (let i = 0; i < bladeCount; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.z = (i * Math.PI * 2) / bladeCount;
    const blade = new THREE.Mesh(bladeGeo, bronzeMat);
    blade.rotation.y = 0.45;
    pivot.add(blade);
    group.add(pivot);
  }
  return group;
}

export function buildTitanicShip(
  textures: ProceduralTextureSet,
  isSoftwareGl: boolean,
): TitanicShipRig {
  const root = new THREE.Group();
  const hullMeshGroup = new THREE.Group();
  root.add(hullMeshGroup);

  // Articulated Bow & Stern halves pivoted at the midships fracture line (z = BREAK_Z)
  const bowGroup = new THREE.Group();
  bowGroup.position.set(0, 0, BREAK_Z);
  hullMeshGroup.add(bowGroup);

  const bowContent = new THREE.Group();
  bowContent.position.set(0, 0, -BREAK_Z);
  bowGroup.add(bowContent);

  const sternGroup = new THREE.Group();
  sternGroup.position.set(0, 0, BREAK_Z);
  hullMeshGroup.add(sternGroup);

  const sternContent = new THREE.Group();
  sternContent.position.set(0, 0, -BREAK_Z);
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

  // =========================================================================
  // PBR MATERIALS
  // =========================================================================
  const mahoganyMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.mahoganyAlbedo,
      roughnessMap: textures.mahoganyRoughness,
      roughness: 0.3,
      metalness: 0.05,
    }),
  );

  const brassMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xd9ad54,
      metalness: 0.94,
      roughness: 0.16,
      anisotropy: 0.78,
      clearcoat: 0.45,
    }),
  );

  const bronzeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xb8863d,
      metalness: 0.88,
      roughness: 0.28,
    }),
  );

  const darkIronMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x161c24,
      metalness: 0.78,
      roughness: 0.44,
    }),
  );

  const teakDeckMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.teakDeckAlbedo,
      normalMap: textures.teakDeckNormal,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.84,
      metalness: 0.02,
    }),
  );

  const steelHullMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.steelHullAlbedo,
      normalMap: textures.steelHullNormal,
      normalScale: new THREE.Vector2(1.15, 1.15),
      color: 0x1a212b,
      roughness: 0.46,
      metalness: 0.5,
      side: THREE.DoubleSide,
    }),
  );

  const antiFoulMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x62191b,
      normalMap: textures.steelHullNormal,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughness: 0.66,
      metalness: 0.14,
      side: THREE.DoubleSide,
    }),
  );

  const whitePaintMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xebe8df,
      roughness: 0.62,
      metalness: 0.04,
    }),
  );

  const creamTrimMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xd9d2c3,
      roughness: 0.55,
      metalness: 0.06,
    }),
  );

  const goldStripeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xd4a64a,
      roughness: 0.24,
      metalness: 0.78,
    }),
  );

  const buffFunnelMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xc99652,
      roughness: 0.56,
      metalness: 0.08,
    }),
  );

  const ventThroatMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x7e1d1d,
      roughness: 0.72,
      side: THREE.DoubleSide,
    }),
  );

  const bridgeGlassMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xd9eefc,
      metalness: 0.0,
      roughness: 0.06,
      transmission: isSoftwareGl ? 0 : 0.92,
      transparent: true,
      opacity: isSoftwareGl ? 0.14 : 1.0,
      ior: 1.52,
      thickness: 0.08,
      depthWrite: false,
    }),
  );

  const warmGlowMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffe4ab,
      emissive: 0xffaa44,
      emissiveIntensity: 1.85,
      roughness: 0.28,
    }),
  );

  const portholeGlowMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffdf99,
      emissive: 0xffa73b,
      emissiveIntensity: 1.65,
      roughness: 0.25,
    }),
  );

  const portLightMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xff3b3b,
      emissive: 0xdc2626,
      emissiveIntensity: 2.3,
      roughness: 0.22,
    }),
  );

  const starboardLightMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x34d399,
      emissive: 0x10b981,
      emissiveIntensity: 2.3,
      roughness: 0.22,
    }),
  );

  // =========================================================================
  // 1. TRUE 269.1m x 28m LOFTED HULL (SPLIT AT BREAK_Z = 90) + RUDDER + PROPS
  // =========================================================================
  const fwdHullZStations = [
    -74, -72, -68, -63, -57, -50, -42, -35.5, -35, -26, -18, -10.5, -10, 6, 26, 46, 66, 86, BREAK_Z,
  ];
  const aftHullZStations = [
    BREAK_Z, 106, 126, 136, 147.5, 148, 159, 169.5, 170, 179, 187, 192, 195.1,
  ];

  for (const [stations, targetGrp] of [
    [fwdHullZStations, bowContent],
    [aftHullZStations, sternContent],
  ] as const) {
    const upperHullGeo = trackGeo(buildLoftedHullSection(stations, 8, 0.36, 1.0));
    const upperHull = new THREE.Mesh(upperHullGeo, steelHullMat);
    upperHull.castShadow = true;
    upperHull.receiveShadow = true;
    targetGrp.add(upperHull);

    const lowerHullGeo = trackGeo(buildLoftedHullSection(stations, 5, 0.0, 0.37));
    const lowerHull = new THREE.Mesh(lowerHullGeo, antiFoulMat);
    lowerHull.scale.set(0.999, 1, 0.9995);
    targetGrp.add(lowerHull);

    // Gold Sheer Pinstripe & Raised Steel Belting Strake along Each Half
    for (const side of [-1, 1]) {
      const stripePts: THREE.Vector3[] = [];
      const strakePts: THREE.Vector3[] = [];
      for (const z of stations) {
        const { beam, sheerY, flareFactor } = sampleHullStation(z);
        const xTop = side * (beam * (1 + flareFactor) + 0.08);
        stripePts.push(new THREE.Vector3(xTop, sheerY - 0.18, z <= -72.0 ? z - 1.75 : z));
        strakePts.push(new THREE.Vector3(side * (beam * 0.95 + 0.08), 1.85, z));
      }
      const curve = new THREE.CatmullRomCurve3(stripePts);
      targetGrp.add(new THREE.Mesh(trackGeo(new THREE.TubeGeometry(curve, 52, 0.1, 6, false)), goldStripeMat));

      const strakeCurve = new THREE.CatmullRomCurve3(strakePts);
      targetGrp.add(new THREE.Mesh(trackGeo(new THREE.TubeGeometry(strakeCurve, 46, 0.14, 6, false)), steelHullMat));
    }
  }

  // Sculpted Balanced Stern Rudder & Triple Bronze Propellers (z = +186..193 -> sternContent)
  const rudderShape = new THREE.Shape();
  rudderShape.moveTo(0, -4.8);
  rudderShape.lineTo(3.2, -4.5);
  rudderShape.quadraticCurveTo(3.6, -2.2, 3.3, 0.4);
  rudderShape.lineTo(0, 0.6);
  rudderShape.closePath();
  const rudderGeo = trackGeo(
    new THREE.ExtrudeGeometry(rudderShape, {
      depth: 0.34,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.06,
      bevelSegments: 2,
    }),
  );
  rudderGeo.rotateY(-Math.PI / 2);
  const sternRudder = new THREE.Mesh(rudderGeo, antiFoulMat);
  sternRudder.position.set(0.17, 0, 190.8);
  sternContent.add(sternRudder);

  const centerProp = buildPropellerGroup(trackGeo, bronzeMat, 3, 2.1);
  centerProp.position.set(0, -2.6, 189.6);
  sternContent.add(centerProp);

  for (const side of [-1, 1]) {
    const wingProp = buildPropellerGroup(trackGeo, bronzeMat, 4, 2.35);
    wingProp.position.set(side * 4.15, -2.2, 186.0);
    sternContent.add(wingProp);

    const boss = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.32, 0.48, 10.5, 10)), antiFoulMat);
    boss.rotation.x = Math.PI / 2;
    boss.rotation.z = side * -0.14;
    boss.position.set(side * 3.1, -2.05, 181.0);
    sternContent.add(boss);
  }

  // =========================================================================
  // 2. FORECASTLE, FORWARD WELL DECK, SHELTER DECK, AFT WELL & POOP DECKS
  // =========================================================================
  // Lofted hull-conforming Forecastle Teak Deck (z = -74 to -35)
  const forecastleTeak = new THREE.Mesh(
    trackGeo(buildLoftedWeatherDeck([-74, -70, -64, -56, -48, -40, -35], 0.05, 0.45, -0.02)),
    teakDeckMat,
  );
  forecastleTeak.receiveShadow = true;
  bowContent.add(forecastleTeak);

  // Solid Forecastle Break Wall facing aft into Forward Well Deck (z = -35)
  const forecastleBreak = new THREE.Mesh(
    trackGeo(buildCurvedDeckhouseGeo(12.2, -35.6, -34.7, 2.95, 0.15, 0.08, 0.0)),
    whitePaintMat,
  );
  forecastleBreak.position.y = 6.35;
  bowContent.add(forecastleBreak);

  // Lofted hull-conforming Forward Well Deck (z = -35 to -10)
  const fwdWellDeck = new THREE.Mesh(
    trackGeo(buildLoftedWeatherDeck([-35, -30, -24, -17, -10.5, -10], 0.06, 0.42, -0.02)),
    teakDeckMat,
  );
  fwdWellDeck.receiveShadow = true;
  bowContent.add(fwdWellDeck);

  // Lofted hull-conforming C-Deck / Shelter Deck sealing hull edge under B-Deck (z = -10..90 & 90..148)
  const fwdShelterDeck = new THREE.Mesh(
    trackGeo(buildLoftedWeatherDeck([-10, 10, 35, 65, BREAK_Z + 0.02], 0.04, 0.45, 0.0)),
    teakDeckMat,
  );
  fwdShelterDeck.receiveShadow = true;
  bowContent.add(fwdShelterDeck);

  const aftShelterDeck = new THREE.Mesh(
    trackGeo(buildLoftedWeatherDeck([BREAK_Z - 0.02, 110, 128, 138, 144, 148], 0.04, 0.45, 0.0)),
    teakDeckMat,
  );
  aftShelterDeck.receiveShadow = true;
  sternContent.add(aftShelterDeck);

  // Solid forward & aft superstructure end bulkheads sealing C-Deck to B-Deck transitions
  const fwdBridgeBreak = new THREE.Mesh(
    trackGeo(buildCurvedDeckhouseGeo(13.8, -10.2, -6.2, 3.15, 0.8, 0.1, 0.0)),
    whitePaintMat,
  );
  fwdBridgeBreak.position.y = 6.5;
  bowContent.add(fwdBridgeBreak);

  const aftBridgeBreak = new THREE.Mesh(
    trackGeo(buildCurvedDeckhouseGeo(13.2, 143.5, 148.2, 3.15, 0.1, 0.9, 0.0)),
    whitePaintMat,
  );
  aftBridgeBreak.position.y = 6.5;
  sternContent.add(aftBridgeBreak);

  // Lofted hull-conforming Aft Well Deck (z = 148 to 170)
  const aftWellDeck = new THREE.Mesh(
    trackGeo(buildLoftedWeatherDeck([148, 153, 159, 165, 170], 0.06, 0.42, -0.02)),
    teakDeckMat,
  );
  aftWellDeck.receiveShadow = true;
  sternContent.add(aftWellDeck);

  // Solid Poop Deck Break Wall (z = 170) & Lofted Poop Teak Deck (z = 170 to 195.1)
  const poopBreak = new THREE.Mesh(
    trackGeo(buildCurvedDeckhouseGeo(10.6, 169.6, 170.5, 2.25, 0.08, 0.15, 0.0)),
    whitePaintMat,
  );
  poopBreak.position.y = 6.35;
  sternContent.add(poopBreak);

  const poopDeck = new THREE.Mesh(
    trackGeo(buildLoftedWeatherDeck([170, 175, 181, 187, 192, 195.1], 0.06, 0.44, -0.02)),
    teakDeckMat,
  );
  poopDeck.receiveShadow = true;
  sternContent.add(poopDeck);

  // Aft Docking Bridge on Poop Deck (z = 172.5, height y = 10.52) with Helm Pedestal, Binnacle & Railings
  const aftDockDeck = new THREE.Mesh(
    trackGeo(buildCurvedDeckhouseGeo(10.2, 171.6, 173.4, 0.24, 0.2, 0.2, 0.03)),
    teakDeckMat,
  );
  aftDockDeck.position.y = 10.28;
  sternContent.add(aftDockDeck);
  for (const sx of [-9.4, -4.5, 4.5, 9.4]) {
    const leg = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.11, 0.14, 2.05, 8)), whitePaintMat);
    leg.position.set(sx, 9.28, 172.5);
    sternContent.add(leg);
  }
  const aftHelmPed = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.14, 0.22, 0.92, 12)), mahoganyMat);
  aftHelmPed.position.set(0, 10.96, 172.5);
  sternContent.add(aftHelmPed);
  const aftHelmWheel = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.32, 0.04, 8, 20)), mahoganyMat);
  aftHelmWheel.position.set(0, 11.42, 172.34);
  sternContent.add(aftHelmWheel);
  const aftHelmHub = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 10)), brassMat);
  aftHelmHub.rotation.x = Math.PI / 2;
  aftHelmHub.position.set(0, 11.42, 172.34);
  sternContent.add(aftHelmHub);
  for (let si = 0; si < 4; si++) {
    const sp = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.015, 0.015, 0.64, 6)), brassMat);
    sp.position.set(0, 11.42, 172.34);
    sp.rotation.z = (si * Math.PI) / 4;
    sternContent.add(sp);
  }
  const aftBinnacle = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.12, 0.16, 0.96, 12)), brassMat);
  aftBinnacle.position.set(-1.1, 10.98, 172.3);
  sternContent.add(aftBinnacle);
  for (const dz of [-0.82, 0.82]) {
    const aftBridgeRail = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.04, 0.04, 20.0, 8)), whitePaintMat);
    aftBridgeRail.rotation.z = Math.PI / 2;
    aftBridgeRail.position.set(0, 11.35, 172.5 + dz);
    sternContent.add(aftBridgeRail);
  }
  for (const ax of [-10.0, -5.0, 5.0, 10.0]) {
    for (const dz of [-0.82, 0.82]) {
      const aftPost = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.04, 0.04, 0.88, 6)), whitePaintMat);
      aftPost.position.set(ax, 10.92, 172.5 + dz);
      sternContent.add(aftPost);
    }
  }

  // Turned Lathe Steam Capstans, Linked Chains & Bow Anchor Crane
  const capstanLatheGeo = trackGeo(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.85, 0),
        new THREE.Vector2(0.82, 0.2),
        new THREE.Vector2(0.52, 0.48),
        new THREE.Vector2(0.48, 0.82),
        new THREE.Vector2(0.7, 1.1),
        new THREE.Vector2(0.65, 1.24),
        new THREE.Vector2(0, 1.28),
      ],
      18,
    ),
  );
  for (const cx of [-3.4, 3.4]) {
    const capstan = new THREE.Mesh(capstanLatheGeo, darkIronMat);
    capstan.position.set(cx, 9.2, -55.0);
    capstan.castShadow = true;
    bowContent.add(capstan);

    const brassCap = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.55, 0.64, 0.14, 16)), brassMat);
    brassCap.position.set(cx, 10.5, -55.0);
    bowContent.add(brassCap);
  }

  // Linked Anchor Chains (InstancedMesh)
  const linkGeo = trackGeo(new THREE.TorusGeometry(0.13, 0.042, 6, 12));
  const chainInstanced = new THREE.InstancedMesh(linkGeo, darkIronMat, 84);
  const cDummy = new THREE.Object3D();
  let cIdx = 0;
  for (const side of [-1, 1]) {
    for (let li = 0; li < 42; li++) {
      const t = li / 41;
      cDummy.position.set(
        THREE.MathUtils.lerp(side * 3.1, side * 1.4, t),
        9.26,
        THREE.MathUtils.lerp(-55.5, -67.5, t),
      );
      cDummy.rotation.set(li % 2 === 0 ? Math.PI / 2 : 0.2, 0.14 * side, 0);
      cDummy.updateMatrix();
      chainInstanced.setMatrixAt(cIdx++, cDummy.matrix);
    }
  }
  chainInstanced.instanceMatrix.needsUpdate = true;
  bowContent.add(chainInstanced);

  // Curved Gooseneck Anchor Crane + Cable + Spare Stockless Anchor
  const craneCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 9.2, -66.2),
    new THREE.Vector3(0, 12.0, -66.3),
    new THREE.Vector3(0, 13.3, -67.3),
    new THREE.Vector3(0, 13.7, -69.5),
    new THREE.Vector3(0, 13.4, -70.8),
  ]);
  bowContent.add(new THREE.Mesh(trackGeo(new THREE.TubeGeometry(craneCurve, 18, 0.22, 10, false)), whitePaintMat));
  const craneCable = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.028, 0.028, 2.8, 6)), darkIronMat);
  craneCable.position.set(0, 12.0, -70.8);
  bowContent.add(craneCable);

  const buildAnchorMesh = (): THREE.Group => {
    const aGrp = new THREE.Group();
    const shankGeo = trackGeo(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.13, 0),
          new THREE.Vector2(0.16, 0.9),
          new THREE.Vector2(0.11, 1.85),
          new THREE.Vector2(0.19, 2.05),
        ],
        10,
      ),
    );
    const shank = new THREE.Mesh(shankGeo, darkIronMat);
    shank.position.y = -0.9;
    aGrp.add(shank);

    const crownShape = new THREE.Shape();
    crownShape.moveTo(-0.82, 0.4);
    crownShape.quadraticCurveTo(-0.6, -0.28, 0, -0.36);
    crownShape.quadraticCurveTo(0.6, -0.28, 0.82, 0.4);
    crownShape.lineTo(0.52, 0.48);
    crownShape.quadraticCurveTo(0.36, -0.02, 0, -0.06);
    crownShape.quadraticCurveTo(-0.36, -0.02, -0.52, 0.48);
    crownShape.closePath();
    const flukeGeo = trackGeo(
      new THREE.ExtrudeGeometry(crownShape, {
        depth: 0.25,
        bevelEnabled: true,
        bevelThickness: 0.045,
        bevelSize: 0.045,
        bevelSegments: 2,
      }),
    );
    const crown = new THREE.Mesh(flukeGeo, darkIronMat);
    crown.position.set(0, -0.78, -0.125);
    aGrp.add(crown);
    return aGrp;
  };

  for (const side of [-1, 1]) {
    const { beam } = sampleHullStation(-65);
    const hawseRing = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.48, 0.11, 8, 16)), darkIronMat);
    hawseRing.rotation.y = Math.PI / 2 - side * 0.32;
    hawseRing.position.set(side * (beam + 0.16), 7.6, -65);
    bowContent.add(hawseRing);

    const anchor = buildAnchorMesh();
    anchor.position.set(side * (beam + 0.34), 7.25, -65);
    anchor.rotation.y = Math.PI / 2 - side * 0.32;
    bowContent.add(anchor);
  }
  const spareAnchor = buildAnchorMesh();
  spareAnchor.rotation.set(Math.PI / 2, 0, 0);
  spareAnchor.position.set(0, 9.38, -64.0);
  bowContent.add(spareAnchor);

  // Cargo Hatches & Curved Cargo Cranes in Forward & Aft Well Decks
  for (const hz of [-28.5, -18.0, 155.0, 163.5]) {
    const parentGrp = hz < BREAK_Z ? bowContent : sternContent;
    const hatchCoaming = new THREE.Mesh(
      trackGeo(buildCurvedDeckhouseGeo(3.2, hz - 2.6, hz + 2.6, 0.85, 0.22, 0.22, 0.06)),
      whitePaintMat,
    );
    hatchCoaming.position.y = 6.55;
    parentGrp.add(hatchCoaming);

    const hatchCover = new THREE.Mesh(
      trackGeo(buildCurvedDeckhouseGeo(2.95, hz - 2.4, hz + 2.4, 0.22, 0.16, 0.16, 0.05)),
      teakDeckMat,
    );
    hatchCover.position.y = 7.42;
    parentGrp.add(hatchCover);
  }

  // 4 Well-Deck Cargo Cranes (2 Forward, 2 Aft)
  const wellCraneCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 3.8, 0),
    new THREE.Vector3(0, 5.2, 1.5),
    new THREE.Vector3(0, 5.6, 3.6),
  ]);
  const wellCraneGeo = trackGeo(new THREE.TubeGeometry(wellCraneCurve, 12, 0.16, 8, false));
  for (const [cx, cz, ry] of [
    [-7.2, -14.5, -0.5],
    [7.2, -14.5, 0.5],
    [-6.8, 152.0, 2.6],
    [6.8, 152.0, -2.6],
  ]) {
    const cr = new THREE.Mesh(wellCraneGeo, whitePaintMat);
    cr.position.set(cx, 6.6, cz);
    cr.rotation.y = ry;
    (cz < BREAK_Z ? bowContent : sternContent).add(cr);
  }

  // Turned Goose-Neck Cowl Ventilators along Decks
  const cowlBellPts = [
    new THREE.Vector2(0.28, 0),
    new THREE.Vector2(0.28, 0.28),
    new THREE.Vector2(0.44, 0.62),
    new THREE.Vector2(0.64, 0.82),
    new THREE.Vector2(0.56, 0.86),
    new THREE.Vector2(0.32, 0.52),
    new THREE.Vector2(0.2, 0.12),
  ];
  const cowlBellGeo = trackGeo(new THREE.LatheGeometry(cowlBellPts, 16));
  const cowlNeckGeo = trackGeo(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0.95, 0),
        new THREE.Vector3(0, 1.5, -0.4),
      ]),
      10,
      0.24,
      10,
      false,
    ),
  );
  for (const [vx, vy, vz, rotY] of [
    [-7.8, 6.6, -31, 0],
    [7.8, 6.6, -31, 0],
    [-8.2, 6.6, -15, Math.PI],
    [8.2, 6.6, -15, Math.PI],
    [-6.2, 12.88, 40, 0],
    [6.2, 12.88, 40, 0],
    [-6.2, 12.88, 68, Math.PI],
    [6.2, 12.88, 68, Math.PI],
    [-6.2, 12.88, 98, 0],
    [6.2, 12.88, 98, 0],
    [-7.5, 6.6, 159, 0],
    [7.5, 6.6, 159, 0],
  ]) {
    const vGrp = new THREE.Group();
    vGrp.position.set(vx, vy, vz);
    vGrp.rotation.y = rotY;
    vGrp.add(new THREE.Mesh(cowlNeckGeo, whitePaintMat));
    const bell = new THREE.Mesh(cowlBellGeo, ventThroatMat);
    bell.rotation.x = -Math.PI / 2;
    bell.position.set(0, 1.5, -0.4);
    vGrp.add(bell);
    (vz < BREAK_Z ? bowContent : sternContent).add(vGrp);
  }

  // White Turned Railings along Forecastle, Forward Well Deck, Aft Well Deck & Poop Deck (hull-conforming)
  const buildRailSegment = (
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
    for (const barOff of [0.38, 0.72, 1.04]) {
      const rail = new THREE.Mesh(
        trackGeo(new THREE.CylinderGeometry(0.04, 0.04, len, 8)),
        barOff > 0.95 ? teakDeckMat : whitePaintMat,
      );
      rail.position.set((x1 + x2) * 0.5, (y1 + y2) * 0.5 + barOff, (z1 + z2) * 0.5);
      rail.rotation.x = Math.PI / 2;
      rail.rotation.z = -Math.atan2(dx, dz);
      targetGrp.add(rail);
    }
  };

  const addHullEdgeRail = (targetGrp: THREE.Group, zList: number[]) => {
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < zList.length; i++) {
        const z = zList[i];
        const { beam, sheerY, flareFactor } = sampleHullStation(z);
        const rx = side * Math.max(0, beam * (1 + flareFactor) - 0.16);
        const ry = sheerY + 0.06;
        const post = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.052, 0.052, 1.08, 8)), whitePaintMat);
        post.position.set(rx, ry + 0.52, z <= -72 ? z - 1.85 : z);
        targetGrp.add(post);
        if (i < zList.length - 1) {
          const nz = zList[i + 1];
          const next = sampleHullStation(nz);
          const nrx = side * Math.max(0, next.beam * (1 + next.flareFactor) - 0.16);
          const nry = next.sheerY + 0.06;
          buildRailSegment(
            targetGrp,
            rx,
            ry,
            z <= -72 ? z - 1.85 : z,
            nrx,
            nry,
            nz <= -72 ? nz - 1.85 : nz,
          );
        }
      }
    }
  };
  addHullEdgeRail(bowContent, [-73.8, -64, -52, -40, -35.2]);
  addHullEdgeRail(bowContent, [-34.6, -26, -18, -10.5]);
  addHullEdgeRail(sternContent, [148.5, 156, 163, 169.5]);
  addHullEdgeRail(sternContent, [170.5, 178, 185, 191, 194.8]);

  // =========================================================================
  // 3. 158-METER MULTI-TIER SUPERSTRUCTURE (SPLIT AT z = 90) & STAIRCASE DOMES
  // =========================================================================
  // B-Deck Contoured White Superstructure Tier (flat seamless join at BREAK_Z)
  for (const [z0, z1, bc, ac, bv, tgt] of [
    [-10.0, BREAK_Z + 0.02, 3.0, 0.0, 0.0, bowContent],
    [BREAK_Z - 0.02, 148.0, 0.0, 4.0, 0.0, sternContent],
  ] as const) {
    const bDeckHalf = new THREE.Mesh(
      trackGeo(buildCurvedDeckhouseGeo(13.45, z0, z1, 2.9, bc, ac, bv)),
      whitePaintMat,
    );
    bDeckHalf.position.y = 6.72;
    bDeckHalf.castShadow = true;
    bDeckHalf.receiveShadow = true;
    tgt.add(bDeckHalf);
  }

  // A-Deck Teak Promenade Floor Overhang (top y = 9.86)
  for (const [z0, z1, bc, ac, bv, tgt] of [
    [-10.4, BREAK_Z + 0.02, 3.0, 0.0, 0.0, bowContent],
    [BREAK_Z - 0.02, 148.4, 0.0, 4.0, 0.0, sternContent],
  ] as const) {
    const aFloorHalf = new THREE.Mesh(
      trackGeo(buildCurvedDeckhouseGeo(13.6, z0, z1, 0.28, bc, ac, bv)),
      teakDeckMat,
    );
    aFloorHalf.position.y = 9.58;
    aFloorHalf.receiveShadow = true;
    tgt.add(aFloorHalf);
  }

  // A-Deck Inset Promenade Saloon Wall
  for (const [z0, z1, bc, ac, bv, tgt] of [
    [-9.2, BREAK_Z + 0.02, 2.6, 0.0, 0.0, bowContent],
    [BREAK_Z - 0.02, 146.5, 0.0, 3.4, 0.0, sternContent],
  ] as const) {
    const aHouseHalf = new THREE.Mesh(
      trackGeo(buildCurvedDeckhouseGeo(11.35, z0, z1, 2.82, bc, ac, bv)),
      whitePaintMat,
    );
    aHouseHalf.position.y = 9.82;
    aHouseHalf.castShadow = true;
    aHouseHalf.receiveShadow = true;
    tgt.add(aHouseHalf);
  }

  // Boat Deck Teak Floor (top y = 12.88)
  for (const [z0, z1, bc, ac, bv, tgt] of [
    [-10.2, BREAK_Z + 0.02, 3.0, 0.0, 0.0, bowContent],
    [BREAK_Z - 0.02, 148.4, 0.0, 4.0, 0.0, sternContent],
  ] as const) {
    const boatFloorHalf = new THREE.Mesh(
      trackGeo(buildCurvedDeckhouseGeo(13.7, z0, z1, 0.3, bc, ac, bv)),
      teakDeckMat,
    );
    boatFloorHalf.position.y = 12.58;
    boatFloorHalf.receiveShadow = true;
    tgt.add(boatFloorHalf);
  }

  // 72 Turned A-Deck Promenade Stanchion Pillars partitioned into bow/stern
  const stanchionGeo = trackGeo(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.13, 0),
        new THREE.Vector2(0.09, 0.35),
        new THREE.Vector2(0.075, 1.4),
        new THREE.Vector2(0.1, 2.55),
        new THREE.Vector2(0.14, 2.8),
      ],
      10,
    ),
  );
  const fwdStanchionPos: Array<[number, number, number]> = [];
  const aftStanchionPos: Array<[number, number, number]> = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 36; i++) {
      const sz = -7.0 + i * 4.3;
      if (sz < BREAK_Z) fwdStanchionPos.push([side * 13.25, 9.82, sz]);
      else aftStanchionPos.push([side * 13.25, 9.82, sz]);
    }
  }
  const sDummy = new THREE.Object3D();
  for (const [positions, tgt] of [
    [fwdStanchionPos, bowContent],
    [aftStanchionPos, sternContent],
  ] as const) {
    const inst = new THREE.InstancedMesh(stanchionGeo, whitePaintMat, positions.length);
    for (let i = 0; i < positions.length; i++) {
      sDummy.position.set(positions[i][0], positions[i][1], positions[i][2]);
      sDummy.updateMatrix();
      inst.setMatrixAt(i, sDummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    tgt.add(inst);
  }

  // Boat Deck Teak Benches partitioned into bow/stern
  const benchGeo = trackGeo(new THREE.BoxGeometry(0.7, 0.58, 2.4));
  const fwdBenchPos: Array<[number, number, number]> = [];
  const aftBenchPos: Array<[number, number, number]> = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 12; i++) {
      const bz = 6 + i * 11.5;
      if (bz < BREAK_Z) fwdBenchPos.push([side * 8.2, 13.15, bz]);
      else aftBenchPos.push([side * 8.2, 13.15, bz]);
    }
  }
  for (const [positions, tgt] of [
    [fwdBenchPos, bowContent],
    [aftBenchPos, sternContent],
  ] as const) {
    const inst = new THREE.InstancedMesh(benchGeo, teakDeckMat, positions.length);
    for (let i = 0; i < positions.length; i++) {
      sDummy.position.set(positions[i][0], positions[i][1], positions[i][2]);
      sDummy.updateMatrix();
      inst.setMatrixAt(i, sDummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    tgt.add(inst);
  }

  // Boat Deck Deckhouses: Officer's Quarters, Staircase Houses, Marconi Shack, Lounge & Smoking Room
  const deckhouses: Array<[number, number, number, number]> = [
    [6.6, 2.0, 20.5, 2.5], // Officer's Quarters
    [6.4, 28.0, 38.5, 2.25], // Forward Grand Staircase
    [5.8, 42.0, 51.5, 2.1], // Marconi Wireless Room & Gymnasium
    [6.2, 64.0, 81.5, 2.15], // First Class Lounge
    [6.2, 92.0, 112.5, 2.15], // First Class Smoking Room
    [6.0, 118.5, 130.5, 2.2], // Aft Grand Staircase
    [5.6, 135.5, 145.5, 2.0], // Second Class Entrance House
  ];
  for (const [hw, z0, z1, h] of deckhouses) {
    const house = new THREE.Mesh(trackGeo(buildCurvedDeckhouseGeo(hw, z0, z1, h, 0.8, 0.8, 0.08)), whitePaintMat);
    house.position.y = 12.86;
    house.castShadow = true;
    (z0 < BREAK_Z ? bowContent : sternContent).add(house);
  }

  // Twin Sculpted Glowing Grand Staircase Stained-Glass Dome Skylights
  const domeGlassGeo = trackGeo(new THREE.SphereGeometry(2.7, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.48));
  domeGlassGeo.scale(1.1, 0.72, 1.38);
  const domeRimGeo = trackGeo(new THREE.TorusGeometry(2.7, 0.16, 8, 28));
  domeRimGeo.rotateX(Math.PI / 2);
  domeRimGeo.scale(1.1, 1.38, 1);

  const domePlinthGeo = trackGeo(new THREE.CylinderGeometry(3.05, 3.15, 0.36, 24));
  domePlinthGeo.scale(1.1, 1, 1.38);

  for (const dz of [33.2, 124.5]) {
    const dy = dz < 60 ? 15.14 : 15.1;
    const tgt = dz < BREAK_Z ? bowContent : sternContent;
    const plinth = new THREE.Mesh(domePlinthGeo, whitePaintMat);
    plinth.position.set(0, dy - 0.08, dz);
    tgt.add(plinth);

    const domeGlass = new THREE.Mesh(domeGlassGeo, warmGlowMat);
    domeGlass.position.set(0, dy, dz);
    tgt.add(domeGlass);

    const domeRim = new THREE.Mesh(domeRimGeo, creamTrimMat);
    domeRim.position.set(0, dy, dz);
    tgt.add(domeRim);
  }

  // Cantilevered Bridge Wings flush with Boat Deck (y = 12.58..12.88) extending to +/- 15.4m
  const bridgeWingDeck = new THREE.Mesh(
    trackGeo(buildCurvedDeckhouseGeo(15.4, -2.3, 1.8, 0.3, 0.35, 0.35, 0.0)),
    teakDeckMat,
  );
  bridgeWingDeck.position.y = 12.58;
  bridgeWingDeck.receiveShadow = true;
  bowContent.add(bridgeWingDeck);

  const wingKneeGeo = trackGeo(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, -1.85, 0),
        new THREE.Vector3(1.45, -1.1, 0),
        new THREE.Vector3(2.9, -0.04, 0),
      ]),
      10,
      0.16,
      8,
      false,
    ),
  );
  for (const side of [-1, 1]) {
    // Wing front dodger wall spans seamlessly from Wheelhouse wall (4.4m) out to Wing Cab (15.35m)
    const wingWall = new THREE.Mesh(
      trackGeo(buildCurvedDeckhouseGeo(5.55, -2.25, -1.85, 1.24, 0.12, 0.12, 0.02)),
      whitePaintMat,
    );
    wingWall.position.set(side * 9.85, 12.86, 0);
    bowContent.add(wingWall);

    // Bridge wing aft railing connecting wheelhouse aft posts to outer wing cab
    buildRailSegment(bowContent, side * 4.45, 12.88, 1.72, side * 15.25, 12.88, 1.72);
    for (const px of [6.5, 9.5, 12.5, 15.1]) {
      const wPost = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.045, 0.045, 1.06, 6)), whitePaintMat);
      wPost.position.set(side * px, 13.4, 1.72);
      bowContent.add(wPost);
    }

    const wingCab = new THREE.Mesh(
      trackGeo(buildCurvedDeckhouseGeo(0.45, -2.25, 1.75, 1.32, 0.22, 0.22, 0.03)),
      whitePaintMat,
    );
    wingCab.position.set(side * 15.15, 12.86, 0);
    bowContent.add(wingCab);

    for (const kz of [-1.5, 0.9]) {
      const knee = new THREE.Mesh(wingKneeGeo, whitePaintMat);
      knee.position.set(side * 12.3, 12.68, kz);
      knee.scale.x = side;
      bowContent.add(knee);
    }

    const navLight = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.25, 12, 12)),
      side < 0 ? portLightMat : starboardLightMat,
    );
    navLight.position.set(side * 15.32, 14.32, -2.0);
    bowContent.add(navLight);
  }

  // =========================================================================
  // 4. ALL 4 TOWERING ELLIPTICAL OLYMPIC-CLASS FUNNELS (~20m ABOVE BOAT DECK)
  // =========================================================================
  const funnelZPositions = [26.0, 56.0, 86.0, 118.0];
  const funnelShaftGeo = trackGeo(new THREE.CylinderGeometry(2.65, 3.12, 17.2, 32));
  const funnelFidleyGeo = trackGeo(buildCurvedDeckhouseGeo(3.45, -4.15, 4.15, 1.15, 0.65, 0.65, 0.06));
  const funnelBandGeo = trackGeo(new THREE.CylinderGeometry(2.74, 2.68, 3.6, 32));
  const funnelLipGeo = trackGeo(new THREE.TorusGeometry(2.7, 0.14, 8, 32));
  funnelLipGeo.rotateX(Math.PI / 2);
  const funnelFlueGeo = trackGeo(new THREE.CircleGeometry(2.5, 28));
  funnelFlueGeo.rotateX(-Math.PI / 2);
  const funnelSeamGeo = trackGeo(new THREE.TorusGeometry(2.88, 0.055, 6, 32));
  funnelSeamGeo.rotateX(Math.PI / 2);
  const funnelPipeGeo = trackGeo(new THREE.CylinderGeometry(0.16, 0.18, 18.6, 10));
  const whistleBellGeo = trackGeo(new THREE.CylinderGeometry(0.26, 0.14, 0.56, 12));
  const guyWireGeo = trackGeo(new THREE.CylinderGeometry(0.032, 0.032, 1, 5));

  for (const fz of funnelZPositions) {
    const tgt = fz < BREAK_Z ? bowContent : sternContent;

    // Raised Boiler Fidley Casing anchoring each funnel seamlessly to Boat Deck
    const fidley = new THREE.Mesh(funnelFidleyGeo, whitePaintMat);
    fidley.position.set(0, 12.65, fz);
    fidley.castShadow = true;
    tgt.add(fidley);

    const funnelGroup = new THREE.Group();
    funnelGroup.position.set(0, 12.85, fz);
    funnelGroup.rotation.x = 0.088; // ~5° aft rake
    funnelGroup.scale.set(0.86, 1, 1.15);

    // Shaft extends -1.0m below y=0 inside the fidley casing so the raked front edge never lifts clear
    const shaft = new THREE.Mesh(funnelShaftGeo, buffFunnelMat);
    shaft.position.y = 7.6;
    shaft.castShadow = true;
    funnelGroup.add(shaft);

    for (const sy of [3.5, 7.6, 11.8, 15.2]) {
      const seam = new THREE.Mesh(funnelSeamGeo, buffFunnelMat);
      seam.position.y = sy;
      seam.scale.setScalar(1.04 - sy * 0.008);
      funnelGroup.add(seam);
    }

    const topBand = new THREE.Mesh(funnelBandGeo, darkIronMat);
    topBand.position.y = 17.8;
    funnelGroup.add(topBand);

    const topLip = new THREE.Mesh(funnelLipGeo, darkIronMat);
    topLip.position.y = 19.62;
    funnelGroup.add(topLip);

    const darkFlue = new THREE.Mesh(funnelFlueGeo, darkIronMat);
    darkFlue.position.y = 19.48;
    funnelGroup.add(darkFlue);

    for (const px of [-0.35, 0.35]) {
      const pipe = new THREE.Mesh(funnelPipeGeo, brassMat);
      pipe.position.set(px, 8.5, -2.96);
      funnelGroup.add(pipe);

      const chime = new THREE.Mesh(whistleBellGeo, brassMat);
      chime.position.set(px, 16.5, -3.15);
      funnelGroup.add(chime);

      // Auxiliary iron steam-escape exhaust pipe up the aft flank of each funnel
      const steamPipe = new THREE.Mesh(funnelPipeGeo, darkIronMat);
      steamPipe.scale.set(0.62, 0.96, 0.62);
      steamPipe.position.set(px * 0.9, 8.2, 2.95);
      funnelGroup.add(steamPipe);
    }

    tgt.add(funnelGroup);

    // 6 Taut Steel Guy Stays per funnel anchored down to Boat Deck (clamped inside its half)
    const guyAnchors: Array<[number, number, number, number]> = [
      [-2.2, -2.2, -11.4, -7.8],
      [2.2, -2.2, 11.4, -7.8],
      [-2.4, 0.2, -11.8, 0.6],
      [2.4, 0.2, 11.8, 0.6],
      [-2.2, 2.4, -11.4, fz < BREAK_Z ? Math.min(3.5, BREAK_Z - 0.5 - fz) : 8.2],
      [2.2, 2.4, 11.4, fz < BREAK_Z ? Math.min(3.5, BREAK_Z - 0.5 - fz) : 8.2],
    ];
    for (const [tx, tz, bx, bz] of guyAnchors) {
      const topPt = new THREE.Vector3(tx, 29.8, fz + tz + 1.45);
      const botPt = new THREE.Vector3(bx, 12.9, fz + bz);
      const dir = new THREE.Vector3().subVectors(botPt, topPt);
      const len = dir.length();
      const wire = new THREE.Mesh(guyWireGeo, darkIronMat);
      wire.position.copy(topPt).addScaledVector(dir, 0.5);
      wire.scale.set(1, len, 1);
      wire.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      tgt.add(wire);
    }
  }

  // Animated Walking & Running Crew, Passengers & 16 Sculpted Lifeboats
  const crewAndLifeboats = createCrewAndLifeboats(
    bowContent,
    sternContent,
    whitePaintMat,
    teakDeckMat,
    BREAK_Z,
  );

  // =========================================================================
  // 5. 400+ BRASS-RIMMED PORTHOLES & GLOWING PROMENADE WINDOWS
  // =========================================================================
  const portholeGeo = trackGeo(new THREE.CircleGeometry(0.28, 12));
  const brassRimGeo = trackGeo(new THREE.RingGeometry(0.26, 0.35, 12));
  const portholePositions: Array<{ x: number; y: number; z: number; rotY: number; scaleX: number }> = [];

  for (const side of [-1, 1]) {
    for (let z = -58; z <= 184; z += 4.6) {
      const { beam, sheerY } = sampleHullStation(z);
      const { beam: beamNext } = sampleHullStation(z + 1.5);
      const slopeAngle = Math.atan2((beamNext - beam) * side, 1.5);

      for (const dy of [1.4, 3.0, 4.5]) {
        const x = side * (beam * 0.99 + 0.08);
        const y = sheerY - dy;
        if (y > 1.2) {
          portholePositions.push({
            x,
            y,
            z,
            rotY: (side > 0 ? Math.PI / 2 : -Math.PI / 2) - slopeAngle,
            scaleX: 1,
          });
        }
      }
    }

    // Glowing Promenade & Cabin Windows along B-Deck & A-Deck (158m long!)
    for (let z = -7; z <= 144; z += 2.9) {
      portholePositions.push({
        x: side * 13.48,
        y: 8.35,
        z,
        rotY: side > 0 ? Math.PI / 2 : -Math.PI / 2,
        scaleX: 1.9,
      });
      portholePositions.push({
        x: side * 11.43,
        y: 11.25,
        z,
        rotY: side > 0 ? Math.PI / 2 : -Math.PI / 2,
        scaleX: 2.05,
      });
    }
  }

  const fwdPortholes = portholePositions.filter((p) => p.z < BREAK_Z);
  const aftPortholes = portholePositions.filter((p) => p.z >= BREAK_Z);
  const pDummy = new THREE.Object3D();

  for (const [list, tgt] of [
    [fwdPortholes, bowContent],
    [aftPortholes, sternContent],
  ] as const) {
    const pInst = new THREE.InstancedMesh(portholeGeo, portholeGlowMat, list.length);
    const rInst = new THREE.InstancedMesh(brassRimGeo, brassMat, list.length);
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      pDummy.position.set(p.x, p.y, p.z);
      pDummy.rotation.set(0, p.rotY, 0);
      pDummy.scale.set(p.scaleX, 1, 1);
      pDummy.updateMatrix();
      pInst.setMatrixAt(i, pDummy.matrix);

      pDummy.position.set(p.x + (p.x > 0 ? 0.018 : -0.018), p.y, p.z);
      pDummy.updateMatrix();
      rInst.setMatrixAt(i, pDummy.matrix);
    }
    pInst.instanceMatrix.needsUpdate = true;
    pInst.computeBoundingSphere();
    rInst.instanceMatrix.needsUpdate = true;
    rInst.computeBoundingSphere();
    tgt.add(pInst);
    tgt.add(rInst);
  }

  // =========================================================================
  // 6. FOREMAST, CROW'S NEST, AFT MAINMAST, SHROUDS & 200m MARCONI AERIALS
  // =========================================================================
  const foremast = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.16, 0.38, 42.5, 14)), buffFunnelMat);
  foremast.position.set(0, 27.25, -22.5);
  foremast.castShadow = true;
  bowContent.add(foremast);

  const foremastCollar = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.46, 0.62, 0.72, 14)), whitePaintMat);
  foremastCollar.position.set(0, 6.72, -22.5);
  bowContent.add(foremastCollar);

  const crowsNest = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(1.05, 0.76, 1.55, 18)), whitePaintMat);
  crowsNest.position.set(0, 25.8, -22.5);
  crowsNest.castShadow = true;
  bowContent.add(crowsNest);

  const crowsNestFloor = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.76, 0.76, 0.16, 18)), teakDeckMat);
  crowsNestFloor.position.set(0, 25.08, -22.5);
  bowContent.add(crowsNestFloor);

  const crowsNestRim = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(1.05, 0.09, 8, 24)), teakDeckMat);
  crowsNestRim.rotation.x = Math.PI / 2;
  crowsNestRim.position.set(0, 26.58, -22.5);
  bowContent.add(crowsNestRim);

  const mastLantern = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.28, 12, 12)), warmGlowMat);
  mastLantern.position.set(0, 31.8, -22.5);
  bowContent.add(mastLantern);

  const yardarm = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.08, 0.12, 12.6, 10)), buffFunnelMat);
  yardarm.rotation.z = Math.PI / 2;
  yardarm.position.set(0, 36.2, -22.5);
  bowContent.add(yardarm);

  // Aft Mainmast (z = 178)
  const mainMast = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.16, 0.36, 40.5, 14)), buffFunnelMat);
  mainMast.position.set(0, 27.25, 178.0);
  mainMast.rotation.x = 0.06;
  sternContent.add(mainMast);

  const mainMastCollar = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.44, 0.6, 0.72, 14)), whitePaintMat);
  mainMastCollar.position.set(0, 8.6, 176.86);
  sternContent.add(mainMastCollar);

  const mainYardarm = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.08, 0.12, 11.0, 10)), buffFunnelMat);
  mainYardarm.rotation.z = Math.PI / 2;
  mainYardarm.position.set(0, 36.0, 178.52);
  sternContent.add(mainYardarm);

  const sternLantern = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.26, 10, 10)), warmGlowMat);
  sternLantern.position.set(0, 31.5, 178.25);
  sternContent.add(sternLantern);

  // Wire Shrouds, Forestay & 200-meter 4-Wire Marconi Aerial Array (Aerials snap at breakup!)
  const stayMat = trackMat(new THREE.MeshBasicMaterial({ color: 0x4b5868 }));
  const addCable = (tgt: THREE.Group, a: THREE.Vector3, b: THREE.Vector3, radius = 0.036) => {
    const geo = trackGeo(new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 4, radius, 6, false));
    tgt.add(new THREE.Mesh(geo, stayMat));
  };
  addCable(bowContent, new THREE.Vector3(0, 44.5, -22.5), new THREE.Vector3(0, 10.3, -72.5), 0.048);
  for (const sx of [-10.5, 10.5]) {
    addCable(bowContent, new THREE.Vector3(0, 41.0, -22.5), new THREE.Vector3(sx, 9.2, -42));
    addCable(bowContent, new THREE.Vector3(0, 27.0, -22.5), new THREE.Vector3(sx * 1.15, 6.8, -25));
    addCable(bowContent, new THREE.Vector3(0, 27.0, -22.5), new THREE.Vector3(sx * 1.15, 6.8, -19));
    addCable(sternContent, new THREE.Vector3(0, 41.0, 178.8), new THREE.Vector3(sx * 0.85, 8.6, 173));
    addCable(sternContent, new THREE.Vector3(0, 41.0, 178.8), new THREE.Vector3(sx * 0.85, 8.6, 181));
  }

  const marconiAerialsGroup = new THREE.Group();
  hullMeshGroup.add(marconiAerialsGroup);
  for (const mx of [-1.4, -0.46, 0.46, 1.4]) {
    addCable(marconiAerialsGroup, new THREE.Vector3(mx, 46.8, -22.5), new THREE.Vector3(mx, 46.2, 179.0), 0.028);
  }

  // =========================================================================
  // 6A. AUTHENTIC OLYMPIC-CLASS SHIP DETAILS (PARTITIONED AT BREAK_Z = 90)
  // =========================================================================
  // (a) Gold "TITANIC" Bow Nameplates & "TITANIC · LIVERPOOL" Stern Badges
  const bowNameMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.hullNameplateBow,
      transparent: true,
      alphaTest: 0.08,
      roughness: 0.32,
      metalness: 0.65,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      side: THREE.DoubleSide,
    }),
  );
  const sternNameMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.hullNameplateStern,
      transparent: true,
      alphaTest: 0.08,
      roughness: 0.32,
      metalness: 0.65,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      side: THREE.DoubleSide,
    }),
  );

  const bowNameGeo = trackGeo(new THREE.PlaneGeometry(6.6, 1.65));
  const sternNameGeo = trackGeo(new THREE.PlaneGeometry(5.6, 1.75));
  const { beam: bFore, sheerY: yFore, flareFactor: fFore } = sampleHullStation(-65.5);
  const { beam: bAft, sheerY: yAft, flareFactor: fAft } = sampleHullStation(-59.5);
  const xBowFore = bFore * (0.88 + 0.12 * 0.85 + 0.72 * fFore);
  const xBowAft = bAft * (0.88 + 0.12 * 0.85 + 0.72 * fAft);
  const bowSlopeYaw = Math.atan2(xBowAft - xBowFore, 6.0);

  for (const side of [-1, 1] as const) {
    const bowPlate = new THREE.Mesh(bowNameGeo, bowNameMat);
    bowPlate.position.set(side * ((xBowFore + xBowAft) * 0.5 + 0.07), (yFore + yAft) * 0.5 - 1.35, -62.5);
    bowPlate.rotation.y = (side > 0 ? Math.PI / 2 : -Math.PI / 2) + side * bowSlopeYaw;
    bowContent.add(bowPlate);

    const { beam: sb1 } = sampleHullStation(184.5);
    const { beam: sb2 } = sampleHullStation(189.5);
    const sternYaw = Math.atan2(sb2 - sb1, 5.0);
    const sternPlate = new THREE.Mesh(sternNameGeo, sternNameMat);
    sternPlate.position.set(side * ((sb1 + sb2) * 0.5 + 0.07), 7.2, 187.0);
    sternPlate.rotation.y = (side > 0 ? Math.PI / 2 : -Math.PI / 2) + side * sternYaw;
    sternContent.add(sternPlate);
  }

  // (b) Geared Anchor Windlass Machinery on Forecastle (z = -59.5, y = 9.2)
  const windlassGroup = new THREE.Group();
  windlassGroup.position.set(0, 9.2, -59.5);
  const windlassShaft = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.24, 0.24, 5.8, 12)), darkIronMat);
  windlassShaft.rotation.z = Math.PI / 2;
  windlassShaft.position.y = 0.65;
  windlassGroup.add(windlassShaft);
  const gearWheelGeo = trackGeo(new THREE.CylinderGeometry(0.68, 0.68, 0.24, 18));
  gearWheelGeo.rotateZ(Math.PI / 2);
  for (const gx of [-2.2, -0.7, 0.7, 2.2]) {
    const gw = new THREE.Mesh(gearWheelGeo, Math.abs(gx) < 1 ? bronzeMat : darkIronMat);
    gw.position.set(gx, 0.65, 0);
    windlassGroup.add(gw);
  }
  const windlassPedestalGeo = trackGeo(new THREE.BoxGeometry(0.38, 0.9, 1.15));
  for (const px of [-2.75, 0, 2.75]) {
    const ped = new THREE.Mesh(windlassPedestalGeo, darkIronMat);
    ped.position.set(px, 0.45, 0);
    windlassGroup.add(ped);
  }
  bowContent.add(windlassGroup);

  // (c) Twin-Horn Cast-Iron Mooring Bollards (InstancedMesh, Bow & Stern Halves)
  const bollardPlateGeo = trackGeo(new THREE.BoxGeometry(0.55, 0.1, 1.1));
  const bollardHornGeo = trackGeo(new THREE.CylinderGeometry(0.14, 0.12, 0.55, 10));
  const addBollards = (tgt: THREE.Group, spots: Array<[number, number, number, number]>) => {
    const plateInst = new THREE.InstancedMesh(bollardPlateGeo, darkIronMat, spots.length);
    const hornInst = new THREE.InstancedMesh(bollardHornGeo, darkIronMat, spots.length * 2);
    const bDummy = new THREE.Object3D();
    let hIdx = 0;
    for (let i = 0; i < spots.length; i++) {
      const [bx, by, bz, ry] = spots[i];
      bDummy.position.set(bx, by + 0.05, bz);
      bDummy.rotation.set(0, ry, 0);
      bDummy.updateMatrix();
      plateInst.setMatrixAt(i, bDummy.matrix);
      for (const dz of [-0.28, 0.28]) {
        bDummy.position.set(bx + Math.sin(ry) * dz, by + 0.34, bz + Math.cos(ry) * dz);
        bDummy.updateMatrix();
        hornInst.setMatrixAt(hIdx++, bDummy.matrix);
      }
    }
    plateInst.instanceMatrix.needsUpdate = true;
    hornInst.instanceMatrix.needsUpdate = true;
    tgt.add(plateInst);
    tgt.add(hornInst);
  };
  addBollards(bowContent, [
    [-4.2, 9.2, -61.0, 0.32],
    [4.2, 9.2, -61.0, -0.32],
    [-7.6, 9.2, -49.5, 0.24],
    [7.6, 9.2, -49.5, -0.24],
    [-10.6, 9.2, -38.5, 0.12],
    [10.6, 9.2, -38.5, -0.12],
    [-11.8, 6.62, -31.5, 0],
    [11.8, 6.62, -31.5, 0],
    [-11.8, 6.62, -13.5, 0],
    [11.8, 6.62, -13.5, 0],
  ]);
  addBollards(sternContent, [
    [-11.4, 6.62, 151.5, 0],
    [11.4, 6.62, 151.5, 0],
    [-11.2, 6.62, 166.5, 0],
    [11.2, 6.62, 166.5, 0],
    [-9.2, 8.4, 176.5, -0.18],
    [9.2, 8.4, 176.5, 0.18],
    [-6.6, 8.4, 187.5, -0.35],
    [6.6, 8.4, 187.5, 0.35],
  ]);

  // (d) Electric Cargo Winches & Rigged Mast Cargo Derrick Booms
  const winchDrumGeo = trackGeo(new THREE.CylinderGeometry(0.42, 0.42, 1.35, 12));
  winchDrumGeo.rotateZ(Math.PI / 2);
  const winchFrameGeo = trackGeo(new THREE.BoxGeometry(1.65, 0.85, 1.25));
  for (const [wx, wy, wz] of [
    [-4.3, 6.62, -23.0],
    [4.3, 6.62, -23.0],
    [-4.2, 6.62, 159.2],
    [4.2, 6.62, 159.2],
  ]) {
    const wGrp = new THREE.Group();
    wGrp.position.set(wx, wy, wz);
    const frame = new THREE.Mesh(winchFrameGeo, darkIronMat);
    frame.position.y = 0.42;
    wGrp.add(frame);
    const drum = new THREE.Mesh(winchDrumGeo, bronzeMat);
    drum.position.y = 0.92;
    wGrp.add(drum);
    (wz < BREAK_Z ? bowContent : sternContent).add(wGrp);
  }
  for (const side of [-1, 1]) {
    // Foremast Cargo Derricks aimed over Forward Cargo Hatches
    addCable(bowContent, new THREE.Vector3(side * 0.45, 12.2, -22.5), new THREE.Vector3(side * 3.8, 17.6, -31.5), 0.11);
    addCable(bowContent, new THREE.Vector3(0, 22.8, -22.5), new THREE.Vector3(side * 3.8, 17.6, -31.5), 0.024);
    // Mainmast Cargo Derricks aimed over Aft Well Deck
    addCable(sternContent, new THREE.Vector3(side * 0.45, 12.4, 177.8), new THREE.Vector3(side * 3.8, 17.4, 166.0), 0.11);
    addCable(sternContent, new THREE.Vector3(0, 22.8, 178.1), new THREE.Vector3(side * 3.8, 17.4, 166.0), 0.024);
  }

  // (e) Forward A-Deck Enclosed Promenade Screen (z = -6.8..46, flush with A-Deck & Boat Deck corners)
  const mullionGeo = trackGeo(new THREE.BoxGeometry(0.12, 2.78, 0.24));
  const waistPanelGeo = trackGeo(new THREE.BoxGeometry(0.1, 0.98, 52.8));
  for (const side of [-1, 1]) {
    const waist = new THREE.Mesh(waistPanelGeo, whitePaintMat);
    waist.position.set(side * 13.36, 10.35, 19.6);
    bowContent.add(waist);

    // Angled forward corner screen closing enclosed promenade flush into A-Deck house wall
    const endScreen = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(2.2, 2.78, 0.14)), whitePaintMat);
    endScreen.position.set(side * 12.35, 11.24, -6.8);
    bowContent.add(endScreen);
  }
  const fwdScreenCount = 27 * 2;
  const fwdScreenInst = new THREE.InstancedMesh(mullionGeo, whitePaintMat, fwdScreenCount);
  let mIdx = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 27; i++) {
      sDummy.position.set(side * 13.38, 11.24, -6.5 + i * 1.98);
      sDummy.rotation.set(0, 0, 0);
      sDummy.updateMatrix();
      fwdScreenInst.setMatrixAt(mIdx++, sDummy.matrix);
    }
  }
  fwdScreenInst.instanceMatrix.needsUpdate = true;
  bowContent.add(fwdScreenInst);

  // (f) Continuous Boat Deck Teak-Capped Railings (Strictly partitioned at BREAK_Z)
  for (const side of [-1, 1]) {
    buildRailSegment(bowContent, side * 13.48, 12.88, -9.2, side * 13.48, 12.88, BREAK_Z - 0.12);
    buildRailSegment(sternContent, side * 13.48, 12.88, BREAK_Z + 0.12, side * 13.48, 12.88, 147.2);
  }
  buildRailSegment(sternContent, -12.6, 12.88, 147.8, 12.6, 12.88, 147.8);

  // (g) 4 Engelhardt Collapsible Lifeboats (2 on Officer's Quarters Roof + 2 beside Funnel #1)
  const collapHullGeo = trackGeo(buildCurvedDeckhouseGeo(0.95, -2.55, 2.55, 0.56, 0.72, 0.72, 0.05));
  const collapCoverGeo = trackGeo(buildCurvedDeckhouseGeo(0.9, -2.4, 2.4, 0.18, 0.65, 0.65, 0.04));
  for (const [cx, cy, cz] of [
    [-4.3, 15.38, 11.0],
    [4.3, 15.38, 11.0],
    [-4.9, 12.88, 21.5],
    [4.9, 12.88, 21.5],
  ]) {
    const cg = new THREE.Group();
    cg.position.set(cx, cy, cz);
    cg.add(new THREE.Mesh(collapHullGeo, teakDeckMat));
    const cover = new THREE.Mesh(collapCoverGeo, creamTrimMat);
    cover.position.y = 0.56;
    cg.add(cover);
    bowContent.add(cg);
  }

  // (h) 36 Slatted Teak Steamer Chairs & 24 Red-and-White Lifebuoy Rings (InstancedMesh)
  const chairBackGeo = trackGeo(new THREE.BoxGeometry(0.56, 0.06, 1.48));
  const chairLegGeo = trackGeo(new THREE.BoxGeometry(0.54, 0.42, 0.78));
  const chairSpots: Array<{ x: number; y: number; z: number; ry: number }> = [];
  for (const side of [-1, 1]) {
    for (let z = 0; z <= 138; z += 8.6) {
      if (Math.abs(z - BREAK_Z) < 1.2) continue;
      chairSpots.push({ x: side * 11.78, y: 9.86, z, ry: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
    }
  }
  for (const [grpSpots, tgt] of [
    [chairSpots.filter((c) => c.z < BREAK_Z), bowContent],
    [chairSpots.filter((c) => c.z >= BREAK_Z), sternContent],
  ] as const) {
    const backInst = new THREE.InstancedMesh(chairBackGeo, teakDeckMat, grpSpots.length);
    const legInst = new THREE.InstancedMesh(chairLegGeo, darkIronMat, grpSpots.length);
    for (let i = 0; i < grpSpots.length; i++) {
      const sp = grpSpots[i];
      sDummy.position.set(sp.x, sp.y + 0.42, sp.z);
      sDummy.rotation.set(0, sp.ry, -0.35);
      sDummy.updateMatrix();
      backInst.setMatrixAt(i, sDummy.matrix);
      sDummy.position.set(sp.x, sp.y + 0.21, sp.z);
      sDummy.rotation.set(0, sp.ry, 0);
      sDummy.updateMatrix();
      legInst.setMatrixAt(i, sDummy.matrix);
    }
    backInst.instanceMatrix.needsUpdate = true;
    legInst.instanceMatrix.needsUpdate = true;
    tgt.add(backInst);
    tgt.add(legInst);
  }

  const lifebuoyGeo = trackGeo(new THREE.TorusGeometry(0.36, 0.085, 8, 16));
  const lifebuoyMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xefece6, roughness: 0.55 }));
  const buoyBandMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.5 }));
  const buoySpots: Array<{ x: number; y: number; z: number; ry: number }> = [];
  for (const side of [-1, 1]) {
    buoySpots.push({ x: side * 15.32, y: 13.72, z: -0.4, ry: side > 0 ? Math.PI / 2 : -Math.PI / 2 });
    for (let z = 6; z <= 142; z += 14.5) {
      if (Math.abs(z - BREAK_Z) < 1.2) continue;
      buoySpots.push({ x: side * 13.42, y: 11.15, z, ry: side > 0 ? Math.PI / 2 : -Math.PI / 2 });
    }
    buoySpots.push({ x: side * 9.5, y: 9.0, z: 181.5, ry: side > 0 ? Math.PI / 2 : -Math.PI / 2 });
  }
  for (const [grpSpots, tgt] of [
    [buoySpots.filter((b) => b.z < BREAK_Z), bowContent],
    [buoySpots.filter((b) => b.z >= BREAK_Z), sternContent],
  ] as const) {
    const ringInst = new THREE.InstancedMesh(lifebuoyGeo, lifebuoyMat, grpSpots.length);
    const bandInst = new THREE.InstancedMesh(
      trackGeo(new THREE.CylinderGeometry(0.092, 0.092, 0.16, 8)),
      buoyBandMat,
      grpSpots.length,
    );
    for (let i = 0; i < grpSpots.length; i++) {
      const b = grpSpots[i];
      sDummy.position.set(b.x, b.y, b.z);
      sDummy.rotation.set(0, b.ry, 0);
      sDummy.updateMatrix();
      ringInst.setMatrixAt(i, sDummy.matrix);
      sDummy.position.set(b.x, b.y + 0.36, b.z);
      sDummy.rotation.set(0, b.ry, Math.PI / 2);
      sDummy.updateMatrix();
      bandInst.setMatrixAt(i, sDummy.matrix);
    }
    ringInst.instanceMatrix.needsUpdate = true;
    bandInst.instanceMatrix.needsUpdate = true;
    tgt.add(ringInst);
    tgt.add(bandInst);
  }

  // (i) Pitched Skylights atop Lounge & Smoking Room + Marconi Lead-In Spreader
  const skylightGeo = trackGeo(new THREE.CylinderGeometry(1.15, 1.15, 4.4, 6, 1, false, 0, Math.PI));
  skylightGeo.rotateZ(Math.PI / 2);
  skylightGeo.rotateY(Math.PI / 2);
  for (const sz of [69.0, 76.5, 97.5, 106.5]) {
    const sky = new THREE.Mesh(skylightGeo, warmGlowMat);
    sky.position.set(0, 15.05, sz);
    (sz < BREAK_Z ? bowContent : sternContent).add(sky);
  }
  const spreader = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 8)), whitePaintMat);
  spreader.rotation.z = Math.PI / 2;
  spreader.position.set(0, 46.5, 46.5);
  marconiAerialsGroup.add(spreader);
  addCable(marconiAerialsGroup, new THREE.Vector3(-0.6, 46.5, 46.5), new THREE.Vector3(-0.6, 15.0, 46.5), 0.022);
  addCable(marconiAerialsGroup, new THREE.Vector3(0.6, 46.5, 46.5), new THREE.Vector3(0.6, 15.0, 46.5), 0.022);

  // (j) Forecastle White Star Burgee Mast & Cruiser Stern Red Ensign Flagstaff
  const bowStaff = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.04, 0.075, 5.4, 8)), whitePaintMat);
  bowStaff.position.set(0, 11.9, -73.7);
  bowContent.add(bowStaff);
  const wsFlagMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.whiteStarPennant,
      transparent: true,
      alphaTest: 0.1,
      roughness: 0.72,
      side: THREE.DoubleSide,
    }),
  );
  const wsFlag = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(2.4, 1.2)), wsFlagMat);
  wsFlag.position.set(0.04, 13.9, -72.5);
  wsFlag.rotation.y = Math.PI / 2 + 0.14;
  bowContent.add(wsFlag);

  const sternStaff = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.045, 0.08, 6.4, 8)), whitePaintMat);
  sternStaff.position.set(0, 11.5, 194.2);
  sternStaff.rotation.x = 0.18;
  sternContent.add(sternStaff);
  const ensignMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.redEnsignFlag,
      roughness: 0.72,
      side: THREE.DoubleSide,
    }),
  );
  const ensignFlag = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(3.2, 1.6)), ensignMat);
  ensignFlag.position.set(0.04, 13.5, 196.1);
  ensignFlag.rotation.y = Math.PI / 2 + 0.12;
  sternContent.add(ensignFlag);

  // =========================================================================
  // 6B. EXPOSED TORN STEEL INTERIOR FRACTURE CROSS-SECTIONS (AT z = BREAK_Z)
  // =========================================================================
  const tornSteelMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1e2228,
      roughness: 0.78,
      metalness: 0.62,
      side: THREE.DoubleSide,
    }),
  );
  const tornRustedIronMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x3b261d,
      roughness: 0.84,
      metalness: 0.45,
    }),
  );
  const breakEmberMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffa44d,
      emissive: 0xff6a1a,
      emissiveIntensity: 1.2,
      roughness: 0.4,
    }),
  );

  const buildFractureBulkhead = (dirZ: -1 | 1): THREE.Group => {
    const cap = new THREE.Group();
    cap.position.set(0, 0, BREAK_Z - dirZ * 0.18);

    // Outer hull cross-section silhouette (keel y=-6.5 up to B-Deck sheer y=6.8, half-beam 14.0)
    const hullFaceShape = new THREE.Shape();
    hullFaceShape.moveTo(0, -6.5);
    hullFaceShape.quadraticCurveTo(11.8, -5.9, 12.3, -2.5);
    hullFaceShape.lineTo(14.0, 6.8);
    hullFaceShape.lineTo(13.4, 6.8);
    hullFaceShape.lineTo(13.4, 9.6);
    hullFaceShape.lineTo(11.35, 9.8);
    hullFaceShape.lineTo(11.35, 12.6);
    hullFaceShape.lineTo(-11.35, 12.6);
    hullFaceShape.lineTo(-11.35, 9.8);
    hullFaceShape.lineTo(-13.4, 9.6);
    hullFaceShape.lineTo(-13.4, 6.8);
    hullFaceShape.lineTo(-14.0, 6.8);
    hullFaceShape.lineTo(-12.3, -2.5);
    hullFaceShape.quadraticCurveTo(-11.8, -5.9, 0, -6.5);

    const faceGeo = trackGeo(new THREE.ExtrudeGeometry(hullFaceShape, { depth: 0.55, bevelEnabled: false }));
    const faceMesh = new THREE.Mesh(faceGeo, tornSteelMat);
    faceMesh.position.z = dirZ > 0 ? -0.35 : -0.2;
    cap.add(faceMesh);

    // Interior Deck Floors & Vertical Boiler Room Bulkhead Ribs
    for (const dy of [-2.2, 1.4, 4.4, 6.85, 9.75, 12.65]) {
      const w = dy < 6 ? 25.0 : dy < 9 ? 26.4 : 22.4;
      const slab = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w, 0.28, 1.35)), tornRustedIronMat);
      slab.position.set(0, dy, dirZ * 0.32);
      cap.add(slab);
    }
    for (let rx = -10.5; rx <= 10.5; rx += 3.5) {
      const rib = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.28, 16.2, 0.95)), tornSteelMat);
      rib.position.set(rx, 2.2, dirZ * 0.25);
      rib.rotation.z = (rx / 12) * dirZ * 0.08;
      cap.add(rib);
    }

    // Jagged Torn Steel Plate Shards & Bent Girders Jutting Unevenly Outward
    for (let ji = 0; ji < 16; ji++) {
      const xPos = -12.6 + ji * 1.68;
      const yPos = -3.8 + ((ji * 7) % 15) * 1.05;
      const jutLen = 0.65 + ((ji * 13) % 7) * 0.28;
      const shard = new THREE.Mesh(
        trackGeo(new THREE.ConeGeometry(0.42 + (ji % 3) * 0.18, jutLen, 4)),
        ji % 2 === 0 ? tornSteelMat : tornRustedIronMat,
      );
      shard.rotation.x = dirZ * (Math.PI / 2 + ((ji % 5) - 2) * 0.14);
      shard.rotation.z = ((ji % 4) - 1.5) * 0.22;
      shard.position.set(xPos, yPos, dirZ * (jutLen * 0.45 + 0.15));
      cap.add(shard);
    }

    // Recessed Warm Interior Boiler / Corridor Ember Panels (fade out as dynamos fail)
    for (const [ex, ey] of [
      [-4.8, 3.2],
      [4.8, 3.2],
      [-6.5, 8.2],
      [6.5, 8.2],
      [0, 11.1],
    ]) {
      const ember = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(3.2, 1.45)), breakEmberMat);
      ember.position.set(ex, ey, dirZ * 0.36);
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
  // 7. WHEELHOUSE INTERIOR (Mahogany, Brass, Chart Table, Helm, Telegraphs)
  // =========================================================================
  const wheelhouse = new THREE.Group();
  wheelhouse.position.set(0, 12.9, 0);
  bowContent.add(wheelhouse);

  const whFloor = new THREE.Mesh(
    trackGeo(buildCurvedDeckhouseGeo(4.55, -1.65, 3.0, 0.16, 0.58, 0.22, 0.03)),
    teakDeckMat,
  );
  whFloor.receiveShadow = true;
  wheelhouse.add(whFloor);

  const frontWainscot = new THREE.Mesh(
    trackGeo(buildCurvedDeckhouseGeo(4.45, -1.7, -1.2, 1.05, 0.58, 0.05, 0.04)),
    mahoganyMat,
  );
  frontWainscot.position.y = 0.1;
  wheelhouse.add(frontWainscot);

  const sillTrim = new THREE.Mesh(
    trackGeo(buildCurvedDeckhouseGeo(4.5, -1.73, -1.18, 0.07, 0.58, 0.05, 0.02)),
    brassMat,
  );
  sillTrim.position.y = 1.14;
  wheelhouse.add(sillTrim);

  const frontHeader = new THREE.Mesh(
    trackGeo(buildCurvedDeckhouseGeo(4.55, -1.73, -1.18, 0.3, 0.58, 0.05, 0.04)),
    mahoganyMat,
  );
  frontHeader.position.y = 2.68;
  wheelhouse.add(frontHeader);

  const whRoof = new THREE.Mesh(
    trackGeo(buildCurvedDeckhouseGeo(4.7, -1.8, 3.15, 0.2, 0.62, 0.25, 0.05)),
    mahoganyMat,
  );
  whRoof.position.y = 2.95;
  wheelhouse.add(whRoof);

  for (const bz of [-0.5, 0.55, 1.65]) {
    const beam = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(8.7, 0.12, 0.16)), mahoganyMat);
    beam.position.set(0, 2.9, bz);
    wheelhouse.add(beam);
  }

  for (const mx of [-4.2, -2.55, -1.05, 1.05, 2.55, 4.2]) {
    const zArc = -1.38 - (1 - Math.pow(mx / 4.5, 2)) * 0.22;
    const mullion = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.055, 0.065, 1.62, 10)), mahoganyMat);
    mullion.position.set(mx, 1.94, zArc);
    wheelhouse.add(mullion);

    const brassStrip = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.022, 0.022, 1.62, 8)), brassMat);
    brassStrip.position.set(mx, 1.94, zArc + 0.05);
    wheelhouse.add(brassStrip);
  }

  for (const side of [-1, 1]) {
    const sideLower = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.22, 1.16, 4.4)), mahoganyMat);
    sideLower.position.set(side * 4.4, 0.58, 0.85);
    wheelhouse.add(sideLower);

    const sideHeader = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.22, 0.38, 4.4)), mahoganyMat);
    sideHeader.position.set(side * 4.4, 2.82, 0.85);
    wheelhouse.add(sideHeader);

    const aftPost = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.24, 1.85, 0.85)), mahoganyMat);
    aftPost.position.set(side * 4.4, 1.94, 2.65);
    wheelhouse.add(aftPost);

    // Side window mullions & glass panes sealing wheelhouse sides cleanly
    for (const wz of [-0.5, 0.55, 1.55]) {
      const sMullion = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.16, 1.66, 0.12)), mahoganyMat);
      sMullion.position.set(side * 4.4, 1.94, wz);
      wheelhouse.add(sMullion);
    }
    const sideGlass = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(3.6, 1.62)), bridgeGlassMat);
    sideGlass.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    sideGlass.position.set(side * 4.4, 1.94, 0.45);
    sideGlass.renderOrder = 5;
    wheelhouse.add(sideGlass);
  }

  // Enclose Aft Bulkhead Wall of Wheelhouse (with center doorway frame to Officer's Quarters)
  for (const ax of [-2.85, 2.85]) {
    const aftWallPanel = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(3.3, 2.95, 0.24)), mahoganyMat);
    aftWallPanel.position.set(ax, 1.48, 2.95);
    wheelhouse.add(aftWallPanel);
  }
  const aftDoorHeader = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(2.5, 0.72, 0.24)), mahoganyMat);
  aftDoorHeader.position.set(0, 2.6, 2.95);
  wheelhouse.add(aftDoorHeader);
  const aftDoorPanel = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(2.35, 2.25, 0.14)), mahoganyMat);
  aftDoorPanel.position.set(0, 1.15, 3.0);
  wheelhouse.add(aftDoorPanel);

  const frontGlass = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(8.5, 1.6)), bridgeGlassMat);
  frontGlass.position.set(0, 1.94, -1.42);
  frontGlass.renderOrder = 5;
  wheelhouse.add(frontGlass);

  // Brass Clinometer
  const clinoCase = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 20)), brassMat);
  clinoCase.rotation.x = Math.PI / 2;
  clinoCase.position.set(0, 2.79, -1.16);
  wheelhouse.add(clinoCase);

  const clinoFaceMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.clinometerDial,
      emissiveMap: textures.clinometerDial,
      emissive: new THREE.Color(0xffd79a),
      emissiveIntensity: 0.45,
      roughness: 0.35,
    }),
  );
  const clinoFace = new THREE.Mesh(trackGeo(new THREE.CircleGeometry(0.13, 20)), clinoFaceMat);
  clinoFace.position.set(0, 2.79, -1.125);
  wheelhouse.add(clinoFace);

  const clinometerNeedle = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.016, 0.1, 0.01)), portLightMat);
  clinometerNeedle.position.set(0, 2.79, -1.115);
  wheelhouse.add(clinometerNeedle);

  // Turned Lathe Ship's Helm Pedestal & 8-Spoke Wheel
  const helmPedestalGeo = trackGeo(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.28, 0),
        new THREE.Vector2(0.24, 0.12),
        new THREE.Vector2(0.16, 0.25),
        new THREE.Vector2(0.13, 0.72),
        new THREE.Vector2(0.2, 0.96),
        new THREE.Vector2(0.18, 1.08),
      ],
      18,
    ),
  );
  const helmBase = new THREE.Mesh(helmPedestalGeo, mahoganyMat);
  helmBase.position.set(0, 0.06, 0.18);
  helmBase.castShadow = true;
  wheelhouse.add(helmBase);

  const helmCollar = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.19, 0.19, 0.12, 18)), brassMat);
  helmCollar.position.set(0, 1.05, 0.18);
  wheelhouse.add(helmCollar);

  const helmIndicatorPlate = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.36, 0.04, 0.12)), brassMat);
  helmIndicatorPlate.position.set(0, 1.13, 0.02);
  wheelhouse.add(helmIndicatorPlate);

  const rudderNeedle = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.03, 0.04, 0.1)), portLightMat);
  rudderNeedle.position.set(0, 1.16, 0.02);
  wheelhouse.add(rudderNeedle);

  const helmWheel = new THREE.Group();
  helmWheel.position.set(0, 1.06, 0.28);
  wheelhouse.add(helmWheel);

  helmWheel.add(new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.46, 0.042, 14, 36)), mahoganyMat));
  const wheelOuterBrass = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.46, 0.016, 8, 36)), brassMat);
  wheelOuterBrass.position.z = 0.03;
  helmWheel.add(wheelOuterBrass);
  helmWheel.add(new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.28, 0.018, 10, 28)), brassMat));

  const wheelHub = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.095, 0.095, 0.13, 18)), brassMat);
  wheelHub.rotation.x = Math.PI / 2;
  helmWheel.add(wheelHub);

  const spokeGeo = trackGeo(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.026, 0),
        new THREE.Vector2(0.018, 0.35),
        new THREE.Vector2(0.028, 0.5),
        new THREE.Vector2(0.022, 0.62),
      ],
      10,
    ),
  );
  for (let i = 0; i < 8; i++) {
    const spoke = new THREE.Mesh(spokeGeo, i === 0 ? brassMat : mahoganyMat);
    spoke.rotation.z = (i * Math.PI) / 4;
    helmWheel.add(spoke);
  }

  // Kelvin Compass Binnacle
  const binnacleGroup = new THREE.Group();
  binnacleGroup.position.set(-0.92, 0.06, -0.32);
  wheelhouse.add(binnacleGroup);

  binnacleGroup.add(new THREE.Mesh(helmPedestalGeo, mahoganyMat));
  const binnacleHood = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.21, 0.19, 0.22, 18)), brassMat);
  binnacleHood.position.y = 1.02;
  binnacleGroup.add(binnacleHood);

  for (const sx of [-0.27, 0.27]) {
    const sphere = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.075, 14, 14)), brassMat);
    sphere.position.set(sx, 0.98, 0);
    binnacleGroup.add(sphere);
  }

  const compassCardMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.compassDial,
      emissiveMap: textures.compassDial,
      emissive: new THREE.Color(0xffca7a),
      emissiveIntensity: 0.78,
      roughness: 0.4,
    }),
  );
  const compassCard = new THREE.Mesh(trackGeo(new THREE.CircleGeometry(0.165, 24)), compassCardMat);
  compassCard.rotation.x = -Math.PI / 2 + 0.22;
  compassCard.position.set(0, 1.14, 0.02);
  binnacleGroup.add(compassCard);

  // Dual Ornate Lathed Chadburn Engine Order Telegraphs
  const telegraphPedGeo = trackGeo(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.21, 0),
        new THREE.Vector2(0.18, 0.14),
        new THREE.Vector2(0.09, 0.35),
        new THREE.Vector2(0.075, 0.78),
        new THREE.Vector2(0.11, 0.98),
      ],
      16,
    ),
  );
  const telegraphDialMats: THREE.MeshStandardMaterial[] = [];
  const makeTelegraph = (xPos: number): THREE.Group => {
    const tGroup = new THREE.Group();
    tGroup.position.set(xPos, 0.06, -0.32);
    tGroup.add(new THREE.Mesh(telegraphPedGeo, brassMat));

    const drum = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.23, 0.23, 0.16, 20)), brassMat);
    drum.rotation.z = Math.PI / 2;
    drum.position.y = 1.12;
    tGroup.add(drum);

    const dialMat = trackMat(
      new THREE.MeshStandardMaterial({
        map: textures.telegraphDial,
        emissiveMap: textures.telegraphDial,
        emissive: new THREE.Color(0xffd79a),
        emissiveIntensity: 0.68,
        roughness: 0.35,
      }),
    );
    telegraphDialMats.push(dialMat);
    const dialFace = new THREE.Mesh(trackGeo(new THREE.CircleGeometry(0.205, 24)), dialMat);
    dialFace.rotation.y = xPos > 0 ? -Math.PI / 2 : Math.PI / 2;
    dialFace.position.set(xPos > 0 ? -0.085 : 0.085, 1.12, 0);
    tGroup.add(dialFace);

    const leverPivot = new THREE.Group();
    leverPivot.position.set(xPos > 0 ? -0.1 : 0.1, 1.12, 0);

    const arm = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.015, 0.018, 0.34, 8)), brassMat);
    arm.position.y = 0.17;
    leverPivot.add(arm);

    const handle = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.026, 0.026, 0.14, 10)), mahoganyMat);
    handle.rotation.z = Math.PI / 2;
    handle.position.y = 0.34;
    leverPivot.add(handle);

    tGroup.add(leverPivot);
    wheelhouse.add(tGroup);
    return leverPivot;
  };

  const telegraphLever = makeTelegraph(0.98);
  const telegraphLeverPort = makeTelegraph(-1.65);

  // Aft Chart Table with Rolled Maritime Chart
  const chartTableTop = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(2.1, 0.08, 0.95)), mahoganyMat);
  chartTableTop.position.set(-2.4, 0.96, 1.75);
  wheelhouse.add(chartTableTop);
  for (const lx of [-3.35, -1.45]) {
    for (const lz of [1.35, 2.15]) {
      const leg = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.035, 0.028, 0.92, 8)), mahoganyMat);
      leg.position.set(lx, 0.48, lz);
      wheelhouse.add(leg);
    }
  }
  const rolledChart = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.055, 0.055, 0.72, 10)), creamTrimMat);
  rolledChart.rotation.z = Math.PI / 2;
  rolledChart.position.set(-2.4, 1.05, 1.65);
  wheelhouse.add(rolledChart);

  const speakCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.35, 1.1, -1.1),
    new THREE.Vector3(-1.35, 1.55, -1.1),
    new THREE.Vector3(-1.3, 1.62, -0.95),
  ]);
  wheelhouse.add(new THREE.Mesh(trackGeo(new THREE.TubeGeometry(speakCurve, 12, 0.026, 8, false)), brassMat));

  for (const lx of [-1.4, 1.4]) {
    const fixture = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.08, 0.11, 0.14, 10)), brassMat);
    fixture.position.set(lx, 2.88, -0.3);
    wheelhouse.add(fixture);

    const bulb = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.065, 10, 10)), warmGlowMat);
    bulb.position.set(lx, 2.78, -0.3);
    wheelhouse.add(bulb);
  }

  const warmBridgeLight = new THREE.PointLight(0xffad58, 4.6, 11.0, 1.6);
  warmBridgeLight.position.set(0, 15.4, 0.1);
  bowContent.add(warmBridgeLight);

  // Warm Promenade & Boat Deck Illumination spanning the 158m Superstructure
  const boatDeckGlowFwd = new THREE.PointLight(0xffb86b, 8.0, 95, 1.3);
  boatDeckGlowFwd.position.set(0, 16.5, 34);
  bowContent.add(boatDeckGlowFwd);

  const boatDeckGlowAft = new THREE.PointLight(0xffb86b, 7.5, 95, 1.3);
  boatDeckGlowAft.position.set(0, 16.5, 108);
  sternContent.add(boatDeckGlowAft);

  const whFloodMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x092238,
      roughness: 0.12,
      metalness: 0.3,
      transparent: true,
      opacity: 0.84,
      side: THREE.DoubleSide,
    }),
  );
  const whFloodMesh = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(8.7, 5.0)), whFloodMat);
  whFloodMesh.rotation.x = -Math.PI / 2;
  whFloodMesh.position.set(0, 0.02, 0.45);
  whFloodMesh.visible = false;
  whFloodMesh.renderOrder = 4;
  wheelhouse.add(whFloodMesh);

  // Bridge Roof Searchlight Projector & Brass Yoke Pedestal
  const slPedestal = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.14, 0.24, 0.34, 12)), brassMat);
  slPedestal.position.set(0, 16.02, -1.2);
  bowContent.add(slPedestal);

  const searchlightHead = new THREE.Group();
  searchlightHead.position.set(0, 16.28, -1.2);
  const slHousing = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.32, 0.28, 0.72, 14)), brassMat);
  slHousing.rotation.x = Math.PI / 2;
  searchlightHead.add(slHousing);
  bowContent.add(searchlightHead);

  const searchlightTarget = new THREE.Object3D();
  searchlightTarget.position.set(0, 1.5, -150);
  root.add(searchlightTarget);

  const setPowerLevel = (power: number) => {
    const p = THREE.MathUtils.clamp(power, 0, 1);
    warmBridgeLight.intensity = 4.6 * p;
    boatDeckGlowFwd.intensity = 8.0 * p;
    boatDeckGlowAft.intensity = 7.5 * p;
    warmGlowMat.emissiveIntensity = 1.85 * p;
    portholeGlowMat.emissiveIntensity = 1.65 * p;
    compassCardMat.emissiveIntensity = 0.78 * p;
    clinoFaceMat.emissiveIntensity = 0.45 * p;
    for (const dm of telegraphDialMats) {
      dm.emissiveIntensity = 0.68 * p;
    }
    portLightMat.emissiveIntensity = 2.3 * p;
    starboardLightMat.emissiveIntensity = 2.3 * p;
    crewAndLifeboats.setLanternPower(p);
  };

  const setWheelhouseFloodLevel = (level: number) => {
    const l = THREE.MathUtils.clamp(level, 0, 1);
    if (l <= 0.01) {
      whFloodMesh.visible = false;
      return;
    }
    whFloodMesh.visible = true;
    whFloodMesh.position.y = 0.14 + l * 1.65;
  };

  const setBreakupVisual = (broken: boolean, emberPower = 0) => {
    bowBreakCap.visible = broken;
    sternBreakCap.visible = broken;
    marconiAerialsGroup.visible = !broken;
    breakEmberMat.emissiveIntensity = broken ? THREE.MathUtils.clamp(emberPower, 0, 1.5) : 0;
  };

  return {
    root,
    hullMeshGroup,
    bowGroup,
    sternGroup,
    bowContent,
    sternContent,
    helmWheel,
    compassCard,
    telegraphLever,
    telegraphLeverPort,
    searchlightHead,
    searchlightTarget,
    rudderNeedle,
    clinometerNeedle,
    warmBridgeLight,
    crewAndLifeboats,
    setPowerLevel,
    setWheelhouseFloodLevel,
    setBreakupVisual,
    dispose: () => {
      crewAndLifeboats.dispose();
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
