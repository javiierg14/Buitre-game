/**
 * Runtime de animación: un árbol de mezcla por capas pequeño, más IK de mirada.
 *
 * CAPAS, en orden de evaluación
 *   1  base        perch / stalk / lope / threat / alert / feed, con crossfade;
 *                  la fase de locomoción la manda la velocidad real de suelo,
 *                  así los pies no patinan
 *   2  aditivas    apertura de alas, sacudida de plumas, reacción a impacto
 *   3  IK          la cadena de cuello gira hasta que el pico apunta al objetivo,
 *                  repartida y clampeada por hueso — el personaje tiene que
 *                  girar el cuerpo para cubrir un arco ancho, igual que el animal
 *
 * Todo está preasignado: `update()` no reserva memoria. Un `new THREE.Vector3()`
 * dentro de este archivo es un bug, no un detalle de estilo.
 */

import * as THREE from 'three';
import * as C from './clips';
import type { ClipName } from './clips';
import type { Rig } from './rig';

const DEG = Math.PI / 180;

/** Acumulador de pose que reciben las funciones de clip. */
export class Poser {
  readonly d3: Float32Array;
  readonly hipOff = new THREE.Vector3();
  /** Peso con el que se acumula lo que se escriba a continuación. */
  w = 1;

  private idx = new Map<string, number>();

  constructor(rig: Rig) {
    this.d3 = new Float32Array(rig.count * 3);
    for (let i = 0; i < rig.count; i++) this.idx.set(rig.names[i], i);
  }

  reset(): void {
    this.d3.fill(0);
    this.hipOff.set(0, 0, 0);
    this.w = 1;
  }

  /** Delta euler aditivo, en grados. */
  d(name: string, x: number, y: number, z: number): void {
    const i = this.idx.get(name);
    if (i === undefined) return;
    const w = this.w;
    this.d3[i * 3] += x * w;
    this.d3[i * 3 + 1] += y * w;
    this.d3[i * 3 + 2] += z * w;
  }

  /** Desplazamiento de la cadera, en metros, espacio del actor. */
  hip(dx: number, dy: number, dz: number): void {
    const w = this.w;
    this.hipOff.x += dx * w;
    this.hipOff.y += dy * w;
    this.hipOff.z += dz * w;
  }
}

/** Longitud de zancada en metros: convierte velocidad de suelo en fase. */
const STRIDE = { stalk: 0.62, lope: 1.15 } as const;

/** Ritmo de las bases estáticas, en ciclos por segundo. */
const IDLE_RATE: Record<ClipName, number> = {
  perch: 0.16,
  alert: 0.22,
  feed: 0.30,
  threat: 0.55,
  stalk: 0,
  lope: 0,
};

/** Cadena de mirada y giro máximo por hueso, en grados. */
const LOOK_CHAIN: readonly (readonly [string, number])[] = [
  ['Neck', 14],
  ['Neck1', 18],
  ['Neck2', 22],
  ['Head', 30],
];

/**
 * Cono de mirada, en grados desde el frente del actor. Dentro de `LOOK_FULL` el
 * IK trabaja a peso completo; entre ahí y `LOOK_MAX` se desvanece; más allá se
 * apaga y el personaje tiene que girar el cuerpo.
 *
 * Sin este límite la suma de los topes por hueso (84°) por el número de pasadas
 * permitía enroscar el cuello 168° y el personaje se miraba la espalda. Los
 * topes por hueso controlan el REPARTO; el cono controla el ALCANCE. Hacen
 * falta los dos.
 */
const LOOK_FULL = 75 * (Math.PI / 180);
const LOOK_MAX = 115 * (Math.PI / 180);

export interface AnimatorState {
  base: ClipName;
  /** Velocidad de suelo en m/s; manda la fase de stalk/lope. */
  speed: number;
  /** Apertura de alas aditiva 0..1. */
  spread: number;
}

export class Animator {
  readonly state: AnimatorState = { base: 'perch', speed: 0, spread: 0 };

  private poseA: Poser;
  private poseB: Poser;
  private out: Poser;

  private from: ClipName = 'perch';
  private to: ClipName = 'perch';
  private blend = 1;
  private blendRate = 1 / 0.25;

  private phase = 0;
  private lookWeight = 0;
  private lookTarget = new THREE.Vector3();
  private hasLook = false;

  private ruffleT = Infinity;
  private hitT = Infinity;
  private hitRegion: 'head' | 'torso' | 'wingR' | 'wingL' | 'legR' | 'legL' = 'torso';
  private hitSide = 0;

  // --- temporales preasignados ---
  private q = new THREE.Quaternion();
  private qTmp = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'ZXY');
  private vA = new THREE.Vector3();
  private vB = new THREE.Vector3();
  private vC = new THREE.Vector3();
  private axis = new THREE.Vector3();
  private mInv = new THREE.Matrix4();

  private tipIdx: number;
  private toeIdx: readonly number[];
  /** Altura de bind del dedo: el suelo del banco de pruebas está en y = 0. */
  private groundY: number;
  /** Anclaje de pelvis al plano. Desactívalo si el personaje vuela. */
  groundLock = true;

  constructor(
    private readonly rig: Rig,
    private readonly bones: THREE.Bone[],
  ) {
    this.poseA = new Poser(rig);
    this.poseB = new Poser(rig);
    this.out = new Poser(rig);
    this.tipIdx = rig.index('Beak');
    this.toeIdx = [rig.index('ToeR'), rig.index('ToeL')];
    this.groundY = rig.bindPos[this.toeIdx[0]].y;
  }

  /** Cambia la base con crossfade. Repetir la misma base no reinicia nada. */
  setBase(name: ClipName, blendSeconds = 0.25): void {
    if (name === this.to) return;
    this.from = this.to;
    this.to = name;
    this.state.base = name;
    this.blend = 0;
    this.blendRate = 1 / Math.max(0.016, blendSeconds);
  }

  /** Objetivo de mirada en espacio de mundo. `null` deja la cabeza libre. */
  setLookTarget(target: THREE.Vector3 | null, weight = 1): void {
    if (target) {
      this.lookTarget.copy(target);
      this.hasLook = true;
      this.lookWeight = weight;
    } else {
      this.hasLook = false;
    }
  }

  triggerRuffle(): void {
    this.ruffleT = 0;
  }

  triggerHit(region: typeof this.hitRegion, side = 0): void {
    this.hitRegion = region;
    this.hitSide = side;
    this.hitT = 0;
  }

  /**
   * `root` es la transformada de mundo del actor; hace falta para llevar el
   * objetivo de mirada al espacio del actor antes de resolver el IK.
   */
  update(dt: number, root: THREE.Object3D): void {
    this.advancePhase(dt);
    this.blend = Math.min(1, this.blend + dt * this.blendRate);
    this.ruffleT += dt;
    this.hitT += dt;

    // --- capa 1: base con crossfade ---
    this.poseA.reset();
    this.poseB.reset();
    C.CLIPS[this.from](this.poseA, this.phase);
    C.CLIPS[this.to](this.poseB, this.phase);

    const out = this.out;
    out.reset();
    const t = smoothstep(this.blend);
    const a = this.poseA.d3;
    const b = this.poseB.d3;
    const o = out.d3;
    for (let i = 0; i < o.length; i++) o[i] = a[i] + (b[i] - a[i]) * t;
    out.hipOff.copy(this.poseA.hipOff).lerp(this.poseB.hipOff, t);

    // --- capa 2: aditivas ---
    if (this.state.spread > 0) C.wingSpreadAdd(out, this.state.spread);
    if (this.ruffleT < 0.9) C.ruffleAdd(out, this.ruffleT);
    if (this.hitT < 0.55) C.hitAdd(out, this.hitRegion, this.hitT, this.hitSide);

    this.writeBones(out);

    // --- capa 3: IK ---
    if (this.groundLock) this.solveGround();
    if (this.hasLook && this.lookWeight > 0) this.solveLook(root);
  }

  /**
   * Anclaje de pelvis: la mitad barata del IK de apoyo.
   *
   * Mide el dedo más bajo y sube la cadera lo justo para que deje de atravesar
   * el plano. **Sólo sube, nunca baja** — si bajara también, mataría el rebote
   * de `lope`, donde el personaje sí despega.
   *
   * Esto no orienta la planta ni resuelve dos huesos por pata: una pose que
   * pida más recorrido del que la pierna tiene seguirá estirándose. Lo que
   * elimina es la clase de fallo más visible y más tonta — poses de agachado
   * autorizadas a ojo que hunden las garras bajo el suelo — y libera a las
   * clips de tener que negociar con el plano.
   */
  private solveGround(): void {
    let lowest = Infinity;
    for (const i of this.toeIdx) {
      const y = this.bones[i].matrixWorld.elements[13];
      if (y < lowest) lowest = y;
    }
    const lift = this.groundY - lowest;
    if (lift <= 1e-4) return;
    const hips = this.bones[0];
    hips.position.y += lift;
    hips.updateMatrix();
    hips.updateMatrixWorld(true);
  }

  /**
   * Fase de locomoción a partir de la velocidad de suelo: un ciclo por zancada.
   * Las bases estáticas avanzan con el reloj, a su propio ritmo, para que la
   * respiración de dos personajes no vaya sincronizada.
   */
  private advancePhase(dt: number): void {
    const base = this.to;
    if (base === 'stalk' || base === 'lope') {
      const stride = STRIDE[base];
      this.phase += (Math.max(0.15, this.state.speed) / stride) * dt;
    } else {
      this.phase += IDLE_RATE[base] * dt;
    }
    this.phase %= 1;
  }

  /** Vuelca los deltas al esqueleto y actualiza las matrices de mundo. */
  private writeBones(pose: Poser): void {
    const rig = this.rig;
    const d = pose.d3;
    for (let i = 0; i < rig.count; i++) {
      const bone = this.bones[i];
      this.e.set(d[i * 3] * DEG, d[i * 3 + 1] * DEG, d[i * 3 + 2] * DEG, 'ZXY');
      this.q.setFromEuler(this.e);
      bone.quaternion.copy(rig.localQuat[i]).multiply(this.q);
      if (i === 0) bone.position.copy(rig.localPos[i]).add(pose.hipOff);
      bone.updateMatrix();
    }
    this.bones[0].updateMatrixWorld(true);
  }

  /**
   * IK de mirada por CCD sobre la cadena de cuello.
   *
   * El clamp por hueso es la pieza importante. Sin él el cuello se enrosca 180
   * grados y el personaje deja de tener columna vertebral; con él, cubrir un
   * arco ancho obliga a girar el cuerpo, que es exactamente el coste que el
   * gameplay quiere que el jugador pueda leer.
   */
  private solveLook(root: THREE.Object3D): void {
    this.mInv.copy(root.matrixWorld).invert();
    const tip = this.bones[this.tipIdx];

    // Cono: cuánto del objetivo está dentro del alcance del cuello. El frente
    // del actor es +Z en su propio espacio, por construcción del rig.
    this.vC.copy(this.lookTarget).applyMatrix4(this.mInv);
    this.vC.y -= this.rig.eyeHeight;
    if (this.vC.lengthSq() < 1e-8) return;
    this.vC.normalize();
    const off = Math.acos(Math.min(1, Math.max(-1, this.vC.z)));
    const cone = off <= LOOK_FULL ? 1 : Math.max(0, 1 - (off - LOOK_FULL) / (LOOK_MAX - LOOK_FULL));
    if (cone <= 0) return;

    const w = Math.min(1, Math.max(0, this.lookWeight)) * cone;

    for (let pass = 0; pass < 2; pass++) {
      for (const [name, maxDeg] of LOOK_CHAIN) {
        const bone = this.bones[this.rig.index(name)];

        // Todo en espacio del actor: matrixWorld del hueso es relativa al
        // SkinnedMesh, que es el actor. El objetivo viene de mundo y baja aquí.
        this.vA.setFromMatrixPosition(bone.matrixWorld);
        this.vB.setFromMatrixPosition(tip.matrixWorld).sub(this.vA);
        this.vC.copy(this.lookTarget).applyMatrix4(this.mInv).sub(this.vA);
        if (this.vB.lengthSq() < 1e-8 || this.vC.lengthSq() < 1e-8) continue;
        this.vB.normalize();
        this.vC.normalize();

        this.axis.crossVectors(this.vB, this.vC);
        if (this.axis.lengthSq() < 1e-10) continue;
        this.axis.normalize();

        // Reparte: cada hueso corrige una fracción, y nunca más de su tope.
        const full = Math.acos(Math.min(1, Math.max(-1, this.vB.dot(this.vC))));
        const angle = Math.min(full * 0.55 * w, maxDeg * DEG);

        // El eje está en espacio del actor; bajarlo al espacio del padre.
        const parent = bone.parent;
        if (parent) {
          this.qTmp.setFromRotationMatrix(parent.matrixWorld).invert();
          this.axis.applyQuaternion(this.qTmp).normalize();
        }
        this.q.setFromAxisAngle(this.axis, angle);
        bone.quaternion.multiply(this.q);
        bone.updateMatrix();
        bone.updateMatrixWorld(true);
      }
    }
    this.bones[0].updateMatrixWorld(true);
  }
}

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}
