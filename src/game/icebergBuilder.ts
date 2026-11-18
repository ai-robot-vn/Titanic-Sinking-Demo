import * as THREE from 'three';
import { ProceduralTextureSet } from './textures';
import { IcebergVariant } from './types';

export interface IcebergEntity {
  id: number;
  variant: IcebergVariant;
  group: THREE.Group;
  x: number;
  z: number;
  vx: number;
  vz: number;
  rotY: number;
  rotSpeed: number;
  bobPhase: number;
  collisionRadius: number;
  height: number;
  nearMissAwarded: boolean;
  hitCooldown: number;
  warned: boolean;
}

function hashRand(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/**
 * Sculpts smooth-ridge natural glacial fractures using continuous multi-octave trig strata
 * rather than jagged random jitter, keeping flat-shaded crystalline planes realistic.
 */
function sculptGlacialGeometry(
  baseGeo: THREE.BufferGeometry,
  seed: number,
  ridgeAmp: number,
  flattenTop: boolean,
): THREE.BufferGeometry {
  const geo = baseGeo.toNonIndexed();
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    const ang = Math.atan2(z, x);
    const strata =
      Math.sin(ang * 3.0 + seed) * 0.45 +
      Math.cos(ang * 5.0 - y * 2.4 + seed * 1.7) * 0.32 +
      Math.sin((x + z) * 3.1 + y * 1.9 + seed * 0.6) * 0.23;

    const radial = 1 + strata * ridgeAmp;
    // Slight wave-cut notch near waterline (y near -0.2..+0.05)
    const waterlineNotch = Math.exp(-Math.pow((y + 0.08) * 5.5, 2)) * 0.14;
    const scaleXZ = Math.max(0.45, radial - waterlineNotch);

    let ny = y * (0.92 + strata * 0.16);
    if (flattenTop && ny > 0.42) {
      ny = 0.42 + (ny - 0.42) * 0.18;
    }

    pos.setXYZ(i, x * scaleXZ, ny, z * scaleXZ);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

export class IcebergFactory {
  private readonly sharedMaterials: THREE.Material[];
  private readonly glacialMat: THREE.MeshStandardMaterial;
  private readonly snowCapMat: THREE.MeshStandardMaterial;
  private readonly submergedIceMat: THREE.MeshStandardMaterial;
  private readonly foamRingMat: THREE.MeshStandardMaterial;
  private readonly variantTemplates: Record<IcebergVariant, THREE.BufferGeometry[][]> = {
    growler: [],
    tabular: [],
    pinnacle: [],
  };
  private readonly disposables: THREE.BufferGeometry[] = [];
  private nextId = 1;

  constructor(textures: ProceduralTextureSet) {
    this.glacialMat = new THREE.MeshStandardMaterial({
      color: 0xc2e2f7,
      map: textures.iceAlbedo,
      normalMap: textures.iceNormal,
      normalScale: new THREE.Vector2(0.95, 0.95),
      emissive: 0x0a2e45,
      emissiveIntensity: 0.22,
      roughness: 0.28,
      metalness: 0.06,
      flatShading: true,
    });

    this.snowCapMat = new THREE.MeshStandardMaterial({
      color: 0xeef7fd,
      normalMap: textures.iceNormal,
      normalScale: new THREE.Vector2(0.4, 0.4),
      roughness: 0.78,
      metalness: 0.02,
      flatShading: true,
    });

    this.submergedIceMat = new THREE.MeshStandardMaterial({
      color: 0x2c85a3,
      emissive: 0x0d4961,
      emissiveIntensity: 0.5,
      roughness: 0.2,
      metalness: 0.06,
      flatShading: true,
    });

    this.foamRingMat = new THREE.MeshStandardMaterial({
      color: 0xd9effc,
      roughness: 0.88,
      metalness: 0.0,
      transparent: true,
      opacity: 0.44,
      depthWrite: false,
    });

    this.sharedMaterials = [
      this.glacialMat,
      this.snowCapMat,
      this.submergedIceMat,
      this.foamRingMat,
    ];

    this.buildVariantTemplates();
  }

  private track<T extends THREE.BufferGeometry>(g: T): T {
    this.disposables.push(g);
    return g;
  }

  private buildVariantTemplates(): void {
    for (let s = 0; s < 3; s++) {
      const seedBase = s * 73.4 + 11.2;

      // Growler
      const gMain = this.track(sculptGlacialGeometry(new THREE.IcosahedronGeometry(1.0, 2), seedBase, 0.34, true));
      const gShelf = this.track(sculptGlacialGeometry(new THREE.CylinderGeometry(1.12, 1.38, 0.65, 14, 2), seedBase + 5, 0.24, false));
      const gSpur = this.track(sculptGlacialGeometry(new THREE.IcosahedronGeometry(0.68, 1), seedBase + 11, 0.36, false));
      this.variantTemplates.growler.push([gMain, gShelf, gSpur]);

      // Tabular cliff berg
      const tMain = this.track(sculptGlacialGeometry(new THREE.CylinderGeometry(0.95, 1.16, 1.15, 16, 4), seedBase + 20, 0.28, true));
      const tShelf = this.track(sculptGlacialGeometry(new THREE.CylinderGeometry(1.22, 1.48, 0.6, 16, 2), seedBase + 27, 0.22, false));
      const tSnow = this.track(sculptGlacialGeometry(new THREE.CylinderGeometry(0.88, 0.96, 0.22, 14, 2), seedBase + 33, 0.18, true));
      this.variantTemplates.tabular.push([tMain, tShelf, tSnow]);

      // Pinnacle cathedral spire
      const pMain = this.track(sculptGlacialGeometry(new THREE.ConeGeometry(0.92, 2.25, 12, 4), seedBase + 40, 0.38, false));
      const pFlank = this.track(sculptGlacialGeometry(new THREE.ConeGeometry(0.64, 1.55, 10, 3), seedBase + 47, 0.36, false));
      const pShelf = this.track(sculptGlacialGeometry(new THREE.IcosahedronGeometry(1.15, 2), seedBase + 53, 0.3, true));
      this.variantTemplates.pinnacle.push([pMain, pFlank, pShelf]);
    }
  }

  public spawnIceberg(
    variant: IcebergVariant,
    x: number,
    z: number,
    scaleMultiplier = 1,
    vx = 0,
    vz = 0,
  ): IcebergEntity {
    const group = new THREE.Group();
    const seedIdx = this.nextId % 3;
    const geos = this.variantTemplates[variant][seedIdx];

    let baseRadius = 7;
    let height = 10;

    if (variant === 'growler') {
      baseRadius = 6.2 * scaleMultiplier;
      height = 5.2 * scaleMultiplier;

      const main = new THREE.Mesh(geos[0], this.glacialMat);
      main.scale.set(baseRadius, height * 0.72, baseRadius * 0.9);
      main.position.y = height * 0.22;
      main.castShadow = true;
      main.receiveShadow = true;
      group.add(main);

      const shelf = new THREE.Mesh(geos[1], this.submergedIceMat);
      shelf.scale.set(baseRadius * 1.05, 2.6, baseRadius * 1.02);
      shelf.position.y = -0.85;
      group.add(shelf);

      const spur1 = new THREE.Mesh(geos[2], this.snowCapMat);
      spur1.scale.set(baseRadius * 0.65, height * 0.52, baseRadius * 0.65);
      spur1.position.set(baseRadius * 0.42, height * 0.18, baseRadius * 0.2);
      spur1.castShadow = true;
      group.add(spur1);
    } else if (variant === 'tabular') {
      baseRadius = 11.8 * scaleMultiplier;
      height = 14.5 * scaleMultiplier;

      const main = new THREE.Mesh(geos[0], this.glacialMat);
      main.scale.set(baseRadius, height * 0.85, baseRadius * 0.85);
      main.position.y = height * 0.36;
      main.castShadow = true;
      main.receiveShadow = true;
      group.add(main);

      const shelf = new THREE.Mesh(geos[1], this.submergedIceMat);
      shelf.scale.set(baseRadius * 1.06, 3.6, baseRadius * 0.92);
      shelf.position.y = -1.25;
      group.add(shelf);

      const snow = new THREE.Mesh(geos[2], this.snowCapMat);
      snow.scale.set(baseRadius * 0.96, 1.75 * scaleMultiplier, baseRadius * 0.82);
      snow.position.y = height * 0.78;
      snow.receiveShadow = true;
      group.add(snow);

      const flank = new THREE.Mesh(geos[0], this.glacialMat);
      flank.scale.set(baseRadius * 0.46, height * 0.48, baseRadius * 0.54);
      flank.position.set(-baseRadius * 0.62, height * 0.15, baseRadius * 0.35);
      flank.rotation.y = 1.1;
      flank.castShadow = true;
      group.add(flank);
    } else {
      baseRadius = 9.4 * scaleMultiplier;
      height = 24.5 * scaleMultiplier;

      const main = new THREE.Mesh(geos[0], this.glacialMat);
      main.scale.set(baseRadius * 0.9, height * 0.55, baseRadius * 0.85);
      main.position.y = height * 0.45;
      main.castShadow = true;
      main.receiveShadow = true;
      group.add(main);

      const flank1 = new THREE.Mesh(geos[1], this.snowCapMat);
      flank1.scale.set(baseRadius * 0.85, height * 0.42, baseRadius * 0.85);
      flank1.position.set(baseRadius * 0.48, height * 0.28, -baseRadius * 0.15);
      flank1.rotation.z = -0.18;
      flank1.castShadow = true;
      group.add(flank1);

      const flank2 = new THREE.Mesh(geos[1], this.glacialMat);
      flank2.scale.set(baseRadius * 0.7, height * 0.32, baseRadius * 0.7);
      flank2.position.set(-baseRadius * 0.52, height * 0.2, baseRadius * 0.28);
      flank2.rotation.z = 0.22;
      flank2.castShadow = true;
      group.add(flank2);

      const shelf = new THREE.Mesh(geos[2], this.submergedIceMat);
      shelf.scale.set(baseRadius * 1.12, 4.0, baseRadius * 1.06);
      shelf.position.y = -1.15;
      group.add(shelf);
    }

    const collarGeo = this.track(new THREE.RingGeometry(baseRadius * 0.94, baseRadius * 1.24, 24));
    collarGeo.rotateX(-Math.PI / 2);
    const collar = new THREE.Mesh(collarGeo, this.foamRingMat);
    collar.position.y = 0.08;
    group.add(collar);

    const rotY = hashRand(this.nextId * 7.3) * Math.PI * 2;
    group.position.set(x, 0, z);
    group.rotation.y = rotY;

    return {
      id: this.nextId++,
      variant,
      group,
      x,
      z,
      vx,
      vz,
      rotY,
      rotSpeed: (hashRand(this.nextId * 3.1) - 0.5) * 0.04,
      bobPhase: hashRand(this.nextId * 5.7) * Math.PI * 2,
      collisionRadius: baseRadius * 0.88,
      height,
      nearMissAwarded: false,
      hitCooldown: 0,
      warned: false,
    };
  }

  public dispose(): void {
    this.disposables.forEach((g) => g.dispose());
    this.sharedMaterials.forEach((m) => m.dispose());
  }
}
