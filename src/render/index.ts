/**
 * Subsistema `render` — dueño del WebGLRenderer, de la iluminación y del
 * entorno IBL. Nadie más crea luces ni toca el estado del renderer.
 *
 * La regla de calidad heredada es "ninguna iluminación uniforme": clave, relleno
 * y contraluz separados, con una sombra de contacto real. Tres luces bien
 * separadas hacen más por que un personaje se lea que cualquier post-proceso.
 */

import * as THREE from 'three';
import type { Ctx, System } from '../core/types';

export class RenderSystem implements System {
  static readonly id = 'render';

  renderer!: THREE.WebGLRenderer;
  key!: THREE.DirectionalLight;

  private envMap: THREE.Texture | null = null;
  private background: THREE.Texture | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private maxDpr = 2;

  init(ctx: Ctx): void {
    this.maxDpr = ctx.config.q.maxDpr;

    this.renderer = new THREE.WebGLRenderer({
      canvas: ctx.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      // `preserveDrawingBuffer` deja que el harness lea el canvas sin tener que
      // sincronizar con el frame; el coste sólo aparece en modo captura.
      preserveDrawingBuffer: new URLSearchParams(location.search).has('capture'),
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // 1.55, no 1.0. El plumaje real vive en albedo lineal 0.03-0.11 y a
    // exposición neutra queda en negro plano. Subir la exposición es la
    // corrección correcta; subir el albedo convierte las plumas en plastilina.
    this.renderer.toneMappingExposure = 1.55;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = ctx.config.q.softShadows
      ? THREE.PCFSoftShadowMap
      : THREE.PCFShadowMap;

    ctx.scene.fog = new THREE.Fog(0x4a4436, 16, 90);

    this.buildEnvironment(ctx);
    this.buildLights(ctx);
  }

  /**
   * IBL procedural: un equirectangular diminuto (cielo frío arriba, tierra
   * cálida abajo, un sol) pasado por PMREM. 64x32 texels sobran porque el
   * prefiltrado se come cualquier detalle; lo que importa es la *dirección* del
   * gradiente, que es lo que da el rebote de color a las plumas.
   */
  private buildEnvironment(ctx: Ctx): void {
    // 256x128: el PMREM se come el detalle, pero la MISMA textura se usa de
    // fondo, y ahí 64x32 se ve como bandas. Una textura, dos usos.
    const w = 256;
    const h = 128;
    const data = new Float32Array(w * h * 4);
    const sky = new THREE.Color(0x3c5a7a);
    const horizon = new THREE.Color(0xb08a5a);
    const ground = new THREE.Color(0x2c2318);
    const c = new THREE.Color();

    for (let y = 0; y < h; y++) {
      const v = y / (h - 1);
      const up = 1 - v * 2; // +1 cenit, -1 nadir
      if (up >= 0) c.copy(horizon).lerp(sky, up ** 0.45);
      else c.copy(horizon).lerp(ground, (-up) ** 0.35);
      for (let x = 0; x < w; x++) {
        const u = x / (w - 1);
        // Sol bajo: lóbulo ancho por detrás-izquierda, alineado con la clave.
        const sun = Math.exp(-(((u - 0.68) ** 2) / 0.0016 + ((v - 0.42) ** 2) / 0.0022)) * 14;
        const i = (y * w + x) * 4;
        data[i] = c.r + sun;
        data[i + 1] = c.g + sun * 0.88;
        data[i + 2] = c.b + sun * 0.70;
        data[i + 3] = 1;
      }
    }

    const equirect = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
    equirect.mapping = THREE.EquirectangularReflectionMapping;
    equirect.colorSpace = THREE.NoColorSpace;
    equirect.minFilter = THREE.LinearFilter;
    equirect.magFilter = THREE.LinearFilter;
    equirect.needsUpdate = true;

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();
    this.envMap = this.pmrem.fromEquirectangular(equirect).texture;
    ctx.scene.environment = this.envMap;
    // El fondo NO es negro: una silueta oscura sobre negro no tiene silueta.
    ctx.scene.background = equirect;
    ctx.scene.backgroundIntensity = 0.75;
    this.background = equirect;
  }

  private buildLights(ctx: Ctx): void {
    const size = ctx.config.q.shadowMapSize;

    // Clave: sol bajo desde el frente-izquierda, cálido.
    this.key = new THREE.DirectionalLight(0xffd9b0, 5.2);
    this.key.position.set(-3.4, 3.4, 3.2);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(size, size);
    // Volumen de sombra ajustado al personaje: una sombra de 50 m de lado sobre
    // un actor de 1.8 m gasta toda la resolución en aire vacío.
    const cam = this.key.shadow.camera;
    cam.left = -2.6;
    cam.right = 2.6;
    cam.top = 3.2;
    cam.bottom = -0.4;
    cam.near = 0.5;
    cam.far = 14;
    cam.updateProjectionMatrix();
    this.key.shadow.bias = -0.0012;
    this.key.shadow.normalBias = 0.022;
    ctx.scene.add(this.key, this.key.target);

    // Relleno hemisférico: cielo frío arriba, rebote de tierra abajo.
    const fill = new THREE.HemisphereLight(0x6d88a6, 0x4a3826, 1.6);
    ctx.scene.add(fill);

    // Contraluz: separa la silueta del fondo. Es la luz que hace que el
    // personaje deje de estar pegado al fondo en una captura.
    const rim = new THREE.DirectionalLight(0xa8c6e4, 3.4);
    rim.position.set(2.8, 2.6, -4.2);
    ctx.scene.add(rim);
  }

  resize(w: number, h: number): void {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.maxDpr));
    this.renderer.setSize(w, h, false);
  }

  /** Llamado por el Engine al final del frame. */
  render(ctx: Ctx): void {
    this.renderer.render(ctx.scene, ctx.camera);
  }

  /** Métricas del último frame, para el HUD y para el inspector de QA. */
  info(): { calls: number; triangles: number; programs: number; textures: number; geometries: number } {
    const r = this.renderer.info;
    return {
      calls: r.render.calls,
      triangles: r.render.triangles,
      programs: r.programs?.length ?? 0,
      textures: r.memory.textures,
      geometries: r.memory.geometries,
    };
  }

  dispose(): void {
    this.envMap?.dispose();
    this.background?.dispose();
    this.pmrem?.dispose();
    this.renderer.dispose();
  }
}
