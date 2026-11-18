import * as THREE from 'three';
import { ProceduralTextureSet } from './textures';

export interface HarborCircleObstacle {
  id: string;
  kind: 'tug' | 'pilot' | 'lifeboat' | 'buoy' | 'pier';
  x: number;
  z: number;
  radius: number;
  label: string;
}

export interface HarborBoxObstacle {
  id: string;
  kind: 'quay' | 'breakwater';
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  label: string;
}

export interface HarborRig {
  root: THREE.Group;
  hawsersGroup: THREE.Group;
  update: (
    simTime: number,
    shipX: number,
    shipZ: number,
    headingRad: number,
    speedKnots: number,
    floodingPct: number,
    nightMix: number,
    dt?: number,
    escortActive?: boolean,
  ) => void;
  resetEscorts: () => void;
  getCircleObstacles: () => readonly HarborCircleObstacle[];
  getBoxObstacles: () => readonly HarborBoxObstacle[];
  dispose: () => void;
}

// Pre-allocated math helpers (zero per-frame GC)
const _vDummy = new THREE.Object3D();
const _pelvisMat = new THREE.Matrix4();
const _tmpVecA = new THREE.Vector3();
const _tmpScale = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _tmpEuler = new THREE.Euler();

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
  ctx.fillText('WHITE STAR LINE · BERTH 44', canvas.width / 2, 74);

  ctx.fillStyle = '#d4af5a';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText('SOUTHAMPTON WHITE STAR DOCK · NO. 44 SHED', canvas.width / 2, 134);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createDockClockTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#f7efda';
  ctx.beginPath();
  ctx.arc(128, 128, 120, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2d241b';
  ctx.lineWidth = 10;
  ctx.stroke();

  ctx.save();
  ctx.translate(128, 128);
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    ctx.strokeStyle = '#1b1610';
    ctx.lineWidth = i % 3 === 0 ? 6 : 3;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 86, Math.sin(a) * 86);
    ctx.lineTo(Math.cos(a) * 108, Math.sin(a) * 108);
    ctx.stroke();
  }
  // 12:00 Noon April 10 Departure Time
  ctx.strokeStyle = '#1b1610';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(0, 6);
  ctx.lineTo(0, -68);
  ctx.stroke();
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, 8);
  ctx.lineTo(0, -90);
  ctx.stroke();
  ctx.restore();

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

function createBrickWallTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#8b8378'; // mortar
  ctx.fillRect(0, 0, 512, 512);

  const rows = 24;
  const rowH = 512 / rows;
  const cols = 12;
  const colW = 512 / cols;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (colW * 0.5);
    for (let c = -1; c <= cols; c++) {
      const v = (r * 17 + c * 29) % 26;
      ctx.fillStyle = `rgb(${102 + v}, ${49 + Math.floor(v * 0.55)}, ${37 + Math.floor(v * 0.45)})`;
      ctx.fillRect(c * colW + off + 1.5, r * rowH + 1.5, colW - 3, rowH - 3);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 2);
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
  const brickTex = createBrickWallTexture();
  ownTextures.push(brickTex);
  const signTex = createTerminalSignTexture();
  ownTextures.push(signTex);
  const clockTex = createDockClockTexture();
  ownTextures.push(clockTex);

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
      color: 0x94979b,
      roughness: 0.82,
      metalness: 0.06,
    }),
  );
  const cobbleDeckMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x5c6065,
      roughness: 0.92,
      metalness: 0.04,
    }),
  );
  const timberPilingMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x2c2017,
      roughness: 0.9,
      metalness: 0.05,
    }),
  );
  const brickMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: brickTex,
      color: 0x9f5949,
      roughness: 0.86,
      metalness: 0.04,
    }),
  );
  const limestoneMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xc8bfa9,
      roughness: 0.78,
      metalness: 0.04,
    }),
  );
  const slateRoofMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x28313d,
      roughness: 0.72,
      metalness: 0.14,
    }),
  );
  const craneSteelMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x3b444c,
      roughness: 0.44,
      metalness: 0.7,
    }),
  );
  const darkIronMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1b2027,
      roughness: 0.42,
      metalness: 0.74,
    }),
  );
  const creamPaintMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xe8e2d4,
      roughness: 0.56,
      metalness: 0.06,
    }),
  );
  const buffFunnelMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xc99a5d,
      roughness: 0.58,
      metalness: 0.12,
    }),
  );
  const rustRedMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x7c241d,
      roughness: 0.68,
      metalness: 0.16,
    }),
  );
  const lswrGreenMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x3b593f,
      roughness: 0.46,
      metalness: 0.28,
    }),
  );
  const coachMaroonMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x562321,
      roughness: 0.52,
      metalness: 0.12,
    }),
  );
  const brassMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xd8aa4c,
      roughness: 0.24,
      metalness: 0.86,
    }),
  );
  const greenHillMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x3e5435,
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
  const clockFaceMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: clockTex,
      emissive: new THREE.Color(0xffe1a0),
      emissiveIntensity: 0.35,
      roughness: 0.4,
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
      opacity: 0.16,
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
  // 1. SOUTHAMPTON WHITE STAR DOCK (OCEAN DOCK) — 3-SIDED ENCLOSED TIDAL BASIN
  //    East Quay = Berth 44 (+X), North Head Quay (+Z), West Quay = Berths 43/45 (-X)
  // =========================================================================
  // 1A. East Quay — Berth 44 (z = -176 .. +258, x = +19.5 .. +92)
  const eastQuayLen = 434;
  const eastQuayCenterZ = 41;
  const quayWall = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(72, 9.2, eastQuayLen)),
    graniteMat,
  );
  quayWall.position.set(55.5, -0.4, eastQuayCenterZ);
  quayWall.receiveShadow = true;
  quayWall.castShadow = true;
  root.add(quayWall);

  const quayApron = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(72.4, 0.32, eastQuayLen + 0.4)),
    cobbleDeckMat,
  );
  quayApron.position.set(55.5, 4.25, eastQuayCenterZ);
  quayApron.receiveShadow = true;
  root.add(quayApron);

  const eastCoping = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(1.15, 0.5, eastQuayLen + 0.6)),
    copingStoneMat,
  );
  eastCoping.position.set(19.95, 4.22, eastQuayCenterZ);
  eastCoping.receiveShadow = true;
  root.add(eastCoping);

  // East Pierhead Bullnose framing dock entrance (z = -176)
  const eastPierHead = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(16, 17, 9.4, 20)),
    graniteMat,
  );
  eastPierHead.position.set(35.5, -0.35, -176);
  eastPierHead.receiveShadow = true;
  root.add(eastPierHead);

  const eastPierCoping = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(16.4, 16.4, 0.45, 20)),
    copingStoneMat,
  );
  eastPierCoping.position.set(35.5, 4.25, -176);
  root.add(eastPierCoping);

  // Tide-Signal Lattice Mast & Dockhead Watch-House on East Pierhead
  const dockWatchHouse = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(7.2, 4.8, 8.6)), brickMat);
  dockWatchHouse.position.set(38, 6.75, -174);
  dockWatchHouse.castShadow = !isSoftwareGl;
  root.add(dockWatchHouse);
  const dockWatchRoof = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(6.2, 2.6, 4)), slateRoofMat);
  dockWatchRoof.rotation.y = Math.PI / 4;
  dockWatchRoof.position.set(38, 10.4, -174);
  root.add(dockWatchRoof);

  const signalMast = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.14, 0.26, 16, 8)), creamPaintMat);
  signalMast.position.set(27, 12.2, -177);
  root.add(signalMast);
  const signalArm = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(4.4, 0.22, 0.22)), creamPaintMat);
  signalArm.position.set(27, 17.5, -177);
  root.add(signalArm);
  const tideBall = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.62, 10, 10)), rustRedMat);
  tideBall.position.set(25.2, 16.2, -177);
  root.add(tideBall);

  // 1B. North Basin Head Cross-Quay sealing the northern end (z = +256 .. +318, x = -195 .. +92)
  const northQuay = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(288, 9.2, 62)), graniteMat);
  northQuay.position.set(-51.5, -0.4, 287);
  northQuay.receiveShadow = true;
  root.add(northQuay);
  const northApron = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(288.4, 0.32, 62.4)), cobbleDeckMat);
  northApron.position.set(-51.5, 4.25, 287);
  northApron.receiveShadow = true;
  root.add(northApron);
  const northCoping = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(148, 0.5, 1.2)), copingStoneMat);
  northCoping.position.set(-54, 4.22, 256.2);
  root.add(northCoping);

  // Iconic Edwardian Red-Brick Hydraulic Accumulator & Dockmaster's Clock Tower at North Head (z = 272)
  const clockTower = new THREE.Group();
  clockTower.position.set(-22, 4.35, 272);
  const towerBase = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(11, 22, 11)), brickMat);
  towerBase.position.y = 11;
  towerBase.castShadow = !isSoftwareGl;
  clockTower.add(towerBase);
  const towerQuoin = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(11.6, 1.4, 11.6)), limestoneMat);
  towerQuoin.position.y = 18.5;
  clockTower.add(towerQuoin);
  const belfry = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(8.8, 5.2, 8.8)), limestoneMat);
  belfry.position.y = 24.4;
  clockTower.add(belfry);
  const clockCupola = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(5.6, 5.8, 8)), slateRoofMat);
  clockCupola.position.y = 29.8;
  clockTower.add(clockCupola);
  const clockDialGeo = trackGeo(new THREE.CircleGeometry(1.75, 20));
  for (const [cx, cz, ry] of [
    [0, -5.56, Math.PI],
    [0, 5.56, 0],
    [-5.56, 0, -Math.PI / 2],
    [5.56, 0, Math.PI / 2],
  ]) {
    const face = new THREE.Mesh(clockDialGeo, clockFaceMat);
    face.position.set(cx, 15.2, cz);
    face.rotation.y = ry;
    clockTower.add(face);
  }
  root.add(clockTower);

  // Harbourmaster's Customs Building at North Head
  const northHall = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(58, 11, 20)), brickMat);
  northHall.position.set(-76, 9.8, 274);
  root.add(northHall);
  const northHallRoof = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(60, 2.2, 22)), slateRoofMat);
  northHallRoof.position.set(-76, 16.2, 274);
  root.add(northHallRoof);

  // 1C. West Quay — Berths 43 / 45 across the ~145 m Basin (x = -195 .. -128, z = -188 .. +258)
  const westQuay = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(68, 9.2, 446)), graniteMat);
  westQuay.position.set(-162, -0.4, 35);
  westQuay.receiveShadow = true;
  root.add(westQuay);
  const westApron = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(68.4, 0.32, 446.4)), cobbleDeckMat);
  westApron.position.set(-162, 4.25, 35);
  westApron.receiveShadow = true;
  root.add(westApron);
  const westCoping = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.15, 0.5, 446.4)), copingStoneMat);
  westCoping.position.set(-128.4, 4.22, 35);
  root.add(westCoping);

  const westPierHead = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(14, 15, 9.4, 20)),
    graniteMat,
  );
  westPierHead.position.set(-142, -0.35, -188);
  root.add(westPierHead);

  // Timber Fender Pilings along Berth 44 (East), North Head, and West Quay
  const fenderGeo = trackGeo(new THREE.BoxGeometry(0.45, 7.6, 0.48));
  const fenderCount = 54 + 54 + 18;
  const fenderMesh = new THREE.InstancedMesh(fenderGeo, timberPilingMat, fenderCount);
  let fIdx = 0;
  for (let i = 0; i < 54; i++) {
    _vDummy.position.set(19.25, 1.0, -168 + i * 7.8);
    _vDummy.rotation.set(0, 0, 0);
    _vDummy.scale.set(1, 1, 1);
    _vDummy.updateMatrix();
    fenderMesh.setMatrixAt(fIdx++, _vDummy.matrix);
  }
  for (let i = 0; i < 54; i++) {
    _vDummy.position.set(-127.75, 1.0, -172 + i * 7.8);
    _vDummy.rotation.set(0, 0, 0);
    _vDummy.scale.set(1, 1, 1);
    _vDummy.updateMatrix();
    fenderMesh.setMatrixAt(fIdx++, _vDummy.matrix);
  }
  for (let i = 0; i < 18; i++) {
    _vDummy.position.set(-122 + i * 7.8, 1.0, 255.7);
    _vDummy.rotation.set(0, Math.PI / 2, 0);
    _vDummy.scale.set(1, 1, 1);
    _vDummy.updateMatrix();
    fenderMesh.setMatrixAt(fIdx++, _vDummy.matrix);
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
  const bollardZList = [-160, -115, -70, -25, 20, 68, 118, 165, 212];
  for (const bz of bollardZList) {
    const eastBol = new THREE.Mesh(bollardGeo, darkIronMat);
    eastBol.position.set(20.9, 4.35, bz);
    eastBol.castShadow = !isSoftwareGl;
    root.add(eastBol);

    const westBol = new THREE.Mesh(bollardGeo, darkIronMat);
    westBol.position.set(-129.6, 4.35, bz);
    root.add(westBol);
  }

  // Mooring Hawsers tying Titanic to Berth 44 Bollards (cast off as ship moves past z = -14)
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

  // Covered Passenger Embarkation Gangways (slide onto quay apron when ship departs Berth 44)
  const gangwaysGroup = new THREE.Group();
  for (const gz of [16, 110]) {
    const brow = new THREE.Group();
    brow.position.set(0, 5.2, gz);
    const floor = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(8.2, 0.24, 2.4)), timberPilingMat);
    floor.position.set(17.6, 0, 0);
    brow.add(floor);
    for (const sideZ of [-1.1, 1.1]) {
      const rail = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(8.2, 1.05, 0.12)), creamPaintMat);
      rail.position.set(17.6, 0.62, sideZ);
      brow.add(rail);
    }
    const canopy = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(8.4, 0.16, 2.7)), slateRoofMat);
    canopy.position.set(17.6, 2.25, 0);
    brow.add(canopy);
    gangwaysGroup.add(brow);
  }
  root.add(gangwaysGroup);

  // =========================================================================
  // 2. LSWR BOAT TRAIN RAILWAYS, STEAM LOCOMOTIVE & PULLMAN CARRIAGES ON BERTH 44
  // =========================================================================
  const railGeo = trackGeo(new THREE.BoxGeometry(0.11, 0.14, 405));
  const sleeperGeo = trackGeo(new THREE.BoxGeometry(2.1, 0.1, 0.24));
  const sleeperInst = new THREE.InstancedMesh(sleeperGeo, timberPilingMat, 360);
  let sIdx = 0;
  for (const trackX of [22.8, 26.8]) {
    for (const rOff of [-0.72, 0.72]) {
      const rail = new THREE.Mesh(railGeo, darkIronMat);
      rail.position.set(trackX + rOff, 4.44, 42);
      root.add(rail);
    }
    for (let sz = -152; sz <= 240; sz += 2.2) {
      if (sIdx >= 360) break;
      _vDummy.position.set(trackX, 4.38, sz);
      _vDummy.rotation.set(0, 0, 0);
      _vDummy.scale.set(1, 1, 1);
      _vDummy.updateMatrix();
      sleeperInst.setMatrixAt(sIdx++, _vDummy.matrix);
    }
  }
  sleeperInst.count = sIdx;
  sleeperInst.instanceMatrix.needsUpdate = true;
  sleeperInst.computeBoundingSphere();
  root.add(sleeperInst);

  // 1912 LSWR Steam Boat Train (Locomotive + Tender + 4 Clerestory Coaches beside Shed 44)
  const trainGroup = new THREE.Group();
  trainGroup.position.set(26.8, 4.5, 42);

  // Steam Locomotive (at z = -42 relative to train center -> world z = 0)
  const locoGroup = new THREE.Group();
  locoGroup.position.set(0, 0, -40);
  const chassis = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(2.25, 0.7, 9.6)), darkIronMat);
  chassis.position.y = 0.75;
  locoGroup.add(chassis);
  const boiler = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.92, 0.92, 6.2, 18)), lswrGreenMat);
  boiler.rotation.x = Math.PI / 2;
  boiler.position.set(0, 2.05, -0.8);
  boiler.castShadow = !isSoftwareGl;
  locoGroup.add(boiler);
  const smokebox = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.94, 0.94, 1.5, 18)), darkIronMat);
  smokebox.rotation.x = Math.PI / 2;
  smokebox.position.set(0, 2.05, -4.3);
  locoGroup.add(smokebox);
  const steamDome = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.45, 12, 10)), brassMat);
  steamDome.position.set(0, 2.95, -0.5);
  locoGroup.add(steamDome);
  const stack = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.24, 0.28, 1.5, 12)), darkIronMat);
  stack.position.set(0, 3.35, -4.2);
  locoGroup.add(stack);
  const locoCab = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(2.38, 2.25, 2.4)), lswrGreenMat);
  locoCab.position.set(0, 2.22, 3.2);
  locoGroup.add(locoCab);
  const cabRoof = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(1.4, 1.4, 2.6, 12, 1, false, -0.8, 1.6)), creamPaintMat);
  cabRoof.rotation.x = Math.PI / 2;
  cabRoof.position.set(0, 2.2, 3.2);
  locoGroup.add(cabRoof);
  const wheelGeo = trackGeo(new THREE.CylinderGeometry(0.55, 0.55, 0.18, 14));
  wheelGeo.rotateZ(Math.PI / 2);
  for (const wz of [-3.4, -1.5, 0.6, 2.6]) {
    for (const wx of [-1.06, 1.06]) {
      const w = new THREE.Mesh(wheelGeo, darkIronMat);
      w.position.set(wx, 0.55, wz);
      locoGroup.add(w);
    }
  }
  const headlamp = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.18, 8, 8)), warmLanternMat);
  headlamp.position.set(0, 1.45, -5.05);
  locoGroup.add(headlamp);
  trainGroup.add(locoGroup);

  // Coal Tender
  const tender = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(2.3, 1.85, 6.2)), lswrGreenMat);
  tender.position.set(0, 1.55, -31.5);
  trainGroup.add(tender);

  // 4 LSWR Clerestory Boat-Train Passenger Coaches
  const coachBodyGeo = trackGeo(new THREE.BoxGeometry(2.48, 2.2, 17.6));
  const coachCreamGeo = trackGeo(new THREE.BoxGeometry(2.51, 0.92, 17.55));
  const coachRoofGeo = trackGeo(new THREE.BoxGeometry(2.58, 0.36, 17.8));
  const clerestoryGeo = trackGeo(new THREE.BoxGeometry(1.25, 0.34, 16.8));
  const bogieGeo = trackGeo(new THREE.BoxGeometry(2.2, 0.72, 17.2));
  for (let c = 0; c < 4; c++) {
    const cz = -18 + c * 18.8;
    const bogie = new THREE.Mesh(bogieGeo, darkIronMat);
    bogie.position.set(0, 0.52, cz);
    trainGroup.add(bogie);
    const body = new THREE.Mesh(coachBodyGeo, coachMaroonMat);
    body.position.set(0, 1.98, cz);
    body.castShadow = !isSoftwareGl;
    trainGroup.add(body);
    const upper = new THREE.Mesh(coachCreamGeo, creamPaintMat);
    upper.position.set(0, 2.48, cz);
    trainGroup.add(upper);
    const roof = new THREE.Mesh(coachRoofGeo, slateRoofMat);
    roof.position.set(0, 3.24, cz);
    trainGroup.add(roof);
    const cler = new THREE.Mesh(clerestoryGeo, creamPaintMat);
    cler.position.set(0, 3.55, cz);
    trainGroup.add(cler);
  }
  root.add(trainGroup);

  // =========================================================================
  // 3. WHITE STAR OCEAN TERMINAL SHEDS (EAST BERTH 44 & WEST BERTH 43/45)
  // =========================================================================
  const buildWarehouse = (
    xCenter: number,
    zCenter: number,
    length: number,
    facingSign: -1 | 1,
    withSign: boolean,
  ) => {
    const shed = new THREE.Group();
    shed.position.set(xCenter, 4.35, zCenter);

    const body = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(23, 10.6, length)), brickMat);
    body.position.y = 5.3;
    body.castShadow = true;
    body.receiveShadow = true;
    shed.add(body);

    const cornice = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(23.8, 0.95, length + 0.8)), limestoneMat);
    cornice.position.y = 10.5;
    shed.add(cornice);

    const bayCount = Math.max(3, Math.floor(length / 16));
    for (let i = 0; i <= bayCount; i++) {
      const pz = -length * 0.5 + (i / bayCount) * length;
      const pilaster = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.65, 10.2, 1.1)), limestoneMat);
      pilaster.position.set(facingSign * 11.55, 5.1, pz);
      shed.add(pilaster);

      if (i < bayCount) {
        const doorZ = pz + (length / bayCount) * 0.5;
        const arch = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.45, 5.4, 5.4)), darkIronMat);
        arch.position.set(facingSign * 11.45, 2.7, doorZ);
        shed.add(arch);

        const transom = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.35, 1.4, 4.4)), warmLanternMat);
        transom.position.set(facingSign * 11.5, 7.6, doorZ);
        shed.add(transom);
      }
    }

    const roofShape = new THREE.Shape();
    roofShape.moveTo(-12.2, 0);
    roofShape.lineTo(12.2, 0);
    roofShape.lineTo(0, 5.4);
    roofShape.closePath();
    const roofGeo = trackGeo(
      new THREE.ExtrudeGeometry(roofShape, {
        depth: length + 1.2,
        bevelEnabled: false,
      }),
    );
    roofGeo.translate(0, 0, -(length + 1.2) * 0.5);
    const roof = new THREE.Mesh(roofGeo, slateRoofMat);
    roof.position.y = 10.85;
    roof.castShadow = !isSoftwareGl;
    shed.add(roof);

    const ridge = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(3.4, 1.4, length * 0.76)),
      limestoneMat,
    );
    ridge.position.y = 15.8;
    shed.add(ridge);

    if (withSign) {
      const signBoard = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(0.35, 4.4, 28)),
        darkIronMat,
      );
      signBoard.position.set(facingSign * 11.85, 12.8, 0);
      const signFace = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(27.6, 4.2)), terminalSignMat);
      signFace.rotation.y = facingSign < 0 ? -Math.PI / 2 : Math.PI / 2;
      signFace.position.set(facingSign * 12.06, 12.8, 0);
      shed.add(signBoard);
      shed.add(signFace);
    }

    root.add(shed);
  };

  // Berth 44 East Quay Sheds
  buildWarehouse(53, -95, 86, -1, false);
  buildWarehouse(53, 32, 132, -1, true);
  buildWarehouse(53, 165, 92, -1, false);

  // Berths 43 & 45 West Quay Sheds across the tidal basin
  buildWarehouse(-160, -68, 96, 1, false);
  buildWarehouse(-160, 72, 126, 1, false);
  buildWarehouse(-160, 195, 76, 1, false);

  // =========================================================================
  // 4. STOTHERT & PITT DOCKSIDE ELECTRIC PORTAL GANTRY CRANES
  // =========================================================================
  const buildGantryCrane = (xPos: number, zPos: number, dirSign: -1 | 1) => {
    const crane = new THREE.Group();
    crane.position.set(xPos, 4.35, zPos);

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

        const bogie = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.75, 0.65, 1.35)), darkIronMat);
        bogie.position.set(lx * 0.92, 0.35, lz * 0.85);
        crane.add(bogie);
      }
    }

    const deck = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(4.9, 0.9, 5.4)), craneSteelMat);
    deck.position.y = 9.8;
    crane.add(deck);

    const cab = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(3.8, 3.4, 4.2)), darkIronMat);
    cab.position.set(-dirSign * 0.4, 11.9, 0);
    cab.castShadow = !isSoftwareGl;
    crane.add(cab);

    const cabWin = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.18, 1.4, 2.4)), warmLanternMat);
    cabWin.position.set(dirSign * 1.52, 12.1, 0);
    crane.add(cabWin);

    const boom = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.62, 18.8, 0.62)), craneSteelMat);
    boom.position.set(dirSign * 5.8, 19.0, 0);
    boom.rotation.z = -dirSign * 0.62;
    boom.castShadow = !isSoftwareGl;
    crane.add(boom);

    const tieRod = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.06, 0.06, 15.5, 6)), darkIronMat);
    tieRod.position.set(dirSign * 4.6, 19.6, 0);
    tieRod.rotation.z = -dirSign * 1.08;
    crane.add(tieRod);

    const cable = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.035, 0.035, 11.5, 6)), darkIronMat);
    cable.position.set(dirSign * 11.0, 20.4, 0);
    crane.add(cable);

    const hookBlock = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.5, 0.7, 0.5)), buffFunnelMat);
    hookBlock.position.set(dirSign * 11.0, 14.6, 0);
    crane.add(hookBlock);

    root.add(crane);
  };

  buildGantryCrane(25.0, -84, -1);
  buildGantryCrane(25.0, 42, -1);
  buildGantryCrane(25.0, 138, -1);
  buildGantryCrane(-134.5, -18, 1);
  buildGantryCrane(-134.5, 118, 1);

  // Steamer Trunks, Wooden Crates, Coal Carts & Dockside Cast-Iron Lamp Standards on Berth 44
  const cargoMeshGeo = trackGeo(new THREE.BoxGeometry(1.4, 1.1, 1.8));
  const lampPostGeo = trackGeo(new THREE.CylinderGeometry(0.08, 0.16, 4.6, 8));
  const lampHeadGeo = trackGeo(new THREE.SphereGeometry(0.28, 8, 8));
  for (let lz = -135; lz <= 205; lz += 34) {
    const post = new THREE.Mesh(lampPostGeo, darkIronMat);
    post.position.set(30.8, 6.65, lz);
    root.add(post);
    const globe = new THREE.Mesh(lampHeadGeo, warmLanternMat);
    globe.position.set(30.8, 9.05, lz);
    root.add(globe);

    const crate = new THREE.Mesh(cargoMeshGeo, buffFunnelMat);
    crate.position.set(34.5, 4.9, lz + 6);
    crate.rotation.y = (lz % 7) * 0.25;
    root.add(crate);
  }

  // =========================================================================
  // 5. HISTORIC NEIGHBORING SHIPS MOORED AT WEST QUAY (SS NEW YORK & TENDER)
  //    Moored cleanly across the 145 m White Star Dock basin (x = -112)
  // =========================================================================
  const mooredNewYork = new THREE.Group();
  mooredNewYork.position.set(-113, 0, 38);
  {
    const nyShape = new THREE.Shape();
    nyShape.moveTo(0, -84);
    nyShape.quadraticCurveTo(9.8, -52, 10.2, 0);
    nyShape.quadraticCurveTo(9.6, 56, 0, 82);
    nyShape.quadraticCurveTo(-9.6, 56, -10.2, 0);
    nyShape.quadraticCurveTo(-9.8, -52, 0, -84);

    const nyLowerGeo = trackGeo(new THREE.ExtrudeGeometry(nyShape, { depth: 3.4, bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.2, bevelSegments: 2 }));
    nyLowerGeo.rotateX(Math.PI / 2);
    const nyLower = new THREE.Mesh(nyLowerGeo, rustRedMat);
    nyLower.position.y = 0.8;
    mooredNewYork.add(nyLower);

    const nyUpperGeo = trackGeo(new THREE.ExtrudeGeometry(nyShape, { depth: 6.2, bevelEnabled: false }));
    nyUpperGeo.rotateX(Math.PI / 2);
    const nyUpper = new THREE.Mesh(nyUpperGeo, darkIronMat);
    nyUpper.position.y = 7.0;
    nyUpper.castShadow = !isSoftwareGl;
    mooredNewYork.add(nyUpper);

    const nyProm = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(17.5, 2.8, 102)), creamPaintMat);
    nyProm.position.set(0, 8.4, 2);
    mooredNewYork.add(nyProm);
    const nyBoatDeck = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(15.2, 2.4, 82)), creamPaintMat);
    nyBoatDeck.position.set(0, 10.9, 4);
    mooredNewYork.add(nyBoatDeck);

    // Three classic Inman / American Line funnels & twin raked masts
    for (const fz of [-18, 2, 22]) {
      const f = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(1.7, 2.0, 14.2, 18)), darkIronMat);
      f.position.set(0, 18.2, fz);
      f.rotation.x = 0.08;
      mooredNewYork.add(f);
      const band = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(1.76, 1.8, 3.2, 18)), creamPaintMat);
      band.position.set(0, 21.0, fz + 0.24);
      band.rotation.x = 0.08;
      mooredNewYork.add(band);
    }
    for (const mz of [-48, 48]) {
      const m = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.16, 0.34, 28, 10)), buffFunnelMat);
      m.position.set(0, 20.5, mz);
      m.rotation.x = 0.06;
      mooredNewYork.add(m);
    }
  }
  root.add(mooredNewYork);

  // Coastal Coal Lighter / Tender moored further forward on West Quay (x = -114, z = -112)
  const westTender = new THREE.Group();
  westTender.position.set(-116, 0, -112);
  {
    const tHull = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(11, 5.2, 48)), darkIronMat);
    tHull.position.y = 1.6;
    westTender.add(tHull);
    const tCab = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(7.2, 3.4, 14)), creamPaintMat);
    tCab.position.set(0, 5.4, 8);
    westTender.add(tCab);
    const tFun = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.85, 0.95, 7.6, 12)), buffFunnelMat);
    tFun.position.set(0, 8.8, 11);
    westTender.add(tFun);
  }
  root.add(westTender);

  // =========================================================================
  // 6. 64 CONSCIOUS, AWARE DOCKSIDE WELL-WISHERS & PORTERS ON BERTH 44 APRON
  // =========================================================================
  const DOCK_CROWD_COUNT = 64;
  interface DockCitizenMind {
    baseX: number;
    baseZ: number;
    x: number;
    z: number;
    yaw: number;
    phase: number;
    walkRange: number;
    waveEagerness: number;
    isPorter: boolean;
  }
  const dockCitizens: DockCitizenMind[] = [];
  for (let i = 0; i < DOCK_CROWD_COUNT; i++) {
    const isPorter = i % 4 === 0;
    const bx = isPorter ? 21.5 + (i % 3) * 0.9 : 29.8 + (i % 5) * 1.1;
    const bz = -68 + ((i * 23) % 245);
    dockCitizens.push({
      baseX: bx,
      baseZ: bz,
      x: bx,
      z: bz,
      yaw: Math.PI / 2,
      phase: i * 0.85,
      walkRange: isPorter ? 2.4 : 1.2,
      waveEagerness: 0.65 + ((i * 7) % 10) * 0.05,
      isPorter,
    });
  }

  const citTorsoGeo = trackGeo(new THREE.CylinderGeometry(0.16, 0.14, 0.72, 8));
  citTorsoGeo.translate(0, 1.08, 0);
  const citLegsGeo = trackGeo(new THREE.CylinderGeometry(0.12, 0.1, 0.76, 8));
  citLegsGeo.translate(0, 0.38, 0);
  const citHeadGeo = trackGeo(new THREE.SphereGeometry(0.115, 8, 8));
  citHeadGeo.translate(0, 1.56, 0);
  const citArmGeo = trackGeo(new THREE.CylinderGeometry(0.045, 0.04, 0.56, 6));
  citArmGeo.translate(0, -0.24, 0);

  const citClothMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 }));
  const citSkinMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xe6bca0, roughness: 0.68 }));

  const citTorsoInst = new THREE.InstancedMesh(citTorsoGeo, citClothMat, DOCK_CROWD_COUNT);
  const citLegsInst = new THREE.InstancedMesh(citLegsGeo, citClothMat, DOCK_CROWD_COUNT);
  const citHeadInst = new THREE.InstancedMesh(citHeadGeo, citSkinMat, DOCK_CROWD_COUNT);
  const citWaveArmInst = new THREE.InstancedMesh(citArmGeo, citClothMat, DOCK_CROWD_COUNT);
  citTorsoInst.frustumCulled = false;
  citLegsInst.frustumCulled = false;
  citHeadInst.frustumCulled = false;
  citWaveArmInst.frustumCulled = false;

  const dockPalette = [0x1c2532, 0x3b2c22, 0x5c232d, 0x243e4d, 0x4b3d57, 0x26443b, 0xc9beab];
  const tmpCol = new THREE.Color();
  for (let i = 0; i < DOCK_CROWD_COUNT; i++) {
    tmpCol.setHex(dockCitizens[i].isPorter ? 0x1e2c40 : dockPalette[i % dockPalette.length]);
    citTorsoInst.setColorAt(i, tmpCol);
    citWaveArmInst.setColorAt(i, tmpCol);
    tmpCol.setHex(0x141820);
    citLegsInst.setColorAt(i, tmpCol);
  }
  if (citTorsoInst.instanceColor) citTorsoInst.instanceColor.needsUpdate = true;
  if (citWaveArmInst.instanceColor) citWaveArmInst.instanceColor.needsUpdate = true;
  if (citLegsInst.instanceColor) citLegsInst.instanceColor.needsUpdate = true;
  root.add(citTorsoInst);
  root.add(citLegsInst);
  root.add(citHeadInst);
  root.add(citWaveArmInst);

  // =========================================================================
  // 7. CONSCIOUS SMALLER HARBOR VESSELS POSITIONED ON EITHER SIDE OF TITANIC
  //    (Active Port/Starboard Flanking + Real-Time Collision Avoidance AI)
  // =========================================================================
  interface EscortVesselRig {
    id: string;
    kind: 'tug' | 'pilot' | 'lifeboat';
    label: string;
    preferredSide: -1 | 1;
    preferredAlong: number; // desired Z relative to Titanic (+ is astern, - is ahead)
    preferredLatDist: number; // target lateral clearance from Titanic centerline (34..54m)
    group: THREE.Group;
    oars: THREE.Group[];
    lanternMesh: THREE.Mesh;
    initX: number;
    initZ: number;
    initYaw: number;
    x: number;
    z: number;
    yaw: number;
    roll: number;
    curSpeed: number;
    maxSpeed: number;
    radius: number;
    phase: number;
    aiState: 'standby_flank' | 'escort_flank' | 'evade_titanic' | 'evade_obstacle' | 'rescue_standby';
  }

  const escorts: EscortVesselRig[] = [];

  const buildSteamVessel = (
    id: string,
    label: string,
    preferredSide: -1 | 1,
    preferredAlong: number,
    preferredLatDist: number,
    x: number,
    z: number,
    yaw: number,
    maxSpeed: number,
    phase: number,
    isPilot = false,
  ) => {
    const tug = new THREE.Group();
    tug.position.set(x, 0, z);
    tug.rotation.y = yaw;
    tug.scale.setScalar(isPilot ? 0.88 : 1.0);

    const tugShape = new THREE.Shape();
    tugShape.moveTo(0, -14);
    tugShape.quadraticCurveTo(3.4, -7, 3.6, 2);
    tugShape.quadraticCurveTo(3.3, 11, 0, 13.5);
    tugShape.quadraticCurveTo(-3.3, 11, -3.6, 2);
    tugShape.quadraticCurveTo(-3.4, -7, 0, -14);

    const lowerHullGeo = trackGeo(
      new THREE.ExtrudeGeometry(tugShape, {
        depth: 2.0,
        bevelEnabled: true,
        bevelThickness: 0.25,
        bevelSize: 0.2,
        bevelSegments: 2,
      }),
    );
    lowerHullGeo.rotateX(Math.PI / 2);
    const lowerHull = new THREE.Mesh(lowerHullGeo, rustRedMat);
    lowerHull.position.y = 0.6;
    tug.add(lowerHull);

    const upperHullGeo = trackGeo(
      new THREE.ExtrudeGeometry(tugShape, { depth: 1.8, bevelEnabled: false }),
    );
    upperHullGeo.rotateX(Math.PI / 2);
    const upperHull = new THREE.Mesh(upperHullGeo, isPilot ? creamPaintMat : darkIronMat);
    upperHull.position.y = 2.4;
    upperHull.castShadow = !isSoftwareGl;
    tug.add(upperHull);

    const deck = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(5.6, 0.25, 22)), buffFunnelMat);
    deck.position.y = 2.52;
    tug.add(deck);

    const cabin = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(3.4, 2.6, 5.2)), creamPaintMat);
    cabin.position.set(0, 3.8, -3.2);
    cabin.castShadow = !isSoftwareGl;
    tug.add(cabin);

    const roof = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(3.9, 0.28, 5.8)), darkIronMat);
    roof.position.set(0, 5.2, -3.2);
    tug.add(roof);

    const funnel = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.68, 0.78, 6.2, 16)),
      isPilot ? rustRedMat : buffFunnelMat,
    );
    funnel.position.set(0, 5.8, 2.2);
    funnel.rotation.x = 0.08;
    funnel.castShadow = !isSoftwareGl;
    tug.add(funnel);

    const funnelCap = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.7, 0.7, 1.3, 16)), darkIronMat);
    funnelCap.position.set(0, 8.4, 2.4);
    funnelCap.rotation.x = 0.08;
    tug.add(funnelCap);

    const mast = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.08, 0.14, 9.2, 8)), buffFunnelMat);
    mast.position.set(0, 7.2, -6.4);
    tug.add(mast);

    const tugLamp = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.24, 8, 8)), warmLanternMat);
    tugLamp.position.set(0, 11.4, -6.4);
    tug.add(tugLamp);

    root.add(tug);
    escorts.push({
      id,
      kind: isPilot ? 'pilot' : 'tug',
      label,
      preferredSide,
      preferredAlong,
      preferredLatDist,
      group: tug,
      oars: [],
      lanternMesh: tugLamp,
      initX: x,
      initZ: z,
      initYaw: yaw,
      x,
      z,
      yaw,
      roll: 0,
      curSpeed: 0,
      maxSpeed,
      radius: isPilot ? 6.2 : 7.0,
      phase,
      aiState: 'standby_flank',
    });
  };

  // ALL escort vessels & small harbor craft start cleanly on EITHER Port (-1) or Starboard (+1) flank!
  // Zero craft placed directly in front of Titanic's bow!
  buildSteamVessel('tug_port_fwd', 'HARBOR ESCORT TUG HECTOR', -1, -78, 38, -38, -68, 0.03, 9.5, 0.4, false);
  buildSteamVessel('tug_port_aft', 'HARBOR ESCORT TUG NEPTUNE', -1, 68, 42, -42, 62, 0.02, 9.2, 1.8, false);
  buildSteamVessel('pilot_cutter', 'SOUTHAMPTON PILOT CUTTER', 1, -118, 44, 44, -214, -0.04, 10.6, 1.2, true);
  buildSteamVessel('tug_stbd_fwd', 'HARBOR ESCORT TUG VULCAN', 1, -48, 39, 41, -290, -0.03, 9.8, 2.3, false);

  // Floating Wooden Harbor Lifeboats / Rowing Cutters on Either Flank in Southampton Water
  const hBoatShape = new THREE.Shape();
  hBoatShape.moveTo(0, -4.6);
  hBoatShape.quadraticCurveTo(1.55, -2.0, 1.55, 0.2);
  hBoatShape.quadraticCurveTo(1.45, 2.6, 0, 4.6);
  hBoatShape.quadraticCurveTo(-1.45, 2.6, -1.55, 0.2);
  hBoatShape.quadraticCurveTo(-1.55, -2.0, 0, -4.6);
  const hBoatHullGeo = trackGeo(
    new THREE.ExtrudeGeometry(hBoatShape, {
      depth: 0.92,
      bevelEnabled: true,
      bevelThickness: 0.12,
      bevelSize: 0.1,
      bevelSegments: 2,
    }),
  );
  hBoatHullGeo.rotateX(Math.PI / 2);

  const harborBoatSpecs: Array<{
    id: string;
    label: string;
    side: -1 | 1;
    along: number;
    lat: number;
    x: number;
    z: number;
    yaw: number;
  }> = [
    { id: 'harbor_lifeboat_0', label: 'PORT HARBOR CUTTER', side: -1, along: -36, lat: 46, x: -48, z: -245, yaw: 0.12 },
    { id: 'harbor_lifeboat_1', label: 'PORT CHANNEL LIFEBOAT', side: -1, along: -85, lat: 50, x: -50, z: -365, yaw: -0.08 },
    { id: 'harbor_lifeboat_2', label: 'STARBOARD HARBOR LIFEBOAT', side: 1, along: -65, lat: 48, x: 48, z: -385, yaw: 0.08 },
  ];

  for (let i = 0; i < harborBoatSpecs.length; i++) {
    const spec = harborBoatSpecs[i];
    const lb = new THREE.Group();
    lb.position.set(spec.x, 0.2, spec.z);
    lb.rotation.y = spec.yaw;
    const hull = new THREE.Mesh(hBoatHullGeo, creamPaintMat);
    hull.position.y = 0.52;
    lb.add(hull);
    const gunwale = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(2.4, 0.12, 6.4)), buffFunnelMat);
    gunwale.position.y = 0.52;
    lb.add(gunwale);
    const lantern = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.18, 8, 8)), warmLanternMat);
    lantern.position.set(0, 1.12, -3.2);
    lb.add(lantern);

    const oars: THREE.Group[] = [];
    for (const s of [-1, 1]) {
      for (const oz of [-1.2, 0.8]) {
        const oar = new THREE.Group();
        oar.position.set(s * 1.25, 0.56, oz);
        const blade = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.03, 0.04, 2.8, 6)), buffFunnelMat);
        blade.rotation.z = s * 1.15;
        blade.position.set(s * 1.1, -0.36, 0);
        oar.add(blade);
        lb.add(oar);
        oars.push(oar);
      }
    }

    root.add(lb);
    escorts.push({
      id: spec.id,
      kind: 'lifeboat',
      label: spec.label,
      preferredSide: spec.side,
      preferredAlong: spec.along,
      preferredLatDist: spec.lat,
      group: lb,
      oars,
      lanternMesh: lantern,
      initX: spec.x,
      initZ: spec.z,
      initYaw: spec.yaw,
      x: spec.x,
      z: spec.z,
      yaw: spec.yaw,
      roll: 0,
      curSpeed: 0,
      maxSpeed: 5.2,
      radius: 4.2,
      phase: i * 1.7,
      aiState: 'standby_flank',
    });
  }

  // =========================================================================
  // 8. HARBOR CHANNEL BUOYS (6 BOBBING BELL BUOYS IN SOUTHAMPTON WATER)
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

  for (const bz of [-255, -355, -455]) {
    for (const side of [-1, 1]) {
      const bGroup = new THREE.Group();
      bGroup.position.set(side * 58, 0.15, bz);
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
  // 9. STONE BREAKWATER ARMS & CALSHOT-STYLE LIGHTHOUSES AT HARBOR MOUTH (z = -515)
  // =========================================================================
  const beaconRotors: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const moleGeo = trackGeo(new THREE.BoxGeometry(260, 7.5, 18));
    const mole = new THREE.Mesh(moleGeo, graniteMat);
    mole.position.set(side * 198, 1.6, -515);
    mole.rotation.y = side * -0.14;
    mole.receiveShadow = true;
    root.add(mole);

    const headGeo = trackGeo(new THREE.CylinderGeometry(13.5, 15.2, 8.2, 20));
    const head = new THREE.Mesh(headGeo, copingStoneMat);
    head.position.set(side * 68, 1.8, -497);
    root.add(head);

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
    tower.position.set(side * 68, 5.8, -497);
    tower.castShadow = !isSoftwareGl;
    root.add(tower);

    const band = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(3.05, 3.25, 3.6, 20)), rustRedMat);
    band.position.set(side * 68, 17.0, -497);
    root.add(band);

    const lantern = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(2.1, 2.1, 3.1, 14)), warmLanternMat);
    lantern.position.set(side * 68, 24.8, -497);
    root.add(lantern);

    const dome = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(2.5, 2.2, 16)), darkIronMat);
    dome.position.set(side * 68, 27.3, -497);
    root.add(dome);

    const rotor = new THREE.Group();
    rotor.position.set(side * 68, 24.8, -497);
    const beamConeGeo = trackGeo(new THREE.ConeGeometry(6.5, 68, 16, 1, true));
    beamConeGeo.translate(0, -34, 0);
    beamConeGeo.rotateX(Math.PI / 2);
    const beamMesh = new THREE.Mesh(beamConeGeo, beaconConeMat);
    rotor.add(beamMesh);
    root.add(rotor);
    beaconRotors.push(rotor);
  }

  // =========================================================================
  // 10. HAMPSHIRE COASTLINE, TOWN QUAY DISTANT PIERS & GREEN HEADLANDS
  // =========================================================================
  const shoreHills: Array<[number, number, number, number, number, boolean]> = [
    [165, -390, 95, 26, 175, false],
    [185, -140, 115, 32, 230, false],
    [175, 110, 110, 28, 220, false],
    [165, 320, 130, 26, 170, false],
    [-280, -390, 140, 34, 210, true],
    [-310, -110, 160, 38, 280, false],
    [-295, 170, 145, 30, 240, true],
    [-90, 410, 180, 32, 140, false],
  ];
  for (const [hx, hz, rx, ry, rz, rocky] of shoreHills) {
    const hillGeo = trackGeo(new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55));
    const hill = new THREE.Mesh(hillGeo, rocky ? headlandRockMat : greenHillMat);
    hill.position.set(hx, -2, hz);
    hill.scale.set(rx, ry, rz);
    hill.receiveShadow = true;
    root.add(hill);
  }

  // Pre-allocated collision arrays (zero per-frame GC)
  const circleObstacles: HarborCircleObstacle[] = [];
  for (const e of escorts) {
    circleObstacles.push({
      id: e.id,
      kind: e.kind,
      x: e.x,
      z: e.z,
      radius: e.radius,
      label: e.label,
    });
  }
  for (let i = 0; i < buoys.length; i++) {
    const b = buoys[i];
    circleObstacles.push({
      id: `buoy_${i}`,
      kind: 'buoy',
      x: b.group.position.x,
      z: b.group.position.z,
      radius: 2.2,
      label: 'CHANNEL BELL BUOY',
    });
  }
  for (const side of [-1, 1]) {
    circleObstacles.push({
      id: side < 0 ? 'pier_port' : 'pier_stbd',
      kind: 'pier',
      x: side * 68,
      z: -497,
      radius: 15.2,
      label: 'BREAKWATER LIGHTHOUSE PIER',
    });
  }

  const boxObstacles: HarborBoxObstacle[] = [
    {
      id: 'berth_44_quay',
      kind: 'quay',
      minX: 19.3,
      maxX: 92.0,
      minZ: -176.0,
      maxZ: 258.0,
      label: 'BERTH 44 GRANITE QUAY WALL',
    },
    {
      id: 'north_basin_quay',
      kind: 'quay',
      minX: -195.0,
      maxX: 92.0,
      minZ: 255.8,
      maxZ: 318.0,
      label: 'WHITE STAR DOCK NORTH QUAY',
    },
    {
      id: 'west_basin_quay',
      kind: 'quay',
      minX: -196.0,
      maxX: -102.5,
      minZ: -188.0,
      maxZ: 258.0,
      label: 'WEST QUAY & MOORED LINER SS NEW YORK',
    },
    {
      id: 'breakwater_port',
      kind: 'breakwater',
      minX: -330,
      maxX: -70,
      minZ: -535,
      maxZ: -496,
      label: 'PORT STONE BREAKWATER MOLE',
    },
    {
      id: 'breakwater_stbd',
      kind: 'breakwater',
      minX: 70,
      maxX: 330,
      minZ: -535,
      maxZ: -496,
      label: 'STARBOARD STONE BREAKWATER MOLE',
    },
  ];

  const resetEscorts = () => {
    gangwaysGroup.position.x = 0;
    mooredNewYork.position.set(-113, 0, 38);
    for (let i = 0; i < escorts.length; i++) {
      const e = escorts[i];
      e.x = e.initX;
      e.z = e.initZ;
      e.yaw = e.initYaw;
      e.roll = 0;
      e.curSpeed = 0;
      e.aiState = 'standby_flank';
      e.group.position.set(e.x, e.kind === 'lifeboat' ? 0.2 : 0, e.z);
      e.group.rotation.set(0, e.yaw, 0);
      circleObstacles[i].x = e.x;
      circleObstacles[i].z = e.z;
    }
  };

  // Evaluate autonomous consciousness for each smaller harbor vessel:
  // 1) Stay positioned on EITHER port or starboard side of Titanic
  // 2) Dynamically steer away from Titanic's hull/bow sweep to avoid collision
  // 3) Avoid quay walls, buoys, lighthouse piers, and neighboring vessels
  const stepVesselConsciousness = (
    simTime: number,
    shipX: number,
    shipZ: number,
    headingRad: number,
    speedKnots: number,
    floodingPct: number,
    dt: number,
    escortActive: boolean,
  ) => {
    const fwdX = Math.sin(headingRad);
    const fwdZ = -Math.cos(headingRad);
    const rightX = Math.cos(headingRad);
    const rightZ = Math.sin(headingRad);
    const shipWorldSpd = speedKnots * 2.15;

    for (let i = 0; i < escorts.length; i++) {
      const e = escorts[i];

      if (escortActive && dt > 0) {
        // Compute relative position in Titanic's body-fixed frame
        const dxShip = e.x - shipX;
        const dzShip = e.z - shipZ;
        // along > 0 means ahead of Titanic center (+74 = bow tip, -195 = stern)
        const alongAhead = dxShip * fwdX + dzShip * fwdZ;
        const lateral = dxShip * rightX + dzShip * rightZ; // <0 Port, >0 Starboard

        // Dynamically decide which side is safer if Titanic crosses over our flank
        let chosenSide: -1 | 1 = e.preferredSide;
        if (Math.abs(lateral) < 22 && alongAhead > -205 && alongAhead < 145) {
          chosenSide = lateral >= 0 ? 1 : -1;
        }
        // Inside Berth 44 slip (z > -165), keep starboard vessels outside pierhead rather than between Titanic and Berth 44
        const inBerthSlip = e.z > -172 && shipZ > -145;
        if (chosenSide === 1 && inBerthSlip && e.x < 19) {
          chosenSide = -1;
        }

        // Compute ideal flank formation position beside Titanic (on either port or starboard side)
        const flankDist = floodingPct > 20 ? 54 : e.preferredLatDist;
        let targetAlong = e.preferredAlong;
        // Harbor lifeboats patrol channel flanks rather than trailing ocean voyages
        if (e.kind === 'lifeboat') {
          targetAlong = THREE.MathUtils.clamp(-alongAhead, -95, 65);
        }

        let targetX = shipX + fwdX * -targetAlong + rightX * (chosenSide * flankDist);
        let targetZ = shipZ + fwdZ * -targetAlong + rightZ * (chosenSide * flankDist);

        // Keep starboard vessels south of Berth 44 East Pierhead while Titanic is moored in the slip
        if (e.preferredSide === 1 && shipZ > -135) {
          targetX = Math.max(targetX, 38);
          targetZ = Math.min(targetZ, -195);
        }
        // Once past breakwater mouth (z < -525), peel cleanly aside to clear open Atlantic
        if (e.z < -535 && e.kind !== 'lifeboat') {
          targetX = e.x + chosenSide * 45;
          targetZ = e.z - 60;
        }

        // Vector toward desired flank station
        let steerX = targetX - e.x;
        let steerZ = targetZ - e.z;
        const distToSlot = Math.hypot(steerX, steerZ) || 1;
        steerX /= distToSlot;
        steerZ /= distToSlot;

        // Weight flank seeking gently vs strong obstacle/Titanic avoidance
        let desiredSpeed = e.kind === 'lifeboat' ? 2.4 : Math.min(e.maxSpeed, Math.max(3.2, Math.abs(shipWorldSpd) * 0.92 + 2.2));
        if (shipZ > -12 && Math.abs(speedKnots) < 0.6) {
          desiredSpeed = e.kind === 'lifeboat' ? 1.4 : 0.8; // Gentle station keeping at berth
        }
        e.aiState = floodingPct > 20 ? 'rescue_standby' : distToSlot < 22 ? 'escort_flank' : 'standby_flank';

        // --- AWARE TITANIC HULL COLLISION AVOIDANCE ---
        // Check proximity & 4-second lookahead against Titanic's full 269m hull box
        const predAlong = alongAhead - (shipWorldSpd * 3.5);
        const nearHullLong = alongAhead > -208 && alongAhead < 105;
        const nearPredLong = predAlong > -208 && predAlong < 125;
        const safeLat = 15.5 + e.radius + 9.0; // >= ~31m from centerline
        let avoidX = 0;
        let avoidZ = 0;

        if ((nearHullLong || nearPredLong) && Math.abs(lateral) < safeLat) {
          e.aiState = 'evade_titanic';
          const awaySide = lateral >= 0 ? 1 : -1;
          const urgency = 1 - Math.abs(lateral) / safeLat;
          // Push briskly outward toward port or starboard flank + slightly forward/aft out of bow path
          avoidX += rightX * awaySide * (2.6 + urgency * 3.8);
          avoidZ += rightZ * awaySide * (2.6 + urgency * 3.8);
          if (alongAhead > 55) {
            avoidX += fwdX * 1.4;
            avoidZ += fwdZ * 1.4;
          }
          desiredSpeed = e.maxSpeed * 1.32;
        }

        // --- AWARE QUAY WALLS, BREAKWATERS & MOORED SHIPS AVOIDANCE ---
        for (let b = 0; b < boxObstacles.length; b++) {
          const box = boxObstacles[b];
          const cx = THREE.MathUtils.clamp(e.x, box.minX, box.maxX);
          const cz = THREE.MathUtils.clamp(e.z, box.minZ, box.maxZ);
          const vx = e.x - cx;
          const vz = e.z - cz;
          const d = Math.hypot(vx, vz);
          const margin = e.radius + 7.5;
          if (d < margin) {
            e.aiState = 'evade_obstacle';
            const nx = d > 0.01 ? vx / d : 0;
            const nz = d > 0.01 ? vz / d : -1;
            const push = ((margin - d) / margin) * 3.8;
            avoidX += nx * push;
            avoidZ += nz * push;
          }
        }

        // --- AWARE NEIGHBOR VESSEL & BUOY SEPARATION ---
        for (let j = 0; j < circleObstacles.length; j++) {
          if (j === i) continue;
          const ob = circleObstacles[j];
          const vx = e.x - ob.x;
          const vz = e.z - ob.z;
          const d = Math.hypot(vx, vz);
          const minSep = e.radius + ob.radius + 11.0;
          if (d < minSep && d > 0.01) {
            const push = ((minSep - d) / minSep) * 2.8;
            avoidX += (vx / d) * push;
            avoidZ += (vz / d) * push;
          }
        }

        const combX = steerX * 0.85 + avoidX;
        const combZ = steerZ * 0.85 + avoidZ;
        const combLen = Math.hypot(combX, combZ);

        if (combLen > 0.05) {
          const targetYaw = Math.atan2(-combX, -combZ);
          let dy = targetYaw - e.yaw;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          const turnRate = e.aiState === 'evade_titanic' ? 2.6 : 1.45;
          const yawDelta = THREE.MathUtils.clamp(dy, -turnRate * dt, turnRate * dt);
          e.yaw += yawDelta;
          e.roll = THREE.MathUtils.damp(e.roll, -yawDelta / Math.max(dt, 0.01) * 0.045, 5, dt);
        }

        e.curSpeed = THREE.MathUtils.damp(e.curSpeed, desiredSpeed, 2.2, dt);
        e.x -= Math.sin(e.yaw) * e.curSpeed * dt;
        e.z -= Math.cos(e.yaw) * e.curSpeed * dt;

        // Hard safety bounds inside port basin walls so tugs never glitch through stone quays
        if (e.z > -176 && e.z < 258) {
          if (e.x < 19.3) {
            e.x = THREE.MathUtils.clamp(e.x, -96, 12.5);
          } else {
            e.z = -182;
          }
        }
        e.group.position.x = e.x;
        e.group.position.z = e.z;
      }

      const bobAmp = e.kind === 'lifeboat' ? 0.14 : 0.16;
      e.group.position.y = (e.kind === 'lifeboat' ? 0.22 : 0) + Math.sin(simTime * 1.5 + e.phase) * bobAmp;
      e.group.rotation.y = e.yaw;
      e.group.rotation.z = e.roll + Math.sin(simTime * 1.1 + e.phase) * 0.025;
      e.group.rotation.x = Math.cos(simTime * 0.9 + e.phase) * 0.015;

      if (e.oars.length > 0) {
        const oarSpeed = e.aiState === 'evade_titanic' ? 4.2 : 2.3;
        const oarSweep = Math.sin(simTime * oarSpeed + e.phase) * 0.3;
        for (let oi = 0; oi < e.oars.length; oi++) {
          e.oars[oi].rotation.y = oarSweep;
        }
      }

      circleObstacles[i].x = e.x;
      circleObstacles[i].z = e.z;
    }
  };

  const stepDockCrowdConsciousness = (
    simTime: number,
    shipX: number,
    shipZ: number,
  ) => {
    const departed = shipZ < -12;
    for (let i = 0; i < DOCK_CROWD_COUNT; i++) {
      const c = dockCitizens[i];
      // Conscious strolling along quay + turning torso/gaze toward Titanic as she departs
      const pace = departed ? 0.35 : 0.7;
      c.z = c.baseZ + Math.sin(simTime * pace + c.phase) * c.walkRange;
      c.x = c.baseX + Math.cos(simTime * 0.45 + c.phase) * 0.35;

      // Face toward Titanic's bridge/center
      const targetYaw = Math.atan2(shipX - c.x, shipZ + 35 - c.z);
      c.yaw = targetYaw;

      _tmpEuler.set(0, c.yaw, 0);
      _tmpQuat.setFromEuler(_tmpEuler);
      _pelvisMat.compose(
        _tmpVecA.set(c.x, 4.35 + Math.abs(Math.sin(simTime * 2.2 + c.phase)) * 0.015, c.z),
        _tmpQuat,
        _tmpScale.set(1, 1, 1),
      );
      citTorsoInst.setMatrixAt(i, _pelvisMat);
      citLegsInst.setMatrixAt(i, _pelvisMat);
      citHeadInst.setMatrixAt(i, _pelvisMat);

      // Wave arm enthusiastically toward the ship during mooring & departure!
      const waveFreq = departed ? 5.2 : 2.6;
      const armPitch = -Math.PI * 0.78 + Math.sin(simTime * waveFreq * c.waveEagerness + c.phase) * 0.42;
      _tmpEuler.set(armPitch, c.yaw, 0.18);
      _tmpQuat.setFromEuler(_tmpEuler);
      _pelvisMat.compose(
        _tmpVecA.set(c.x - Math.cos(c.yaw) * 0.21, 5.75, c.z + Math.sin(c.yaw) * 0.21),
        _tmpQuat,
        _tmpScale.set(1, 1, 1),
      );
      citWaveArmInst.setMatrixAt(i, _pelvisMat);
    }
    citTorsoInst.instanceMatrix.needsUpdate = true;
    citLegsInst.instanceMatrix.needsUpdate = true;
    citHeadInst.instanceMatrix.needsUpdate = true;
    citWaveArmInst.instanceMatrix.needsUpdate = true;
  };

  const update = (
    simTime: number,
    shipX: number,
    shipZ: number,
    headingRad: number,
    speedKnots: number,
    floodingPct: number,
    nightMix: number,
    dt = 0.016,
    escortActive = false,
  ) => {
    // Cast off mooring hawsers & slide covered embarkation gangways onto quay apron as ship casts off
    const castOff = shipZ < -12 || Math.abs(speedKnots) > 0.65;
    hawsersGroup.visible = shipZ > -16;
    const gangwayTargetX = castOff ? 5.8 : 0;
    gangwaysGroup.position.x = THREE.MathUtils.damp(gangwaysGroup.position.x, gangwayTargetX, 3.2, Math.max(dt, 0.016));

    // Historic wake suction surge on moored SS City of New York as Titanic passes her berth (z = -60..+20)
    const passingNY = THREE.MathUtils.clamp(1 - Math.abs(shipZ + 18) / 75, 0, 1) * Math.min(1, Math.abs(speedKnots) / 8);
    mooredNewYork.position.x = -113 + passingNY * 2.2 + Math.sin(simTime * 0.65) * 0.15;
    mooredNewYork.rotation.z = passingNY * -0.02 + Math.sin(simTime * 0.72) * 0.008;
    mooredNewYork.position.y = Math.sin(simTime * 0.8) * 0.12;

    westTender.position.y = Math.sin(simTime * 1.1 + 1.4) * 0.14;

    stepVesselConsciousness(simTime, shipX, shipZ, headingRad, speedKnots, floodingPct, dt, escortActive);
    stepDockCrowdConsciousness(simTime, shipX, shipZ);

    for (const buoy of buoys) {
      buoy.group.position.y = 0.12 + Math.sin(simTime * 1.9 + buoy.phase) * 0.22;
      buoy.group.rotation.z = Math.sin(simTime * 1.5 + buoy.phase) * 0.09;
      buoy.group.rotation.x = Math.cos(simTime * 1.3 + buoy.phase) * 0.07;
    }

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
    resetEscorts,
    getCircleObstacles: () => circleObstacles,
    getBoxObstacles: () => boxObstacles,
    dispose,
  };
}
