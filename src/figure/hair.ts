/**
 * Pelo: melena cobriza larga y ondulada.
 *
 * Es el rasgo que identifica al personaje, así que va por mechones reales —
 * tubos a lo largo de curvas — y no por planos con textura. A esta escala el
 * coste es asumible y la silueta ondulada es imposible de fingir con cards.
 *
 * La forma sale de tres reglas:
 *   1. un ENVOLVENTE de volumen por altura: el pelo no cae pegado, se abre a la
 *      altura del pecho y ahí es donde vive el volumen de las referencias;
 *   2. una ONDA por mechón, con fase y frecuencia propias;
 *   3. una DERIVA lateral de los mechones frontales, que es lo que hace que la
 *      melena enmarque la cara en vez de taparla.
 */

import * as THREE from 'three';
import { appendMesh, emptyMesh, tube, vcount, type MeshData } from '../character/geo';
import { F, PALETTE } from './proportions';

const smoothstep = (t: number): number => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

/**
 * Radio de la melena en función de la altura. Los puntos de control son la
 * silueta vista de frente: pegada en la coronilla, abierta desde los hombros.
 */
const ENVELOPE: readonly (readonly [number, number])[] = [
  [1.665, 0.055],
  [1.600, 0.082],
  [1.520, 0.098],
  [1.430, 0.108],
  [1.330, 0.128],
  [1.220, 0.145],
  [1.100, 0.152],
  [0.980, 0.146],
  [0.880, 0.132],
];

function envelope(y: number): number {
  if (y >= ENVELOPE[0][0]) return ENVELOPE[0][1];
  for (let k = 1; k < ENVELOPE.length; k++) {
    if (y >= ENVELOPE[k][0]) {
      const [y0, r0] = ENVELOPE[k - 1];
      const [y1, r1] = ENVELOPE[k];
      const t = (y - y1) / (y0 - y1);
      return r1 + (r0 - r1) * t;
    }
  }
  return ENVELOPE[ENVELOPE.length - 1][1];
}

export interface HairResult {
  mesh: MeshData;
  colors: Float32Array;
}

/**
 * Genera la melena. `rand` viene del RNG sembrado del motor, así que la misma
 * semilla da exactamente el mismo pelo — condición para que las capturas de
 * referencia signifiquen algo.
 */
export function buildHair(rand: () => number, strandCount: number = F.hairStrands): HairResult {
  const mesh = emptyMesh();
  const colorRanges: { from: number; to: number; color: THREE.Color }[] = [];

  const dark = new THREE.Color(PALETTE.hairDark);
  const mid = new THREE.Color(PALETTE.hair);
  const light = new THREE.Color(PALETTE.hairLight);

  const STEPS = 26;

  // --- mechones madre ---
  // El pelo real no cae en hebras independientes: se agrupa en mechones que
  // comparten dirección y onda. Sin esta capa la melena se lee como espagueti,
  // por muchas hebras que se tiren.
  const CLUMPS = 46;
  const clumps = Array.from({ length: CLUMPS }, () => ({
    azimuth: rand() * Math.PI * 2,
    polar: Math.acos(1 - rand() * 1.02),
    phase: rand() * Math.PI * 2,
    freq: 11 + rand() * 9,
    amp: 0.012 + rand() * 0.013,
    puff: 0.84 + rand() * 0.36,
    lengthScale: 0.74 + rand() * 0.42,
    shade: rand(),
  }));

  for (let s = 0; s < strandCount; s++) {
    const clump = clumps[s % CLUMPS];

    // --- raíz sobre el cuero cabelludo ---
    // Dispersión alrededor de la raíz del mechón madre, no por todo el cráneo.
    const azimuth = clump.azimuth + (rand() - 0.5) * 0.62;
    const polar = Math.max(0, clump.polar + (rand() - 0.5) * 0.34);
    const front = Math.cos(azimuth); // +1 = frente, -1 = nuca

    // línea de nacimiento: alta en la frente, baja en la nuca
    const hairlinePolar = 1.02 + 0.42 * (1 - front) * 0.5;
    if (polar > hairlinePolar) continue;

    const sinP = Math.sin(polar);
    const rootDir = new THREE.Vector3(Math.sin(azimuth) * sinP, Math.cos(polar), Math.cos(azimuth) * sinP);
    const root = new THREE.Vector3(
      rootDir.x * (F.headRx + 0.004),
      F.headCenter + rootDir.y * (F.headRy + 0.004),
      rootDir.z * (F.headRz + 0.004),
    );

    // --- carácter del mechón ---
    // Hereda del mechón madre con una desviación pequeña: eso es lo que hace
    // que las hebras vecinas viajen juntas y formen un bucle legible.
    const frontness = smoothstep((front - 0.25) / 0.75); // 1 = mechón de la cara
    // las capas que enmarcan la cara son más cortas; el resto llega a la cintura
    const length = F.hairLength * (1 - 0.42 * frontness) * clump.lengthScale * (0.92 + rand() * 0.16);
    const phase = clump.phase + (rand() - 0.5) * 0.5;
    const freq = clump.freq * (0.94 + rand() * 0.12); // ondas por metro de mechón
    const amp = clump.amp * (0.85 + rand() * 0.3);
    const puff = clump.puff * (0.95 + rand() * 0.1);

    // raya ligeramente descentrada: decide a qué lado se va cada mechón frontal
    const partSide = root.x > -0.008 ? 1 : -1;
    const drift = partSide * (0.55 + rand() * 0.5) * frontness;

    const rootRadius = Math.hypot(root.x, root.z);
    const path: THREE.Vector3[] = [];
    let prevAngle = azimuth;

    for (let k = 0; k <= STEPS; k++) {
      const t = k / STEPS;
      // caída: lenta al principio (el mechón recorre el cráneo), luego vertical
      const fall = t * t * (3 - 2 * t) * 0.82 + t * 0.18;
      const y = root.y - length * fall;

      // radio: del nacimiento al envolvente, más onda
      const target = envelope(y) * puff;
      const wave = Math.sin(t * length * freq + phase) * amp * smoothstep(t / 0.30);
      const r = rootRadius + (target - rootRadius) * smoothstep(t / 0.46) + wave * 0.55;

      // azimut: deriva lateral de los mechones frontales + serpenteo
      let a =
        azimuth +
        drift * smoothstep(t / 0.55) +
        (Math.cos(t * length * freq + phase) * amp * 1.35 * smoothstep(t / 0.30)) / Math.max(0.06, r);

      // --- ventana de la cara ---
      // El envolvente es un cilindro alrededor del cráneo, así que sin esta
      // restricción los mechones frontales caen POR DELANTE del rostro y lo
      // tapan entero. Aquí se abre un hueco angular a la altura de la cara y se
      // empujan los mechones a su borde: es lo que produce el pelo que enmarca.
      {
        // Se desvanece por ARRIBA y por ABAJO. Un corte duro en cualquiera de
        // los dos extremos hace saltar el azimut entre dos pasos consecutivos, y
        // el tubo une esos dos puntos con un segmento que cruza la cara.
        const fadeTop = smoothstep((F.headCenter + 0.045 - y) / 0.05);
        const fadeBottom = smoothstep((y - (F.chinY - 0.30)) / 0.14);
        const half = 0.92 * fadeTop * fadeBottom;
        if (half > 0) {
          const signed = Math.atan2(Math.sin(a), Math.cos(a));
          if (Math.abs(signed) < half) {
            const side = signed >= 0 ? 1 : -1;
            a += side * half - signed;
          }
        }
      }

      // Tope al giro por paso. Cualquier discontinuidad que se escape de las
      // reglas de arriba queda acotada aquí en vez de convertirse en un palo.
      if (path.length > 0) {
        const prev = prevAngle;
        let delta = a - prev;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        a = prev + Math.max(-0.22, Math.min(0.22, delta));
      }
      prevAngle = a;
      path.push(new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r));
    }

    // El mechón nace exactamente en el cuero cabelludo: sin esto se ve el hueco.
    path[0].copy(root);

    const thickness = 0.0009 + rand() * 0.0013;
    const strand = tube(
      path,
      (t) => thickness * (1 - smoothstep((t - 0.55) / 0.45) * 0.88),
      { radial: 5, capStart: true },
    );

    const from = vcount(mesh);
    appendMesh(mesh, strand);
    const to = vcount(mesh);

    // color por mechón: la mezcla de tonos es lo que impide que una melena
    // procedural se vea como un casco de plástico
    const shade = clump.shade * 0.75 + rand() * 0.25;
    const color = shade < 0.34 ? dark.clone().lerp(mid, rand()) : mid.clone().lerp(light, rand() * (shade > 0.82 ? 1 : 0.45));
    colorRanges.push({ from, to, color });
  }

  // --- casquete de cuero cabelludo ---
  // Tapa el hueco entre raíces. Va oscuro: es sombra, no piel.
  const cap = buildScalpCap();
  const capFrom = vcount(mesh);
  appendMesh(mesh, cap);
  colorRanges.push({ from: capFrom, to: vcount(mesh), color: dark.clone().multiplyScalar(0.16) });

  const colors = new Float32Array(vcount(mesh) * 3);
  for (const range of colorRanges) {
    for (let v = range.from; v < range.to; v++) {
      colors[v * 3] = range.color.r;
      colors[v * 3 + 1] = range.color.g;
      colors[v * 3 + 2] = range.color.b;
    }
  }

  return { mesh, colors };
}

/** Casquete que cubre el cráneo bajo las raíces. */
function buildScalpCap(): MeshData {
  const m = emptyMesh();
  const segU = 40;
  const segV = 20;
  const maxPolar = 0.82;

  for (let v = 0; v <= segV; v++) {
    const polar = (v / segV) * maxPolar;
    const sinP = Math.sin(polar);
    for (let u = 0; u <= segU; u++) {
      const a = (u / segU) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.sin(a) * sinP, Math.cos(polar), Math.cos(a) * sinP);
      // ligeramente por encima del cráneo: el pelo tiene grosor
      m.p.push(
        dir.x * (F.headRx + 0.0015),
        F.headCenter + dir.y * (F.headRy + 0.0015),
        dir.z * (F.headRz + 0.0015),
      );
      m.n.push(dir.x, dir.y, dir.z);
      m.uv.push(a * 0.02, polar * 0.02);
    }
  }
  const stride = segU + 1;
  for (let v = 0; v < segV; v++) {
    for (let u = 0; u < segU; u++) {
      const a = v * stride + u;
      m.i.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
    }
  }
  return m;
}

/**
 * Material del pelo. `anisotropy` es lo que produce la banda de brillo que
 * recorre la melena perpendicular a los mechones; sin ella el pelo se ve mate y
 * plano por muy bien que esté la geometría.
 */
export function createHairMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.46,
    metalness: 0,
    anisotropy: 0.85,
    anisotropyRotation: Math.PI / 2,
    sheen: 0.35,
    sheenRoughness: 0.4,
    sheenColor: new THREE.Color('#ffb066'),
    clearcoat: 0.12,
    clearcoatRoughness: 0.35,
    envMapIntensity: 0.6,
    side: THREE.DoubleSide,
  });
}
