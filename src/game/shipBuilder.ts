import * as THREE from 'three';
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
  setPowerLevel: (power: number) => void;
  setWheelhouseFloodLevel: (level: number) => void;
  dispose: () => void;
}

/**
 * Evaluates Titanic hull half-beam and deck sheer height at longitudinal z in [-70, +78].
 * -70 = razor bow stem, -34 = forecastle break, -12..+45 = midbody, +78 = cruiser stern.
 */
function sampleHullStation(z: number): {
  beam: number;
  sheerY: number;
  flareFactor: number;
} {
  // Longitudinal normalized u: 0 at bow (-70), 1 at stern (+78)
  let beam = 9.75;
  let flareFactor = 0.08;

  if (z < -12) {
    // Forward bow taper (-70 to -12)
    const t = THREE.MathUtils.clamp((z - -70) / 58, 0, 1);
    beam = 9.75 * Math.pow(Math.sin((t * Math.PI) / 2), 0.78);
    // Pronounced concave bow flare near stem
    flareFactor = 0.28 * (1 - t) + 0.06;
  } else if (z > 42) {
    // Graceful stern taper (+42 to +78)
    const t = THREE.MathUtils.clamp((78 - z) / 36, 0, 1);
    beam = 9.75 * Math.pow(Math.sin((t * Math.PI) / 2), 0.62);
    flareFactor = 0.14 * (1 - t) + 0.04;
  }

  // Sheer height (forecastle raised forward of -34, gentle midship dip, stern rise)
  let sheerY = 5.45;
  if (z < -34) {
    const t = THREE.MathUtils.clamp((-34 - z) / 36, 0, 1);
    sheerY = 7.05 + t * 0.75;
  } else if (z < -12) {
    // Well deck
    sheerY = 5.35;
  } else if (z > 52) {
    // Stern sheer rise
    const t = THREE.MathUtils.clamp((z - 52) / 26, 0, 1);
    sheerY = 5.55 + t * 0.85;
  }

  return { beam, sheerY, flareFactor };
}

/**
 * Builds a watertight lofted 3D hull surface between yMinNorm and yMaxNorm.
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

  // Cross-section rings: port sheer -> port keel -> starboard keel -> starboard sheer
  const ringPts = yLevels * 2 + 1;

  for (let zi = 0; zi < zSamples.length; zi++) {
    const z = zSamples[zi];
    const { beam, sheerY, flareFactor } = sampleHullStation(z);
    const vCoord = (z + 70) / 148;

    const addVertex = (side: number, frac: number) => {
      const yBottom = -3.8;
      const yTop = sheerY;
      const y = THREE.MathUtils.lerp(yBottom, yTop, frac);

      // Vertical cross-section shaping (bilge curve + bow flare)
      let widthRatio: number;
      if (frac < 0.25) {
        // Bilge curve from keel
        widthRatio = Math.sin(((frac / 0.25) * Math.PI) / 2) * 0.88;
      } else {
        const up = (frac - 0.25) / 0.75;
        widthRatio = 0.88 + up * 0.12 + up * up * flareFactor;
      }

      // Rake the bow stem slightly forward at the top
      const bowRake = z <= -68.5 ? -(frac * 1.6) : 0;
      const x = side * beam * widthRatio;
      positions.push(x, y, z + bowRake);
      uvs.push(vCoord * 4.0, frac);
    };

    // Port side down to keel
    for (let j = yLevels; j >= 1; j--) {
      const frac = THREE.MathUtils.lerp(yMinFrac, yMaxFrac, j / yLevels);
      addVertex(-1, frac);
    }
    // Centerline keel / bottom
    addVertex(0, yMinFrac);
    // Starboard side up to sheer
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
  // PBR MATERIALS (Varied roughness >= 0.25 across adjacent parts)
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

  const darkIronMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x181e26,
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
      normalScale: new THREE.Vector2(1.1, 1.1),
      color: 0x1a212b,
      roughness: 0.48,
      metalness: 0.48,
      side: THREE.DoubleSide,
    }),
  );

  const antiFoulMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x62191b,
      normalMap: textures.steelHullNormal,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 0.68,
      metalness: 0.12,
      side: THREE.DoubleSide,
    }),
  );

  const whitePaintMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xebe8df,
      roughness: 0.64,
      metalness: 0.04,
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
      roughness: 0.58,
      metalness: 0.08,
    }),
  );

  const bridgeGlassMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xd9eefc,
      metalness: 0.0,
      roughness: 0.06,
      transmission: isSoftwareGl ? 0 : 0.92,
      transparent: true,
      opacity: isSoftwareGl ? 0.13 : 1.0,
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
  // 1. LOFTED FULL-LENGTH 3D TITANIC HULL (Bow -70 to Stern +78)
  // =========================================================================
  const hullZStations = [
    -70, -68, -64, -59, -53, -47, -40, -34.5, -34, -26, -18, -12.5, -12, 0, 14, 28, 42, 52, 60, 68, 74, 78,
  ];

  // Upper black riveted steel hull (waterline frac 0.36 to sheer 1.0)
  const upperHullGeo = trackGeo(buildLoftedHullSection(hullZStations, 7, 0.36, 1.0));
  const upperHull = new THREE.Mesh(upperHullGeo, steelHullMat);
  upperHull.castShadow = true;
  upperHull.receiveShadow = true;
  hullMeshGroup.add(upperHull);

  // Lower red antifouling hull (keel 0.0 to waterline 0.39)
  const lowerHullGeo = trackGeo(buildLoftedHullSection(hullZStations, 4, 0.0, 0.39));
  const lowerHull = new THREE.Mesh(lowerHullGeo, antiFoulMat);
  lowerHull.scale.set(0.996, 1, 0.998);
  hullMeshGroup.add(lowerHull);

  // Sweeping Gold Sheer Pinstripe on Port & Starboard following exact hull sheer
  for (const side of [-1, 1]) {
    const stripePts: THREE.Vector3[] = [];
    for (const z of hullZStations) {
      const { beam, sheerY, flareFactor } = sampleHullStation(z);
      const x = side * (beam * (1 + flareFactor) + 0.06);
      stripePts.push(new THREE.Vector3(x, sheerY - 0.16, z <= -68.5 ? z - 1.45 : z));
    }
    const curve = new THREE.CatmullRomCurve3(stripePts);
    const stripeGeo = trackGeo(new THREE.TubeGeometry(curve, 64, 0.085, 6, false));
    hullMeshGroup.add(new THREE.Mesh(stripeGeo, goldStripeMat));
  }

  // White Sheer Trim / Bulwark Rail along upper hull edge
  const forecastleShape = new THREE.Shape();
  forecastleShape.moveTo(0, -70.8);
  forecastleShape.bezierCurveTo(3.2, -59, 7.6, -42, 8.9, -34);
  forecastleShape.lineTo(-8.9, -34);
  forecastleShape.bezierCurveTo(-7.6, -42, -3.2, -59, 0, -70.8);

  const forecastleTeakGeo = trackGeo(
    new THREE.ExtrudeGeometry(forecastleShape, {
      depth: 0.16,
      bevelEnabled: false,
      curveSegments: 18,
    }),
  );
  forecastleTeakGeo.rotateX(Math.PI / 2);
  const forecastleTeak = new THREE.Mesh(forecastleTeakGeo, teakDeckMat);
  forecastleTeak.position.y = 7.2;
  forecastleTeak.receiveShadow = true;
  hullMeshGroup.add(forecastleTeak);

  // White Forecastle Break Bulwark Wall (z = -34 facing aft into well deck)
  const forecastleBreak = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(17.6, 1.9, 0.5)), whitePaintMat);
  forecastleBreak.position.set(0, 6.25, -34);
  hullMeshGroup.add(forecastleBreak);

  // Forward Well Deck Teak Floor (z = -34 to z = -12)
  const wellDeck = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(17.8, 0.26, 22.5)), teakDeckMat);
  wellDeck.position.set(0, 5.4, -23);
  wellDeck.receiveShadow = true;
  hullMeshGroup.add(wellDeck);

  // Poop Deck Teak Floor aft (z = +54 to z = +77)
  const poopDeck = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(13.5, 0.25, 22)), teakDeckMat);
  poopDeck.position.set(0, 5.9, 64);
  poopDeck.receiveShadow = true;
  hullMeshGroup.add(poopDeck);

  // =========================================================================
  // 2. FORECASTLE DETAILS: 3 ANCHORS, WINDLASSES, HATCHES, WINCHES & COWLS
  // =========================================================================
  // Twin Anchor Capstans & Chains
  for (const cx of [-2.5, 2.5]) {
    const capstan = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.54, 0.72, 1.05, 16)), darkIronMat);
    capstan.position.set(cx, 7.72, -52.5);
    capstan.castShadow = true;
    hullMeshGroup.add(capstan);

    const capstanCap = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.62, 0.62, 0.16, 16)), brassMat);
    capstanCap.position.set(cx, 8.28, -52.5);
    hullMeshGroup.add(capstanCap);

    const chain = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.24, 0.14, 11.5)), darkIronMat);
    chain.position.set(cx * 0.72, 7.26, -58.5);
    chain.rotation.y = cx < 0 ? -0.15 : 0.15;
    hullMeshGroup.add(chain);
  }

  // Center Forecastle Anchor Crane & Spare Stockless Anchor
  const cranePost = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.22, 0.28, 3.8, 12)), whitePaintMat);
  cranePost.position.set(0, 9.05, -63.5);
  cranePost.castShadow = true;
  hullMeshGroup.add(cranePost);

  const craneBoom = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.2, 0.24, 3.9)), darkIronMat);
  craneBoom.position.set(0, 10.45, -65.2);
  craneBoom.rotation.x = 0.36;
  hullMeshGroup.add(craneBoom);

  // Center Anchor on Forecastle Deck
  const centerAnchorShank = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.26, 0.22, 2.6)), darkIronMat);
  centerAnchorShank.position.set(0, 7.36, -61.5);
  hullMeshGroup.add(centerAnchorShank);
  const centerAnchorFluke = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.5, 0.22, 0.65)), darkIronMat);
  centerAnchorFluke.position.set(0, 7.36, -60.4);
  hullMeshGroup.add(centerAnchorFluke);

  // Port & Starboard Bow Hawsepipe Anchors
  for (const side of [-1, 1]) {
    const { beam } = sampleHullStation(-62);
    const anchorGroup = new THREE.Group();
    anchorGroup.position.set(side * (beam + 0.45), 5.65, -62);
    anchorGroup.rotation.y = side * 0.35;

    const shank = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.25, 1.8, 0.28)), darkIronMat);
    anchorGroup.add(shank);
    const flukes = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.32, 0.65, 1.35)), darkIronMat);
    flukes.position.y = -0.75;
    anchorGroup.add(flukes);
    hullMeshGroup.add(anchorGroup);
  }

  // Forward Cargo Hatch #1 & #2 + Twin Steam Cargo Winches
  for (const hz of [-28.5, -19.5]) {
    const hatchBase = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(5.4, 0.8, 4.8)), whitePaintMat);
    hatchBase.position.set(0, 5.85, hz);
    hatchBase.castShadow = true;
    hullMeshGroup.add(hatchBase);

    const hatchCover = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(5.0, 0.22, 4.4)), teakDeckMat);
    hatchCover.position.set(0, 6.32, hz);
    hullMeshGroup.add(hatchCover);
  }

  // Steam Winch Drums & Cowl Ventilators (LatheGeometry)
  const cowlPts = [
    new THREE.Vector2(0.26, 0),
    new THREE.Vector2(0.26, 1.15),
    new THREE.Vector2(0.44, 1.55),
    new THREE.Vector2(0.56, 1.85),
    new THREE.Vector2(0.42, 1.85),
  ];
  const cowlGeo = trackGeo(new THREE.LatheGeometry(cowlPts, 14));
  for (const [vx, vz] of [
    [-5.8, -30],
    [5.8, -30],
    [-6.2, -16],
    [6.2, -16],
  ]) {
    const vent = new THREE.Mesh(cowlGeo, whitePaintMat);
    vent.position.set(vx, 5.5, vz);
    hullMeshGroup.add(vent);
  }

  // White Bow Railings along Forecastle
  const bowEdgePoints: Array<[number, number]> = [
    [0, -70.4],
    [2.6, -61.5],
    [5.6, -49],
    [8.2, -35],
  ];
  for (const side of [-1, 1]) {
    for (let i = 0; i < bowEdgePoints.length; i++) {
      const [px, pz] = bowEdgePoints[i];
      const post = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.055, 0.055, 1.05, 8)), whitePaintMat);
      post.position.set(px * side, 7.72, pz);
      hullMeshGroup.add(post);

      if (i < bowEdgePoints.length - 1) {
        const [nx, nz] = bowEdgePoints[i + 1];
        const dx = (nx - px) * side;
        const dz = nz - pz;
        const len = Math.hypot(dx, dz);
        for (const ry of [7.85, 8.22]) {
          const rail = new THREE.Mesh(
            trackGeo(new THREE.CylinderGeometry(0.04, 0.04, len, 8)),
            ry > 8 ? teakDeckMat : whitePaintMat,
          );
          rail.position.set(((px + nx) / 2) * side, ry, (pz + nz) / 2);
          rail.rotation.x = Math.PI / 2;
          rail.rotation.z = -Math.atan2(dx, dz);
          hullMeshGroup.add(rail);
        }
      }
    }
  }

  // =========================================================================
  // 3. MULTI-TIER SUPERSTRUCTURE, PROMENADE DECKS & 4 ICONIC FUNNELS
  // =========================================================================
  // B-Deck / C-Deck Lower Superstructure Tier
  const lowerSuper = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(18.2, 3.0, 68)), whitePaintMat);
  lowerSuper.position.set(0, 6.95, 22);
  lowerSuper.castShadow = true;
  lowerSuper.receiveShadow = true;
  hullMeshGroup.add(lowerSuper);

  // A-Deck Promenade Tier (slightly inset for authentic open promenade overhang)
  const upperSuper = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(16.2, 2.75, 65)), whitePaintMat);
  upperSuper.position.set(0, 9.75, 22);
  upperSuper.castShadow = true;
  upperSuper.receiveShadow = true;
  hullMeshGroup.add(upperSuper);

  // Boat Deck Teak Floor (z = -12 to +56)
  const boatDeck = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(18.4, 0.32, 68)), teakDeckMat);
  boatDeck.position.set(0, 11.1, 22);
  boatDeck.receiveShadow = true;
  hullMeshGroup.add(boatDeck);

  // Promenade Stanchion Pillars along A-Deck overhang
  const stanchionGeo = trackGeo(new THREE.CylinderGeometry(0.08, 0.08, 2.7, 8));
  const stanchionCount = 28;
  const stanchions = new THREE.InstancedMesh(stanchionGeo, whitePaintMat, stanchionCount);
  const sDummy = new THREE.Object3D();
  let sIdx = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 14; i++) {
      sDummy.position.set(side * 8.95, 9.75, -8 + i * 4.8);
      sDummy.updateMatrix();
      stanchions.setMatrixAt(sIdx++, sDummy.matrix);
    }
  }
  stanchions.instanceMatrix.needsUpdate = true;
  stanchions.computeBoundingSphere();
  hullMeshGroup.add(stanchions);

  // Bridge Wings (Port & Starboard protruding out to +/- 11.8)
  const bridgeWingDeck = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(23.8, 0.36, 3.8)), teakDeckMat);
  bridgeWingDeck.position.set(0, 10.95, -0.3);
  bridgeWingDeck.receiveShadow = true;
  hullMeshGroup.add(bridgeWingDeck);

  for (const side of [-1, 1]) {
    const wingWall = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(7.3, 1.15, 0.25)), whitePaintMat);
    wingWall.position.set(side * 8.15, 11.65, -2.05);
    hullMeshGroup.add(wingWall);

    const sideCab = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.28, 1.15, 3.8)), whitePaintMat);
    sideCab.position.set(side * 11.75, 11.65, -0.3);
    hullMeshGroup.add(sideCab);

    const navLight = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.22, 12, 12)),
      side < 0 ? portLightMat : starboardLightMat,
    );
    navLight.position.set(side * 11.8, 12.45, -1.95);
    hullMeshGroup.add(navLight);
  }

  // ALL 4 ICONIC TITANIC FUNNELS (#1, #2, #3, #4)
  const funnelZPositions = [11.5, 25.5, 39.5, 53.5];
  const funnelShaftGeo = trackGeo(new THREE.CylinderGeometry(2.08, 2.32, 9.6, 24));
  const funnelBandGeo = trackGeo(new THREE.CylinderGeometry(2.14, 2.14, 2.35, 24));
  const funnelPipeGeo = trackGeo(new THREE.CylinderGeometry(0.14, 0.14, 11.2, 10));

  for (const fz of funnelZPositions) {
    const funnelGroup = new THREE.Group();
    funnelGroup.position.set(0, 11.1, fz);
    funnelGroup.rotation.x = 0.088; // Authentic ~5° aft rake
    funnelGroup.scale.set(0.88, 1, 1.12); // Elliptical Olympic-class cross-section

    const shaft = new THREE.Mesh(funnelShaftGeo, buffFunnelMat);
    shaft.position.y = 4.8;
    shaft.castShadow = true;
    funnelGroup.add(shaft);

    const topBand = new THREE.Mesh(funnelBandGeo, darkIronMat);
    topBand.position.y = 10.7;
    funnelGroup.add(topBand);

    const whistlePipe = new THREE.Mesh(funnelPipeGeo, brassMat);
    whistlePipe.position.set(0, 5.6, -2.25);
    funnelGroup.add(whistlePipe);

    hullMeshGroup.add(funnelGroup);
  }

  // 12 WHITE WOODEN LIFEBOATS ON WELIN DAVITS ALONG BOAT DECK
  const boatHullGeo = trackGeo(new THREE.CapsuleGeometry(0.55, 2.6, 6, 12));
  boatHullGeo.rotateX(Math.PI / 2);
  const boatCoverGeo = trackGeo(new THREE.BoxGeometry(0.95, 0.25, 3.2));
  const davitGeo = trackGeo(new THREE.BoxGeometry(0.12, 1.8, 0.12));

  for (const side of [-1, 1]) {
    for (let b = 0; b < 6; b++) {
      const bz = 5 + b * 8.4;
      const lifeboat = new THREE.Group();
      lifeboat.position.set(side * 8.7, 12.15, bz);

      const hull = new THREE.Mesh(boatHullGeo, whitePaintMat);
      hull.castShadow = true;
      lifeboat.add(hull);

      const canvas = new THREE.Mesh(boatCoverGeo, teakDeckMat);
      canvas.position.y = 0.42;
      lifeboat.add(canvas);

      for (const dz of [-1.5, 1.5]) {
        const davit = new THREE.Mesh(davitGeo, whitePaintMat);
        davit.position.set(side * -0.45, -0.25, dz);
        lifeboat.add(davit);
      }
      hullMeshGroup.add(lifeboat);
    }
  }

  // =========================================================================
  // 4. ILLUMINATED WARM PORTHOLES & PROMENADE WINDOWS (InstancedMesh)
  // =========================================================================
  const portholeGeo = trackGeo(new THREE.CircleGeometry(0.24, 10));
  const portholePositions: Array<{ x: number; y: number; z: number; rotY: number; scaleX: number }> = [];

  // Hull portholes curving along both flanks (-52 to +66)
  for (const side of [-1, 1]) {
    for (let z = -52; z <= 66; z += 4.2) {
      const { beam, sheerY } = sampleHullStation(z);
      const { beam: beamNext } = sampleHullStation(z + 1.5);
      const slopeAngle = Math.atan2((beamNext - beam) * side, 1.5);

      // Two decks of hull portholes below sheer
      for (const dy of [1.2, 2.55]) {
        const x = side * (beam * 0.99 + 0.08);
        const y = sheerY - dy;
        if (y > 1.1) {
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

    // Rectangular glowing promenade windows along B-Deck & A-Deck
    for (let z = -9; z <= 52; z += 2.6) {
      portholePositions.push({
        x: side * 9.13,
        y: 7.35,
        z,
        rotY: side > 0 ? Math.PI / 2 : -Math.PI / 2,
        scaleX: 1.85,
      });
      portholePositions.push({
        x: side * 8.13,
        y: 9.9,
        z,
        rotY: side > 0 ? Math.PI / 2 : -Math.PI / 2,
        scaleX: 2.0,
      });
    }
  }

  const portholeInstanced = new THREE.InstancedMesh(
    portholeGeo,
    portholeGlowMat,
    portholePositions.length,
  );
  const pDummy = new THREE.Object3D();
  for (let i = 0; i < portholePositions.length; i++) {
    const p = portholePositions[i];
    pDummy.position.set(p.x, p.y, p.z);
    pDummy.rotation.set(0, p.rotY, 0);
    pDummy.scale.set(p.scaleX, 1, 1);
    pDummy.updateMatrix();
    portholeInstanced.setMatrixAt(i, pDummy.matrix);
  }
  portholeInstanced.instanceMatrix.needsUpdate = true;
  portholeInstanced.computeBoundingSphere();
  hullMeshGroup.add(portholeInstanced);

  // =========================================================================
  // 5. FOREMAST, CROW'S NEST, AFT MAINMAST & RIGGING
  // =========================================================================
  const foremast = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.14, 0.24, 24.5, 14)), buffFunnelMat);
  foremast.position.set(0, 17.6, -24.5);
  foremast.castShadow = true;
  hullMeshGroup.add(foremast);

  const crowsNest = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.84, 0.62, 1.38, 16)), whitePaintMat);
  crowsNest.position.set(0, 19.65, -24.3);
  crowsNest.castShadow = true;
  hullMeshGroup.add(crowsNest);

  const crowsNestRim = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.84, 0.08, 8, 24)), teakDeckMat);
  crowsNestRim.rotation.x = Math.PI / 2;
  crowsNestRim.position.set(0, 20.34, -24.3);
  hullMeshGroup.add(crowsNestRim);

  const mastLantern = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.22, 12, 12)), warmGlowMat);
  mastLantern.position.set(0, 22.0, -24.3);
  hullMeshGroup.add(mastLantern);

  const yardarm = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.08, 0.08, 8.8, 10)), buffFunnelMat);
  yardarm.rotation.z = Math.PI / 2;
  yardarm.position.set(0, 24.0, -24.5);
  hullMeshGroup.add(yardarm);

  // Aft Mainmast
  const mainMast = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.14, 0.24, 23, 14)), buffFunnelMat);
  mainMast.position.set(0, 17.5, 65.5);
  mainMast.rotation.x = 0.06;
  hullMeshGroup.add(mainMast);

  const sternLantern = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.2, 10, 10)), warmGlowMat);
  sternLantern.position.set(0, 24.0, 65.8);
  hullMeshGroup.add(sternLantern);

  // Wire Stays & Marconi Aerials between Masts
  const stayMat = trackMat(new THREE.MeshBasicMaterial({ color: 0x4b5868 }));
  for (const sx of [-7.2, 7.2]) {
    const stayGeo = trackGeo(
      new THREE.TubeGeometry(
        new THREE.LineCurve3(new THREE.Vector3(0, 26.2, -24.5), new THREE.Vector3(sx, 7.4, -40)),
        4,
        0.038,
        6,
        false,
      ),
    );
    hullMeshGroup.add(new THREE.Mesh(stayGeo, stayMat));
  }
  const marconiGeo = trackGeo(
    new THREE.TubeGeometry(
      new THREE.LineCurve3(new THREE.Vector3(0, 28.5, -24.5), new THREE.Vector3(0, 28.5, 66)),
      4,
      0.035,
      6,
      false,
    ),
  );
  hullMeshGroup.add(new THREE.Mesh(marconiGeo, stayMat));

  // =========================================================================
  // 6. WHEELHOUSE INTERIOR (Mahogany, Brass, Clinometer, Helm, Binnacle, Telegraphs)
  // =========================================================================
  const wheelhouse = new THREE.Group();
  wheelhouse.position.set(0, 11.0, 0);
  hullMeshGroup.add(wheelhouse);

  const whFloor = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(8.8, 0.2, 5.2)), teakDeckMat);
  whFloor.position.set(0, 0.05, 0.4);
  whFloor.receiveShadow = true;
  wheelhouse.add(whFloor);

  const frontWainscot = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(8.6, 1.05, 0.22)), mahoganyMat);
  frontWainscot.position.set(0, 0.55, -1.35);
  frontWainscot.receiveShadow = true;
  wheelhouse.add(frontWainscot);

  const sillTrim = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(8.65, 0.08, 0.28)), brassMat);
  sillTrim.position.set(0, 1.1, -1.35);
  wheelhouse.add(sillTrim);

  const frontHeader = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(8.8, 0.35, 0.3)), mahoganyMat);
  frontHeader.position.set(0, 2.82, -1.35);
  wheelhouse.add(frontHeader);

  const whRoof = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(9.0, 0.22, 5.4)), mahoganyMat);
  whRoof.position.set(0, 3.05, 0.45);
  wheelhouse.add(whRoof);

  // Coffered Mahogany Ceiling Beams
  for (const bz of [-0.6, 0.5, 1.6]) {
    const beam = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(8.6, 0.12, 0.16)), mahoganyMat);
    beam.position.set(0, 2.9, bz);
    wheelhouse.add(beam);
  }

  // Brass-Trimmed Window Mullions
  for (const mx of [-4.2, -2.55, -1.05, 1.05, 2.55, 4.2]) {
    const mullion = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.11, 1.72, 0.14)), mahoganyMat);
    mullion.position.set(mx, 1.94, -1.35);
    wheelhouse.add(mullion);

    const brassStrip = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.04, 1.72, 0.16)), brassMat);
    brassStrip.position.set(mx, 1.94, -1.35);
    wheelhouse.add(brassStrip);
  }

  for (const side of [-1, 1]) {
    const sideLower = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.2, 1.1, 4.8)), mahoganyMat);
    sideLower.position.set(side * 4.3, 0.55, 0.9);
    wheelhouse.add(sideLower);

    const sideHeader = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.2, 0.35, 4.8)), mahoganyMat);
    sideHeader.position.set(side * 4.3, 2.82, 0.9);
    wheelhouse.add(sideHeader);

    const aftPost = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.22, 1.75, 0.8)), mahoganyMat);
    aftPost.position.set(side * 4.3, 1.94, 2.8);
    wheelhouse.add(aftPost);
  }

  const frontGlass = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(8.3, 1.65)), bridgeGlassMat);
  frontGlass.position.set(0, 1.94, -1.34);
  frontGlass.renderOrder = 5;
  wheelhouse.add(frontGlass);

  // Brass Clinometer (Heel Angle Pendulum) Mounted on Front Header
  const clinoCase = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 20)), brassMat);
  clinoCase.rotation.x = Math.PI / 2;
  clinoCase.position.set(0, 2.79, -1.18);
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
  clinoFace.position.set(0, 2.79, -1.145);
  wheelhouse.add(clinoFace);

  const clinometerNeedle = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.016, 0.1, 0.01)), portLightMat);
  clinometerNeedle.position.set(0, 2.79, -1.135);
  wheelhouse.add(clinometerNeedle);

  // Ship's Helm Wheel & Pedestal
  const helmBase = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.16, 0.25, 1.05, 16)), mahoganyMat);
  helmBase.position.set(0, 0.55, 0.18);
  helmBase.castShadow = true;
  wheelhouse.add(helmBase);

  const helmCollar = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.19, 0.19, 0.14, 16)), brassMat);
  helmCollar.position.set(0, 1.04, 0.18);
  wheelhouse.add(helmCollar);

  const helmIndicatorPlate = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.36, 0.04, 0.12)), brassMat);
  helmIndicatorPlate.position.set(0, 1.12, 0.02);
  wheelhouse.add(helmIndicatorPlate);

  const rudderNeedle = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.03, 0.04, 0.1)), portLightMat);
  rudderNeedle.position.set(0, 1.15, 0.02);
  wheelhouse.add(rudderNeedle);

  const helmWheel = new THREE.Group();
  helmWheel.position.set(0, 1.06, 0.28);
  wheelhouse.add(helmWheel);

  const wheelRim = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.46, 0.042, 14, 36)), mahoganyMat);
  helmWheel.add(wheelRim);

  const wheelOuterBrass = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.46, 0.016, 8, 36)), brassMat);
  wheelOuterBrass.position.z = 0.03;
  helmWheel.add(wheelOuterBrass);

  const innerBrassRing = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.28, 0.018, 10, 28)), brassMat);
  helmWheel.add(innerBrassRing);

  const wheelHub = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.095, 0.095, 0.13, 18)), brassMat);
  wheelHub.rotation.x = Math.PI / 2;
  helmWheel.add(wheelHub);

  const spokeGeo = trackGeo(new THREE.CylinderGeometry(0.018, 0.025, 0.62, 10));
  const gripGeo = trackGeo(new THREE.CylinderGeometry(0.027, 0.019, 0.15, 10));
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    const spokeGroup = new THREE.Group();
    spokeGroup.rotation.z = angle;

    const spoke = new THREE.Mesh(spokeGeo, mahoganyMat);
    spoke.position.y = 0.31;
    spokeGroup.add(spoke);

    const grip = new THREE.Mesh(gripGeo, i === 0 ? brassMat : mahoganyMat);
    grip.position.y = 0.56;
    spokeGroup.add(grip);

    helmWheel.add(spokeGroup);
  }

  // Kelvin Compass Binnacle (Left of Helm)
  const binnacleGroup = new THREE.Group();
  binnacleGroup.position.set(-0.92, 0, -0.32);
  wheelhouse.add(binnacleGroup);

  const binnacleStand = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.17, 0.24, 0.96, 18)), mahoganyMat);
  binnacleStand.position.y = 0.48;
  binnacleGroup.add(binnacleStand);

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

  // Dual Chadburn Engine Order Telegraphs
  const telegraphDialMats: THREE.MeshStandardMaterial[] = [];
  const makeTelegraph = (xPos: number): THREE.Group => {
    const tGroup = new THREE.Group();
    tGroup.position.set(xPos, 0, -0.32);

    const ped = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.09, 0.19, 0.98, 14)), brassMat);
    ped.position.y = 0.49;
    tGroup.add(ped);

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

    const arm = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.03, 0.34, 0.035)), brassMat);
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

  // Brass Overhead Speaking Tube on Port Mullion
  const speakCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.35, 1.1, -1.1),
    new THREE.Vector3(-1.35, 1.55, -1.1),
    new THREE.Vector3(-1.3, 1.62, -0.95),
  ]);
  const speakTube = new THREE.Mesh(trackGeo(new THREE.TubeGeometry(speakCurve, 12, 0.026, 8, false)), brassMat);
  wheelhouse.add(speakTube);

  // Overhead Bridge Lamps
  for (const lx of [-1.4, 1.4]) {
    const fixture = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.08, 0.11, 0.14, 10)), brassMat);
    fixture.position.set(lx, 2.88, -0.3);
    wheelhouse.add(fixture);

    const bulb = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.065, 10, 10)), warmGlowMat);
    bulb.position.set(lx, 2.78, -0.3);
    wheelhouse.add(bulb);
  }

  const warmBridgeLight = new THREE.PointLight(0xffad58, 4.4, 9.0, 1.6);
  warmBridgeLight.position.set(0, 13.5, 0.1);
  hullMeshGroup.add(warmBridgeLight);

  // Subtle Warm Boat Deck Glow so Upper Superstructure & Funnels Catch Warm Amber Against Cold Moonlight
  const boatDeckGlow = new THREE.PointLight(0xffb86b, 6.5, 55, 1.4);
  boatDeckGlow.position.set(0, 13.5, 22);
  hullMeshGroup.add(boatDeckGlow);

  // Rising Wheelhouse Floodwater Plane
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
  const whFloodMesh = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(8.5, 4.9)), whFloodMat);
  whFloodMesh.rotation.x = -Math.PI / 2;
  whFloodMesh.position.set(0, 0.02, 0.45);
  whFloodMesh.visible = false;
  whFloodMesh.renderOrder = 4;
  wheelhouse.add(whFloodMesh);

  // Bridge Roof Searchlight Projector
  const searchlightHead = new THREE.Group();
  searchlightHead.position.set(0, 14.3, -1.2);
  const slHousing = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.28, 0.24, 0.65, 14)), brassMat);
  slHousing.rotation.x = Math.PI / 2;
  searchlightHead.add(slHousing);
  hullMeshGroup.add(searchlightHead);

  const searchlightTarget = new THREE.Object3D();
  searchlightTarget.position.set(0, 1.5, -135);
  root.add(searchlightTarget);

  const setPowerLevel = (power: number) => {
    const p = THREE.MathUtils.clamp(power, 0, 1);
    warmBridgeLight.intensity = 4.4 * p;
    boatDeckGlow.intensity = 6.5 * p;
    warmGlowMat.emissiveIntensity = 1.85 * p;
    portholeGlowMat.emissiveIntensity = 1.65 * p;
    compassCardMat.emissiveIntensity = 0.78 * p;
    clinoFaceMat.emissiveIntensity = 0.45 * p;
    for (const dm of telegraphDialMats) {
      dm.emissiveIntensity = 0.68 * p;
    }
    portLightMat.emissiveIntensity = 2.3 * p;
    starboardLightMat.emissiveIntensity = 2.3 * p;
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
    setPowerLevel,
    setWheelhouseFloodLevel,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
