/**
 * Escultura por brochas sobre una malla ya generada.
 *
 * Modelar una cara escribiendo coordenadas de vértices es inviable. Lo que sí
 * funciona es partir de un elipsoide y empujarlo con brochas de caída suave,
 * que es exactamente como se esculpe a mano: cada brocha es una zona de
 * influencia, una dirección y una fuerza. El resultado sigue siendo una malla
 * cerrada y lisa, sin costuras que arreglar.
 */

import * as THREE from 'three';
import { computeNormals, type MeshData } from '../character/geo';

export interface Brush {
  /** Centro de influencia, en el espacio local de la malla. */
  at: readonly [number, number, number];
  /**
   * Radio de caída. Un escalar da una esfera; una terna da un elipsoide, que es
   * lo que hace falta para un pómulo (ancho en X, corto en Y) o un puente nasal
   * (estrecho en X, largo en Y).
   */
  radius: number | readonly [number, number, number];
  /** Desplazamiento en metros en el centro de la brocha. Negativo = hundir. */
  strength: number;
  /** Dirección del empuje. Si se omite, cada vértice se mueve por su normal. */
  dir?: readonly [number, number, number];
  /**
   * `gauss` reparte muy suave (volúmenes: cráneo, mejilla). `smooth` corta más
   * definido en el borde (rasgos: ala de la nariz, borde del labio).
   */
  falloff?: 'gauss' | 'smooth';
  /** Multiplicador extra por vértice, para limitar la brocha a una mitad. */
  mask?: (x: number, y: number, z: number) => number;
  /** Aplica también en -X. Ahorra declarar cada rasgo dos veces. */
  mirror?: boolean;
}

const _dir = new THREE.Vector3();

function weightAt(dx: number, dy: number, dz: number, r: readonly [number, number, number], kind: 'gauss' | 'smooth'): number {
  const d = Math.sqrt((dx / r[0]) ** 2 + (dy / r[1]) ** 2 + (dz / r[2]) ** 2);
  if (d >= 1) return 0;
  // gauss recortado en d=1: sin el recorte la brocha tiene cola infinita y
  // mover la nariz te desplaza la nuca un milimetro.
  if (kind === 'gauss') return Math.exp(-(d * d) * 3.2) - Math.exp(-3.2);
  const t = 1 - d;
  return t * t * (3 - 2 * t);
}

/** Aplica las brochas en orden. Las normales se recalculan una sola vez al final. */
export function sculpt(m: MeshData, brushes: readonly Brush[]): MeshData {
  for (const b of brushes) {
    const passes = b.mirror ? [1, -1] : [1];
    for (const sx of passes) {
      const r: readonly [number, number, number] =
        typeof b.radius === 'number' ? [b.radius, b.radius, b.radius] : b.radius;
      const cx = b.at[0] * sx;
      const cy = b.at[1];
      const cz = b.at[2];
      const kind = b.falloff ?? 'gauss';
      const norm = weightAt(0, 0, 0, r, kind);
      if (norm <= 0) continue;

      for (let k = 0; k < m.p.length; k += 3) {
        const x = m.p[k];
        const y = m.p[k + 1];
        const z = m.p[k + 2];
        let w = weightAt(x - cx, y - cy, z - cz, r, kind) / norm;
        if (w <= 0) continue;
        if (b.mask) {
          w *= b.mask(x, y, z);
          if (w <= 0) continue;
        }
        const amount = b.strength * w;
        if (b.dir) {
          _dir.set(b.dir[0] * sx, b.dir[1], b.dir[2]).normalize();
        } else {
          _dir.set(m.n[k], m.n[k + 1], m.n[k + 2]);
        }
        m.p[k] += _dir.x * amount;
        m.p[k + 1] += _dir.y * amount;
        m.p[k + 2] += _dir.z * amount;
      }
    }
  }
  return computeNormals(m);
}

/**
 * Suavizado laplaciano. Las brochas encadenadas dejan facetas donde se solapan;
 * un par de pasadas las funden sin perder la forma.
 */
export function relax(m: MeshData, iterations = 1, factor = 0.5): MeshData {
  const count = m.p.length / 3;
  const neighbours: number[][] = Array.from({ length: count }, () => []);
  for (let k = 0; k < m.i.length; k += 3) {
    const a = m.i[k];
    const b = m.i[k + 1];
    const c = m.i[k + 2];
    neighbours[a].push(b, c);
    neighbours[b].push(a, c);
    neighbours[c].push(a, b);
  }

  for (let it = 0; it < iterations; it++) {
    const src = m.p.slice();
    for (let v = 0; v < count; v++) {
      const nb = neighbours[v];
      if (nb.length === 0) continue;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (const j of nb) {
        sx += src[j * 3];
        sy += src[j * 3 + 1];
        sz += src[j * 3 + 2];
      }
      const inv = 1 / nb.length;
      m.p[v * 3] += (sx * inv - src[v * 3]) * factor;
      m.p[v * 3 + 1] += (sy * inv - src[v * 3 + 1]) * factor;
      m.p[v * 3 + 2] += (sz * inv - src[v * 3 + 2]) * factor;
    }
  }
  return computeNormals(m);
}

/**
 * Color por vértice como máscara regional. La malla de la cabeza lleva UV en
 * metros (para texturas que tilean), así que el tono por zona — rubor en las
 * mejillas, rojez en la nariz y las orejas — se pinta aquí y multiplica al mapa.
 */
export function paintVertexColors(
  m: MeshData,
  base: THREE.Color,
  zones: readonly { at: readonly [number, number, number]; radius: number | readonly [number, number, number]; color: THREE.Color; amount: number; mirror?: boolean }[],
): Float32Array {
  const count = m.p.length / 3;
  const out = new Float32Array(count * 3);
  for (let v = 0; v < count; v++) {
    out[v * 3] = base.r;
    out[v * 3 + 1] = base.g;
    out[v * 3 + 2] = base.b;
  }

  for (const z of zones) {
    const passes = z.mirror ? [1, -1] : [1];
    const r: readonly [number, number, number] =
      typeof z.radius === 'number' ? [z.radius, z.radius, z.radius] : z.radius;
    for (const sx of passes) {
      const norm = weightAt(0, 0, 0, r, 'gauss');
      for (let v = 0; v < count; v++) {
        const w =
          (weightAt(m.p[v * 3] - z.at[0] * sx, m.p[v * 3 + 1] - z.at[1], m.p[v * 3 + 2] - z.at[2], r, 'gauss') / norm) *
          z.amount;
        if (w <= 0) continue;
        out[v * 3] += (z.color.r - out[v * 3]) * w;
        out[v * 3 + 1] += (z.color.g - out[v * 3 + 1]) * w;
        out[v * 3 + 2] += (z.color.b - out[v * 3 + 2]) * w;
      }
    }
  }
  return out;
}
