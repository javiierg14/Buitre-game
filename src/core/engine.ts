import * as THREE from 'three';
import { Registry, EventBus } from './registry';
import { FIXED_DT, MAX_SUBSTEPS, type Config } from './config';
import { Input } from './input';
import { Rng } from './rng';
import type { Ctx, System, SystemClass, TimeState } from './types';

/**
 * El Engine es dueño del bucle de frame y del contexto compartido. NO sabe qué
 * hace ningún subsistema — sólo los secuencia.
 *
 * Orden del frame:
 *   1. input.beginFrame()
 *   2. fixedUpdate(FIXED_DT) xN   — simulación determinista
 *   3. update(dt)                 — animación, cámaras, decisiones
 *   4. lateUpdate(dt)             — lo que debe ver las transformadas finales
 *   5. el subsistema `render` dibuja
 *   6. input.endFrame()
 */
export class Engine {
  readonly registry = new Registry();
  readonly events = new EventBus();
  readonly input: Input;
  readonly rng: Rng;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly ctx: Ctx;

  readonly time: TimeState = {
    elapsed: 0,
    raw: 0,
    dt: 0,
    fixed: FIXED_DT,
    alpha: 0,
    scale: 1,
    frame: 0,
  };

  private accum = 0;
  private last = 0;
  private running = false;
  private frameId = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly config: Config,
  ) {
    this.input = new Input(canvas);
    this.rng = new Rng(config.deterministic ? config.seed : (Math.random() * 2 ** 32) >>> 0);

    this.camera = new THREE.PerspectiveCamera(config.fov, 1, 0.05, 400);
    this.camera.rotation.order = 'YXZ';

    this.ctx = {
      scene: this.scene,
      camera: this.camera,
      canvas,
      config,
      events: this.events,
      input: this.input,
      time: this.time,
      rng: this.rng,
      get: (id) => this.registry.get(id),
      peek: (id) => this.registry.peek(id),
      has: (id) => this.registry.has(id),
    };
  }

  add(SystemCtor: SystemClass, ...args: never[]): this {
    this.registry.add(new SystemCtor(...args));
    return this;
  }

  async init(): Promise<this> {
    for (const sys of this.registry.resolve()) {
      const t0 = performance.now();
      await sys.init?.(this.ctx);
      const ms = performance.now() - t0;
      if (ms > 50) console.info(`[engine] ${(sys.constructor as SystemClass).id} init ${ms.toFixed(0)}ms`);
    }
    this.input.attach();
    addEventListener('resize', this.onResize);
    this.resize();
    return this;
  }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth || innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const sys of this.registry.with('resize')) sys.resize!(w, h, this.ctx);
    this.events.emit('resize', { width: w, height: h });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.frameId = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameId);
  }

  private loop = (now: number): void => {
    if (!this.running) return;
    this.frameId = requestAnimationFrame(this.loop);
    this.step(now);
  };

  /** Avanza un frame. Público para que el harness de captura bombee a mano. */
  step(now = performance.now()): void {
    const t = this.time;
    // Clamp: un cambio de pestaña o un breakpoint no debe teletransportar la sim.
    const rawDt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    t.raw += rawDt;
    t.dt = rawDt * t.scale;
    t.elapsed += t.dt;
    t.frame++;

    this.input.beginFrame();

    this.accum += t.dt;
    let steps = 0;
    const fixedSystems = this.registry.with('fixedUpdate');
    while (this.accum >= FIXED_DT && steps < MAX_SUBSTEPS) {
      for (const sys of fixedSystems) sys.fixedUpdate!(FIXED_DT, this.ctx);
      this.accum -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_SUBSTEPS) this.accum = 0;
    t.alpha = this.accum / FIXED_DT;

    for (const sys of this.registry.with('update')) sys.update!(t.dt, this.ctx);
    for (const sys of this.registry.with('lateUpdate')) sys.lateUpdate!(t.dt, this.ctx);

    const renderSystem = this.registry.peek('render') as (System & { render?(ctx: Ctx): void }) | null;
    renderSystem?.render?.(this.ctx);

    this.input.endFrame();
  }

  dispose(): void {
    this.stop();
    removeEventListener('resize', this.onResize);
    this.input.detach();
    for (const sys of [...this.registry.ordered].reverse()) sys.dispose?.();
    this.events.clear();
  }

  private onResize = (): void => this.resize();
}
