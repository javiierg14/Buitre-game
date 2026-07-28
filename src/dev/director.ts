/**
 * Subsistema `director` — conduce el personaje desde el teclado y el ratón.
 *
 * Es andamiaje de prototipo: cuando exista una IA o un controlador de jugador
 * de verdad, este archivo se sustituye y `character` no se entera, porque sólo
 * usa su API pública. Que se pueda borrar sin tocar nada más es la prueba de
 * que el corte entre subsistemas está bien puesto.
 */

import * as THREE from 'three';
import type { Ctx, System } from '../core/types';
import type { CharacterSystem, ClipName } from '../character';

/** Estado -> velocidad de suelo que alimenta la fase de locomoción. */
const SPEED: Record<ClipName, number> = {
  perch: 0,
  alert: 0,
  feed: 0,
  threat: 0,
  stalk: 1.05,
  lope: 3.4,
};

const KEY_TO_STATE: Record<string, ClipName> = {
  Digit1: 'perch',
  Digit2: 'alert',
  Digit3: 'stalk',
  Digit4: 'lope',
  Digit5: 'threat',
  Digit6: 'feed',
};

export class DirectorSystem implements System {
  static readonly id = 'director';
  static readonly deps = ['character'] as const;

  state: ClipName = 'perch';
  lookEnabled = true;

  private character!: CharacterSystem;
  private spreadTarget = 0;
  private spread = 0;
  /** Por defecto el personaje mira al frente, no al centro de la pantalla. */
  private lookPoint = new THREE.Vector3(0, 1.55, 6);
  private tmp = new THREE.Vector3();
  /** El puntero no manda la mirada hasta que se ha movido de verdad: si no, un
   *  NDC (0,0) sin inicializar apunta al propio personaje y el cuello se enrosca. */
  private pointerLive = false;
  private lastNdc = new THREE.Vector2(0, 0);

  init(ctx: Ctx): void {
    this.character = ctx.get<CharacterSystem>('character');
    const preset = new URLSearchParams(location.search).get('state') as ClipName | null;
    if (preset && preset in SPEED) this.setState(preset, 0);
    else this.setState('perch', 0);
  }

  setState(name: ClipName, blend = 0.3): void {
    this.state = name;
    this.character.setState(name, blend);
    this.character.setSpeed(SPEED[name]);
    // La amenaza abre las alas sola; el resto de estados las recogen.
    this.spreadTarget = name === 'threat' ? 1 : 0;
  }

  /** Salta la rampa y fija la apertura de alas. Sólo para captura y pruebas. */
  forceSpread(value: number): void {
    this.spread = Math.min(1, Math.max(0, value));
    this.spreadTarget = this.spread;
    this.character.setSpread(this.spread);
  }

  update(dt: number, ctx: Ctx): void {
    const input = ctx.input;

    for (const [code, state] of Object.entries(KEY_TO_STATE)) {
      if (input.pressed(code)) this.setState(state);
    }
    if (input.pressed('Space')) this.character.ruffle();
    if (input.pressed('KeyH')) this.character.hit('torso', ctx.rng.signed());
    if (input.pressed('KeyE')) this.spreadTarget = this.spreadTarget > 0.5 ? 0 : 1;
    if (input.pressed('KeyQ')) this.lookEnabled = !this.lookEnabled;

    // Rampa asimétrica: abrir el ala es un gesto rápido, cerrarla es lento.
    const rate = this.spreadTarget > this.spread ? 4.5 : 2.0;
    this.spread += Math.sign(this.spreadTarget - this.spread) * Math.min(Math.abs(this.spreadTarget - this.spread), rate * dt);
    this.character.setSpread(this.spread);

    if (this.lookEnabled) {
      this.updateLookPoint(ctx);
      this.character.lookAt(this.lookPoint, 1);
    } else {
      this.character.lookAt(null);
    }
  }

  /** El puntero define un rayo; el objetivo vive a 4 m sobre él. */
  private updateLookPoint(ctx: Ctx): void {
    const p = ctx.input.pointer;
    if (!this.pointerLive) {
      if (Math.abs(p.ndcX - this.lastNdc.x) < 1e-4 && Math.abs(p.ndcY - this.lastNdc.y) < 1e-4) return;
      this.pointerLive = true;
    }
    this.lastNdc.set(p.ndcX, p.ndcY);
    this.tmp.set(p.ndcX, p.ndcY, 0.5).unproject(ctx.camera);
    this.tmp.sub(ctx.camera.position).normalize();
    this.lookPoint.copy(ctx.camera.position).addScaledVector(this.tmp, 4.0);
  }
}
