/**
 * Contenido de animación.
 *
 * Las poses se autorizan como **deltas euler locales en grados** sobre la pose
 * de bind. El rig está construido para que los ejes locales de cada hueso
 * signifiquen siempre lo mismo:
 *
 *   x  flexión   — positivo dobla el hueso hacia adelante (rodilla, columna)
 *   y  torsión   — giro sobre el eje del propio hueso
 *   z  lateral   — positivo inclina el hueso hacia la derecha del personaje
 *
 * Eso hace que un ciclo de marcha se lea como anatomía y no como sopa de
 * cuaterniones, y permite mezclar capas con un simple lerp de los arrays.
 *
 * REFERENCIA DE MARCHA — el buitre camina digitígrado y pesado: la rodilla
 * apenas se ve (queda dentro del pantalón de plumas), el corvejón hace casi todo
 * el trabajo visible, y la cabeza se estabiliza contra el balanceo del cuerpo
 * (la "cabeza de gallina"). Ese último detalle es el que vende al animal; sin él
 * el personaje camina como un humano disfrazado.
 */

import type { Poser } from './animator';

const TAU = Math.PI * 2;
const sin = Math.sin;
const cos = Math.cos;

/** Lóbulo positivo suave, para curvas de rodilla y corvejón. */
const lobe = (x: number, k = 1.4): number => {
  const s = sin(x);
  return s > 0 ? s ** k : 0;
};

/* ------------------------------------------------------------------ */
/* Base: posado                                                       */
/* ------------------------------------------------------------------ */

/** Posado en reposo: respiración, deriva de la cabeza, plumas asentándose. */
export function perch(P: Poser, ph: number): void {
  const t = ph * TAU;
  const breath = sin(t * 0.42);
  const sway = sin(t * 0.23 + 1.1);
  const micro = sin(t * 1.9 + 0.4) * 0.35 + sin(t * 3.1) * 0.18;

  P.hip(0.008 * sway, -0.004 + 0.005 * breath, 0);
  P.d('Hips', -1.0, 1.4 * sway, 1.1);
  P.d('Spine', 1.4 + 0.9 * breath, -0.9 * sway, -0.6);
  P.d('Spine1', 1.8 + 1.2 * breath, -0.7 * sway, -0.4);
  P.d('Spine2', 0.8 + 1.4 * breath, 1.0 * sway, 0.3);

  // El cuello acordeona un poco al respirar: el buitre en reposo hunde la cabeza.
  P.d('Neck', 3.0 - 1.6 * breath, 0.8 * sway, 0);
  P.d('Neck1', -4.5 - 1.2 * breath, 1.4 * sway + micro * 0.6, 0.4 * sway);
  P.d('Neck2', 5.0 + 1.0 * breath, 1.0 * micro, 0.3 * sway);
  P.d('Head', -2.0, 1.4 * micro, 0.5 * sway);

  // Alas plegadas, apretadas contra el costado.
  P.d('ClavicleR', -1.2 + 0.7 * breath, 0, 1.4);
  P.d('ClavicleL', -1.2 + 0.7 * breath, 0, -1.4);
  P.d('UpperArmR', -2.0, 3, 4);
  P.d('UpperArmL', -2.0, -3, -4);
  P.d('ForearmR', 3.0, 0, 2);
  P.d('ForearmL', 3.0, 0, -2);

  // Patas: peso repartido, corvejones cargados.
  P.d('UpLegR', -2.0, 1.5, -1.5);
  P.d('LegR', 6.0, 0, 0);
  P.d('AnkleR', -8.0, 0, 0);
  P.d('FootR', 3.0, -1.5, 0);
  P.d('UpLegL', 1.0, -1.5, 1.5);
  P.d('LegL', 5.0, 0, 0);
  P.d('AnkleL', -7.0, 0, 0);
  P.d('FootL', 2.5, 1.5, 0);

  P.d('Tail', 2.0 + 0.8 * breath, 0.8 * sway, 0);
  P.d('Tail1', 3.0, 0, 0.6 * sway);
}

/* ------------------------------------------------------------------ */
/* Locomoción                                                         */
/* ------------------------------------------------------------------ */

interface GaitKeys {
  thigh: number; thighBias: number; thighTwist: number; splay: number;
  kneeBase: number; knee: number;
  hockBase: number; hock: number;
  ankle: number; ankleBias: number; toe: number;
  sway: number; bob: number; bobBias: number;
  pelvisTilt: number; pelvisYaw: number; pelvisRoll: number;
  lean: number; spineYaw: number;
  /** Cuánto compensa el cuello el balanceo del cuerpo. 1 = cabeza casi fija. */
  headStab: number;
  wingTuck: number;
}

function gait(P: Poser, ph: number, k: GaitKeys): void {
  const t = ph * TAU;

  for (const side of [1, -1] as const) {
    const s = side > 0 ? 'R' : 'L';
    const o = side > 0 ? 0 : Math.PI; // las patas van medio ciclo desfasadas
    const a = t + o;

    // Fémur: adelante en vuelo, atrás en apoyo. Casi no se ve, pero mueve la cadera.
    const thigh = k.thigh * sin(a) + k.thighBias;
    // Rodilla: flexión máxima justo tras el despegue.
    const knee = k.kneeBase + k.knee * lobe(a - 0.5, 1.5);
    // Corvejón: contra-flexiona a la rodilla — es la articulación que se ve.
    const hock = -(k.hockBase + k.hock * lobe(a - 0.15, 1.3));
    // Tobillo/nudillo: empuje y luego dorsiflexión para librar el suelo.
    const ankle = k.ankle * sin(a - 1.8) + k.ankleBias;

    P.d(`UpLeg${s}`, thigh, side * k.thighTwist, side * k.splay);
    P.d(`Leg${s}`, knee, 0, 0);
    P.d(`Ankle${s}`, hock, 0, 0);
    P.d(`Foot${s}`, ankle, -side * 1.5, 0);
    P.d(`Toe${s}`, Math.max(0, -k.toe * sin(a - 2.5)), 0, 0);
  }

  // Pelvis: dos rebotes por zancada, rueda hacia la pata de apoyo.
  P.hip(k.sway * sin(t), k.bobBias + k.bob * cos(2 * t), 0);
  P.d('Hips', k.pelvisTilt, k.pelvisYaw * sin(t), k.pelvisRoll * sin(t + 1.2));
  P.d('Spine', k.lean * 0.35, -k.spineYaw * 0.45 * sin(t), -k.pelvisRoll * 0.35 * sin(t + 1.2));
  P.d('Spine1', k.lean * 0.35, -k.spineYaw * 0.75 * sin(t), 0);
  P.d('Spine2', k.lean * 0.30, -k.spineYaw * sin(t), 0);

  // Estabilización de cabeza: el cuello deshace lo que hizo el torso.
  const bodyRoll = k.pelvisRoll * sin(t + 1.2);
  const bodyYaw = k.pelvisYaw * sin(t);
  const bob = k.bob * cos(2 * t);
  P.d('Neck', -k.lean * 0.45 - bob * 220 * k.headStab, -bodyYaw * 0.5 * k.headStab, -bodyRoll * 0.4 * k.headStab);
  P.d('Neck1', bob * 300 * k.headStab, -bodyYaw * 0.7 * k.headStab, -bodyRoll * 0.5 * k.headStab);
  P.d('Neck2', -bob * 180 * k.headStab, -bodyYaw * 0.5 * k.headStab, -bodyRoll * 0.4 * k.headStab);
  P.d('Head', -k.lean * 0.25, -bodyYaw * 0.3 * k.headStab, -bodyRoll * 0.3 * k.headStab);

  // Alas: recogidas y rebotando con el torso, no balanceando como brazos.
  P.d('ClavicleR', -k.wingTuck * (1 + 0.3 * sin(t)), 0, 2.0);
  P.d('ClavicleL', -k.wingTuck * (1 - 0.3 * sin(t)), 0, -2.0);
  P.d('UpperArmR', -1.5, 4, 5);
  P.d('UpperArmL', -1.5, -4, -5);
  P.d('ForearmR', 4, 0, 3);
  P.d('ForearmL', 4, 0, -3);

  P.d('Tail', 4 + 2 * cos(2 * t), 2 * sin(t), 0);
  P.d('Tail1', 5, 0, 2 * sin(t + 0.5));
}

const STALK: GaitKeys = {
  thigh: 14, thighBias: -1, thighTwist: 2, splay: 2,
  kneeBase: 8, knee: 22,
  hockBase: 10, hock: 42,
  ankle: 14, ankleBias: 3, toe: 18,
  sway: 0.022, bob: 0.016, bobBias: -0.016,
  pelvisTilt: -1, pelvisYaw: 5.5, pelvisRoll: 5.0,
  lean: 3, spineYaw: 3.0, headStab: 1.0, wingTuck: 1.5,
};

const LOPE: GaitKeys = {
  thigh: 26, thighBias: 3, thighTwist: 2.5, splay: 3,
  kneeBase: 16, knee: 44,
  hockBase: 18, hock: 74,
  ankle: 22, ankleBias: 5, toe: 28,
  sway: 0.026, bob: 0.042, bobBias: -0.032,
  pelvisTilt: -5, pelvisYaw: 7, pelvisRoll: 6.5,
  lean: 15, spineYaw: 5.5, headStab: 0.55, wingTuck: 4,
};

/** Andar acechante: lento, pesado, cabeza casi inmóvil en el espacio. */
export function stalk(P: Poser, ph: number): void {
  gait(P, ph, STALK);
}

/** Trote con salto: el buitre no corre bonito, va a brincos con las alas medio abiertas. */
export function lope(P: Poser, ph: number): void {
  gait(P, ph, LOPE);
  const t = ph * TAU;
  // Las alas se despegan del cuerpo para equilibrar.
  const flap = 0.5 + 0.5 * sin(t * 2);
  P.d('UpperArmR', -8 * flap, 0, -14 * flap);
  P.d('UpperArmL', -8 * flap, 0, 14 * flap);
  P.d('ForearmR', -10 * flap, 0, -8 * flap);
  P.d('ForearmL', -10 * flap, 0, 8 * flap);
}

/* ------------------------------------------------------------------ */
/* Poses de estado                                                    */
/* ------------------------------------------------------------------ */

/**
 * Amenaza: alas medio abiertas, cuello extendido y bajo, pico adelantado.
 * Es la pose de lectura: si el jugador no entiende esta silueta a 40 m en
 * contraluz, el personaje está mal proporcionado, no mal iluminado.
 */
export function threat(P: Poser, ph: number): void {
  const t = ph * TAU;
  const tremble = sin(t * 5.5) * 0.6 + sin(t * 8.3) * 0.3;

  P.hip(0, -0.030, 0.03);
  P.d('Hips', 12, 0, 0);
  P.d('Spine', 10, 0, 0);
  P.d('Spine1', 8, 0, 0);
  P.d('Spine2', 4, 0, 0);

  // Cuello estirado y horizontal, cabeza por delante del pecho.
  P.d('Neck', 26, 0, 0);
  P.d('Neck1', 22 + tremble, 0, 0);
  P.d('Neck2', 14, 0, 0);
  P.d('Head', -18 + tremble * 0.5, 0, 0);

  // Las alas NO se abren aquí. La apertura es la capa aditiva
  // `wingSpreadAdd`, que el director rampa a 1 al entrar en amenaza. Duplicarla
  // aquí sumaba ~100 grados en el húmero y las alas salían disparadas por
  // encima de la cabeza. Una capa, un dueño.
  P.d('ClavicleR', -6, -3, 5);
  P.d('ClavicleL', -6, 3, -5);
  P.d('UpperArmR', -4 + tremble, 0, 0);
  P.d('UpperArmL', -4 + tremble, 0, 0);

  // Patas cargadas, listo para el salto. Los ángulos están limitados por que el
  // pie no atraviese el suelo: sin IK de apoyo, la pose ES el contrato con el
  // plano — ver "IK de apoyo" en docs/CHARACTER-PIPELINE.md.
  P.d('UpLegR', 9, 3, -4);
  P.d('LegR', 13, 0, 0);
  P.d('AnkleR', -19, 0, 0);
  P.d('FootR', 7, 0, 0);
  P.d('UpLegL', 8, -3, 4);
  P.d('LegL', 12, 0, 0);
  P.d('AnkleL', -18, 0, 0);
  P.d('FootL', 7, 0, 0);

  P.d('Tail', -8, 0, 0);
  P.d('Tail1', -10, 0, 0);
}

/** Alerta: cuerpo erguido, cuello vertical, cabeza alta escaneando. */
export function alert(P: Poser, ph: number): void {
  const t = ph * TAU;
  const scan = sin(t * 0.7);
  const twitch = sin(t * 4.1) * 0.4;

  P.hip(0, 0.045, -0.015);
  P.d('Hips', -6, 0, 0);
  P.d('Spine', -5, 0, 0);
  P.d('Spine1', -6, 0, 0);
  P.d('Spine2', -4, 2 * scan, 0);

  P.d('Neck', -12, 4 * scan, 0);
  P.d('Neck1', 10, 6 * scan, 0);
  P.d('Neck2', -8, 5 * scan, 0);
  P.d('Head', 4 + twitch, 10 * scan, 2 * scan);

  P.d('ClavicleR', -3, 0, 2);
  P.d('ClavicleL', -3, 0, -2);
  P.d('UpperArmR', -4, 2, 3);
  P.d('UpperArmL', -4, -2, -3);

  P.d('UpLegR', -6, 0, -1);
  P.d('LegR', -2, 0, 0);
  P.d('AnkleR', 2, 0, 0);
  P.d('UpLegL', -6, 0, 1);
  P.d('LegL', -2, 0, 0);
  P.d('AnkleL', 2, 0, 0);
}

/** Alimentándose: cabeza abajo, hombros arriba, cuerpo compacto. */
export function feed(P: Poser, ph: number): void {
  const t = ph * TAU;
  const tug = Math.max(0, sin(t * 1.4)) ** 3;

  P.hip(0, -0.09, 0.05);
  P.d('Hips', 22, 0, 0);
  P.d('Spine', 16, 0, 0);
  P.d('Spine1', 12, 0, 0);
  P.d('Spine2', 10, 0, 0);
  P.d('Neck', 44 - tug * 26, 0, 0);
  P.d('Neck1', 30 - tug * 20, 0, 0);
  P.d('Neck2', 26 - tug * 16, 0, 0);
  P.d('Head', 10 - tug * 30, 0, 0);

  P.d('ClavicleR', -8, 0, 6);
  P.d('ClavicleL', -8, 0, -6);
  P.d('UpLegR', 26, 0, -4);
  P.d('LegR', 26, 0, 0);
  P.d('AnkleR', -34, 0, 0);
  P.d('FootR', 14, 0, 0);
  P.d('UpLegL', 24, 0, 4);
  P.d('LegL', 24, 0, 0);
  P.d('AnkleL', -32, 0, 0);
  P.d('FootL', 13, 0, 0);
}

/* ------------------------------------------------------------------ */
/* Aditivos y one-shots                                               */
/* ------------------------------------------------------------------ */

/**
 * Apertura de alas aditiva, 0..1. Sirve de capa sobre cualquier base: un buitre
 * que abre las alas mientras camina sigue caminando.
 */
export function wingSpreadAdd(P: Poser, w: number): void {
  if (w <= 0) return;
  // REGLA DE ESPEJO — los ejes locales de un par R/L NO son simétricos: con la
  // misma pista de "up", los ejes Y y Z salen espejados y el X sale
  // anti-espejado. Por tanto una pose simétrica es: x IGUAL en ambos lados,
  // y/z CON SIGNO OPUESTO. Cualquier `P.d` de un par que no siga esto produce
  // un personaje asimétrico, y en el encuadre 'hero' no se ve — sólo en 'front'.
  P.d('ClavicleR', -10 * w, -6 * w, 14 * w);
  P.d('ClavicleL', -10 * w, 6 * w, -14 * w);
  P.d('UpperArmR', 4 * w, 0, -74 * w);
  P.d('UpperArmL', 4 * w, 0, 74 * w);
  P.d('ForearmR', 30 * w, 0, -58 * w);
  P.d('ForearmL', 30 * w, 0, 58 * w);
  P.d('HandR', 10 * w, 0, -22 * w);
  P.d('HandL', 10 * w, 0, 22 * w);
  P.d('Spine2', -4 * w, 0, 0);
}

/** Sacudida de plumas: impulso rápido y asentamiento elástico. `t` en segundos. */
export function ruffleAdd(P: Poser, t: number, strength = 1): void {
  if (t > 0.9) return;
  const e = Math.exp(-t * 4.5);
  const osc = sin(t * 34);
  const k = strength * e;
  P.d('Spine1', 3 * k * osc, 2 * k * osc, 0);
  P.d('Spine2', 4 * k * osc, -3 * k * osc, 0);
  P.d('Neck', -3 * k * osc, 0, 2 * k * osc);
  P.d('Neck1', 4 * k * osc, 0, -3 * k * osc);
  P.d('Head', -5 * k * osc, 6 * k * osc, 0);
  P.d('ClavicleR', -8 * k * Math.abs(osc), 0, 6 * k);
  P.d('ClavicleL', -8 * k * Math.abs(osc), 0, -6 * k);
  P.d('UpperArmR', -10 * k * Math.abs(osc), 0, -8 * k);
  P.d('UpperArmL', -10 * k * Math.abs(osc), 0, 8 * k);
  P.d('Tail', 6 * k * Math.abs(osc), 3 * k * osc, 0);
}

/** Reacción a impacto por región; `t` en segundos desde el golpe, dura 0.5 s. */
export function hitAdd(P: Poser, region: 'head' | 'torso' | 'wingR' | 'wingL' | 'legR' | 'legL', t: number, side = 0, strength = 1): void {
  if (t > 0.55) return;
  const e = Math.exp(-t * 7) * Math.min(1, t * 24);
  const k = strength * e;
  const s = side >= 0 ? 1 : -1;
  switch (region) {
    case 'head':
      P.d('Neck2', -14 * k, 9 * k * s, 5 * k * s);
      P.d('Head', -22 * k, 15 * k * s, 8 * k * s);
      P.d('Neck1', -8 * k, 5 * k * s, 0);
      break;
    case 'torso':
      P.d('Spine', -6 * k, 3 * k * s, 2 * k * s);
      P.d('Spine1', -10 * k, 5 * k * s, 3 * k * s);
      P.d('Spine2', -12 * k, 6 * k * s, 4 * k * s);
      P.d('Neck', 8 * k, -4 * k * s, 0);
      P.hip(-0.02 * k * s, -0.02 * k, -0.03 * k);
      break;
    case 'wingR':
      P.d('ClavicleR', -16 * k, 6 * k, 12 * k);
      P.d('UpperArmR', -26 * k, 0, -18 * k);
      P.d('ForearmR', 18 * k, 0, -10 * k);
      break;
    case 'wingL':
      P.d('ClavicleL', -16 * k, -6 * k, -12 * k);
      P.d('UpperArmL', -26 * k, 0, 18 * k);
      P.d('ForearmL', 18 * k, 0, 10 * k);
      break;
    case 'legR':
      P.d('UpLegR', 16 * k, 0, -8 * k);
      P.d('LegR', 24 * k, 0, 0);
      P.d('AnkleR', -34 * k, 0, 0);
      P.hip(0, -0.05 * k, 0);
      break;
    case 'legL':
      P.d('UpLegL', 16 * k, 0, 8 * k);
      P.d('LegL', 24 * k, 0, 0);
      P.d('AnkleL', -34 * k, 0, 0);
      P.hip(0, -0.05 * k, 0);
      break;
  }
}

/** Bases de locomoción/estado disponibles para el árbol de mezcla. */
export const CLIPS = { perch, stalk, lope, threat, alert, feed } as const;
export type ClipName = keyof typeof CLIPS;
