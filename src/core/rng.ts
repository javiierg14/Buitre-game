/**
 * PRNG determinista (xoshiro128**).
 *
 * REGLA DURA: nada visual ni de gameplay usa `Math.random()`. Toda la
 * aleatoriedad pasa por aquí para que una captura con la misma semilla produzca
 * el mismo frame — es lo único que hace que las baselines de regresión visual
 * signifiquen algo.
 */
export class Rng {
  private s0 = 0;
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;
  private spare: number | undefined;

  constructor(seed = 0x9e3779b9) {
    this.seed(seed);
  }

  seed(s: number): this {
    // SplitMix32 reparte una semilla de 32 bits sobre las cuatro palabras.
    let z = s >>> 0;
    const next = () => {
      z = (z + 0x9e3779b9) >>> 0;
      let x = z;
      x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
      x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
      return (x ^ (x >>> 15)) >>> 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
    this.spare = undefined;
    return this;
  }

  u32(): number {
    const rot = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;
    const result = Math.imul(rot(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rot(this.s3, 11);
    return result;
  }

  /** Uniforme [0,1). */
  float(): number {
    return this.u32() / 4294967296;
  }

  /** Uniforme [min,max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.float();
  }

  /** Entero uniforme [min,max]. */
  int(min: number, max: number): number {
    return min + (this.u32() % (max - min + 1));
  }

  /** Uniforme [-1,1]. */
  signed(): number {
    return this.float() * 2 - 1;
  }

  /** Normal estándar (Box–Muller; se cachea la segunda muestra del par). */
  gauss(): number {
    if (this.spare !== undefined) {
      const v = this.spare;
      this.spare = undefined;
      return v;
    }
    let u = 0;
    while (u === 0) u = this.float();
    const r = Math.sqrt(-2 * Math.log(u));
    const th = 2 * Math.PI * this.float();
    this.spare = r * Math.sin(th);
    return r * Math.cos(th);
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.u32() % arr.length];
  }

  /**
   * Stream independiente derivado de éste. Un subsistema forkea una vez en
   * `init()` y consume de su fork, así no perturba la secuencia de los demás
   * aunque cambie su propio número de llamadas.
   */
  fork(): Rng {
    return new Rng(this.u32());
  }
}
