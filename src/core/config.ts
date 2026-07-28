/**
 * Configuración y presets de calidad.
 *
 * Un preset es un contrato de presupuesto, no una sugerencia. Si tu subsistema
 * necesita más triángulos/luces/texels de los que el preset activo concede,
 * la respuesta es bajar el detalle, no subir el presupuesto.
 */

export const FIXED_HZ = 120;
export const FIXED_DT = 1 / FIXED_HZ;
/** Tope de subpasos por frame: por encima se tira el backlog en vez de espiralar. */
export const MAX_SUBSTEPS = 8;

export interface QualityPreset {
  name: 'low' | 'medium' | 'high';
  /** Device pixel ratio máximo. */
  maxDpr: number;
  shadowMapSize: number;
  /** Segmentos radiales de los lofts del personaje. Gobierna el conteo de vértices. */
  limbSegments: number;
  /** Resolución de las texturas procedurales (px por lado). */
  textureSize: number;
  /** Número de plumas de contorno instanciadas por ala. */
  featherCount: number;
  softShadows: boolean;
}

export const PRESETS: Record<QualityPreset['name'], QualityPreset> = {
  low: {
    name: 'low',
    maxDpr: 1,
    shadowMapSize: 1024,
    limbSegments: 8,
    textureSize: 256,
    featherCount: 7,
    softShadows: false,
  },
  medium: {
    name: 'medium',
    maxDpr: 1.5,
    shadowMapSize: 2048,
    limbSegments: 12,
    textureSize: 512,
    featherCount: 11,
    softShadows: true,
  },
  high: {
    name: 'high',
    maxDpr: 2,
    shadowMapSize: 2048,
    limbSegments: 16,
    // 512, no 1024. Los bakes son JS puro y 1024² x 4 mapas costaba ~4 s de
    // arranque; a la densidad de tile que usa el personaje (0.12-0.30 m) 512
    // ya da ~1.7 mm/texel, por debajo de lo que la malla puede mostrar.
    textureSize: 512,
    featherCount: 15,
    softShadows: true,
  },
};

export interface Config {
  fov: number;
  /** Fija la semilla y desactiva cualquier fuente de no-determinismo. */
  deterministic: boolean;
  seed: number;
  q: QualityPreset;
}

/**
 * Detección de preset. Deliberadamente burda: adivinar la GPU es poco fiable, y
 * un preset equivocado es más barato de corregir a mano (`?q=high`) que de
 * inferir mal en cada arranque.
 */
export function detectQuality(): QualityPreset['name'] {
  const forced = new URLSearchParams(location.search).get('q');
  if (forced === 'low' || forced === 'medium' || forced === 'high') return forced;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (mobile) return 'low';
  const cores = navigator.hardwareConcurrency ?? 4;
  return cores >= 8 ? 'high' : 'medium';
}

export function createConfig(overrides: Partial<Config> = {}): Config {
  const params = new URLSearchParams(location.search);
  const deterministic = params.has('deterministic') || params.has('capture');
  const seedParam = params.get('seed');
  return {
    fov: 42,
    deterministic,
    seed: seedParam ? Number(seedParam) >>> 0 : 0x5eed1234,
    q: PRESETS[detectQuality()],
    ...overrides,
  };
}
