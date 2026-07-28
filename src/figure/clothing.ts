/**
 * Ropa. Cada prenda es el perfil del tronco desplazado hacia fuera unos
 * milímetros, no una malla independiente: así la prenda no atraviesa el cuerpo
 * al cambiar las proporciones, que es el fallo clásico de modelar ropa aparte.
 *
 * Los conjuntos salen de las referencias: camiseta blanca de tirantes con falda
 * verde menta, y vestido negro corto.
 */

import * as THREE from 'three';
import { appendMesh, computeNormals, emptyMesh, tube, type MeshData } from '../character/geo';
import { torsoRadius } from './body';
import { F, PALETTE } from './proportions';

const smoothstep = (t: number): number => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

export type Outfit = 'casual' | 'dress';

/** Pliegue vertical suave: rompe la superficie para que la tela no sea plástico. */
function fold(angle: number, amount: number, count = 9): number {
  return Math.sin(angle * count) * amount;
}

/**
 * Prenda tubular genérica entre dos alturas.
 * `edge(angle)` da la altura del borde superior — es lo que dibuja un escote.
 * `flare(t, angle)` añade vuelo al bajo.
 */
function garment(
  yBottom: number,
  edge: (angle: number) => number,
  inflate: (t: number) => number,
  flare: (t: number, angle: number) => number,
  segU: number,
  rings: number,
): MeshData {
  const m = emptyMesh();
  for (let r = 0; r <= rings; r++) {
    const t = r / rings; // 0 = bajo, 1 = borde superior
    for (let u = 0; u <= segU; u++) {
      const a = (u / segU) * Math.PI * 2;
      const yTop = edge(a);
      const y = yBottom + (yTop - yBottom) * t;
      const p = torsoRadius(y, a, inflate(t) + flare(t, a) + fold(a, 0.0016 * (1 - t)));
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
  return computeNormals(m);
}

/** Camiseta de tirantes: escote redondo delante, espalda algo más alta. */
export function buildTop(segments: number): MeshData {
  const segU = Math.max(40, segments * 4);
  const m = garment(
    1.012,
    (a) => {
      const s = Math.sin(a); // +1 delante, -1 detrás
      const front = Math.max(0, s) ** 1.35;
      const back = Math.max(0, -s) ** 1.6;
      return 1.322 - 0.042 * front - 0.010 * back;
    },
    // suelta abajo, ceñida arriba
    (t) => 0.0085 + 0.006 * (1 - smoothstep(t / 0.7)),
    () => 0,
    segU,
    30,
  );
  appendMesh(m, buildStraps());
  return computeNormals(m);
}

/** Tirantes: dos cintas finas que cruzan el hombro. */
function buildStraps(): MeshData {
  const m = emptyMesh();
  for (const side of [1, -1] as const) {
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.068, 1.286, 0.088),
      new THREE.Vector3(side * 0.104, 1.352, 0.062),
      new THREE.Vector3(side * 0.124, 1.401, 0.012),
      new THREE.Vector3(side * 0.112, 1.372, -0.048),
      new THREE.Vector3(side * 0.082, 1.312, -0.076),
    ]).getSpacedPoints(22);

    appendMesh(
      m,
      tube(path, (_t, a) => {
        // cinta: ancha de plano, muy fina de canto
        const w = 0.0125;
        const d = 0.0022;
        const c = Math.cos(a);
        const s = Math.sin(a);
        return (w * d) / Math.sqrt((d * c) ** 2 + (w * s) ** 2);
      }, { radial: 8, capStart: true, capEnd: true }),
    );
  }
  return m;
}

/** Falda corta de tubo con algo de vuelo. */
export function buildSkirt(segments: number): MeshData {
  const segU = Math.max(44, segments * 4);
  return garment(
    0.735,
    () => 1.062,
    (t) => 0.010 + 0.004 * t,
    // vuelo: se abre hacia el bajo, con más caída delante y detrás que en las
    // caderas, que es como cae una falda recta al andar
    (t, a) => {
      const open = (1 - t) ** 1.5;
      return open * (0.020 + 0.012 * Math.abs(Math.sin(a)));
    },
    segU,
    26,
  );
}

/** Vestido negro corto: una sola pieza, escote recto. */
export function buildDress(segments: number): MeshData {
  const segU = Math.max(44, segments * 4);
  const m = garment(
    0.755,
    (a) => {
      const s = Math.sin(a);
      return 1.302 - 0.016 * Math.max(0, s) ** 1.2;
    },
    (t) => 0.009 + 0.005 * (1 - t),
    (t, a) => {
      // vuelo sólo en el tercio inferior
      const open = Math.max(0, 0.34 - t) / 0.34;
      return open * open * (0.026 + 0.014 * Math.abs(Math.sin(a)));
    },
    segU,
    34,
  );
  appendMesh(m, buildStraps());
  return computeNormals(m);
}

/**
 * Material de tela. `sheen` es lo que distingue algodón de plástico: la tela
 * rebota luz en el borde a contraluz, y sin ese término una camiseta blanca
 * bajo softbox se ve como porcelana.
 */
export function createClothMaterial(color: string, roughness = 0.86): THREE.MeshPhysicalMaterial {
  const base = new THREE.Color(color);
  return new THREE.MeshPhysicalMaterial({
    color: base,
    roughness,
    metalness: 0,
    sheen: 0.85,
    sheenRoughness: 0.62,
    sheenColor: base.clone().lerp(new THREE.Color('#ffffff'), 0.55),
    envMapIntensity: 0.7,
    side: THREE.DoubleSide,
  });
}

export const OUTFITS: Record<Outfit, { pieces: { build: (s: number) => MeshData; color: string }[] }> = {
  casual: {
    pieces: [
      { build: buildTop, color: PALETTE.top },
      { build: buildSkirt, color: PALETTE.skirt },
    ],
  },
  dress: {
    pieces: [{ build: buildDress, color: PALETTE.dress }],
  },
};

export { F as FIGURE_PROPORTIONS };
