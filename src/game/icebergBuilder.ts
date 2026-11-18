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

// Deterministic pseudo-random helper
function hashRand(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function sculptIceGeometry(
  baseGeo: THREE.BufferGeometry,
  seed: number,
  jagScale: number,
  flattenTop: boolean,
): THREE.BufferGeometry {
  const geo = baseGeo.toNonIndexed();
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    // Quantize position slightly so shared vertices move consistently
    const qx = Math.round(x * 10);
    const qy = Math.round(y * 10);
    const qz = Math.round(z * 10);
    const h = hashRand(seed + qx * 13.7 + qy * 29.3 + qz * 47.1);
    const radial = 1 + (h - 0.5) * jagScale;

    let ny = y * (0.85 + h * 0.35);
    if (flattenTop && ny > 0.45) {
      ny = 0.45 + (ny - 0.45) * 0.22;
    }
    pos.setXYZ(i, x * radial, ny, z * radial);
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
      color: 0xb9dcf2,
      map: textures.iceAlbedo,
      bumpMap: textures.iceBump,
      bumpScale: 0.22,
      roughness: 0.32,
      metalness: 0.08,
      flatShading: true,
    });

    this.snowCapMat = new THREE.MeshStandardMaterial({
      color: 0xeaf5fc,
      roughness: 0.78,
      metalness: 0.02,
      flatShading: true,
    });

    this.submergedIceMat = new THREE.MeshStandardMaterial({
      color: 0x3b8ea8,
      emissive: 0x164e63,
      emissiveIntensity: 0.45,
      roughness: 0.22,
      metalness: 0.05,
      flatShading: true,
    });

    this.foamRingMat = new THREE.MeshStandardMaterial({
      color: 0xd5ecfa,
      roughness: 0.85,
      metalness: 0.0,
      transparent: true,
      opacity: 0.42,
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
    // 2 pre-sculpted seeds per archetype for crisp variety without runtime stall
    for (let s = 0; s < 2; s++) {
      const seedBase = s * 91 + 17;

      // Growler: low, wide dark-blue chunk with 4 parts
      const gMain = this.track(sculptIceGeometry(new THREE.DodecahedronGeometry(1.0, 1), seedBase, 0.55, true));
      const gShelf = this.track(sculptIceGeometry(new THREE.CylinderGeometry(1.15, 1.35, 0.6, 8), seedBase + 5, 0.3, false));
      const gSpur = this.track(sculptIceGeometry(new THREE.DodecahedronGeometry(0.65, 0), seedBase + 11, 0.5, false));
      this.variantTemplates.growler.push([gMain, gShelf, gSpur]);

      // Tabular: massive flat-topped cliff berg
      const tMain = this.track(sculptIceGeometry(new THREE.CylinderGeometry(0.95, 1.15, 1.1, 9, 2), seedBase + 20, 0.36, true));
      const tShelf = this.track(sculptIceGeometry(new THREE.CylinderGeometry(1.22, 1.45, 0.55, 10), seedBase + 27, 0.28, false));
      const tSnow = this.track(sculptIceGeometry(new THREE.CylinderGeometry(0.86, 0.94, 0.24, 9), seedBase + 33, 0.22, true));
      this.variantTemplates.tabular.push([tMain, tShelf, tSnow]);

      // Pinnacle: towering jagged cathedral spire
      const pMain = this.track(sculptIceGeometry(new THREE.ConeGeometry(0.9, 2.2, 7, 2), seedBase + 40, 0.48, false));
      const pFlank = this.track(sculptIceGeometry(new THREE.ConeGeometry(0.62, 1.5, 6, 1), seedBase + 47, 0.48, false));
      const pShelf = this.track(sculptIceGeometry(new THREE.DodecahedronGeometry(1.15, 1), seedBase + 53, 0.42, true));
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
    const seedIdx = this.nextId % 2;
    const geos = this.variantTemplates[variant][seedIdx];

    let baseRadius = 7;
    let height = 10;

    if (variant === 'growler') {
      baseRadius = 6.2 * scaleMultiplier;
      height = 5.4 * scaleMultiplier;

      const main = new THREE.Mesh(geos[0], this.glacialMat);
      main.scale.set(baseRadius, height * 0.72, baseRadius * 0.9);
      main.position.y = height * 0.22;
      main.castShadow = true;
      main.receiveShadow = true;
      group.add(main);

      const shelf = new THREE.Mesh(geos[1], this.submergedIceMat);
      shelf.scale.set(baseRadius * 1.04, 2.4, baseRadius * 1.02);
      shelf.position.y = -0.8;
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
      shelf.scale.set(baseRadius * 1.05, 3.4, baseRadius * 0.92);
      shelf.position.y = -1.2;
      group.add(shelf);

      const snow = new THREE.Mesh(geos[2], this.snowCapMat);
      snow.scale.set(baseRadius * 0.96, 1.8 * scaleMultiplier, baseRadius * 0.82);
      snow.position.y = height * 0.78;
      snow.receiveShadow = true;
      group.add(snow);

      const flank = new THREE.Mesh(geos[0], this.glacialMat);
      flank.scale.set(baseRadius * 0.45, height * 0.48, baseRadius * 0.55);
      flank.position.set(-baseRadius * 0.6, height * 0.16, baseRadius * 0.35);
      flank.rotation.y = 1.1;
      flank.castShadow = true;
      group.add(flank);
    } else {
      // Pinnacle cathedral berg
      baseRadius = 9.4 * scaleMultiplier;
      height = 24.0 * scaleMultiplier;

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
      shelf.scale.set(baseRadius * 1.1, 3.8, baseRadius * 1.05);
      shelf.position.y = -1.1;
      group.add(shelf);
    }

    // Subtle waterline foam collar (offset on Y to avoid Z-fighting with ocean)
    const collarGeo = this.track(new THREE.RingGeometry(baseRadius * 0.94, baseRadius * 1.24, 18));
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
