/**
 * Materiales procedurales.
 *
 * Todo se hornea en el arranque a partir del mismo generador de ruido que
 * deforma la geometría — no hay ni un solo archivo de imagen en el proyecto, y
 * eso no es una restricción estética sino de flujo: un asset externo hace que el
 * personaje deje de ser reproducible desde una semilla.
 *
 * Cada conjunto entrega albedo + rugosidad + normal. La regla de calidad que se
 * hereda del repo de referencia es literal: **ninguna superficie plana**. Si un
 * material no tiene variación de albedo, variación de rugosidad y un mapa de
 * normal con detalle visible a medio metro, no está terminado.
 */

import * as THREE from 'three';
import { Noise } from './geo';
import type { MaterialName } from './parts';

export interface Sample {
  /** Albedo lineal 0..1. */
  r: number;
  g: number;
  b: number;
  /** Rugosidad 0..1. */
  rough: number;
  /** Altura para derivar la normal, en unidades arbitrarias coherentes. */
  h: number;
}

interface Baked {
  map: THREE.Texture;
  roughnessMap: THREE.Texture;
  normalMap: THREE.Texture;
}

/**
 * Hornea un conjunto de mapas muestreando `fn` sobre el tile.
 * La normal sale de un Sobel sobre la altura: derivarla del mismo campo que se
 * ve en el albedo es lo que hace que el relieve y el color coincidan.
 */
function bake(size: number, strength: number, fn: (u: number, v: number) => Sample): Baked {
  const albedo = new Uint8ClampedArray(size * size * 4);
  const rough = new Uint8ClampedArray(size * size * 4);
  const height = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = fn(x / size, y / size);
      const i = (y * size + x) * 4;
      albedo[i] = s.r * 255;
      albedo[i + 1] = s.g * 255;
      albedo[i + 2] = s.b * 255;
      albedo[i + 3] = 255;
      const rv = s.rough * 255;
      rough[i] = rv;
      rough[i + 1] = rv;
      rough[i + 2] = rv;
      rough[i + 3] = 255;
      height[y * size + x] = s.h;
    }
  }

  const normal = new Uint8ClampedArray(size * size * 4);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength;
      let ny = -dy * strength;
      const nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      const i = (y * size + x) * 4;
      normal[i] = (nx * 0.5 + 0.5) * 255;
      normal[i + 1] = (ny * 0.5 + 0.5) * 255;
      normal[i + 2] = (nz / l * 0.5 + 0.5) * 255;
      normal[i + 3] = 255;
    }
  }

  return {
    map: makeTexture(albedo, size, THREE.SRGBColorSpace),
    roughnessMap: makeTexture(rough, size, THREE.NoColorSpace),
    normalMap: makeTexture(normal, size, THREE.NoColorSpace),
  };
}

function makeTexture(data: Uint8ClampedArray, size: number, colorSpace: THREE.ColorSpace): THREE.Texture {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = colorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Recetas                                                            */
/* ------------------------------------------------------------------ */

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Plumaje: pardo hollín casi negro, con el estriado de las barbas cruzando la
 * pluma y las puntas desgastadas más claras. El albedo se mantiene en 0.03-0.10
 * lineal: un negro de plumaje real es oscurísimo, y cuando se sube "para que se
 * vea" es cuando el personaje se convierte en plastilina.
 */
function featherSample(n: Noise) {
  // Rejilla de plumas de contorno: 6 filas x 5 columnas por tile de 0.30 m son
  // plumas de ~5x6 cm, que es el tamaño real de una pluma de manto. Las filas
  // van a tresbolillo porque las plumas se solapan en ladrillo, no en cuadrícula.
  const ROWS = 6;
  const COLS = 5;

  return (u: number, v: number): Sample => {
    // Deformación del retículo: sin esto la rejilla se ve COMO una rejilla.
    const jitterU = n.fbm(u * 5, v * 5, 88.1, 3) * 0.10;
    const jitterV = n.fbm(u * 5, v * 5, 55.4, 3) * 0.07;

    const ry = (v + jitterV) * ROWS;
    const ri = Math.floor(ry);
    const rf = ry - ri;
    const rx = (u + jitterU) * COLS + (ri & 1) * 0.5;
    const cf = rx - Math.floor(rx);

    // `edge` = 0 en el contorno de la pluma, 1 en su centro. El borde inferior
    // (rf pequeño) es el que queda por debajo de la fila siguiente y se oscurece.
    const edge = Math.min(rf, Math.min(cf, 1 - cf) * 2.2);
    const body = 1 - Math.exp(-edge * 8);

    // Barbas: estrías finas que corren a lo largo de la pluma, dentro de cada una.
    const barb = Math.sin((rx + n.n3(u * 9, v * 9, 3.3) * 0.12) * Math.PI * 2 * 7) * 0.5 + 0.5;
    const macro = n.fbm(u * 2.5, v * 2.5, 11.5, 4) * 0.5 + 0.5;
    // Desgaste: las puntas descoloridas de las plumas viejas.
    const wear = Math.max(0, n.fbm(u * 6, v * 6, 31.2, 3)) ** 2 * (1 - body);

    const base = lerp(0.030, 0.058, macro);
    const l = (base + barb * 0.009) * (0.55 + 0.45 * body) + wear * 0.045;
    return {
      r: l * 1.10,
      g: l * 0.97,
      b: l * 0.88,
      rough: lerp(0.95, 0.74, body * 0.6 + wear * 0.4),
      // La altura la manda el solape, no las barbas: es el escalón entre plumas
      // el que produce la sombra que hace que el plumaje tenga volumen.
      h: body * 1.6 + barb * 0.18 + macro * 0.35,
    };
  };
}

/** Plumón de la gola: crema sucio, granulado, sin estriado direccional. */
function downSample(n: Noise) {
  return (u: number, v: number): Sample => {
    const fluff = n.fbm(u * 16, v * 16, 3.7, 5) * 0.5 + 0.5;
    const grime = Math.max(0, n.fbm(u * 5, v * 5, 19.4, 3));
    const l = lerp(0.34, 0.56, fluff) - grime * 0.16;
    return {
      r: l * 1.04,
      g: l * 0.99,
      b: l * 0.86,
      rough: lerp(0.98, 0.90, fluff),
      h: fluff * 1.6,
    };
  };
}

/**
 * Piel desnuda de cabeza y cuello: rosácea grisácea, arrugada, con manchas
 * pizarrosas. La componente azulada de las manchas es lo que impide que lea como
 * carne cruda.
 */
function skinSample(n: Noise) {
  return (u: number, v: number): Sample => {
    const wrinkle = n.fbm(u * 22, v * 22, 5.1, 4);
    const creases = Math.abs(n.fbm(u * 9, v * 9, 41.0, 3));
    const blotch = n.fbm(u * 3.5, v * 3.5, 61.3, 3) * 0.5 + 0.5;
    // 0.09-0.19, no 0.14-0.27: a exposición 1.55 el rango alto convertía la
    // cabeza calva en un casco blanco plano que se comía la silueta.
    const l = lerp(0.09, 0.19, blotch) - creases * 0.04;
    return {
      r: l * 1.18,
      g: l * 0.92,
      b: l * (0.80 + blotch * 0.22),
      rough: lerp(0.62, 0.86, creases * 0.7 + 0.3),
      h: wrinkle * 1.2 - creases * 1.8,
    };
  };
}

/** Queratina de pico, tarso y garras: amarillo hueso con bandas de escama. */
function hornSample(n: Noise) {
  return (u: number, v: number): Sample => {
    const scale = Math.sin(v * Math.PI * 2 * 22 + n.fbm(u * 6, v * 6, 7.7, 2) * 2) * 0.5 + 0.5;
    const stain = n.fbm(u * 4, v * 4, 71.9, 4) * 0.5 + 0.5;
    const chip = Math.max(0, n.fbm(u * 18, v * 18, 13.1, 3)) ** 3;
    const l = lerp(0.16, 0.42, stain) - scale * 0.05;
    return {
      r: l * 1.14,
      g: l * 1.06,
      b: l * 0.72,
      rough: lerp(0.30, 0.66, scale) + chip * 0.25,
      h: scale * 0.7 + stain * 0.5 - chip * 1.2,
    };
  };
}

/* ------------------------------------------------------------------ */

export interface CharacterMaterials {
  list: THREE.Material[];
  dispose(): void;
}

/**
 * Multiplicador de rugosidad por conjunto, sobre el mapa horneado, para que la
 * variación *relativa* del bake se conserve. A 25 m lo único que separa el
 * plumón del plumaje es el ancho del lóbulo especular.
 */
const ROUGH_SCALE: Record<MaterialName, number> = {
  feather: 1.0,
  down: 1.0,
  skin: 0.92,
  horn: 0.78,
  eye: 1.0,
};

/**
 * Construye los materiales en el orden de `MATERIAL_ORDER`. El índice del array
 * ES el índice de grupo de la geometría: no reordenar sin tocar `build.ts`.
 */
export function createMaterials(seed: number, textureSize: number): CharacterMaterials {
  // Un stream de ruido por material: cambiar el detalle de uno no desplaza el
  // grano de los demás, así una baseline visual sólo se mueve donde tocaste.
  const mk = (salt: number) => new Noise(mulberry32(seed ^ salt));

  const feather = bake(textureSize, 2.2, featherSample(mk(0x11)));
  const down = bake(textureSize, 1.6, downSample(mk(0x22)));
  const skin = bake(textureSize, 2.6, skinSample(mk(0x33)));
  const horn = bake(textureSize, 2.0, hornSample(mk(0x44)));

  const materials: THREE.Material[] = [
    new THREE.MeshStandardMaterial({
      name: 'feather',
      ...feather,
      roughness: ROUGH_SCALE.feather,
      metalness: 0,
      side: THREE.DoubleSide, // las rémiges y timoneras son láminas sin grosor
      normalScale: new THREE.Vector2(1, 1),
    }),
    new THREE.MeshStandardMaterial({
      name: 'down',
      ...down,
      roughness: ROUGH_SCALE.down,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
    new THREE.MeshStandardMaterial({
      name: 'skin',
      ...skin,
      roughness: ROUGH_SCALE.skin,
      metalness: 0,
    }),
    new THREE.MeshStandardMaterial({
      name: 'horn',
      ...horn,
      roughness: ROUGH_SCALE.horn,
      metalness: 0,
    }),
    new THREE.MeshStandardMaterial({
      name: 'eye',
      color: new THREE.Color(0x1a1206),
      roughness: 0.12,
      metalness: 0,
      // Un punto especular apretado es lo único que hace que el ojo esté vivo.
      envMapIntensity: 2.5,
    }),
  ];

  return {
    list: materials,
    dispose(): void {
      for (const b of [feather, down, skin, horn]) {
        b.map.dispose();
        b.roughnessMap.dispose();
        b.normalMap.dispose();
      }
      for (const m of materials) m.dispose();
    },
  };
}

/** PRNG pequeño para sembrar el ruido; no es de gameplay, no necesita el Rng. */
function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
