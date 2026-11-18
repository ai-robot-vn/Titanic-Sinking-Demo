import * as THREE from 'three';

export interface OceanUniforms {
  uTime: { value: number };
  uShipPos: { value: THREE.Vector2 };
  uShipForward: { value: THREE.Vector2 };
  uShipSpeed: { value: number };
  uNightMix: { value: number };
}

export interface OceanAndSkyRig {
  oceanMesh: THREE.Mesh;
  skyGroup: THREE.Group;
  uniforms: OceanUniforms;
  update: (
    time: number,
    shipX: number,
    shipZ: number,
    headingRad: number,
    speedKnots: number,
    nightMix?: number,
  ) => void;
  dispose: () => void;
}

export function createOceanAndSky(isSoftwareGl: boolean): OceanAndSkyRig {
  const uniforms: OceanUniforms = {
    uTime: { value: 0 },
    uShipPos: { value: new THREE.Vector2(0, 0) },
    uShipForward: { value: new THREE.Vector2(0, -1) },
    uShipSpeed: { value: 0 },
    uNightMix: { value: 1 },
  };

  const oceanSize = 2300;
  const segs = isSoftwareGl ? 80 : 156;
  const oceanGeo = new THREE.PlaneGeometry(oceanSize, oceanSize, segs, segs);
  oceanGeo.rotateX(-Math.PI / 2);

  const oceanMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.11,
    metalness: 0.42,
    envMapIntensity: 1.45,
    side: THREE.DoubleSide,
  });

  oceanMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uShipPos = uniforms.uShipPos;
    shader.uniforms.uShipForward = uniforms.uShipForward;
    shader.uniforms.uShipSpeed = uniforms.uShipSpeed;
    shader.uniforms.uNightMix = uniforms.uNightMix;

    shader.vertexShader =
      `
      uniform float uTime;
      varying vec3 vOceanWorldPos;
      varying float vWaveCrest;
      ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      vec4 oceanWp = modelMatrix * vec4(transformed, 1.0);
      float w1 = sin(oceanWp.x * 0.052 + uTime * 1.15) * cos(oceanWp.z * 0.046 + uTime * 0.85);
      float w2 = sin((oceanWp.x * 0.72 + oceanWp.z * 0.58) * 0.115 - uTime * 1.75);
      float w3 = cos((oceanWp.x * -0.48 + oceanWp.z * 0.86) * 0.21 + uTime * 2.15);
      float swell = w1 * 0.44 + w2 * 0.20 + w3 * 0.08;
      transformed.y += swell;
      vWaveCrest = clamp(swell * 0.85 + 0.35, 0.0, 1.0);
      vOceanWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `,
    );

    shader.fragmentShader =
      `
      uniform float uTime;
      uniform vec2 uShipPos;
      uniform vec2 uShipForward;
      uniform float uShipSpeed;
      uniform float uNightMix;
      varying vec3 vOceanWorldPos;
      varying float vWaveCrest;
      ` + shader.fragmentShader;

    // Perturb fragment normal for crisp glistening moonlight & sunlight glints on Atlantic capillary waves
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `
      #include <normal_fragment_maps>
      float wx = vOceanWorldPos.x;
      float wz = vOceanWorldPos.z;
      float dhdx = cos(wx * 0.38 + uTime * 1.9) * 0.16 + cos((wx + wz * 0.6) * 0.92 - uTime * 2.8) * 0.12 + sin(wx * 2.1 - uTime * 3.6) * 0.06;
      float dhdz = sin(wz * 0.34 - uTime * 1.6) * 0.16 + sin((wz - wx * 0.5) * 0.88 + uTime * 2.5) * 0.12 + cos(wz * 1.9 + uTime * 3.3) * 0.06;
      vec3 rippleWorldN = normalize(vec3(-dhdx, 1.0, -dhdz));
      vec3 rippleViewN = normalize((viewMatrix * vec4(rippleWorldN, 0.0)).xyz);
      normal = normalize(mix(normal, rippleViewN, 0.78));
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      float ripA = sin(vOceanWorldPos.x * 0.65 + uTime * 2.2) * cos(vOceanWorldPos.z * 0.58 - uTime * 1.6);
      float ripB = sin((vOceanWorldPos.x - vOceanWorldPos.z) * 1.25 + uTime * 3.1);
      float ripple = (ripA + ripB) * 0.5;

      float nMix = clamp(uNightMix, 0.0, 1.0);
      float sunsetWeight = sin(nMix * 3.14159265);

      vec3 deepDay = vec3(0.022, 0.115, 0.195);
      vec3 crestDay = vec3(0.068, 0.245, 0.345);
      vec3 deepNight = vec3(0.014, 0.048, 0.092);
      vec3 crestNight = vec3(0.042, 0.145, 0.228);

      vec3 deepBase = mix(deepDay, deepNight, smoothstep(0.15, 0.9, nMix));
      vec3 crestBase = mix(crestDay, crestNight, smoothstep(0.15, 0.9, nMix));
      deepBase = mix(deepBase, vec3(0.045, 0.068, 0.135), sunsetWeight * 0.55);
      crestBase = mix(crestBase, vec3(0.21, 0.14, 0.135), sunsetWeight * 0.55);

      vec3 seaCol = mix(deepBase, crestBase, clamp(vWaveCrest + ripple * 0.2, 0.0, 1.0));

      // Ship bow Kelvin wake, hull rubbing foam & stern propeller wash (269m x 28m hull)
      vec2 rel = vOceanWorldPos.xz - uShipPos;
      vec2 fwd = normalize(uShipForward);
      vec2 right = vec2(-fwd.y, fwd.x);
      float along = dot(rel, fwd);   // +74 is bow tip, -195 is stern
      float side = abs(dot(rel, right));

      float speedFactor = clamp(abs(uShipSpeed) / 18.0, 0.0, 1.25);
      float distBehindBow = 73.5 - along;
      float wakeMask = 0.0;
      if (distBehindBow > -3.0 && distBehindBow < 460.0) {
        float armDist = abs(side - (2.0 + max(0.0, distBehindBow) * 0.21));
        float arm = exp(-armDist * armDist * 0.13);
        float innerArmDist = abs(side - (1.2 + max(0.0, distBehindBow) * 0.12));
        float innerArm = exp(-innerArmDist * innerArmDist * 0.18) * 0.5;
        float hullRub = exp(-abs(side - 13.7) * 0.45) * step(-182.0, along) * step(along, 52.0);
        float bowSplash = exp(-((along - 73.5) * (along - 73.5) * 0.045 + side * side * 0.09));
        float sternWash = exp(-side * side * 0.055) * step(along, -190.0) * exp(-max(0.0, -190.0 - along) * 0.016);
        float fade = exp(-max(0.0, distBehindBow) * 0.0055);
        float foamNoise = 0.62 + 0.38 * sin(vOceanWorldPos.x * 0.95 + uTime * 4.5) * cos(vOceanWorldPos.z * 0.95 - uTime * 3.8);
        wakeMask = clamp((arm * 0.9 + innerArm + hullRub * 0.52 + bowSplash * 1.3 + sternWash * 0.95) * fade * speedFactor * foamNoise, 0.0, 1.0);
      }

      vec3 foamNight = vec3(0.76, 0.89, 0.98);
      vec3 foamDay = vec3(0.92, 0.96, 1.0);
      vec3 foamCol = mix(foamDay, foamNight, nMix);
      foamCol = mix(foamCol, vec3(0.96, 0.78, 0.62), sunsetWeight * 0.5);
      diffuseColor.rgb = mix(seaCol, foamCol, wakeMask * 0.86);
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `
      #include <roughnessmap_fragment>
      float rNoise = sin(vOceanWorldPos.x * 0.8 + uTime * 2.5) * cos(vOceanWorldPos.z * 0.75 - uTime * 2.0);
      roughnessFactor = clamp(0.11 + rNoise * 0.05, 0.05, 0.42);
      `,
    );
  };

  const oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
  oceanMesh.receiveShadow = true;

  // =========================================================================
  // SKY DOME: APRIL HARBOR DAYLIGHT -> ATLANTIC SUNSET -> ARCTIC MOONLIT NIGHT
  // =========================================================================
  const skyGroup = new THREE.Group();

  const skyGeo = new THREE.SphereGeometry(1180, 36, 22);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uNightMix: { value: 1.0 },
      uSunDir: { value: new THREE.Vector3(-0.45, 0.52, -0.72).normalize() },
    },
    vertexShader: `
      varying vec3 vLocalPos;
      void main() {
        vLocalPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uNightMix;
      uniform vec3 uSunDir;
      varying vec3 vLocalPos;
      void main() {
        vec3 dir = normalize(vLocalPos);
        float h = clamp(dir.y, 0.0, 1.0);
        float nMix = clamp(uNightMix, 0.0, 1.0);
        float sunsetWeight = sin(nMix * 3.14159265);

        // Day palette (April noon over Southampton)
        vec3 dayTop = vec3(0.14, 0.34, 0.58);
        vec3 dayMid = vec3(0.36, 0.60, 0.80);
        vec3 dayHor = vec3(0.68, 0.82, 0.90);

        // Sunset palette (Atlantic dusk)
        vec3 sunTop = vec3(0.08, 0.14, 0.28);
        vec3 sunMid = vec3(0.34, 0.24, 0.38);
        vec3 sunHor = vec3(0.84, 0.42, 0.21);

        // Night palette (April 14 Arctic Ocean)
        vec3 nightTop = vec3(0.008, 0.020, 0.051);
        vec3 nightMid = vec3(0.027, 0.075, 0.145);
        vec3 nightHor = vec3(0.047, 0.114, 0.196);

        vec3 topCol = mix(dayTop, nightTop, smoothstep(0.15, 0.9, nMix));
        vec3 midCol = mix(dayMid, nightMid, smoothstep(0.15, 0.9, nMix));
        vec3 horCol = mix(dayHor, nightHor, smoothstep(0.15, 0.9, nMix));

        topCol = mix(topCol, sunTop, sunsetWeight * 0.72);
        midCol = mix(midCol, sunMid, sunsetWeight * 0.78);
        horCol = mix(horCol, sunHor, sunsetWeight * 0.85);

        vec3 col = mix(horCol, midCol, smoothstep(0.0, 0.24, h));
        col = mix(col, topCol, smoothstep(0.22, 0.85, h));

        // Solar disc & warm atmospheric scatter during day & sunset
        float sunVisibility = 1.0 - smoothstep(0.52, 0.80, nMix);
        if (sunVisibility > 0.01) {
          float sunDot = max(0.0, dot(dir, normalize(uSunDir)));
          float sunCore = smoothstep(0.9985, 0.9996, sunDot);
          float sunHalo = pow(sunDot, 12.0) * (0.35 + sunsetWeight * 0.55);
          vec3 sunTint = mix(vec3(1.0, 0.95, 0.82), vec3(1.0, 0.56, 0.24), sunsetWeight);
          col += sunTint * (sunCore * 1.4 + sunHalo) * sunVisibility;
        }

        // Subtle Milky Way band arching overhead at night
        float nightAlpha = smoothstep(0.42, 0.92, nMix);
        if (nightAlpha > 0.01) {
          float band = exp(-pow((dir.x * 0.65 + dir.z * 0.42 - dir.y * 0.55) * 3.4, 2.0));
          float cloud = 0.5 + 0.5 * sin(dir.x * 9.0 + dir.z * 7.0) * cos(dir.y * 11.0 - dir.x * 5.0);
          col += vec3(0.025, 0.042, 0.072) * band * cloud * smoothstep(0.08, 0.45, h) * nightAlpha;
        }

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  skyGroup.add(skyDome);

  // Cold North Atlantic Moon with soft lunar surface shading
  const moonGeo = new THREE.CircleGeometry(21, 32);
  const moonMat = new THREE.ShaderMaterial({
    fog: false,
    transparent: true,
    uniforms: {
      uAlpha: { value: 1.0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uAlpha;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float maria = 0.92 + 0.08 * sin(p.x * 5.2 + 0.6) * cos(p.y * 4.8 - 0.4);
        vec3 col = vec3(0.91, 0.96, 1.0) * maria * (1.0 - r * 0.14);
        gl_FragColor = vec4(col, uAlpha);
      }
    `,
  });
  const moonMesh = new THREE.Mesh(moonGeo, moonMat);
  moonMesh.position.set(145, 200, -760);
  moonMesh.lookAt(0, 0, 0);
  skyGroup.add(moonMesh);

  // Multi-layered Lunar Halo
  const haloGeo = new THREE.RingGeometry(21, 68, 36);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0x8cc2eb,
    transparent: true,
    opacity: 0.14,
    fog: false,
    depthWrite: false,
  });
  const haloMesh = new THREE.Mesh(haloGeo, haloMat);
  haloMesh.position.copy(moonMesh.position);
  haloMesh.lookAt(0, 0, 0);
  skyGroup.add(haloMesh);

  // Instanced Starfield (1100 stars)
  const starCount = 1100;
  const starGeo = new THREE.OctahedronGeometry(0.85, 0);
  const starMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1.0,
    fog: false,
  });
  const stars = new THREE.InstancedMesh(starGeo, starMat, starCount);
  const dummy = new THREE.Object3D();
  const starColor = new THREE.Color();

  for (let i = 0; i < starCount; i++) {
    const u = ((i * 73.13) % 1000) / 1000;
    const v = ((i * 197.41) % 1000) / 1000;
    const theta = u * Math.PI * 2;
    const phi = Math.acos(0.06 + v * 0.93);
    const r = 820;

    dummy.position.set(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta),
    );
    const mag = ((i * 37) % 100) / 100;
    const scale = 0.35 + mag * mag * 1.15;
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    stars.setMatrixAt(i, dummy.matrix);

    if (i % 5 === 0) starColor.setHex(0xb8dcff);
    else if (i % 7 === 0) starColor.setHex(0xffe7c2);
    else starColor.setHex(0xf1f6ff);
    stars.setColorAt(i, starColor);
  }
  stars.instanceMatrix.needsUpdate = true;
  if (stars.instanceColor) stars.instanceColor.needsUpdate = true;
  stars.computeBoundingSphere();
  skyGroup.add(stars);

  const snapStep = oceanSize / segs;

  const update = (
    time: number,
    shipX: number,
    shipZ: number,
    headingRad: number,
    speedKnots: number,
    nightMix = 1.0,
  ) => {
    const clampedNight = THREE.MathUtils.clamp(nightMix, 0, 1);
    uniforms.uTime.value = time;
    uniforms.uShipPos.value.set(shipX, shipZ);
    uniforms.uShipForward.value.set(Math.sin(headingRad), -Math.cos(headingRad));
    uniforms.uShipSpeed.value = speedKnots;
    uniforms.uNightMix.value = clampedNight;

    skyMat.uniforms.uNightMix.value = clampedNight;
    // Sweep sun across the western Atlantic sky from midday high-arc down below the horizon
    const sunElev = THREE.MathUtils.lerp(0.55, -0.06, Math.min(1, clampedNight / 0.72));
    const sunX = THREE.MathUtils.lerp(0.32, -0.78, Math.min(1, clampedNight / 0.72));
    skyMat.uniforms.uSunDir.value.set(sunX, sunElev, -0.68).normalize();

    const nightAlpha = THREE.MathUtils.smoothstep(clampedNight, 0.45, 0.96);
    stars.visible = nightAlpha > 0.01;
    starMat.opacity = nightAlpha;

    moonMesh.visible = nightAlpha > 0.01;
    haloMesh.visible = nightAlpha > 0.01;
    moonMat.uniforms.uAlpha.value = nightAlpha;
    haloMat.opacity = 0.14 * nightAlpha;

    // Subtle moon rise into Arctic position during time-lapse
    const moonY = THREE.MathUtils.lerp(60, 200, nightAlpha);
    moonMesh.position.set(145, moonY, -760);
    moonMesh.lookAt(0, 0, 0);
    haloMesh.position.copy(moonMesh.position);
    haloMesh.lookAt(0, 0, 0);

    oceanMesh.position.x = Math.round(shipX / snapStep) * snapStep;
    oceanMesh.position.z = Math.round(shipZ / snapStep) * snapStep;

    skyGroup.position.set(shipX, 0, shipZ);
  };

  const dispose = () => {
    oceanGeo.dispose();
    oceanMat.dispose();
    skyGeo.dispose();
    skyMat.dispose();
    moonGeo.dispose();
    moonMat.dispose();
    haloGeo.dispose();
    haloMat.dispose();
    starGeo.dispose();
    starMat.dispose();
  };

  return { oceanMesh, skyGroup, uniforms, update, dispose };
}

// =========================================================================
// POOLED PARTICLE SYSTEM (Bow Spray, Ice Shards, Funnel Smoke/Steam)
// =========================================================================
interface ParticleSlot {
  active: boolean;
  life: number;
  maxLife: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  scale: number;
  gravity: number;
}

export class ParticlePool {
  public readonly mesh: THREE.InstancedMesh;
  private readonly slots: ParticleSlot[] = [];
  private readonly maxCount: number;
  private readonly dummy = new THREE.Object3D();
  private readonly tempColor = new THREE.Color();
  private cursor = 0;

  constructor(maxCount = 320) {
    this.maxCount = maxCount;
    const geo = new THREE.DodecahedronGeometry(0.42, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.55,
      metalness: 0.04,
      transparent: true,
      opacity: 0.82,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, maxCount);
    this.mesh.frustumCulled = false;

    for (let i = 0; i < maxCount; i++) {
      this.slots.push({
        active: false,
        life: 0,
        maxLife: 1,
        x: 0,
        y: -50,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        scale: 0,
        gravity: 0,
      });
      this.dummy.position.set(0, -50, 0);
      this.dummy.scale.setScalar(0.001);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.tempColor.setHex(0xe0f2fe));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  public emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    scale: number,
    maxLife: number,
    gravity: number,
    hexColor: number,
  ): void {
    const slot = this.slots[this.cursor];
    const slotIdx = this.cursor;
    this.cursor = (this.cursor + 1) % this.maxCount;
    slot.active = true;
    slot.life = maxLife;
    slot.maxLife = maxLife;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.vx = vx;
    slot.vy = vy;
    slot.vz = vz;
    slot.scale = scale;
    slot.gravity = gravity;

    this.tempColor.setHex(hexColor);
    this.mesh.setColorAt(slotIdx, this.tempColor);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  public burstIceImpact(x: number, y: number, z: number, count = 34): void {
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const spd = 6 + Math.random() * 14;
      this.emit(
        x + (Math.random() - 0.5) * 3,
        y + Math.random() * 3,
        z + (Math.random() - 0.5) * 3,
        Math.cos(ang) * spd,
        4 + Math.random() * 12,
        Math.sin(ang) * spd,
        0.55 + Math.random() * 1.15,
        0.9 + Math.random() * 0.7,
        16,
        i % 3 === 0 ? 0xf0f9ff : 0x9bd7f5,
      );
    }
  }

  public update(dt: number): void {
    let anyUpdated = false;
    for (let i = 0; i < this.maxCount; i++) {
      const s = this.slots[i];
      if (!s.active) continue;
      anyUpdated = true;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        this.dummy.position.set(0, -60, 0);
        this.dummy.scale.setScalar(0.001);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      s.vy -= s.gravity * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;

      const t = s.life / s.maxLife;
      const curScale = s.scale * (0.35 + 0.65 * t);
      this.dummy.position.set(s.x, s.y, s.z);
      this.dummy.rotation.set(s.life * 2.1, s.life * 1.4, 0);
      this.dummy.scale.setScalar(curScale);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    if (anyUpdated) {
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
