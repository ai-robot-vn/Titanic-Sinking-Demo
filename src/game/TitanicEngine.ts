import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SoundEngine } from './audio';
import { buildCarpathiaShip, CarpathiaRig } from './carpathiaBuilder';
import { CruiseAwarenessContext, FloatingLifeboatHazard } from './charactersBuilder';
import { buildSouthamptonHarbor, HarborRig } from './harborBuilder';
import { IcebergEntity, IcebergFactory } from './icebergBuilder';
import {
  createOceanAndSky,
  OceanAndSkyRig,
  ParticlePool,
  sampleOceanWaveHeight,
} from './oceanAndSky';
import { buildTitanicShip, BREAK_Z, TitanicShipRig } from './shipBuilder';
import { buildSubmarineShip, SubmarineRig } from './submarineBuilder';
import { createProceduralTextures, ProceduralTextureSet } from './textures';
import { buildWarshipShip, WarshipRig } from './warshipBuilder';
import {
  AftermathFocusTarget,
  CameraMode,
  CarpathiaStage,
  GamePhase,
  IcebergVariant,
  TARGET_VOYAGE_NM,
  TELEGRAPH_NOTCHES,
  TelemetrySnapshot,
  VESSEL_SPOTS,
  VesselSpotId,
} from './types';

// Pre-allocated math helpers (zero per-frame GC)
const _vFwd = new THREE.Vector3();
const _vRight = new THREE.Vector3();
const _vCamTarget = new THREE.Vector3();
const _vCamPos = new THREE.Vector3();
const _vLookDir = new THREE.Vector3();
const _vFocusLocal = new THREE.Vector3();
const _vFocusWorld = new THREE.Vector3();
const _projDummy = new THREE.Object3D();
const _projColor = new THREE.Color();

type SubmarineState = 'hidden' | 'hunting' | 'sinking' | 'sunk';

interface SubmarineEntity {
  id: number;
  label: string;
  rig: SubmarineRig;
  state: SubmarineState;
  x: number;
  z: number;
  headingRad: number;
  speedKnots: number;
  diveY: number;
  damagePitch: number;
  damageRoll: number;
  hp: number;
  maxHp: number;
  gunYaw: number;
  gunFireFlash: number;
  hitFireIntensity: number;
  torpedoCooldown: number;
  gunCooldown: number;
  sideSign: -1 | 1;
  sinkElapsed: number;
  wakeAccum: number;
  targetVessel: 'titanic' | 'carpathia';
}

interface NavalProjectile {
  active: boolean;
  kind: 'torpedo' | 'subShell' | 'warshipShell';
  ownerSide: 'submarine' | 'warship';
  targetKind: 'titanic' | 'carpathia' | 'submarine';
  targetSubId: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  wakeAccum: number;
}

const MAX_NAVAL_PROJECTILES = 28;
const BEST_SCORE_KEY = 'titanic_bridge_best_score_v1';

const HULL_CHECK_POINTS: Array<{ zLocal: number; radius: number }> = [
  { zLocal: -72, radius: 4.2 },
  { zLocal: -54, radius: 8.8 },
  { zLocal: -32, radius: 12.6 },
  { zLocal: -6, radius: 13.8 },
  { zLocal: 45, radius: 13.9 },
  { zLocal: 105, radius: 13.8 },
  { zLocal: 155, radius: 12.0 },
  { zLocal: 184, radius: 6.5 },
];

const WARSHIP_HULL_POINTS: Array<{ zLocal: number; radius: number }> = [
  { zLocal: -52, radius: 7.2 },
  { zLocal: 0, radius: 11.2 },
  { zLocal: 52, radius: 8.6 },
];

export class TitanicEngine {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly isSoftwareGl: boolean;

  private readonly textures: ProceduralTextureSet;
  private readonly ship: TitanicShipRig;
  private readonly carpathia: CarpathiaRig;
  private readonly warship: WarshipRig;
  private readonly warship2: WarshipRig;
  private readonly harbor: HarborRig;
  private readonly oceanAndSky: OceanAndSkyRig;
  private readonly iceFactory: IcebergFactory;
  private readonly particles: ParticlePool;
  public readonly sound: SoundEngine;

  private readonly hemiLight: THREE.HemisphereLight;
  private readonly moonKeyLight: THREE.DirectionalLight;
  private readonly rimLight: THREE.DirectionalLight;
  private readonly searchSpotLight: THREE.SpotLight;
  private readonly sceneFog: THREE.FogExp2;

  // Game & Simulation State
  private phase: GamePhase = 'title';
  private cameraMode: CameraMode = 'wheelhouse';
  private endlessMode = false;

  private shipX = 0;
  private shipZ = 0;
  private headingRad = 0;
  private yawRate = 0;
  private rudderDeg = 0;
  private manualRudderTarget: number | null = null;
  private wheelVisualAngle = 0;
  private rollAngle = 0;

  private telegraphIndex = 4; // Start at FULL AHEAD (20 kts)
  private speedKnots = 16;
  private distanceNm = 0;
  private hullIntegrity = 100;
  private floodingPct = 0;
  private waterIngressRate = 0;
  private listDirection = 1;
  private sinkProgress = 0;
  private sinkDropY = 0;
  private sinkPitch = 0;
  private sinkList = 0;
  private powerLevel = 1;
  private groanCooldown = 0;
  private lifeboatsLaunched = 0;
  private aftermathSeconds = 0;
  private carpathiaStage: CarpathiaStage = 'waiting';
  private carpathiaDistanceM = 460;
  private carpathiaWhistlePlayed = false;
  private rescueCompleteWhistlePlayed = false;
  private survivorsRescued = 0;
  private boatsRecovered = 0;
  private warshipRescuing = false;
  private warshipRescueProgress = 0;
  private warshipRescueWhistlePlayed = false;
  private warshipSurvivors = 0;
  private warshipBoatsRecovered = 0;
  private focusCarpathia = false;
  private aftermathFocus: AftermathFocusTarget = 'lifeboats';
  private flareCooldown = 4.0;
  private score = 0;
  private bestScore = 0;
  private nearMissCount = 0;
  private combo = 1;

  // Searchlight sweep & ability
  private searchlightTimer = 0;
  private searchlightCooldown = 0;
  private readonly searchlightDuration = 5.5;
  private readonly searchlightMaxCooldown = 8.0;

  // Juice: hitstop, shake, flashes, lookouts
  private hitstopTimer = 0;
  private shakeIntensity = 0;
  private damageFlashTimer = 0;
  private eventText: string | null = null;
  private eventTimer = 0;
  private icebergWarning: string | null = null;

  // Free 360° mouse orbit, zoom & vessel focus spot / interior walk camera
  private focusSpotIndex = 0;
  private camFocusLocal = new THREE.Vector3(0, 14.78, 1.32);
  private interiorWalkOffset = new THREE.Vector3();
  private orbitYaw = 0;
  private orbitPitch = 0.085;
  private orbitDistance = 0;
  private targetOrbitYaw = 0;
  private targetOrbitPitch = 0.085;
  private targetOrbitDistance = 0;
  private userAdjustedCameraInSink = false;
  private autoFocusedSinkLifeboats = false;
  private hasBrokenInTwo = false;
  private autoFocusedBreakup = false;
  private isPointerDown = false;
  private lastPointerX = 0;
  private lastPointerY = 0;

  // Dynamic Harbor-to-Atlantic Night Progression & Collision Cooldowns
  private nightMix = 0;
  private rescueDawnMix = 0;
  private wheelhouseFloodLevel = 0;
  private initialIceSeeded = false;
  private readonly obstacleCooldowns = new Map<string, number>();
  private readonly floatingBoatHazards: FloatingLifeboatHazard[] = [];
  private readonly tempSkyColor = new THREE.Color();
  private readonly tempColorA = new THREE.Color();
  private readonly tempColorB = new THREE.Color();

  // Pre-allocated consciousness & awareness state (zero per-frame GC)
  private readonly cruiseAwareness: CruiseAwarenessContext = {};
  private bridgeOrderTimer = 0;
  private closestHazardSide = 0;
  private carpathiaAvoidX = 0;
  private carpathiaAvoidZ = 0;
  private carpathiaSteerYaw = 0;
  private autopilotEnabled = false;
  private autopilotTargetRudder = 0;
  private autopilotSpeedCooldown = 0;
  private bowPanicActive = false;
  private panicShoutCooldown = 0;

  // Royal Navy Escort Warships (1: Port/Astern Wake, 2: Starboard Flank Wake)
  private warshipX = -86;
  private warshipZ = -265;
  private warshipHeadingRad = 0.04;
  private warshipYawRate = 0;
  private warshipSpeedKnots = 0;
  private warshipRoll = 0;
  private warshipHasJoinedWake = false;
  private warshipSmokeAccum = 0;
  private warshipSprayAccum = 0;
  private warship1FireFlash = 0;
  private warship1FireCooldown = 1.6;
  private warship1AimLocalX = 0;
  private warship1AimLocalZ = -120;
  private warship1Engaged = false;

  private warship2X = 92;
  private warship2Z = -280;
  private warship2HeadingRad = -0.04;
  private warship2YawRate = 0;
  private warship2SpeedKnots = 0;
  private warship2Roll = 0;
  private warship2HasJoinedWake = false;
  private warship2SmokeAccum = 0;
  private warship2SprayAccum = 0;
  private warship2FireFlash = 0;
  private warship2FireCooldown = 2.6;
  private warship2AimLocalX = 0;
  private warship2AimLocalZ = -120;
  private warship2Engaged = false;

  // Hostile U-Boat Submarines & Pooled Projectiles (Torpedoes & Naval Shells)
  private readonly submarines: SubmarineEntity[] = [];
  private readonly projectiles: NavalProjectile[] = [];
  private readonly projectileMesh: THREE.InstancedMesh;
  private submarineCruiseTriggered = false;
  private submarineAftermathTriggered = false;
  private cruiseSubTimer = 0;
  private submarinesSunk = 0;

  // Iceberg management
  private readonly icebergs: IcebergEntity[] = [];
  private spawnAccumDist = 0;
  private sprayAccum = 0;
  private smokeAccum = 0;
  private helmTickAccum = 0;

  // Input state
  private readonly heldKeys = new Set<string>();
  private readonly clock = new THREE.Clock();
  private simTime = 0;
  private frameId = 0;
  private disposed = false;
  private telemetryAccum = 0;

  private readonly onTelemetry: (snap: TelemetrySnapshot) => void;
  private readonly onDamageFlash: (strength: number) => void;

  constructor(
    container: HTMLElement,
    onTelemetry: (snap: TelemetrySnapshot) => void,
    onDamageFlash: (strength: number) => void,
  ) {
    this.container = container;
    this.onTelemetry = onTelemetry;
    this.onDamageFlash = onDamageFlash;
    this.sound = new SoundEngine();

    try {
      const saved = localStorage.getItem(BEST_SCORE_KEY);
      if (saved) this.bestScore = parseInt(saved, 10) || 0;
    } catch {
      this.bestScore = 0;
    }

    // 1. Software WebGL detection
    this.isSoftwareGl = (() => {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return true;
      const ext = probe.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
      const gpu = String(probe.getParameter(param));
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    // 2. Modern Renderer Setup
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2),
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    container.appendChild(this.renderer.domElement);

    // 3. Scene & Camera
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9ec4db);
    this.sceneFog = new THREE.FogExp2(0x9ec4db, 0.00095);
    this.scene.fog = this.sceneFog;

    const aspect = (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight);
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.15, 1800);

    // 4. Mandatory Procedural Studio Environment Reflection
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // 5. Balanced 3-Point Warm/Cool Lighting (morphs cleanly from April Noon to Arctic Night)
    this.hemiLight = new THREE.HemisphereLight(0xcce7ff, 0x4d5a4f, 1.18);
    this.scene.add(this.hemiLight);

    this.moonKeyLight = new THREE.DirectionalLight(0xfff3d8, 2.85);
    this.moonKeyLight.position.set(110, 145, -240);
    this.moonKeyLight.castShadow = !this.isSoftwareGl;
    this.moonKeyLight.shadow.mapSize.set(1024, 1024);
    this.moonKeyLight.shadow.bias = -0.0005;
    this.moonKeyLight.shadow.normalBias = 0.02;
    const d = 230;
    this.moonKeyLight.shadow.camera.left = -d;
    this.moonKeyLight.shadow.camera.right = d;
    this.moonKeyLight.shadow.camera.top = d;
    this.moonKeyLight.shadow.camera.bottom = -d;
    this.moonKeyLight.shadow.camera.near = 20;
    this.moonKeyLight.shadow.camera.far = 650;
    this.scene.add(this.moonKeyLight);
    this.scene.add(this.moonKeyLight.target);

    this.rimLight = new THREE.DirectionalLight(0x9bc4e8, 0.85);
    this.rimLight.position.set(-120, 60, 100);
    this.scene.add(this.rimLight);

    // 6. Build Assets
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.textures = createProceduralTextures(maxAniso);

    this.oceanAndSky = createOceanAndSky(this.isSoftwareGl);
    this.scene.add(this.oceanAndSky.oceanMesh);
    this.scene.add(this.oceanAndSky.skyGroup);

    this.harbor = buildSouthamptonHarbor(this.textures, this.isSoftwareGl);
    this.scene.add(this.harbor.root);

    this.ship = buildTitanicShip(this.textures, this.isSoftwareGl);
    this.scene.add(this.ship.root);

    this.carpathia = buildCarpathiaShip(this.textures, this.isSoftwareGl);
    this.scene.add(this.carpathia.root);

    this.warship = buildWarshipShip(this.textures, this.isSoftwareGl);
    this.scene.add(this.warship.root);

    this.warship2 = buildWarshipShip(this.textures, this.isSoftwareGl);
    this.scene.add(this.warship2.root);

    for (let i = 0; i < 2; i++) {
      const rig = buildSubmarineShip(this.isSoftwareGl);
      rig.root.visible = false;
      this.scene.add(rig.root);
      this.submarines.push({
        id: i,
        label: i === 0 ? 'U-14' : 'U-17',
        rig,
        state: 'hidden',
        x: 0,
        z: 0,
        headingRad: 0,
        speedKnots: 12,
        diveY: -12,
        damagePitch: 0,
        damageRoll: 0,
        hp: 3,
        maxHp: 3,
        gunYaw: 0,
        gunFireFlash: 0,
        hitFireIntensity: 0,
        torpedoCooldown: 3.5 + i * 2.5,
        gunCooldown: 2.2 + i * 1.8,
        sideSign: i === 0 ? -1 : 1,
        sinkElapsed: 0,
        wakeAccum: 0,
        targetVessel: 'titanic',
      });
    }

    const projGeo = new THREE.CylinderGeometry(0.18, 0.24, 2.2, 8);
    projGeo.rotateX(Math.PI / 2);
    const projMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.projectileMesh = new THREE.InstancedMesh(projGeo, projMat, MAX_NAVAL_PROJECTILES);
    this.projectileMesh.frustumCulled = false;
    for (let i = 0; i < MAX_NAVAL_PROJECTILES; i++) {
      this.projectiles.push({
        active: false,
        kind: 'warshipShell',
        ownerSide: 'warship',
        targetKind: 'submarine',
        targetSubId: 0,
        x: 0,
        y: -50,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        wakeAccum: 0,
      });
      _projDummy.position.set(0, -50, 0);
      _projDummy.scale.setScalar(0.001);
      _projDummy.updateMatrix();
      this.projectileMesh.setMatrixAt(i, _projDummy.matrix);
      this.projectileMesh.setColorAt(i, _projColor.setHex(0xfff3b0));
    }
    this.projectileMesh.instanceMatrix.needsUpdate = true;
    if (this.projectileMesh.instanceColor) this.projectileMesh.instanceColor.needsUpdate = true;
    this.scene.add(this.projectileMesh);

    // Searchlight SpotLight attached to forward bridge roof (sinks with bow half)
    this.searchSpotLight = new THREE.SpotLight(0xeef8ff, 24, 480, Math.PI / 9, 0.55, 1.1);
    this.searchSpotLight.position.set(0, 16.25, -1.5);
    this.searchSpotLight.target = this.ship.searchlightTarget;
    this.ship.bowContent.add(this.searchSpotLight);

    this.iceFactory = new IcebergFactory(this.textures);
    this.particles = new ParticlePool(320);
    this.scene.add(this.particles.mesh);

    // Start Title screen in bright sunlit Southampton Harbor Berth 44
    this.resetWarshipPose(false);
    this.applyAtmosphere(0);
    this.oceanAndSky.update(
      0,
      0,
      0,
      0,
      0,
      0,
      this.warshipX,
      this.warshipZ,
      this.warshipHeadingRad,
      this.warshipSpeedKnots,
      this.warship2X,
      this.warship2Z,
      this.warship2HeadingRad,
      this.warship2SpeedKnots,
    );
    this.updateTitleCamera();
    this.oceanAndSky.updateCameraView(this.camera.position, 0);
    this.harbor.update(0, 0, 0, 0, 0, 0, 0, 0, false);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.bindEvents();
    this.emitTelemetry();
    this.clock.start();
    this.startLoop();
  }

  private seedInitialIcebergs(): void {
    this.clearIcebergs();
    const fwdX = Math.sin(this.headingRad);
    const fwdZ = -Math.cos(this.headingRad);
    const rightX = Math.cos(this.headingRad);
    const rightZ = Math.sin(this.headingRad);
    const initialSet: Array<{ variant: IcebergVariant; lateral: number; ahead: number; scale: number }> = [
      { variant: 'pinnacle', lateral: -46, ahead: 195, scale: 1.05 },
      { variant: 'tabular', lateral: 52, ahead: 255, scale: 1.15 },
      { variant: 'growler', lateral: -16, ahead: 300, scale: 0.95 },
      { variant: 'pinnacle', lateral: 64, ahead: 370, scale: 1.2 },
      { variant: 'tabular', lateral: -62, ahead: 410, scale: 1.0 },
    ];
    for (const item of initialSet) {
      const sx = this.shipX + fwdX * item.ahead + rightX * item.lateral;
      const sz = this.shipZ + fwdZ * item.ahead + rightZ * item.lateral;
      const berg = this.iceFactory.spawnIceberg(item.variant, sx, sz, item.scale);
      this.icebergs.push(berg);
      this.scene.add(berg.group);
    }
    this.initialIceSeeded = true;
  }

  private clearIcebergs(): void {
    for (const b of this.icebergs) {
      this.scene.remove(b.group);
    }
    this.icebergs.length = 0;
    this.initialIceSeeded = false;
  }

  // =========================================================================
  // PUBLIC CONTROLS FOR REACT UI & KEYBOARD
  // =========================================================================
  private resetShipRigPose(): void {
    this.ship.hullMeshGroup.visible = true;
    this.ship.hullMeshGroup.position.set(0, 0, 0);
    this.ship.hullMeshGroup.rotation.set(0, 0, 0);
    this.ship.bowGroup.position.set(0, 0, BREAK_Z);
    this.ship.bowGroup.rotation.set(0, 0, 0);
    this.ship.sternGroup.position.set(0, 0, BREAK_Z);
    this.ship.sternGroup.rotation.set(0, 0, 0);
    this.ship.setBreakupVisual(false, 0);
    this.ship.crewAndLifeboats.reset();
    this.carpathia.root.visible = false;
    this.aftermathSeconds = 0;
    this.carpathiaStage = 'waiting';
    this.carpathiaDistanceM = 460;
    this.carpathiaWhistlePlayed = false;
    this.rescueCompleteWhistlePlayed = false;
    this.survivorsRescued = 0;
    this.boatsRecovered = 0;
    this.warshipRescuing = false;
    this.warshipRescueProgress = 0;
    this.warshipRescueWhistlePlayed = false;
    this.warshipSurvivors = 0;
    this.warshipBoatsRecovered = 0;
    this.focusCarpathia = false;
    this.aftermathFocus = 'lifeboats';
    this.flareCooldown = 4.0;
    this.rescueDawnMix = 0;
    this.wheelhouseFloodLevel = 0;
    this.carpathiaAvoidX = 0;
    this.carpathiaAvoidZ = 0;
    this.carpathiaSteerYaw = 0;
    this.resetNavalCombat();
  }

  private resetNavalCombat(): void {
    this.submarineCruiseTriggered = false;
    this.submarineAftermathTriggered = false;
    this.cruiseSubTimer = 0;
    this.submarinesSunk = 0;
    this.warship1FireFlash = 0;
    this.warship1FireCooldown = 1.4;
    this.warship1Engaged = false;
    this.warship2FireFlash = 0;
    this.warship2FireCooldown = 2.4;
    this.warship2Engaged = false;

    for (const sub of this.submarines) {
      sub.state = 'hidden';
      sub.rig.root.visible = false;
      sub.diveY = -12;
      sub.damagePitch = 0;
      sub.damageRoll = 0;
      sub.hp = sub.maxHp;
      sub.gunYaw = 0;
      sub.gunFireFlash = 0;
      sub.hitFireIntensity = 0;
      sub.sinkElapsed = 0;
      sub.wakeAccum = 0;
    }

    for (let i = 0; i < MAX_NAVAL_PROJECTILES; i++) {
      this.projectiles[i].active = false;
      _projDummy.position.set(0, -50, 0);
      _projDummy.scale.setScalar(0.001);
      _projDummy.updateMatrix();
      this.projectileMesh.setMatrixAt(i, _projDummy.matrix);
    }
    this.projectileMesh.instanceMatrix.needsUpdate = true;
  }

  private resetWarshipPose(inNightWatch: boolean): void {
    if (inNightWatch) {
      this.warshipX = -46;
      this.warshipZ = -2100 + 306; // 111m astern port quarter in the foaming wake
      this.warshipHeadingRad = 0;
      this.warshipYawRate = 0;
      this.warshipSpeedKnots = 18;
      this.warshipRoll = 0;
      this.warshipHasJoinedWake = true;

      this.warship2X = 68;
      this.warship2Z = -2100 + 255; // Starboard flank escort astern
      this.warship2HeadingRad = 0;
      this.warship2YawRate = 0;
      this.warship2SpeedKnots = 18;
      this.warship2Roll = 0;
      this.warship2HasJoinedWake = true;
    } else {
      this.warshipX = -86;
      this.warshipZ = -265;
      this.warshipHeadingRad = 0.04;
      this.warshipYawRate = 0;
      this.warshipSpeedKnots = 0;
      this.warshipRoll = 0;
      this.warshipHasJoinedWake = false;

      this.warship2X = 92;
      this.warship2Z = -280;
      this.warship2HeadingRad = -0.04;
      this.warship2YawRate = 0;
      this.warship2SpeedKnots = 0;
      this.warship2Roll = 0;
      this.warship2HasJoinedWake = false;
    }
    this.warshipSmokeAccum = 0;
    this.warshipSprayAccum = 0;
    this.warship2SmokeAccum = 0;
    this.warship2SprayAccum = 0;

    this.warship.root.position.set(this.warshipX, 0, this.warshipZ);
    this.warship.root.rotation.set(0, -this.warshipHeadingRad, 0);
    this.warship.setNavalState(0, this.warshipSpeedKnots, inNightWatch ? 1 : 0, false, undefined, undefined, {
      laddersDeployed: false,
      boardedRatio: 0,
    });

    this.warship2.root.position.set(this.warship2X, 0, this.warship2Z);
    this.warship2.root.rotation.set(0, -this.warship2HeadingRad, 0);
    this.warship2.setNavalState(0, this.warship2SpeedKnots, inNightWatch ? 1 : 0, false, undefined, undefined, {
      laddersDeployed: false,
      boardedRatio: 0,
    });
  }

  private beginVoyageCommon(startInNightIceAlley: boolean): void {
    this.sound.unlock();
    this.clearIcebergs();
    this.obstacleCooldowns.clear();
    this.phase = 'playing';
    this.endlessMode = false;
    this.headingRad = 0;
    this.yawRate = 0;
    this.rudderDeg = 0;
    this.manualRudderTarget = null;
    this.wheelVisualAngle = 0;
    this.rollAngle = 0;
    this.distanceNm = 0;
    this.hullIntegrity = 100;
    this.floodingPct = 0;
    this.waterIngressRate = 0;
    this.listDirection = 1;
    this.sinkProgress = 0;
    this.sinkDropY = 0;
    this.sinkPitch = 0;
    this.sinkList = 0;
    this.powerLevel = 1;
    this.groanCooldown = 0;
    this.lifeboatsLaunched = 0;
    this.score = 0;
    this.nearMissCount = 0;
    this.combo = 1;
    this.searchlightTimer = 0;
    this.searchlightCooldown = 0;
    this.hitstopTimer = 0;
    this.shakeIntensity = 0;
    this.damageFlashTimer = 0;
    this.icebergWarning = null;
    this.spawnAccumDist = 0;
    this.userAdjustedCameraInSink = false;
    this.autoFocusedSinkLifeboats = false;
    this.hasBrokenInTwo = false;
    this.autoFocusedBreakup = false;
    this.bridgeOrderTimer = 0;
    this.closestHazardSide = 0;
    this.autopilotEnabled = false;
    this.autopilotTargetRudder = 0;
    this.autopilotSpeedCooldown = 0;
    this.bowPanicActive = false;
    this.panicShoutCooldown = 0;

    this.resetShipRigPose();
    this.harbor.resetEscorts();

    if (startInNightIceAlley) {
      this.shipX = 0;
      this.shipZ = -2100;
      this.telegraphIndex = 4; // FULL AHEAD
      this.speedKnots = 18;
      this.harbor.root.visible = false;
      this.applyAtmosphere(1.0);
      this.ship.setPowerLevel(1);
      this.seedInitialIcebergs();
      this.resetWarshipPose(true);
      this.eventText = 'APRIL 14 NIGHT WATCH — ALL AHEAD FULL';
    } else {
      // Dock-Start Direct Control right at Southampton Berth 44
      this.shipX = 0;
      this.shipZ = 0;
      this.telegraphIndex = 1; // ALL STOP — player sets speed & steers from dock
      this.speedKnots = 0;
      this.harbor.root.visible = true;
      this.applyAtmosphere(0);
      this.resetWarshipPose(false);
      this.harbor.update(
        this.simTime,
        this.shipX,
        this.shipZ,
        this.headingRad,
        this.speedKnots,
        this.floodingPct,
        0,
        0,
        false,
      );
      this.eventText = 'BERTH 44 — PRESS W FOR ENGINE ORDER · ← / → RUDDER';
      this.sound.playSteamWhistle();
    }

    this.eventTimer = 3.6;
    this.ship.setWheelhouseFloodLevel(0);
    this.focusVesselSpot('wheelhouse', false);
    this.sound.playTelegraphBell();
    this.emitTelemetry();
  }

  public startGame(): void {
    this.beginVoyageCommon(false);
  }

  public startNightVoyage(): void {
    this.beginVoyageCommon(true);
  }

  public togglePause(): void {
    if (this.phase === 'playing') {
      this.phase = 'paused';
      this.heldKeys.clear();
      this.emitTelemetry();
    } else if (this.phase === 'paused') {
      this.phase = 'playing';
      this.emitTelemetry();
    }
  }

  public continueEndless(): void {
    if (this.phase === 'victory') {
      this.endlessMode = true;
      this.phase = 'playing';
      this.eventText = 'ENDLESS NIGHT WATCH';
      this.eventTimer = 2.6;
      this.emitTelemetry();
    }
  }

  public skipSinking(): void {
    if (this.phase === 'sinking') {
      this.sinkProgress = 1;
      this.hasBrokenInTwo = true;
      this.ship.setBreakupVisual(true, 0);
      this.ship.bowGroup.position.y = -72;
      this.ship.bowGroup.rotation.x = -0.76;
      this.ship.sternGroup.position.y = -138;
      this.ship.sternGroup.rotation.x = -1.46;
      this.ship.setPowerLevel(0);
      this.ship.hullMeshGroup.visible = false;
      this.lifeboatsLaunched = this.ship.crewAndLifeboats.updateSinking(
        this.simTime,
        0.016,
        1.0,
        this.ship.root,
      );
      this.enterAftermath();
    }
  }

  public openVoyageReport(): void {
    if (this.phase === 'aftermath') {
      this.phase = 'gameover';
      this.emitTelemetry();
    }
  }

  public closeVoyageReportToAftermath(): void {
    if (this.phase === 'gameover') {
      this.phase = 'aftermath';
      this.emitTelemetry();
    }
  }

  public fastForwardRescueWait(): void {
    if (this.phase === 'aftermath' && this.carpathiaStage === 'waiting') {
      this.aftermathSeconds = Math.max(this.aftermathSeconds, 58.0);
      this.warshipRescuing = true;
      this.warshipRescueProgress = Math.max(this.warshipRescueProgress, 1.0);
      this.emitTelemetry();
    }
  }

  public focusAftermathTarget(target: AftermathFocusTarget): void {
    if (this.phase !== 'aftermath' && this.phase !== 'gameover') return;
    if (target === 'carpathia' && !this.carpathia.root.visible) {
      this.aftermathFocus = 'lifeboats';
    } else {
      this.aftermathFocus = target;
    }
    this.focusCarpathia = this.aftermathFocus === 'carpathia';
    if (this.aftermathFocus === 'carpathia') {
      this.targetOrbitYaw = 0.85;
      this.targetOrbitPitch = 0.16;
      this.targetOrbitDistance = 122;
    } else if (this.aftermathFocus === 'warship') {
      this.targetOrbitYaw = 0.68;
      this.targetOrbitPitch = 0.17;
      this.targetOrbitDistance = 104;
    } else if (this.aftermathFocus === 'submarines') {
      this.targetOrbitYaw = 0.62;
      this.targetOrbitPitch = 0.18;
      this.targetOrbitDistance = 72;
    } else {
      this.targetOrbitYaw = 0.72;
      this.targetOrbitPitch = 0.22;
      this.targetOrbitDistance = 135;
    }
    this.emitTelemetry();
  }

  public focusOnCarpathia(enable: boolean): void {
    this.focusAftermathTarget(enable ? 'carpathia' : 'lifeboats');
  }

  private enterAftermath(): void {
    this.phase = 'aftermath';
    this.ship.hullMeshGroup.visible = false;
    this.aftermathSeconds = 0;
    this.carpathiaStage = 'waiting';
    this.carpathiaDistanceM = 460;
    this.carpathiaWhistlePlayed = false;
    this.rescueCompleteWhistlePlayed = false;
    this.survivorsRescued = 0;
    this.boatsRecovered = 0;
    this.warshipRescuing = false;
    this.warshipRescueProgress = 0;
    this.warshipRescueWhistlePlayed = false;
    this.warshipSurvivors = 0;
    this.warshipBoatsRecovered = 0;
    this.focusCarpathia = false;
    this.aftermathFocus = 'lifeboats';
    this.flareCooldown = 3.5;
    this.carpathia.root.visible = false;
    if (VESSEL_SPOTS[this.focusSpotIndex].id === 'wheelhouse') {
      this.focusVesselSpot('funnels', false);
    }
    this.eventText = 'RMS TITANIC SUBMERGED — ESCORT WARSHIP CLOSING TO RESCUE';
    this.eventTimer = 5.5;
    this.saveBestScore();
    this.emitTelemetry();
  }

  public returnToTitle(): void {
    this.phase = 'title';
    this.heldKeys.clear();
    this.clearIcebergs();
    this.obstacleCooldowns.clear();
    this.shipX = 0;
    this.shipZ = 0;
    this.headingRad = 0;
    this.rudderDeg = 0;
    this.speedKnots = 0;
    this.hullIntegrity = 100;
    this.floodingPct = 0;
    this.waterIngressRate = 0;
    this.sinkProgress = 0;
    this.sinkDropY = 0;
    this.sinkPitch = 0;
    this.sinkList = 0;
    this.powerLevel = 1;
    this.lifeboatsLaunched = 0;
    this.userAdjustedCameraInSink = false;
    this.autoFocusedSinkLifeboats = false;
    this.hasBrokenInTwo = false;
    this.autoFocusedBreakup = false;
    this.focusSpotIndex = 0;
    this.autopilotEnabled = false;
    this.autopilotTargetRudder = 0;
    this.autopilotSpeedCooldown = 0;
    this.bowPanicActive = false;
    this.panicShoutCooldown = 0;
    this.harbor.root.visible = true;
    this.harbor.resetEscorts();
    this.applyAtmosphere(0);
    this.resetShipRigPose();
    this.resetWarshipPose(false);
    this.ship.setWheelhouseFloodLevel(0);
    this.focusVesselSpot('wheelhouse', false);
    this.emitTelemetry();
  }

  public toggleAutopilot(): void {
    this.sound.unlock();
    if (this.phase !== 'playing') return;
    this.autopilotEnabled = !this.autopilotEnabled;
    this.manualRudderTarget = null;
    this.autopilotSpeedCooldown = 0;
    this.sound.playAutopilotChime(this.autopilotEnabled);
    if (this.autopilotEnabled) {
      this.bridgeOrderTimer = 1.6;
      this.eventText = 'AUTOPILOT ENGAGED — WHEELHOUSE CREW AT THE HELM';
    } else {
      this.eventText = 'AUTOPILOT DISENGAGED — MANUAL HELM CONTROL';
    }
    this.eventTimer = 2.6;
    this.emitTelemetry();
  }

  public setTelegraphIndex(idx: number): void {
    this.sound.unlock();
    const clamped = Math.max(0, Math.min(TELEGRAPH_NOTCHES.length - 1, idx));
    if (clamped !== this.telegraphIndex) {
      this.telegraphIndex = clamped;
      this.bridgeOrderTimer = 1.85;
      this.sound.playTelegraphBell();
      this.eventText = TELEGRAPH_NOTCHES[clamped].label;
      this.eventTimer = 1.6;
      this.emitTelemetry();
    }
  }

  public stepTelegraph(delta: number): void {
    this.setTelegraphIndex(this.telegraphIndex + delta);
  }

  public setManualRudder(deg: number | null): void {
    this.sound.unlock();
    this.manualRudderTarget = deg === null ? null : THREE.MathUtils.clamp(deg, -35, 35);
  }

  public triggerSearchlight(): void {
    this.sound.unlock();
    if (this.phase !== 'playing') return;
    if (this.searchlightTimer > 0 || this.searchlightCooldown > 0) return;
    this.searchlightTimer = this.searchlightDuration;
    this.sound.playSteamWhistle();
    this.eventText = 'SEARCHLIGHT SWEEP & WHISTLE';
    this.eventTimer = 2.0;
    this.emitTelemetry();
  }

  public focusVesselSpot(spotId: VesselSpotId, announce = true): void {
    const idx = VESSEL_SPOTS.findIndex((s) => s.id === spotId);
    if (idx === -1) return;
    this.focusSpotIndex = idx;
    const spec = VESSEL_SPOTS[idx];
    this.interiorWalkOffset.set(0, 0, 0);
    this.targetOrbitYaw = spec.defaultOrbitYaw;
    this.targetOrbitPitch = spec.defaultOrbitPitch;
    this.targetOrbitDistance = spec.defaultDistance;
    this.cameraMode = spec.id === 'wheelhouse' ? 'wheelhouse' : 'bridgeWing';

    if (this.phase === 'sinking' && announce) {
      this.userAdjustedCameraInSink = true;
    }
    if (announce && this.phase === 'playing') {
      this.eventText = `${spec.category === 'interior' ? 'INTERIOR' : 'STATION'}: ${spec.label.toUpperCase()}`;
      this.eventTimer = 1.8;
    }
    this.emitTelemetry();
  }

  public cycleFocusSpot(): void {
    const nextIdx = (this.focusSpotIndex + 1) % VESSEL_SPOTS.length;
    this.focusVesselSpot(VESSEL_SPOTS[nextIdx].id, true);
  }

  public toggleCameraMode(): void {
    if (VESSEL_SPOTS[this.focusSpotIndex].id === 'wheelhouse') {
      this.focusVesselSpot('funnels', true);
    } else {
      this.focusVesselSpot('wheelhouse', true);
    }
  }

  public toggleMute(): void {
    this.sound.unlock();
    this.sound.toggleMute();
    this.emitTelemetry();
  }

  // =========================================================================
  // INPUT & WINDOW EVENTS
  // =========================================================================
  private readonly handleKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    const code = e.code;

    if (code === 'Escape' || code === 'KeyP') {
      if (this.phase === 'playing' || this.phase === 'paused') {
        this.togglePause();
      }
      return;
    }

    if (code === 'KeyM') {
      this.toggleMute();
      return;
    }

    if (this.phase === 'title') {
      if (code === 'Enter' || code === 'Space') {
        e.preventDefault();
        this.startGame();
      }
      return;
    }

    if (this.phase === 'gameover' || this.phase === 'victory' || this.phase === 'aftermath') {
      if (code === 'Enter') {
        e.preventDefault();
        this.startGame();
      } else if (code === 'KeyS') {
        e.preventDefault();
        this.cycleFocusSpot();
      } else if (code === 'KeyC') {
        this.toggleCameraMode();
      }
      return;
    }

    if (this.phase === 'sinking') {
      if (code === 'KeyS') {
        e.preventDefault();
        this.cycleFocusSpot();
      } else if (code === 'KeyC') {
        this.toggleCameraMode();
      } else if (code === 'Enter' || code === 'Space') {
        e.preventDefault();
        this.skipSinking();
      }
      return;
    }

    if (this.phase !== 'playing') return;

    this.heldKeys.add(code);

    if (code === 'KeyW' || code === 'ArrowUp') {
      e.preventDefault();
      this.stepTelegraph(1);
    } else if (code === 'KeyX' || code === 'ArrowDown') {
      e.preventDefault();
      this.stepTelegraph(-1);
    } else if (code === 'KeyA') {
      e.preventDefault();
      this.toggleAutopilot();
    } else if (code === 'KeyS') {
      e.preventDefault();
      this.cycleFocusSpot();
    } else if (code === 'Space') {
      e.preventDefault();
      this.triggerSearchlight();
    } else if (code === 'KeyC') {
      this.toggleCameraMode();
    }
  };

  private readonly handleKeyUp = (e: KeyboardEvent) => {
    this.heldKeys.delete(e.code);
  };

  private readonly handleBlur = () => {
    this.heldKeys.clear();
    this.isPointerDown = false;
  };

  private readonly handlePointerDown = (e: PointerEvent) => {
    if (this.phase === 'title' || this.phase === 'paused') return;
    this.sound.unlock();
    this.isPointerDown = true;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  };

  private readonly handlePointerMove = (e: PointerEvent) => {
    if (!this.isPointerDown || this.phase === 'title' || this.phase === 'paused') return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.targetOrbitYaw -= dx * 0.0062;
    this.targetOrbitPitch = THREE.MathUtils.clamp(
      this.targetOrbitPitch + dy * 0.0045,
      -0.85,
      1.18,
    );
    if (this.phase === 'sinking') {
      this.userAdjustedCameraInSink = true;
    }
  };

  private readonly handlePointerUp = () => {
    this.isPointerDown = false;
  };

  private readonly handleWheel = (e: WheelEvent) => {
    if (this.phase === 'title' || this.phase === 'paused') return;
    e.preventDefault();
    const minDist = VESSEL_SPOTS[this.focusSpotIndex].minDistance;
    const step = e.deltaY * 0.045;
    this.targetOrbitDistance = THREE.MathUtils.clamp(
      this.targetOrbitDistance + step,
      minDist,
      260,
    );
    if (this.phase === 'sinking') {
      this.userAdjustedCameraInSink = true;
    }
  };

  private readonly handleResize = () => {
    if (this.disposed) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private bindEvents(): void {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    window.addEventListener('resize', this.handleResize);
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
  }

  private unbindEvents(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    window.removeEventListener('resize', this.handleResize);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.handlePointerDown);
    canvas.removeEventListener('wheel', this.handleWheel);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
  }

  // =========================================================================
  // MAIN SIMULATION LOOP
  // =========================================================================
  private startLoop(): void {
    const tick = () => {
      if (this.disposed) return;

      const rawDt = this.clock.getDelta();
      const dt = Math.min(rawDt, 0.05);

      this.stepSimulation(dt);
      this.renderer.render(this.scene, this.camera);

      if (this.isSoftwareGl) {
        this.afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    if (this.isSoftwareGl) {
      this.afterDraw(tick);
    } else {
      this.frameId = requestAnimationFrame(tick);
    }
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private stepSimulation(dt: number): void {
    if (this.phase === 'paused') {
      this.sound.updateShipAmbience(0, false);
      return;
    }

    // Hitstop freeze for heavy collision impact feel
    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
      this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 1.4);
      this.updateCamera(dt);
      return;
    }

    this.simTime += dt;

    if (this.damageFlashTimer > 0) {
      this.damageFlashTimer = Math.max(0, this.damageFlashTimer - dt);
      this.onDamageFlash(this.damageFlashTimer / 0.45);
    }

    if (this.eventTimer > 0) {
      this.eventTimer -= dt;
      if (this.eventTimer <= 0) this.eventText = null;
    }

    if (this.bridgeOrderTimer > 0) {
      this.bridgeOrderTimer = Math.max(0, this.bridgeOrderTimer - dt);
    }

    if (this.phase === 'title') {
      // Sunlit Southampton Harbor moored beauty pan on Title Screen
      this.applyAtmosphere(0);
      this.rudderDeg = Math.sin(this.simTime * 0.35) * 4;
      this.wheelVisualAngle = THREE.MathUtils.damp(this.wheelVisualAngle, -this.rudderDeg * 0.11, 5, dt);
      this.ship.helmWheel.rotation.z = this.wheelVisualAngle;
      this.updateShipVisualRig(dt, 0);
      this.populateCruiseAwareness(true);
      this.ship.crewAndLifeboats.updateCruising(this.simTime, dt, 0, this.ship.root, this.cruiseAwareness);
      this.harbor.update(this.simTime, this.shipX, this.shipZ, this.headingRad, 0, 0, 0, dt, false);
      this.stepWarshipConsciousness(dt, 0, false);
      this.emitBowSpray(dt, 0, -1, true);
      this.oceanAndSky.update(
        this.simTime,
        this.shipX,
        this.shipZ,
        0,
        0,
        0,
        this.warshipX,
        this.warshipZ,
        this.warshipHeadingRad,
        this.warshipSpeedKnots,
        this.warship2X,
        this.warship2Z,
        this.warship2HeadingRad,
        this.warship2SpeedKnots,
      );
      this.particles.update(dt);
      this.updateTitleCamera();
      this.syncUnderwaterCameraEffects(0, dt);
      this.sound.updateShipAmbience(2, false);
      return;
    }

    if (this.phase === 'sinking') {
      this.stepSinkingSequence(dt);
      return;
    }

    if (this.phase === 'aftermath') {
      this.stepAftermathSequence(dt);
      return;
    }

    if (this.phase === 'victory' || this.phase === 'gameover') {
      this.speedKnots = THREE.MathUtils.damp(this.speedKnots, 0, 1.2, dt);
      this.shipZ -= this.speedKnots * 1.5 * dt * Math.cos(this.headingRad);
      this.shipX += this.speedKnots * 1.5 * dt * Math.sin(this.headingRad);
      this.updateShipVisualRig(dt, this.speedKnots);
      if (this.phase === 'victory') {
        this.populateCruiseAwareness(false);
        this.ship.crewAndLifeboats.updateCruising(
          this.simTime,
          dt,
          this.floodingPct,
          this.ship.root,
          this.cruiseAwareness,
        );
      } else {
        this.advanceRescueSimulation(dt);
        this.stepNavalCombat(dt, 1.0, 'carpathia');
      }
      this.stepWarshipConsciousness(dt, 1.0, this.phase === 'gameover');
      this.applyAtmosphere(1.0, this.phase === 'gameover' ? this.rescueDawnMix : 0);
      this.oceanAndSky.update(
        this.simTime,
        this.shipX,
        this.shipZ,
        this.headingRad,
        this.speedKnots,
        1.0,
        this.warshipX,
        this.warshipZ,
        this.warshipHeadingRad,
        this.warshipSpeedKnots,
        this.warship2X,
        this.warship2Z,
        this.warship2HeadingRad,
        this.warship2SpeedKnots,
      );
      this.particles.update(dt);
      this.updateCamera(dt);
      this.syncUnderwaterCameraEffects(1.0, dt);
      this.sound.updateShipAmbience(this.speedKnots, false);
      return;
    }

    // =======================================================================
    // ACTIVE GAMEPLAY SIMULATION (Direct Control / Autopilot -> Channel -> Night)
    // =======================================================================
    const prevRudder = this.rudderDeg;
    if (this.autopilotEnabled) {
      this.computeAutopilotCommand(dt);
      this.rudderDeg = THREE.MathUtils.damp(this.rudderDeg, this.autopilotTargetRudder, 5.2, dt);
    } else {
      const steerLeft = this.heldKeys.has('ArrowLeft') || this.heldKeys.has('KeyQ');
      const steerRight =
        this.heldKeys.has('ArrowRight') || this.heldKeys.has('KeyE') || this.heldKeys.has('KeyD');

      if (steerLeft && !steerRight) {
        this.manualRudderTarget = null;
        this.rudderDeg = Math.max(-35, this.rudderDeg - 52 * dt);
      } else if (steerRight && !steerLeft) {
        this.manualRudderTarget = null;
        this.rudderDeg = Math.min(35, this.rudderDeg + 52 * dt);
      } else if (this.manualRudderTarget !== null) {
        this.rudderDeg = THREE.MathUtils.damp(this.rudderDeg, this.manualRudderTarget, 7, dt);
      } else {
        // Gently relax rudder back toward amidships when keys released
        this.rudderDeg = THREE.MathUtils.damp(this.rudderDeg, 0, 1.8, dt);
      }
    }

    if (this.bowPanicActive) {
      this.panicShoutCooldown -= dt;
      if (this.panicShoutCooldown <= 0) {
        this.panicShoutCooldown = 2.6 + Math.random() * 2.2;
        this.sound.playPanicShoutBurst();
      }
    }

    // Subtle mechanical helm spoke sound when steering actively
    if (Math.abs(this.rudderDeg - prevRudder) > 0.1) {
      this.helmTickAccum += Math.abs(this.rudderDeg - prevRudder);
      if (this.helmTickAccum > 9) {
        this.helmTickAccum = 0;
        this.sound.playHelmTick();
      }
    }

    // I / J / K / L Smooth Interior & Deck Walking
    this.stepInteriorWalk(dt);

    // Telegraph speed interpolation (massive liner inertia)
    const targetKnots = TELEGRAPH_NOTCHES[this.telegraphIndex].targetKnots;
    const accelRate = targetKnots < this.speedKnots ? 0.75 : 0.48;
    this.speedKnots = THREE.MathUtils.damp(this.speedKnots, targetKnots, accelRate, dt);

    // Rudder authority scales with speed (with a low-speed tug/thruster nudge so dock maneuvering works cleanly)
    const speedAuthority = 0.36 + 0.64 * Math.min(1, Math.abs(this.speedKnots) / 20);
    const reverseSign = this.speedKnots < -1 ? -0.65 : 1;
    const targetYawRate = (this.rudderDeg / 35) * 0.36 * speedAuthority * reverseSign;
    this.yawRate = THREE.MathUtils.damp(this.yawRate, targetYawRate, 2.4, dt);
    this.headingRad += this.yawRate * dt;

    // Move ship along heading
    const worldSpeed = this.speedKnots * 2.15; // units/sec
    const fwdX = Math.sin(this.headingRad);
    const fwdZ = -Math.cos(this.headingRad);
    this.shipX += fwdX * worldSpeed * dt;
    this.shipZ += fwdZ * worldSpeed * dt;

    // Progress Nautical Miles & Score
    if (this.speedKnots > 0.2) {
      const distStep = worldSpeed * dt;
      const nmDelta = distStep / 340;
      this.distanceNm += nmDelta;
      this.score += nmDelta * (120 + this.speedKnots * 6);
    }

    // Smoothly transition atmosphere from Southampton Daylight (shipZ >= -540) to April 14 Night (-1450+)
    const seaMix = THREE.MathUtils.smoothstep(-this.shipZ, 540, 1450);
    this.harbor.root.visible = Math.hypot(this.shipX, this.shipZ) < 1750;
    if (this.harbor.root.visible) {
      this.harbor.update(
        this.simTime,
        this.shipX,
        this.shipZ,
        this.headingRad,
        this.speedKnots,
        this.floodingPct,
        seaMix,
        dt,
        true,
      );
    }

    // Searchlight sweep timers
    if (this.searchlightTimer > 0) {
      this.searchlightTimer -= dt;
      if (this.searchlightTimer <= 0) {
        this.searchlightTimer = 0;
        this.searchlightCooldown = this.searchlightMaxCooldown;
      }
    } else if (this.searchlightCooldown > 0) {
      this.searchlightCooldown = Math.max(0, this.searchlightCooldown - dt);
    }

    // Progressive water ingress when compartments are breached
    if (this.hullIntegrity <= 78) {
      const damageSeverity = (80 - this.hullIntegrity) / 80; // 0.025 -> 1.0
      this.waterIngressRate = 1.0 + damageSeverity * damageSeverity * 5.6;
      this.floodingPct = Math.min(100, this.floodingPct + this.waterIngressRate * dt);
    } else {
      this.waterIngressRate = 0;
    }

    const floodNorm = this.floodingPct / 100;
    this.sinkDropY = -floodNorm * 2.2;
    this.sinkPitch = -floodNorm * 0.088;
    this.sinkList = this.listDirection * floodNorm * 0.095;
    this.wheelhouseFloodLevel = floodNorm > 0.78 ? ((floodNorm - 0.78) / 0.22) * 0.14 : 0;

    // Update Ship Transforms, Crew, Wheel, Telegraph, Bow Spray & Light Rig
    this.updateShipVisualRig(dt, this.speedKnots);
    this.populateCruiseAwareness(seaMix < 0.45);
    this.ship.crewAndLifeboats.updateCruising(
      this.simTime,
      dt,
      this.floodingPct,
      this.ship.root,
      this.cruiseAwareness,
    );
    this.stepNavalCombat(dt, seaMix, 'titanic');
    this.stepWarshipConsciousness(dt, seaMix, false);
    this.emitBowSpray(dt, fwdX, fwdZ);
    this.applyAtmosphere(seaMix);
    this.oceanAndSky.update(
      this.simTime,
      this.shipX,
      this.shipZ,
      this.headingRad,
      this.speedKnots,
      seaMix,
      this.warshipX,
      this.warshipZ,
      this.warshipHeadingRad,
      this.warshipSpeedKnots,
      this.warship2X,
      this.warship2Z,
      this.warship2HeadingRad,
      this.warship2SpeedKnots,
    );

    // Seed Ice Alley once approaching open night water & spawn icebergs dynamically
    if (seaMix > 0.72) {
      if (!this.initialIceSeeded && this.icebergs.length === 0) {
        this.seedInitialIcebergs();
        this.eventText = 'ENTERING ICE ALLEY — KEEP SHARP LOOKOUT';
        this.eventTimer = 3.2;
      }
      this.manageIcebergField(dt, worldSpeed, fwdX, fwdZ);
    }

    // Check Collisions with ALL Objects (Tugs, Pilot Vessel, Lifeboats, Quay, Breakwater, Buoys, Warships, Submarines, Icebergs)
    this.checkAllObstacles(dt, fwdX, fwdZ);

    this.particles.update(dt);
    this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 1.9);

    this.updateCamera(dt);
    this.syncUnderwaterCameraEffects(seaMix, dt);
    this.sound.updateShipAmbience(this.speedKnots, true);

    // Check Sinking Trigger (Hull Breached OR Water Overwhelms Bulkheads)
    if (this.hullIntegrity <= 0 || this.floodingPct >= 100) {
      this.triggerSinking();
      return;
    }

    if (!this.endlessMode && this.distanceNm >= TARGET_VOYAGE_NM) {
      this.distanceNm = TARGET_VOYAGE_NM;
      this.score += Math.round(this.hullIntegrity * 25);
      this.phase = 'victory';
      this.saveBestScore();
      this.sound.playSteamWhistle();
      this.emitTelemetry();
      return;
    }

    // Throttled telemetry emission (~12 Hz)
    this.telemetryAccum += dt;
    if (this.telemetryAccum >= 0.08) {
      this.telemetryAccum = 0;
      this.emitTelemetry();
    }
  }

  private populateCruiseAwareness(harborNear: boolean): void {
    this.cruiseAwareness.shipRoll = this.rollAngle;
    this.cruiseAwareness.shipPitch = this.ship.bowGroup.rotation.x;
    this.cruiseAwareness.harborNear = harborNear;
    this.cruiseAwareness.hazardSide = this.closestHazardSide;
    this.cruiseAwareness.bridgeOrderActive = this.bridgeOrderTimer > 0;
    this.cruiseAwareness.autopilotActive = this.autopilotEnabled && this.phase === 'playing';
    this.cruiseAwareness.rudderDeg = this.rudderDeg;
    this.cruiseAwareness.bowPanicActive = this.bowPanicActive && this.phase === 'playing';
    if (this.orbitDistance < 12) {
      this.cruiseAwareness.playerLocalX = this.camFocusLocal.x;
      this.cruiseAwareness.playerLocalY = this.camFocusLocal.y;
      this.cruiseAwareness.playerLocalZ = this.camFocusLocal.z;
    } else {
      this.cruiseAwareness.playerLocalX = undefined;
      this.cruiseAwareness.playerLocalY = undefined;
      this.cruiseAwareness.playerLocalZ = undefined;
    }
  }

  private computeAutopilotCommand(dt: number): void {
    // 10.5-second multi-arc trajectory lookahead over 15 rudder candidates (zero per-frame GC)
    const horizonSteps = 14;
    const stepDt = 0.75;
    const rDamp = 1 - Math.exp(-5.2 * stepDt);
    const yDamp = 1 - Math.exp(-2.4 * stepDt);

    const effectiveKnots =
      Math.abs(this.speedKnots) < 2.5 ? 10 : this.speedKnots;
    const simSpeed = effectiveKnots * 2.15;
    const speedAuthority = 0.36 + 0.64 * Math.min(1, Math.abs(effectiveKnots) / 20);
    const reverseSign = effectiveKnots < -1 ? -0.65 : 1;

    const circleObs = this.harbor.root.visible ? this.harbor.getCircleObstacles() : null;
    const boxObs = this.harbor.root.visible ? this.harbor.getBoxObstacles() : null;

    let bestDeg = 0;
    let bestScore = -Infinity;
    let bestMinClearance = 999;

    const evalZones = [-72, -28, 45, 145];
    const evalRadii = [5.4, 13.4, 14.2, 13.0];

    for (let candDeg = -35; candDeg <= 35; candDeg += 5) {
      let sx = this.shipX;
      let sz = this.shipZ;
      let sh = this.headingRad;
      let syr = this.yawRate;
      let sr = this.rudderDeg;

      let minClear = 999;
      let penalty = 0;

      for (let step = 1; step <= horizonSteps; step++) {
        const tSim = step * stepDt;
        sr += (candDeg - sr) * rDamp;
        const targetYr = (sr / 35) * 0.36 * speedAuthority * reverseSign;
        syr += (targetYr - syr) * yDamp;
        sh += syr * stepDt;

        const fx = Math.sin(sh);
        const fz = -Math.cos(sh);
        sx += fx * simSpeed * stepDt;
        sz += fz * simSpeed * stepDt;

        // Check all drifting icebergs along predicted path
        for (let bIdx = 0; bIdx < this.icebergs.length; bIdx++) {
          const berg = this.icebergs[bIdx];
          const bx = berg.x + berg.vx * tSim;
          const bz = berg.z + berg.vz * tSim;
          const req = berg.collisionRadius + 16.5;

          for (let h = 0; h < 4; h++) {
            const px = sx + fx * -evalZones[h];
            const pz = sz + fz * -evalZones[h];
            const dist = Math.hypot(px - bx, pz - bz);
            const clear = dist - (berg.collisionRadius + evalRadii[h]);
            if (clear < minClear) minClear = clear;
            if (dist < req + evalRadii[h]) {
              const deficit = req + evalRadii[h] - dist;
              penalty += clear < 5 ? 90000 + deficit * 4500 : deficit * 260;
            }
          }
        }

        // Check Southampton Harbor obstacles & channel walls when harbor is active
        if (circleObs && boxObs) {
          for (let ci = 0; ci < circleObs.length; ci++) {
            const obs = circleObs[ci];
            const dist = Math.hypot(sx + fx * 42 - obs.x, sz + fz * 42 - obs.z);
            const clear = dist - (obs.radius + 14.2);
            if (clear < minClear) minClear = clear;
            if (clear < 12) {
              penalty += (12 - clear) * (clear < 2 ? 60000 : 280);
            }
          }
          for (let bi = 0; bi < boxObs.length; bi++) {
            const box = boxObs[bi];
            for (let h = 0; h < 4; h++) {
              const px = sx + fx * -evalZones[h];
              const pz = sz + fz * -evalZones[h];
              const cx = THREE.MathUtils.clamp(px, box.minX, box.maxX);
              const cz = THREE.MathUtils.clamp(pz, box.minZ, box.maxZ);
              const dist = Math.hypot(px - cx, pz - cz);
              const clear = dist - evalRadii[h];
              if (clear < minClear) minClear = clear;
              if (clear < 8) {
                penalty += (8 - clear) * (clear < 1.5 ? 75000 : 340);
              }
            }
          }
        }

        // Check Royal Navy escort warships predicted hull positions & incoming torpedoes
        const wSimSpd = this.warshipSpeedKnots * 2.15;
        const wxPred = this.warshipX + Math.sin(this.warshipHeadingRad) * wSimSpd * tSim;
        const wzPred = this.warshipZ - Math.cos(this.warshipHeadingRad) * wSimSpd * tSim;
        const w2SimSpd = this.warship2SpeedKnots * 2.15;
        const w2xPred = this.warship2X + Math.sin(this.warship2HeadingRad) * w2SimSpd * tSim;
        const w2zPred = this.warship2Z - Math.cos(this.warship2HeadingRad) * w2SimSpd * tSim;
        for (let h = 0; h < 4; h++) {
          const px = sx + fx * -evalZones[h];
          const pz = sz + fz * -evalZones[h];
          const dist1 = Math.hypot(px - wxPred, pz - wzPred);
          const clear1 = dist1 - (16 + evalRadii[h]);
          if (clear1 < minClear) minClear = clear1;
          if (clear1 < 14) {
            penalty += (14 - clear1) * (clear1 < 2 ? 70000 : 260);
          }

          const dist2 = Math.hypot(px - w2xPred, pz - w2zPred);
          const clear2 = dist2 - (16 + evalRadii[h]);
          if (clear2 < minClear) minClear = clear2;
          if (clear2 < 14) {
            penalty += (14 - clear2) * (clear2 < 2 ? 70000 : 260);
          }
        }

        for (let pi = 0; pi < MAX_NAVAL_PROJECTILES; pi++) {
          const proj = this.projectiles[pi];
          if (!proj.active || proj.kind !== 'torpedo') continue;
          const ptx = proj.x + proj.vx * tSim;
          const ptz = proj.z + proj.vz * tSim;
          for (let h = 0; h < 4; h++) {
            const px = sx + fx * -evalZones[h];
            const pz = sz + fz * -evalZones[h];
            const dist = Math.hypot(px - ptx, pz - ptz);
            const clear = dist - (6 + evalRadii[h]);
            if (clear < minClear) minClear = clear;
            if (clear < 12) {
              penalty += (12 - clear) * (clear < 2 ? 55000 : 240);
            }
          }
        }
      }

      // Keep northbound heading biased cleanly & avoid unnecessary helm oscillation
      let normH = sh % (Math.PI * 2);
      if (normH > Math.PI) normH -= Math.PI * 2;
      if (normH < -Math.PI) normH += Math.PI * 2;

      const channelBias = this.harbor.root.visible && this.shipZ > -560 ? Math.abs(sx) * 0.22 : 0;
      const headingPenalty = Math.abs(normH) * 42;
      const smoothnessPenalty = Math.abs(candDeg - this.autopilotTargetRudder) * 0.45;
      const clearanceBonus = Math.min(60, minClear) * 1.8;

      const score = clearanceBonus - penalty - headingPenalty - channelBias - smoothnessPenalty;
      if (score > bestScore) {
        bestScore = score;
        bestDeg = candDeg;
        bestMinClearance = minClear;
      }
    }

    this.autopilotTargetRudder = bestDeg;

    // Intelligent Wheelhouse Telegraph Management (slows for tight turns, cruises at Full Ahead when clear)
    if (this.autopilotSpeedCooldown > 0) {
      this.autopilotSpeedCooldown = Math.max(0, this.autopilotSpeedCooldown - dt);
    } else {
      let desiredNotch = this.nightMix < 0.35 ? 3 : 4; // HALF AHEAD in channel, FULL AHEAD at sea
      if (bestMinClearance < 8) {
        desiredNotch = 1; // ALL STOP to prevent impact if crowded
      } else if (bestMinClearance < 18) {
        desiredNotch = 2; // SLOW AHEAD for maximum turning tightness
      } else if (bestMinClearance < 28) {
        desiredNotch = 3; // HALF AHEAD
      }
      if (this.telegraphIndex <= 1 && bestMinClearance >= 14) {
        desiredNotch = Math.max(desiredNotch, 3);
      }

      if (desiredNotch !== this.telegraphIndex) {
        this.telegraphIndex = desiredNotch;
        this.autopilotSpeedCooldown = 1.65;
        this.bridgeOrderTimer = 1.6;
        this.sound.playTelegraphBell();
      }
    }
  }

  private applyAtmosphere(nightMix: number, dawnBoost = 0): void {
    const n = THREE.MathUtils.clamp(nightMix, 0, 1);
    this.nightMix = n;
    const sunsetWeight = Math.sin(n * Math.PI);

    // Sky & Fog color interpolation: April Noon -> Golden Atlantic Sunset -> Arctic Midnight
    this.tempColorA.setHex(0x9ec4db);
    this.tempColorB.setHex(0x091628);
    this.tempSkyColor.copy(this.tempColorA).lerp(this.tempColorB, THREE.MathUtils.smoothstep(n, 0.15, 0.9));
    if (sunsetWeight > 0.01) {
      this.tempColorA.setHex(0x9f5a3f);
      this.tempSkyColor.lerp(this.tempColorA, sunsetWeight * 0.72);
    }
    if (dawnBoost > 0.005) {
      this.tempColorA.setHex(0x162b4d);
      this.tempSkyColor.lerp(this.tempColorA, THREE.MathUtils.clamp(dawnBoost, 0, 1));
    }

    (this.scene.background as THREE.Color).copy(this.tempSkyColor);
    this.sceneFog.color.copy(this.tempSkyColor);
    this.sceneFog.density = THREE.MathUtils.lerp(0.00095, 0.0021, n);

    // Hemisphere Light
    this.tempColorA.setHex(0xcce7ff);
    this.tempColorB.setHex(0x88b8ea);
    this.hemiLight.color.copy(this.tempColorA).lerp(this.tempColorB, n);
    if (sunsetWeight > 0.01) {
      this.tempColorA.setHex(0xe8a47c);
      this.hemiLight.color.lerp(this.tempColorA, sunsetWeight * 0.55);
    }
    this.tempColorA.setHex(0x4d5a4f);
    this.tempColorB.setHex(0x091422);
    this.hemiLight.groundColor.copy(this.tempColorA).lerp(this.tempColorB, n);
    this.hemiLight.intensity = THREE.MathUtils.lerp(1.18, 0.82, n);

    // Directional Sun-to-Moon Key Light
    this.tempColorA.setHex(0xfff3d8);
    this.tempColorB.setHex(0xcde4ff);
    this.moonKeyLight.color.copy(this.tempColorA).lerp(this.tempColorB, n);
    if (sunsetWeight > 0.01) {
      this.tempColorA.setHex(0xff9248);
      this.moonKeyLight.color.lerp(this.tempColorA, sunsetWeight * 0.78);
    }
    this.moonKeyLight.intensity = THREE.MathUtils.lerp(2.85, 2.35, n);

    // Rim Fill Light
    this.tempColorA.setHex(0x9bc4e8);
    this.tempColorB.setHex(0x4b77a8);
    this.rimLight.color.copy(this.tempColorA).lerp(this.tempColorB, n);
    this.rimLight.intensity = THREE.MathUtils.lerp(0.85, 0.72, n);

    // Keep ship wheelhouse dials softly lit by day and full warm glow by night
    if (this.phase !== 'sinking' && this.phase !== 'aftermath' && this.phase !== 'gameover') {
      this.ship.setPowerLevel(THREE.MathUtils.lerp(0.28, 1.0, THREE.MathUtils.smoothstep(n, 0.25, 0.85)));
    }
  }

  private stepInteriorWalk(dt: number): void {
    const spec = VESSEL_SPOTS[this.focusSpotIndex];
    if (!spec.walkBounds) return;

    const walkFwd = (this.heldKeys.has('KeyI') ? 1 : 0) - (this.heldKeys.has('KeyK') ? 1 : 0);
    const walkStrafe = (this.heldKeys.has('KeyL') ? 1 : 0) - (this.heldKeys.has('KeyJ') ? 1 : 0);
    if (walkFwd === 0 && walkStrafe === 0) return;

    // Walk relative to horizontal camera look direction in ship-local XZ plane
    const lookLocalX = -Math.sin(this.orbitYaw);
    const lookLocalZ = -Math.cos(this.orbitYaw);
    const rightLocalX = Math.cos(this.orbitYaw);
    const rightLocalZ = -Math.sin(this.orbitYaw);

    const moveSpeed = 5.4;
    let vx = lookLocalX * walkFwd + rightLocalX * walkStrafe;
    let vz = lookLocalZ * walkFwd + rightLocalZ * walkStrafe;
    const len = Math.hypot(vx, vz) || 1;
    vx /= len;
    vz /= len;

    this.interiorWalkOffset.x += vx * moveSpeed * dt;
    this.interiorWalkOffset.z += vz * moveSpeed * dt;

    const minOffX = spec.walkBounds.minX - spec.localTarget[0];
    const maxOffX = spec.walkBounds.maxX - spec.localTarget[0];
    const minOffZ = spec.walkBounds.minZ - spec.localTarget[2];
    const maxOffZ = spec.walkBounds.maxZ - spec.localTarget[2];
    this.interiorWalkOffset.x = THREE.MathUtils.clamp(this.interiorWalkOffset.x, minOffX, maxOffX);
    this.interiorWalkOffset.z = THREE.MathUtils.clamp(this.interiorWalkOffset.z, minOffZ, maxOffZ);
  }

  private syncUnderwaterCameraEffects(nightMix: number, dt: number): void {
    const spec = VESSEL_SPOTS[this.focusSpotIndex];
    const insideDryCompartment =
      this.phase !== 'sinking' &&
      (spec.id === 'dining' || spec.id === 'engine' || spec.id === 'staircase') &&
      this.orbitDistance < 12 &&
      this.floodingPct < 80;

    const waveY = sampleOceanWaveHeight(this.camera.position.x, this.camera.position.z, this.simTime);
    const depthBelowWave = insideDryCompartment ? -1.0 : waveY - this.camera.position.y;
    const underwaterMix = THREE.MathUtils.clamp((depthBelowWave + 0.14) / 0.48, 0, 1);

    this.oceanAndSky.updateCameraView(this.camera.position, underwaterMix);
    this.ship.setWheelhouseFloodLevel(this.wheelhouseFloodLevel, 1 - underwaterMix);

    if (underwaterMix > 0.005) {
      const depthNorm = THREE.MathUtils.clamp(Math.max(0, depthBelowWave) / 45, 0, 1);
      // Cold North Atlantic underwater teal-navy transition (brighter cyan by day, deep arctic teal by night)
      this.tempColorA.setHex(nightMix < 0.5 ? 0x0b435c : 0x052638);
      this.tempColorB.setHex(0x02111e);
      this.tempColorA.lerp(this.tempColorB, depthNorm);

      (this.scene.background as THREE.Color).lerp(this.tempColorA, underwaterMix);
      this.sceneFog.color.copy(this.scene.background as THREE.Color);

      const targetUnderDensity = THREE.MathUtils.lerp(0.015, 0.024, depthNorm);
      this.sceneFog.density = THREE.MathUtils.lerp(this.sceneFog.density, targetUnderDensity, underwaterMix);

      // Filtered aqua ambient light underwater so wheelhouse, hull & ice remain clearly readable
      this.tempColorA.setHex(nightMix < 0.5 ? 0x5fb4d4 : 0x2f7594);
      this.hemiLight.color.lerp(this.tempColorA, underwaterMix * 0.88);
      this.tempColorA.setHex(0x020c14);
      this.hemiLight.groundColor.lerp(this.tempColorA, underwaterMix * 0.9);
      this.hemiLight.intensity = THREE.MathUtils.lerp(this.hemiLight.intensity, 1.12 - depthNorm * 0.22, underwaterMix);

      this.tempColorA.setHex(0x7cc8e6);
      this.moonKeyLight.color.lerp(this.tempColorA, underwaterMix * 0.72);
      this.moonKeyLight.intensity *= 1 - underwaterMix * (0.28 + depthNorm * 0.35);

      // Emit rising air bubbles outside the submerged cockpit/bow during sinking
      if (this.phase === 'sinking' && underwaterMix > 0.15 && dt > 0 && Math.random() < 0.65) {
        const camX = this.camera.position.x;
        const camY = this.camera.position.y;
        const camZ = this.camera.position.z;
        this.particles.emit(
          camX + (Math.random() - 0.5) * 14,
          camY - 2.5 + Math.random() * 4.5,
          camZ + (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 1.4,
          2.2 + Math.random() * 2.8,
          (Math.random() - 0.5) * 1.4,
          0.14 + Math.random() * 0.24,
          1.4 + Math.random() * 0.9,
          -3.6,
          0xbfe9ff,
        );
      }
    }
  }

  private triggerSinking(): void {
    this.hullIntegrity = Math.max(0, this.hullIntegrity);
    this.floodingPct = 100;
    this.waterIngressRate = 0;
    this.autopilotEnabled = false;
    this.phase = 'sinking';
    this.sinkProgress = 0;
    this.hasBrokenInTwo = false;
    this.autoFocusedBreakup = false;
    this.telegraphIndex = 1; // ALL STOP
    this.heldKeys.clear();
    this.icebergWarning = null;
    this.eventText = 'WATER OVERWHELMING BULKHEADS — BOW SUBMERGING';
    this.eventTimer = 5.5;
    this.groanCooldown = 0.3;
    this.sound.playHullGroan(1.0);
    this.sound.playSteamWhistle();
    this.emitTelemetry();
  }

  private stepSinkingSequence(dt: number): void {
    // ~24-second multi-stage dramatic sinking: Bow plunge -> Midships fracture -> Bow dives -> Stern vertical plunge
    this.sinkProgress = Math.min(1, this.sinkProgress + dt / 24.0);
    const p = this.sinkProgress;

    // Engines stop & forward momentum bleeds off as bow buries into sea
    this.speedKnots = THREE.MathUtils.damp(this.speedKnots, 0, 0.7, dt);
    const fwdX = Math.sin(this.headingRad);
    const fwdZ = -Math.cos(this.headingRad);
    const rightX = Math.cos(this.headingRad);
    const rightZ = Math.sin(this.headingRad);
    const worldSpeed = this.speedKnots * 1.3;
    this.shipX += fwdX * worldSpeed * dt;
    this.shipZ += fwdZ * worldSpeed * dt;

    // =========================================================================
    // STAGE 1 (0.00 -> 0.40): Intact hull plunges bow-first while stern rises
    // STAGE 2 (0.40): Hull snaps in two at BREAK_Z = 90 between Funnels #3 & #4
    // STAGE 3 (0.40 -> 0.72): Bow section dives deep; Stern slams back & floods
    // STAGE 4 (0.72 -> 1.00): Stern rears ~83 deg vertical & sinks completely
    // =========================================================================
    if (p < 0.4) {
      const s1 = p / 0.4;
      const e1 = s1 * s1 * (3 - 2 * s1);
      this.sinkPitch = THREE.MathUtils.lerp(-0.088, -0.34, e1);
      this.sinkDropY = THREE.MathUtils.lerp(-2.2, -26.5, Math.pow(s1, 1.15));
      this.sinkList = this.listDirection * (0.095 + e1 * 0.065);

      const hingeY = this.sinkDropY - BREAK_Z * Math.sin(this.sinkPitch);
      this.ship.bowGroup.position.y = hingeY;
      this.ship.bowGroup.rotation.x = this.sinkPitch;
      this.ship.sternGroup.position.y = hingeY;
      this.ship.sternGroup.rotation.x = this.sinkPitch;
    } else {
      if (!this.hasBrokenInTwo) {
        this.hasBrokenInTwo = true;
        this.ship.setBreakupVisual(true, 1.35);
        this.sound.playBreakupSnap();
        this.shakeIntensity = 1.0;
        this.eventText = 'HULL FRACTURING AT MIDSHIPS — TITANIC BREAKS IN TWO';
        this.eventTimer = 5.0;

        // Explosive burst of steam, sparks & torn spray at the fracture plane (z = BREAK_Z)
        const breakWorldX = this.shipX - fwdX * BREAK_Z;
        const breakWorldZ = this.shipZ - fwdZ * BREAK_Z;
        for (let i = 0; i < 42; i++) {
          const isSpark = i < 14;
          this.particles.emit(
            breakWorldX + (Math.random() - 0.5) * 18,
            4.5 + Math.random() * 14,
            breakWorldZ + (Math.random() - 0.5) * 18,
            (Math.random() - 0.5) * 12,
            4.0 + Math.random() * 10,
            (Math.random() - 0.5) * 12,
            isSpark ? 0.42 : 1.4 + Math.random() * 1.5,
            isSpark ? 0.65 : 1.5 + Math.random() * 0.9,
            isSpark ? 14.0 : 4.2,
            isSpark ? 0xffb347 : 0xdbeafe,
          );
        }

        const inCockpit = VESSEL_SPOTS[this.focusSpotIndex].id === 'wheelhouse';
        if (!inCockpit && !this.userAdjustedCameraInSink && !this.autoFocusedBreakup) {
          this.autoFocusedBreakup = true;
          this.focusVesselSpot('funnels', false);
        }
      }

      // 1) Forward Bow Section breaks free & plunges deep into the abyss (0.40 -> 0.74)
      const bowT = THREE.MathUtils.clamp((p - 0.4) / 0.34, 0, 1);
      const eBow = bowT * bowT * (3 - 2 * bowT);
      this.ship.bowGroup.rotation.x = THREE.MathUtils.lerp(-0.34, -0.78, eBow);
      this.ship.bowGroup.position.y = THREE.MathUtils.lerp(3.53, -76.0, Math.pow(bowT, 1.18));

      // 2) Stern Section violently slams back down (0.40 -> 0.55), then tilts vertical & plunges completely (0.55 -> 1.00)
      if (p < 0.55) {
        const settleT = (p - 0.4) / 0.15;
        const eSettle = Math.sin(settleT * Math.PI * 0.5);
        this.ship.sternGroup.rotation.x = THREE.MathUtils.lerp(-0.34, -0.05, eSettle);
        this.ship.sternGroup.position.y = THREE.MathUtils.lerp(3.53, -3.2, eSettle);
        this.sinkList = this.listDirection * THREE.MathUtils.lerp(0.16, 0.08, eSettle);
      } else if (p < 0.78) {
        const tiltT = (p - 0.55) / 0.23;
        const eTilt = tiltT * tiltT * (3 - 2 * tiltT);
        this.ship.sternGroup.rotation.x = THREE.MathUtils.lerp(-0.05, -1.38, eTilt);
        this.ship.sternGroup.position.y = THREE.MathUtils.lerp(-3.2, -56.0, eTilt);
        this.sinkList = this.listDirection * THREE.MathUtils.lerp(0.08, 0.03, eTilt);

        if (p > 0.68 && this.eventTimer <= 0.5) {
          this.eventText = 'STERN RISING VERTICAL — FINAL PLUNGE';
          this.eventTimer = 4.0;
        }
      } else {
        const plungeT = (p - 0.78) / 0.22;
        this.ship.sternGroup.rotation.x = THREE.MathUtils.lerp(-1.38, -1.46, plungeT);
        this.ship.sternGroup.position.y = THREE.MathUtils.lerp(-56.0, -138.0, Math.pow(plungeT, 1.12));
        this.sinkList = this.listDirection * THREE.MathUtils.lerp(0.03, 0.0, plungeT);
      }

      // Interior break-cap embers dim as water floods the open bulkheads
      const emberFade = Math.max(0, 1 - (p - 0.4) / 0.16);
      this.ship.setBreakupVisual(true, emberFade * 1.35);
    }

    // Rising cold Atlantic floodwater inside the wheelhouse
    const whFlood = THREE.MathUtils.clamp((p - 0.05) / 0.34, 0, 1);
    this.wheelhouseFloodLevel = whFlood;

    // Boiler room flooding causes bridge dynamos to flicker & fail completely shortly after breakup
    if (p < 0.34) {
      this.powerLevel = 1.0 - p * 0.45;
    } else if (p < 0.56) {
      const fade = 1 - (p - 0.34) / 0.22;
      const flicker = 0.3 + 0.7 * Math.abs(Math.sin(this.simTime * 31) * Math.cos(this.simTime * 19));
      this.powerLevel = fade * flicker;
    } else {
      this.powerLevel = 0;
    }
    this.ship.setPowerLevel(this.powerLevel);

    // Periodic hull steel groans & rushing water ambience
    this.groanCooldown -= dt;
    if (this.groanCooldown <= 0 && p < 0.88) {
      this.groanCooldown = 2.4 + Math.random() * 1.4;
      this.sound.playHullGroan(0.75 + p * 0.25);
    }
    this.sound.updateSinkingAmbience(p);

    // Churning white foam & trapped air bursts along submerging bow, break zone & plunging stern
    if (Math.random() < 0.88) {
      const along =
        p < 0.4
          ? THREE.MathUtils.lerp(70, -110, p / 0.4)
          : p < 0.74
            ? THREE.MathUtils.lerp(-35, -145, (p - 0.4) / 0.34)
            : THREE.MathUtils.lerp(-105, -185, (p - 0.74) / 0.26);
      const jitterAlong = along + (Math.random() - 0.5) * 32;
      const sideOff = (Math.random() - 0.5) * 24;
      this.particles.emit(
        this.shipX + fwdX * jitterAlong + rightX * sideOff,
        0.35 + Math.random() * 1.6,
        this.shipZ + fwdZ * jitterAlong + rightZ * sideOff,
        (Math.random() - 0.5) * 5.0,
        2.6 + Math.random() * 5.2,
        (Math.random() - 0.5) * 5.0,
        0.85 + Math.random() * 1.4,
        0.85 + Math.random() * 0.7,
        6.2,
        Math.random() < 0.4 ? 0xe0f2fe : 0x9bd7f5,
      );
    }

    this.updateShipVisualRig(dt, this.speedKnots);
    this.lifeboatsLaunched = this.ship.crewAndLifeboats.updateSinking(
      this.simTime,
      dt,
      p,
      this.ship.root,
    );

    // Pull exterior cameras to Boat Deck / Full Ship if user wasn't in the wheelhouse cockpit
    const inCockpit = VESSEL_SPOTS[this.focusSpotIndex].id === 'wheelhouse';
    if (!inCockpit && !this.userAdjustedCameraInSink && !this.autoFocusedSinkLifeboats && p > 0.08) {
      this.autoFocusedSinkLifeboats = true;
      this.focusVesselSpot('funnels', false);
    }

    this.stepNavalCombat(dt, 1.0, 'titanic');
    this.stepWarshipConsciousness(dt, 1.0, true);
    this.applyAtmosphere(1.0);
    this.oceanAndSky.update(
      this.simTime,
      this.shipX,
      this.shipZ,
      this.headingRad,
      this.speedKnots,
      1.0,
      this.warshipX,
      this.warshipZ,
      this.warshipHeadingRad,
      this.warshipSpeedKnots,
      this.warship2X,
      this.warship2Z,
      this.warship2HeadingRad,
      this.warship2SpeedKnots,
    );
    this.particles.update(dt);
    this.shakeIntensity = Math.max(0.06 * (1 - p), this.shakeIntensity - dt * 1.4);
    this.updateCamera(dt);
    this.syncUnderwaterCameraEffects(1.0, dt);

    if (this.sinkProgress >= 1) {
      this.enterAftermath();
      return;
    }

    this.telemetryAccum += dt;
    if (this.telemetryAccum >= 0.08) {
      this.telemetryAccum = 0;
      this.emitTelemetry();
    }
  }

  private emitRescueFlare(worldX: number, worldZ: number, colorHex: number): void {
    for (let i = 0; i < 16; i++) {
      this.particles.emit(
        worldX + (Math.random() - 0.5) * 1.6,
        1.2,
        worldZ + (Math.random() - 0.5) * 1.6,
        (Math.random() - 0.5) * 2.4,
        24.0 + Math.random() * 14.0,
        (Math.random() - 0.5) * 2.4,
        0.55 + Math.random() * 0.45,
        1.4 + Math.random() * 0.9,
        9.8,
        colorHex,
      );
    }
    this.sound.playRescueFlare();
  }

  private advanceRescueSimulation(dt: number): void {
    const WAIT_SEC = 60.0;
    const APPROACH_SEC = 34.0;
    const BOARDING_SEC = 40.0;

    this.aftermathSeconds += dt;
    const t = this.aftermathSeconds;

    const fwdX = Math.sin(this.headingRad);
    const fwdZ = -Math.cos(this.headingRad);
    const rightX = Math.cos(this.headingRad);
    const rightZ = Math.sin(this.headingRad);

    let carpLocalX = -220;
    let carpLocalZ = -420;
    let carpLocalYaw = 0.35;
    let boardingProgress = 0;
    let laddersDeployed = false;
    let sweepLight = false;

    // Royal Navy Escort Warship closes in to port side of lifeboats and carries out immediate rescue
    const warshipStandX = this.shipX - rightX * 84 - fwdX * 16;
    const warshipStandZ = this.shipZ - rightZ * 84 - fwdZ * 16;
    const warshipDist = Math.hypot(warshipStandX - this.warshipX, warshipStandZ - this.warshipZ);
    if (!this.warshipRescuing && t >= 10.0 && (warshipDist < 68 || t >= 16.0)) {
      this.warshipRescuing = true;
      if (!this.warshipRescueWhistlePlayed) {
        this.warshipRescueWhistlePlayed = true;
        this.sound.playCarpathiaWhistle();
        this.eventText = 'ESCORT WARSHIP ON STATION — LOWERING BOARDING LADDERS';
        this.eventTimer = 5.0;
        if (this.aftermathFocus === 'lifeboats' && this.carpathiaStage === 'waiting') {
          this.focusAftermathTarget('warship');
        }
      }
    }
    if (this.warshipRescuing) {
      this.warshipRescueProgress = Math.min(1, this.warshipRescueProgress + dt / 36.0);
    }

    if (t < WAIT_SEC) {
      this.carpathiaStage = 'waiting';
      this.carpathia.root.visible = false;
      this.carpathiaDistanceM = 460;

      // Periodic distress flares fired from remaining waiting lifeboats during the 1-minute vigil
      this.flareCooldown -= dt;
      if (this.flareCooldown <= 0) {
        this.flareCooldown = 11.5;
        const boat = this.ship.crewAndLifeboats.lifeboats[Math.floor(Math.random() * 8) * 2 + 1];
        boat.boatGroup.getWorldPosition(_vFocusWorld);
        this.emitRescueFlare(_vFocusWorld.x, _vFocusWorld.z, 0xd9f99d);
      }
    } else if (t < WAIT_SEC + APPROACH_SEC) {
      this.carpathiaStage = 'approaching';
      const u = THREE.MathUtils.clamp((t - WAIT_SEC) / APPROACH_SEC, 0, 1);
      // Slow, stately Cunard deceleration curve toward the lifeboat cluster
      const easeOut = 1 - Math.pow(1 - u, 2.3);
      carpLocalX = THREE.MathUtils.lerp(-220, 0, easeOut);
      carpLocalZ = THREE.MathUtils.lerp(-420, 56, easeOut);
      carpLocalYaw = THREE.MathUtils.lerp(0.48, 0.22, easeOut);
      this.carpathiaDistanceM = Math.round(Math.hypot(carpLocalX, carpLocalZ - 56));
      sweepLight = true;

      this.carpathia.root.visible = true;
      if (!this.carpathiaWhistlePlayed) {
        this.carpathiaWhistlePlayed = true;
        this.sound.playCarpathiaWhistle();
        this.eventText = 'RMS CARPATHIA SIGHTED ON THE HORIZON';
        this.eventTimer = 5.5;
        // Signal green answer rocket from Carpathia
        const wx = this.shipX + rightX * carpLocalX + fwdX * -carpLocalZ;
        const wz = this.shipZ + rightZ * carpLocalX + fwdZ * -carpLocalZ;
        this.emitRescueFlare(wx, wz, 0x6ee7b7);
        this.focusAftermathTarget('carpathia');
      }

      // Gentle predawn sky lift as rescue liner arrives
      this.rescueDawnMix = easeOut * 0.22;

      // Subtle bow spray & red funnel coal wisps while moving slowly
      if (u < 0.85 && Math.random() < 0.45) {
        const bx = this.shipX + rightX * carpLocalX + fwdX * -carpLocalZ;
        const bz = this.shipZ + rightZ * carpLocalX + fwdZ * -carpLocalZ;
        this.particles.emit(
          bx + (Math.random() - 0.5) * 4,
          26.5,
          bz + (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 2.0,
          2.2 + Math.random() * 1.2,
          (Math.random() - 0.5) * 2.0,
          1.4,
          2.1,
          -0.6,
          0x2d3644,
        );
      }
    } else if (t < WAIT_SEC + APPROACH_SEC + BOARDING_SEC) {
      if (this.carpathiaStage !== 'boarding') {
        this.carpathiaStage = 'boarding';
        this.sound.playCarpathiaWhistle();
        this.eventText = 'CARPATHIA ALL STOP — JOINT RESCUE BOARDING UNDERWAY';
        this.eventTimer = 5.0;
      }
      carpLocalX = 0;
      carpLocalZ = 56;
      carpLocalYaw = 0.22;
      this.carpathiaDistanceM = 0;
      laddersDeployed = true;
      sweepLight = true;
      this.carpathia.root.visible = true;
      this.rescueDawnMix = 0.22;
      boardingProgress = THREE.MathUtils.clamp((t - WAIT_SEC - APPROACH_SEC) / BOARDING_SEC, 0, 1);
    } else {
      if (this.carpathiaStage !== 'complete') {
        this.carpathiaStage = 'complete';
        if (!this.rescueCompleteWhistlePlayed) {
          this.rescueCompleteWhistlePlayed = true;
          this.sound.playCarpathiaWhistle();
        }
        this.eventText = 'RESCUE COMPLETE — ALL 712 SURVIVORS ABOARD WARSHIP & CARPATHIA';
        this.eventTimer = 7.0;
      }
      carpLocalX = 0;
      carpLocalZ = 56;
      carpLocalYaw = 0.22;
      this.carpathiaDistanceM = 0;
      laddersDeployed = true;
      sweepLight = false;
      this.carpathia.root.visible = true;
      this.rescueDawnMix = 0.22;
      boardingProgress = 1.0;
    }

    if (this.carpathia.root.visible) {
      const baseWorldX = this.shipX + rightX * carpLocalX + fwdX * -carpLocalZ;
      const baseWorldZ = this.shipZ + rightZ * carpLocalX + fwdZ * -carpLocalZ;

      // Conscious iceberg avoidance steering during Carpathia's night approach
      let targetAvoidX = 0;
      let targetAvoidZ = 0;
      if (this.carpathiaStage === 'approaching') {
        const approachU = THREE.MathUtils.clamp((t - WAIT_SEC) / APPROACH_SEC, 0, 1);
        const fadeOut = 1 - THREE.MathUtils.smoothstep(approachU, 0.72, 1.0);
        if (fadeOut > 0.01) {
          for (let i = 0; i < this.icebergs.length; i++) {
            const b = this.icebergs[i];
            const dx = baseWorldX + this.carpathiaAvoidX - b.x;
            const dz = baseWorldZ + this.carpathiaAvoidZ - b.z;
            const dist = Math.hypot(dx, dz);
            const safeDist = b.collisionRadius + 36;
            if (dist < safeDist && dist > 0.05) {
              const push = ((safeDist - dist) / safeDist) * 32 * fadeOut;
              targetAvoidX += (dx / dist) * push;
              targetAvoidZ += (dz / dist) * push;
            }
          }
        }
      }

      this.carpathiaAvoidX = THREE.MathUtils.damp(this.carpathiaAvoidX, targetAvoidX, 1.8, dt);
      this.carpathiaAvoidZ = THREE.MathUtils.damp(this.carpathiaAvoidZ, targetAvoidZ, 1.8, dt);
      const steerLateral = this.carpathiaAvoidX * rightX + this.carpathiaAvoidZ * rightZ;
      this.carpathiaSteerYaw = THREE.MathUtils.damp(
        this.carpathiaSteerYaw,
        THREE.MathUtils.clamp(-steerLateral * 0.014, -0.32, 0.32),
        2.0,
        dt,
      );

      const carpWorldX = baseWorldX + this.carpathiaAvoidX;
      const carpWorldZ = baseWorldZ + this.carpathiaAvoidZ;
      const waveY = Math.sin(this.simTime * 0.85) * 0.14;
      const wavePitch = Math.sin(this.simTime * 0.72) * 0.008;
      const waveRoll = Math.cos(this.simTime * 0.62) * 0.012 - this.carpathiaSteerYaw * 0.08;
      this.carpathia.root.position.set(carpWorldX, waveY, carpWorldZ);
      this.carpathia.root.rotation.set(
        wavePitch,
        -this.headingRad + carpLocalYaw + this.carpathiaSteerYaw,
        waveRoll,
      );
    }

    const rescueRes = this.ship.crewAndLifeboats.updateRescue(
      this.simTime,
      dt,
      this.carpathiaStage,
      boardingProgress,
      this.carpathia.root,
      this.carpathia.boardingStationsLocal,
      this.ship.root,
      {
        active: this.warshipRescuing,
        progress: this.warshipRescueProgress,
        root: this.warship.root,
        boardingStationsLocal: this.warship.boardingStationsLocal,
      },
    );
    this.boatsRecovered = rescueRes.boatsRecovered;
    this.survivorsRescued = rescueRes.survivorsRescued;
    this.warshipBoatsRecovered = rescueRes.warshipBoatsRecovered;
    this.warshipSurvivors = rescueRes.warshipSurvivorsRescued;
    this.lifeboatsLaunched = 16;

    if (this.carpathia.root.visible) {
      this.carpathia.setRescueState(
        this.simTime,
        rescueRes.carpathiaSurvivorsRescued / 356,
        laddersDeployed,
        sweepLight,
      );
    }
  }

  private stepAftermathSequence(dt: number): void {
    this.ship.hullMeshGroup.visible = false;
    this.speedKnots = THREE.MathUtils.damp(this.speedKnots, 0, 1.5, dt);

    const fwdX = Math.sin(this.headingRad);
    const fwdZ = -Math.cos(this.headingRad);
    const rightX = Math.cos(this.headingRad);
    const rightZ = Math.sin(this.headingRad);

    // Gentle residual bubbles over Titanic's resting spot for the first 35 seconds
    if (this.aftermathSeconds < 35 && Math.random() < 0.38) {
      const along = -95 - Math.random() * 85;
      const sideOff = (Math.random() - 0.5) * 26;
      this.particles.emit(
        this.shipX + fwdX * along + rightX * sideOff,
        0.25,
        this.shipZ + fwdZ * along + rightZ * sideOff,
        (Math.random() - 0.5) * 2.2,
        1.5 + Math.random() * 2.8,
        (Math.random() - 0.5) * 2.2,
        0.75 + Math.random() * 0.9,
        1.1 + Math.random() * 0.6,
        3.5,
        0xbfe3f7,
      );
    }

    this.advanceRescueSimulation(dt);
    this.stepNavalCombat(dt, 1.0, 'carpathia');
    this.stepWarshipConsciousness(dt, 1.0, true);
    this.applyAtmosphere(1.0, this.rescueDawnMix);
    this.oceanAndSky.update(
      this.simTime,
      this.shipX,
      this.shipZ,
      this.headingRad,
      0,
      1.0,
      this.warshipX,
      this.warshipZ,
      this.warshipHeadingRad,
      this.warshipSpeedKnots,
      this.warship2X,
      this.warship2Z,
      this.warship2HeadingRad,
      this.warship2SpeedKnots,
    );
    this.particles.update(dt);
    this.updateCamera(dt);
    this.syncUnderwaterCameraEffects(1.0, dt);
    this.sound.updateShipAmbience(this.carpathiaStage === 'approaching' ? 6 : 0, false);

    this.telemetryAccum += dt;
    if (this.telemetryAccum >= 0.12) {
      this.telemetryAccum = 0;
      this.emitTelemetry();
    }
  }

  private updateShipVisualRig(dt: number, speedKnots: number): void {
    this.ship.root.position.set(this.shipX, 0, this.shipZ);
    this.ship.root.rotation.y = -this.headingRad;

    // Gentle North Atlantic swell pitch + roll + turning heel + flooding trim
    const wavePitch = Math.sin(this.simTime * 0.95) * 0.008 + Math.cos(this.simTime * 0.55) * 0.004;
    const waveRoll = Math.sin(this.simTime * 0.72) * 0.011;
    const turnHeel = -this.yawRate * 0.14;
    this.rollAngle = THREE.MathUtils.damp(this.rollAngle, waveRoll + turnHeel + this.sinkList, 4, dt);

    if (this.phase !== 'sinking' && this.phase !== 'aftermath' && this.phase !== 'gameover') {
      const totalPitch = wavePitch + this.sinkPitch;
      const hingeY = this.sinkDropY - BREAK_Z * Math.sin(totalPitch);
      const dampedY = THREE.MathUtils.damp(this.ship.bowGroup.position.y, hingeY, 3.5, dt);
      const dampedPitch = THREE.MathUtils.damp(this.ship.bowGroup.rotation.x, totalPitch, 3.5, dt);
      this.ship.bowGroup.position.y = dampedY;
      this.ship.bowGroup.rotation.x = dampedPitch;
      this.ship.sternGroup.position.y = dampedY;
      this.ship.sternGroup.rotation.x = dampedPitch;
    }

    this.ship.hullMeshGroup.position.y = 0;
    this.ship.hullMeshGroup.rotation.x = 0;
    this.ship.hullMeshGroup.rotation.z = this.rollAngle;

    // Wheelhouse Helm Wheel, Rudder Needle & Overhead Clinometer Pendulum
    const targetWheel = -(this.rudderDeg / 35) * Math.PI * 1.15;
    this.wheelVisualAngle = THREE.MathUtils.damp(this.wheelVisualAngle, targetWheel, 10, dt);
    this.ship.helmWheel.rotation.z = this.wheelVisualAngle;
    this.ship.rudderNeedle.position.x = (this.rudderDeg / 35) * 0.14;
    this.ship.clinometerNeedle.rotation.z = -this.rollAngle * 2.2;

    // Compass card rotates opposite to ship heading
    this.ship.compassCard.rotation.z = this.headingRad;

    // Reciprocating Steam Engine Crankshafts & Pistons rotate proportional to speed
    this.ship.setEngineSpeed(speedKnots, dt);

    // Chadburn Telegraph levers glide smoothly to selected notch angle
    const targetLever = TELEGRAPH_NOTCHES[this.telegraphIndex].leverAngle;
    this.ship.telegraphLever.rotation.x = THREE.MathUtils.damp(
      this.ship.telegraphLever.rotation.x,
      -targetLever,
      12,
      dt,
    );
    this.ship.telegraphLeverPort.rotation.x = this.ship.telegraphLever.rotation.x;

    // Searchlight beam intensity & sweeping arc (scales with dynamo power)
    if (this.searchlightTimer > 0 && this.powerLevel > 0.05) {
      const sweepX = Math.sin(this.simTime * 1.9) * 38;
      this.ship.searchlightTarget.position.set(sweepX, 2.0, -165);
      this.ship.searchlightHead.rotation.y = -Math.atan2(sweepX, 165);
      this.searchSpotLight.intensity = 310 * this.powerLevel;
      this.searchSpotLight.angle = Math.PI / 7.5;
    } else {
      this.ship.searchlightTarget.position.set(0, 1.5, -155);
      this.ship.searchlightHead.rotation.y = THREE.MathUtils.damp(
        this.ship.searchlightHead.rotation.y,
        0,
        5,
        dt,
      );
      this.searchSpotLight.intensity = (speedKnots > 1 ? 28 : 16) * this.powerLevel;
      this.searchSpotLight.angle = Math.PI / 9.5;
    }

    // Keep sun/moon directional key light aligned with sky arc
    const fwdX = Math.sin(this.headingRad);
    const fwdZ = -Math.cos(this.headingRad);
    const sunArcX = THREE.MathUtils.lerp(95, -140, Math.min(1, this.nightMix / 0.72));
    const keyOffsetX = THREE.MathUtils.lerp(sunArcX, 115, THREE.MathUtils.smoothstep(this.nightMix, 0.55, 1.0));
    const keyHeight = THREE.MathUtils.lerp(175, 145, this.nightMix);
    this.moonKeyLight.target.position.set(this.shipX - fwdX * 45, 0, this.shipZ - fwdZ * 45);
    this.moonKeyLight.position.set(
      this.shipX - fwdX * 45 + keyOffsetX,
      keyHeight,
      this.shipZ - fwdZ * 45 - 245,
    );
  }

  private emitBowSpray(dt: number, fwdX: number, fwdZ: number, lightSmokeOnly = false): void {
    const absSpd = Math.abs(this.speedKnots);
    const bowRefY = this.ship.bowGroup.position.y - (-BREAK_Z) * Math.sin(this.ship.bowGroup.rotation.x);
    const rightX = Math.cos(this.headingRad);
    const rightZ = Math.sin(this.headingRad);

    // Subtle coal smoke wisps from active forward funnels #1, #2, #3 (at z = 26, 56, 86; top y = 32.5)
    if (this.powerLevel > 0.1 && bowRefY > -12) {
      this.smokeAccum += dt * ((lightSmokeOnly ? 1.8 : 2.8) + absSpd * 0.3);
      while (this.smokeAccum >= 1) {
        this.smokeAccum -= 1;
        const funnelZ = [26.0, 56.0, 86.0][Math.floor(Math.random() * 3)];
        this.particles.emit(
          this.shipX - fwdX * funnelZ + (Math.random() - 0.5) * 1.8,
          32.5 + bowRefY,
          this.shipZ - fwdZ * funnelZ + (Math.random() - 0.5) * 1.8,
          -fwdX * (2.5 + absSpd * 0.35) + (Math.random() - 0.5) * 1.6,
          2.4 + Math.random() * 1.4,
          -fwdZ * (2.5 + absSpd * 0.35) + (Math.random() - 0.5) * 1.6,
          1.8 + Math.random() * 1.4,
          2.4 + Math.random() * 0.9,
          -0.8,
          this.nightMix < 0.5 ? 0x4b535e : 0x2e3744,
        );
      }
    }

    if (absSpd < 4) return;
    this.sprayAccum += dt * (absSpd * 0.85);

    while (this.sprayAccum >= 1) {
      this.sprayAccum -= 1;
      const side = Math.random() < 0.5 ? -1 : 1;
      const bowX = this.shipX + fwdX * 72.5 + rightX * side * 1.5;
      const bowZ = this.shipZ + fwdZ * 72.5 + rightZ * side * 1.5;
      this.particles.emit(
        bowX,
        0.5,
        bowZ,
        rightX * side * (2.5 + Math.random() * 3.5) - fwdX * 2,
        1.8 + Math.random() * 2.5,
        rightZ * side * (2.5 + Math.random() * 3.5) - fwdZ * 2,
        0.45 + Math.random() * 0.55,
        0.55 + Math.random() * 0.35,
        9.5,
        0xd8eefc,
      );
    }
  }

  private deploySubmarines(targetVessel: 'titanic' | 'carpathia'): void {
    const refX = targetVessel === 'carpathia' ? this.carpathia.root.position.x : this.shipX;
    const refZ = targetVessel === 'carpathia' ? this.carpathia.root.position.z : this.shipZ;
    const refHeading = targetVessel === 'carpathia' ? -this.carpathia.root.rotation.y : this.headingRad;

    const fwdX = Math.sin(refHeading);
    const fwdZ = -Math.cos(refHeading);
    const rightX = Math.cos(refHeading);
    const rightZ = Math.sin(refHeading);

    for (let i = 0; i < this.submarines.length; i++) {
      const sub = this.submarines[i];
      const aheadDist = targetVessel === 'titanic' ? 215 + i * 24 : 110 - i * 45;
      const latDist = sub.sideSign * (162 + i * 24);
      sub.x = refX + fwdX * aheadDist + rightX * latDist;
      sub.z = refZ + fwdZ * aheadDist + rightZ * latDist;
      sub.headingRad = Math.atan2(refX - sub.x, -(refZ - sub.z));
      sub.speedKnots = targetVessel === 'titanic' ? 14 : 9;
      sub.diveY = -5.5;
      sub.damagePitch = 0;
      sub.damageRoll = 0;
      sub.hp = sub.maxHp;
      sub.gunYaw = 0;
      sub.gunFireFlash = 0;
      sub.hitFireIntensity = 0;
      sub.torpedoCooldown = 2.8 + i * 2.2;
      sub.gunCooldown = 1.8 + i * 1.5;
      sub.sinkElapsed = 0;
      sub.wakeAccum = 0;
      sub.targetVessel = targetVessel;
      sub.state = 'hunting';
      sub.rig.root.visible = true;
      sub.rig.root.position.set(sub.x, 0, sub.z);
      sub.rig.root.rotation.set(0, -sub.headingRad, 0);
    }

    this.eventText =
      targetVessel === 'titanic'
        ? 'SUBMARINES SURFACING — FIRING ON TITANIC! ESCORT WARSHIPS ENGAGING'
        : 'U-BOATS SURFACING — FIRING ON RMS CARPATHIA! WARSHIPS RETURNING FIRE';
    this.eventTimer = 5.2;
    this.sound.playLookoutBell();
    this.emitTelemetry();
  }

  private spawnProjectile(
    kind: NavalProjectile['kind'],
    ownerSide: NavalProjectile['ownerSide'],
    targetKind: NavalProjectile['targetKind'],
    targetSubId: number,
    sx: number,
    sy: number,
    sz: number,
    vx: number,
    vy: number,
    vz: number,
    maxLife: number,
  ): void {
    for (let i = 0; i < MAX_NAVAL_PROJECTILES; i++) {
      const p = this.projectiles[i];
      if (p.active) continue;
      p.active = true;
      p.kind = kind;
      p.ownerSide = ownerSide;
      p.targetKind = targetKind;
      p.targetSubId = targetSubId;
      p.x = sx;
      p.y = sy;
      p.z = sz;
      p.vx = vx;
      p.vy = vy;
      p.vz = vz;
      p.life = maxLife;
      p.maxLife = maxLife;
      p.wakeAccum = 0;
      return;
    }
  }

  private stepNavalCombat(
    dt: number,
    seaMix: number,
    primaryTarget: 'titanic' | 'carpathia',
  ): void {
    // 1. Trigger U-boat attacks during open Atlantic night watch (Titanic) and Rescue aftermath (Carpathia)
    if (primaryTarget === 'titanic' && this.phase === 'playing' && seaMix > 0.68 && !this.submarineCruiseTriggered) {
      this.cruiseSubTimer += dt;
      if (this.cruiseSubTimer >= 3.8) {
        this.submarineCruiseTriggered = true;
        this.deploySubmarines('titanic');
      }
    } else if (
      primaryTarget === 'carpathia' &&
      this.carpathia.root.visible &&
      !this.submarineAftermathTriggered &&
      this.aftermathSeconds >= 64.5
    ) {
      const anyHunting = this.submarines.some((s) => s.state === 'hunting');
      if (!anyHunting) {
        this.submarineAftermathTriggered = true;
        this.deploySubmarines('carpathia');
      }
    }

    // Target world position for active submarines
    const tgtX = primaryTarget === 'carpathia' && this.carpathia.root.visible
      ? this.carpathia.root.position.x
      : this.shipX;
    const tgtZ = primaryTarget === 'carpathia' && this.carpathia.root.visible
      ? this.carpathia.root.position.z
      : this.shipZ;

    // 2. Step each submarine (surfacing, maneuvering, firing upon Titanic/Carpathia, or sinking after warship hits)
    for (let i = 0; i < this.submarines.length; i++) {
      const sub = this.submarines[i];
      if (sub.state === 'hidden' || sub.state === 'sunk') {
        sub.rig.root.visible = false;
        continue;
      }
      sub.rig.root.visible = true;
      sub.gunFireFlash = Math.max(0, sub.gunFireFlash - dt * 4.5);
      sub.hitFireIntensity = Math.max(0, sub.hitFireIntensity - dt * 0.45);

      if (sub.state === 'hunting') {
        sub.diveY = THREE.MathUtils.damp(sub.diveY, 0.0, 2.2, dt);

        // Orbit & pace target beam at ~150-190m while steering away from warships & icebergs
        const dxT = tgtX - sub.x;
        const dzT = tgtZ - sub.z;
        const distT = Math.hypot(dxT, dzT) || 1;
        const radAngle = Math.atan2(dxT, -dzT);
        const tangentBias = distT > 185 ? 0.55 : distT < 135 ? 1.85 : 1.18;
        let desiredHeading = radAngle + sub.sideSign * tangentBias;

        let avoidX = 0;
        let avoidZ = 0;
        for (const berg of this.icebergs) {
          const bdx = sub.x - berg.x;
          const bdz = sub.z - berg.z;
          const bdist = Math.hypot(bdx, bdz);
          if (bdist < berg.collisionRadius + 30 && bdist > 0.1) {
            avoidX += (bdx / bdist) * 2.4;
            avoidZ += (bdz / bdist) * 2.4;
          }
        }
        if (Math.hypot(avoidX, avoidZ) > 0.05) {
          desiredHeading = Math.atan2(Math.sin(desiredHeading) + avoidX, -Math.cos(desiredHeading) - avoidZ);
        }

        let dh = desiredHeading - sub.headingRad;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        sub.headingRad += THREE.MathUtils.clamp(dh, -0.5 * dt, 0.5 * dt);

        const moveSpd = sub.speedKnots * 1.95;
        sub.x += Math.sin(sub.headingRad) * moveSpd * dt;
        sub.z += -Math.cos(sub.headingRad) * moveSpd * dt;

        // Train 8.8cm deck gun toward Titanic or Carpathia
        const sFwdX = Math.sin(sub.headingRad);
        const sFwdZ = -Math.cos(sub.headingRad);
        const sRightX = Math.cos(sub.headingRad);
        const sRightZ = Math.sin(sub.headingRad);
        const localTX = dxT * sRightX + dzT * sRightZ;
        const localTZ = -(dxT * sFwdX + dzT * sFwdZ);
        sub.gunYaw = Math.atan2(-localTX, -localTZ);

        // Only fire once conning tower & deck gun are above surface
        if (sub.diveY > -0.7 && (primaryTarget === 'carpathia' || this.phase === 'playing')) {
          sub.torpedoCooldown -= dt;
          if (sub.torpedoCooldown <= 0) {
            sub.torpedoCooldown = 6.5 + Math.random() * 2.5;
            const tSpd = 26;
            const aimSpread = (Math.random() - 0.5) * 0.14;
            const dirX = dxT / distT;
            const dirZ = dzT / distT;
            const cosA = Math.cos(aimSpread);
            const sinA = Math.sin(aimSpread);
            const launchVx = (dirX * cosA - dirZ * sinA) * tSpd;
            const launchVz = (dirX * sinA + dirZ * cosA) * tSpd;
            this.spawnProjectile(
              'torpedo',
              'submarine',
              primaryTarget,
              sub.id,
              sub.x + sFwdX * 30,
              0.2,
              sub.z + sFwdZ * 30,
              launchVx,
              0,
              launchVz,
              9.0,
            );
            this.sound.playTorpedoLaunch();
          }

          sub.gunCooldown -= dt;
          if (sub.gunCooldown <= 0) {
            sub.gunCooldown = 4.2 + Math.random() * 1.8;
            sub.gunFireFlash = 1.0;
            const flightT = Math.min(2.6, Math.max(1.2, distT / 72));
            const muzX = sub.x + sFwdX * 16.5;
            const muzZ = sub.z + sFwdZ * 16.5;
            const vx = (tgtX + (Math.random() - 0.5) * 14 - muzX) / flightT;
            const vz = (tgtZ + (Math.random() - 0.5) * 14 - muzZ) / flightT;
            const vy = (4.0 - 2.8) / flightT + 0.5 * 9.8 * flightT;
            this.spawnProjectile(
              'subShell',
              'submarine',
              primaryTarget,
              sub.id,
              muzX,
              2.8,
              muzZ,
              vx,
              vy,
              vz,
              flightT + 0.6,
            );
            this.sound.playNavalCannon(false);
          }
        }

        // Emit subtle foaming diesel surface wake particles
        sub.wakeAccum += dt * 7;
        while (sub.wakeAccum >= 1) {
          sub.wakeAccum -= 1;
          this.particles.emit(
            sub.x - sFwdX * 30 + (Math.random() - 0.5) * 2.2,
            0.25,
            sub.z - sFwdZ * 30 + (Math.random() - 0.5) * 2.2,
            (Math.random() - 0.5) * 1.4,
            0.9 + Math.random() * 0.9,
            (Math.random() - 0.5) * 1.4,
            0.55 + Math.random() * 0.5,
            0.7 + Math.random() * 0.4,
            3.0,
            0xdbeafe,
          );
        }
      } else if (sub.state === 'sinking') {
        sub.sinkElapsed += dt;
        const tSink = THREE.MathUtils.clamp(sub.sinkElapsed / 6.5, 0, 1);
        sub.diveY = THREE.MathUtils.lerp(0, -24, Math.pow(tSink, 1.25));
        sub.damagePitch = THREE.MathUtils.lerp(0, -0.52, tSink);
        sub.damageRoll = sub.sideSign * THREE.MathUtils.lerp(0.15, 0.72, tSink);
        sub.hitFireIntensity = Math.max(sub.hitFireIntensity, (1 - tSink) * 0.75);

        if (tSink < 0.75 && Math.random() < 0.65) {
          this.particles.emit(
            sub.x + (Math.random() - 0.5) * 6,
            Math.max(0.3, sub.diveY + 3.5),
            sub.z + (Math.random() - 0.5) * 6,
            (Math.random() - 0.5) * 3,
            2.5 + Math.random() * 3,
            (Math.random() - 0.5) * 3,
            0.9 + Math.random() * 0.8,
            1.1,
            1.5,
            Math.random() < 0.4 ? 0xfb923c : 0x334155,
          );
        }

        if (tSink >= 1) {
          sub.state = 'sunk';
          sub.rig.root.visible = false;
        }
      }

      sub.rig.root.position.set(sub.x, 0, sub.z);
      sub.rig.root.rotation.set(0, -sub.headingRad, 0);
      sub.rig.setSubmarineState(
        this.simTime + i * 1.7,
        sub.state === 'hunting' ? 0.85 : 0.1,
        seaMix,
        sub.diveY,
        sub.damagePitch,
        sub.damageRoll,
        sub.gunYaw,
        sub.gunFireFlash,
        sub.hitFireIntensity,
      );
    }

    // 3. Assign Royal Navy Escort Warships to counter-attack active hunting submarines
    const sub0 = this.submarines[0];
    const sub1 = this.submarines[1];
    const targetForW1 = sub0.state === 'hunting' ? sub0 : sub1.state === 'hunting' ? sub1 : null;
    const targetForW2 = sub1.state === 'hunting' ? sub1 : sub0.state === 'hunting' ? sub0 : null;

    this.warship1FireFlash = Math.max(0, this.warship1FireFlash - dt * 5.0);
    this.warship2FireFlash = Math.max(0, this.warship2FireFlash - dt * 5.0);

    this.warship1Engaged = Boolean(targetForW1 && targetForW1.diveY > -1.4);
    if (this.warship1Engaged && targetForW1) {
      const wFwdX = Math.sin(this.warshipHeadingRad);
      const wFwdZ = -Math.cos(this.warshipHeadingRad);
      const wRightX = Math.cos(this.warshipHeadingRad);
      const wRightZ = Math.sin(this.warshipHeadingRad);
      const dx = targetForW1.x - this.warshipX;
      const dz = targetForW1.z - this.warshipZ;
      this.warship1AimLocalX = dx * wRightX + dz * wRightZ;
      this.warship1AimLocalZ = -(dx * wFwdX + dz * wFwdZ);

      this.warship1FireCooldown -= dt;
      if (this.warship1FireCooldown <= 0) {
        this.warship1FireCooldown = 2.6 + Math.random() * 0.9;
        this.warship1FireFlash = 1.0;
        const dist = Math.hypot(dx, dz) || 1;
        const flightT = THREE.MathUtils.clamp(dist / 78, 0.9, 2.2);
        const muzX = this.warshipX + wFwdX * 42;
        const muzZ = this.warshipZ + wFwdZ * 42;
        const vx = (targetForW1.x - muzX) / flightT;
        const vz = (targetForW1.z - muzZ) / flightT;
        const vy = (1.6 - 7.8) / flightT + 0.5 * 9.8 * flightT;
        this.spawnProjectile(
          'warshipShell',
          'warship',
          'submarine',
          targetForW1.id,
          muzX,
          7.8,
          muzZ,
          vx,
          vy,
          vz,
          flightT + 0.5,
        );
        this.sound.playNavalCannon(true);
      }
    }

    this.warship2Engaged = Boolean(targetForW2 && targetForW2.diveY > -1.4);
    if (this.warship2Engaged && targetForW2) {
      const w2FwdX = Math.sin(this.warship2HeadingRad);
      const w2FwdZ = -Math.cos(this.warship2HeadingRad);
      const w2RightX = Math.cos(this.warship2HeadingRad);
      const w2RightZ = Math.sin(this.warship2HeadingRad);
      const dx = targetForW2.x - this.warship2X;
      const dz = targetForW2.z - this.warship2Z;
      this.warship2AimLocalX = dx * w2RightX + dz * w2RightZ;
      this.warship2AimLocalZ = -(dx * w2FwdX + dz * w2FwdZ);

      this.warship2FireCooldown -= dt;
      if (this.warship2FireCooldown <= 0) {
        this.warship2FireCooldown = 2.5 + Math.random() * 0.9;
        this.warship2FireFlash = 1.0;
        const dist = Math.hypot(dx, dz) || 1;
        const flightT = THREE.MathUtils.clamp(dist / 78, 0.9, 2.2);
        const muzX = this.warship2X + w2FwdX * 42;
        const muzZ = this.warship2Z + w2FwdZ * 42;
        const vx = (targetForW2.x - muzX) / flightT;
        const vz = (targetForW2.z - muzZ) / flightT;
        const vy = (1.6 - 7.8) / flightT + 0.5 * 9.8 * flightT;
        this.spawnProjectile(
          'warshipShell',
          'warship',
          'submarine',
          targetForW2.id,
          muzX,
          7.8,
          muzZ,
          vx,
          vy,
          vz,
          flightT + 0.5,
        );
        this.sound.playNavalCannon(true);
      }
    }

    // 4. Advance all active torpedoes & naval artillery shells + update InstancedMesh
    let anyProjUpdated = false;
    for (let i = 0; i < MAX_NAVAL_PROJECTILES; i++) {
      const p = this.projectiles[i];
      if (!p.active) continue;
      anyProjUpdated = true;

      p.life -= dt;
      if (p.kind !== 'torpedo') {
        p.vy -= 9.8 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      // Torpedo foaming wake trail
      if (p.kind === 'torpedo') {
        p.wakeAccum += dt * 22;
        while (p.wakeAccum >= 1) {
          p.wakeAccum -= 1;
          this.particles.emit(
            p.x + (Math.random() - 0.5) * 0.6,
            0.35,
            p.z + (Math.random() - 0.5) * 0.6,
            (Math.random() - 0.5) * 1.2,
            0.8 + Math.random() * 0.8,
            (Math.random() - 0.5) * 1.2,
            0.45 + Math.random() * 0.35,
            0.55,
            2.2,
            0xe0f2fe,
          );
        }
      }

      // Impact detection
      let impacted = false;
      if (p.ownerSide === 'submarine') {
        if (p.targetKind === 'titanic' && this.phase === 'playing') {
          const dxS = p.x - this.shipX;
          const dzS = p.z - this.shipZ;
          const distS = Math.hypot(dxS, dzS);
          if (distS < 45) {
            const tFwdX = Math.sin(this.headingRad);
            const tFwdZ = -Math.cos(this.headingRad);
            const tRightX = Math.cos(this.headingRad);
            const tRightZ = Math.sin(this.headingRad);
            const along = dxS * tFwdX + dzS * tFwdZ;
            const lat = dxS * tRightX + dzS * tRightZ;
            if (Math.abs(along) < 120 && Math.abs(lat) < 14.2 && p.y < 14) {
              impacted = true;
              const isTorp = p.kind === 'torpedo';
              this.applyHullBreach(
                isTorp ? 14 : 5,
                lat >= 0 ? -tRightX : tRightX,
                lat >= 0 ? -tRightZ : tRightZ,
                0.8,
                p.x,
                p.z,
                0.6,
                isTorp ? 7 : 2,
                false,
                isTorp ? 'U-BOAT TORPEDO STRIKE' : 'U-BOAT DECK GUN HIT',
                lat,
              );
            }
          }
        } else if (p.targetKind === 'carpathia' && this.carpathia.root.visible) {
          const cx = this.carpathia.root.position.x;
          const cz = this.carpathia.root.position.z;
          if (Math.hypot(p.x - cx, p.z - cz) < 28 && p.y < 14) {
            impacted = true;
            for (let k = 0; k < 18; k++) {
              this.particles.emit(
                p.x + (Math.random() - 0.5) * 3,
                1.5,
                p.z + (Math.random() - 0.5) * 3,
                (Math.random() - 0.5) * 7,
                4 + Math.random() * 7,
                (Math.random() - 0.5) * 7,
                0.8 + Math.random() * 0.7,
                0.9,
                9.8,
                k < 6 ? 0xfb923c : 0xe0f2fe,
              );
            }
            this.sound.playCollisionImpact(0.32);
          }
        }
      } else if (p.ownerSide === 'warship') {
        const tgtSub = this.submarines[p.targetSubId];
        if (tgtSub && tgtSub.state === 'hunting') {
          const distSub = Math.hypot(p.x - tgtSub.x, p.z - tgtSub.z);
          if (distSub < 12.5 && p.y <= 5.5) {
            impacted = true;
            tgtSub.hp -= 1;
            tgtSub.hitFireIntensity = 1.0;
            const lethal = tgtSub.hp <= 0;
            for (let k = 0; k < (lethal ? 36 : 22); k++) {
              this.particles.emit(
                tgtSub.x + (Math.random() - 0.5) * 5,
                2.0,
                tgtSub.z + (Math.random() - 0.5) * 5,
                (Math.random() - 0.5) * 10,
                5 + Math.random() * 10,
                (Math.random() - 0.5) * 10,
                0.75 + Math.random() * 1.1,
                1.0 + Math.random() * 0.5,
                9.8,
                k < (lethal ? 18 : 10) ? 0xff7b29 : 0xe0f2fe,
              );
            }
            this.sound.playSubmarineStruck(lethal);
            if (lethal) {
              tgtSub.state = 'sinking';
              tgtSub.sinkElapsed = 0;
              this.submarinesSunk += 1;
              this.score += 500;
              const remaining = this.submarines.filter((s) => s.state === 'hunting').length;
              this.eventText =
                remaining === 0
                  ? 'ALL HOSTILE U-BOATS STRUCK & SUNK BY ROYAL NAVY WARSHIPS!'
                  : `${tgtSub.label} STRUCK BY WARSHIPS — GOING DOWN!`;
              this.eventTimer = 4.6;
              this.emitTelemetry();
            } else {
              this.eventText = `WARSHIPS STRIKE ${tgtSub.label}!`;
              this.eventTimer = 2.4;
            }
          }
        }
      }

      // Splash on water miss
      if (!impacted && (p.y <= 0 || p.life <= 0)) {
        impacted = true;
        if (p.kind !== 'torpedo') {
          for (let k = 0; k < 8; k++) {
            this.particles.emit(
              p.x,
              0.4,
              p.z,
              (Math.random() - 0.5) * 4,
              3 + Math.random() * 5,
              (Math.random() - 0.5) * 4,
              0.6 + Math.random() * 0.6,
              0.7,
              9.8,
              0xdbeafe,
            );
          }
        }
      }

      if (impacted) {
        p.active = false;
        _projDummy.position.set(0, -50, 0);
        _projDummy.scale.setScalar(0.001);
        _projDummy.updateMatrix();
        this.projectileMesh.setMatrixAt(i, _projDummy.matrix);
      } else {
        _projDummy.position.set(p.x, p.y, p.z);
        _projDummy.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz);
        if (p.kind === 'torpedo') {
          _projDummy.scale.set(1.1, 1.1, 2.3);
          _projColor.setHex(0x7dd3fc);
        } else if (p.kind === 'subShell') {
          _projDummy.scale.set(1.0, 1.0, 1.3);
          _projColor.setHex(0xfbbf24);
        } else {
          _projDummy.scale.set(1.35, 1.35, 1.85);
          _projColor.setHex(0xfff3b0);
        }
        _projDummy.updateMatrix();
        this.projectileMesh.setMatrixAt(i, _projDummy.matrix);
        this.projectileMesh.setColorAt(i, _projColor);
      }
    }

    if (anyProjUpdated) {
      this.projectileMesh.instanceMatrix.needsUpdate = true;
      if (this.projectileMesh.instanceColor) this.projectileMesh.instanceColor.needsUpdate = true;
    }
  }

  private stepSingleWarship(
    dt: number,
    isSecondary: boolean,
    seaMix: number,
    rescueWatch: boolean,
  ): void {
    const fwdX = Math.sin(this.headingRad);
    const fwdZ = -Math.cos(this.headingRad);
    const rightX = Math.cos(this.headingRad);
    const rightZ = Math.sin(this.headingRad);

    let wx = isSecondary ? this.warship2X : this.warshipX;
    let wz = isSecondary ? this.warship2Z : this.warshipZ;
    let wh = isSecondary ? this.warship2HeadingRad : this.warshipHeadingRad;
    let wyr = isSecondary ? this.warship2YawRate : this.warshipYawRate;
    let wspd = isSecondary ? this.warship2SpeedKnots : this.warshipSpeedKnots;
    let wroll = isSecondary ? this.warship2Roll : this.warshipRoll;
    let joined = isSecondary ? this.warship2HasJoinedWake : this.warshipHasJoinedWake;
    let smokeAcc = isSecondary ? this.warship2SmokeAccum : this.warshipSmokeAccum;
    let sprayAcc = isSecondary ? this.warship2SprayAccum : this.warshipSprayAccum;

    const wFwdX = Math.sin(wh);
    const wFwdZ = -Math.cos(wh);
    const wRightX = Math.cos(wh);
    const wRightZ = Math.sin(wh);

    const wakeOffsetAlong = isSecondary ? 245 : 306;
    const wakeOffsetLat = isSecondary ? 76 : -26;
    const anchorX = isSecondary ? 92 : -86;
    const anchorZ = isSecondary ? -280 : -265;
    const rescueLat = isSecondary ? 105 : -84;
    const rescueAlong = isSecondary ? -10 : -16;

    if (dt > 0 && this.phase !== 'title') {
      const relShipX = wx - this.shipX;
      const relShipZ = wz - this.shipZ;
      const alongAhead = relShipX * fwdX + relShipZ * fwdZ;
      const lateral = relShipX * rightX + relShipZ * rightZ;

      if (!joined && this.shipZ <= -375) {
        joined = true;
      }

      let targetHeading = this.headingRad;
      let desiredKnots = 0;
      let avoidX = 0;
      let avoidZ = 0;

      if (rescueWatch) {
        if ((this.phase === 'aftermath' || this.phase === 'gameover') && this.aftermathSeconds >= 3.5) {
          const standX = this.shipX + rightX * rescueLat + fwdX * rescueAlong;
          const standZ = this.shipZ + rightZ * rescueLat + fwdZ * rescueAlong;
          const dxStand = standX - wx;
          const dzStand = standZ - wz;
          const distStand = Math.hypot(dxStand, dzStand);
          if (distStand > 15) {
            targetHeading = Math.atan2(dxStand, -dzStand);
            desiredKnots = Math.min(12.5, Math.max(4.5, distStand * 0.16));
          } else {
            targetHeading = this.headingRad + (isSecondary ? 0.14 : -0.14);
            desiredKnots = 0;
          }
        } else {
          const standX = this.shipX - fwdX * 240 + rightX * (isSecondary ? 78 : -68);
          const standZ = this.shipZ - fwdZ * 240 + rightZ * (isSecondary ? 78 : -68);
          const dxStand = standX - wx;
          const dzStand = standZ - wz;
          const distStand = Math.hypot(dxStand, dzStand);
          if (distStand > 25) {
            targetHeading = Math.atan2(dxStand, -dzStand);
            desiredKnots = Math.min(8, distStand * 0.14);
          } else {
            targetHeading = Math.atan2(this.shipX - wx, -(this.shipZ - wz));
            desiredKnots = 0;
          }
        }
      } else if (!joined) {
        const dxAnchor = anchorX - wx;
        const dzAnchor = anchorZ - wz;
        const distAnchor = Math.hypot(dxAnchor, dzAnchor);
        targetHeading = distAnchor > 6 ? Math.atan2(dxAnchor, -dzAnchor) : isSecondary ? -0.04 : 0.04;
        desiredKnots = distAnchor > 6 ? Math.min(4.5, distAnchor * 0.25) : 0;

        if (alongAhead > -210 && alongAhead < 110 && Math.abs(lateral) < 46) {
          const pushSide = lateral >= 0 ? 1 : -1;
          avoidX += rightX * pushSide * 2.5;
          avoidZ += rightZ * pushSide * 2.5;
          desiredKnots = -4.0;
        }
      } else {
        const wakeX = this.shipX - fwdX * wakeOffsetAlong + rightX * wakeOffsetLat;
        const wakeZ = this.shipZ - fwdZ * wakeOffsetAlong + rightZ * wakeOffsetLat;

        let aimX = wakeX;
        let aimZ = wakeZ;
        if (alongAhead > -225 && Math.abs(lateral) < 52) {
          const clearSide = lateral >= 0 ? 1 : -1;
          aimX = this.shipX - fwdX * 265 + rightX * (clearSide * 64);
          aimZ = this.shipZ - fwdZ * 265 + rightZ * (clearSide * 64);
        } else if (this.harbor.root.visible && wz > -525 && wz < -390) {
          aimX = THREE.MathUtils.clamp(aimX, -38, 38);
        }

        const toAimX = aimX - wx;
        const toAimZ = aimZ - wz;
        const distToAim = Math.hypot(toAimX, toAimZ);
        const distToWake = Math.hypot(wakeX - wx, wakeZ - wz);

        const dirAimX = distToAim > 0.5 ? toAimX / distToAim : fwdX;
        const dirAimZ = distToAim > 0.5 ? toAimZ / distToAim : fwdZ;
        const blendWeight = THREE.MathUtils.clamp(distToAim / 75, 0.18, 1.0);
        const steerX = dirAimX * blendWeight + fwdX * (1 - blendWeight);
        const steerZ = dirAimZ * blendWeight + fwdZ * (1 - blendWeight);
        targetHeading = Math.atan2(steerX + avoidX, -(steerZ + avoidZ));

        const aheadOfWake = (wakeX - wx) * wFwdX + (wakeZ - wz) * wFwdZ;
        const titanicCruise = Math.max(0, this.speedKnots);
        if (distToWake > 42 && aheadOfWake > 0) {
          desiredKnots = Math.min(28, Math.max(titanicCruise + 6.5, aheadOfWake * 0.24));
        } else {
          desiredKnots = THREE.MathUtils.clamp(titanicCruise + aheadOfWake * 0.22, -4, 27);
        }
        if (Math.abs(this.speedKnots) < 0.8 && distToWake < 36) {
          desiredKnots = 0;
        }
      }

      if (!rescueWatch && alongAhead > -268 && alongAhead < 110 && Math.abs(lateral) < 36) {
        const pushSide = lateral >= 0 ? 1 : -1;
        const urgency = 1 - Math.abs(lateral) / 36;
        avoidX += rightX * pushSide * (1.4 + urgency * 2.4) - fwdX * 1.6;
        avoidZ += rightZ * pushSide * (1.4 + urgency * 2.4) - fwdZ * 1.6;
        desiredKnots = Math.min(desiredKnots, alongAhead > -235 ? -5 : 2);
      }

      // Inter-warship spacing
      const otherX = isSecondary ? this.warshipX : this.warship2X;
      const otherZ = isSecondary ? this.warshipZ : this.warship2Z;
      const dWarX = wx - otherX;
      const dWarZ = wz - otherZ;
      const distWar = Math.hypot(dWarX, dWarZ);
      if (distWar < 54 && distWar > 0.1) {
        const push = ((54 - distWar) / 54) * 3.0;
        avoidX += (dWarX / distWar) * push;
        avoidZ += (dWarZ / distWar) * push;
      }

      for (let i = 0; i < this.icebergs.length; i++) {
        const berg = this.icebergs[i];
        const dx = wx - berg.x;
        const dz = wz - berg.z;
        const dist = Math.hypot(dx, dz);
        const safeDist = berg.collisionRadius + 34;
        if (dist < safeDist && dist > 0.05) {
          const push = ((safeDist - dist) / safeDist) * 3.4;
          avoidX += (dx / dist) * push;
          avoidZ += (dz / dist) * push;
        }
      }

      if (this.harbor.root.visible) {
        const boxObs = this.harbor.getBoxObstacles();
        for (let b = 0; b < boxObs.length; b++) {
          const box = boxObs[b];
          const cx = THREE.MathUtils.clamp(wx, box.minX, box.maxX);
          const cz = THREE.MathUtils.clamp(wz, box.minZ, box.maxZ);
          const vx = wx - cx;
          const vz = wz - cz;
          const d = Math.hypot(vx, vz);
          const margin = 22;
          if (d < margin) {
            const nx = d > 0.01 ? vx / d : 0;
            const nz = d > 0.01 ? vz / d : -1;
            const push = ((margin - d) / margin) * 3.6;
            avoidX += nx * push;
            avoidZ += nz * push;
          }
        }
      }

      if (Math.hypot(avoidX, avoidZ) > 0.05) {
        const baseX = Math.sin(targetHeading);
        const baseZ = -Math.cos(targetHeading);
        targetHeading = Math.atan2(baseX + avoidX, -(baseZ + avoidZ));
      }

      let dh = targetHeading - wh;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;

      const speedAuth = 0.42 + 0.58 * Math.min(1, Math.abs(wspd) / 18);
      const targetYawRate = THREE.MathUtils.clamp(dh * 1.4, -0.48, 0.48) * speedAuth;
      wyr = THREE.MathUtils.damp(wyr, targetYawRate, 2.5, dt);
      wh += wyr * dt;

      const accel = desiredKnots < wspd ? 1.1 : 0.72;
      wspd = THREE.MathUtils.damp(wspd, desiredKnots, accel, dt);

      const moveSpd = wspd * 2.15;
      wx += Math.sin(wh) * moveSpd * dt;
      wz += -Math.cos(wh) * moveSpd * dt;
    }

    const phaseOff = isSecondary ? 2.4 : 1.1;
    const waveY = Math.sin(this.simTime * 0.92 + phaseOff) * 0.14;
    const wavePitch = Math.sin(this.simTime * 0.78 + phaseOff * 0.55) * 0.008;
    const waveRoll = Math.cos(this.simTime * 0.66 + phaseOff * 0.8) * 0.012 - wyr * 0.12;
    wroll = THREE.MathUtils.damp(wroll, waveRoll, 4, Math.max(dt, 0.016));

    const rig = isSecondary ? this.warship2 : this.warship;
    rig.root.position.set(wx, waveY, wz);
    rig.root.rotation.set(wavePitch, -wh, wroll);

    const engaged = isSecondary ? this.warship2Engaged : this.warship1Engaged;
    const aimLX = isSecondary ? this.warship2AimLocalX : this.warship1AimLocalX;
    const aimLZ = isSecondary ? this.warship2AimLocalZ : this.warship1AimLocalZ;
    const flash = isSecondary ? this.warship2FireFlash : this.warship1FireFlash;

    let sweepLocalX: number | undefined;
    let sweepLocalZ: number | undefined;
    const rescueSweep = rescueWatch && this.carpathiaStage !== 'complete';
    const activeSearchSweep = engaged || rescueSweep;
    if (engaged) {
      sweepLocalX = aimLX;
      sweepLocalZ = aimLZ;
    } else if (rescueSweep) {
      const dxT = this.shipX - wx;
      const dzT = this.shipZ - wz;
      sweepLocalX = dxT * wRightX + dzT * wRightZ + Math.sin(this.simTime * 0.65 + phaseOff) * 34;
      sweepLocalZ = -(dxT * wFwdX + dzT * wFwdZ);
    }

    rig.setNavalState(
      this.simTime + (isSecondary ? 1.3 : 0),
      wspd,
      seaMix,
      activeSearchSweep,
      sweepLocalX,
      sweepLocalZ,
      {
        laddersDeployed: !isSecondary && this.warshipRescuing,
        boardedRatio: !isSecondary ? this.warshipSurvivors / 356 : 0,
        combatAim: engaged
          ? {
              targetLocalX: aimLX,
              targetLocalZ: aimLZ,
              firingFlash: flash,
            }
          : undefined,
      },
    );

    if (dt > 0 && this.phase !== 'paused') {
      const absSpd = Math.abs(wspd);
      smokeAcc += dt * (1.2 + absSpd * 0.22);
      while (smokeAcc >= 1) {
        smokeAcc -= 1;
        const fz = [-10.5, 4.5, 19.5][Math.floor(Math.random() * 3)];
        this.particles.emit(
          wx - wFwdX * fz + (Math.random() - 0.5) * 1.4,
          20.6,
          wz - wFwdZ * fz + (Math.random() - 0.5) * 1.4,
          -wFwdX * (1.8 + absSpd * 0.3) + (Math.random() - 0.5) * 1.4,
          2.0 + Math.random() * 1.2,
          -wFwdZ * (1.8 + absSpd * 0.3) + (Math.random() - 0.5) * 1.4,
          1.3 + Math.random() * 1.0,
          2.0 + Math.random() * 0.8,
          -0.7,
          seaMix < 0.5 ? 0x454e59 : 0x2a3340,
        );
      }

      if (absSpd > 4) {
        sprayAcc += dt * (absSpd * 0.65);
        while (sprayAcc >= 1) {
          sprayAcc -= 1;
          const side = Math.random() < 0.5 ? -1 : 1;
          this.particles.emit(
            wx + wFwdX * 71.5 + wRightX * side * 1.2,
            0.45,
            wz + wFwdZ * 71.5 + wRightZ * side * 1.2,
            wRightX * side * (2.2 + Math.random() * 2.8) - wFwdX * 1.6,
            1.6 + Math.random() * 2.0,
            wRightZ * side * (2.2 + Math.random() * 2.8) - wFwdZ * 1.6,
            0.4 + Math.random() * 0.45,
            0.5 + Math.random() * 0.3,
            9.5,
            0xd8eefc,
          );
        }
      }
    }

    if (isSecondary) {
      this.warship2X = wx;
      this.warship2Z = wz;
      this.warship2HeadingRad = wh;
      this.warship2YawRate = wyr;
      this.warship2SpeedKnots = wspd;
      this.warship2Roll = wroll;
      this.warship2HasJoinedWake = joined;
      this.warship2SmokeAccum = smokeAcc;
      this.warship2SprayAccum = sprayAcc;
    } else {
      this.warshipX = wx;
      this.warshipZ = wz;
      this.warshipHeadingRad = wh;
      this.warshipYawRate = wyr;
      this.warshipSpeedKnots = wspd;
      this.warshipRoll = wroll;
      this.warshipHasJoinedWake = joined;
      this.warshipSmokeAccum = smokeAcc;
      this.warshipSprayAccum = sprayAcc;
    }
  }

  private stepWarshipConsciousness(dt: number, seaMix: number, rescueWatch: boolean): void {
    this.stepSingleWarship(dt, false, seaMix, rescueWatch);
    this.stepSingleWarship(dt, true, seaMix, rescueWatch);
  }

  private manageIcebergField(dt: number, worldSpeed: number, fwdX: number, fwdZ: number): void {
    const rightX = Math.cos(this.headingRad);
    const rightZ = Math.sin(this.headingRad);

    // Update drifting & bobbing icebergs + cull far behind
    for (let i = this.icebergs.length - 1; i >= 0; i--) {
      const b = this.icebergs[i];
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      b.rotY += b.rotSpeed * dt;
      if (b.hitCooldown > 0) b.hitCooldown = Math.max(0, b.hitCooldown - dt);

      b.group.position.set(b.x, Math.sin(this.simTime * 0.85 + b.bobPhase) * 0.28, b.z);
      b.group.rotation.y = b.rotY;

      const dx = b.x - this.shipX;
      const dz = b.z - this.shipZ;
      const along = dx * fwdX + dz * fwdZ;
      const distSq = dx * dx + dz * dz;
      if (along < -230 || distSq > 620 * 620) {
        this.scene.remove(b.group);
        this.icebergs.splice(i, 1);
      }
    }

    // Spawn new iceberg rows ahead along current course
    this.spawnAccumDist += Math.max(0, worldSpeed) * dt;
    const difficulty = Math.min(1.35, this.distanceNm / 8.5);
    const rowInterval = THREE.MathUtils.lerp(76, 48, Math.min(1, difficulty));

    if (this.spawnAccumDist >= rowInterval && this.icebergs.length < 34) {
      this.spawnAccumDist = 0;

      // Always leave a guaranteed safe channel somewhere within [-95, +95] lateral offset (sized for 28m beam)
      const safeLaneCenter = (Math.random() - 0.5) * 140;
      const safeHalfWidth = THREE.MathUtils.lerp(34, 26, Math.min(1, difficulty));
      const countInRow = Math.random() < 0.35 + difficulty * 0.35 ? 3 : 2;
      const baseAhead = 370 + Math.random() * 80;

      for (let c = 0; c < countInRow; c++) {
        let lateral = (Math.random() - 0.5) * 280;
        if (Math.abs(lateral - safeLaneCenter) < safeHalfWidth) {
          lateral = safeLaneCenter + (lateral >= safeLaneCenter ? 1 : -1) * (safeHalfWidth + 16 + Math.random() * 26);
        }

        const ahead = baseAhead + (Math.random() - 0.5) * 40;
        const sx = this.shipX + fwdX * ahead + rightX * lateral;
        const sz = this.shipZ + fwdZ * ahead + rightZ * lateral;

        // Avoid overlapping existing icebergs
        let overlaps = false;
        for (const ex of this.icebergs) {
          if (Math.hypot(ex.x - sx, ex.z - sz) < ex.collisionRadius + 30) {
            overlaps = true;
            break;
          }
        }
        if (overlaps) continue;

        const r = Math.random();
        const variant: IcebergVariant =
          r < 0.36 ? 'growler' : r < 0.7 ? 'tabular' : 'pinnacle';
        const scale = 0.85 + Math.random() * (0.45 + difficulty * 0.25);

        // Growlers & some bergs slowly drift laterally across the sea lane after 2 NM
        const driftMag = this.distanceNm > 1.8 ? (Math.random() - 0.5) * (3.2 + difficulty * 3.5) : 0;
        const berg = this.iceFactory.spawnIceberg(
          variant,
          sx,
          sz,
          scale,
          rightX * driftMag,
          rightZ * driftMag,
        );
        this.icebergs.push(berg);
        this.scene.add(berg.group);
      }
    }
  }

  private applyHullBreach(
    dmgRaw: number,
    pushNx: number,
    pushNz: number,
    pushDist: number,
    hitX: number,
    hitZ: number,
    speedRatio: number,
    floodJump: number,
    isHeavyBow: boolean,
    label: string,
    sideSign: number,
  ): void {
    this.combo = 1;
    this.hullIntegrity = Math.max(0, this.hullIntegrity - Math.round(dmgRaw));
    this.listDirection = sideSign >= 0 ? 1 : -1;
    this.headingRad += (sideSign >= 0 ? -1 : 1) * (isHeavyBow ? 0.07 : 0.12);
    this.shipX += pushNx * pushDist;
    this.shipZ += pushNz * pushDist;
    this.speedKnots *= isHeavyBow ? 0.32 : 0.58;
    this.floodingPct = Math.min(100, this.floodingPct + floodJump);

    this.hitstopTimer = isHeavyBow ? 0.065 : 0.045;
    this.shakeIntensity = isHeavyBow ? 1.0 : 0.72;
    this.damageFlashTimer = 0.45;
    this.onDamageFlash(1.0);
    this.particles.burstIceImpact(hitX, 3.2, hitZ, isHeavyBow ? 44 : 28);
    this.sound.playCollisionImpact(Math.max(0.45, speedRatio));

    if (!this.autopilotEnabled && label === 'NORTH ATLANTIC ICEBERG') {
      this.bowPanicActive = true;
      this.panicShoutCooldown = 3.2;
      this.sound.playCrowdScreamPanic();
      this.eventText = 'ICEBERG STRIKE — PASSENGERS SCREAMING & RUSHING TO THE BOW!';
      this.eventTimer = 4.6;
    } else {
      this.eventText = `COLLISION: ${label} — HULL BREACHED`;
      this.eventTimer = 3.0;
    }
    this.emitTelemetry();
  }

  private checkAllObstacles(dt: number, fwdX: number, fwdZ: number): void {
    // Decrement per-obstacle collision cooldowns
    for (const [key, t] of this.obstacleCooldowns) {
      const next = t - dt;
      if (next <= 0) this.obstacleCooldowns.delete(key);
      else this.obstacleCooldowns.set(key, next);
    }

    const rightX = Math.cos(this.headingRad);
    const rightZ = Math.sin(this.headingRad);
    const speedRatio = Math.max(0.35, Math.abs(this.speedKnots) / 20);

    let closestWarningDist = Infinity;
    let closestWarningText: string | null = null;
    let closestHazardSide = 0;

    // -----------------------------------------------------------------------
    // A. Harbor Escort Vessels (Tugs, Pilot Vessel), Harbor Lifeboats, Buoys, Piers, Quay & Breakwaters
    // -----------------------------------------------------------------------
    if (this.harbor.root.visible) {
      const circleObs = this.harbor.getCircleObstacles();
      for (let i = 0; i < circleObs.length; i++) {
        const obs = circleObs[i];
        const dx = obs.x - this.shipX;
        const dz = obs.z - this.shipZ;
        const ahead = dx * fwdX + dz * fwdZ;
        const lateral = dx * rightX + dz * rightZ;

        if (ahead > 72 && ahead < 185 && Math.abs(lateral) < obs.radius + 15) {
          if (ahead < closestWarningDist) {
            closestWarningDist = ahead;
            closestHazardSide = Math.abs(lateral) < 5 ? 0 : lateral < 0 ? -1 : 1;
            closestWarningText =
              obs.kind === 'lifeboat'
                ? 'LIFEBOAT IN CHANNEL AHEAD'
                : obs.kind === 'tug' || obs.kind === 'pilot'
                  ? `${obs.label} CLOSE AHEAD`
                  : `${obs.label} DEAD AHEAD`;
          }
        }

        if (this.obstacleCooldowns.has(obs.id)) continue;

        for (let p = 0; p < HULL_CHECK_POINTS.length; p++) {
          const hp = HULL_CHECK_POINTS[p];
          const px = this.shipX + fwdX * -hp.zLocal;
          const pz = this.shipZ + fwdZ * -hp.zLocal;
          const vx = px - obs.x;
          const vz = pz - obs.z;
          const dist = Math.hypot(vx, vz);
          const minAllowed = obs.radius + hp.radius;
          if (dist < minAllowed) {
            this.obstacleCooldowns.set(obs.id, 1.65);
            const nx = dist > 0.001 ? vx / dist : -rightX;
            const nz = dist > 0.001 ? vz / dist : -rightZ;
            const overlap = minAllowed - dist + 1.6;
            const baseDmg = obs.kind === 'pier' ? 52 : obs.kind === 'tug' || obs.kind === 'pilot' ? 42 : 36;
            this.applyHullBreach(
              baseDmg * speedRatio + 16,
              nx,
              nz,
              overlap,
              (px + obs.x) * 0.5,
              (pz + obs.z) * 0.5,
              speedRatio,
              obs.kind === 'pier' ? 28 : 20,
              p === 0,
              obs.label,
              lateral,
            );
            return;
          }
        }
      }

      const boxObs = this.harbor.getBoxObstacles();
      for (let i = 0; i < boxObs.length; i++) {
        const box = boxObs[i];
        if (this.obstacleCooldowns.has(box.id)) continue;

        for (let p = 0; p < HULL_CHECK_POINTS.length; p++) {
          const hp = HULL_CHECK_POINTS[p];
          const px = this.shipX + fwdX * -hp.zLocal;
          const pz = this.shipZ + fwdZ * -hp.zLocal;
          const cx = THREE.MathUtils.clamp(px, box.minX, box.maxX);
          const cz = THREE.MathUtils.clamp(pz, box.minZ, box.maxZ);
          const vx = px - cx;
          const vz = pz - cz;
          const dist = Math.hypot(vx, vz);
          if (dist < hp.radius) {
            this.obstacleCooldowns.set(box.id, 1.65);
            const nx = dist > 0.001 ? vx / dist : -1;
            const nz = dist > 0.001 ? vz / dist : 0;
            const overlap = hp.radius - dist + 1.8;
            this.applyHullBreach(
              44 * speedRatio + 18,
              nx,
              nz,
              overlap,
              cx,
              cz,
              speedRatio,
              24,
              p === 0,
              box.label,
              1,
            );
            return;
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // B. Titanic's Own Lowered / Floating Lifeboats During Flooding
    // -----------------------------------------------------------------------
    this.ship.crewAndLifeboats.getFloatingLifeboats(this.floatingBoatHazards);
    for (let i = 0; i < this.floatingBoatHazards.length; i++) {
      const fb = this.floatingBoatHazards[i];
      const key = `ship_lb_${fb.index}`;
      if (this.obstacleCooldowns.has(key)) continue;
      for (let p = 0; p < HULL_CHECK_POINTS.length; p++) {
        const hp = HULL_CHECK_POINTS[p];
        const px = this.shipX + fwdX * -hp.zLocal;
        const pz = this.shipZ + fwdZ * -hp.zLocal;
        const vx = px - fb.x;
        const vz = pz - fb.z;
        const dist = Math.hypot(vx, vz);
        if (dist < fb.radius + hp.radius) {
          this.obstacleCooldowns.set(key, 1.8);
          const nx = dist > 0.001 ? vx / dist : -rightX;
          const nz = dist > 0.001 ? vz / dist : -rightZ;
          this.applyHullBreach(
            34 * speedRatio + 14,
            nx,
            nz,
            fb.radius + hp.radius - dist + 1.4,
            (px + fb.x) * 0.5,
            (pz + fb.z) * 0.5,
            speedRatio,
            18,
            p === 0,
            'FLOATING LIFEBOAT',
            1,
          );
          return;
        }
      }
    }

    // -----------------------------------------------------------------------
    // B2. Royal Navy Escort Warships & Surfaced U-Boat Submarines
    // -----------------------------------------------------------------------
    const warshipEntries = [
      { id: 'escort_warship', wx: this.warshipX, wz: this.warshipZ, wh: this.warshipHeadingRad },
      { id: 'escort_warship_2', wx: this.warship2X, wz: this.warship2Z, wh: this.warship2HeadingRad },
    ];
    for (let ew = 0; ew < warshipEntries.length; ew++) {
      const we = warshipEntries[ew];
      if (this.obstacleCooldowns.has(we.id)) continue;
      const wFwdX = Math.sin(we.wh);
      const wFwdZ = -Math.cos(we.wh);
      for (let wi = 0; wi < WARSHIP_HULL_POINTS.length; wi++) {
        const wp = WARSHIP_HULL_POINTS[wi];
        const wx = we.wx + wFwdX * -wp.zLocal;
        const wz = we.wz + wFwdZ * -wp.zLocal;
        for (let p = 0; p < HULL_CHECK_POINTS.length; p++) {
          const hp = HULL_CHECK_POINTS[p];
          const px = this.shipX + fwdX * -hp.zLocal;
          const pz = this.shipZ + fwdZ * -hp.zLocal;
          const vx = px - wx;
          const vz = pz - wz;
          const dist = Math.hypot(vx, vz);
          const minAllowed = wp.radius + hp.radius;
          if (dist < minAllowed) {
            this.obstacleCooldowns.set(we.id, 1.85);
            const nx = dist > 0.001 ? vx / dist : -rightX;
            const nz = dist > 0.001 ? vz / dist : -rightZ;
            const lat = (wx - this.shipX) * rightX + (wz - this.shipZ) * rightZ;
            this.applyHullBreach(
              46 * speedRatio + 18,
              nx,
              nz,
              minAllowed - dist + 2.0,
              (px + wx) * 0.5,
              (pz + wz) * 0.5,
              speedRatio,
              26,
              p === 0,
              'ROYAL NAVY ESCORT WARSHIP',
              lat,
            );
            return;
          }
        }
      }
    }

    for (let si = 0; si < this.submarines.length; si++) {
      const sub = this.submarines[si];
      if (sub.state !== 'hunting' || sub.diveY < -1.5) continue;
      const key = `uboat_${sub.id}`;
      if (this.obstacleCooldowns.has(key)) continue;
      for (let p = 0; p < HULL_CHECK_POINTS.length; p++) {
        const hp = HULL_CHECK_POINTS[p];
        const px = this.shipX + fwdX * -hp.zLocal;
        const pz = this.shipZ + fwdZ * -hp.zLocal;
        const vx = px - sub.x;
        const vz = pz - sub.z;
        const dist = Math.hypot(vx, vz);
        const minAllowed = 14 + hp.radius;
        if (dist < minAllowed) {
          this.obstacleCooldowns.set(key, 1.8);
          const nx = dist > 0.001 ? vx / dist : -rightX;
          const nz = dist > 0.001 ? vz / dist : -rightZ;
          const lat = (sub.x - this.shipX) * rightX + (sub.z - this.shipZ) * rightZ;
          this.applyHullBreach(
            38 * speedRatio + 15,
            nx,
            nz,
            minAllowed - dist + 1.8,
            (px + sub.x) * 0.5,
            (pz + sub.z) * 0.5,
            speedRatio,
            18,
            p === 0,
            `HOSTILE U-BOAT ${sub.label}`,
            lat,
          );
          return;
        }
      }
    }

    // -----------------------------------------------------------------------
    // C. Icebergs (Lookout Bell, Hull Breach & Near-Miss Bonus)
    // -----------------------------------------------------------------------
    for (const berg of this.icebergs) {
      const dx = berg.x - this.shipX;
      const dz = berg.z - this.shipZ;
      const ahead = dx * fwdX + dz * fwdZ; // +74 is bow tip
      const lateral = dx * rightX + dz * rightZ; // negative = Port, positive = Starboard

      // 1. Crow's Nest Warning Check
      if (ahead > 80 && ahead < 260 && Math.abs(lateral) < berg.collisionRadius + 18) {
        if (ahead < closestWarningDist) {
          closestWarningDist = ahead;
          closestHazardSide = Math.abs(lateral) < 6 ? 0 : lateral < 0 ? -1 : 1;
          closestWarningText =
            Math.abs(lateral) < 9
              ? 'ICEBERG DEAD AHEAD'
              : lateral < 0
                ? 'ICEBERG OFF PORT BOW'
                : 'ICEBERG OFF STARBOARD BOW';
        }
        if (!berg.warned && ahead < 200) {
          berg.warned = true;
          this.sound.playLookoutBell();
        }
      }

      // 2. Multi-point Hull Collision Check
      if (berg.hitCooldown <= 0) {
        let hit = false;
        let hitPtX = 0;
        let hitPtZ = 0;
        let isBowRam = false;

        for (let p = 0; p < HULL_CHECK_POINTS.length; p++) {
          const hp = HULL_CHECK_POINTS[p];
          const px = this.shipX + fwdX * -hp.zLocal;
          const pz = this.shipZ + fwdZ * -hp.zLocal;
          const dist = Math.hypot(berg.x - px, berg.z - pz);
          if (dist < berg.collisionRadius + hp.radius) {
            hit = true;
            hitPtX = (px + berg.x) * 0.5;
            hitPtZ = (pz + berg.z) * 0.5;
            isBowRam = p === 0 && Math.abs(lateral) < berg.collisionRadius * 0.6;
            break;
          }
        }

        if (hit) {
          berg.hitCooldown = 1.65;
          berg.nearMissAwarded = true;
          const pushSide = lateral >= 0 ? -1 : 1;
          const rawDmg = isBowRam ? 44 * speedRatio + 16 : 30 * speedRatio + 12;
          this.applyHullBreach(
            rawDmg,
            rightX * pushSide,
            rightZ * pushSide,
            2.6,
            hitPtX,
            hitPtZ,
            speedRatio,
            isBowRam ? 24 : 14,
            isBowRam,
            'NORTH ATLANTIC ICEBERG',
            lateral,
          );
          continue;
        }
      }

      // 3. Near-Miss "Clean Passage" Check
      if (!berg.nearMissAwarded && ahead < 18 && ahead > -185) {
        const clearance = Math.abs(lateral) - (berg.collisionRadius + 13.8);
        if (clearance > 0 && clearance < 17) {
          berg.nearMissAwarded = true;
          const pts = 250 * this.combo;
          this.score += pts;
          this.nearMissCount += 1;
          this.combo = Math.min(5, this.combo + 1);
          this.sound.playNearMissChime();
          this.eventText = `CLEAN PASSAGE +${pts}`;
          this.eventTimer = 1.9;
          this.emitTelemetry();
        }
      }
    }

    this.closestHazardSide = closestHazardSide;
    this.icebergWarning = closestWarningText;
  }

  // =========================================================================
  // CAMERA RIG (Title Harbor Sweep + Free 360° Orbit + Wheelhouse & Interior Decks)
  // =========================================================================
  private updateTitleCamera(): void {
    // Graceful sunlit harbor vista from port-bow water framing Titanic & Berth 44 terminal
    const drift = Math.sin(this.simTime * 0.18);
    const camX = -98 + drift * 18;
    const camY = 25.5 + Math.cos(this.simTime * 0.24) * 2.2;
    const camZ = -108 + drift * 16;

    this.camera.position.set(this.shipX + camX, camY, this.shipZ + camZ);
    this.camera.lookAt(this.shipX + 8, 15.0, this.shipZ + 38);
  }

  private updateCamera(dt: number): void {
    const spec = VESSEL_SPOTS[this.focusSpotIndex];
    const targetX = spec.localTarget[0] + this.interiorWalkOffset.x;
    const targetY = spec.localTarget[1] + this.interiorWalkOffset.y;
    const targetZ = spec.localTarget[2] + this.interiorWalkOffset.z;

    // Smoothly damp focus position & spherical orbit coordinates
    this.camFocusLocal.x = THREE.MathUtils.damp(this.camFocusLocal.x, targetX, 7, dt);
    this.camFocusLocal.y = THREE.MathUtils.damp(this.camFocusLocal.y, targetY, 7, dt);
    this.camFocusLocal.z = THREE.MathUtils.damp(this.camFocusLocal.z, targetZ, 7, dt);
    this.orbitYaw = THREE.MathUtils.damp(this.orbitYaw, this.targetOrbitYaw, 7, dt);
    this.orbitPitch = THREE.MathUtils.damp(this.orbitPitch, this.targetOrbitPitch, 7, dt);
    this.orbitDistance = THREE.MathUtils.damp(this.orbitDistance, this.targetOrbitDistance, 7, dt);

    // Transform local ship spot into world space respecting intact/split bow & stern half transforms
    _vFocusLocal.copy(this.camFocusLocal);

    const isSinkOrAfter =
      this.phase === 'sinking' || this.phase === 'aftermath' || this.phase === 'gameover';
    const isOverviewShip = spec.id === 'funnels' && isSinkOrAfter;

    if (isOverviewShip) {
      // Pan focus smoothly from midships toward the stern plunge site while keeping camera at sea level
      const panT = THREE.MathUtils.clamp((this.sinkProgress - 0.42) / 0.42, 0, 1);
      _vFocusLocal.z = THREE.MathUtils.lerp(62, 118, panT);
    }

    const useSternHalf = spec.id === 'stern' || spec.id === 'engine';
    const halfGroup = useSternHalf ? this.ship.sternGroup : this.ship.bowGroup;
    const halfY = halfGroup.position.y;
    const halfPitch = halfGroup.rotation.x;
    const hullRoll = this.ship.hullMeshGroup.rotation.z;

    const dzFromBreak = _vFocusLocal.z - BREAK_Z;
    const rotY = _vFocusLocal.y * Math.cos(halfPitch) - dzFromBreak * Math.sin(halfPitch);
    const rotZ = BREAK_Z + _vFocusLocal.y * Math.sin(halfPitch) + dzFromBreak * Math.cos(halfPitch);
    const shiftedY = halfY + rotY;
    const rolledX = _vFocusLocal.x * Math.cos(hullRoll) - shiftedY * Math.sin(hullRoll);
    const rolledY = _vFocusLocal.x * Math.sin(hullRoll) + shiftedY * Math.cos(hullRoll);

    let worldXLocal = rolledX;
    let worldY = rolledY;
    let worldZLocal = rotZ;

    if (this.phase === 'aftermath' || this.phase === 'gameover') {
      worldXLocal = _vFocusLocal.x;
      worldY = 4.2;
      worldZLocal = _vFocusLocal.z;
    } else if (isOverviewShip) {
      const sternY = this.ship.sternGroup.position.y;
      const sternPitch = this.ship.sternGroup.rotation.x;
      const sternTipWorldY = sternY + 10 * Math.cos(sternPitch) - (195.1 - BREAK_Z) * Math.sin(sternPitch);
      worldXLocal = _vFocusLocal.x;
      worldY = THREE.MathUtils.clamp(Math.max(4.5, sternTipWorldY * 0.38), 3.5, 24.0);
      worldZLocal = _vFocusLocal.z;
    }

    _vFwd.set(Math.sin(this.headingRad), 0, -Math.cos(this.headingRad));
    _vRight.set(Math.cos(this.headingRad), 0, Math.sin(this.headingRad));

    const focusSub =
      this.submarines.find((s) => s.state === 'hunting' || s.state === 'sinking') ||
      this.submarines[0];

    if (
      (this.phase === 'aftermath' || this.phase === 'gameover') &&
      this.aftermathFocus === 'carpathia' &&
      this.carpathia.root.visible
    ) {
      _vFocusWorld.copy(this.carpathia.root.position);
      _vFocusWorld.y = 7.5;
    } else if (
      (((this.phase === 'aftermath' || this.phase === 'gameover') &&
        this.aftermathFocus === 'submarines') ||
        spec.id === 'submarine') &&
      focusSub &&
      focusSub.rig.root.visible
    ) {
      _vFwd.set(Math.sin(focusSub.headingRad), 0, -Math.cos(focusSub.headingRad));
      _vRight.set(Math.cos(focusSub.headingRad), 0, Math.sin(focusSub.headingRad));
      _vFocusWorld.set(focusSub.x, Math.max(0.5, focusSub.diveY + 3.2), focusSub.z);
    } else if (
      ((this.phase === 'aftermath' || this.phase === 'gameover') &&
        this.aftermathFocus === 'warship') ||
      spec.id === 'warship'
    ) {
      _vFwd.set(Math.sin(this.warshipHeadingRad), 0, -Math.cos(this.warshipHeadingRad));
      _vRight.set(Math.cos(this.warshipHeadingRad), 0, Math.sin(this.warshipHeadingRad));
      _vFocusWorld.set(this.warshipX, this.warship.root.position.y + 9.5, this.warshipZ);
    } else {
      _vFocusWorld
        .set(this.shipX, worldY, this.shipZ)
        .addScaledVector(_vRight, worldXLocal)
        .addScaledVector(_vFwd, -worldZLocal);
    }

    // Compute unit look direction in ship-local frame, rotated by ship heading
    const cosP = Math.cos(this.orbitPitch);
    const localDirX = -Math.sin(this.orbitYaw) * cosP;
    const localDirY = -Math.sin(this.orbitPitch);
    const localDirZ = -Math.cos(this.orbitYaw) * cosP;

    _vLookDir
      .set(0, localDirY, 0)
      .addScaledVector(_vRight, localDirX)
      .addScaledVector(_vFwd, -localDirZ)
      .normalize();

    _vCamPos.copy(_vFocusWorld).addScaledVector(_vLookDir, -this.orbitDistance);

    // Keep exterior cruising/aftermath camera above waves, while allowing cockpit, interior decks & sinking spots underwater
    const isInterior =
      (spec.id === 'wheelhouse' || spec.category === 'interior') && this.orbitDistance < 12;
    const allowUnderwater =
      isInterior ||
      (this.phase === 'sinking' && !isOverviewShip);
    if (!allowUnderwater && this.orbitDistance > 1.5 && _vCamPos.y < 1.25) {
      _vCamPos.y = 1.25;
    } else if (!allowUnderwater && this.orbitDistance <= 1.5 && _vCamPos.y < 0.85) {
      _vCamPos.y = 0.85;
    }

    _vCamTarget.copy(_vCamPos).addScaledVector(_vLookDir, 40);

    // Apply decaying camera shake
    if (this.shakeIntensity > 0.001) {
      const s = this.shakeIntensity * 0.38;
      _vCamPos.x += (Math.random() - 0.5) * s;
      _vCamPos.y += (Math.random() - 0.5) * s;
      _vCamPos.z += (Math.random() - 0.5) * s;
    }

    this.camera.position.copy(_vCamPos);
    this.camera.lookAt(_vCamTarget);

    // Subtle ship roll feel when standing inside wheelhouse or interior decks
    const rollInfluence = isInterior ? 0.55 : 0.08;
    this.camera.rotation.z += this.rollAngle * rollInfluence;
  }

  private saveBestScore(): void {
    const rounded = Math.round(this.score);
    if (rounded > this.bestScore) {
      this.bestScore = rounded;
      try {
        localStorage.setItem(BEST_SCORE_KEY, String(this.bestScore));
      } catch {
        // ignore storage errors
      }
    }
  }

  private emitTelemetry(): void {
    const rawDeg = THREE.MathUtils.radToDeg(this.headingRad) % 360;
    const headingDeg = Math.round((rawDeg + 360) % 360);
    const breached = Math.min(5, Math.floor((100 - this.hullIntegrity) / 20));
    const cooldownPct =
      this.searchlightTimer > 0
        ? 0
        : this.searchlightCooldown > 0
          ? this.searchlightCooldown / this.searchlightMaxCooldown
          : 0;
    const spot = VESSEL_SPOTS[this.focusSpotIndex];
    const inHarborZone = this.nightMix < 0.35;
    const zoneLabel =
      this.nightMix < 0.15
        ? 'SOUTHAMPTON BERTH 44 & CHANNEL'
        : this.nightMix < 0.72
          ? 'ENGLISH CHANNEL · DUSK PASSAGE'
          : 'APRIL 14 NIGHT · ICE ALLEY';

    this.onTelemetry({
      phase: this.phase,
      cameraMode: this.cameraMode,
      focusSpotId: spot.id,
      focusSpotLabel: spot.label,
      focusSpotCategory: spot.category,
      headingDeg,
      rudderDeg: Math.round(this.rudderDeg),
      speedKnots: Math.round(this.speedKnots),
      telegraphIndex: this.telegraphIndex,
      distanceNm: Number(this.distanceNm.toFixed(1)),
      targetDistanceNm: TARGET_VOYAGE_NM,
      hullIntegrity: Math.round(this.hullIntegrity),
      floodingPct: Math.round(this.floodingPct),
      waterIngressRate: Number(this.waterIngressRate.toFixed(1)),
      compartmentsBreached: breached,
      sinkProgress: this.sinkProgress,
      lifeboatsLaunched: this.lifeboatsLaunched,
      aftermathSeconds: Math.floor(this.aftermathSeconds),
      carpathiaStage: this.carpathiaStage,
      carpathiaEtaSec: Math.max(0, Math.ceil(60 - this.aftermathSeconds)),
      carpathiaDistanceM: this.carpathiaDistanceM,
      survivorsRescued: this.survivorsRescued,
      boatsRecovered: this.boatsRecovered,
      warshipRescuing: this.warshipRescuing,
      warshipSurvivors: this.warshipSurvivors,
      warshipBoatsRecovered: this.warshipBoatsRecovered,
      activeSubmarines: this.submarines.filter((s) => s.state === 'hunting' || s.state === 'sinking').length,
      submarinesSunk: this.submarinesSunk,
      focusCarpathia: this.aftermathFocus === 'carpathia',
      aftermathFocus: this.aftermathFocus,
      inHarborZone,
      zoneLabel,
      score: Math.round(this.score),
      bestScore: Math.max(this.bestScore, Math.round(this.score)),
      nearMissCount: this.nearMissCount,
      combo: this.combo,
      searchlightActive: this.searchlightTimer > 0,
      searchlightCooldownPct: cooldownPct,
      icebergWarning: this.icebergWarning,
      lastEventText: this.eventText,
      autopilotEnabled: this.autopilotEnabled,
      bowPanicActive: this.bowPanicActive,
      endlessMode: this.endlessMode,
      isMuted: this.sound.isMuted(),
    });
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.unbindEvents();
    this.sound.dispose();
    this.ship.dispose();
    this.carpathia.dispose();
    this.warship.dispose();
    this.warship2.dispose();
    for (const sub of this.submarines) {
      sub.rig.dispose();
    }
    this.projectileMesh.geometry.dispose();
    (this.projectileMesh.material as THREE.Material).dispose();
    this.harbor.dispose();
    this.oceanAndSky.dispose();
    this.iceFactory.dispose();
    this.particles.dispose();
    this.textures.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
