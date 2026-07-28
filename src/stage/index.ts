/**
 * Subsistema `stage` — el suelo y el fondo del banco de pruebas.
 *
 * No es el nivel del juego. Es un plató: existe para que el personaje tenga
 * dónde apoyar la sombra y algo contra lo que recortarse. Cuando llegue un
 * subsistema `world` de verdad, éste se borra entero — por eso no comparte
 * nada con `character`.
 */

import * as THREE from 'three';
import type { Ctx, System } from '../core/types';
import { Noise } from '../character/geo';

export class StageSystem implements System {
  static readonly id = 'stage';
  static readonly deps = ['render'] as const;

  private group = new THREE.Group();
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];

  init(ctx: Ctx): void {
    const rng = ctx.rng.fork();
    const noise = new Noise(() => rng.float());

    // --- suelo: polvo y grava, con relieve suficiente para que la sombra tenga forma ---
    const size = 512;
    const data = new Uint8ClampedArray(size * size * 4);
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const grit = noise.fbm(u * 40, v * 40, 2.5, 5) * 0.5 + 0.5;
        const patch = noise.fbm(u * 6, v * 6, 17.0, 3) * 0.5 + 0.5;
        const l = 0.055 + grit * 0.05 + patch * 0.035;
        const i = (y * size + x) * 4;
        data[i] = l * 255 * 1.12;
        data[i + 1] = l * 255 * 1.0;
        data[i + 2] = l * 255 * 0.82;
        data[i + 3] = 255;
        height[y * size + x] = grit;
      }
    }
    const albedo = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    albedo.colorSpace = THREE.SRGBColorSpace;
    albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
    albedo.repeat.set(14, 14);
    albedo.anisotropy = 8;
    albedo.minFilter = THREE.LinearMipmapLinearFilter;
    albedo.generateMipmaps = true;
    albedo.needsUpdate = true;

    const groundGeo = new THREE.PlaneGeometry(70, 70, 1, 1);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      map: albedo,
      roughness: 0.96,
      metalness: 0,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.receiveShadow = true;
    this.group.add(ground);

    // --- roca de apoyo: da escala y ancla al personaje en el plano ---
    const rockGeo = new THREE.IcosahedronGeometry(0.9, 2);
    const pos = rockGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const d = 1 + noise.fbm(x * 1.6, y * 1.6, z * 1.6, 4) * 0.34;
      pos.setXYZ(i, x * d, y * d * 0.55, z * d);
    }
    rockGeo.computeVertexNormals();
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x2b2621, roughness: 0.95, metalness: 0 });
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.set(-1.9, -0.16, -1.3);
    rock.castShadow = true;
    rock.receiveShadow = true;
    this.group.add(rock);

    ctx.scene.add(this.group);
    this.disposables.push(groundGeo, groundMat, albedo, rockGeo, rockMat);
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }
}
