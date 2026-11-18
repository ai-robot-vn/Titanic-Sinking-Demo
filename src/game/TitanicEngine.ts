import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SoundEngine } from './audio';
import { IcebergEntity, IcebergFactory } from './icebergBuilder';
import { createOceanAndSky, OceanAndSkyRig, ParticlePool } from './oceanAndSky';
import { buildTitanicShip, TitanicShipRig } from './shipBuilder';
import { createProceduralTextures, ProceduralTextureSet } from './textures';
import {
  CameraMode,
  GamePhase,
  IcebergVariant,
  TARGET_VOYAGE_NM,
  TELEGRAPH_NOTCHES,
  TelemetrySnapshot,
} from './types';

// Pre-allocated math helpers (zero per-frame GC)
const _vFwd = new THREE.Vector3();
const _vRight = new THREE.Vector3();
const _vCamTarget = new THREE.Vector3();
const _vCamPos = new THREE.Vector3();
const _vLookPos = new THREE.Vector3();

const BEST_SCORE_KEY = 'titanic_bridge_best_score_v1';

const HULL_CHECK_POINTS: Array<{ zLocal: number; radius: number }> = [
  { zLocal: -67, radius: 3.4 },
  { zLocal: -52, radius: 5.8 },
  { zLocal: -34, radius: 8.2 },
  { zLocal: -12, radius: 9.4 },
];

export class TitanicEngine {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly isSoftwareGl: boolean;

  private readonly textures: ProceduralTextureSet;
  private readonly ship: TitanicShipRig;
  private readonly oceanAndSky: OceanAndSkyRig;
  private readonly iceFactory: IcebergFactory;
  private readonly particles: ParticlePool;
  public readonly sound: SoundEngine;

  private readonly moonKeyLight: THREE.DirectionalLight;
  private readonly searchSpotLight: THREE.SpotLight;

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

  // Mouse look inside wheelhouse
  private lookYawOffset = 0;
  private lookPitchOffset = 0;
  private targetLookYaw = 0;
  private targetLookPitch = 0;
  private isPointerDown = false;
  private lastPointerX = 0;
  private lastPointerY = 0;

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
    this.scene.background = new THREE.Color(0x071322);
    this.scene.fog = new THREE.FogExp2(0x091628, 0.0027);

    const aspect = (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight);
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.15, 1300);

    // 4. Mandatory Procedural Studio Environment Reflection
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // 5. Balanced 3-Point Warm/Cool North Atlantic Lighting
    const hemi = new THREE.HemisphereLight(0x88b8ea, 0x091422, 0.82);
    this.scene.add(hemi);

    this.moonKeyLight = new THREE.DirectionalLight(0xcde4ff, 2.35);
    this.moonKeyLight.position.set(110, 145, -240);
    this.moonKeyLight.castShadow = !this.isSoftwareGl;
    this.moonKeyLight.shadow.mapSize.set(1024, 1024);
    this.moonKeyLight.shadow.bias = -0.0005;
    this.moonKeyLight.shadow.normalBias = 0.02;
    const d = 140;
    this.moonKeyLight.shadow.camera.left = -d;
    this.moonKeyLight.shadow.camera.right = d;
    this.moonKeyLight.shadow.camera.top = d;
    this.moonKeyLight.shadow.camera.bottom = -d;
    this.moonKeyLight.shadow.camera.near = 20;
    this.moonKeyLight.shadow.camera.far = 520;
    this.scene.add(this.moonKeyLight);
    this.scene.add(this.moonKeyLight.target);

    const rimLight = new THREE.DirectionalLight(0x4b77a8, 0.72);
    rimLight.position.set(-120, 60, 100);
    this.scene.add(rimLight);

    // 6. Build Assets
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.textures = createProceduralTextures(maxAniso);

    this.oceanAndSky = createOceanAndSky(this.isSoftwareGl);
    this.scene.add(this.oceanAndSky.oceanMesh);
    this.scene.add(this.oceanAndSky.skyGroup);

    this.ship = buildTitanicShip(this.textures, this.isSoftwareGl);
    this.scene.add(this.ship.root);

    // Searchlight SpotLight attached to ship roof
    this.searchSpotLight = new THREE.SpotLight(0xeef8ff, 24, 420, Math.PI / 9, 0.55, 1.1);
    this.searchSpotLight.position.set(0, 14.3, -1.5);
    this.searchSpotLight.target = this.ship.searchlightTarget;
    this.ship.hullMeshGroup.add(this.searchSpotLight);

    this.iceFactory = new IcebergFactory(this.textures);
    this.particles = new ParticlePool(320);
    this.scene.add(this.particles.mesh);

    // Seed atmospheric icebergs for the live Title Screen backdrop
    this.seedInitialIcebergs();

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
    this.targetLookYaw = 0;
    this.targetLookPitch = 0;

    this.ship.hullMeshGroup.position.set(0, 0, 0);
    this.ship.hullMeshGroup.rotation.set(0, 0, 0);
    this.ship.setPowerLevel(1);
    this.ship.setWheelhouseFloodLevel(0);

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
      this.phase = 'gameover';
      this.saveBestScore();
      this.emitTelemetry();
    }
  }

  public returnToTitle(): void {
    this.phase = 'title';
    this.heldKeys.clear();
    this.shipX = 0;
    this.shipZ = 0;
    this.headingRad = 0;
    this.rudderDeg = 0;
    this.speedKnots = 12;
    this.hullIntegrity = 100;
    this.floodingPct = 0;
    this.waterIngressRate = 0;
    this.sinkProgress = 0;
    this.sinkDropY = 0;
    this.sinkPitch = 0;
    this.sinkList = 0;
    this.powerLevel = 1;
    this.ship.hullMeshGroup.position.set(0, 0, 0);
    this.ship.hullMeshGroup.rotation.set(0, 0, 0);
    this.ship.setPowerLevel(1);
    this.ship.setWheelhouseFloodLevel(0);
    this.seedInitialIcebergs();
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

  public toggleCameraMode(): void {
    this.cameraMode = this.cameraMode === 'wheelhouse' ? 'bridgeWing' : 'wheelhouse';
    this.emitTelemetry();
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

    if (this.phase === 'gameover' || this.phase === 'victory') {
      if (code === 'Enter') {
        e.preventDefault();
        this.startGame();
      }
      return;
    }

    if (this.phase === 'sinking') {
      if (code === 'KeyC') {
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
    } else if (code === 'KeyS' || code === 'ArrowDown') {
      e.preventDefault();
      this.stepTelegraph(-1);
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
    if (this.phase !== 'playing') return;
    this.sound.unlock();
    this.isPointerDown = true;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  };

  private readonly handlePointerMove = (e: PointerEvent) => {
    if (!this.isPointerDown || this.phase !== 'playing') return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.targetLookYaw = THREE.MathUtils.clamp(this.targetLookYaw - dx * 0.0028, -0.45, 0.45);
    this.targetLookPitch = THREE.MathUtils.clamp(this.targetLookPitch - dy * 0.002, -0.18, 0.22);
  };

  private readonly handlePointerUp = () => {
    this.isPointerDown = false;
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
      // Atmospheric live cruising pan on Title Screen
      this.shipZ -= 18 * dt;
      this.rudderDeg = Math.sin(this.simTime * 0.35) * 6;
      this.wheelVisualAngle = THREE.MathUtils.damp(this.wheelVisualAngle, -this.rudderDeg * 0.11, 5, dt);
      this.ship.helmWheel.rotation.z = this.wheelVisualAngle;
      this.updateIcebergsTitleDrift(dt);
      this.updateShipVisualRig(dt, 14);
      this.oceanAndSky.update(this.simTime, this.shipX, this.shipZ, 0, 14);
      this.particles.update(dt);
      this.updateTitleCamera();
      this.sound.updateShipAmbience(12, false);
      return;
    }

    if (this.phase === 'sinking') {
      this.stepSinkingSequence(dt);
      return;
    }

    if (this.phase === 'victory' || this.phase === 'gameover') {
      this.speedKnots = THREE.MathUtils.damp(this.speedKnots, 0, 1.2, dt);
      this.shipZ -= this.speedKnots * 1.5 * dt * Math.cos(this.headingRad);
      this.shipX += this.speedKnots * 1.5 * dt * Math.sin(this.headingRad);
      this.updateShipVisualRig(dt, this.speedKnots);
      this.oceanAndSky.update(this.simTime, this.shipX, this.shipZ, this.headingRad, this.speedKnots);
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

    // Update Ship Transforms, Wheel, Telegraph, Bow Spray & Light Rig
    this.updateShipVisualRig(dt, this.speedKnots);
    this.emitBowSpray(dt, fwdX, fwdZ);
    this.oceanAndSky.update(this.simTime, this.shipX, this.shipZ, this.headingRad, this.speedKnots);

    // Iceberg Spawning, Motion, Warnings, Near-Miss & Collision
    this.manageIcebergField(dt, worldSpeed, fwdX, fwdZ);
    this.checkIcebergInteractions(dt, fwdX, fwdZ);

    this.particles.update(dt);
    this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 1.9);

    if (!this.isPointerDown) {
      // Gently drift look offset back toward center when not dragging
      this.targetLookYaw = THREE.MathUtils.damp(this.targetLookYaw, 0, 1.4, dt);
      this.targetLookPitch = THREE.MathUtils.damp(this.targetLookPitch, 0, 1.4, dt);
    }
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

  private triggerSinking(): void {
    this.hullIntegrity = Math.max(0, this.hullIntegrity);
    this.floodingPct = 100;
    this.waterIngressRate = 0;
    this.phase = 'sinking';
    this.sinkProgress = 0;
    this.telegraphIndex = 1; // ALL STOP
    this.heldKeys.clear();
    this.icebergWarning = null;
    this.eventText = 'WATER OVERWHELMING BULKHEADS — SHIP SINKING';
    this.eventTimer = 6.0;
    this.groanCooldown = 0.3;
    this.sound.playHullGroan(1.0);
    this.sound.playSteamWhistle();
    this.emitTelemetry();
  }

  private stepSinkingSequence(dt: number): void {
    this.sinkProgress = Math.min(1, this.sinkProgress + dt / 10.5);

    // Engines stop & forward momentum bleeds off as bow buries into sea
    this.speedKnots = THREE.MathUtils.damp(this.speedKnots, 0, 0.7, dt);
    const fwdX = Math.sin(this.headingRad);
    const fwdZ = -Math.cos(this.headingRad);
    const worldSpeed = this.speedKnots * 1.4;
    this.shipX += fwdX * worldSpeed * dt;
    this.shipZ += fwdZ * worldSpeed * dt;

    // Dramatic bow-down plunge, vertical submergence, and heavy list
    this.sinkDropY = -2.2 - Math.pow(this.sinkProgress, 1.25) * 19.8;
    this.sinkPitch = -0.088 - Math.sin(this.sinkProgress * Math.PI * 0.5) * 0.44;
    this.sinkList = this.listDirection * (0.095 + Math.sin(this.sinkProgress * Math.PI * 0.58) * 0.36);

    // Rising cold Atlantic floodwater inside the wheelhouse
    const whFlood = THREE.MathUtils.clamp((this.sinkProgress - 0.06) / 0.46, 0, 1);
    this.ship.setWheelhouseFloodLevel(whFlood);

    // Boiler room flooding causes bridge dynamos to flicker & fail
    if (this.sinkProgress < 0.42) {
      this.powerLevel = 1.0 - this.sinkProgress * 0.4;
    } else if (this.sinkProgress < 0.78) {
      const fade = 1 - (this.sinkProgress - 0.42) / 0.36;
      const flicker = 0.35 + 0.65 * Math.abs(Math.sin(this.simTime * 29) * Math.cos(this.simTime * 17));
      this.powerLevel = fade * flicker;
    } else {
      this.powerLevel = 0;
    }
    this.ship.setPowerLevel(this.powerLevel);

    // Periodic hull steel groans & rushing water ambience
    this.groanCooldown -= dt;
    if (this.groanCooldown <= 0 && this.sinkProgress < 0.88) {
      this.groanCooldown = 2.4 + Math.random() * 1.4;
      this.sound.playHullGroan(0.75 + this.sinkProgress * 0.25);
    }
    this.sound.updateSinkingAmbience(this.sinkProgress);

    // Churning white foam & trapped air bursts along submerging deck & funnel
    if (this.sinkProgress < 0.94 && Math.random() < 0.75) {
      const rightX = Math.cos(this.headingRad);
      const rightZ = Math.sin(this.headingRad);
      const along = THREE.MathUtils.lerp(54, -8, this.sinkProgress) + (Math.random() - 0.5) * 26;
      const sideOff = (Math.random() - 0.5) * 14;
      this.particles.emit(
        this.shipX + fwdX * along + rightX * sideOff,
        0.35 + Math.random() * 1.4,
        this.shipZ + fwdZ * along + rightZ * sideOff,
        (Math.random() - 0.5) * 4.5,
        2.5 + Math.random() * 4.5,
        (Math.random() - 0.5) * 4.5,
        0.7 + Math.random() * 1.1,
        0.8 + Math.random() * 0.6,
        6.5,
        Math.random() < 0.35 ? 0xe0f2fe : 0x9bd7f5,
      );
    }

    this.updateShipVisualRig(dt, this.speedKnots);
    this.oceanAndSky.update(this.simTime, this.shipX, this.shipZ, this.headingRad, this.speedKnots);
    this.particles.update(dt);
    this.shakeIntensity = Math.max(0.08 * (1 - this.sinkProgress), this.shakeIntensity - dt * 1.5);
    this.updateCamera(dt);

    if (this.sinkProgress >= 1) {
      this.phase = 'gameover';
      this.saveBestScore();
      this.emitTelemetry();
      return;
    }

    this.telemetryAccum += dt;
    if (this.telemetryAccum >= 0.08) {
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

    this.ship.hullMeshGroup.position.y = THREE.MathUtils.damp(
      this.ship.hullMeshGroup.position.y,
      this.sinkDropY,
      3.5,
      dt,
    );
    this.ship.hullMeshGroup.rotation.x = THREE.MathUtils.damp(
      this.ship.hullMeshGroup.rotation.x,
      wavePitch + this.sinkPitch,
      3.5,
      dt,
    );
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
      const sweepX = Math.sin(this.simTime * 1.9) * 34;
      this.ship.searchlightTarget.position.set(sweepX, 2.0, -145);
      this.ship.searchlightHead.rotation.y = -Math.atan2(sweepX, 145);
      this.searchSpotLight.intensity = 280 * this.powerLevel;
      this.searchSpotLight.angle = Math.PI / 7.5;
    } else {
      this.ship.searchlightTarget.position.set(0, 1.5, -135);
      this.ship.searchlightHead.rotation.y = THREE.MathUtils.damp(
        this.ship.searchlightHead.rotation.y,
        0,
        5,
        dt,
      );
      this.searchSpotLight.intensity = (speedKnots > 1 ? 26 : 14) * this.powerLevel;
      this.searchSpotLight.angle = Math.PI / 9.5;
    }

    // Keep moon directional light aligned with the visible Arctic moon ahead-starboard
    const fwdX = Math.sin(this.headingRad);
    const fwdZ = -Math.cos(this.headingRad);
    this.moonKeyLight.target.position.set(this.shipX + fwdX * 55, 0, this.shipZ + fwdZ * 55);
    this.moonKeyLight.position.set(
      this.shipX + fwdX * 55 + 95,
      130,
      this.shipZ + fwdZ * 55 - 235,
    );
  }

  private emitBowSpray(dt: number, fwdX: number, fwdZ: number): void {
    const absSpd = Math.abs(this.speedKnots);
    const hullY = this.ship.hullMeshGroup.position.y;
    const rightX = Math.cos(this.headingRad);
    const rightZ = Math.sin(this.headingRad);

    // Subtle coal smoke wisps from active forward funnels #1, #2, #3
    if (this.powerLevel > 0.1 && hullY > -8) {
      this.smokeAccum += dt * (2.5 + absSpd * 0.28);
      while (this.smokeAccum >= 1) {
        this.smokeAccum -= 1;
        const funnelZ = [11.5, 25.5, 39.5][Math.floor(Math.random() * 3)];
        this.particles.emit(
          this.shipX - fwdX * funnelZ + (Math.random() - 0.5) * 1.4,
          22.8 + hullY,
          this.shipZ - fwdZ * funnelZ + (Math.random() - 0.5) * 1.4,
          -fwdX * (4 + absSpd * 0.35) + (Math.random() - 0.5) * 1.5,
          2.2 + Math.random() * 1.2,
          -fwdZ * (4 + absSpd * 0.35) + (Math.random() - 0.5) * 1.5,
          1.4 + Math.random() * 1.1,
          2.1 + Math.random() * 0.8,
          -0.8,
          0x2e3744,
        );
      }
    }

    if (absSpd < 4) return;
    this.sprayAccum += dt * (absSpd * 0.78);

    while (this.sprayAccum >= 1) {
      this.sprayAccum -= 1;
      const side = Math.random() < 0.5 ? -1 : 1;
      const bowX = this.shipX + fwdX * 67 + rightX * side * 1.4;
      const bowZ = this.shipZ + fwdZ * 67 + rightZ * side * 1.4;
      this.particles.emit(
        bowX,
        0.5,
        bowZ,
        rightX * side * (2.5 + Math.random() * 3.5) - fwdX * 2,
        1.8 + Math.random() * 2.5,
        rightZ * side * (2.5 + Math.random() * 3.5) - fwdZ * 2,
        0.4 + Math.random() * 0.5,
        0.55 + Math.random() * 0.35,
        9.5,
        0xd8eefc,
      );
    }
  }

  private updateIcebergsTitleDrift(dt: number): void {
    for (const berg of this.icebergs) {
      berg.rotY += berg.rotSpeed * dt;
      berg.group.rotation.y = berg.rotY;
      berg.group.position.y = Math.sin(this.simTime * 0.9 + berg.bobPhase) * 0.25;
      if (berg.z > this.shipZ + 80) {
        berg.z -= 420;
        berg.group.position.z = berg.z;
      }
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
      if (along < -140 || distSq > 540 * 540) {
        this.scene.remove(b.group);
        this.icebergs.splice(i, 1);
      }
    }

    // Spawn new iceberg rows ahead along current course
    this.spawnAccumDist += Math.max(0, worldSpeed) * dt;
    const difficulty = Math.min(1.35, this.distanceNm / 8.5);
    const rowInterval = THREE.MathUtils.lerp(72, 46, Math.min(1, difficulty));

    if (this.spawnAccumDist >= rowInterval && this.icebergs.length < 34) {
      this.spawnAccumDist = 0;

      // Always leave a guaranteed safe channel somewhere within [-95, +95] lateral offset
      const safeLaneCenter = (Math.random() - 0.5) * 140;
      const safeHalfWidth = THREE.MathUtils.lerp(28, 21, Math.min(1, difficulty));
      const countInRow = Math.random() < 0.35 + difficulty * 0.35 ? 3 : 2;
      const baseAhead = 340 + Math.random() * 65;

      for (let c = 0; c < countInRow; c++) {
        let lateral = (Math.random() - 0.5) * 260;
        if (Math.abs(lateral - safeLaneCenter) < safeHalfWidth) {
          lateral = safeLaneCenter + (lateral >= safeLaneCenter ? 1 : -1) * (safeHalfWidth + 14 + Math.random() * 25);
        }

        const ahead = baseAhead + (Math.random() - 0.5) * 38;
        const sx = this.shipX + fwdX * ahead + rightX * lateral;
        const sz = this.shipZ + fwdZ * ahead + rightZ * lateral;

        // Avoid overlapping existing icebergs
        let overlaps = false;
        for (const ex of this.icebergs) {
          if (Math.hypot(ex.x - sx, ex.z - sz) < ex.collisionRadius + 24) {
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
      const ahead = dx * fwdX + dz * fwdZ; // +68 is bow tip
      const lateral = dx * rightX + dz * rightZ; // negative = Port, positive = Starboard

      // 1. Crow's Nest Warning Check
      if (ahead > 75 && ahead < 235 && Math.abs(lateral) < berg.collisionRadius + 14) {
        if (ahead < closestWarningDist) {
          closestWarningDist = ahead;
          closestWarningText =
            Math.abs(lateral) < 7
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
      if (!berg.nearMissAwarded && ahead < 10 && ahead > -25) {
        const clearance = Math.abs(lateral) - (berg.collisionRadius + 9.0);
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
  // CAMERA RIG (Wheelhouse Helm vs Bridge Wing Overlook + Title Pan)
  // =========================================================================
  private updateTitleCamera(): void {
    const pan = Math.sin(this.simTime * 0.25);
    const localCamX = pan * 0.48;
    const localCamY = 12.78 + Math.cos(this.simTime * 0.35) * 0.05;
    const localCamZ = 1.32;

    this.camera.position.set(this.shipX + localCamX, localCamY, this.shipZ + localCamZ);
    this.camera.lookAt(this.shipX + pan * 3.5, 11.1, this.shipZ - 68);
  }

  private updateCamera(dt: number): void {
    this.lookYawOffset = THREE.MathUtils.damp(this.lookYawOffset, this.targetLookYaw, 8, dt);
    this.lookPitchOffset = THREE.MathUtils.damp(this.lookPitchOffset, this.targetLookPitch, 8, dt);

    _vFwd.set(Math.sin(this.headingRad), 0, -Math.cos(this.headingRad));
    _vRight.set(Math.cos(this.headingRad), 0, Math.sin(this.headingRad));

    if (this.phase === 'sinking' || this.phase === 'gameover') {
      const hullY = this.ship.hullMeshGroup.position.y;
      // Blend from flooding wheelhouse out to a dramatic lifeboat overlook as bridge submerges
      const pullOut =
        this.phase === 'gameover'
          ? 1
          : this.cameraMode === 'bridgeWing'
            ? 1
            : THREE.MathUtils.smoothstep(this.sinkProgress, 0.35, 0.62);

      // Inside flooding wheelhouse
      const whY = Math.max(1.2, 12.78 + hullY);
      _vCamPos
        .set(this.shipX, whY, this.shipZ)
        .addScaledVector(_vFwd, -1.28);

      // Lifeboat overlook off the bow/bridge framing all 4 funnels & promenade lights
      const lifeboatX = this.shipX + _vRight.x * (36 * this.listDirection) - _vFwd.x * 34;
      const lifeboatZ = this.shipZ + _vRight.z * (36 * this.listDirection) - _vFwd.z * 34;
      const lifeboatY = 14.5;

      _vCamPos.x = THREE.MathUtils.lerp(_vCamPos.x, lifeboatX, pullOut);
      _vCamPos.y = THREE.MathUtils.lerp(_vCamPos.y, lifeboatY, pullOut);
      _vCamPos.z = THREE.MathUtils.lerp(_vCamPos.z, lifeboatZ, pullOut);

      // Target: inside looks down the sinking forecastle; outside frames the full Titanic
      const whTargetX = this.shipX + _vFwd.x * 50;
      const whTargetY = Math.max(0.2, 7.5 + hullY - 12 * Math.abs(this.sinkPitch));
      const whTargetZ = this.shipZ + _vFwd.z * 50;

      const outTargetX = this.shipX + _vFwd.x * 8;
      const outTargetY = Math.max(-2.5, 5.5 + hullY * 0.65);
      const outTargetZ = this.shipZ + _vFwd.z * 8;

      _vCamTarget.set(
        THREE.MathUtils.lerp(whTargetX, outTargetX, pullOut),
        THREE.MathUtils.lerp(whTargetY, outTargetY, pullOut),
        THREE.MathUtils.lerp(whTargetZ, outTargetZ, pullOut),
      );
    } else if (this.cameraMode === 'wheelhouse') {
      // Positioned inside wheelhouse behind rotating helm wheel (tracks hull trim)
      const hullY = this.ship.hullMeshGroup.position.y;
      _vCamPos
        .set(this.shipX, 12.78 + hullY, this.shipZ)
        .addScaledVector(_vFwd, -1.28)
        .addScaledVector(_vRight, 0);

      const lookYaw = this.headingRad - this.lookYawOffset;
      _vCamTarget
        .copy(_vCamPos)
        .add(
          _vLookPos.set(
            Math.sin(lookYaw) * 55,
            -3.6 + this.sinkPitch * 42 + this.lookPitchOffset * 28,
            -Math.cos(lookYaw) * 55,
          ),
        );
    } else {
      // Starboard Bridge Wing / Quarter Overlook showing bow, lit portholes, lifeboats & funnels
      const hullY = this.ship.hullMeshGroup.position.y;
      _vCamPos
        .set(this.shipX, 16.5 + hullY, this.shipZ)
        .addScaledVector(_vFwd, -10.5)
        .addScaledVector(_vRight, 13.8);

      const lookYaw = this.headingRad - this.lookYawOffset * 0.8;
      _vCamTarget
        .set(this.shipX, 8.6 + hullY, this.shipZ)
        .add(
          _vLookPos.set(
            Math.sin(lookYaw) * 65,
            this.sinkPitch * 42 + this.lookPitchOffset * 24,
            -Math.cos(lookYaw) * 65,
          ),
        );
    }

    // Apply decaying camera shake
    if (this.shakeIntensity > 0.001) {
      const s = this.shakeIntensity * 0.38;
      _vCamPos.x += (Math.random() - 0.5) * s;
      _vCamPos.y += (Math.random() - 0.5) * s;
      _vCamPos.z += (Math.random() - 0.5) * s;
    }

    this.camera.position.copy(_vCamPos);
    this.camera.lookAt(_vCamTarget);
    // Subtle ship roll feel in wheelhouse view
    const rollInfluence =
      this.phase === 'sinking' || this.phase === 'gameover'
        ? (1 - THREE.MathUtils.smoothstep(this.sinkProgress, 0.35, 0.62)) * 0.5
        : this.cameraMode === 'wheelhouse'
          ? 0.55
          : 0.25;
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

    this.onTelemetry({
      phase: this.phase,
      cameraMode: this.cameraMode,
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
