import * as THREE from 'three';

export interface OceanUniforms {
  uTime: { value: number };
  uShipPos: { value: THREE.Vector2 };
  uShipForward: { value: THREE.Vector2 };
  uShipSpeed: { value: number };
  uWarshipPos: { value: THREE.Vector2 };
  uWarshipForward: { value: THREE.Vector2 };
  uWarshipSpeed: { value: number };
  uWarship2Pos: { value: THREE.Vector2 };
  uWarship2Forward: { value: THREE.Vector2 };
  uWarship2Speed: { value: number };
  uNightMix: { value: number };
  uCameraPos: { value: THREE.Vector3 };
  uUnderwaterMix: { value: number };
  uHullDryCutout: { value: THREE.Vector2 };
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
    warshipX?: number,
    warshipZ?: number,
    warshipHeadingRad?: number,
    warshipSpeedKnots?: number,
    warship2X?: number,
    warship2Z?: number,
    warship2HeadingRad?: number,
    warship2SpeedKnots?: number,
    bowDryMask?: number,
    sternDryMask?: number,
  ) => void;
  updateCameraView: (camPos: THREE.Vector3, underwaterMix: number) => void;
  dispose: () => void;
}

export function sampleOceanWaveHeight(x: number, z: number, time: number): number {
  const w1 = Math.sin(x * 0.052 + time * 1.15) * Math.cos(z * 0.046 + time * 0.85);
  const w2 = Math.sin((x * 0.72 + z * 0.58) * 0.115 - time * 1.75);
  const w3 = Math.cos((x * -0.48 + z * 0.86) * 0.21 + time * 2.15);
  return w1 * 0.44 + w2 * 0.20 + w3 * 0.08;
}

export function createOceanAndSky(isSoftwareGl: boolean): OceanAndSkyRig {
  const uniforms: OceanUniforms = {
    uTime: { value: 0 },
    uShipPos: { value: new THREE.Vector2(0, 0) },
    uShipForward: { value: new THREE.Vector2(0, -1) },
    uShipSpeed: { value: 0 },
    uWarshipPos: { value: new THREE.Vector2(-86, -265) },
    uWarshipForward: { value: new THREE.Vector2(0, -1) },
    uWarshipSpeed: { value: 0 },
    uWarship2Pos: { value: new THREE.Vector2(92, -280) },
    uWarship2Forward: { value: new THREE.Vector2(0, -1) },
    uWarship2Speed: { value: 0 },
    uNightMix: { value: 1 },
    uCameraPos: { value: new THREE.Vector3(0, 15, 0) },
    uUnderwaterMix: { value: 0 },
    uHullDryCutout: { value: new THREE.Vector2(1, 1) },
  };

  const oceanSize = 2300;
  const segs = isSoftwareGl ? 80 : 156;
  const oceanGeo = new THREE.PlaneGeometry(oceanSize, oceanSize, segs, segs);
  oceanGeo.rotateX(-Math.PI / 2);

  const oceanMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.11,
    metalness: 0.36,
    envMapIntensity: 1.4,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  oceanMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uShipPos = uniforms.uShipPos;
    shader.uniforms.uShipForward = uniforms.uShipForward;
    shader.uniforms.uShipSpeed = uniforms.uShipSpeed;
    shader.uniforms.uWarshipPos = uniforms.uWarshipPos;
    shader.uniforms.uWarshipForward = uniforms.uWarshipForward;
    shader.uniforms.uWarshipSpeed = uniforms.uWarshipSpeed;
    shader.uniforms.uWarship2Pos = uniforms.uWarship2Pos;
    shader.uniforms.uWarship2Forward = uniforms.uWarship2Forward;
    shader.uniforms.uWarship2Speed = uniforms.uWarship2Speed;
    shader.uniforms.uNightMix = uniforms.uNightMix;
    shader.uniforms.uCameraPos = uniforms.uCameraPos;
    shader.uniforms.uUnderwaterMix = uniforms.uUnderwaterMix;
    shader.uniforms.uHullDryCutout = uniforms.uHullDryCutout;

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
      uniform vec2 uWarshipPos;
      uniform vec2 uWarshipForward;
      uniform float uWarshipSpeed;
      uniform vec2 uWarship2Pos;
      uniform vec2 uWarship2Forward;
      uniform float uWarship2Speed;
      uniform float uNightMix;
      uniform vec3 uCameraPos;
      uniform float uUnderwaterMix;
      uniform vec2 uHullDryCutout;
      varying vec3 vOceanWorldPos;
      varying float vWaveCrest;
      ` + shader.fragmentShader;

    // Perturb fragment normal for capillary glints above water and wave-underside caustics below
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `
      #include <normal_fragment_maps>
      float wx = vOceanWorldPos.x;
      float wz = vOceanWorldPos.z;
      float dhdx = cos(wx * 0.38 + uTime * 1.9) * 0.16 + cos((wx + wz * 0.6) * 0.92 - uTime * 2.8) * 0.12 + sin(wx * 2.1 - uTime * 3.6) * 0.06;
      float dhdz = sin(wz * 0.34 - uTime * 1.6) * 0.16 + sin((wz - wx * 0.5) * 0.88 + uTime * 2.5) * 0.12 + cos(wz * 1.9 + uTime * 3.3) * 0.06;
      vec3 rippleWorldN = normalize(vec3(-dhdx, 1.0, -dhdz));
      if (!gl_FrontFacing) {
        rippleWorldN = -rippleWorldN;
      }
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

      vec3 deepDay = vec3(0.020, 0.135, 0.225);
      vec3 crestDay = vec3(0.075, 0.285, 0.395);
      vec3 deepNight = vec3(0.014, 0.055, 0.105);
      vec3 crestNight = vec3(0.048, 0.165, 0.255);

      vec3 deepBase = mix(deepDay, deepNight, smoothstep(0.15, 0.9, nMix));
      vec3 crestBase = mix(crestDay, crestNight, smoothstep(0.15, 0.9, nMix));
      deepBase = mix(deepBase, vec3(0.045, 0.072, 0.145), sunsetWeight * 0.55);
      crestBase = mix(crestBase, vec3(0.21, 0.14, 0.135), sunsetWeight * 0.55);

      vec3 seaCol = mix(deepBase, crestBase, clamp(vWaveCrest + ripple * 0.2, 0.0, 1.0));

      // Ship bow Kelvin wake, hull rubbing foam & stern propeller wash (269m x 28m hull)
      vec2 rel = vOceanWorldPos.xz - uShipPos;
      vec2 fwd = normalize(uShipForward);
      vec2 right = vec2(-fwd.y, fwd.x);
      float along = dot(rel, fwd);   // +74 is bow tip, -195 is stern
      float side = abs(dot(rel, right));

      // Keep ocean plane clipped outside Titanic's dry watertight hull envelope (until flooded/sunk)
      float zShip = -along;
      if (zShip > -72.8 && zShip < 181.5) {
        float halfB = 14.0;
        if (zShip < -10.0) {
          float tB = clamp((zShip + 74.0) / 64.0, 0.0, 1.0);
          halfB = 14.0 * pow(sin(tB * 1.5707963), 0.78);
        } else if (zShip > 136.0) {
          float tS = clamp((195.1 - zShip) / 59.1, 0.0, 1.0);
          halfB = 14.0 * pow(sin(tS * 1.5707963), 0.65);
        }
        // Taper dry cutout cleanly before counter-stern overhang rises clear of the waterline
        float counterFade = 1.0 - smoothstep(173.0, 181.5, zShip);
        float dryHalfB = max(0.0, halfB * 0.915 - 0.14) * counterFade;
        float dryActive = zShip < 90.0 ? uHullDryCutout.x : uHullDryCutout.y;
        if (side < dryHalfB && dryActive > 0.5) {
          discard;
        }
      }

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

      // Escort Warship Kelvin bow wake, hull foam & stern wash (146m x 23.2m hull)
      float wSpeedFactor = clamp(abs(uWarshipSpeed) / 18.0, 0.0, 1.35);
      if (wSpeedFactor > 0.02) {
        vec2 wRel = vOceanWorldPos.xz - uWarshipPos;
        vec2 wFwd = normalize(uWarshipForward);
        vec2 wRight = vec2(-wFwd.y, wFwd.x);
        float wAlong = dot(wRel, wFwd); // +73 is bow tip, -73 is stern
        float wSide = abs(dot(wRel, wRight));
        float wDistBehind = 72.5 - wAlong;
        if (wDistBehind > -3.0 && wDistBehind < 280.0) {
          float wArmDist = abs(wSide - (1.8 + max(0.0, wDistBehind) * 0.21));
          float wArm = exp(-wArmDist * wArmDist * 0.16);
          float wHullRub = exp(-abs(wSide - 11.4) * 0.5) * step(-70.0, wAlong) * step(wAlong, 50.0);
          float wBowSplash = exp(-((wAlong - 72.5) * (wAlong - 72.5) * 0.06 + wSide * wSide * 0.11));
          float wSternWash = exp(-wSide * wSide * 0.07) * step(wAlong, -70.0) * exp(-max(0.0, -70.0 - wAlong) * 0.022);
          float wFade = exp(-max(0.0, wDistBehind) * 0.008);
          float wNoise = 0.65 + 0.35 * sin(vOceanWorldPos.x * 1.05 + uTime * 4.8) * cos(vOceanWorldPos.z * 1.05 - uTime * 4.1);
          float wMask = clamp((wArm * 0.85 + wHullRub * 0.45 + wBowSplash * 1.2 + wSternWash * 0.9) * wFade * wSpeedFactor * wNoise, 0.0, 1.0);
          wakeMask = max(wakeMask, wMask);
        }
      }

      // Second Escort Warship Kelvin bow wake, hull foam & stern wash
      float w2SpeedFactor = clamp(abs(uWarship2Speed) / 18.0, 0.0, 1.35);
      if (w2SpeedFactor > 0.02) {
        vec2 wRel2 = vOceanWorldPos.xz - uWarship2Pos;
        vec2 wFwd2 = normalize(uWarship2Forward);
        vec2 wRight2 = vec2(-wFwd2.y, wFwd2.x);
        float wAlong2 = dot(wRel2, wFwd2);
        float wSide2 = abs(dot(wRel2, wRight2));
        float wDistBehind2 = 72.5 - wAlong2;
        if (wDistBehind2 > -3.0 && wDistBehind2 < 280.0) {
          float wArmDist2 = abs(wSide2 - (1.8 + max(0.0, wDistBehind2) * 0.21));
          float wArm2 = exp(-wArmDist2 * wArmDist2 * 0.16);
          float wHullRub2 = exp(-abs(wSide2 - 11.4) * 0.5) * step(-70.0, wAlong2) * step(wAlong2, 50.0);
          float wBowSplash2 = exp(-((wAlong2 - 72.5) * (wAlong2 - 72.5) * 0.06 + wSide2 * wSide2 * 0.11));
          float wSternWash2 = exp(-wSide2 * wSide2 * 0.07) * step(wAlong2, -70.0) * exp(-max(0.0, -70.0 - wAlong2) * 0.022);
          float wFade2 = exp(-max(0.0, wDistBehind2) * 0.008);
          float wNoise2 = 0.65 + 0.35 * sin(vOceanWorldPos.x * 1.05 + uTime * 4.8) * cos(vOceanWorldPos.z * 1.05 - uTime * 4.1);
          float wMask2 = clamp((wArm2 * 0.85 + wHullRub2 * 0.45 + wBowSplash2 * 1.2 + wSternWash2 * 0.9) * wFade2 * w2SpeedFactor * wNoise2, 0.0, 1.0);
          wakeMask = max(wakeMask, wMask2);
        }
      }

      vec3 foamNight = vec3(0.76, 0.89, 0.98);
      vec3 foamDay = vec3(0.92, 0.96, 1.0);
      vec3 foamCol = mix(foamDay, foamNight, nMix);
      foamCol = mix(foamCol, vec3(0.96, 0.78, 0.62), sunsetWeight * 0.5);

      // View-dependent translucency (above water) & Snell's window (underwater underside)
      vec3 viewToCam = normalize(uCameraPos - vOceanWorldPos);
      vec3 upWaveN = normalize(vec3(
        -(cos(vOceanWorldPos.x * 0.38 + uTime * 1.9) * 0.16 + cos((vOceanWorldPos.x + vOceanWorldPos.z * 0.6) * 0.92 - uTime * 2.8) * 0.12),
        1.0,
        -(sin(vOceanWorldPos.z * 0.34 - uTime * 1.6) * 0.16 + sin((vOceanWorldPos.z - vOceanWorldPos.x * 0.5) * 0.88 + uTime * 2.5) * 0.12)
      ));

      if (gl_FrontFacing) {
        float ndv = clamp(dot(upWaveN, viewToCam), 0.0, 1.0);
        float fresnel = pow(1.0 - ndv, 2.8);
        diffuseColor.rgb = mix(seaCol, foamCol, wakeMask * 0.86);
        float waterAlpha = mix(0.54, 0.95, fresnel);
        diffuseColor.a = mix(waterAlpha, 0.95, clamp(wakeMask * 0.95, 0.0, 1.0));
      } else {
        // Underwater underside: Snell's window transmission directly overhead + TIR shimmering teal outside
        float cosUp = clamp(dot(upWaveN, -viewToCam), 0.0, 1.0);
        float snell = smoothstep(0.36, 0.74, cosUp);
        float caustic = pow(clamp(1.0 - abs(ripple) * 1.15, 0.0, 1.0), 3.0);
        vec3 tirTeal = mix(vec3(0.03, 0.18, 0.26), vec3(0.11, 0.42, 0.54), clamp(vWaveCrest * 0.6 + caustic * 0.55, 0.0, 1.0));
        vec3 snellSky = mix(vec3(0.22, 0.50, 0.68), vec3(0.08, 0.24, 0.38), nMix);
        vec3 undersideCol = mix(tirTeal, snellSky, snell * 0.78);
        undersideCol = mix(undersideCol, foamCol * 0.65, wakeMask * 0.45);
        diffuseColor.rgb = undersideCol;
        diffuseColor.a = mix(0.74, 0.24, snell);
      }
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `
      #include <emissivemap_fragment>
      if (!gl_FrontFacing) {
        float causticGlow = pow(clamp(1.0 - abs(sin(vOceanWorldPos.x * 0.72 + uTime * 2.4) * cos(vOceanWorldPos.z * 0.64 - uTime * 1.8)), 0.0, 1.0), 4.0);
        vec3 underRayVec = normalize(uCameraPos - vOceanWorldPos);
        float snellGlow = smoothstep(0.36, 0.76, clamp(-underRayVec.y, 0.0, 1.0));
        vec3 moonlightRefract = mix(vec3(0.18, 0.42, 0.56), vec3(0.06, 0.20, 0.32), clamp(uNightMix, 0.0, 1.0));
        totalEmissiveRadiance += moonlightRefract * (0.28 + 0.55 * snellGlow) + vec3(0.06, 0.24, 0.32) * causticGlow * (0.35 + 0.4 * snellGlow);
      }
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
  oceanMesh.renderOrder = 2;

  // Deep abyssal sea-depth plane far below keel (-118 m) so translucent surface preserves rich oceanic color above & below
  const abyssGeo = new THREE.PlaneGeometry(2500, 2500, 1, 1);
  abyssGeo.rotateX(-Math.PI / 2);
  const abyssMat = new THREE.MeshBasicMaterial({
    color: 0x051c2b,
    fog: true,
  });
  const abyssMesh = new THREE.Mesh(abyssGeo, abyssMat);
  abyssMesh.position.y = -118;

  // =========================================================================
  // SKY DOME: APRIL HARBOR DAYLIGHT -> ATLANTIC SUNSET -> ARCTIC MOONLIT NIGHT
  // =========================================================================
  const skyGroup = new THREE.Group();
  skyGroup.add(abyssMesh);

  const skyGeo = new THREE.SphereGeometry(1180, 36, 22);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uNightMix: { value: 1.0 },
      uUnderwaterMix: { value: 0.0 },
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
      uniform float uUnderwaterMix;
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

        // Underwater horizon darkening below sea surface while leaving Snell's window overhead luminous
        if (uUnderwaterMix > 0.01) {
          vec3 deepWaterFog = vec3(0.012, 0.068, 0.112);
          float belowHor = 1.0 - smoothstep(-0.08, 0.26, dir.y);
          col = mix(col, deepWaterFog, clamp(uUnderwaterMix * (0.28 + 0.72 * belowHor), 0.0, 1.0));
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

  // GPU-wrapped suspended underwater marine snow & micro-bubbles (zero per-frame CPU iteration)
  const marineCount = isSoftwareGl ? 180 : 420;
  const marinePos = new Float32Array(marineCount * 3);
  const marineSeed = new Float32Array(marineCount);
  for (let i = 0; i < marineCount; i++) {
    marinePos[i * 3 + 0] = (((i * 73.17) % 1000) / 1000) * 44;
    marinePos[i * 3 + 1] = (((i * 191.43) % 1000) / 1000) * 24;
    marinePos[i * 3 + 2] = (((i * 317.89) % 1000) / 1000) * 44;
    marineSeed[i] = 0.5 + (((i * 41) % 100) / 100);
  }
  const marineGeo = new THREE.BufferGeometry();
  marineGeo.setAttribute('position', new THREE.BufferAttribute(marinePos, 3));
  marineGeo.setAttribute('aSeed', new THREE.BufferAttribute(marineSeed, 1));
  const marineMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: uniforms.uTime,
      uCameraPos: uniforms.uCameraPos,
      uUnderwaterMix: uniforms.uUnderwaterMix,
    },
    vertexShader: `
      attribute float aSeed;
      uniform float uTime;
      uniform vec3 uCameraPos;
      varying float vFade;
      void main() {
        vec3 box = vec3(44.0, 24.0, 44.0);
        vec3 drift = position + vec3(
          sin(uTime * 0.45 + aSeed * 6.28) * 1.1,
          uTime * (0.45 + aSeed * 0.55),
          cos(uTime * 0.38 + aSeed * 5.1) * 1.1
        );
        vec3 wrapped = mod(drift - uCameraPos + box * 0.5, box) - box * 0.5 + uCameraPos;
        // Clamp below sea level so marine snow never floats into dry air above waves
        if (wrapped.y > -0.15) {
          vFade = 0.0;
        } else {
          float dist = length(wrapped - uCameraPos);
          vFade = (1.0 - smoothstep(10.0, 22.0, dist)) * smoothstep(0.6, 2.2, dist);
        }
        vec4 mvPosition = modelViewMatrix * vec4(wrapped, 1.0);
        gl_PointSize = clamp((24.0 * aSeed) / max(1.0, -mvPosition.z), 1.5, 5.5);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uUnderwaterMix;
      varying float vFade;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5 || vFade <= 0.005) discard;
        float soft = smoothstep(0.5, 0.08, d);
        gl_FragColor = vec4(0.62, 0.88, 0.98, soft * vFade * uUnderwaterMix * 0.62);
      }
    `,
  });
  const marinePoints = new THREE.Points(marineGeo, marineMat);
  marinePoints.frustumCulled = false;
  marinePoints.renderOrder = 1;
  marinePoints.visible = false;
  skyGroup.add(marinePoints);

  const snapStep = oceanSize / segs;
  const abyssDayColor = new THREE.Color(0x051c2b);
  const abyssNightColor = new THREE.Color(0x020b15);

  const update = (
    time: number,
    shipX: number,
    shipZ: number,
    headingRad: number,
    speedKnots: number,
    nightMix = 1.0,
    warshipX = -86,
    warshipZ = -265,
    warshipHeadingRad = 0,
    warshipSpeedKnots = 0,
    warship2X = 92,
    warship2Z = -280,
    warship2HeadingRad = 0,
    warship2SpeedKnots = 0,
    bowDryMask = 1.0,
    sternDryMask = 1.0,
  ) => {
    const clampedNight = THREE.MathUtils.clamp(nightMix, 0, 1);
    uniforms.uTime.value = time;
    uniforms.uShipPos.value.set(shipX, shipZ);
    uniforms.uShipForward.value.set(Math.sin(headingRad), -Math.cos(headingRad));
    uniforms.uShipSpeed.value = speedKnots;
    uniforms.uWarshipPos.value.set(warshipX, warshipZ);
    uniforms.uWarshipForward.value.set(Math.sin(warshipHeadingRad), -Math.cos(warshipHeadingRad));
    uniforms.uWarshipSpeed.value = warshipSpeedKnots;
    uniforms.uWarship2Pos.value.set(warship2X, warship2Z);
    uniforms.uWarship2Forward.value.set(Math.sin(warship2HeadingRad), -Math.cos(warship2HeadingRad));
    uniforms.uWarship2Speed.value = warship2SpeedKnots;
    uniforms.uNightMix.value = clampedNight;
    uniforms.uHullDryCutout.value.set(bowDryMask, sternDryMask);

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

    abyssMat.color.copy(abyssDayColor).lerp(abyssNightColor, clampedNight);

    oceanMesh.position.x = Math.round(shipX / snapStep) * snapStep;
    oceanMesh.position.z = Math.round(shipZ / snapStep) * snapStep;

    skyGroup.position.set(shipX, 0, shipZ);
  };

  const updateCameraView = (camPos: THREE.Vector3, underwaterMix: number) => {
    uniforms.uCameraPos.value.copy(camPos);
    const clampedUnder = THREE.MathUtils.clamp(underwaterMix, 0, 1);
    uniforms.uUnderwaterMix.value = clampedUnder;
    skyMat.uniforms.uUnderwaterMix.value = clampedUnder;
    marinePoints.visible = clampedUnder > 0.01;
    // Keep abyss floor comfortably below deep plunging camera
    abyssMesh.position.y = Math.min(-118, camPos.y - 45);
  };

  const dispose = () => {
    oceanGeo.dispose();
    oceanMat.dispose();
    abyssGeo.dispose();
    abyssMat.dispose();
    skyGeo.dispose();
    skyMat.dispose();
    moonGeo.dispose();
    moonMat.dispose();
    haloGeo.dispose();
    haloMat.dispose();
    starGeo.dispose();
    starMat.dispose();
    marineGeo.dispose();
    marineMat.dispose();
  };

  return { oceanMesh, skyGroup, uniforms, update, updateCameraView, dispose };
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
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, maxCount);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;

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
