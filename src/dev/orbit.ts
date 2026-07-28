/**
 * Subsistema `orbit` — cámara de revisión del banco de pruebas.
 *
 * No es la cámara del juego. Es la herramienta con la que se juzga el
 * personaje, y por eso tiene dos cosas que una cámara de gameplay no tendría:
 * encuadres fijos reproducibles (teclas 7/8/9) y un modo de giro automático.
 * Un encuadre reproducible es lo que hace comparable una captura de hoy con la
 * de la semana pasada.
 */

import * as THREE from 'three';
import type { Ctx, System } from '../core/types';

export interface Framing {
  /** Azimut en grados; 0 mira a la cara del personaje. */
  yaw: number;
  /** Elevación en grados. */
  pitch: number;
  distance: number;
  /** Altura del punto de interés, en metros. */
  height: number;
}

export const FRAMINGS: Record<string, Framing> = {
  // Tres cuartos: el encuadre canónico para juzgar silueta y proporción.
  hero: { yaw: 34, pitch: 8, distance: 3.05, height: 1.02 },
  // Perfil puro: para la curva del cuello y la línea de la espalda.
  profile: { yaw: 90, pitch: 4, distance: 3.0, height: 1.05 },
  // Retrato: cabeza, pico y gola.
  portrait: { yaw: 22, pitch: 2, distance: 1.35, height: 1.62 },
  // Frontal puro: el único encuadre que delata una asimetría izquierda/derecha,
  // que es el fallo más común al autorizar poses con deltas euler espejados.
  front: { yaw: 0, pitch: 6, distance: 3.5, height: 1.05 },
};

export class OrbitSystem implements System {
  static readonly id = 'orbit';
  static readonly deps = ['render'] as const;

  private yaw = FRAMINGS.hero.yaw * (Math.PI / 180);
  private pitch = FRAMINGS.hero.pitch * (Math.PI / 180);
  private distance = FRAMINGS.hero.distance;
  private focus = new THREE.Vector3(0, FRAMINGS.hero.height, 0);

  private targetYaw = this.yaw;
  private targetPitch = this.pitch;
  private targetDistance = this.distance;
  private targetFocus = this.focus.clone();

  private autoSpin = false;
  private tmp = new THREE.Vector3();

  init(ctx: Ctx): void {
    const params = new URLSearchParams(location.search);
    const preset = params.get('framing');
    if (preset && FRAMINGS[preset]) this.apply(FRAMINGS[preset]);
    if (params.has('spin')) this.autoSpin = true;
    // En modo captura no hay suavizado: el primer frame ya es el encuadre final.
    if (ctx.config.deterministic) this.snap();
    this.write(ctx.camera);
  }

  apply(f: Framing): void {
    this.targetYaw = f.yaw * (Math.PI / 180);
    this.targetPitch = f.pitch * (Math.PI / 180);
    this.targetDistance = f.distance;
    this.targetFocus.set(0, f.height, 0);
  }

  setAutoSpin(on: boolean): void {
    this.autoSpin = on;
  }

  snap(): void {
    this.yaw = this.targetYaw;
    this.pitch = this.targetPitch;
    this.distance = this.targetDistance;
    this.focus.copy(this.targetFocus);
  }

  update(dt: number, ctx: Ctx): void {
    const input = ctx.input;

    if (input.pressed('Digit7')) this.apply(FRAMINGS.hero);
    if (input.pressed('Digit8')) this.apply(FRAMINGS.profile);
    if (input.pressed('Digit9')) this.apply(FRAMINGS.portrait);
    if (input.pressed('KeyR')) this.autoSpin = !this.autoSpin;

    if (input.pointer.down) {
      this.targetYaw -= input.pointer.dx * 0.006;
      this.targetPitch = clamp(this.targetPitch + input.pointer.dy * 0.005, -0.45, 1.25);
    }
    if (input.pointer.wheel !== 0) {
      this.targetDistance = clamp(this.targetDistance * (1 + input.pointer.wheel * 0.0012), 0.7, 14);
    }
    if (this.autoSpin) this.targetYaw += dt * 0.42;

    // Suavizado independiente del framerate: el mismo movimiento a 30 y a 144 Hz.
    const k = 1 - Math.exp(-dt * 9);
    this.yaw += (this.targetYaw - this.yaw) * k;
    this.pitch += (this.targetPitch - this.pitch) * k;
    this.distance += (this.targetDistance - this.distance) * k;
    this.focus.lerp(this.targetFocus, k);

    this.write(ctx.camera);
  }

  private write(camera: THREE.PerspectiveCamera): void {
    const cp = Math.cos(this.pitch);
    this.tmp.set(
      Math.sin(this.yaw) * cp,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cp,
    ).multiplyScalar(this.distance).add(this.focus);
    camera.position.copy(this.tmp);
    camera.lookAt(this.focus);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
