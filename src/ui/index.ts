/**
 * Subsistema `ui` — HUD de diagnóstico.
 *
 * Sólo lee. No conduce nada: si el HUD pudiera cambiar el estado del personaje,
 * una captura automatizada y una sesión manual dejarían de ser el mismo
 * programa. Se refresca a 5 Hz porque escribir en el DOM cada frame cuesta más
 * que dibujar el personaje.
 */

import type { Ctx, System } from '../core/types';
import type { CharacterSystem } from '../character';
import type { DirectorSystem } from '../dev/director';
import type { RenderSystem } from '../render';

const ROWS = [
  ['estado', '1 posado · 2 alerta · 3 acecho · 4 trote · 5 amenaza · 6 comiendo'],
  ['cámara', '7 héroe · 8 perfil · 9 retrato · R giro · arrastrar/rueda'],
  ['acción', 'E alas · Q mirada · espacio sacudir · H impacto'],
] as const;

export class UiSystem implements System {
  static readonly id = 'ui';
  static readonly deps = ['character', 'director', 'render'] as const;

  private el!: HTMLElement;
  private live!: HTMLElement;
  private accum = 0;
  private frames = 0;
  private fps = 0;
  private hidden = false;

  init(ctx: Ctx): void {
    const host = document.getElementById('hud');
    if (!host) throw new Error('[ui] falta #hud en el documento');
    this.el = host;

    const character = ctx.get<CharacterSystem>('character');
    const s = character.stats;

    this.el.innerHTML = `
      <div class="hud-title">EL BUITRE <span class="hud-dim">prototipo</span></div>
      <div class="hud-live"></div>
      <div class="hud-build">
        ${s.triangles.toLocaleString('es')} tris · ${s.bones} huesos ·
        ${s.materials} materiales · build ${s.buildMs.toFixed(0)} ms · ${ctx.config.q.name}
      </div>
      ${ROWS.map(([k, v]) => `<div class="hud-row"><b>${k}</b><span>${v}</span></div>`).join('')}
    `;
    this.live = this.el.querySelector('.hud-live')!;
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.el.style.display = hidden ? 'none' : '';
  }

  lateUpdate(dt: number, ctx: Ctx): void {
    if (this.hidden) return;
    this.accum += dt;
    this.frames++;
    if (this.accum < 0.2) return;
    this.fps = this.frames / this.accum;
    this.accum = 0;
    this.frames = 0;

    const director = ctx.get<DirectorSystem>('director');
    const info = ctx.get<RenderSystem>('render').info();
    this.live.textContent =
      `${director.state} · ${this.fps.toFixed(0)} fps · ` +
      `${info.calls} draws · ${info.triangles.toLocaleString('es')} tris · ` +
      `mirada ${director.lookEnabled ? 'on' : 'off'}`;
  }

  dispose(): void {
    this.el.innerHTML = '';
  }
}
