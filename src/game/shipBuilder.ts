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
  warmBridgeLight: THREE.PointLight;
  setPowerLevel: (power: number) => void;
  setWheelhouseFloodLevel: (level: number) => void;
  dispose: () => void;
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

  // Materials with varied roughness >= 0.25 between adjacent parts
  const mahoganyMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.mahoganyAlbedo,
      roughnessMap: textures.mahoganyRoughness,
      roughness: 0.34,
      metalness: 0.05,
    }),
  );

  const brassMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xd4a84f,
      metalness: 0.92,
      roughness: 0.18,
      anisotropy: 0.75,
      clearcoat: 0.4,
    }),
  );

  const darkIronMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1d232b,
      metalness: 0.75,
      roughness: 0.45,
    }),
  );

  const teakDeckMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.teakDeckAlbedo,
      roughness: 0.84,
      metalness: 0.02,
    }),
  );

  const steelHullMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.steelHullAlbedo,
      color: 0x1c222c,
      roughness: 0.56,
      metalness: 0.42,
    }),
  );

  const antiFoulMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x5d1919,
      roughness: 0.72,
      metalness: 0.1,
    }),
  );

  const whitePaintMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xe6e4dc,
      roughness: 0.66,
      metalness: 0.04,
    }),
  );

  const goldStripeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xc99c43,
      roughness: 0.28,
      metalness: 0.7,
    }),
  );

  const buffFunnelMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xc49557,
      roughness: 0.62,
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
      opacity: isSoftwareGl ? 0.14 : 1.0,
      ior: 1.52,
      thickness: 0.08,
      depthWrite: false,
    }),
  );

  const warmGlowMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffdf9e,
      emissive: 0xffa947,
      emissiveIntensity: 1.7,
      roughness: 0.3,
    }),
  );

  const portLightMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xff3b3b,
      emissive: 0xdc2626,
      emissiveIntensity: 2.2,
      roughness: 0.25,
    }),
  );

  const starboardLightMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x34d399,
      emissive: 0x10b981,
      emissiveIntensity: 2.2,
      roughness: 0.25,
    }),
  );

  // =========================================================================
  // 1. FORWARD HULL & FORECASTLE (Extruded realistic bow silhouette)
  // =========================================================================
  // Shape in X-Z plan (extruded vertically along Y)
  const hullPlan = new THREE.Shape();
  hullPlan.moveTo(0, -68); // Razor bow stem at z = -68
  hullPlan.bezierCurveTo(3.8, -56, 7.6, -38, 8.8, -16);
  hullPlan.lineTo(9.4, 22);
  hullPlan.lineTo(-9.4, 22);
  hullPlan.lineTo(-8.8, -16);
  hullPlan.bezierCurveTo(-7.6, -38, -3.8, -56, 0, -68);

  const mainHullGeo = trackGeo(
    new THREE.ExtrudeGeometry(hullPlan, {
      depth: 4.95,
      bevelEnabled: true,
      bevelThickness: 0.45,
      bevelSize: 0.35,
      bevelSegments: 2,
      curveSegments: 18,
    }),
  );
  // Rotate so shape's Y maps to world Z (forward -Z), extrude depth goes +Y
  mainHullGeo.rotateX(Math.PI / 2);
  const mainHull = new THREE.Mesh(mainHullGeo, steelHullMat);
  mainHull.position.y = 5.4;
  mainHull.castShadow = true;
  mainHull.receiveShadow = true;
  hullMeshGroup.add(mainHull);

  // Red antifouling lower hull band around waterline
  const lowerHullGeo = trackGeo(
    new THREE.ExtrudeGeometry(hullPlan, {
      depth: 2.4,
      bevelEnabled: false,
      curveSegments: 14,
    }),
  );
  lowerHullGeo.rotateX(Math.PI / 2);
  const lowerHull = new THREE.Mesh(lowerHullGeo, antiFoulMat);
  lowerHull.position.y = 0.7;
  lowerHull.scale.set(0.99, 1, 0.99);
  hullMeshGroup.add(lowerHull);

  // Gold sheer pinstripe along upper hull
  const stripeGeo = trackGeo(
    new THREE.ExtrudeGeometry(hullPlan, {
      depth: 0.24,
      bevelEnabled: false,
      curveSegments: 16,
    }),
  );
  stripeGeo.rotateX(Math.PI / 2);
  const goldStripe = new THREE.Mesh(stripeGeo, goldStripeMat);
  goldStripe.position.y = 5.25;
  goldStripe.scale.set(1.015, 1, 1.005);
  hullMeshGroup.add(goldStripe);

  // Raised Forecastle Deck (bow to z = -34)
  const forecastleShape = new THREE.Shape();
  forecastleShape.moveTo(0, -67.6);
  forecastleShape.bezierCurveTo(3.6, -55.5, 7.2, -39, 8.2, -33);
  forecastleShape.lineTo(-8.2, -33);
  forecastleShape.bezierCurveTo(-7.2, -39, -3.6, -55.5, 0, -67.6);

  const forecastleHullGeo = trackGeo(
    new THREE.ExtrudeGeometry(forecastleShape, {
      depth: 1.75,
      bevelEnabled: true,
      bevelThickness: 0.18,
      bevelSize: 0.14,
      bevelSegments: 2,
      curveSegments: 16,
    }),
  );
  forecastleHullGeo.rotateX(Math.PI / 2);
  const forecastleHull = new THREE.Mesh(forecastleHullGeo, whitePaintMat);
  forecastleHull.position.y = 7.05;
  forecastleHull.castShadow = true;
  forecastleHull.receiveShadow = true;
  hullMeshGroup.add(forecastleHull);

  // Teak Forecastle Deck Planking
  const forecastleTeakGeo = trackGeo(
    new THREE.ExtrudeGeometry(forecastleShape, {
      depth: 0.12,
      bevelEnabled: false,
      curveSegments: 16,
    }),
  );
  forecastleTeakGeo.rotateX(Math.PI / 2);
  const forecastleTeak = new THREE.Mesh(forecastleTeakGeo, teakDeckMat);
  forecastleTeak.position.y = 7.22;
  forecastleTeak.scale.set(0.96, 1, 0.99);
  forecastleTeak.receiveShadow = true;
  hullMeshGroup.add(forecastleTeak);

  // Forward Well Deck Teak Floor (z = -33 to z = -10)
  const wellDeck = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(16.2, 0.25, 24)), teakDeckMat);
  wellDeck.position.set(0, 5.45, -21.5);
  wellDeck.receiveShadow = true;
  hullMeshGroup.add(wellDeck);

  // Forward Cargo Hatch #1 & #2 + Steam Cranes
  for (const hz of [-28, -19]) {
    const hatchBase = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(5.2, 0.75, 4.6)), whitePaintMat);
    hatchBase.position.set(0, 5.9, hz);
    hatchBase.castShadow = true;
    hatchBase.receiveShadow = true;
    hullMeshGroup.add(hatchBase);

    const hatchCover = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(4.8, 0.22, 4.2)), teakDeckMat);
    hatchCover.position.set(0, 6.35, hz);
    hullMeshGroup.add(hatchCover);
  }

  // Twin Anchor Windlasses & Capstans on Forecastle
  for (const cx of [-2.4, 2.4]) {
    const capstan = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.55, 0.72, 1.05, 16)), darkIronMat);
    capstan.position.set(cx, 7.75, -52);
    capstan.castShadow = true;
    hullMeshGroup.add(capstan);

    const capstanCap = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.62, 0.62, 0.18, 16)), brassMat);
    capstanCap.position.set(cx, 8.32, -52);
    hullMeshGroup.add(capstanCap);

    // Anchor chain runs toward hawsepipes
    const chain = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.24, 0.14, 10)), darkIronMat);
    chain.position.set(cx * 0.72, 7.28, -57.5);
    chain.rotation.y = cx < 0 ? -0.14 : 0.14;
    hullMeshGroup.add(chain);
  }

  // Forward Anchor Crane at Bow
  const cranePost = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.22, 0.28, 3.6, 12)), whitePaintMat);
  cranePost.position.set(0, 8.9, -62.5);
  cranePost.castShadow = true;
  hullMeshGroup.add(cranePost);

  const craneBoom = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.2, 0.24, 3.8)), darkIronMat);
  craneBoom.position.set(0, 10.3, -64.1);
  craneBoom.rotation.x = 0.35;
  hullMeshGroup.add(craneBoom);

  // White Bow Railings along Forecastle edges
  const railPostsGroup = new THREE.Group();
  const bowEdgePoints: Array<[number, number]> = [
    [0, -67.3],
    [2.6, -59],
    [5.2, -48],
    [7.5, -35],
  ];
  for (const side of [-1, 1]) {
    for (let i = 0; i < bowEdgePoints.length; i++) {
      const [px, pz] = bowEdgePoints[i];
      const post = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.06, 0.06, 1.05, 8)), whitePaintMat);
      post.position.set(px * side, 7.72, pz);
      railPostsGroup.add(post);

      if (i < bowEdgePoints.length - 1) {
        const [nx, nz] = bowEdgePoints[i + 1];
        const dx = (nx - px) * side;
        const dz = nz - pz;
        const len = Math.hypot(dx, dz);
        const rail = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.045, 0.045, len, 8)), teakDeckMat);
        rail.position.set(((px + nx) / 2) * side, 8.22, (pz + nz) / 2);
        rail.rotation.x = Math.PI / 2;
        rail.rotation.z = -Math.atan2(dx, dz);
        railPostsGroup.add(rail);
      }
    }
  }
  hullMeshGroup.add(railPostsGroup);

  // =========================================================================
  // 2. FOREMAST, CROW'S NEST & BOW MASTHEAD LIGHT
  // =========================================================================
  const foremast = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.15, 0.24, 24, 14)), buffFunnelMat);
  foremast.position.set(0, 17.5, -24.5);
  foremast.castShadow = true;
  hullMeshGroup.add(foremast);

  // Crow's Nest Basket (elevated above horizon line so center view remains open!)
  const crowsNest = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.82, 0.62, 1.35, 16)), whitePaintMat);
  crowsNest.position.set(0, 19.6, -24.3);
  crowsNest.castShadow = true;
  hullMeshGroup.add(crowsNest);

  const crowsNestRim = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.82, 0.08, 8, 24)), teakDeckMat);
  crowsNestRim.rotation.x = Math.PI / 2;
  crowsNestRim.position.set(0, 20.28, -24.3);
  hullMeshGroup.add(crowsNestRim);

  // Warm masthead lookout lantern
  const mastLantern = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.22, 12, 12)), warmGlowMat);
  mastLantern.position.set(0, 21.8, -24.3);
  hullMeshGroup.add(mastLantern);

  // Yardarm & Rigging Stays
  const yardarm = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.08, 0.08, 8.5, 10)), buffFunnelMat);
  yardarm.rotation.z = Math.PI / 2;
  yardarm.position.set(0, 23.8, -24.5);
  hullMeshGroup.add(yardarm);

  const stayMat = trackMat(new THREE.MeshBasicMaterial({ color: 0x455060 }));
  for (const sx of [-6.8, 6.8]) {
    const stayGeo = trackGeo(
      new THREE.TubeGeometry(
        new THREE.LineCurve3(new THREE.Vector3(0, 25.5, -24.5), new THREE.Vector3(sx, 7.4, -40)),
        4,
        0.04,
        6,
        false,
      ),
    );
    hullMeshGroup.add(new THREE.Mesh(stayGeo, stayMat));
  }

  // =========================================================================
  // 3. SUPERSTRUCTURE BRIDGE DECK & #1 FUNNEL (aft of wheelhouse)
  // =========================================================================
  const superstructureBlock = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(17.8, 5.6, 32)), whitePaintMat);
  superstructureBlock.position.set(0, 8.1, 6.0);
  superstructureBlock.castShadow = true;
  superstructureBlock.receiveShadow = true;
  hullMeshGroup.add(superstructureBlock);

  // Bridge Wings (Port & Starboard protruding out to +/- 11.5)
  const bridgeWingDeck = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(23.5, 0.35, 3.6)), teakDeckMat);
  bridgeWingDeck.position.set(0, 10.95, -0.3);
  bridgeWingDeck.receiveShadow = true;
  hullMeshGroup.add(bridgeWingDeck);

  // Bridge Wing Dodger Walls & Port/Starboard Navigation Lights
  for (const side of [-1, 1]) {
    const wingWall = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(7.2, 1.15, 0.25)), whitePaintMat);
    wingWall.position.set(side * 8.1, 11.65, -2.0);
    hullMeshGroup.add(wingWall);

    const sideCab = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.28, 1.15, 3.6)), whitePaintMat);
    sideCab.position.set(side * 11.6, 11.65, -0.3);
    hullMeshGroup.add(sideCab);

    const navLight = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.22, 12, 12)),
      side < 0 ? portLightMat : starboardLightMat,
    );
    navLight.position.set(side * 11.65, 12.45, -1.9);
    hullMeshGroup.add(navLight);
  }

  // Iconic #1 Funnel (visible in Bridge Wing camera & aft view)
  const funnelGroup = new THREE.Group();
  funnelGroup.position.set(0, 11.0, 13.5);
  funnelGroup.rotation.x = 0.08; // authentic Titanic funnel rake
  const funnelBody = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(2.15, 2.35, 11.5, 24)), buffFunnelMat);
  funnelBody.position.y = 5.75;
  funnelBody.castShadow = true;
  funnelGroup.add(funnelBody);

  const funnelCrown = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(2.22, 2.22, 2.2, 24)), darkIronMat);
  funnelCrown.position.y = 10.6;
  funnelGroup.add(funnelCrown);
  hullMeshGroup.add(funnelGroup);

  // =========================================================================
  // 4. WHEELHOUSE INTERIOR (Framed around the player camera at (0, 12.75, 1.35))
  // =========================================================================
  const wheelhouse = new THREE.Group();
  wheelhouse.position.set(0, 11.0, 0);
  hullMeshGroup.add(wheelhouse);

  // Mahogany Plank Floor
  const whFloor = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(8.8, 0.2, 5.2)), teakDeckMat);
  whFloor.position.set(0, 0.05, 0.4);
  whFloor.receiveShadow = true;
  wheelhouse.add(whFloor);

  // Mahogany Lower Front Wainscoting (sill height y = 1.05 above whFloor -> world y = 12.05)
  const frontWainscot = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(8.6, 1.05, 0.22)), mahoganyMat);
  frontWainscot.position.set(0, 0.55, -1.35);
  frontWainscot.receiveShadow = true;
  wheelhouse.add(frontWainscot);

  // Brass Window Sill Trim
  const sillTrim = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(8.65, 0.08, 0.28)), brassMat);
  sillTrim.position.set(0, 1.1, -1.35);
  wheelhouse.add(sillTrim);

  // Overhead Mahogany Header & Roof Ribs (y = 2.75 above whFloor -> world y = 13.75)
  const frontHeader = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(8.8, 0.35, 0.3)), mahoganyMat);
  frontHeader.position.set(0, 2.82, -1.35);
  wheelhouse.add(frontHeader);

  const whRoof = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(9.0, 0.22, 5.4)), mahoganyMat);
  whRoof.position.set(0, 3.05, 0.45);
  wheelhouse.add(whRoof);

  // Window Mullion Pillars (5 panoramic bridge windows, wide clear center bay)
  for (const mx of [-4.2, -2.55, -1.05, 1.05, 2.55, 4.2]) {
    const mullion = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.11, 1.72, 0.14)), mahoganyMat);
    mullion.position.set(mx, 1.94, -1.35);
    wheelhouse.add(mullion);

    const brassStrip = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.04, 1.72, 0.16)), brassMat);
    brassStrip.position.set(mx, 1.94, -1.35);
    wheelhouse.add(brassStrip);
  }

  // Side Mahogany Bulkheads with Side Windows
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

  // Clear Optical Bridge Glass Panes (sorted cleanly with renderOrder)
  const frontGlass = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(8.3, 1.65)), bridgeGlassMat);
  frontGlass.position.set(0, 1.94, -1.34);
  frontGlass.renderOrder = 5;
  wheelhouse.add(frontGlass);

  // =========================================================================
  // 5. SHIP'S HELM WHEEL & STEERING PEDESTAL (Center Hero Object!)
  // =========================================================================
  const helmBase = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.16, 0.24, 1.05, 16)), mahoganyMat);
  helmBase.position.set(0, 0.55, 0.18);
  helmBase.castShadow = true;
  wheelhouse.add(helmBase);

  const helmCollar = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.18, 0.18, 0.14, 16)), brassMat);
  helmCollar.position.set(0, 1.04, 0.18);
  wheelhouse.add(helmCollar);

  // Rudder Angle Indicator Plate on top of Pedestal
  const helmIndicatorPlate = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.36, 0.04, 0.12)), brassMat);
  helmIndicatorPlate.position.set(0, 1.12, 0.02);
  wheelhouse.add(helmIndicatorPlate);

  const rudderNeedle = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.03, 0.04, 0.1)), portLightMat);
  rudderNeedle.position.set(0, 1.15, 0.02);
  wheelhouse.add(rudderNeedle);

  const helmWheel = new THREE.Group();
  helmWheel.position.set(0, 1.06, 0.28);
  wheelhouse.add(helmWheel);

  // Outer Wooden Rim + Inner Brass Ring + Hub + 8 Turned Spokes
  const wheelRim = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.46, 0.042, 12, 32)), mahoganyMat);
  helmWheel.add(wheelRim);

  const innerBrassRing = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.28, 0.018, 10, 28)), brassMat);
  helmWheel.add(innerBrassRing);

  const wheelHub = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 16)), brassMat);
  wheelHub.rotation.x = Math.PI / 2;
  helmWheel.add(wheelHub);

  const spokeGeo = trackGeo(new THREE.CylinderGeometry(0.018, 0.024, 0.62, 8));
  const gripGeo = trackGeo(new THREE.CylinderGeometry(0.026, 0.018, 0.14, 8));
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

  // =========================================================================
  // 6. COMPASS BINNACLE (Left of Helm)
  // =========================================================================
  const binnacleGroup = new THREE.Group();
  binnacleGroup.position.set(-0.92, 0, -0.32);
  wheelhouse.add(binnacleGroup);

  const binnacleStand = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.17, 0.24, 0.96, 16)), mahoganyMat);
  binnacleStand.position.y = 0.48;
  binnacleGroup.add(binnacleStand);

  const binnacleHood = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.21, 0.19, 0.22, 16)), brassMat);
  binnacleHood.position.y = 1.02;
  binnacleGroup.add(binnacleHood);

  // Kelvin Flinders compensating brass spheres
  for (const sx of [-0.27, 0.27]) {
    const sphere = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.075, 12, 12)), brassMat);
    sphere.position.set(sx, 0.98, 0);
    binnacleGroup.add(sphere);
  }

  // Glowing rotating compass card inside binnacle
  const compassCardMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.compassDial,
      emissiveMap: textures.compassDial,
      emissive: new THREE.Color(0xffca7a),
      emissiveIntensity: 0.75,
      roughness: 0.4,
    }),
  );
  const compassCard = new THREE.Mesh(trackGeo(new THREE.CircleGeometry(0.165, 24)), compassCardMat);
  compassCard.rotation.x = -Math.PI / 2 + 0.22; // tilted slightly toward helmsman
  compassCard.position.set(0, 1.14, 0.02);
  binnacleGroup.add(compassCard);

  // =========================================================================
  // 7. CHADBURN ENGINE ORDER TELEGRAPHS (Starboard & Port)
  // =========================================================================
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
        emissiveIntensity: 0.65,
        roughness: 0.35,
      }),
    );
    telegraphDialMats.push(dialMat);
    const dialFace = new THREE.Mesh(trackGeo(new THREE.CircleGeometry(0.205, 24)), dialMat);
    dialFace.rotation.y = xPos > 0 ? -Math.PI / 2 : Math.PI / 2;
    dialFace.position.set(xPos > 0 ? -0.085 : 0.085, 1.12, 0);
    tGroup.add(dialFace);

    // Moving Brass Lever Arm
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

  // =========================================================================
  // 8. OVERHEAD BRIDGE LAMPS, FLOODWATER SURFACE & SEARCHLIGHT HOUSING
  // =========================================================================
  for (const lx of [-1.4, 1.4]) {
    const fixture = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.08, 0.11, 0.14, 10)), brassMat);
    fixture.position.set(lx, 2.88, -0.3);
    wheelhouse.add(fixture);

    const bulb = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.065, 10, 10)), warmGlowMat);
    bulb.position.set(lx, 2.78, -0.3);
    wheelhouse.add(bulb);
  }

  const warmBridgeLight = new THREE.PointLight(0xffad58, 4.2, 8.5, 1.6);
  warmBridgeLight.position.set(0, 13.5, 0.1);
  hullMeshGroup.add(warmBridgeLight);

  // Rising Wheelhouse Floodwater Plane (hidden until bridge floods)
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
    warmBridgeLight.intensity = 4.2 * p;
    warmGlowMat.emissiveIntensity = 1.7 * p;
    compassCardMat.emissiveIntensity = 0.75 * p;
    for (const dm of telegraphDialMats) {
      dm.emissiveIntensity = 0.65 * p;
    }
    portLightMat.emissiveIntensity = 2.2 * p;
    starboardLightMat.emissiveIntensity = 2.2 * p;
  };

  const setWheelhouseFloodLevel = (level: number) => {
    const l = THREE.MathUtils.clamp(level, 0, 1);
    if (l <= 0.01) {
      whFloodMesh.visible = false;
      return;
    }
    whFloodMesh.visible = true;
    // Rises from floor (y=0.14) up past the window sill toward the ceiling (y=1.85)
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
    warmBridgeLight,
    setPowerLevel,
    setWheelhouseFloodLevel,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
