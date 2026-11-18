import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SoundEngine } from './audio';
import { buildCarpathiaShip, CarpathiaRig } from './carpathiaBuilder';
import { buildSouthamptonHarbor, HarborRig } from './harborBuilder';
import { IcebergEntity, IcebergFactory } from './icebergBuilder';
import { createOceanAndSky, OceanAndSkyRig, ParticlePool } from './oceanAndSky';
import { buildTitanicShip, BREAK_Z, TitanicShipRig } from './shipBuilder';
import { createProceduralTextures, ProceduralTextureSet } from './textures';
import {
  CameraMode,
  CarpathiaStage,
  GamePhase,
  HARBOR_CHAPTERS,
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

export class TitanicEngine {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly isSoftwareGl: boolean;

  private readonly textures: ProceduralTextureSet;
  private readonly ship: TitanicShipRig;
  private readonly carpathia: CarpathiaRig;
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
  private focusCarpathia = false;
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

  // Free 360° mouse orbit, zoom & vessel focus spot camera
  private focusSpotIndex = 0;
  private camFocusLocal = new THREE.Vector3(0, 14.78, 1.32);
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

  // Harbor Introduction & Day-to-Night Time-Skip State
  private harborChapterIndex = 0;
  private harborProgress = 0;
  private harborAutoPlay = true;
  private userOverrodeHarborCam = false;
  private timeSkipProgress = 0;
  private nightMix = 0;
  private readonly tempSkyColor = new THREE.Color();
  private readonly tempColorA = new THREE.Color();
  private readonly tempColorB = new THREE.Color();

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
    this.renderer.toneMappingExposure = 1.15;
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

    // Searchlight SpotLight attached to forward bridge roof (sinks with bow half)
    this.searchSpotLight = new THREE.SpotLight(0xeef8ff, 24, 480, Math.PI / 9, 0.55, 1.1);
    this.searchSpotLight.position.set(0, 16.25, -1.5);
    this.searchSpotLight.target = this.ship.searchlightTarget;
    this.ship.bowContent.add(this.searchSpotLight);

    this.iceFactory = new IcebergFactory(this.textures);
    this.particles = new ParticlePool(320);
    this.scene.add(this.particles.mesh);

    // Start Title screen in bright sunlit Southampton Harbor Berth 44
    this.applyAtmosphere(0);
    this.oceanAndSky.update(0, 0, 0, 0, 0, 0);
    this.harbor.update(0, 0, 0);

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
    const initialSet: Array<{ variant: IcebergVariant; x: number; z: number; scale: number }> = [
      { variant: 'pinnacle', x: -46, z: -185, scale: 1.05 },
      { variant: 'tabular', x: 52, z: -245, scale: 1.15 },
      { variant: 'growler', x: -16, z: -290, scale: 0.95 },
      { variant: 'pinnacle', x: 64, z: -360, scale: 1.2 },
      { variant: 'tabular', x: -62, z: -395, scale: 1.0 },
    ];
    for (const item of initialSet) {
      const berg = this.iceFactory.spawnIceberg(item.variant, item.x, item.z, item.scale);
      this.icebergs.push(berg);
      this.scene.add(berg.group);
    }
  }

  private clearIcebergs(): void {
    for (const b of this.icebergs) {
      this.scene.remove(b.group);
    }
    this.icebergs.length = 0;
  }

  // =========================================================================
  // PUBLIC CONTROLS FOR REACT UI & KEYBOARD
  // =========================================================================
  public startHarborIntro(): void {
    this.sound.unlock();
    this.clearIcebergs();
    this.phase = 'harbor';
    this.endlessMode = false;
    this.shipX = 0;
    this.shipZ = 0;
    this.headingRad = 0;
    this.yawRate = 0;
    this.rudderDeg = 0;
    this.manualRudderTarget = null;
    this.wheelVisualAngle = 0;
    this.rollAngle = 0;
    this.telegraphIndex = 2; // SLOW AHEAD departing harbor
    this.speedKnots = 0;
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
    this.lifeboatsLaunched = 0;
    this.score = 0;
    this.nearMissCount = 0;
    this.combo = 1;
    this.searchlightTimer = 0;
    this.searchlightCooldown = 0;
    this.hitstopTimer = 0;
    this.shakeIntensity = 0;
    this.damageFlashTimer = 0;
    this.eventText = null;
    this.eventTimer = 0;
    this.icebergWarning = null;
    this.spawnAccumDist = 0;
    this.userAdjustedCameraInSink = false;
    this.autoFocusedSinkLifeboats = false;
    this.hasBrokenInTwo = false;
    this.autoFocusedBreakup = false;

    this.harborChapterIndex = 0;
    this.harborProgress = 0;
    this.harborAutoPlay = true;
    this.userOverrodeHarborCam = false;
    this.timeSkipProgress = 0;
    this.harbor.root.visible = true;
    this.applyAtmosphere(0);

    this.resetShipRigPose();
    this.ship.setWheelhouseFloodLevel(0);
    this.applyHarborChapterCamera(0, true);

    this.sound.playSteamWhistle();
    this.sound.playTelegraphBell();
    this.emitTelemetry();
  }

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
    this.focusCarpathia = false;
    this.flareCooldown = 4.0;
  }

  public setHarborChapter(idx: number): void {
    if (this.phase !== 'harbor') return;
    const clamped = Math.max(0, Math.min(HARBOR_CHAPTERS.length - 1, idx));
    this.harborChapterIndex = clamped;
    this.harborProgress = HARBOR_CHAPTERS[clamped].startProgress + 0.01;
    this.userOverrodeHarborCam = false;
    this.applyHarborChapterCamera(clamped, false);
    this.sound.playTelegraphBell();
    this.emitTelemetry();
  }

  public nextHarborChapter(): void {
    if (this.phase !== 'harbor') return;
    if (this.harborChapterIndex >= HARBOR_CHAPTERS.length - 1) {
      this.skipHarborToNight();
    } else {
      this.setHarborChapter(this.harborChapterIndex + 1);
    }
  }

  public prevHarborChapter(): void {
    if (this.phase !== 'harbor') return;
    this.setHarborChapter(Math.max(0, this.harborChapterIndex - 1));
  }

  public toggleHarborAutoPlay(): void {
    if (this.phase !== 'harbor') return;
    this.harborAutoPlay = !this.harborAutoPlay;
    this.emitTelemetry();
  }

  public skipHarborToNight(): void {
    this.sound.unlock();
    if (this.phase !== 'harbor') return;
    // Place ship cleanly beyond the harbor breakwater mouth and begin the 4-day sunset-to-night time-lapse
    this.harborProgress = 1.0;
    this.shipZ = Math.min(this.shipZ, -585);
    this.beginTimeSkip();
  }

  private beginTimeSkip(): void {
    this.phase = 'timeskip';
    this.timeSkipProgress = 0;
    this.telegraphIndex = 4; // FULL AHEAD
    this.userOverrodeHarborCam = false;
    this.sound.playTelegraphBell();
    this.emitTelemetry();
  }

  private applyHarborChapterCamera(idx: number, snapImmediate: boolean): void {
    const ch = HARBOR_CHAPTERS[idx];
    const spotIdx = VESSEL_SPOTS.findIndex((s) => s.id === ch.focusSpotId);
    if (spotIdx !== -1) {
      this.focusSpotIndex = spotIdx;
    }
    this.targetOrbitYaw = ch.orbitYaw;
    this.targetOrbitPitch = ch.orbitPitch;
    this.targetOrbitDistance = ch.orbitDistance;
    this.cameraMode = ch.focusSpotId === 'wheelhouse' ? 'wheelhouse' : 'bridgeWing';

    if (snapImmediate && spotIdx !== -1) {
      const spec = VESSEL_SPOTS[spotIdx];
      this.camFocusLocal.set(spec.localTarget[0], spec.localTarget[1], spec.localTarget[2]);
      this.orbitYaw = ch.orbitYaw;
      this.orbitPitch = ch.orbitPitch;
      this.orbitDistance = ch.orbitDistance;
    }
  }

  public startGame(): void {
    this.sound.unlock();
    this.phase = 'playing';
    this.endlessMode = false;
    this.shipX = 0;
    this.shipZ = 0;
    this.headingRad = 0;
    this.yawRate = 0;
    this.rudderDeg = 0;
    this.manualRudderTarget = null;
    this.wheelVisualAngle = 0;
    this.rollAngle = 0;
    this.telegraphIndex = 4; // FULL AHEAD
    this.speedKnots = 18;
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
    this.eventText = 'ALL AHEAD FULL — ICE WATCH';
    this.eventTimer = 2.8;
    this.icebergWarning = null;
    this.spawnAccumDist = 0;
    this.userAdjustedCameraInSink = false;
    this.autoFocusedSinkLifeboats = false;
    this.hasBrokenInTwo = false;
    this.autoFocusedBreakup = false;

    this.harbor.root.visible = false;
    this.applyAtmosphere(1.0);

    this.resetShipRigPose();
    this.ship.setPowerLevel(1);
    this.ship.setWheelhouseFloodLevel(0);
    this.focusVesselSpot('wheelhouse', false);

    this.seedInitialIcebergs();
    this.sound.playTelegraphBell();
    this.emitTelemetry();
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
      this.emitTelemetry();
    }
  }

  public focusOnCarpathia(enable: boolean): void {
    if (this.phase !== 'aftermath' && this.phase !== 'gameover') return;
    this.focusCarpathia = enable && this.carpathia.root.visible;
    if (this.focusCarpathia) {
      this.targetOrbitYaw = 0.85;
      this.targetOrbitPitch = 0.16;
      this.targetOrbitDistance = 122;
    } else {
      this.targetOrbitYaw = 0.72;
      this.targetOrbitPitch = 0.22;
      this.targetOrbitDistance = 135;
    }
    this.emitTelemetry();
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
    this.focusCarpathia = false;
    this.flareCooldown = 3.5;
    this.carpathia.root.visible = false;
    if (VESSEL_SPOTS[this.focusSpotIndex].id === 'wheelhouse') {
      this.focusVesselSpot('funnels', false);
    }
    this.eventText = 'RMS TITANIC SUBMERGED — SIGNALING FOR RESCUE';
    this.eventTimer = 5.5;
    this.saveBestScore();
    this.emitTelemetry();
  }

  public returnToTitle(): void {
    this.phase = 'title';
    this.heldKeys.clear();
    this.clearIcebergs();
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
    this.harbor.root.visible = true;
    this.applyAtmosphere(0);
    this.resetShipRigPose();
    this.ship.setWheelhouseFloodLevel(0);
    this.focusVesselSpot('wheelhouse', false);
    this.emitTelemetry();
  }

  public setTelegraphIndex(idx: number): void {
    this.sound.unlock();
    const clamped = Math.max(0, Math.min(TELEGRAPH_NOTCHES.length - 1, idx));
    if (clamped !== this.telegraphIndex) {
      this.telegraphIndex = clamped;
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
    this.targetOrbitYaw = spec.defaultOrbitYaw;
    this.targetOrbitPitch = spec.defaultOrbitPitch;
    this.targetOrbitDistance = spec.defaultDistance;
    this.cameraMode = spec.id === 'wheelhouse' ? 'wheelhouse' : 'bridgeWing';

    if (this.phase === 'sinking' && announce) {
      this.userAdjustedCameraInSink = true;
    }
    if (this.phase === 'harbor' && announce) {
      this.userOverrodeHarborCam = true;
    }
    if (announce && this.phase === 'playing') {
      this.eventText = `VIEW: ${spec.label.toUpperCase()}`;
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
        this.startHarborIntro();
      }
      return;
    }

    if (this.phase === 'harbor') {
      if (code === 'ArrowRight' || code === 'KeyN') {
        e.preventDefault();
        this.nextHarborChapter();
      } else if (code === 'ArrowLeft' || code === 'KeyB') {
        e.preventDefault();
        this.prevHarborChapter();
      } else if (code === 'KeyS') {
        e.preventDefault();
        this.cycleFocusSpot();
      } else if (code === 'Enter' || code === 'Space') {
        e.preventDefault();
        this.skipHarborToNight();
      }
      return;
    }

    if (this.phase === 'timeskip') {
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
    if (this.phase === 'title' || this.phase === 'paused' || this.phase === 'timeskip') return;
    this.sound.unlock();
    this.isPointerDown = true;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  };

  private readonly handlePointerMove = (e: PointerEvent) => {
    if (!this.isPointerDown || this.phase === 'title' || this.phase === 'paused' || this.phase === 'timeskip') return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.targetOrbitYaw -= dx * 0.0062;
    this.targetOrbitPitch = THREE.MathUtils.clamp(
      this.targetOrbitPitch + dy * 0.0045,
      -0.32,
      1.18,
    );
    if (this.phase === 'sinking') {
      this.userAdjustedCameraInSink = true;
    } else if (this.phase === 'harbor') {
      this.userOverrodeHarborCam = true;
    }
  };

  private readonly handlePointerUp = () => {
    this.isPointerDown = false;
  };

  private readonly handleWheel = (e: WheelEvent) => {
    if (this.phase === 'title' || this.phase === 'paused' || this.phase === 'timeskip') return;
    e.preventDefault();
    const minDist = VESSEL_SPOTS[this.focusSpotIndex].id === 'wheelhouse' ? 0 : 6;
    const step = e.deltaY * 0.045;
    this.targetOrbitDistance = THREE.MathUtils.clamp(
      this.targetOrbitDistance + step,
      minDist,
      260,
    );
    if (this.phase === 'sinking') {
      this.userAdjustedCameraInSink = true;
    } else if (this.phase === 'harbor') {
      this.userOverrodeHarborCam = true;
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

    if (this.phase === 'title') {
      // Sunlit Southampton Harbor moored beauty pan on Title Screen
      this.applyAtmosphere(0);
      this.rudderDeg = Math.sin(this.simTime * 0.35) * 4;
      this.wheelVisualAngle = THREE.MathUtils.damp(this.wheelVisualAngle, -this.rudderDeg * 0.11, 5, dt);
      this.ship.helmWheel.rotation.z = this.wheelVisualAngle;
      this.updateShipVisualRig(dt, 0);
      this.ship.crewAndLifeboats.updateCruising(this.simTime, dt, 0);
      this.harbor.update(this.simTime, this.shipZ, 0);
      this.emitBowSpray(dt, 0, -1, true);
      this.oceanAndSky.update(this.simTime, this.shipX, this.shipZ, 0, 0, 0);
      this.particles.update(dt);
      this.updateTitleCamera();
      this.sound.updateShipAmbience(2, false);
      return;
    }

    if (this.phase === 'harbor') {
      this.stepHarborSequence(dt);
      return;
    }

    if (this.phase === 'timeskip') {
      this.stepTimeSkipSequence(dt);
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
        this.ship.crewAndLifeboats.updateCruising(this.simTime, dt, this.floodingPct);
      } else {
        this.advanceRescueSimulation(dt);
      }
      this.oceanAndSky.update(this.simTime, this.shipX, this.shipZ, this.headingRad, this.speedKnots, 1.0);
      this.particles.update(dt);
      this.updateCamera(dt);
      this.sound.updateShipAmbience(this.speedKnots, false);
      return;
    }

    // =======================================================================
    // ACTIVE GAMEPLAY SIMULATION
    // =======================================================================
    const steerLeft = this.heldKeys.has('KeyA') || this.heldKeys.has('ArrowLeft');
    const steerRight = this.heldKeys.has('KeyD') || this.heldKeys.has('ArrowRight');

    const prevRudder = this.rudderDeg;
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

    // Subtle mechanical helm spoke sound when steering actively
    if (Math.abs(this.rudderDeg - prevRudder) > 0.1) {
      this.helmTickAccum += Math.abs(this.rudderDeg - prevRudder);
      if (this.helmTickAccum > 9) {
        this.helmTickAccum = 0;
        this.sound.playHelmTick();
      }
    }

    // Telegraph speed interpolation (massive liner inertia)
    const targetKnots = TELEGRAPH_NOTCHES[this.telegraphIndex].targetKnots;
    const accelRate = targetKnots < this.speedKnots ? 0.75 : 0.48;
    this.speedKnots = THREE.MathUtils.damp(this.speedKnots, targetKnots, accelRate, dt);

    // Rudder authority scales with speed (with a minimum low-speed authority so player never stalls)
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

    // Progressive water ingress when forward compartments are breached
    if (this.hullIntegrity <= 78) {
      const damageSeverity = (80 - this.hullIntegrity) / 80; // 0.025 -> 1.0
      this.waterIngressRate = 0.65 + damageSeverity * damageSeverity * 5.2;
      this.floodingPct = Math.min(100, this.floodingPct + this.waterIngressRate * dt);
    } else {
      this.waterIngressRate = 0;
    }

    const floodNorm = this.floodingPct / 100;
    this.sinkDropY = -floodNorm * 2.2;
    this.sinkPitch = -floodNorm * 0.088;
    this.sinkList = this.listDirection * floodNorm * 0.095;
    this.ship.setWheelhouseFloodLevel(floodNorm > 0.78 ? ((floodNorm - 0.78) / 0.22) * 0.14 : 0);

    // Update Ship Transforms, Crew, Wheel, Telegraph, Bow Spray & Light Rig
    this.updateShipVisualRig(dt, this.speedKnots);
    this.ship.crewAndLifeboats.updateCruising(this.simTime, dt, this.floodingPct);
    this.emitBowSpray(dt, fwdX, fwdZ);
    this.oceanAndSky.update(this.simTime, this.shipX, this.shipZ, this.headingRad, this.speedKnots, 1.0);

    // Iceberg Spawning, Motion, Warnings, Near-Miss & Collision
    this.manageIcebergField(dt, worldSpeed, fwdX, fwdZ);
    this.checkIcebergInteractions(dt, fwdX, fwdZ);

    this.particles.update(dt);
    this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 1.9);

    this.updateCamera(dt);
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

  private applyAtmosphere(nightMix: number): void {
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

  private stepHarborSequence(dt: number): void {
    this.applyAtmosphere(0);

    if (this.harborAutoPlay) {
      this.harborProgress = Math.min(1, this.harborProgress + dt / 36.0);
    }

    // Track current chapter based on progress
    let chIdx = 0;
    for (let i = 0; i < HARBOR_CHAPTERS.length; i++) {
      if (this.harborProgress >= HARBOR_CHAPTERS[i].startProgress) {
        chIdx = i;
      }
    }
    if (chIdx !== this.harborChapterIndex) {
      this.harborChapterIndex = chIdx;
      if (!this.userOverrodeHarborCam) {
        this.applyHarborChapterCamera(chIdx, false);
      }
      this.emitTelemetry();
    }

    // Smoothly sail Titanic from Berth 44 (z = 0) past channel buoys & breakwater mouth (z = -620)
    const targetZ = -this.harborProgress * 620;
    const prevZ = this.shipZ;
    this.shipZ = THREE.MathUtils.damp(this.shipZ, targetZ, 2.2, dt);
    const velUnits = Math.max(0, (prevZ - this.shipZ) / Math.max(dt, 0.001));
    this.speedKnots = THREE.MathUtils.damp(this.speedKnots, Math.min(14, velUnits / 1.9), 3.0, dt);

    // Subtle helm demonstration when showing Chapter 4 inside the Wheelhouse
    if (this.harborChapterIndex === 3) {
      this.rudderDeg = Math.sin(this.simTime * 1.1) * 14;
      this.telegraphIndex = 3; // HALF AHEAD
    } else {
      this.rudderDeg = THREE.MathUtils.damp(this.rudderDeg, 0, 3, dt);
      this.telegraphIndex = 2;
    }

    this.updateShipVisualRig(dt, this.speedKnots);
    this.ship.crewAndLifeboats.updateCruising(this.simTime, dt, 0);
    this.harbor.update(this.simTime, this.shipZ, 0);
    this.emitBowSpray(dt, 0, -1, true);
    this.oceanAndSky.update(this.simTime, this.shipX, this.shipZ, this.headingRad, this.speedKnots, 0);
    this.particles.update(dt);
    this.updateCamera(dt);
    this.sound.updateShipAmbience(this.speedKnots, true);

    if (this.harborProgress >= 1.0 && this.shipZ <= -560) {
      this.beginTimeSkip();
      return;
    }

    this.telemetryAccum += dt;
    if (this.telemetryAccum >= 0.08) {
      this.telemetryAccum = 0;
      this.emitTelemetry();
    }
  }

  private stepTimeSkipSequence(dt: number): void {
    this.timeSkipProgress = Math.min(1, this.timeSkipProgress + dt / 4.4);
    const p = this.timeSkipProgress;

    // 4-day Atlantic crossing time-lapse: Noon -> Golden Sunset -> Starlit Arctic Night
    const nightMix = THREE.MathUtils.smoothstep(p, 0.05, 0.92);
    this.applyAtmosphere(nightMix);

    // Surge ahead away from harbor mouth into open sea
    this.speedKnots = THREE.MathUtils.lerp(13, 20, THREE.MathUtils.smoothstep(p, 0.0, 0.75));
    const surgeSpeed = this.speedKnots * 4.2; // accelerated time-lapse visual wake
    this.shipZ -= surgeSpeed * dt;

    // Harbor fades out behind in the distance
    this.harbor.root.visible = p < 0.48;
    if (this.harbor.root.visible) {
      this.harbor.update(this.simTime, this.shipZ, nightMix);
    }

    // Glide camera cleanly from exterior sea view back into the Wheelhouse Helm before player takes control
    if (p > 0.36 && VESSEL_SPOTS[this.focusSpotIndex].id !== 'wheelhouse') {
      this.focusVesselSpot('wheelhouse', false);
    }

    this.rudderDeg = THREE.MathUtils.damp(this.rudderDeg, 0, 4, dt);
    this.updateShipVisualRig(dt, this.speedKnots);
    this.ship.crewAndLifeboats.updateCruising(this.simTime, dt, 0);
    this.emitBowSpray(dt, 0, -1);
    this.oceanAndSky.update(this.simTime, this.shipX, this.shipZ, 0, this.speedKnots, nightMix);
    this.particles.update(dt);
    this.updateCamera(dt);
    this.sound.updateShipAmbience(this.speedKnots, true);

    if (this.timeSkipProgress >= 1.0) {
      // Transition cleanly into Ice Alley Night Watch at (0, 0)
      this.startGame();
      return;
    }

    this.telemetryAccum += dt;
    if (this.telemetryAccum >= 0.05) {
      this.telemetryAccum = 0;
      this.emitTelemetry();
    }
  }

  private triggerSinking(): void {
    this.hullIntegrity = Math.max(0, this.hullIntegrity);
    this.floodingPct = 100;
    this.waterIngressRate = 0;
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

        if (!this.userAdjustedCameraInSink && !this.autoFocusedBreakup) {
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
    this.ship.setWheelhouseFloodLevel(whFlood);

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

    // Auto-pull out smoothly to Boat Deck & then Full Ship view so the player sees the entire breakup & plunge
    if (!this.userAdjustedCameraInSink && !this.autoFocusedSinkLifeboats && p > 0.08) {
      this.autoFocusedSinkLifeboats = true;
      this.focusVesselSpot('funnels', false);
    }

    this.oceanAndSky.update(this.simTime, this.shipX, this.shipZ, this.headingRad, this.speedKnots, 1.0);
    this.particles.update(dt);
    this.shakeIntensity = Math.max(0.06 * (1 - p), this.shakeIntensity - dt * 1.4);
    this.updateCamera(dt);

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

    if (t < WAIT_SEC) {
      this.carpathiaStage = 'waiting';
      this.carpathia.root.visible = false;
      this.carpathiaDistanceM = 460;

      // Periodic distress flares fired from lifeboats every ~12s during the 1-minute night vigil
      this.flareCooldown -= dt;
      if (this.flareCooldown <= 0) {
        this.flareCooldown = 11.5;
        const boat = this.ship.crewAndLifeboats.lifeboats[Math.floor(Math.random() * 16)];
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
        this.focusOnCarpathia(true);
      }

      // Gentle predawn sky lift as rescue liner arrives
      const dawnMix = easeOut * 0.22;
      this.tempColorA.setHex(0x091628);
      this.tempColorB.setHex(0x162b4d);
      (this.scene.background as THREE.Color).copy(this.tempColorA).lerp(this.tempColorB, dawnMix);
      this.sceneFog.color.copy(this.scene.background as THREE.Color);

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
        this.eventText = 'CARPATHIA ALL STOP — LOWERING BOARDING LADDERS';
        this.eventTimer = 5.0;
      }
      carpLocalX = 0;
      carpLocalZ = 56;
      carpLocalYaw = 0.22;
      this.carpathiaDistanceM = 0;
      laddersDeployed = true;
      sweepLight = true;
      this.carpathia.root.visible = true;
      boardingProgress = THREE.MathUtils.clamp((t - WAIT_SEC - APPROACH_SEC) / BOARDING_SEC, 0, 1);
    } else {
      if (this.carpathiaStage !== 'complete') {
        this.carpathiaStage = 'complete';
        if (!this.rescueCompleteWhistlePlayed) {
          this.rescueCompleteWhistlePlayed = true;
          this.sound.playCarpathiaWhistle();
        }
        this.eventText = 'RESCUE COMPLETE — ALL 712 SURVIVORS ABOARD CARPATHIA';
        this.eventTimer = 7.0;
      }
      carpLocalX = 0;
      carpLocalZ = 56;
      carpLocalYaw = 0.22;
      this.carpathiaDistanceM = 0;
      laddersDeployed = true;
      sweepLight = false;
      this.carpathia.root.visible = true;
      boardingProgress = 1.0;
    }

    if (this.carpathia.root.visible) {
      const carpWorldX = this.shipX + rightX * carpLocalX + fwdX * -carpLocalZ;
      const carpWorldZ = this.shipZ + rightZ * carpLocalX + fwdZ * -carpLocalZ;
      const waveY = Math.sin(this.simTime * 0.85) * 0.14;
      const wavePitch = Math.sin(this.simTime * 0.72) * 0.008;
      const waveRoll = Math.cos(this.simTime * 0.62) * 0.012;
      this.carpathia.root.position.set(carpWorldX, waveY, carpWorldZ);
      this.carpathia.root.rotation.set(wavePitch, -this.headingRad + carpLocalYaw, waveRoll);
    }

    const rescueRes = this.ship.crewAndLifeboats.updateRescue(
      this.simTime,
      dt,
      this.carpathiaStage,
      boardingProgress,
      this.carpathia.root,
      this.carpathia.boardingStationsLocal,
      this.ship.root,
    );
    this.boatsRecovered = rescueRes.boatsRecovered;
    this.survivorsRescued = rescueRes.survivorsRescued;
    this.lifeboatsLaunched = 16;

    if (this.carpathia.root.visible) {
      this.carpathia.setRescueState(
        this.simTime,
        this.survivorsRescued / 712,
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
    this.oceanAndSky.update(this.simTime, this.shipX, this.shipZ, this.headingRad, 0, 1.0);
    this.particles.update(dt);
    this.updateCamera(dt);
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

  private checkIcebergInteractions(dt: number, fwdX: number, fwdZ: number): void {
    const rightX = Math.cos(this.headingRad);
    const rightZ = Math.sin(this.headingRad);

    let closestWarningDist = Infinity;
    let closestWarningText: string | null = null;

    for (const berg of this.icebergs) {
      const dx = berg.x - this.shipX;
      const dz = berg.z - this.shipZ;
      const ahead = dx * fwdX + dz * fwdZ; // +74 is bow tip
      const lateral = dx * rightX + dz * rightZ; // negative = Port, positive = Starboard

      // 1. Crow's Nest Warning Check
      if (ahead > 80 && ahead < 260 && Math.abs(lateral) < berg.collisionRadius + 18) {
        if (ahead < closestWarningDist) {
          closestWarningDist = ahead;
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
          berg.nearMissAwarded = true; // no near-miss bonus after hitting
          this.combo = 1;

          const speedRatio = Math.max(0.25, Math.abs(this.speedKnots) / 22);
          const rawDmg = isBowRam ? 38 * speedRatio + 10 : 18 * speedRatio + 7;
          this.hullIntegrity = Math.max(0, this.hullIntegrity - Math.round(rawDmg));

          // Physical bounce/deflection, list side & speed loss
          const pushSide = lateral >= 0 ? -1 : 1;
          this.listDirection = lateral >= 0 ? 1 : -1;
          this.headingRad += pushSide * (isBowRam ? 0.08 : 0.14);
          this.shipX += rightX * pushSide * 2.5;
          this.shipZ += rightZ * pushSide * 2.5;
          this.speedKnots *= isBowRam ? 0.35 : 0.65;

          // Immediate water surge into breached compartments
          this.floodingPct = Math.min(100, this.floodingPct + (isBowRam ? 22 : 10));

          // Juice: hitstop, camera shake, ice shatter, flash, audio
          this.hitstopTimer = isBowRam ? 0.065 : 0.042;
          this.shakeIntensity = isBowRam ? 1.0 : 0.65;
          this.damageFlashTimer = 0.45;
          this.onDamageFlash(1.0);
          this.particles.burstIceImpact(hitPtX, 3.5, hitPtZ, isBowRam ? 46 : 28);
          this.sound.playCollisionImpact(speedRatio);

          this.eventText = isBowRam
            ? 'BOW BREACHED — WATER POURING IN'
            : 'HULL TORN — FORWARD FLOODING';
          this.eventTimer = 2.6;
          this.emitTelemetry();
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

    void dt;
    this.icebergWarning = closestWarningText;
  }

  // =========================================================================
  // CAMERA RIG (Title Harbor Sweep + Free 360° Orbit + Wheelhouse Helm)
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

    // Smoothly damp focus position & spherical orbit coordinates
    this.camFocusLocal.x = THREE.MathUtils.damp(this.camFocusLocal.x, spec.localTarget[0], 6, dt);
    this.camFocusLocal.y = THREE.MathUtils.damp(this.camFocusLocal.y, spec.localTarget[1], 6, dt);
    this.camFocusLocal.z = THREE.MathUtils.damp(this.camFocusLocal.z, spec.localTarget[2], 6, dt);
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

    const useSternHalf = spec.id === 'stern';
    const halfGroup = useSternHalf ? this.ship.sternGroup : this.ship.bowGroup;
    const halfY = halfGroup.position.y;
    const halfPitch = halfGroup.rotation.x;
    const hullRoll = this.ship.hullMeshGroup.rotation.z;

    const dzFromBreak = _vFocusLocal.z - BREAK_Z;
    const pitchedY =
      halfY +
      _vFocusLocal.y * Math.cos(halfPitch) -
      dzFromBreak * Math.sin(halfPitch) +
      _vFocusLocal.x * Math.sin(hullRoll);

    let worldY = pitchedY;
    if (this.phase === 'aftermath' || this.phase === 'gameover') {
      worldY = 4.2;
    } else if (isOverviewShip) {
      const sternY = this.ship.sternGroup.position.y;
      const sternPitch = this.ship.sternGroup.rotation.x;
      const sternTipWorldY = sternY + 10 * Math.cos(sternPitch) - (195.1 - BREAK_Z) * Math.sin(sternPitch);
      worldY = THREE.MathUtils.clamp(Math.max(4.5, sternTipWorldY * 0.38), 3.5, 24.0);
    } else if (isSinkOrAfter) {
      worldY = Math.max(-1.2, pitchedY);
    }

    _vFwd.set(Math.sin(this.headingRad), 0, -Math.cos(this.headingRad));
    _vRight.set(Math.cos(this.headingRad), 0, Math.sin(this.headingRad));

    if (
      (this.phase === 'aftermath' || this.phase === 'gameover') &&
      this.focusCarpathia &&
      this.carpathia.root.visible
    ) {
      _vFocusWorld.copy(this.carpathia.root.position);
      _vFocusWorld.y = 7.5;
    } else {
      _vFocusWorld
        .set(this.shipX, worldY, this.shipZ)
        .addScaledVector(_vRight, _vFocusLocal.x)
        .addScaledVector(_vFwd, -_vFocusLocal.z);
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

    // Keep exterior camera above the ocean waves
    if (this.orbitDistance > 1.5 && _vCamPos.y < 1.25) {
      _vCamPos.y = 1.25;
    } else if (this.orbitDistance <= 1.5 && _vCamPos.y < 0.85) {
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

    // Subtle ship roll feel when standing inside wheelhouse
    const isInterior = spec.id === 'wheelhouse' && this.orbitDistance < 2.2;
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
    const p = this.timeSkipProgress;
    const timeSkipDateLabel =
      p < 0.25
        ? 'APRIL 10, 1912 · ENGLISH CHANNEL · DEPARTING SOUTHAMPTON'
        : p < 0.5
          ? 'APRIL 11, 1912 · QUEENSTOWN, IRELAND · BOUND WESTWARD'
          : p < 0.78
            ? 'APRIL 12–13, 1912 · NORTH ATLANTIC · 21 KNOTS'
            : 'APRIL 14, 1912 · 11:39 PM · APPROACHING ICE ALLEY';

    this.onTelemetry({
      phase: this.phase,
      cameraMode: this.cameraMode,
      focusSpotId: spot.id,
      focusSpotLabel: spot.label,
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
      focusCarpathia: this.focusCarpathia,
      harborChapterIndex: this.harborChapterIndex,
      harborProgress: this.harborProgress,
      harborAutoPlay: this.harborAutoPlay,
      timeSkipProgress: this.timeSkipProgress,
      timeSkipDateLabel: timeSkipDateLabel,
      score: Math.round(this.score),
      bestScore: Math.max(this.bestScore, Math.round(this.score)),
      nearMissCount: this.nearMissCount,
      combo: this.combo,
      searchlightActive: this.searchlightTimer > 0,
      searchlightCooldownPct: cooldownPct,
      icebergWarning: this.icebergWarning,
      lastEventText: this.eventText,
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
