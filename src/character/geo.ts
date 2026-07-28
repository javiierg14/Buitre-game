/**
 * Toolkit de geometría procedural.
 *
 * Todo el personaje se construye con cuatro primitivas: `tube` (extrusión con
 * marcos de transporte paralelo — miembros, cuello, dedos, cañón de pluma),
 * `ellipsoid` (masas: cráneo, buche, cadera), `revolve` (piezas de revolución:
 * casquete craneal, ojo, garra) y `blade` (superficies planas curvadas: plumas,
 * membranas, correas). Una sola convención de vértice, UV y normal para todas.
 *
 * CONVENCIÓN UV — u,v se almacenan en **metros de superficie** (u alrededor del
 * anillo, v a lo largo del recorrido). El material divide por su tamaño de tile
 * al escribir el atributo, así la misma densidad física de texel vale en una
 * garra, en un antebrazo y en una pluma sin ajuste por pieza.
 *
 * CONVENCIÓN DE ESPACIO — metros, pies en y = 0, el personaje mira a +Z. Como Y
 * es arriba y Z adelante en un sistema diestro, la **derecha del personaje** cae
 * en X negativa: todo hueso `*R` vive en x < 0.
 *
 * Nada de aquí corre por frame. Es todo trabajo de arranque.
 */

import * as THREE from 'three';

export interface MeshData {
  /** Posiciones, xyz plano. */
  p: number[];
  /** Normales, xyz plano. */
  n: number[];
  /** UV en metros de superficie, uv plano. */
  uv: number[];
  /** Índices de triángulo. */
  i: number[];
}

export function emptyMesh(): MeshData {
  return { p: [], n: [], uv: [], i: [] };
}

export function vcount(m: MeshData): number {
  return m.p.length / 3;
}

/** Copia `src` dentro de `dst`, reindexando. Devuelve el rango [inicio, fin). */
export function appendMesh(dst: MeshData, src: MeshData): [number, number] {
  const base = vcount(dst);
  for (let k = 0; k < src.p.length; k++) dst.p.push(src.p[k]);
  for (let k = 0; k < src.n.length; k++) dst.n.push(src.n[k]);
  for (let k = 0; k < src.uv.length; k++) dst.uv.push(src.uv[k]);
  for (let k = 0; k < src.i.length; k++) dst.i.push(src.i[k] + base);
  return [base, vcount(dst)];
}

const _v = new THREE.Vector3();
const _nm = new THREE.Matrix3();

export function transformMesh(m: MeshData, mat: THREE.Matrix4): MeshData {
  _nm.getNormalMatrix(mat);
  for (let k = 0; k < m.p.length; k += 3) {
    _v.set(m.p[k], m.p[k + 1], m.p[k + 2]).applyMatrix4(mat);
    m.p[k] = _v.x;
    m.p[k + 1] = _v.y;
    m.p[k + 2] = _v.z;
  }
  for (let k = 0; k < m.n.length; k += 3) {
    _v.set(m.n[k], m.n[k + 1], m.n[k + 2]).applyMatrix3(_nm).normalize();
    m.n[k] = _v.x;
    m.n[k + 1] = _v.y;
    m.n[k + 2] = _v.z;
  }
  // Un determinante negativo (espejado) invierte el sentido de los triángulos.
  if (mat.determinant() < 0) flipWinding(m);
  return m;
}

export function flipWinding(m: MeshData): MeshData {
  for (let t = 0; t < m.i.length; t += 3) {
    const tmp = m.i[t + 1];
    m.i[t + 1] = m.i[t + 2];
    m.i[t + 2] = tmp;
  }
  return m;
}

/** Coloca una pieza: traslación, euler YXZ y escala, en un paso. */
export function place(
  mesh: MeshData,
  x: number, y: number, z: number,
  rx = 0, ry = 0, rz = 0,
  sx = 1, sy = 1, sz = 1,
): MeshData {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
    new THREE.Vector3(sx, sy, sz),
  );
  return transformMesh(mesh, m);
}

/** Espeja en X (derecha <-> izquierda) y corrige el sentido de los triángulos. */
export function mirrorX(mesh: MeshData): MeshData {
  const out: MeshData = { p: mesh.p.slice(), n: mesh.n.slice(), uv: mesh.uv.slice(), i: mesh.i.slice() };
  for (let k = 0; k < out.p.length; k += 3) out.p[k] = -out.p[k];
  for (let k = 0; k < out.n.length; k += 3) out.n[k] = -out.n[k];
  return flipWinding(out);
}

/** Recalcula normales suaves por área de triángulo. */
export function computeNormals(m: MeshData): MeshData {
  const n = m.n;
  n.length = m.p.length;
  n.fill(0);
  const ax = new THREE.Vector3(), bx = new THREE.Vector3(), cx = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();
  for (let t = 0; t < m.i.length; t += 3) {
    const a = m.i[t] * 3, b = m.i[t + 1] * 3, c = m.i[t + 2] * 3;
    ax.set(m.p[a], m.p[a + 1], m.p[a + 2]);
    bx.set(m.p[b], m.p[b + 1], m.p[b + 2]);
    cx.set(m.p[c], m.p[c + 1], m.p[c + 2]);
    e1.subVectors(bx, ax);
    e2.subVectors(cx, ax);
    fn.crossVectors(e1, e2); // sin normalizar: pondera por área
    n[a] += fn.x; n[a + 1] += fn.y; n[a + 2] += fn.z;
    n[b] += fn.x; n[b + 1] += fn.y; n[b + 2] += fn.z;
    n[c] += fn.x; n[c + 1] += fn.y; n[c + 2] += fn.z;
  }
  for (let k = 0; k < n.length; k += 3) {
    const l = Math.hypot(n[k], n[k + 1], n[k + 2]) || 1;
    n[k] /= l; n[k + 1] /= l; n[k + 2] /= l;
  }
  return m;
}

/** Empuja cada vértice a lo largo de su normal. Recalcula normales al final. */
export function displace(m: MeshData, fn: (x: number, y: number, z: number) => number): MeshData {
  for (let k = 0; k < m.p.length; k += 3) {
    const d = fn(m.p[k], m.p[k + 1], m.p[k + 2]);
    m.p[k] += m.n[k] * d;
    m.p[k + 1] += m.n[k + 1] * d;
    m.p[k + 2] += m.n[k + 2] * d;
  }
  return computeNormals(m);
}

/** Deforma libremente el espacio. Recalcula normales al final. */
export function warp(m: MeshData, fn: (v: THREE.Vector3) => void): MeshData {
  for (let k = 0; k < m.p.length; k += 3) {
    _v.set(m.p[k], m.p[k + 1], m.p[k + 2]);
    fn(_v);
    m.p[k] = _v.x; m.p[k + 1] = _v.y; m.p[k + 2] = _v.z;
  }
  return computeNormals(m);
}

/* ------------------------------------------------------------------ */
/* Ruido gradiente determinista                                        */
/* ------------------------------------------------------------------ */

const G3: readonly (readonly [number, number, number])[] = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

/** Perlin 3D sembrado. Único generador de ruido del proyecto: mismo grano en
 *  geometría y en texturas, que es lo que hace que la piel lea como una piel. */
export class Noise {
  private perm = new Uint8Array(512);

  constructor(rand: () => number) {
    const p = new Uint8Array(256);
    for (let k = 0; k < 256; k++) p[k] = k;
    for (let k = 255; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      const t = p[k]; p[k] = p[j]; p[j] = t;
    }
    for (let k = 0; k < 512; k++) this.perm[k] = p[k & 255];
  }

  /** Perlin 3D, aproximadamente [-1,1]. */
  n3(x: number, y: number, z: number): number {
    const p = this.perm;
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    const X = fx & 255, Y = fy & 255, Z = fz & 255;
    x -= fx; y -= fy; z -= fz;
    const u = x * x * x * (x * (x * 6 - 15) + 10);
    const v = y * y * y * (y * (y * 6 - 15) + 10);
    const w = z * z * z * (z * (z * 6 - 15) + 10);
    const A = p[X] + Y, B = p[X + 1] + Y;
    const AA = p[A] + Z, AB = p[A + 1] + Z;
    const BA = p[B] + Z, BB = p[B + 1] + Z;
    const g = (h: number, dx: number, dy: number, dz: number): number => {
      const q = G3[h % 12];
      return q[0] * dx + q[1] * dy + q[2] * dz;
    };
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    return lerp(
      lerp(
        lerp(g(p[AA], x, y, z), g(p[BA], x - 1, y, z), u),
        lerp(g(p[AB], x, y - 1, z), g(p[BB], x - 1, y - 1, z), u), v),
      lerp(
        lerp(g(p[AA + 1], x, y, z - 1), g(p[BA + 1], x - 1, y, z - 1), u),
        lerp(g(p[AB + 1], x, y - 1, z - 1), g(p[BB + 1], x - 1, y - 1, z - 1), u), v),
      w);
  }

  /** Ruido fractal de `oct` octavas. */
  fbm(x: number, y: number, z: number, oct = 4, gain = 0.5, lac = 2): number {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let o = 0; o < oct; o++) {
      sum += this.n3(x * f, y * f, z * f) * amp;
      norm += amp;
      amp *= gain;
      f *= lac;
    }
    return sum / norm;
  }
}

/* ------------------------------------------------------------------ */
/* Primitivas                                                          */
/* ------------------------------------------------------------------ */

export interface TubeOptions {
  /** Segmentos alrededor del anillo. */
  radial?: number;
  /** Tapa el primer anillo con un abanico. */
  capStart?: boolean;
  /** Tapa el último anillo. */
  capEnd?: boolean;
  /** Pista de orientación para el primer marco. */
  up?: THREE.Vector3;
}

/**
 * Extrusión de un anillo a lo largo de una polilínea, con marcos de transporte
 * paralelo: el anillo no gira sobre sí mismo aunque el recorrido se curve, que
 * es lo que evita que las UV se retuerzan en un codo.
 *
 * `radius(t, a)` recibe el parámetro del recorrido (0..1) y el ángulo del anillo
 * (0..2π) y devuelve el radio en metros — así una misma llamada hace un miembro
 * cónico, una sección ovalada o una cresta.
 */
export function tube(
  path: readonly THREE.Vector3[],
  radius: (t: number, angle: number) => number,
  opts: TubeOptions = {},
): MeshData {
  const radial = opts.radial ?? 12;
  const n = path.length;
  if (n < 2) throw new Error('[geo] tube necesita al menos 2 puntos de recorrido');

  // --- tangentes ---
  const tan: THREE.Vector3[] = [];
  for (let k = 0; k < n; k++) {
    const a = path[Math.max(0, k - 1)];
    const b = path[Math.min(n - 1, k + 1)];
    tan.push(new THREE.Vector3().subVectors(b, a).normalize());
  }

  // --- marcos por transporte paralelo ---
  const nrm: THREE.Vector3[] = [];
  const bin: THREE.Vector3[] = [];
  let up = (opts.up ?? new THREE.Vector3(0, 1, 0)).clone();
  if (Math.abs(up.dot(tan[0])) > 0.95) up.set(0, 0, 1);
  let normal = new THREE.Vector3().crossVectors(tan[0], up).normalize();
  for (let k = 0; k < n; k++) {
    if (k > 0) {
      // rota el marco anterior por el giro mínimo que lleva tan[k-1] a tan[k]
      const q = new THREE.Quaternion().setFromUnitVectors(tan[k - 1], tan[k]);
      normal = normal.clone().applyQuaternion(q).normalize();
    }
    const b = new THREE.Vector3().crossVectors(tan[k], normal).normalize();
    normal = new THREE.Vector3().crossVectors(b, tan[k]).normalize();
    nrm.push(normal.clone());
    bin.push(b);
  }

  // --- longitud acumulada, para UV en metros ---
  const vlen: number[] = [0];
  for (let k = 1; k < n; k++) vlen.push(vlen[k - 1] + path[k].distanceTo(path[k - 1]));

  const m = emptyMesh();
  const pt = new THREE.Vector3();
  for (let k = 0; k < n; k++) {
    const t = n > 1 ? k / (n - 1) : 0;
    let circ = 0;
    const prev = new THREE.Vector3();
    for (let s = 0; s <= radial; s++) {
      const a = (s / radial) * Math.PI * 2;
      const r = radius(t, a);
      pt.copy(path[k])
        .addScaledVector(nrm[k], Math.cos(a) * r)
        .addScaledVector(bin[k], Math.sin(a) * r);
      if (s > 0) circ += pt.distanceTo(prev);
      prev.copy(pt);
      m.p.push(pt.x, pt.y, pt.z);
      m.n.push(0, 0, 0); // computeNormals al final
      m.uv.push(circ, vlen[k]);
    }
  }

  const stride = radial + 1;
  for (let k = 0; k < n - 1; k++) {
    for (let s = 0; s < radial; s++) {
      const a = k * stride + s;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      m.i.push(a, c, b, b, c, d);
    }
  }

  if (opts.capStart) capRing(m, path[0], 0, stride, radial, true);
  if (opts.capEnd) capRing(m, path[n - 1], (n - 1) * stride, stride, radial, false);

  return computeNormals(m);
}

/** Abanico de triángulos que cierra un anillo ya emitido. */
function capRing(
  m: MeshData, centre: THREE.Vector3, ringStart: number,
  _stride: number, radial: number, reverse: boolean,
): void {
  const ci = vcount(m);
  m.p.push(centre.x, centre.y, centre.z);
  m.n.push(0, 0, 0);
  m.uv.push(0, 0);
  for (let s = 0; s < radial; s++) {
    const a = ringStart + s;
    const b = ringStart + s + 1;
    if (reverse) m.i.push(ci, b, a);
    else m.i.push(ci, a, b);
  }
}

/** Elipsoide UV centrado en el origen. */
export function ellipsoid(rx: number, ry: number, rz: number, segU = 16, segV = 12): MeshData {
  const m = emptyMesh();
  for (let v = 0; v <= segV; v++) {
    const phi = (v / segV) * Math.PI;
    const sy = Math.cos(phi);
    const sr = Math.sin(phi);
    for (let u = 0; u <= segU; u++) {
      const th = (u / segU) * Math.PI * 2;
      const x = Math.cos(th) * sr * rx;
      const y = sy * ry;
      const z = Math.sin(th) * sr * rz;
      m.p.push(x, y, z);
      m.n.push(0, 0, 0);
      // UV aproximadas en metros usando el radio medio
      const rm = (rx + rz) * 0.5;
      m.uv.push(th * rm * sr, phi * ry);
    }
  }
  const stride = segU + 1;
  for (let v = 0; v < segV; v++) {
    for (let u = 0; u < segU; u++) {
      const a = v * stride + u;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      m.i.push(a, b, c, b, d, c);
    }
  }
  return computeNormals(m);
}

/** Sólido de revolución alrededor de Y desde un perfil [radio, y]. */
export function revolve(profile: readonly (readonly [number, number])[], segments = 16): MeshData {
  const m = emptyMesh();
  const n = profile.length;
  let vlen = 0;
  for (let k = 0; k < n; k++) {
    if (k > 0) {
      vlen += Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]);
    }
    const [r, y] = profile[k];
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      m.p.push(Math.cos(a) * r, y, Math.sin(a) * r);
      m.n.push(0, 0, 0);
      m.uv.push(a * r, vlen);
    }
  }
  const stride = segments + 1;
  for (let k = 0; k < n - 1; k++) {
    for (let s = 0; s < segments; s++) {
      const a = k * stride + s;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      m.i.push(a, c, b, b, c, d);
    }
  }
  return computeNormals(m);
}

/**
 * Superficie plana curvada de dos caras: una pluma, una membrana, una correa.
 * El recorrido define el raquis; `halfWidth(t)` la mitad del ancho a lo largo,
 * y `lift(t)` levanta el borde para darle comba. Se emite con grosor cero y se
 * dibuja con `side: DoubleSide`.
 */
export function blade(
  path: readonly THREE.Vector3[],
  halfWidth: (t: number) => number,
  opts: { across?: number; lift?: (t: number, s: number) => number; up?: THREE.Vector3 } = {},
): MeshData {
  const across = opts.across ?? 3;
  const n = path.length;
  const m = emptyMesh();
  const up = (opts.up ?? new THREE.Vector3(0, 1, 0)).clone().normalize();
  const tan = new THREE.Vector3();
  const side = new THREE.Vector3();
  const pt = new THREE.Vector3();
  let vlen = 0;

  for (let k = 0; k < n; k++) {
    if (k > 0) vlen += path[k].distanceTo(path[k - 1]);
    const t = n > 1 ? k / (n - 1) : 0;
    const a = path[Math.max(0, k - 1)];
    const b = path[Math.min(n - 1, k + 1)];
    tan.subVectors(b, a).normalize();
    side.crossVectors(tan, up).normalize();
    const hw = halfWidth(t);
    for (let s = 0; s <= across; s++) {
      const q = (s / across) * 2 - 1; // -1..1 a lo ancho
      pt.copy(path[k]).addScaledVector(side, q * hw);
      if (opts.lift) pt.addScaledVector(up, opts.lift(t, q));
      m.p.push(pt.x, pt.y, pt.z);
      m.n.push(0, 0, 0);
      m.uv.push(q * hw, vlen);
    }
  }

  const stride = across + 1;
  for (let k = 0; k < n - 1; k++) {
    for (let s = 0; s < across; s++) {
      const a = k * stride + s;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      m.i.push(a, c, b, b, c, d);
    }
  }
  return computeNormals(m);
}

/** Muestrea una curva Catmull-Rom en `n` puntos: recorridos legibles con pocos anclajes. */
export function samplePath(points: readonly (readonly [number, number, number])[], n: number): THREE.Vector3[] {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const out: THREE.Vector3[] = [];
  for (let k = 0; k < n; k++) out.push(curve.getPoint(n > 1 ? k / (n - 1) : 0));
  return out;
}
