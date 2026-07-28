/**
 * Cabeza y cuello.
 *
 * Procedimiento: un elipsoide con la proporción del cráneo, deformado primero
 * por warps globales (el óvalo de la cara, el mentón, la nuca) y después por
 * brochas locales para cada rasgo. El orden importa — las brochas se aplican
 * sobre la silueta ya correcta, no al revés.
 *
 * Todas las coordenadas de esta función son LOCALES a la cabeza (origen en el
 * centro del cráneo); el `place()` final la lleva a su altura real.
 */

import { ellipsoid, place, warp, type MeshData } from '../character/geo';
import { relax, sculpt, type Brush } from './sculpt';
import { F } from './proportions';

const smoothstep = (t: number): number => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

export function buildHead(segments: number): MeshData {
  // Densidad alta: los rasgos son de 1-2 cm sobre una cabeza de 20; con pocos
  // anillos las brochas producen facetas en vez de párpados.
  const segU = Math.max(48, segments * 6);
  const segV = Math.max(36, segments * 4);
  let m = ellipsoid(F.headRx, F.headRy, F.headRz, segU, segV);

  // ---------------------------------------------------------------
  // 1. Silueta global
  // ---------------------------------------------------------------
  m = warp(m, (v) => {
    const y = v.y;

    // --- óvalo facial: estrechar de pómulo hacia abajo hasta el mentón ---
    // Un elipsoide sin esto da una cara redonda de bebé. El estrechamiento
    // progresivo es lo que produce la mandíbula fina de las referencias.
    if (y < 0.012) {
      const t = smoothstep((0.012 - y) / 0.10);
      v.x *= 1 - 0.40 * t;
      // la mandíbula también se recoge hacia atrás: el mentón no está tan
      // adelante como el arco cigomático
      if (v.z > 0) v.z *= 1 - 0.12 * t;
      if (v.z < 0) v.z *= 1 - 0.30 * t;
    }

    // --- cráneo: ligeramente más estrecho arriba, y nuca prominente ---
    if (y > 0.02) {
      const t = smoothstep((y - 0.02) / 0.08);
      v.x *= 1 - 0.10 * t;
      v.z *= 1 - 0.06 * t;
    }
    // la nuca sobresale hacia atrás por debajo de la coronilla
    if (v.z < 0) {
      const t = smoothstep((0.05 - Math.abs(y - 0.005)) / 0.05);
      v.z -= 0.008 * t;
    }

    // --- aplanar el frente de la cara ---
    // La zona entre las cejas y la boca es un plano, no un casquete. Sin esto
    // la cara "abomba" y ninguna brocha posterior la salva.
    if (v.z > 0.02 && y > -0.085 && y < 0.055) {
      const lateral = smoothstep((0.055 - Math.abs(v.x)) / 0.055);
      const vertical = smoothstep((0.07 - Math.abs(y - 0.005)) / 0.07);
      v.z -= 0.013 * lateral * vertical;
    }
  });

  // ---------------------------------------------------------------
  // 2. Rasgos
  // ---------------------------------------------------------------
  const eyeY = F.eyeY - F.headCenter; // ≈ -0.007
  const noseY = F.noseTipY - F.headCenter; // ≈ -0.037
  const mouthY = F.mouthY - F.headCenter; // ≈ -0.069
  const chinY = F.chinY - F.headCenter; // ≈ -0.098

  const brushes: Brush[] = [
    // --- frente y sienes ---
    // sien hundida: separa el cráneo de la cara y da el "hueco" que en las
    // referencias queda a la altura de la cola de la ceja
    { at: [0.058, 0.028, 0.038], radius: [0.028, 0.032, 0.034], strength: -0.0055, mirror: true },
    // frente ligeramente abombada, femenina (la masculina es más plana y con
    // reborde ciliar marcado)
    { at: [0, 0.045, 0.072], radius: [0.05, 0.035, 0.04], strength: 0.0035 },

    // --- cuenca ocular ---
    // Hundir la cuenca es lo que permite que el globo ocular se apoye dentro en
    // vez de quedar pegado sobre la cara como una canica.
    { at: [F.eyeX, eyeY + 0.002, 0.062], radius: [0.026, 0.019, 0.03], strength: -0.0118, mirror: true },
    // borde orbital superior (ceja) hacia fuera
    { at: [F.eyeX, eyeY + 0.019, 0.062], radius: [0.03, 0.012, 0.028], strength: 0.0042, mirror: true },
    // borde orbital inferior / hueso de la ojera
    { at: [F.eyeX + 0.002, eyeY - 0.017, 0.060], radius: [0.026, 0.011, 0.026], strength: 0.0028, mirror: true },
    // entrecejo: pequeño valle entre las cejas
    { at: [0, eyeY + 0.020, 0.078], radius: [0.014, 0.012, 0.02], strength: -0.0022 },

    // --- pómulos ---
    // alto y hacia fuera: el rasgo que más "adelgaza" una cara
    { at: [0.050, eyeY - 0.016, 0.050], radius: [0.026, 0.020, 0.032], strength: 0.0080, mirror: true },
    // hueco bajo el pómulo
    { at: [0.046, eyeY - 0.043, 0.048], radius: [0.024, 0.022, 0.030], strength: -0.0062, mirror: true },

    // --- nariz ---
    // puente: estrecho y recto, arrancando entre los ojos
    { at: [0, eyeY + 0.004, 0.074], radius: [0.010, 0.026, 0.022], strength: 0.0110 },
    // caballete y punta
    { at: [0, noseY + 0.008, 0.080], radius: [0.011, 0.018, 0.022], strength: 0.0185 },
    { at: [0, noseY, 0.082], radius: [0.0105, 0.010, 0.020], strength: 0.0250, falloff: 'smooth' },
    // punta ligeramente respingona: empuje hacia arriba, no hacia fuera
    { at: [0, noseY - 0.002, 0.088], radius: [0.010, 0.009, 0.016], strength: 0.0042, dir: [0, 1, 0.35], falloff: 'smooth' },
    // aletas
    { at: [0.0118, noseY - 0.006, 0.074], radius: [0.0085, 0.0085, 0.014], strength: 0.0088, mirror: true, falloff: 'smooth' },
    // surco bajo la aleta, que la separa de la mejilla
    { at: [0.019, noseY - 0.009, 0.070], radius: [0.008, 0.009, 0.012], strength: -0.0030, mirror: true, falloff: 'smooth' },
    // base de la nariz (tabique)
    { at: [0, noseY - 0.013, 0.076], radius: [0.009, 0.006, 0.014], strength: -0.0022, falloff: 'smooth' },

    // --- boca ---
    // montículo del labio superior + filtro
    { at: [0, mouthY + 0.006, 0.070], radius: [0.019, 0.008, 0.020], strength: 0.0092, falloff: 'smooth' },
    { at: [0, mouthY + 0.014, 0.072], radius: [0.006, 0.007, 0.014], strength: -0.0020, falloff: 'smooth' },
    // labio inferior, más lleno que el superior
    { at: [0, mouthY - 0.011, 0.070], radius: [0.017, 0.009, 0.020], strength: 0.0108, falloff: 'smooth' },
    // línea de los labios: surco fino entre ambos
    { at: [0, mouthY - 0.002, 0.074], radius: [0.020, 0.0028, 0.016], strength: -0.0052, falloff: 'smooth' },
    // comisuras hacia dentro
    { at: [0.0205, mouthY - 0.003, 0.062], radius: [0.008, 0.008, 0.014], strength: -0.0032, mirror: true, falloff: 'smooth' },
    // surco mentolabial bajo el labio
    { at: [0, mouthY - 0.020, 0.068], radius: [0.014, 0.007, 0.016], strength: -0.0030, falloff: 'smooth' },

    // --- mentón y mandíbula ---
    { at: [0, chinY + 0.010, 0.058], radius: [0.017, 0.016, 0.024], strength: 0.0092, falloff: 'smooth' },
    // ángulo mandibular: suave en una mujer joven, pero tiene que existir
    { at: [0.043, chinY + 0.026, 0.006], radius: [0.020, 0.024, 0.034], strength: 0.0030, mirror: true },
    // bajo la mandíbula, hacia dentro, para que el cuello no nazca de un bloque
    { at: [0.026, chinY + 0.004, 0.026], radius: [0.026, 0.014, 0.030], strength: -0.0038, mirror: true },

    // --- orejas ---
    // Quedan casi tapadas por el pelo; basta la silueta para que el perfil no
    // se vea pelado si el pelo se aparta.
    { at: [F.headRx * 0.98, 0.002, -0.012], radius: [0.010, 0.026, 0.020], strength: 0.0088, mirror: true, dir: [1, 0, 0] },
    { at: [F.headRx * 0.98, -0.004, -0.010], radius: [0.007, 0.014, 0.012], strength: -0.0038, mirror: true, dir: [1, 0, 0] },
  ];

  m = sculpt(m, brushes);
  // Dos pasadas suaves funden los solapes de brocha sin comerse los rasgos.
  m = relax(m, 1, 0.26);

  return place(m, 0, F.headCenter, 0);
}

/**
 * Cuello. Cónico, inclinado ligeramente hacia delante como el real, y con el
 * esternocleidomastoideo insinuado — es el detalle que evita el "cuello de
 * maniquí" en los planos de tres cuartos.
 */
export function buildNeck(segments: number): MeshData {
  const segU = Math.max(28, segments * 3);
  const rings = 14;
  const m: MeshData = { p: [], n: [], uv: [], i: [] };

  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const y = F.neckBottom + (F.neckTop + 0.028 - F.neckBottom) * t;
    // se ensancha abajo (trapecios) y arriba (base del cráneo)
    const flare = 1 + 0.40 * smoothstep((0.22 - t) / 0.22) + 0.22 * smoothstep((t - 0.78) / 0.22);
    for (let u = 0; u <= segU; u++) {
      const a = (u / segU) * Math.PI * 2;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      // sección ovalada: el cuello es más ancho que hondo
      let rx = F.neckRadius * flare;
      const rz = F.neckRadius * 0.86 * flare;
      // músculo del cuello: dos cordones hacia delante
      const sterno = Math.exp(-(((sin - 0.72) * 2.6) ** 2)) * Math.exp(-(((cos - 0.45) * 2.2) ** 2));
      rx += sterno * 0.0035 * (1 - t);

      const x = cos * rx;
      const z = sin * rz + 0.006 * t; // inclinación hacia delante
      m.p.push(x, y, z);
      m.n.push(0, 0, 0);
      m.uv.push(a * F.neckRadius, y);
    }
  }

  const stride = segU + 1;
  for (let r = 0; r < rings; r++) {
    for (let u = 0; u < segU; u++) {
      const a = r * stride + u;
      m.i.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
    }
  }
  return m;
}
