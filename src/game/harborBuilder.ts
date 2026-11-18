import * as THREE from 'three';
import { ProceduralTextureSet } from './textures';

export interface HarborRig {
  root: THREE.Group;
  hawsersGroup: THREE.Group;
  update: (simTime: number, shipZ: number, nightMix: number) => void;
  dispose: () => void;
}

function createTerminalSignTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#182433';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = '#d4af5a';
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

  ctx.fillStyle = '#f3ead3';
  ctx.font = 'bold 54px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('WHITE STAR LINE · BERTH 44', canvas.width / 2, 78);

  ctx.fillStyle = '#d4af5a';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('SOUTHAMPTON OCEAN TERMINAL', canvas.width / 2, 136);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createStoneMasonryTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#6f7378';
  ctx.fillRect(0, 0, 512, 512);

  const rows = 16;
  const rowH = 512 / rows;
  for (let r = 0; r < rows; r++) {
    const cols = 8;
    const colW = 512 / cols;
    const offset = (r % 2) * (colW * 0.5);
    for (let c = -1; c <= cols; c++) {
      const shade = 95 + ((r * 19 + c * 31) % 28);
      ctx.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade + 5})`;
      ctx.fillRect(c * colW + offset + 2, r * rowH + 2, colW - 4, rowH - 4);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 2);
  return tex;
}

export function buildSouthamptonHarbor(
  textures: ProceduralTextureSet,
  isSoftwareGl: boolean,
): HarborRig {
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const ownTextures: THREE.Texture[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  const root = new THREE.Group();

  const stoneTex = createStoneMasonryTexture();
  ownTextures.push(stoneTex);
  const signTex = createTerminalSignTexture();
  ownTextures.push(signTex);

  const graniteMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: stoneTex,
      color: 0xa2a6aa,
      roughness: 0.88,
      metalness: 0.05,
    }),
  );
  const copingStoneMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x8e9195,
      roughness: 0.82,
      metalness: 0.06,
    }),
  );
  const cobbleDeckMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x626569,
      roughness: 0.92,
      metalness: 0.04,
    }),
  );
  const timberPilingMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x2a2018,
      roughness: 0.9,
      metalness: 0.05,
    }),
  );
  const brickMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x6f392c,
      roughness: 0.85,
      metalness: 0.05,
    }),
  );
  const limestoneMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xc2b8a3,
      roughness: 0.78,
      metalness: 0.04,
    }),
  );
  const slateRoofMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x2a333f,
      roughness: 0.72,
      metalness: 0.14,
    }),
  );
  const craneSteelMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x3b444c,
      roughness: 0.45,
      metalness: 0.68,
    }),
  );
  const darkIronMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1c2128,
      roughness: 0.42,
      metalness: 0.74,
    }),
  );
  const creamPaintMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xe6e0d2,
      roughness: 0.56,
      metalness: 0.06,
    }),
  );
  const buffFunnelMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xc6985b,
      roughness: 0.58,
      metalness: 0.12,
    }),
  );
  const rustRedMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x7a231c,
      roughness: 0.68,
      metalness: 0.16,
    }),
  );
  const greenHillMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x3f5436,
      roughness: 0.94,
      metalness: 0.02,
    }),
  );
  const headlandRockMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x565a5e,
      roughness: 0.9,
      metalness: 0.05,
    }),
  );
  const terminalSignMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: signTex,
      roughness: 0.48,
      metalness: 0.12,
    }),
  );
  const warmLanternMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffd78c,
      emissive: new THREE.Color(0xffb44c),
      emissiveIntensity: 1.5,
      roughness: 0.25,
    }),
  );
  const beaconConeMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  const hawserMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x9b845e,
      roughness: 0.92,
      metalness: 0.02,
    }),
  );

  // =========================================================================
  // 1. SOUTHAMPTON BERTH 44 GRANITE QUAY WALL, COPING, TIMBER FENDERS & BOLLARDS
  // =========================================================================
  const quayWallGeo = trackGeo(new THREE.BoxGeometry(66, 9.2, 540));
  const quayWall = new THREE.Mesh(quayWallGeo, graniteMat);
  quayWall.position.set(52.5, -0.4, -30);
  quayWall.receiveShadow = true;
  quayWall.castShadow = true;
  root.add(quayWall);

  const quayApronGeo = trackGeo(new THREE.BoxGeometry(66.4, 0.3, 540.4));
  const quayApron = new THREE.Mesh(quayApronGeo, cobbleDeckMat);
  quayApron.position.set(52.5, 4.25, -30);
  quayApron.receiveShadow = true;
  root.add(quayApron);

  const copingGeo = trackGeo(new THREE.BoxGeometry(1.1, 0.48, 540.4));
  const coping = new THREE.Mesh(copingGeo, copingStoneMat);
  coping.position.set(19.9, 4.22, -30);
  coping.receiveShadow = true;
  root.add(coping);

  // Timber Fender Pilings along water face of Berth 44 (x = 19.2)
  const fenderGeo = trackGeo(new THREE.BoxGeometry(0.45, 7.6, 0.48));
  const fenderMesh = new THREE.InstancedMesh(fenderGeo, timberPilingMat, 68);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 68; i++) {
    dummy.position.set(19.25, 1.0, -290 + i * 7.8);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    fenderMesh.setMatrixAt(i, dummy.matrix);
  }
  fenderMesh.instanceMatrix.needsUpdate = true;
  fenderMesh.computeBoundingSphere();
  root.add(fenderMesh);

  // Cast-Iron Mooring Bollards (LatheGeometry)
  const bollardGeo = trackGeo(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.36, 0),
        new THREE.Vector2(0.32, 0.14),
        new THREE.Vector2(0.2, 0.22),
        new THREE.Vector2(0.22, 0.72),
        new THREE.Vector2(0.3, 0.85),
        new THREE.Vector2(0.26, 0.96),
      ],
      12,
    ),
  );
  const bollardZList = [-240, -185, -130, -70, -25, 20, 68, 118, 165, 212];
  for (const bz of bollardZList) {
    const bollard = new THREE.Mesh(bollardGeo, darkIronMat);
    bollard.position.set(20.9, 4.35, bz);
    bollard.castShadow = !isSoftwareGl;
    root.add(bollard);
  }

  // Mooring Hawsers tying Titanic to Berth 44 Bollards (cast off as ship moves past z = -16)
  const hawsersGroup = new THREE.Group();
  const mooringPairs: Array<[number, number, number]> = [
    [12.2, 8.8, -42],
    [13.8, 7.6, -15],
    [14.0, 7.2, 22],
    [14.0, 7.2, 74],
    [13.8, 7.2, 125],
    [11.6, 7.6, 168],
  ];
  for (const [sx, sy, sz] of mooringPairs) {
    const p0 = new THREE.Vector3(sx, sy, sz);
    const p1 = new THREE.Vector3((sx + 20.9) * 0.5, (sy + 4.8) * 0.5 - 0.65, sz + 3);
    const p2 = new THREE.Vector3(20.9, 4.85, sz + 6);
    const curve = new THREE.CatmullRomCurve3([p0, p1, p2]);
    const ropeGeo = trackGeo(new THREE.TubeGeometry(curve, 10, 0.09, 6, false));
    hawsersGroup.add(new THREE.Mesh(ropeGeo, hawserMat));
  }
  root.add(hawsersGroup);

  // =========================================================================
  // 2. WHITE STAR OCEAN TERMINAL & CUSTOMS WAREHOUSES
  // =========================================================================
  const buildWarehouse = (zCenter: number, length: number, withSign: boolean) => {
    const shed = new THREE.Group();
    shed.position.set(52, 4.35, zCenter);

    // Main brick body
    const body = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(22, 10.5, length)), brickMat);
    body.position.y = 5.25;
    body.castShadow = true;
    body.receiveShadow = true;
    shed.add(body);

    // Limestone cornice & vertical pilasters
    const cornice = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(22.8, 0.9, length + 0.8)), limestoneMat);
    cornice.position.y = 10.4;
    shed.add(cornice);

    const bayCount = Math.max(3, Math.floor(length / 18));
    for (let i = 0; i <= bayCount; i++) {
      const pz = -length * 0.5 + (i / bayCount) * length;
      const pilaster = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.65, 10.2, 1.1)), limestoneMat);
      pilaster.position.set(-11.05, 5.1, pz);
      shed.add(pilaster);

      if (i < bayCount) {
        const doorZ = pz + (length / bayCount) * 0.5;
        const arch = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.45, 5.4, 5.6)), darkIronMat);
        arch.position.set(-10.95, 2.7, doorZ);
        shed.add(arch);

        const transom = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.35, 1.4, 4.6)), warmLanternMat);
        transom.position.set(-11.0, 7.6, doorZ);
        shed.add(transom);
      }
    }

    // Pitched slate roof (extruded gable prism)
    const roofShape = new THREE.Shape();
    roofShape.moveTo(-11.8, 0);
    roofShape.lineTo(11.8, 0);
    roofShape.lineTo(0, 5.2);
    roofShape.closePath();
    const roofGeo = trackGeo(
      new THREE.ExtrudeGeometry(roofShape, {
        depth: length + 1.2,
        bevelEnabled: false,
      }),
    );
    roofGeo.translate(0, 0, -(length + 1.2) * 0.5);
    const roof = new THREE.Mesh(roofGeo, slateRoofMat);
    roof.position.y = 10.75;
    roof.castShadow = !isSoftwareGl;
    shed.add(roof);

    // Clerestory ridge skylight
    const ridge = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(3.2, 1.4, length * 0.72)),
      limestoneMat,
    );
    ridge.position.y = 15.6;
    shed.add(ridge);

    if (withSign) {
      const signBoard = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(0.35, 4.2, 26)),
        darkIronMat,
      );
      signBoard.position.set(-11.35, 12.6, 0);
      // Rotate plane so front face points -X toward the ship
      const signFace = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(25.6, 4.0)), terminalSignMat);
      signFace.rotation.y = -Math.PI / 2;
      signFace.position.set(-11.56, 12.6, 0);
      shed.add(signBoard);
      shed.add(signFace);
    }

    root.add(shed);
  };

  buildWarehouse(-140, 96, false);
  buildWarehouse(20, 128, true);
  buildWarehouse(155, 92, false);

  // =========================================================================
  // 3. THREE RIVETED DOCKSIDE ELECTRIC GANTRY CRANES
  // =========================================================================
  const buildGantryCrane = (zPos: number) => {
    const crane = new THREE.Group();
    crane.position.set(25.2, 4.35, zPos);

    // Four portal legs straddling the dock apron track
    for (const lx of [-2.4, 2.4]) {
      for (const lz of [-2.8, 2.8]) {
        const leg = new THREE.Mesh(
          trackGeo(new THREE.BoxGeometry(0.45, 9.6, 0.45)),
          craneSteelMat,
        );
        leg.position.set(lx * 0.85, 4.8, lz * 0.85);
        leg.rotation.z = lx > 0 ? 0.08 : -0.08;
        leg.castShadow = !isSoftwareGl;
        crane.add(leg);
      }
    }

    // Portal gantry platform & slewing machinery house
    const deck = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(4.8, 0.9, 5.4)), craneSteelMat);
    deck.position.y = 9.8;
    crane.add(deck);

    const cab = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(3.8, 3.4, 4.2)), darkIronMat);
    cab.position.set(0.4, 11.9, 0);
    cab.castShadow = !isSoftwareGl;
    crane.add(cab);

    // Angled Jib Boom reaching out toward the ship berth (-X)
    const boom = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.62, 18.5, 0.62)), craneSteelMat);
    boom.position.set(-5.8, 19.0, 0);
    boom.rotation.z = 0.62;
    boom.castShadow = !isSoftwareGl;
    crane.add(boom);

    const tieRod = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.06, 0.06, 15.5, 6)), darkIronMat);
    tieRod.position.set(-4.6, 19.6, 0);
    tieRod.rotation.z = 1.08;
    crane.add(tieRod);

    // Suspended hoist cable & cargo hook
    const cable = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.035, 0.035, 11.5, 6)), darkIronMat);
    cable.position.set(-11.0, 20.4, 0);
    crane.add(cable);

    const hookBlock = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.5, 0.7, 0.5)), buffFunnelMat);
    hookBlock.position.set(-11.0, 14.6, 0);
    crane.add(hookBlock);

    root.add(crane);
  };

  buildGantryCrane(-82);
  buildGantryCrane(42);
  buildGantryCrane(138);

  // =========================================================================
  // 4. TWO ESCORT STEAM TUGBOATS STANDING OFF THE CHANNEL
  // =========================================================================
  const tugs: Array<{ group: THREE.Group; baseY: number; phase: number }> = [];
  const buildSteamTug = (x: number, z: number, yaw: number, phase: number) => {
    const tug = new THREE.Group();
    tug.position.set(x, 0, z);
    tug.rotation.y = yaw;

    // Extruded tug hull profile
    const tugShape = new THREE.Shape();
    tugShape.moveTo(0, -14);
    tugShape.quadraticCurveTo(3.4, -7, 3.6, 2);
    tugShape.quadraticCurveTo(3.3, 11, 0, 13.5);
    tugShape.quadraticCurveTo(-3.3, 11, -3.6, 2);
    tugShape.quadraticCurveTo(-3.4, -7, 0, -14);

    const lowerHullGeo = trackGeo(new THREE.ExtrudeGeometry(tugShape, { depth: 2.0, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.2, bevelSegments: 2 }));
    lowerHullGeo.rotateX(Math.PI / 2);
    const lowerHull = new THREE.Mesh(lowerHullGeo, rustRedMat);
    lowerHull.position.y = 0.6;
    tug.add(lowerHull);

    const upperHullGeo = trackGeo(new THREE.ExtrudeGeometry(tugShape, { depth: 1.8, bevelEnabled: false }));
    upperHullGeo.rotateX(Math.PI / 2);
    const upperHull = new THREE.Mesh(upperHullGeo, darkIronMat);
    upperHull.position.y = 2.4;
    upperHull.castShadow = !isSoftwareGl;
    tug.add(upperHull);

    const deck = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(5.6, 0.25, 22)), buffFunnelMat);
    deck.position.y = 2.52;
    tug.add(deck);

    // Cream Pilot Wheelhouse
    const cabin = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(3.4, 2.6, 5.2)), creamPaintMat);
    cabin.position.set(0, 3.8, -3.2);
    cabin.castShadow = !isSoftwareGl;
    tug.add(cabin);

    const roof = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(3.9, 0.28, 5.8)), darkIronMat);
    roof.position.set(0, 5.2, -3.2);
    tug.add(roof);

    // Tall Tug Funnel
    const funnel = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.68, 0.78, 6.2, 16)), buffFunnelMat);
    funnel.position.set(0, 5.8, 2.2);
    funnel.rotation.x = 0.08;
    funnel.castShadow = !isSoftwareGl;
    tug.add(funnel);

    const funnelCap = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.7, 0.7, 1.3, 16)), darkIronMat);
    funnelCap.position.set(0, 8.4, 2.4);
    funnelCap.rotation.x = 0.08;
    tug.add(funnelCap);

    // Towing Mast & Lantern
    const mast = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.08, 0.14, 9.2, 8)), buffFunnelMat);
    mast.position.set(0, 7.2, -6.4);
    tug.add(mast);

    const tugLamp = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.2, 8, 8)), warmLanternMat);
    tugLamp.position.set(0, 11.4, -6.4);
    tug.add(tugLamp);

    root.add(tug);
    tugs.push({ group: tug, baseY: 0, phase });
  };

  buildSteamTug(-34, -142, 0.14, 0.4);
  buildSteamTug(38, -285, -0.18, 2.1);

  // =========================================================================
  // 5. HARBOR CHANNEL BUOYS (6 BOBBING BELL BUOYS)
  // =========================================================================
  const buoys: Array<{ group: THREE.Group; phase: number }> = [];
  const buoyBaseGeo = trackGeo(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.01, -0.5),
        new THREE.Vector2(1.45, 0.0),
        new THREE.Vector2(1.55, 0.55),
        new THREE.Vector2(0.65, 0.9),
        new THREE.Vector2(0.45, 1.8),
        new THREE.Vector2(0.1, 2.9),
      ],
      12,
    ),
  );
  const portBuoyMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0xb43025, roughness: 0.52, metalness: 0.25 }),
  );
  const stbdBuoyMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x246b4c, roughness: 0.52, metalness: 0.25 }),
  );

  for (const bz of [-210, -340, -455]) {
    for (const side of [-1, 1]) {
      const bGroup = new THREE.Group();
      bGroup.position.set(side * 46, 0.15, bz);
      const hull = new THREE.Mesh(buoyBaseGeo, side < 0 ? portBuoyMat : stbdBuoyMat);
      bGroup.add(hull);

      const cage = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.32, 0.36, 0.75, 8)), darkIronMat);
      cage.position.y = 3.2;
      bGroup.add(cage);

      const beacon = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.24, 10, 10)), warmLanternMat);
      beacon.position.y = 3.7;
      bGroup.add(beacon);

      root.add(bGroup);
      buoys.push({ group: bGroup, phase: bz * 0.03 + side });
    }
  }

  // =========================================================================
  // 6. STONE BREAKWATER ARMS & MASONRY LIGHTHOUSES AT HARBOR MOUTH (z = -515)
  // =========================================================================
  const beaconRotors: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    // Rubble-mound & granite breakwater mole
    const moleGeo = trackGeo(new THREE.BoxGeometry(260, 7.5, 18));
    const mole = new THREE.Mesh(moleGeo, graniteMat);
    mole.position.set(side * 190, 1.6, -515);
    mole.rotation.y = side * -0.14;
    mole.receiveShadow = true;
    root.add(mole);

    // Circular masonry pier head
    const headGeo = trackGeo(new THREE.CylinderGeometry(13.5, 15.2, 8.2, 20));
    const head = new THREE.Mesh(headGeo, copingStoneMat);
    head.position.set(side * 60, 1.8, -497);
    root.add(head);

    // Cylindrical Whitewashed Lighthouse Tower
    const towerGeo = trackGeo(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(4.2, 0),
          new THREE.Vector2(3.5, 6),
          new THREE.Vector2(2.8, 16),
          new THREE.Vector2(3.3, 16.6),
          new THREE.Vector2(3.3, 17.6),
        ],
        20,
      ),
    );
    const tower = new THREE.Mesh(towerGeo, creamPaintMat);
    tower.position.set(side * 60, 5.8, -497);
    tower.castShadow = !isSoftwareGl;
    root.add(tower);

    // Red-brick lighthouse band
    const band = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(3.05, 3.25, 3.6, 20)), rustRedMat);
    band.position.set(side * 60, 17.0, -497);
    root.add(band);

    // Iron Lantern Gallery & Glowing Optical Lens
    const lantern = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(2.1, 2.1, 3.1, 14)), warmLanternMat);
    lantern.position.set(side * 60, 24.8, -497);
    root.add(lantern);

    const dome = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(2.5, 2.2, 16)), darkIronMat);
    dome.position.set(side * 60, 27.3, -497);
    root.add(dome);

    // Rotating Lighthouse Beacon Cone
    const rotor = new THREE.Group();
    rotor.position.set(side * 60, 24.8, -497);
    const beamConeGeo = trackGeo(new THREE.ConeGeometry(6.5, 68, 16, 1, true));
    beamConeGeo.translate(0, -34, 0);
    beamConeGeo.rotateX(Math.PI / 2);
    const beamMesh = new THREE.Mesh(beamConeGeo, beaconConeMat);
    rotor.add(beamMesh);
    root.add(rotor);
    beaconRotors.push(rotor);
  }

  // =========================================================================
  // 7. HAMPSHIRE COASTLINE & GREEN HEADLAND BLUFFS (Natural Backdrop)
  // =========================================================================
  const shoreHills: Array<[number, number, number, number, number, boolean]> = [
    [135, -380, 95, 26, 175, false],
    [155, -160, 110, 32, 220, false],
    [145, 95, 105, 28, 210, false],
    [160, 260, 115, 24, 150, false],
    [-250, -390, 140, 34, 210, true],
    [-270, -140, 150, 38, 260, false],
    [-260, 120, 130, 30, 230, true],
  ];
  for (const [hx, hz, rx, ry, rz, rocky] of shoreHills) {
    const hillGeo = trackGeo(new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55));
    const hill = new THREE.Mesh(hillGeo, rocky ? headlandRockMat : greenHillMat);
    hill.position.set(hx, -2, hz);
    hill.scale.set(rx, ry, rz);
    hill.receiveShadow = true;
    root.add(hill);
  }

  const update = (simTime: number, shipZ: number, nightMix: number) => {
    // Cast off mooring lines once Titanic glides forward out of Berth 44
    hawsersGroup.visible = shipZ > -16;

    // Gentle harbor wave bobbing on escort tugs & channel buoys
    for (const tug of tugs) {
      tug.group.position.y = Math.sin(simTime * 1.4 + tug.phase) * 0.16;
      tug.group.rotation.z = Math.sin(simTime * 1.1 + tug.phase) * 0.025;
      tug.group.rotation.x = Math.cos(simTime * 0.9 + tug.phase) * 0.015;
    }
    for (const buoy of buoys) {
      buoy.group.position.y = 0.12 + Math.sin(simTime * 1.9 + buoy.phase) * 0.22;
      buoy.group.rotation.z = Math.sin(simTime * 1.5 + buoy.phase) * 0.09;
      buoy.group.rotation.x = Math.cos(simTime * 1.3 + buoy.phase) * 0.07;
    }

    // Rotate lighthouse beacons & intensify lantern glow as dusk falls
    beaconRotors.forEach((r, idx) => {
      r.rotation.y = simTime * (idx === 0 ? 0.55 : -0.55) + idx * 1.8;
    });
    beaconConeMat.opacity = 0.06 + nightMix * 0.22;
    warmLanternMat.emissiveIntensity = 0.7 + nightMix * 1.6;
  };

  const dispose = () => {
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    ownTextures.forEach((t) => t.dispose());
  };

  return {
    root,
    hawsersGroup,
    update,
    dispose,
  };
}
