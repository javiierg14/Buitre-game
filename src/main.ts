/**
 * Punto de entrada. Registra los subsistemas y arranca el motor.
 *
 * El proyecto tiene DOS escenas y aquí se elige cuál se monta:
 *
 *   ?scene=figure  (por defecto) — la figura femenina en plató de estudio
 *   ?scene=buitre                — el prototipo de personaje-ave
 *
 * No comparten iluminación ni plató, así que no pueden coexistir en la misma
 * escena; comparten el motor, el renderer, la órbita y el harness de captura,
 * que es donde está el trabajo reutilizable.
 *
 * El orden de `add()` no importa — el Registry ordena por `static deps`. Lo que
 * sí importa es que aquí esté la lista completa: es el único sitio del proyecto
 * donde se puede ver de un vistazo de qué está hecho el programa.
 */

import './styles.css';
import * as THREE from 'three';
import { Engine } from './core/engine';
import { createConfig } from './core/config';
import { CharacterSystem } from './character';
import { RenderSystem } from './render';
import { StageSystem } from './stage';
import { StudioSystem } from './studio';
import { FigureSystem, FIGURE_FRAMINGS } from './figure';
import type { Outfit } from './figure';
import { UiSystem } from './ui';
import { OrbitSystem, FRAMINGS } from './dev/orbit';
import { DirectorSystem } from './dev/director';

declare global {
  interface Window {
    __BUITRE__?: {
      engine: Engine;
      /** Hooks deterministas que consumen las pruebas de Playwright. */
      hooks: TestHooks;
    };
  }
}

/**
 * Hooks de prueba. Se mantienen REALES: un hook que no hace nada produce
 * baselines de captura que pasan siempre y no significan nada.
 */
export interface TestHooks {
  /** Resiembra la aleatoriedad de gameplay. No reconstruye la geometría. */
  seed(value: number): void;
  /**
   * Fija el estado sin transición. En la escena del buitre es un clip de
   * animación; en la de la figura, el conjunto de ropa.
   */
  setState(name: string): void;
  /** Encuadre de cámara reproducible. */
  setFraming(name: string): void;
  /** Congela el reloj para que la captura no capture un frame a medias. */
  setPaused(paused: boolean): void;
  /** Apertura de alas 0..1, saltando la rampa. Sin efecto en la figura. */
  setSpread(value: number): void;
  /** Fija el objetivo de mirada, o lo suelta con `null`. */
  setLook(point: [number, number, number] | null): void;
  hideDebugUi(hidden: boolean): void;
  /** Métricas medidas, no declaradas: lo que el inspector de QA lee. */
  stats(): Record<string, number | string>;
}

type SceneName = 'figure' | 'buitre';

async function boot(): Promise<void> {
  const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('falta #stage en el documento');

  const params = new URLSearchParams(location.search);
  const scene: SceneName = params.get('scene') === 'buitre' ? 'buitre' : 'figure';

  const config = createConfig();
  const engine = new Engine(canvas, config);

  engine.add(RenderSystem).add(OrbitSystem);

  if (scene === 'figure') {
    Object.assign(FRAMINGS, FIGURE_FRAMINGS);
    engine.add(StudioSystem).add(FigureSystem);
  } else {
    engine.add(StageSystem).add(CharacterSystem).add(DirectorSystem).add(UiSystem);
  }

  await engine.init();

  const orbit = engine.registry.get<OrbitSystem>('orbit');
  const render = engine.registry.get<RenderSystem>('render');

  const hooks: TestHooks =
    scene === 'figure'
      ? buildFigureHooks(engine, orbit, render)
      : buildBuitreHooks(engine, orbit, render);

  // Encuadre inicial coherente con la escena: el preset por defecto de `orbit`
  // está calibrado para el ave y sobre la figura cae a la altura del ombligo.
  if (scene === 'figure' && !params.get('framing')) {
    orbit.apply(FRAMINGS.busto);
    orbit.snap();
  }

  window.__BUITRE__ = { engine, hooks };
  engine.start();

  if (import.meta.hot) {
    import.meta.hot.dispose(() => engine.dispose());
  }
}

function buildFigureHooks(engine: Engine, orbit: OrbitSystem, render: RenderSystem): TestHooks {
  const figure = engine.registry.get<FigureSystem>('figure');
  const hud = document.getElementById('hud');

  const paint = (): void => {
    if (!hud || hud.dataset.hidden === '1') return;
    const info = render.info();
    hud.textContent =
      `figura · ${figure.stats.triangles.toLocaleString('es')} tris · ` +
      `${figure.stats.strands} mechones · ${info.calls} draws · ${figure.stats.buildMs} ms`;
  };
  paint();

  return {
    seed(value) {
      engine.rng.seed(value >>> 0);
    },
    setState(name) {
      // en esta escena el "estado" es el conjunto de ropa
      figure.setOutfit(name === 'dress' ? 'dress' : ('casual' as Outfit));
      paint();
    },
    setFraming(name) {
      orbit.apply(FRAMINGS[name] ?? FRAMINGS.busto);
      orbit.snap();
    },
    setPaused(paused) {
      engine.time.scale = paused ? 0 : 1;
    },
    setSpread() {
      /* la figura no tiene alas */
    },
    setLook() {
      /* la mirada de la figura es fija por ahora */
    },
    hideDebugUi(hidden) {
      if (!hud) return;
      hud.dataset.hidden = hidden ? '1' : '0';
      hud.style.display = hidden ? 'none' : '';
      if (!hidden) paint();
    },
    stats() {
      const info = render.info();
      return {
        scene: 'figure',
        outfit: figure.currentOutfit(),
        quality: engine.config.q.name,
        seed: engine.config.seed,
        vertices: figure.stats.vertices,
        triangles: figure.stats.triangles,
        strands: figure.stats.strands,
        materialGroups: figure.stats.materials,
        buildMs: figure.stats.buildMs,
        drawCalls: info.calls,
        frameTriangles: info.triangles,
        programs: info.programs,
        textures: info.textures,
        frame: engine.time.frame,
      };
    },
  };
}

function buildBuitreHooks(engine: Engine, orbit: OrbitSystem, render: RenderSystem): TestHooks {
  const character = engine.registry.get<CharacterSystem>('character');
  const director = engine.registry.get<DirectorSystem>('director');
  const ui = engine.registry.get<UiSystem>('ui');
  const lookTmp = new THREE.Vector3();

  return {
    seed(value) {
      engine.rng.seed(value >>> 0);
    },
    setState(name) {
      director.setState(name as Parameters<DirectorSystem['setState']>[0], 0);
    },
    setFraming(name) {
      orbit.apply(FRAMINGS[name] ?? FRAMINGS.hero);
      orbit.snap();
    },
    setPaused(paused) {
      engine.time.scale = paused ? 0 : 1;
    },
    setSpread(value) {
      // Vía el director, no vía el personaje: el director reescribe la apertura
      // cada frame desde su rampa y se comería un valor puesto a mano.
      director.forceSpread(value);
    },
    setLook(point) {
      director.lookEnabled = false;
      character.lookAt(point ? lookTmp.set(point[0], point[1], point[2]) : null);
    },
    hideDebugUi(hidden) {
      ui.setHidden(hidden);
    },
    stats() {
      const info = render.info();
      return {
        scene: 'buitre',
        state: director.state,
        quality: engine.config.q.name,
        seed: engine.config.seed,
        vertices: character.stats.vertices,
        triangles: character.stats.triangles,
        bones: character.stats.bones,
        materialGroups: character.stats.materials,
        buildMs: Math.round(character.stats.buildMs),
        drawCalls: info.calls,
        frameTriangles: info.triangles,
        programs: info.programs,
        textures: info.textures,
        frame: engine.time.frame,
      };
    },
  };
}

boot().catch((err) => {
  console.error('[boot] fallo al arrancar:', err);
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = `fallo al arrancar: ${(err as Error).message}`;
});
