import type { Ctx, System, SystemClass } from './types';

/**
 * Registro de subsistemas + bus de eventos.
 *
 * CONTRATO — ver ARCHITECTURE.md. Resumen:
 *   static id    : string único. Los demás te alcanzan con ctx.get(id).
 *   static deps  : ids que deben inicializarse antes.
 *   init/update/lateUpdate/fixedUpdate/resize/dispose son opcionales salvo init.
 *
 * Los subsistemas NO se importan entre sí. Se piden en runtime por id. Eso es
 * lo que permite que dos personas (o dos agentes) trabajen dos carpetas en
 * paralelo sin pisarse.
 */
export class Registry {
  private systems = new Map<string, System>();
  private order: System[] = [];
  private cache = new Map<string, System[]>();

  add(system: System): this {
    const id = (system.constructor as SystemClass).id;
    if (!id) throw new Error(`${system.constructor.name} no declara un "static id"`);
    if (this.systems.has(id)) throw new Error(`id de subsistema duplicado "${id}"`);
    this.systems.set(id, system);
    this.cache.clear();
    return this;
  }

  get<T extends System = System>(id: string): T {
    const s = this.systems.get(id);
    if (!s) throw new Error(`subsistema "${id}" no registrado`);
    return s as T;
  }

  /** Búsqueda no-lanzante para dependencias opcionales. */
  peek<T extends System = System>(id: string): T | null {
    return (this.systems.get(id) as T) ?? null;
  }

  has(id: string): boolean {
    return this.systems.has(id);
  }

  /** Orden topológico sobre `static deps`; lanza en ciclos o deps faltantes. */
  resolve(): System[] {
    const seen = new Map<string, 0 | 1>(); // 0 = visitando, 1 = listo
    const out: System[] = [];
    const visit = (id: string, from: string): void => {
      const state = seen.get(id);
      if (state === 1) return;
      if (state === 0) throw new Error(`ciclo de dependencias en "${id}" (vía ${from})`);
      const sys = this.systems.get(id);
      if (!sys) throw new Error(`"${from}" depende del subsistema no registrado "${id}"`);
      seen.set(id, 0);
      for (const d of (sys.constructor as SystemClass).deps ?? []) visit(d, id);
      seen.set(id, 1);
      out.push(sys);
    };
    for (const id of this.systems.keys()) visit(id, '<root>');
    this.order = out;
    return out;
  }

  get ordered(): System[] {
    return this.order.length ? this.order : this.resolve();
  }

  /** Subsistemas que implementan `method`, en orden de dependencia. Cacheado. */
  with(method: keyof System): System[] {
    let list = this.cache.get(method as string);
    if (!list) {
      list = this.ordered.filter((s) => typeof s[method] === 'function');
      this.cache.set(method as string, list);
    }
    return list;
  }
}

/** Bus de eventos mínimo. Los handlers se llaman de forma síncrona. */
export class EventBus {
  private map = new Map<string, Set<(payload: unknown) => void>>();

  on<T = unknown>(type: string, fn: (payload: T) => void): () => void {
    let set = this.map.get(type);
    if (!set) {
      set = new Set();
      this.map.set(type, set);
    }
    set.add(fn as (payload: unknown) => void);
    return () => this.off(type, fn);
  }

  once<T = unknown>(type: string, fn: (payload: T) => void): () => void {
    const off = this.on<T>(type, (e) => {
      off();
      fn(e);
    });
    return off;
  }

  off<T = unknown>(type: string, fn: (payload: T) => void): void {
    this.map.get(type)?.delete(fn as (payload: unknown) => void);
  }

  emit<T = unknown>(type: string, payload?: T): void {
    const set = this.map.get(type);
    if (!set) return;
    // Copia: un handler puede desuscribirse durante el dispatch.
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[events] el handler de "${type}" lanzó:`, err);
      }
    }
  }

  clear(): void {
    this.map.clear();
  }
}

export type { Ctx };
