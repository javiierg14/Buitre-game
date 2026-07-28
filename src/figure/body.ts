/**
 * Cuerpo: tronco, brazos, piernas y extremos.
 *
 * El tronco es un loft de secciones: una tabla de (altura, semiancho, semifondo)
 * interpolada, más brochas para pecho, clavículas y omóplatos. Trabajar por
 * secciones —y no por primitivas pegadas— es lo que hace que la silueta de
 * perfil sea continua, que es donde se cae cualquier cuerpo hecho de cápsulas.
 *
 * `torsoRadius()` se exporta porque la ropa la necesita: una prenda es este
 * mismo perfil desplazado hacia fuera unos milímetros.
 */

import * as THREE from 'three';
import { appendMesh, computeNormals, emptyMesh, tube, type MeshData } from '../character/geo';
import { sculpt, type Brush } from './sculpt';
import { F } from './proportions';

const smoothstep = (t: number): number => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

/** (y, semiancho, semifondo, exponente de superelipse, desplazamiento en z). */
const TORSO: readonly (readonly [number, number, number, number, number])[] = [
  [0.782, 0.132, 0.096, 2.5, 0.004],
  [0.860, 0.150, 0.104, 2.4, 0.002],
  [F.hipY, F.hipRx, F.hipRz, 2.3, 0],
  [0.985, 0.126, 0.092, 2.2, -0.004],
  [F.waistY, F.waistRx, F.waistRz, 2.1, -0.006],
  [1.135, 0.119, 0.089, 2.2, -0.004],
  [F.bustY, F.bustRx, F.bustRz, 2.3, 0.002],
  [1.315, 0.137, 0.093, 2.4, 0.004],
  [F.shoulderY, 0.148, 0.084, 2.5, 0.002],
  [1.432, 0.096, 0.070, 2.6, 0.004],
];

function sample(y: number): readonly [number, number, number, number] {
  if (y <= TORSO[0][0]) return [TORSO[0][1], TORSO[0][2], TORSO[0][3], TORSO[0][4]];
  const last = TORSO[TORSO.length - 1];
  if (y >= last[0]) return [last[1], last[2], last[3], last[4]];
  for (let k = 1; k < TORSO.length; k++) {
    if (y <= TORSO[k][0]) {
      const a = TORSO[k - 1];
      const b = TORSO[k];
      const t = smoothstep((y - a[0]) / (b[0] - a[0]));
      return [
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        a[3] + (b[3] - a[3]) * t,
        a[4] + (b[4] - a[4]) * t,
      ];
    }
  }
  return [last[1], last[2], last[3], last[4]];
}

/**
 * Punto de la superficie del tronco a una altura y un ángulo. `inflate` empuja
 * hacia fuera en metros — así la ropa reutiliza exactamente esta forma.
 */
export function torsoRadius(y: number, angle: number, inflate = 0): { x: number; z: number } {
  const [rx, rz, exp, zOff] = sample(y);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // superelipse: |c|^e + |s|^e = 1. Con e>2 la sección se acerca al rectángulo
  // redondeado de una caja torácica; con e=2 sería una elipse pura.
  const k = 1 / Math.pow(Math.pow(Math.abs(c), exp) + Math.pow(Math.abs(s), exp), 1 / exp);
  return { x: c * (rx + inflate) * k, z: s * (rz + inflate) * k + zOff };
}

export function buildTorso(segments: number): MeshData {
  const segU = Math.max(32, segments * 4);
  const rings = 56;
  const m = emptyMesh();
  const yTop = 1.432;
  const yBottom = 0.782;

  for (let r = 0; r <= rings; r++) {
    const y = yBottom + (yTop - yBottom) * (r / rings);
    for (let u = 0; u <= segU; u++) {
      const a = (u / segU) * Math.PI * 2;
      const p = torsoRadius(y, a);
      m.p.push(p.x, y, p.z);
      m.n.push(0, 0, 0);
      m.uv.push(a * 0.12, y);
    }
  }
  const stride = segU + 1;
  for (let r = 0; r < rings; r++) {
    for (let u = 0; u < segU; u++) {
      const a = r * stride + u;
      m.i.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
    }
  }

  // tapa inferior (queda dentro de la falda, pero sin ella habría un agujero)
  const capCenter = m.p.length / 3;
  m.p.push(0, yBottom - 0.002, 0);
  m.n.push(0, -1, 0);
  m.uv.push(0, 0);
  for (let u = 0; u < segU; u++) m.i.push(capCenter, u + 1, u);

  const brushes: Brush[] = [
    // --- pecho ---
    { at: [0.058, F.bustY + 0.012, 0.086], radius: [0.058, 0.070, 0.062], strength: 0.030, mirror: true },
    { at: [0.052, F.bustY - 0.030, 0.090], radius: [0.040, 0.040, 0.045], strength: 0.012, mirror: true },
    // surco esternal
    { at: [0, F.bustY + 0.005, 0.092], radius: [0.016, 0.050, 0.030], strength: -0.010 },
    // --- clavículas ---
    { at: [0.058, 1.386, 0.062], radius: [0.070, 0.014, 0.045], strength: 0.006, mirror: true },
    { at: [0.058, 1.372, 0.066], radius: [0.062, 0.012, 0.040], strength: -0.005, mirror: true },
    // hueco supraesternal
    { at: [0, 1.396, 0.062], radius: [0.020, 0.014, 0.030], strength: -0.007 },
    // --- espalda ---
    // canal de la columna
    { at: [0, 1.150, -0.086], radius: [0.016, 0.180, 0.040], strength: -0.008 },
    // omóplatos
    { at: [0.062, 1.310, -0.078], radius: [0.048, 0.052, 0.040], strength: 0.005, mirror: true },
    // --- cadera ---
    // hueco del trocánter, que separa cadera de muslo
    { at: [F.hipRx * 0.98, 0.868, 0], radius: [0.030, 0.048, 0.070], strength: -0.006, mirror: true },
    // ombligo
    { at: [0, 1.020, F.waistRz + 0.006], radius: [0.010, 0.012, 0.020], strength: -0.006 },
  ];

  return sculpt(m, brushes);
}

/* ------------------------------------------------------------------ */
/* Miembros                                                            */
/* ------------------------------------------------------------------ */

function limbPath(points: readonly (readonly [number, number, number])[], steps: number): THREE.Vector3[] {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  return curve.getSpacedPoints(steps);
}

/** Brazos con la ligera abducción de un brazo en reposo, no pegado al costado. */
export function buildArms(segments: number): MeshData {
  const m = emptyMesh();
  const radial = Math.max(10, segments);

  for (const side of [1, -1] as const) {
    const path = limbPath(
      [
        [side * 0.146, 1.392, 0.004],
        [side * 0.172, 1.320, 0.002],
        [side * 0.188, 1.180, -0.004],
        [side * 0.194, F.elbowY, -0.008],
        [side * 0.198, 0.965, 0.002],
        [side * 0.196, F.wristY, 0.014],
      ],
      26,
    );

    const arm = tube(
      path,
      (t) => {
        // deltoides -> bíceps -> codo -> antebrazo -> muñeca
        const deltoid = 0.052 * (1 - smoothstep(t / 0.16));
        const base =
          0.0425 - 0.010 * smoothstep((t - 0.1) / 0.35) + 0.004 * smoothstep((t - 0.42) / 0.15) - 0.011 * smoothstep((t - 0.62) / 0.38);
        return Math.max(0.0165, base + deltoid * 0.35);
      },
      { radial, capStart: true },
    );
    appendMesh(m, arm);
    appendMesh(m, buildHand(side, radial));
  }
  return computeNormals(m);
}

/**
 * Mano simplificada: palma achatada y un bloque de dedos con separaciones
 * insinuadas. A la escala de los encuadres previstos, cinco dedos articulados
 * no aportan nada y multiplican el conteo de triángulos.
 */
function buildHand(side: 1 | -1, radial: number): MeshData {
  const m = emptyMesh();
  const wristY = F.wristY;

  const palm = tube(
    limbPath(
      [
        [side * 0.196, wristY, 0.014],
        [side * 0.197, wristY - 0.045, 0.016],
        [side * 0.196, wristY - 0.090, 0.014],
      ],
      10,
    ),
    (t, a) => {
      // sección aplanada: ancha de canto, fina de perfil
      const w = 0.028 - 0.004 * t;
      const d = 0.0125 - 0.002 * t;
      const c = Math.cos(a);
      const s = Math.sin(a);
      return (w * d) / Math.sqrt((d * c) ** 2 + (w * s) ** 2);
    },
    { radial, capStart: true },
  );
  appendMesh(m, palm);

  const fingers = tube(
    limbPath(
      [
        [side * 0.196, wristY - 0.088, 0.014],
        [side * 0.194, wristY - 0.135, 0.010],
        [side * 0.191, wristY - 0.172, 0.002],
      ],
      10,
    ),
    (t, a) => {
      const w = 0.026 - 0.008 * t;
      const d = 0.0115 - 0.004 * t;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const r = (w * d) / Math.sqrt((d * c) ** 2 + (w * s) ** 2);
      // ranuras entre dedos
      return r * (1 - 0.09 * Math.abs(Math.sin(a * 2)) * smoothstep(t / 0.3));
    },
    { radial, capEnd: true },
  );
  appendMesh(m, fingers);

  // pulgar
  const thumb = tube(
    limbPath(
      [
        [side * 0.176, wristY - 0.030, 0.020],
        [side * 0.166, wristY - 0.070, 0.026],
        [side * 0.163, wristY - 0.098, 0.024],
      ],
      8,
    ),
    (t) => 0.0105 - 0.003 * t,
    { radial: Math.max(6, radial - 4), capStart: true, capEnd: true },
  );
  appendMesh(m, thumb);

  return m;
}

/** Piernas. Rodilla y gemelo marcados: sin ellos la pierna es un cono. */
export function buildLegs(segments: number): MeshData {
  const m = emptyMesh();
  const radial = Math.max(12, segments + 2);

  for (const side of [1, -1] as const) {
    const path = limbPath(
      [
        [side * 0.074, 0.855, 0],
        [side * 0.070, 0.700, 0.002],
        [side * 0.064, 0.560, 0.004],
        [side * 0.060, F.kneeY, 0.006],
        [side * 0.058, 0.360, -0.004],
        [side * 0.054, 0.230, -0.002],
        [side * 0.050, F.ankleY + 0.02, 0.006],
      ],
      34,
    );

    const leg = tube(
      path,
      (t, a) => {
        const thigh = F.thighR * (1 - 0.30 * smoothstep(t / 0.45));
        const knee = 0.0055 * Math.exp(-(((t - 0.50) * 9) ** 2));
        const calf = 0.014 * Math.exp(-(((t - 0.66) * 6) ** 2));
        // el gemelo abulta por detrás (z<0), no en redondo
        const back = Math.max(0, -Math.sin(a));
        const ankle = -0.020 * smoothstep((t - 0.80) / 0.20);
        return Math.max(0.030, thigh + knee + calf * (0.45 + 0.75 * back) + ankle);
      },
      { radial, capStart: true },
    );
    appendMesh(m, leg);
    appendMesh(m, buildFoot(side, radial));
  }
  return computeNormals(m);
}

function buildFoot(side: 1 | -1, radial: number): MeshData {
  return tube(
    limbPath(
      [
        [side * 0.050, F.ankleY + 0.024, 0.002],
        [side * 0.049, F.ankleY - 0.030, 0.030],
        [side * 0.048, 0.022, 0.086],
        [side * 0.047, 0.014, 0.132],
      ],
      12,
    ),
    (t, a) => {
      const w = 0.036 - 0.004 * Math.abs(t - 0.6);
      const d = 0.030 - 0.016 * smoothstep(t / 0.7);
      const c = Math.cos(a);
      const s = Math.sin(a);
      return (w * d) / Math.sqrt((d * c) ** 2 + (w * s) ** 2);
    },
    { radial, capStart: true, capEnd: true },
  );
}
