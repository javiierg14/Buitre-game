/**
 * Medidas canónicas de la figura, en metros.
 *
 * Un único sitio con los números. Todo lo demás — cabeza, cuerpo, pelo, ropa —
 * los lee de aquí, así que cambiar la estatura o el largo del pelo no obliga a
 * perseguir constantes por seis archivos.
 *
 * Referencia: mujer joven delgada de 1.70 m, ~7.4 cabezas. Las alturas son
 * absolutas desde el suelo (y=0).
 */
export const F = {
  height: 1.70,

  /** --- cabeza --- */
  headCenter: 1.585,
  headRx: 0.0715, // media anchura (sienes)
  headRy: 0.098, // media altura (coronilla a mandíbula)
  headRz: 0.091, // media profundidad: el cráneo es más hondo que ancho
  chinY: 1.487,
  eyeY: 1.578,
  eyeX: 0.0335, // separación de la pupila al eje
  eyeZ: 0.070, // cuánto sobresale el globo hacia delante
  eyeRadius: 0.0136,
  noseTipZ: 0.098,
  noseTipY: 1.548,
  mouthY: 1.516,

  /** --- cuello y tronco --- */
  neckTop: 1.500,
  neckBottom: 1.415,
  neckRadius: 0.0425,
  shoulderY: 1.395,
  shoulderX: 0.178, // media anchura de hombros
  bustY: 1.245,
  bustRx: 0.135,
  bustRz: 0.098,
  waistY: 1.055,
  waistRx: 0.107,
  waistRz: 0.082,
  hipY: 0.925,
  hipRx: 0.152,
  hipRz: 0.105,
  crotchY: 0.815,

  /** --- brazos --- */
  upperArmR: 0.0425,
  elbowY: 1.075,
  wristY: 0.845,
  handLength: 0.175,

  /** --- piernas --- */
  thighR: 0.078,
  kneeY: 0.455,
  ankleY: 0.075,
  footLength: 0.235,

  /** --- pelo --- */
  hairLength: 0.62, // hasta la cintura, como en las referencias
  hairStrands: 860,
} as const;

/** Paleta del personaje, tomada de las referencias. */
export const PALETTE = {
  /** Piel muy clara de pelirroja, con subtono rosado. */
  skin: '#f2d9cb',
  skinShadow: '#d9a894',
  blush: '#e8a894',
  freckle: '#b9764f',
  lip: '#c8757a',
  /** Cobre. El pelo lleva variación por mechón alrededor de este tono. */
  hair: '#93400f',
  hairLight: '#c06d24',
  hairDark: '#4a1e08',
  /** Iris azul verdoso con anillo limbal oscuro. */
  iris: '#7d9fa8',
  irisInner: '#c9b98a',
  limbal: '#2c3a44',
  sclera: '#f4f1ee',
  brow: '#a3572a',
  /** Ropa de las referencias. */
  top: '#f4f1ea',
  skirt: '#a8ddc4',
  dress: '#17181b',
} as const;
