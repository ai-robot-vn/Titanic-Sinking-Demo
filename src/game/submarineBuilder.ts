import * as THREE from 'three';

export interface SubmarineRig {
  root: THREE.Group;
  setSubmarineState: (
    time: number,
    propRpmNorm: number,
    nightMix: number,
    diveY: number,
    damagePitch: number,
    damageRoll: number,
    gunYaw: number,
    gunFireFlash: number,
    hitFireIntensity: number,
  ) => void;
  dispose: () => void;
}

// Tapered 64m 1912-1915 U-Boat hull station profile (z = -32 bow .. +32 stern, max half-beam = 3.1m)
function sampleSubStation(z: number): { beam: number; heightTop: number; depthBot: number } {
  let beam = 3.1;
  let heightTop = 2.05;
  let depthBot = -3.4;

  if (z < -10) {
    const t = THREE.MathUtils.clamp((z - -32) / 22, 0, 1);
    beam = 3.1 * Math.pow(Math.sin((t * Math.PI) / 2), 0.72);
    heightTop = 1.45 + 0.6 * t;
    depthBot = -1.9 - 1.5 * Math.pow(t, 0.7);
  } else if (z > 10) {
    const t = THREE.MathUtils.clamp((32 - z) / 22, 0, 1);
    beam = 3.1 * Math.pow(Math.sin((t * Math.PI) / 2), 0.68);
    heightTop = 1.25 + 0.8 * t;
    depthBot = -1.4 - 2.0 * Math.pow(t, 0.75);
  }

  return { beam, heightTop, depthBot };
}

function buildLoftedSubmarineHull(zSamples: number[], radialSteps: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringPts = radialSteps + 1;

  for (let zi = 0; zi < zSamples.length; zi++) {
    const z = zSamples[zi];
    const { beam, heightTop, depthBot } = sampleSubStation(z);
    const vCoord = (z + 32) / 64;

    for (let ri = 0; ri < ringPts; ri++) {
      const theta = (ri / radialSteps) * Math.PI * 2;
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      // Saddle-tank bulge on sides + flatter upper casing deck
      const saddleBulge = 1.0 + 0.14 * Math.exp(-Math.pow(cosT, 2) * 3.2);
      const x = sinT * beam * saddleBulge;
      const y = cosT >= 0 ? cosT * heightTop : -cosT * depthBot;
      positions.push(x, y, z);
      uvs.push(ri / radialSteps, vCoord * 4);
    }
  }

  for (let zi = 0; zi < zSamples.length - 1; zi++) {
    for (let ri = 0; ri < radialSteps; ri++) {
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

export function buildSubmarineShip(isSoftwareGl: boolean): SubmarineRig {
  const root = new THREE.Group();
  const hullGroup = new THREE.Group();
  root.add(hullGroup);

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

  const uboatGreyMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x3b444d,
      roughness: 0.56,
      metalness: 0.48,
      side: THREE.DoubleSide,
    }),
  );
  const darkIronMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1e242b,
      roughness: 0.42,
      metalness: 0.72,
    }),
  );
  const woodCasingMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x2c3035,
      roughness: 0.82,
      metalness: 0.12,
    }),
  );
  const brassMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xb99242,
      roughness: 0.25,
      metalness: 0.85,
    }),
  );
  const signalLampMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xff5a36,
      emissive: 0xff3b1f,
      emissiveIntensity: 1.8,
      roughness: 0.3,
    }),
  );
  const flashMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0xffc66b,
      transparent: true,
      opacity: 0.92,
    }),
  );
  const stayMat = trackMat(new THREE.MeshBasicMaterial({ color: 0x45505c }));

  // 1. Primary Silhouette: 64m Lofted Pressure & Saddle-Tank Hull
  const zStations = [-32, -28, -22, -14, -6, 2, 10, 18, 25, 30, 32];
  const hullMesh = new THREE.Mesh(trackGeo(buildLoftedSubmarineHull(zStations, 16)), uboatGreyMat);
  hullMesh.castShadow = !isSoftwareGl;
  hullMesh.receiveShadow = true;
  hullGroup.add(hullMesh);

  // Flattened slatted upper casing deck running bow to stern
  const casingShape = new THREE.Shape();
  casingShape.moveTo(-0.35, 30.5);
  casingShape.quadraticCurveTo(-2.1, 18, -2.05, 0);
  casingShape.quadraticCurveTo(-2.0, -18, -0.25, -30.5);
  casingShape.lineTo(0.25, -30.5);
  casingShape.quadraticCurveTo(2.0, -18, 2.05, 0);
  casingShape.quadraticCurveTo(2.1, 18, 0.35, 30.5);
  casingShape.closePath();

  const casingGeo = trackGeo(
    new THREE.ExtrudeGeometry(casingShape, {
      depth: 0.32,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.04,
      bevelSegments: 2,
      curveSegments: 10,
    }),
  );
  casingGeo.rotateX(-Math.PI / 2);
  const casingDeck = new THREE.Mesh(casingGeo, woodCasingMat);
  casingDeck.position.y = 1.92;
  hullGroup.add(casingDeck);

  // 2. Secondary Silhouette: Streamlined Conning Tower / Sail + Periscopes
  const towerShape = new THREE.Shape();
  towerShape.moveTo(0, 6.2);
  towerShape.quadraticCurveTo(-1.28, 4.2, -1.25, 0);
  towerShape.quadraticCurveTo(-1.15, -4.5, 0, -5.8);
  towerShape.quadraticCurveTo(1.15, -4.5, 1.25, 0);
  towerShape.quadraticCurveTo(1.28, 4.2, 0, 6.2);
  towerShape.closePath();

  const towerGeo = trackGeo(
    new THREE.ExtrudeGeometry(towerShape, {
      depth: 2.85,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.08,
      bevelSegments: 2,
      curveSegments: 10,
    }),
  );
  towerGeo.rotateX(-Math.PI / 2);
  const conningTower = new THREE.Mesh(towerGeo, uboatGreyMat);
  conningTower.position.set(0, 2.1, -1.5);
  conningTower.castShadow = !isSoftwareGl;
  hullGroup.add(conningTower);

  // Bridge spray shield rim atop conning tower
  const sprayRim = new THREE.Mesh(trackGeo(buildLoftedTowerCap()), darkIronMat);
  sprayRim.position.set(0, 4.95, -1.5);
  hullGroup.add(sprayRim);

  // Twin telescoping brass/steel periscopes + wireless mast
  const scopeA = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.08, 0.11, 3.6, 8)), brassMat);
  scopeA.position.set(0.24, 6.55, -2.6);
  hullGroup.add(scopeA);

  const scopeHead = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.18, 0.16, 0.34)), darkIronMat);
  scopeHead.position.set(0.24, 8.32, -2.72);
  hullGroup.add(scopeHead);

  const scopeB = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.07, 0.09, 2.7, 8)), darkIronMat);
  scopeB.position.set(-0.24, 6.1, -1.1);
  hullGroup.add(scopeB);

  const mastPole = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.04, 0.06, 4.8, 6)), darkIronMat);
  mastPole.position.set(0, 7.1, 2.4);
  hullGroup.add(mastPole);

  const conningLamp = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.18, 8, 8)), signalLampMat);
  conningLamp.position.set(0, 5.25, -4.6);
  hullGroup.add(conningLamp);

  // Jumping/wire cutters & wireless aerials from bow & stern to conning tower
  for (const [zStart, zEnd, yStart, yEnd] of [
    [-30.5, -2.2, 2.1, 5.15],
    [29.5, 2.4, 1.9, 9.2],
  ]) {
    const wire = new THREE.Mesh(
      trackGeo(
        new THREE.TubeGeometry(
          new THREE.LineCurve3(new THREE.Vector3(0, yStart, zStart), new THREE.Vector3(0, yEnd, zEnd)),
          2,
          0.025,
          5,
          false,
        ),
      ),
      stayMat,
    );
    hullGroup.add(wire);
  }

  // 3. Forward 8.8 cm Naval Deck Gun (tracks Titanic / Carpathia!) + Muzzle Flash
  const gunPivot = new THREE.Group();
  gunPivot.position.set(0, 2.24, -12.8);

  const gunPedestal = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.45, 0.58, 0.72, 10)), darkIronMat);
  gunPedestal.position.y = 0.36;
  gunPivot.add(gunPedestal);

  const gunBreech = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.62, 0.48, 0.95)), darkIronMat);
  gunBreech.position.set(0, 0.86, 0.15);
  gunPivot.add(gunBreech);

  const barrelGeo = trackGeo(new THREE.CylinderGeometry(0.075, 0.13, 3.6, 10));
  barrelGeo.rotateX(Math.PI / 2);
  const gunBarrel = new THREE.Mesh(barrelGeo, darkIronMat);
  gunBarrel.position.set(0, 0.92, -1.75);
  gunBarrel.rotation.x = 0.09;
  gunPivot.add(gunBarrel);

  const gunFlashMesh = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.78, 8, 8)), flashMat);
  gunFlashMesh.scale.set(0.85, 0.85, 2.2);
  gunFlashMesh.position.set(0, 1.05, -3.75);
  gunFlashMesh.visible = false;
  gunPivot.add(gunFlashMesh);

  hullGroup.add(gunPivot);

  // 4. Bow & Stern Hydroplanes, Rudder & Twin Bronze Propellers
  for (const side of [-1, 1] as const) {
    const bowPlane = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.45, 0.08, 0.75)), darkIronMat);
    bowPlane.position.set(side * 1.4, -0.1, -24.5);
    hullGroup.add(bowPlane);

    const sternPlane = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.55, 0.08, 0.85)), darkIronMat);
    sternPlane.position.set(side * 1.35, -0.2, 26.8);
    hullGroup.add(sternPlane);
  }

  const rudder = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.14, 1.9, 1.6)), darkIronMat);
  rudder.position.set(0, -0.6, 30.8);
  hullGroup.add(rudder);

  const props: THREE.Mesh[] = [];
  const propGeo = trackGeo(new THREE.BoxGeometry(0.95, 0.16, 0.08));
  for (const sx of [-0.72, 0.72]) {
    const prop = new THREE.Mesh(propGeo, brassMat);
    prop.position.set(sx, -0.7, 30.2);
    hullGroup.add(prop);
    props.push(prop);
  }

  // Hit fire glow (illuminates deck when struck by warship salvos)
  const hitFireLight = new THREE.PointLight(0xff6b2b, 0, 55, 1.4);
  hitFireLight.position.set(0, 3.6, -1.5);
  hullGroup.add(hitFireLight);

  function buildLoftedTowerCap(): THREE.BufferGeometry {
    const g = new THREE.CylinderGeometry(1.18, 1.24, 0.34, 16);
    g.scale(0.85, 1, 2.75);
    return g;
  }

  const setSubmarineState = (
    time: number,
    propRpmNorm: number,
    nightMix: number,
    diveY: number,
    damagePitch: number,
    damageRoll: number,
    gunYaw: number,
    gunFireFlash: number,
    hitFireIntensity: number,
  ) => {
    const bob = Math.sin(time * 1.3 + 0.5) * 0.14;
    hullGroup.position.y = diveY + bob;
    hullGroup.rotation.x = damagePitch + Math.sin(time * 0.95) * 0.015;
    hullGroup.rotation.z = damageRoll + Math.cos(time * 0.85) * 0.02;

    signalLampMat.emissiveIntensity = 0.4 + THREE.MathUtils.clamp(nightMix, 0, 1) * 1.8;
    gunPivot.rotation.y = gunYaw;
    gunBarrel.position.z = -1.75 + gunFireFlash * 0.38;
    gunFlashMesh.visible = gunFireFlash > 0.05;
    if (gunFlashMesh.visible) {
      flashMat.opacity = THREE.MathUtils.clamp(gunFireFlash, 0, 1);
      gunFlashMesh.scale.set(0.85 + gunFireFlash * 0.5, 0.85 + gunFireFlash * 0.5, 2.2 + gunFireFlash * 1.4);
    }

    hitFireLight.intensity = hitFireIntensity * 24;

    const spin = time * (2.5 + propRpmNorm * 14);
    props[0].rotation.z = spin;
    props[1].rotation.z = -spin;
  };

  return {
    root,
    setSubmarineState,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
