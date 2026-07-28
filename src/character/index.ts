/**
 * Subsistema `character` — dueño de El Buitre.
 *
 * Responsable de: la geometría del personaje, sus materiales, su esqueleto y su
 * runtime de animación. Nadie más toca esos huesos. Quien necesite saber dónde
 * está la cabeza pide `ctx.get('character').headWorld(out)`; quien necesite que
 * mire a algo llama a `lookAt()`. Esa es toda la superficie pública, y es
 * deliberadamente estrecha.
 */

import * as THREE from 'three';
import type { Ctx, System } from '../core/types';
import { Animator } from './animator';
import { buildCharacterGeometry, createInstance } from './build';
import type { ClipName } from './clips';
import { Noise } from './geo';
import { createMaterials, type CharacterMaterials } from './materials';
import * as P from './parts';
import type { Part } from './parts';
import { RIG } from './rig';

export interface CharacterStats {
  vertices: number;
  triangles: number;
  bones: number;
  materials: number;
  buildMs: number;
}

export class CharacterSystem implements System {
  static readonly id = 'character';
  static readonly deps = ['render'] as const;

  /** Nodo del actor. Muévelo tú; el personaje vive en su espacio local. */
  readonly root = new THREE.Group();

  animator!: Animator;
  stats!: CharacterStats;

  private mesh!: THREE.SkinnedMesh;
  private geometry!: THREE.BufferGeometry;
  private materials!: CharacterMaterials;
  private lookTarget: THREE.Vector3 | null = null;
  private headTmp = new THREE.Vector3();
  private headBone!: THREE.Bone;

  init(ctx: Ctx): void {
    const t0 = performance.now();
    const rng = ctx.rng.fork();
    const noise = new Noise(() => rng.float());
    const rand = () => rng.float();
    const q = ctx.config.q;

    const parts: Part[] = [
      P.torso(noise, q.limbSegments),
      P.keel(noise, q.limbSegments),
      P.neck(noise, q.limbSegments),
      P.ruff(rand, q.featherCount),
      ...P.head(noise, q.limbSegments),
      P.tail(rand, q.featherCount),
    ];
    for (const side of [1, -1] as const) {
      parts.push(P.wingArm(side, noise, q.limbSegments));
      parts.push(...P.wingFeathers(side, rand, q.featherCount));
      parts.push(...P.leg(side, noise, q.limbSegments));
    }

    const built = buildCharacterGeometry(RIG, parts);
    this.geometry = built.geometry;
    this.materials = createMaterials(ctx.config.seed, q.textureSize);

    const instance = createInstance(RIG, this.geometry, this.materials.list);
    this.mesh = instance.mesh;
    this.headBone = instance.bones[RIG.index('Head')];
    this.root.add(this.mesh);
    ctx.scene.add(this.root);

    this.animator = new Animator(RIG, instance.bones);

    this.stats = {
      ...built.stats,
      bones: RIG.count,
      materials: built.groups.length,
      buildMs: performance.now() - t0,
    };
    console.info(
      `[character] ${this.stats.triangles} tris, ${this.stats.vertices} verts, ` +
      `${this.stats.materials} grupos, ${this.stats.buildMs.toFixed(0)}ms`,
    );
  }

  /** Cambia la base de animación con crossfade. */
  setState(name: ClipName, blendSeconds = 0.25): void {
    this.animator.setBase(name, blendSeconds);
  }

  /** Velocidad de suelo en m/s. Manda la fase de stalk/lope. */
  setSpeed(mps: number): void {
    this.animator.state.speed = mps;
  }

  /** Apertura de alas aditiva 0..1, encima de cualquier base. */
  setSpread(w: number): void {
    this.animator.state.spread = Math.min(1, Math.max(0, w));
  }

  /** Punto de mundo al que apunta el pico. `null` libera la cabeza. */
  lookAt(target: THREE.Vector3 | null, weight = 1): void {
    this.lookTarget = target;
    this.animator.setLookTarget(target, weight);
  }

  ruffle(): void {
    this.animator.triggerRuffle();
  }

  hit(region: 'head' | 'torso' | 'wingR' | 'wingL' | 'legR' | 'legL', side = 0): void {
    this.animator.triggerHit(region, side);
  }

  /** Posición de mundo de la cabeza — para cámaras, audio o marcadores. */
  headWorld(out: THREE.Vector3): THREE.Vector3 {
    return out.setFromMatrixPosition(this.headBone.matrixWorld).applyMatrix4(this.mesh.matrixWorld);
  }

  update(dt: number, _ctx: Ctx): void {
    this.root.updateMatrixWorld(true);
    this.animator.update(dt, this.mesh);
    if (this.lookTarget) this.animator.setLookTarget(this.lookTarget);
    this.headWorld(this.headTmp);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.geometry.dispose();
    this.materials.dispose();
  }
}

export type { ClipName };
