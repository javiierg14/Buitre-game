/**
 * Piezas del Buitre.
 *
 * Cada función devuelve una o más `Part` en el espacio de bind del actor
 * (metros, pies en y = 0, mirando a +Z, derecha del personaje en -X). `build.ts`
 * decide qué piezas lleva una variante y las pasa al constructor de skin junto
 * con los huesos a los que puede pesar cada una.
 *
 * LECTURA DE SILUETA — el personaje tiene que ser reconocible en negro a 40 m.
 * Las tres cosas que lo consiguen aquí son: la joroba del manto por encima de la
 * línea de hombros, la gola de plumón que corta el cuello desnudo, y la
 * proyección de la cabeza por delante del pecho. Si tocas proporciones, mira
 * primero la silueta plana (`?state=silhouette`), no el modelo sombreado.
 */

import * as THREE from 'three';
import {
  type MeshData, blade, computeNormals, displace, ellipsoid, emptyMesh,
  mirrorX, place, revolve, samplePath, tube, Noise,
} from './geo';
import { RIG } from './rig';

/** Conjuntos de material. Cada uno es un grupo de geometría y una llamada de dibujo. */
export type MaterialName = 'feather' | 'down' | 'skin' | 'horn' | 'eye';

export interface Part {
  mesh: MeshData;
  material: MaterialName;
  /** Huesos candidatos para el peso de skin. Uno solo = rígido a ese hueso. */
  bind: string[];
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Radio de una elipse de semiejes rx (en cos) y rz (en sin) para el ángulo `a`. */
function ellipseR(rx: number, rz: number, a: number): number {
  const c = Math.cos(a) * rz;
  const s = Math.sin(a) * rx;
  return (rx * rz) / Math.hypot(c, s);
}

/** Interpolación suave de una tabla de claves [t, valor]. */
function curve(keys: readonly (readonly [number, number])[], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (t >= last[0]) return last[1];
  for (let k = 1; k < keys.length; k++) {
    if (t <= keys[k][0]) {
      const [t0, v0] = keys[k - 1];
      const [t1, v1] = keys[k];
      const u = (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * (u * u * (3 - 2 * u));
    }
  }
  return last[1];
}

/** Recorrido muestreado a lo largo de una cadena de huesos en pose de bind. */
function chain(names: readonly string[], samples: number, extendTail = 0): THREE.Vector3[] {
  const pts: [number, number, number][] = names.map((n) => {
    const p = RIG.bindPos[RIG.index(n)];
    return [p.x, p.y, p.z];
  });
  if (extendTail > 0) {
    const i = RIG.index(names[names.length - 1]);
    const d = new THREE.Vector3().subVectors(RIG.tail[i], RIG.bindPos[i]).normalize();
    const last = RIG.bindPos[i];
    pts.push([last.x + d.x * extendTail, last.y + d.y * extendTail, last.z + d.z * extendTail]);
  }
  return samplePath(pts, samples);
}

/* ================================================================== */
/* Torso                                                              */
/* ================================================================== */

/**
 * El cuerpo: un tubo de sección elíptica a lo largo de la columna, más ancho de
 * lo que es profundo en la cadera y al revés en el pecho. La joroba del manto se
 * añade después como un desplazamiento, no como una pieza aparte: cosida sale
 * una costura que ninguna normal salva.
 */
export function torso(noise: Noise, segments: number): Part {
  const path = chain(['Hips', 'Spine', 'Spine1', 'Spine2'], 14, 0.05);
  // Se muestrea la cadera un poco por debajo para que el cuerpo cubra la
  // articulación del fémur en vez de terminar justo en ella.
  path.unshift(V(0, 0.86, -0.055));

  const lateral: [number, number][] = [[0, 0.155], [0.18, 0.185], [0.5, 0.196], [0.78, 0.168], [1, 0.108]];
  const depth: [number, number][] = [[0, 0.145], [0.2, 0.185], [0.55, 0.212], [0.8, 0.170], [1, 0.100]];

  const mesh = tube(path, (t, a) => ellipseR(curve(lateral, t), curve(depth, t), a), {
    radial: segments,
    capStart: true,
    capEnd: true,
    up: V(0, 0, 1),
  });

  // Joroba del manto: masa dorsal por encima de la línea de hombros. Es lo que
  // separa la silueta de "hombre con capa" de la de "buitre posado".
  displace(mesh, (x, y, z) => {
    const dorsal = Math.max(0, -z - 0.02) * 4; // pesa la espalda
    const band = Math.exp(-((y - 1.235) ** 2) / 0.012);
    const hump = band * Math.min(1, dorsal) * 0.052;
    const plume = noise.fbm(x * 11, y * 11, z * 11, 3) * 0.008;
    const belly = Math.exp(-((y - 1.03) ** 2) / 0.02) * Math.max(0, z) * 0.03;
    return hump + plume + belly;
  });

  return { mesh, material: 'feather', bind: ['Hips', 'Spine', 'Spine1', 'Spine2', 'UpLegR', 'UpLegL'] };
}

/** Quilla/esternón: placa de plumas cortas y apretadas sobre el pecho. */
export function keel(noise: Noise, segments: number): Part {
  const path = samplePath([[0, 1.12, 0.155], [0, 1.24, 0.185], [0, 1.34, 0.150]], 8);
  const mesh = tube(path, (t, a) => ellipseR(curve([[0, 0.075], [0.5, 0.088], [1, 0.055]], t), 0.028, a), {
    radial: Math.max(8, segments >> 1),
    capStart: true,
    capEnd: true,
    up: V(0, 0, 1),
  });
  displace(mesh, (x, y, z) => noise.fbm(x * 24, y * 24, z * 24, 2) * 0.004);
  return { mesh, material: 'feather', bind: ['Spine', 'Spine1', 'Spine2'] };
}

/* ================================================================== */
/* Cuello y cabeza                                                    */
/* ================================================================== */

/** Cuello desnudo: piel arrugada, deliberadamente delgado contra la masa del torso. */
export function neck(noise: Noise, segments: number): Part {
  const path = chain(['Spine2', 'Neck', 'Neck1', 'Neck2', 'Head'], 16);
  const mesh = tube(path, (t, a) => ellipseR(
    curve([[0, 0.085], [0.22, 0.056], [0.6, 0.048], [1, 0.056]], t),
    curve([[0, 0.090], [0.22, 0.058], [0.6, 0.050], [1, 0.060]], t),
    a,
  ), { radial: segments, up: V(0, 0, 1) });

  // Pliegues anulares: el cuello se acordeona, no es un tubo liso.
  displace(mesh, (x, y, z) => {
    const rings = Math.sin(y * 96) * 0.0022;
    const wrinkle = noise.fbm(x * 40, y * 40, z * 40, 3) * 0.004;
    return rings + wrinkle;
  });

  return { mesh, material: 'skin', bind: ['Spine2', 'Neck', 'Neck1', 'Neck2', 'Head'] };
}

/**
 * La gola: el collar de plumón en la base del cuello. Se construye como plumas
 * individuales en vez de como un cono porque el borde recortado es justo lo que
 * la hace leer como plumón y no como un cuello de jersey.
 */
export function ruff(rand: () => number, count: number): Part {
  const out = emptyMesh();
  const base = RIG.bindPos[RIG.index('Neck')];
  const n = Math.max(9, count);

  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    // Más larga por detrás: la gola cae sobre la espalda.
    const back = 0.5 - 0.5 * Math.cos(a);
    const len = 0.10 + back * 0.075 + rand() * 0.016;
    const r0 = 0.075;
    const dir = V(Math.sin(a), 0, Math.cos(a));
    const path = samplePath([
      [base.x + dir.x * r0, base.y + 0.015, base.z + dir.z * r0],
      [base.x + dir.x * (r0 + len * 0.45), base.y - len * 0.30, base.z + dir.z * (r0 + len * 0.45)],
      [base.x + dir.x * (r0 + len * 0.62), base.y - len * 0.92, base.z + dir.z * (r0 + len * 0.55)],
    ], 6);
    const hw = 0.055 + rand() * 0.012;
    const f = blade(path, (t) => hw * curve([[0, 0.35], [0.35, 1], [1, 0.22]], t), {
      across: 3,
      up: V(0, 1, 0),
      lift: (t, s) => -Math.abs(s) * 0.018 * t,
    });
    appendRange(out, f);
  }
  computeNormals(out);
  return { mesh: out, material: 'down', bind: ['Spine2', 'Neck', 'Neck1'] };
}

/** Cabeza: cráneo, cresta ósea y pico ganchudo. */
export function head(noise: Noise, segments: number): Part[] {
  const h = RIG.bindPos[RIG.index('Head')];

  // --- cráneo ---
  const skull = ellipsoid(0.056, 0.058, 0.072, segments, Math.max(8, segments - 2));
  place(skull, h.x, h.y + 0.006, h.z + 0.008, -0.18, 0, 0);
  displace(skull, (x, y, z) => {
    // Cresta baja de la frente a la nuca.
    const ridge = Math.exp(-(x * x) / 0.0006) * Math.max(0, (z - h.z) * 3) * 0.012;
    return ridge + noise.fbm(x * 30, y * 30, z * 30, 3) * 0.0025;
  });

  // --- pico: recto y luego el gancho ---
  const beakPath = samplePath([
    [0, h.y + 0.012, h.z + 0.052],
    [0, h.y + 0.004, h.z + 0.105],
    [0, h.y - 0.016, h.z + 0.148],
    [0, h.y - 0.052, h.z + 0.152],
  ], 12);
  const beak = tube(beakPath, (t, a) => ellipseR(
    curve([[0, 0.042], [0.45, 0.030], [1, 0.006]], t),
    curve([[0, 0.048], [0.45, 0.036], [1, 0.008]], t),
    a,
  ), { radial: segments, capStart: true, capEnd: true, up: V(0, 1, 0) });

  // --- cera: la banda carnosa en la base del pico ---
  const cere = tube(samplePath([
    [0, h.y + 0.016, h.z + 0.036],
    [0, h.y + 0.012, h.z + 0.058],
  ], 4), (_t, a) => ellipseR(0.044, 0.050, a), { radial: segments, up: V(0, 1, 0) });

  // --- ojos: esfera oscura hundida en una cuenca ---
  const eyeGeo = emptyMesh();
  for (const s of [-1, 1]) {
    const e = ellipsoid(0.0125, 0.0125, 0.0125, 10, 8);
    place(e, h.x + s * 0.044, h.y + 0.020, h.z + 0.030);
    appendRange(eyeGeo, e);
  }
  computeNormals(eyeGeo);

  return [
    { mesh: skull, material: 'skin', bind: ['Head'] },
    { mesh: beak, material: 'horn', bind: ['Head', 'Beak'] },
    { mesh: cere, material: 'skin', bind: ['Head'] },
    { mesh: eyeGeo, material: 'eye', bind: ['Head'] },
  ];
}

/* ================================================================== */
/* Alas / brazos                                                      */
/* ================================================================== */

/**
 * El brazo emplumado. Un solo tubo de hombro a muñeca: separar húmero y
 * antebrazo en dos piezas produce una costura justo en el codo, que es el único
 * sitio donde el skin de verdad tiene que estirarse.
 */
export function wingArm(side: 1 | -1, noise: Noise, segments: number): Part {
  const s = side > 0 ? 'R' : 'L';
  const path = chain([`Clavicle${s}`, `UpperArm${s}`, `Forearm${s}`, `Hand${s}`], 18, 0.05);
  // Sección aplastada: el ala plegada es una lámina contra el costado, no un
  // brazo cilíndrico. `ellipseR(fino, ancho)` con el eje fino en lateral.
  const mesh = tube(path, (t, a) => ellipseR(
    curve([[0, 0.070], [0.25, 0.062], [0.6, 0.048], [0.85, 0.036], [1, 0.024]], t),
    curve([[0, 0.115], [0.25, 0.110], [0.6, 0.086], [0.85, 0.056], [1, 0.032]], t),
    a,
  ), { radial: segments, capEnd: true, up: V(side, 0, 0) });

  displace(mesh, (x, y, z) => noise.fbm(x * 16, y * 16, z * 16, 3) * 0.006);

  return {
    mesh,
    material: 'feather',
    bind: [`Spine2`, `Clavicle${s}`, `UpperArm${s}`, `Forearm${s}`, `Hand${s}`],
  };
}

/**
 * Rémiges plegadas. Con el ala cerrada las primarias no se abren en abanico:
 * se apilan hacia atrás y abajo, solapadas, siguiendo el costado del cuerpo.
 * Cada pluma se pesa a la mano o al antebrazo según de dónde nace, para que al
 * abrir el ala el abanico se despliegue solo.
 */
export function wingFeathers(side: 1 | -1, rand: () => number, count: number): Part[] {
  const s = side > 0 ? 'R' : 'L';
  const wrist = RIG.bindPos[RIG.index(`Hand${s}`)];
  const elbow = RIG.bindPos[RIG.index(`Forearm${s}`)];

  const primaries = emptyMesh();
  const secondaries = emptyMesh();
  const nPrim = Math.max(5, Math.round(count * 0.6));
  const nSec = Math.max(4, count - nPrim);

  // Primarias: nacen en la muñeca y barren hacia atrás por el flanco, cruzando
  // por encima de la cola. Se apilan de dentro afuera — la más externa es la más
  // larga y la que queda por encima de todas.
  for (let k = 0; k < nPrim; k++) {
    const u = nPrim > 1 ? k / (nPrim - 1) : 0;
    const len = 0.50 + u * 0.24 + rand() * 0.03;
    const root = V(
      wrist.x - side * (0.004 + u * 0.026),
      wrist.y + 0.030 - u * 0.026,
      wrist.z - 0.010 - u * 0.020,
    );
    appendRange(primaries, remige(root, side, len, 0.050 + rand() * 0.008, u, rand));
  }

  // Secundarias: del codo hacia atrás, más cortas y más pegadas al cuerpo.
  for (let k = 0; k < nSec; k++) {
    const u = nSec > 1 ? k / (nSec - 1) : 0;
    const len = 0.28 + u * 0.12 + rand() * 0.02;
    const root = V(
      elbow.x - side * (0.002 + u * 0.020),
      elbow.y - 0.010 - u * 0.032,
      elbow.z + 0.010 - u * 0.014,
    );
    appendRange(secondaries, remige(root, side, len, 0.048 + rand() * 0.006, u * 0.4, rand));
  }

  computeNormals(primaries);
  computeNormals(secondaries);

  return [
    { mesh: primaries, material: 'feather', bind: [`Hand${s}`, `Forearm${s}`] },
    { mesh: secondaries, material: 'feather', bind: [`Forearm${s}`, `UpperArm${s}`] },
  ];
}

/**
 * Una rémige: raquis que barre hacia atrás y abajo, con el vexilo desplegado en
 * el plano vertical del flanco. `up` es el eje LATERAL a propósito — `blade`
 * saca el ancho de `cross(tangente, up)`, así que darle el lateral produce una
 * lámina vertical, que es como cuelga una pluma en un ala plegada.
 */
function remige(root: THREE.Vector3, side: 1 | -1, len: number, halfWidth: number, droop: number, rand: () => number): MeshData {
  const sag = 0.30 + droop * 0.24;
  const jitter = (rand() - 0.5) * 0.014;
  const path = samplePath([
    [root.x, root.y, root.z],
    [root.x - side * 0.008, root.y - len * sag * 0.28, root.z - len * 0.40 + jitter],
    [root.x - side * 0.016, root.y - len * sag * 0.66, root.z - len * 0.74],
    [root.x - side * 0.024, root.y - len * sag * 1.15, root.z - len * 0.99],
  ], 9);
  return blade(path, (t) => halfWidth * curve([[0, 0.35], [0.22, 1], [0.78, 0.90], [1, 0.12]], t), {
    across: 3,
    up: V(side, 0, 0),
    // Comba: el vexilo cae desde el raquis, no es una lámina plana.
    lift: (t, q) => -side * Math.abs(q) * 0.018 * (0.35 + t * 0.65),
  });
}

/* ================================================================== */
/* Patas                                                              */
/* ================================================================== */

/**
 * Pata digitígrada en dos materiales: muslo/tibia emplumados (los "pantalones")
 * y tarso desnudo escamoso. El corte entre ambos está en el corvejón, que es
 * donde está en el animal y donde la silueta lo pide.
 */
export function leg(side: 1 | -1, noise: Noise, segments: number): Part[] {
  const s = side > 0 ? 'R' : 'L';
  const parts: Part[] = [];

  // --- pantalón emplumado: cadera -> corvejón ---
  const upper = chain([`UpLeg${s}`, `Leg${s}`, `Ankle${s}`], 12);
  const thigh = tube(upper, (t, a) => ellipseR(
    curve([[0, 0.108], [0.35, 0.098], [0.7, 0.062], [1, 0.038]], t),
    curve([[0, 0.115], [0.35, 0.100], [0.7, 0.058], [1, 0.036]], t),
    a,
  ), { radial: segments, capStart: true, up: V(0, 0, 1) });
  displace(thigh, (x, y, z) => noise.fbm(x * 14, y * 14, z * 14, 3) * 0.007);
  parts.push({ mesh: thigh, material: 'feather', bind: ['Hips', `UpLeg${s}`, `Leg${s}`, `Ankle${s}`] });

  // --- tarso escamoso: corvejón -> nudillo ---
  const lower = chain([`Ankle${s}`, `Foot${s}`], 8);
  const shank = tube(lower, (t, a) => ellipseR(
    curve([[0, 0.034], [0.5, 0.028], [1, 0.031]], t),
    curve([[0, 0.036], [0.5, 0.029], [1, 0.033]], t),
    a,
  ), { radial: Math.max(8, segments - 4), up: V(0, 0, 1) });
  displace(shank, (x, y, z) => {
    // Escamas: bandas horizontales, no ruido isotrópico.
    const scale = Math.sin(y * 150) * 0.0016;
    return scale + noise.fbm(x * 50, y * 50, z * 50, 2) * 0.0018;
  });
  parts.push({ mesh: shank, material: 'horn', bind: [`Ankle${s}`, `Foot${s}`] });

  // --- dedos: tres adelante, uno atrás, cada uno con garra ---
  const foot = RIG.bindPos[RIG.index(`Foot${s}`)];
  const toes = emptyMesh();
  const claws = emptyMesh();
  const spread: [number, number, number][] = [
    [-0.052, 0.155, 1],   // interno
    [0.004, 0.185, 1.15], // central, el más largo
    [0.056, 0.150, 1],    // externo
    [-0.010, -0.105, 0.72], // hállux, hacia atrás
  ];
  for (const [dx, dz, k] of spread) {
    const tip = V(foot.x + side * dx, 0.020, foot.z + dz);
    const path = samplePath([
      [foot.x, foot.y - 0.010, foot.z + 0.010],
      [foot.x + side * dx * 0.5, 0.030, foot.z + dz * 0.5],
      [tip.x, tip.y, tip.z],
    ], 7);
    appendRange(toes, tube(path, (t, a) => ellipseR(
      curve([[0, 0.026 * k], [0.6, 0.019 * k], [1, 0.013 * k]], t),
      curve([[0, 0.027 * k], [0.6, 0.020 * k], [1, 0.014 * k]], t),
      a,
    ), { radial: 8, capStart: true, up: V(0, 1, 0) }));

    // Garra: cono curvado que continúa el dedo y toca el suelo.
    const fwd = new THREE.Vector3(tip.x - foot.x, 0, tip.z - foot.z).normalize();
    const clawPath = samplePath([
      [tip.x, tip.y, tip.z],
      [tip.x + fwd.x * 0.026, tip.y - 0.004, tip.z + fwd.z * 0.026],
      [tip.x + fwd.x * 0.042, 0.0, tip.z + fwd.z * 0.042],
    ], 6);
    appendRange(claws, tube(clawPath, (t, a) => ellipseR(
      curve([[0, 0.013 * k], [1, 0.0015]], t),
      curve([[0, 0.014 * k], [1, 0.0015]], t),
      a,
    ), { radial: 7, capStart: true, capEnd: true, up: V(0, 1, 0) }));
  }
  computeNormals(toes);
  computeNormals(claws);
  parts.push({ mesh: toes, material: 'horn', bind: [`Foot${s}`, `Toe${s}`] });
  parts.push({ mesh: claws, material: 'horn', bind: [`Toe${s}`] });

  return parts;
}

/* ================================================================== */
/* Cola                                                               */
/* ================================================================== */

/** Timoneras: abanico corto y cuadrado, el contrapeso de la cabeza proyectada. */
export function tail(rand: () => number, count: number): Part {
  const out = emptyMesh();
  const root = RIG.bindPos[RIG.index('Tail')];
  const n = Math.max(5, Math.round(count * 0.6));
  for (let k = 0; k < n; k++) {
    const u = n > 1 ? (k / (n - 1)) * 2 - 1 : 0; // -1..1 lateral
    const len = 0.34 - Math.abs(u) * 0.06 + rand() * 0.02;
    const path = samplePath([
      [root.x + u * 0.020, root.y, root.z - 0.02],
      [root.x + u * 0.075, root.y - len * 0.22, root.z - len * 0.52],
      [root.x + u * 0.115, root.y - len * 0.55, root.z - len * 0.98],
    ], 7);
    appendRange(out, blade(path, (t) => (0.050 + rand() * 0.006) * curve([[0, 0.4], [0.3, 1], [1, 0.55]], t), {
      across: 3,
      up: V(u * 0.25, 0.96, 0),
      lift: (t, q) => -Math.abs(q) * 0.014 * t,
    }));
  }
  computeNormals(out);
  return { mesh: out, material: 'feather', bind: ['Tail', 'Tail1', 'Hips'] };
}

/* ------------------------------------------------------------------ */

/** `appendMesh` reexportado con nombre local para no arrastrar el import. */
function appendRange(dst: MeshData, src: MeshData): void {
  const base = dst.p.length / 3;
  for (let k = 0; k < src.p.length; k++) dst.p.push(src.p[k]);
  for (let k = 0; k < src.n.length; k++) dst.n.push(src.n[k]);
  for (let k = 0; k < src.uv.length; k++) dst.uv.push(src.uv[k]);
  for (let k = 0; k < src.i.length; k++) dst.i.push(src.i[k] + base);
}

export { mirrorX, revolve };
