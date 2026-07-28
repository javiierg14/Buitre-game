import type * as THREE from 'three';
import type { EventBus } from './registry';
import type { Rng } from './rng';
import type { Input } from './input';
import type { Config } from './config';

export interface TimeState {
  /** Segundos desde el arranque, escalados. */
  elapsed: number;
  /** Segundos de reloj de pared, sin escalar. */
  raw: number;
  /** Delta del último frame, escalado y clampeado. */
  dt: number;
  /** Paso fijo. */
  fixed: number;
  /** Alpha de interpolación entre los dos últimos pasos fijos, 0..1. */
  alpha: number;
  scale: number;
  frame: number;
}

/** Lo que todo subsistema recibe. Nada más está garantizado. */
export interface Ctx {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  config: Config;
  events: EventBus;
  input: Input;
  time: TimeState;
  rng: Rng;
  get<T extends System = System>(id: string): T;
  peek<T extends System = System>(id: string): T | null;
  has(id: string): boolean;
}

export interface System {
  init?(ctx: Ctx): void | Promise<void>;
  /** Paso fijo determinista. 0..N veces por frame. */
  fixedUpdate?(h: number, ctx: Ctx): void;
  /** Una vez por frame, antes del render. */
  update?(dt: number, ctx: Ctx): void;
  /** Después de todos los update(), cuando las transformadas ya son finales. */
  lateUpdate?(dt: number, ctx: Ctx): void;
  resize?(w: number, h: number, ctx: Ctx): void;
  dispose?(): void;
}

export interface SystemClass {
  new (...args: never[]): System;
  /** Identificador único por el que los demás subsistemas te alcanzan. */
  id: string;
  /** Ids que deben inicializarse antes que éste. */
  deps?: readonly string[];
}
