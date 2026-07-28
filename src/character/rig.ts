/**
 * El esqueleto del Buitre.
 *
 * 29 huesos, autorizados en metros en el espacio de bind del actor: pies en
 * y = 0, el personaje mirando a +Z. Como Y es arriba y Z adelante en un sistema
 * diestro, la **derecha del personaje** cae en X negativa — todo hueso `*R` vive
 * en x < 0. Equivocarse aquí pone la garra buena en el lado malo.
 *
 * CONVENCIÓN DE EJES DE HUESO — el local **+Y corre a lo largo del hueso** hacia
 * su hijo y el local +Z apunta aproximadamente adelante. Un futuro subsistema de
 * física puede adoptar el esqueleto para un ragdoll sin que salte.
 *
 * LA POSE DE BIND NO ES UNA T-POSE. Es la silueta de reposo real del personaje:
 * columna encorvada, cuello en S, alas plegadas contra el cuerpo, patas
 * digitígradas cargadas. La geometría se modela donde los miembros están de
 * verdad, así los pesos de skin nunca tienen que sobrevivir a una rotación de
 * hombro de 90 grados — que es de donde salen la mayoría de los pinzamientos.
 */

import * as THREE from 'three';

/** Altura de referencia a la que están autorizadas las proporciones. */
export const REF_HEIGHT = 1.78;

export type BoneSpec = readonly [
  name: string,
  parent: string | null,
  pos: readonly [number, number, number] | null,
  up?: readonly [number, number, number] | null,
  leafDir?: readonly [number, number, number],
];

export const BONES: readonly BoneSpec[] = [
  // --- eje: cadera -> torso encorvado ---
  ['Hips', null, [0, 0.98, -0.04]],
  ['Spine', 'Hips', [0, 1.10, 0.0]],
  ['Spine1', 'Spine', [0, 1.21, 0.05]],
  ['Spine2', 'Spine1', [0, 1.31, 0.11]],

  // --- cuello en S y cabeza ---
  // El cuello del buitre sube y va hacia atrás antes de proyectar la cabeza
  // adelante. Esa curva es la mitad de la lectura de la silueta.
  ['Neck', 'Spine2', [0, 1.41, 0.10]],
  ['Neck1', 'Neck', [0, 1.52, 0.05]],
  ['Neck2', 'Neck1', [0, 1.62, 0.09]],
  ['Head', 'Neck2', [0, 1.70, 0.17]],
  ['Beak', 'Head', null, [0, 1, 0], [0, -0.28, 0.96]],

  // --- ala derecha (x < 0), PLEGADA ---
  // La Z del ala plegada: húmero atrás-abajo, antebrazo adelante-abajo, y la
  // muñeca de vuelta pegada al costado. Autorizar el ala abierta y cerrarla con
  // animación es lo que produce el clásico pinzamiento del codo — aquí la pose
  // de reposo ES la de bind, y abrirla es lo que cuesta pesos de skin.
  ['ClavicleR', 'Spine2', [-0.055, 1.35, 0.07]],
  ['UpperArmR', 'ClavicleR', [-0.150, 1.33, 0.05]],
  ['ForearmR', 'UpperArmR', [-0.198, 1.19, -0.135]],
  ['HandR', 'ForearmR', [-0.190, 1.055, 0.055]],
  ['ClawR', 'HandR', null, null, [-0.12, -0.42, -0.90]],

  // --- ala izquierda ---
  ['ClavicleL', 'Spine2', [0.055, 1.35, 0.07]],
  ['UpperArmL', 'ClavicleL', [0.150, 1.33, 0.05]],
  ['ForearmL', 'UpperArmL', [0.198, 1.19, -0.135]],
  ['HandL', 'ForearmL', [0.190, 1.055, 0.055]],
  ['ClawL', 'HandL', null, null, [0.12, -0.42, -0.90]],

  // --- pata derecha, digitígrada: fémur adelante, corvejón atrás, dedos planos ---
  ['UpLegR', 'Hips', [-0.105, 0.94, 0.0]],
  ['LegR', 'UpLegR', [-0.112, 0.60, 0.07]],
  ['AnkleR', 'LegR', [-0.112, 0.30, -0.06], [0, 0, 1]],
  ['FootR', 'AnkleR', [-0.112, 0.075, 0.03], [0, 1, 0]],
  ['ToeR', 'FootR', [-0.112, 0.022, 0.17], [0, 1, 0]],

  // --- pata izquierda ---
  ['UpLegL', 'Hips', [0.105, 0.94, 0.0]],
  ['LegL', 'UpLegL', [0.112, 0.60, 0.07]],
  ['AnkleL', 'LegL', [0.112, 0.30, -0.06], [0, 0, 1]],
  ['FootL', 'AnkleL', [0.112, 0.075, 0.03], [0, 1, 0]],
  ['ToeL', 'FootL', [0.112, 0.022, 0.17], [0, 1, 0]],

  // --- cola: contrapeso visual de la cabeza proyectada ---
  ['Tail', 'Hips', [0, 0.99, -0.18]],
  ['Tail1', 'Tail', [0, 0.93, -0.38]],
];

/** Longitud del muñón que se le da a un hueso hoja para que tenga orientación. */
const LEAF_STUB = 0.07;

/** Huesos que cuelgan de una bifurcación pero NO continúan la cadena principal. */
const BRANCH = /^(Clavicle|UpLeg|Tail)/;

export class Rig {
  readonly names: string[] = [];
  readonly parent: number[] = [];
  readonly children: number[][] = [];
  /** Posición de bind en espacio del actor. */
  readonly bindPos: THREE.Vector3[] = [];
  readonly bindQuat: THREE.Quaternion[] = [];
  /** Transformada local respecto del padre. */
  readonly localPos: THREE.Vector3[] = [];
  readonly localQuat: THREE.Quaternion[] = [];
  /** Extremo del hueso (su hijo primario, o el muñón si es hoja). */
  readonly tail: THREE.Vector3[] = [];
  readonly length: number[] = [];
  readonly count: number;
  readonly eyeHeight: number;

  private map = new Map<string, number>();

  constructor(spec: readonly BoneSpec[] = BONES) {
    for (let i = 0; i < spec.length; i++) {
      this.names.push(spec[i][0]);
      this.map.set(spec[i][0], i);
      this.parent.push(-1);
      this.children.push([]);
    }
    for (let i = 0; i < spec.length; i++) {
      const parentName = spec[i][1];
      const pi = parentName === null ? -1 : this.map.get(parentName);
      if (pi === undefined) throw new Error(`[rig] "${spec[i][0]}" cuelga del hueso desconocido "${parentName}"`);
      this.parent[i] = pi;
      if (pi >= 0) this.children[pi].push(i);
    }

    // --- posiciones ---
    for (let i = 0; i < spec.length; i++) {
      let p = spec[i][2];
      if (!p) {
        const pi = this.parent[i];
        const base = this.bindPos[pi];
        const dir = spec[i][4];
        if (!dir) throw new Error(`[rig] la hoja "${spec[i][0]}" necesita pos o leafDir`);
        const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
        p = [base.x + d.x * LEAF_STUB, base.y + d.y * LEAF_STUB, base.z + d.z * LEAF_STUB];
      }
      this.bindPos.push(new THREE.Vector3(p[0], p[1], p[2]));
    }

    // --- rotaciones de mundo: +Y a lo largo del hueso ---
    const m = new THREE.Matrix4();
    const yAxis = new THREE.Vector3();
    const xAxis = new THREE.Vector3();
    const zAxis = new THREE.Vector3();
    const up = new THREE.Vector3();
    for (let i = 0; i < spec.length; i++) {
      const kids = this.children[i];
      const tail = new THREE.Vector3();
      if (kids.length) {
        const primary = kids.find((k) => !BRANCH.test(this.names[k]));
        tail.copy(this.bindPos[primary ?? kids[0]]);
      } else {
        const dir = spec[i][4];
        const d = dir
          ? new THREE.Vector3(dir[0], dir[1], dir[2]).normalize()
          : new THREE.Vector3().subVectors(this.bindPos[i], this.bindPos[this.parent[i]]).normalize();
        tail.copy(this.bindPos[i]).addScaledVector(d, LEAF_STUB);
      }
      this.tail.push(tail);

      yAxis.copy(tail).sub(this.bindPos[i]);
      this.length.push(yAxis.length());
      if (yAxis.lengthSq() < 1e-10) yAxis.set(0, 1, 0);
      yAxis.normalize();
      const hint = spec[i][3] ?? [0, 0, 1];
      up.set(hint[0], hint[1], hint[2]);
      if (Math.abs(up.dot(yAxis)) > 0.985) up.set(1, 0, 0);
      xAxis.copy(yAxis).cross(up).normalize();
      zAxis.copy(xAxis).cross(yAxis).normalize();
      m.makeBasis(xAxis, yAxis, zAxis);
      this.bindQuat.push(new THREE.Quaternion().setFromRotationMatrix(m));
    }

    // --- transformadas locales ---
    const inv = new THREE.Quaternion();
    const v = new THREE.Vector3();
    for (let i = 0; i < spec.length; i++) {
      const pi = this.parent[i];
      if (pi < 0) {
        this.localPos.push(this.bindPos[i].clone());
        this.localQuat.push(this.bindQuat[i].clone());
      } else {
        inv.copy(this.bindQuat[pi]).invert();
        v.copy(this.bindPos[i]).sub(this.bindPos[pi]).applyQuaternion(inv);
        this.localPos.push(v.clone());
        this.localQuat.push(inv.clone().multiply(this.bindQuat[i]));
      }
    }

    this.count = spec.length;
    this.eyeHeight = this.bindPos[this.map.get('Head')!].y + 0.02;
  }

  index(name: string): number {
    const i = this.map.get(name);
    if (i === undefined) throw new Error(`[rig] hueso desconocido "${name}"`);
    return i;
  }

  has(name: string): boolean {
    return this.map.has(name);
  }

  /** Distancia de un punto al segmento del hueso en pose de bind. */
  distanceToBone(i: number, x: number, y: number, z: number): number {
    const a = this.bindPos[i];
    const b = this.tail[i];
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const l2 = dx * dx + dy * dy + dz * dz;
    let t = l2 > 1e-12 ? ((x - a.x) * dx + (y - a.y) * dy + (z - a.z) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t), z - (a.z + dz * t));
  }

  /** Jerarquía THREE.Bone + Skeleton nuevos para una instancia de actor. */
  createSkeleton(): { bones: THREE.Bone[]; skeleton: THREE.Skeleton; root: THREE.Bone } {
    const bones: THREE.Bone[] = [];
    for (let i = 0; i < this.count; i++) {
      const b = new THREE.Bone();
      b.name = this.names[i];
      b.position.copy(this.localPos[i]);
      b.quaternion.copy(this.localQuat[i]);
      b.matrixAutoUpdate = false;
      b.updateMatrix();
      bones.push(b);
    }
    for (let i = 0; i < this.count; i++) {
      const pi = this.parent[i];
      if (pi >= 0) bones[pi].add(bones[i]);
    }
    bones[0].updateMatrixWorld(true);
    return { bones, skeleton: new THREE.Skeleton(bones), root: bones[0] };
  }
}

/** Un único rig compartido — la pose de bind es idéntica en cada Buitre. */
export const RIG = new Rig();
