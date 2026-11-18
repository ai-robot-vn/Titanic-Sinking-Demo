import * as THREE from 'three';
import { createCrewAndLifeboats, CrewAndLifeboatSystem } from './charactersBuilder';
import { ProceduralTextureSet } from './textures';

export interface TitanicShipRig {
  root: THREE.Group;
  hullMeshGroup: THREE.Group;
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
  const ringPts = yLevels * 2 + 1;

  for (let zi = 0; zi < zSamples.length; zi++) {
    const z = zSamples[zi];
    const { beam, sheerY, flareFactor } = sampleHullStation(z);
    const vCoord = (z + 74) / 269.1;

    const addVertex = (side: number, frac: number) => {
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
      positions.push(x, y, z + bowRake);
      uvs.push(vCoord * 8.0, frac);
    };

    for (let j = yLevels; j >= 1; j--) {
      const frac = THREE.MathUtils.lerp(yMinFrac, yMaxFrac, j / yLevels);
      addVertex(-1, frac);
    }
    addVertex(0, yMinFrac);
    for (let j = 1; j <= yLevels; j++) {
      const frac = THREE.MathUtils.lerp(yMinFrac, yMaxFrac, j / yLevels);
      addVertex(1, frac);
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
  // 1. TRUE 269.1m x 28m LOFTED HULL + STRAKES + RUDDER + TRIPLE PROPELLERS
  // =========================================================================
  const hullZStations = [
    -74, -72, -68, -63, -57, -50, -42, -35.5, -35, -26, -18, -10.5, -10, 6, 26, 46, 66, 86, 106, 126, 136,
    147.5, 148, 159, 169.5, 170, 179, 187, 192, 195.1,
  ];

  const upperHullGeo = trackGeo(buildLoftedHullSection(hullZStations, 8, 0.36, 1.0));
  const upperHull = new THREE.Mesh(upperHullGeo, steelHullMat);
  upperHull.castShadow = true;
  upperHull.receiveShadow = true;
  hullMeshGroup.add(upperHull);

  const lowerHullGeo = trackGeo(buildLoftedHullSection(hullZStations, 5, 0.0, 0.39));
  const lowerHull = new THREE.Mesh(lowerHullGeo, antiFoulMat);
  lowerHull.scale.set(0.996, 1, 0.998);
  hullMeshGroup.add(lowerHull);

  // Gold Sheer Pinstripe & Raised Steel Belting Strake along Full 269.1m Flanks
  for (const side of [-1, 1]) {
    const stripePts: THREE.Vector3[] = [];
    const strakePts: THREE.Vector3[] = [];
    for (const z of hullZStations) {
      const { beam, sheerY, flareFactor } = sampleHullStation(z);
      const xTop = side * (beam * (1 + flareFactor) + 0.08);
      stripePts.push(new THREE.Vector3(xTop, sheerY - 0.18, z <= -72.0 ? z - 1.75 : z));
      strakePts.push(new THREE.Vector3(side * (beam * 0.95 + 0.08), 1.85, z));
    }
    const curve = new THREE.CatmullRomCurve3(stripePts);
    hullMeshGroup.add(new THREE.Mesh(trackGeo(new THREE.TubeGeometry(curve, 96, 0.1, 6, false)), goldStripeMat));

    const strakeCurve = new THREE.CatmullRomCurve3(strakePts);
    hullMeshGroup.add(new THREE.Mesh(trackGeo(new THREE.TubeGeometry(strakeCurve, 84, 0.14, 6, false)), steelHullMat));
  }

  // Sculpted Balanced Stern Rudder & Triple Bronze Propellers (z = +186..193)
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
  hullMeshGroup.add(sternRudder);

  const centerProp = buildPropellerGroup(trackGeo, bronzeMat, 3, 2.1);
  centerProp.position.set(0, -2.6, 189.6);
  hullMeshGroup.add(centerProp);

  for (const side of [-1, 1]) {
    const wingProp = buildPropellerGroup(trackGeo, bronzeMat, 4, 2.35);
    wingProp.position.set(side * 4.15, -2.2, 186.0);
    hullMeshGroup.add(wingProp);

    const boss = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.32, 0.48, 10.5, 10)), antiFoulMat);
    boss.rotation.x = Math.PI / 2;
    boss.rotation.z = side * -0.14;
    boss.position.set(side * 3.1, -2.05, 181.0);
    hullMeshGroup.add(boss);
  }

  // =========================================================================
  // 2. FORECASTLE, FORWARD WELL DECK, AFT WELL DECK & POOP DECK (269m SCALE)
  // =========================================================================
  // Curved Forecastle Teak Deck (z = -74.6 to -35, top y = 9.20)
  const forecastleShape = new THREE.Shape();
  forecastleShape.moveTo(0, -74.6);
  forecastleShape.bezierCurveTo(4.6, -61, 10.8, -44, 12.6, -35);
  forecastleShape.lineTo(-12.6, -35);
  forecastleShape.bezierCurveTo(-10.8, -44, -4.6, -61, 0, -74.6);
  const forecastleTeakGeo = trackGeo(
    new THREE.ExtrudeGeometry(forecastleShape, { depth: 0.18, bevelEnabled: false, curveSegments: 22 }),
  );
  forecastleTeakGeo.rotateX(Math.PI / 2);
  const forecastleTeak = new THREE.Mesh(forecastleTeakGeo, teakDeckMat);
  forecastleTeak.position.y = 9.2;
  forecastleTeak.receiveShadow = true;
  hullMeshGroup.add(forecastleTeak);

  // Forecastle Break Wall facing aft into Forward Well Deck
  const forecastleBreak = new THREE.Mesh(
    trackGeo(buildCurvedDeckhouseGeo(12.5, -35.3, -34.6, 2.7, 0.35, 0.1, 0.05)),
    whitePaintMat,
  );
  forecastleBreak.position.y = 6.5;
  hullMeshGroup.add(forecastleBreak);

  // Forward Well Deck (z = -35 to -10, top y = 6.62)
  const fwdWellDeck = new THREE.Mesh(
    trackGeo(buildCurvedDeckhouseGeo(12.8, -34.8, -9.8, 0.28, 0.25, 0.25, 0.03)),
    teakDeckMat,
  );
  fwdWellDeck.position.y = 6.34;
  fwdWellDeck.receiveShadow = true;
  hullMeshGroup.add(fwdWellDeck);

  // Aft Well Deck (z = 148 to 170, top y = 6.62)
  const aftWellDeck = new THREE.Mesh(
    trackGeo(buildCurvedDeckhouseGeo(12.4, 148.0, 170.0, 0.28, 0.25, 0.25, 0.03)),
    teakDeckMat,
  );
  aftWellDeck.position.y = 6.34;
  aftWellDeck.receiveShadow = true;
  hullMeshGroup.add(aftWellDeck);

  // Poop Deck Break Wall (z = 170) & Curved Poop Deck Floor Aft (z = 170 to 194.5, top y = 8.4)
  const poopBreak = new THREE.Mesh(
    trackGeo(buildCurvedDeckhouseGeo(10.8, 169.6, 170.3, 1.9, 0.2, 0.2, 0.04)),
    whitePaintMat,
  );
  poopBreak.position.y = 6.5;
  hullMeshGroup.add(poopBreak);

  const poopShape = new THREE.Shape();
  poopShape.moveTo(-10.8, 170);
  poopShape.lineTo(10.8, 170);
  poopShape.bezierCurveTo(10.2, 181, 6.4, 191, 0, 194.6);
  poopShape.bezierCurveTo(-6.4, 191, -10.2, 181, -10.8, 170);
  const poopTeakGeo = trackGeo(
    new THREE.ExtrudeGeometry(poopShape, { depth: 0.22, bevelEnabled: false, curveSegments: 20 }),
  );
  poopTeakGeo.rotateX(Math.PI / 2);
  const poopDeck = new THREE.Mesh(poopTeakGeo, teakDeckMat);
  poopDeck.position.y = 8.4;
  poopDeck.receiveShadow = true;
  hullMeshGroup.add(poopDeck);

  // Aft Docking Bridge on Poop Deck (z = 172.5, height y = 10.6)
  const aftDockDeck = new THREE.Mesh(
    trackGeo(buildCurvedDeckhouseGeo(10.2, 171.6, 173.4, 0.22, 0.2, 0.2, 0.04)),
    teakDeckMat,
  );
  aftDockDeck.position.y = 10.3;
  hullMeshGroup.add(aftDockDeck);
  for (const sx of [-9.4, -4.5, 4.5, 9.4]) {
    const leg = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.11, 0.13, 1.9, 8)), whitePaintMat);
    leg.position.set(sx, 9.35, 172.5);
    hullMeshGroup.add(leg);
  }
  const aftHelmWheel = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.32, 0.04, 8, 20)), mahoganyMat);
  aftHelmWheel.position.set(0, 11.4, 172.5);
  hullMeshGroup.add(aftHelmWheel);

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
    hullMeshGroup.add(capstan);

    const brassCap = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.55, 0.64, 0.14, 16)), brassMat);
    brassCap.position.set(cx, 10.5, -55.0);
    hullMeshGroup.add(brassCap);
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
  hullMeshGroup.add(chainInstanced);

  // Curved Gooseneck Anchor Crane + Cable + Spare Stockless Anchor
  const craneCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 9.2, -66.2),
    new THREE.Vector3(0, 12.0, -66.3),
    new THREE.Vector3(0, 13.3, -67.3),
    new THREE.Vector3(0, 13.7, -69.5),
    new THREE.Vector3(0, 13.4, -70.8),
  ]);
  hullMeshGroup.add(new THREE.Mesh(trackGeo(new THREE.TubeGeometry(craneCurve, 18, 0.22, 10, false)), whitePaintMat));
  const craneCable = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.028, 0.028, 2.8, 6)), darkIronMat);
  craneCable.position.set(0, 12.0, -70.8);
  hullMeshGroup.add(craneCable);

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
    hullMeshGroup.add(hawseRing);

    const anchor = buildAnchorMesh();
    anchor.position.set(side * (beam + 0.34), 7.25, -65);
    anchor.rotation.y = Math.PI / 2 - side * 0.32;
    hullMeshGroup.add(anchor);
  }
  const spareAnchor = buildAnchorMesh();
  spareAnchor.rotation.set(Math.PI / 2, 0, 0);
  spareAnchor.position.set(0, 9.38, -64.0);
  hullMeshGroup.add(spareAnchor);

  // Cargo Hatches & Curved Cargo Cranes in Forward & Aft Well Decks
  for (const hz of [-28.5, -18.0, 155.0, 163.5]) {
    const hatchCoaming = new THREE.Mesh(
      trackGeo(buildCurvedDeckhouseGeo(3.2, hz - 2.6, hz + 2.6, 0.85, 0.22, 0.22, 0.06)),
      whitePaintMat,
    );
    hatchCoaming.position.y = 6.55;
    hullMeshGroup.add(hatchCoaming);

    const hatchCover = new THREE.Mesh(
      trackGeo(buildCurvedDeckhouseGeo(2.95, hz - 2.4, hz + 2.4, 0.22, 0.16, 0.16, 0.05)),
      teakDeckMat,
    );
    hatchCover.position.y = 7.42;
    hullMeshGroup.add(hatchCover);
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
    hullMeshGroup.add(cr);
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
    hullMeshGroup.add(vGrp);
  }

  // White Turned Railings on Forecastle & Poop Deck
  const buildRailSegment = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => {
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
      hullMeshGroup.add(rail);
    }
  };

  const bowEdgePoints: Array<[number, number]> = [
    [0, -74.2],
    [3.8, -64.0],
    [8.0, -50.0],
    [11.8, -36.0],
  ];
  for (const side of [-1, 1]) {
    for (let i = 0; i < bowEdgePoints.length; i++) {
      const [px, pz] = bowEdgePoints[i];
      const post = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.055, 0.055, 1.1, 8)), whitePaintMat);
      post.position.set(px * side, 9.75, pz);
      hullMeshGroup.add(post);
      if (i < bowEdgePoints.length - 1) {
        const [nx, nz] = bowEdgePoints[i + 1];
        buildRailSegment(px * side, 9.2, pz, nx * side, 9.2, nz);
      }
    }
  }

  const poopEdgePoints: Array<[number, number]> = [
    [10.4, 170.5],
    [9.4, 182.0],
    [5.8, 191.0],
    [0, 194.2],
  ];
  for (const side of [-1, 1]) {
    for (let i = 0; i < poopEdgePoints.length; i++) {
      const [px, pz] = poopEdgePoints[i];
      const post = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.055, 0.055, 1.05, 8)), whitePaintMat);
      post.position.set(px * side, 8.92, pz);
      hullMeshGroup.add(post);
      if (i < poopEdgePoints.length - 1) {
        const [nx, nz] = poopEdgePoints[i + 1];
        buildRailSegment(px * side, 8.4, pz, nx * side, 8.4, nz);
      }
    }
  }

  // =========================================================================
  // 3. 158-METER MULTI-TIER SUPERSTRUCTURE, PROMENADES & STAIRCASE DOMES
  // =========================================================================
  // B-Deck Contoured White Superstructure Tier (z = -10 to +148)
  const bDeckHouse = new THREE.Mesh(
    trackGeo(buildCurvedDeckhouseGeo(13.4, -10.0, 148.0, 2.85, 3.2, 4.2, 0.1)),
    whitePaintMat,
  );
  bDeckHouse.position.y = 6.8;
  bDeckHouse.castShadow = true;
  bDeckHouse.receiveShadow = true;
  hullMeshGroup.add(bDeckHouse);

  // A-Deck Teak Promenade Floor Overhang (top y = 9.86)
  const aDeckFloor = new THREE.Mesh(
    trackGeo(buildCurvedDeckhouseGeo(13.6, -10.4, 148.4, 0.26, 3.2, 4.2, 0.05)),
    teakDeckMat,
  );
  aDeckFloor.position.y = 9.6;
  aDeckFloor.receiveShadow = true;
  hullMeshGroup.add(aDeckFloor);

  // A-Deck Inset Promenade Saloon Wall (wide covered promenade walkway x = ±11.4..13.6)
  const aDeckHouse = new THREE.Mesh(
    trackGeo(buildCurvedDeckhouseGeo(11.35, -9.2, 146.5, 2.78, 2.8, 3.6, 0.09)),
    whitePaintMat,
  );
  aDeckHouse.position.y = 9.84;
  aDeckHouse.castShadow = true;
  aDeckHouse.receiveShadow = true;
  hullMeshGroup.add(aDeckHouse);

  // Boat Deck Teak Floor (top y = 12.88, z = -10.2 to +148.4)
  const boatDeckFloor = new THREE.Mesh(
    trackGeo(buildCurvedDeckhouseGeo(13.7, -10.2, 148.4, 0.28, 3.2, 4.2, 0.05)),
    teakDeckMat,
  );
  boatDeckFloor.position.y = 12.6;
  boatDeckFloor.receiveShadow = true;
  hullMeshGroup.add(boatDeckFloor);

  // 72 Turned A-Deck Promenade Stanchion Pillars along 158m Superstructure
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
  const stanchions = new THREE.InstancedMesh(stanchionGeo, whitePaintMat, 72);
  const sDummy = new THREE.Object3D();
  let sIdx = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 36; i++) {
      sDummy.position.set(side * 13.25, 9.82, -7.0 + i * 4.3);
      sDummy.updateMatrix();
      stanchions.setMatrixAt(sIdx++, sDummy.matrix);
    }
  }
  stanchions.instanceMatrix.needsUpdate = true;
  hullMeshGroup.add(stanchions);

  // Boat Deck Teak Benches (Instanced along 158m Boat Deck)
  const benchGeo = trackGeo(new THREE.BoxGeometry(0.7, 0.58, 2.4));
  const benches = new THREE.InstancedMesh(benchGeo, teakDeckMat, 24);
  let bIdx = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 12; i++) {
      sDummy.position.set(side * 8.2, 13.15, 6 + i * 11.5);
      sDummy.updateMatrix();
      benches.setMatrixAt(bIdx++, sDummy.matrix);
    }
  }
  benches.instanceMatrix.needsUpdate = true;
  hullMeshGroup.add(benches);

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
    hullMeshGroup.add(house);
  }

  // Twin Sculpted Glowing Grand Staircase Stained-Glass Dome Skylights
  const domeGlassGeo = trackGeo(new THREE.SphereGeometry(2.7, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.48));
  domeGlassGeo.scale(1.1, 0.72, 1.38);
  const domeRimGeo = trackGeo(new THREE.TorusGeometry(2.7, 0.16, 8, 28));
  domeRimGeo.rotateX(Math.PI / 2);
  domeRimGeo.scale(1.1, 1.38, 1);

  for (const dz of [33.2, 124.5]) {
    const dy = dz < 60 ? 15.1 : 15.05;
    const domeGlass = new THREE.Mesh(domeGlassGeo, warmGlowMat);
    domeGlass.position.set(0, dy, dz);
    hullMeshGroup.add(domeGlass);

    const domeRim = new THREE.Mesh(domeRimGeo, creamTrimMat);
    domeRim.position.set(0, dy, dz);
    hullMeshGroup.add(domeRim);
  }

  // Cantilevered Bridge Wings extending to +/- 15.4m with Curved Knees
  const bridgeWingDeck = new THREE.Mesh(
    trackGeo(buildCurvedDeckhouseGeo(15.4, -2.3, 1.8, 0.34, 0.4, 0.4, 0.05)),
    teakDeckMat,
  );
  bridgeWingDeck.position.y = 12.74;
  bridgeWingDeck.receiveShadow = true;
  hullMeshGroup.add(bridgeWingDeck);

  const wingKneeGeo = trackGeo(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, -1.8, 0),
        new THREE.Vector3(1.4, -1.1, 0),
        new THREE.Vector3(2.8, -0.05, 0),
      ]),
      10,
      0.16,
      8,
      false,
    ),
  );
  for (const side of [-1, 1]) {
    const wingWall = new THREE.Mesh(
      trackGeo(buildCurvedDeckhouseGeo(4.8, -2.25, -1.9, 1.22, 0.15, 0.15, 0.04)),
      whitePaintMat,
    );
    wingWall.position.set(side * 10.4, 13.0, 0);
    hullMeshGroup.add(wingWall);

    const wingCab = new THREE.Mesh(
      trackGeo(buildCurvedDeckhouseGeo(0.35, -2.2, 1.65, 1.32, 0.25, 0.25, 0.04)),
      whitePaintMat,
    );
    wingCab.position.set(side * 15.25, 13.0, 0);
    hullMeshGroup.add(wingCab);

    for (const kz of [-1.5, 0.9]) {
      const knee = new THREE.Mesh(wingKneeGeo, whitePaintMat);
      knee.position.set(side * 12.3, 12.78, kz);
      knee.scale.x = side;
      hullMeshGroup.add(knee);
    }

    const navLight = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.25, 12, 12)),
      side < 0 ? portLightMat : starboardLightMat,
    );
    navLight.position.set(side * 15.35, 14.42, -2.0);
    hullMeshGroup.add(navLight);
  }

  // =========================================================================
  // 4. ALL 4 TOWERING ELLIPTICAL OLYMPIC-CLASS FUNNELS (~20m ABOVE BOAT DECK)
  // =========================================================================
  const funnelZPositions = [26.0, 56.0, 86.0, 118.0];
  const funnelShaftGeo = trackGeo(new THREE.CylinderGeometry(2.65, 3.08, 16.2, 32));
  const funnelBandGeo = trackGeo(new THREE.CylinderGeometry(2.74, 2.68, 3.6, 32));
  const funnelLipGeo = trackGeo(new THREE.TorusGeometry(2.7, 0.14, 8, 32));
  funnelLipGeo.rotateX(Math.PI / 2);
  const funnelFlueGeo = trackGeo(new THREE.CircleGeometry(2.5, 28));
  funnelFlueGeo.rotateX(-Math.PI / 2);
  const funnelSeamGeo = trackGeo(new THREE.TorusGeometry(2.88, 0.055, 6, 32));
  funnelSeamGeo.rotateX(Math.PI / 2);
  const funnelPipeGeo = trackGeo(new THREE.CylinderGeometry(0.16, 0.18, 17.8, 10));
  const whistleBellGeo = trackGeo(new THREE.CylinderGeometry(0.26, 0.14, 0.56, 12));
  const guyWireGeo = trackGeo(new THREE.CylinderGeometry(0.032, 0.032, 1, 5));

  for (const fz of funnelZPositions) {
    const funnelGroup = new THREE.Group();
    funnelGroup.position.set(0, 12.85, fz);
    funnelGroup.rotation.x = 0.088; // ~5° aft rake
    funnelGroup.scale.set(0.86, 1, 1.15);

    const shaft = new THREE.Mesh(funnelShaftGeo, buffFunnelMat);
    shaft.position.y = 8.1;
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
      pipe.position.set(px, 8.9, -2.96);
      funnelGroup.add(pipe);

      const chime = new THREE.Mesh(whistleBellGeo, brassMat);
      chime.position.set(px, 16.5, -3.15);
      funnelGroup.add(chime);
    }

    hullMeshGroup.add(funnelGroup);

    // 6 Taut Steel Guy Stays per funnel anchored down to Boat Deck
    const guyAnchors: Array<[number, number, number, number]> = [
      [-2.2, -2.2, -11.4, -7.8],
      [2.2, -2.2, 11.4, -7.8],
      [-2.4, 0.2, -11.8, 0.6],
      [2.4, 0.2, 11.8, 0.6],
      [-2.2, 2.4, -11.4, 8.2],
      [2.2, 2.4, 11.4, 8.2],
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
      hullMeshGroup.add(wire);
    }
  }

  // Animated Walking & Running Crew, Passengers & 16 Sculpted Lifeboats
  const crewAndLifeboats = createCrewAndLifeboats(hullMeshGroup, whitePaintMat, teakDeckMat);

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

  const portholeInstanced = new THREE.InstancedMesh(portholeGeo, portholeGlowMat, portholePositions.length);
  const brassRimsInstanced = new THREE.InstancedMesh(brassRimGeo, brassMat, portholePositions.length);
  const pDummy = new THREE.Object3D();
  for (let i = 0; i < portholePositions.length; i++) {
    const p = portholePositions[i];
    pDummy.position.set(p.x, p.y, p.z);
    pDummy.rotation.set(0, p.rotY, 0);
    pDummy.scale.set(p.scaleX, 1, 1);
    pDummy.updateMatrix();
    portholeInstanced.setMatrixAt(i, pDummy.matrix);

    pDummy.position.set(p.x + (p.x > 0 ? 0.018 : -0.018), p.y, p.z);
    pDummy.updateMatrix();
    brassRimsInstanced.setMatrixAt(i, pDummy.matrix);
  }
  portholeInstanced.instanceMatrix.needsUpdate = true;
  portholeInstanced.computeBoundingSphere();
  brassRimsInstanced.instanceMatrix.needsUpdate = true;
  brassRimsInstanced.computeBoundingSphere();
  hullMeshGroup.add(portholeInstanced);
  hullMeshGroup.add(brassRimsInstanced);

  // =========================================================================
  // 6. FOREMAST, CROW'S NEST, AFT MAINMAST, SHROUDS & 200m MARCONI AERIALS
  // =========================================================================
  const foremast = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.16, 0.36, 42.0, 14)), buffFunnelMat);
  foremast.position.set(0, 27.5, -22.5);
  foremast.castShadow = true;
  hullMeshGroup.add(foremast);

  const crowsNest = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(1.05, 0.76, 1.55, 18)), whitePaintMat);
  crowsNest.position.set(0, 25.8, -22.5);
  crowsNest.castShadow = true;
  hullMeshGroup.add(crowsNest);

  const crowsNestRim = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(1.05, 0.09, 8, 24)), teakDeckMat);
  crowsNestRim.rotation.x = Math.PI / 2;
  crowsNestRim.position.set(0, 26.58, -22.5);
  hullMeshGroup.add(crowsNestRim);

  const mastLantern = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.28, 12, 12)), warmGlowMat);
  mastLantern.position.set(0, 31.8, -22.5);
  hullMeshGroup.add(mastLantern);

  const yardarm = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.08, 0.12, 12.6, 10)), buffFunnelMat);
  yardarm.rotation.z = Math.PI / 2;
  yardarm.position.set(0, 36.2, -22.5);
  hullMeshGroup.add(yardarm);

  // Aft Mainmast (z = 178)
  const mainMast = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.16, 0.34, 40.0, 14)), buffFunnelMat);
  mainMast.position.set(0, 27.5, 178.0);
  mainMast.rotation.x = 0.06;
  hullMeshGroup.add(mainMast);

  const mainYardarm = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.08, 0.12, 11.0, 10)), buffFunnelMat);
  mainYardarm.rotation.z = Math.PI / 2;
  mainYardarm.position.set(0, 36.0, 178.5);
  hullMeshGroup.add(mainYardarm);

  const sternLantern = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.26, 10, 10)), warmGlowMat);
  sternLantern.position.set(0, 31.5, 178.2);
  hullMeshGroup.add(sternLantern);

  // Wire Shrouds, Forestay & 200-meter 4-Wire Marconi Aerial Array
  const stayMat = trackMat(new THREE.MeshBasicMaterial({ color: 0x4b5868 }));
  const addCable = (a: THREE.Vector3, b: THREE.Vector3, radius = 0.036) => {
    const geo = trackGeo(new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 4, radius, 6, false));
    hullMeshGroup.add(new THREE.Mesh(geo, stayMat));
  };
  addCable(new THREE.Vector3(0, 44.5, -22.5), new THREE.Vector3(0, 10.3, -72.5), 0.048);
  for (const sx of [-10.5, 10.5]) {
    addCable(new THREE.Vector3(0, 41.0, -22.5), new THREE.Vector3(sx, 9.2, -42));
    addCable(new THREE.Vector3(0, 27.0, -22.5), new THREE.Vector3(sx * 1.15, 6.8, -25));
    addCable(new THREE.Vector3(0, 27.0, -22.5), new THREE.Vector3(sx * 1.15, 6.8, -19));
    addCable(new THREE.Vector3(0, 41.0, 178.8), new THREE.Vector3(sx * 0.85, 8.6, 173));
    addCable(new THREE.Vector3(0, 41.0, 178.8), new THREE.Vector3(sx * 0.85, 8.6, 181));
  }
  for (const mx of [-1.4, -0.46, 0.46, 1.4]) {
    addCable(new THREE.Vector3(mx, 46.8, -22.5), new THREE.Vector3(mx, 46.2, 179.0), 0.028);
  }

  // =========================================================================
  // 7. WHEELHOUSE INTERIOR (Mahogany, Brass, Chart Table, Helm, Telegraphs)
  // =========================================================================
  const wheelhouse = new THREE.Group();
  wheelhouse.position.set(0, 12.9, 0);
  hullMeshGroup.add(wheelhouse);

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
    const sideLower = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.22, 1.1, 4.4)), mahoganyMat);
    sideLower.position.set(side * 4.4, 0.55, 0.85);
    wheelhouse.add(sideLower);

    const sideHeader = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.22, 0.35, 4.4)), mahoganyMat);
    sideHeader.position.set(side * 4.4, 2.82, 0.85);
    wheelhouse.add(sideHeader);

    const aftPost = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.24, 1.75, 0.85)), mahoganyMat);
    aftPost.position.set(side * 4.4, 1.94, 2.65);
    wheelhouse.add(aftPost);
  }

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
  hullMeshGroup.add(warmBridgeLight);

  // Warm Promenade & Boat Deck Illumination spanning the 158m Superstructure
  const boatDeckGlowFwd = new THREE.PointLight(0xffb86b, 8.0, 95, 1.3);
  boatDeckGlowFwd.position.set(0, 16.5, 34);
  hullMeshGroup.add(boatDeckGlowFwd);

  const boatDeckGlowAft = new THREE.PointLight(0xffb86b, 7.5, 95, 1.3);
  boatDeckGlowAft.position.set(0, 16.5, 108);
  hullMeshGroup.add(boatDeckGlowAft);

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

  // Bridge Roof Searchlight Projector
  const searchlightHead = new THREE.Group();
  searchlightHead.position.set(0, 16.25, -1.2);
  const slHousing = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.32, 0.28, 0.72, 14)), brassMat);
  slHousing.rotation.x = Math.PI / 2;
  searchlightHead.add(slHousing);
  hullMeshGroup.add(searchlightHead);

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

  return {
    root,
    hullMeshGroup,
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
    dispose: () => {
      crewAndLifeboats.dispose();
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
