import * as THREE from 'three';

export interface OceanUniforms {
  uTime: { value: number };
  uShipPos: { value: THREE.Vector2 };
  uShipForward: { value: THREE.Vector2 };
  uShipSpeed: { value: number };
}

export interface OceanAndSkyRig {
  oceanMesh: THREE.Mesh;
  skyGroup: THREE.Group;
  uniforms: OceanUniforms;
  update: (time: number, shipX: number, shipZ: number, headingRad: number, speedKnots: number) => void;
  dispose: () => void;
}

export function createOceanAndSky(isSoftwareGl: boolean): OceanAndSkyRig {
  const uniforms: OceanUniforms = {
    uTime: { value: 0 },
    uShipPos: { value: new THREE.Vector2(0, 0) },
    uShipForward: { value: new THREE.Vector2(0, -1) },
    uShipSpeed: { value: 0 },
  };

  // Large ocean grid centered near ship (snapped to grid step so waves never swim)
  const oceanSize = 1800;
  const segs = isSoftwareGl ? 72 : 128;
  const oceanGeo = new THREE.PlaneGeometry(oceanSize, oceanSize, segs, segs);
  oceanGeo.rotateX(-Math.PI / 2);

  const oceanMat = new THREE.MeshStandardMaterial({
    color: 0x071929,
    roughness: 0.16,
    metalness: 0.35,
    envMapIntensity: 1.25,
    side: THREE.DoubleSide,
  });

  oceanMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uShipPos = uniforms.uShipPos;
    shader.uniforms.uShipForward = uniforms.uShipForward;
    shader.uniforms.uShipSpeed = uniforms.uShipSpeed;

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
      float w1 = sin(oceanWp.x * 0.055 + uTime * 1.15) * cos(oceanWp.z * 0.048 + uTime * 0.85);
      float w2 = sin((oceanWp.x * 0.7 + oceanWp.z * 0.6) * 0.11 - uTime * 1.75);
      float w3 = cos((oceanWp.x * -0.5 + oceanWp.z * 0.85) * 0.19 + uTime * 2.1);
      float swell = w1 * 0.42 + w2 * 0.19 + w3 * 0.08;
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
      varying vec3 vOceanWorldPos;
      varying float vWaveCrest;
      ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      // Fine surface ripples
      float ripA = sin(vOceanWorldPos.x * 0.65 + uTime * 2.2) * cos(vOceanWorldPos.z * 0.58 - uTime * 1.6);
      float ripB = sin((vOceanWorldPos.x - vOceanWorldPos.z) * 1.25 + uTime * 3.1);
      float ripple = (ripA + ripB) * 0.5;

      vec3 deepSea = vec3(0.018, 0.058, 0.105);
      vec3 crestSea = vec3(0.045, 0.135, 0.215);
      vec3 seaCol = mix(deepSea, crestSea, clamp(vWaveCrest + ripple * 0.18, 0.0, 1.0));

      // Ship bow Kelvin wake & hull foam in world space
      vec2 rel = vOceanWorldPos.xz - uShipPos;
      vec2 fwd = normalize(uShipForward);
      vec2 right = vec2(-fwd.y, fwd.x);
      float along = dot(rel, fwd);   // +68 is bow tip, negative is aft
      float side = abs(dot(rel, right));

      float speedFactor = clamp(abs(uShipSpeed) / 18.0, 0.0, 1.25);
      // Bow is around along = 66, hull sides ~ 9.2
      float distBehindBow = 66.0 - along;
      float wakeMask = 0.0;
      if (distBehindBow > -2.0 && distBehindBow < 190.0) {
        float armDist = abs(side - (1.8 + max(0.0, distBehindBow) * 0.24));
        float arm = exp(-armDist * armDist * 0.18);
        float hullRub = exp(-abs(side - 9.0) * 0.55) * step(-25.0, along) * step(along, 52.0);
        float bowSplash = exp(-((along - 66.0) * (along - 66.0) * 0.06 + side * side * 0.12));
        float fade = exp(-max(0.0, distBehindBow) * 0.011);
        float foamNoise = 0.65 + 0.35 * sin(vOceanWorldPos.x * 0.9 + uTime * 4.5) * cos(vOceanWorldPos.z * 0.9 - uTime * 3.8);
        wakeMask = clamp((arm * 0.85 + hullRub * 0.45 + bowSplash * 1.15) * fade * speedFactor * foamNoise, 0.0, 1.0);
      }

      vec3 foamCol = vec3(0.72, 0.86, 0.96);
      diffuseColor.rgb = mix(seaCol, foamCol, wakeMask * 0.85);
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `
      #include <roughnessmap_fragment>
      float rNoise = sin(vOceanWorldPos.x * 0.8 + uTime * 2.5) * cos(vOceanWorldPos.z * 0.75 - uTime * 2.0);
      roughnessFactor = clamp(0.14 + rNoise * 0.06, 0.06, 0.45);
      `,
    );
  };

  const oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
  oceanMesh.receiveShadow = true;

  // =========================================================================
  // ARCTIC SKY DOME, COLD MOON & INSTANCED STARFIELD
  // =========================================================================
  const skyGroup = new THREE.Group();

  const skyGeo = new THREE.SphereGeometry(950, 32, 20);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTopColor: { value: new THREE.Color(0x02050c) },
      uMidColor: { value: new THREE.Color(0x071324) },
      uHorizonColor: { value: new THREE.Color(0x0b1a2d) },
    },
    vertexShader: `
      varying vec3 vLocalPos;
      void main() {
        vLocalPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uTopColor;
      uniform vec3 uMidColor;
      uniform vec3 uHorizonColor;
      varying vec3 vLocalPos;
      void main() {
        float h = clamp(normalize(vLocalPos).y, 0.0, 1.0);
        vec3 col = mix(uHorizonColor, uMidColor, smoothstep(0.0, 0.25, h));
        col = mix(col, uTopColor, smoothstep(0.22, 0.85, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  skyGroup.add(skyDome);

  // Cold North Atlantic Moon (high ahead-starboard to cast dramatic specular path)
  const moonGeo = new THREE.CircleGeometry(22, 28);
  const moonMat = new THREE.MeshBasicMaterial({
    color: 0xe6f2ff,
    fog: false,
  });
  const moonMesh = new THREE.Mesh(moonGeo, moonMat);
  moonMesh.position.set(170, 210, -760);
  moonMesh.lookAt(0, 0, 0);
  skyGroup.add(moonMesh);

  // Subtle Moon Halo
  const haloGeo = new THREE.RingGeometry(22, 55, 32);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0x7cb3e0,
    transparent: true,
    opacity: 0.12,
    fog: false,
    depthWrite: false,
  });
  const haloMesh = new THREE.Mesh(haloGeo, haloMat);
  haloMesh.position.copy(moonMesh.position);
  haloMesh.lookAt(0, 0, 0);
  skyGroup.add(haloMesh);

  // Instanced Starfield (900 stars with computeBoundingSphere)
  const starCount = 900;
  const starGeo = new THREE.OctahedronGeometry(0.9, 0);
  const starMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    fog: false,
  });
  const stars = new THREE.InstancedMesh(starGeo, starMat, starCount);
  const dummy = new THREE.Object3D();
  const starColor = new THREE.Color();

  for (let i = 0; i < starCount; i++) {
    const u = ((i * 73.13) % 1000) / 1000;
    const v = ((i * 197.41) % 1000) / 1000;
    const theta = u * Math.PI * 2;
    const phi = Math.acos(0.08 + v * 0.91); // above horizon
    const r = 820;

    dummy.position.set(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta),
    );
    const scale = 0.45 + ((i * 37) % 100) / 95;
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    stars.setMatrixAt(i, dummy.matrix);

    // Subtle cool/warm star color temperatures
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
  ) => {
    uniforms.uTime.value = time;
    uniforms.uShipPos.value.set(shipX, shipZ);
    // Forward direction in world space when ship rotation.y = -headingRad
    uniforms.uShipForward.value.set(Math.sin(headingRad), -Math.cos(headingRad));
    uniforms.uShipSpeed.value = speedKnots;

    // Snap ocean grid to vertex step to avoid swimming vertices while following ship infinitely
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
// POOLED PARTICLE SYSTEM (Bow Spray, Ice Shards, Funnel Smoke)
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

  constructor(maxCount = 260) {
    this.maxCount = maxCount;
    const geo = new THREE.DodecahedronGeometry(0.42, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.45,
      metalness: 0.05,
      transparent: true,
      opacity: 0.85,
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
    this.mesh.setColorAt(this.cursor === 0 ? this.maxCount - 1 : this.cursor - 1, this.tempColor);
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
