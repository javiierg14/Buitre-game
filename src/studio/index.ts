/**
 * Subsistema `studio` — plató fotográfico para la figura.
 *
 * Las referencias son fotografía de estudio: ciclorama claro, una fuente grande
 * y suave al frente y un contraluz que separa el pelo del fondo. Eso no se
 * consigue con luces puntuales; se consigue con área — de ahí los
 * `RectAreaLight`, que son los únicos que dan la caída de un softbox real.
 *
 * NOTA DE PROPIEDAD: `render` es el dueño de las luces, y su montaje está
 * calibrado para el desierto del buitre (clave cálida, niebla, exposición 1.55).
 * Este subsistema lo SUSTITUYE deliberadamente cuando la escena activa es la
 * figura. Es una excepción consciente al contrato, no un descuido: las dos
 * escenas no pueden compartir iluminación.
 */

import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import type { Ctx, System } from '../core/types';
import type { RenderSystem } from '../render';

export class StudioSystem implements System {
  static readonly id = 'studio';
  static readonly deps = ['render'] as const;

  private group = new THREE.Group();
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private pmrem: THREE.PMREMGenerator | null = null;

  init(ctx: Ctx): void {
    const render = ctx.get<RenderSystem>('render');

    // --- desmontar la iluminación de desierto ---
    const stale: THREE.Object3D[] = [];
    ctx.scene.traverse((o) => {
      if ((o as THREE.Light).isLight) stale.push(o);
    });
    for (const light of stale) light.parent?.remove(light);
    ctx.scene.fog = null;

    // Exposición de estudio. 1.55 era la corrección para el plumaje oscuro del
    // buitre; sobre piel muy clara quema las mejillas y borra las pecas.
    render.renderer.toneMappingExposure = 0.95;

    RectAreaLightUniformsLib.init();

    this.buildEnvironment(ctx, render);
    this.buildBackdrop();
    this.buildLights(ctx);

    ctx.scene.add(this.group);
  }

  /**
   * IBL de estudio: gris neutro con el lóbulo del softbox al frente. Es lo que
   * rellena las sombras — sin un entorno así, todo lo que la clave no toca cae
   * a negro y la piel se ve de cera.
   */
  private buildEnvironment(ctx: Ctx, render: RenderSystem): void {
    const w = 256;
    const h = 128;
    const data = new Float32Array(w * h * 4);
    const top = new THREE.Color(0.30, 0.31, 0.34);
    const bottom = new THREE.Color(0.09, 0.085, 0.08);

    for (let y = 0; y < h; y++) {
      const v = y / (h - 1);
      const up = 1 - v * 2;
      const c = bottom.clone().lerp(top, Math.max(0, up) ** 0.5 + 0.35);
      for (let x = 0; x < w; x++) {
        const u = x / (w - 1);
        // softbox principal: lóbulo ancho al frente-izquierda
        const key = Math.exp(-(((u - 0.30) ** 2) / 0.010 + ((v - 0.34) ** 2) / 0.016)) * 1.5;
        // rebote de relleno al frente-derecha, más tenue y frío
        const fill = Math.exp(-(((u - 0.66) ** 2) / 0.020 + ((v - 0.44) ** 2) / 0.030)) * 0.45;
        const i = (y * w + x) * 4;
        data[i] = c.r + key + fill * 0.92;
        data[i + 1] = c.g + key * 0.985 + fill * 0.96;
        data[i + 2] = c.b + key * 0.96 + fill;
        data[i + 3] = 1;
      }
    }

    const equirect = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
    equirect.mapping = THREE.EquirectangularReflectionMapping;
    equirect.colorSpace = THREE.NoColorSpace;
    equirect.minFilter = THREE.LinearFilter;
    equirect.magFilter = THREE.LinearFilter;
    equirect.needsUpdate = true;

    this.pmrem = new THREE.PMREMGenerator(render.renderer);
    this.pmrem.compileEquirectangularShader();
    const env = this.pmrem.fromEquirectangular(equirect).texture;
    ctx.scene.environment = env;
    // El fondo NO es el entorno: el ciclorama es geometría, para que reciba la
    // sombra proyectada y el degradado de la luz.
    ctx.scene.background = new THREE.Color(0x9d9a95);
    equirect.dispose();
    this.disposables.push(env);
  }

  /** Ciclorama: pared que se curva hasta el suelo, sin línea de horizonte. */
  private buildBackdrop(): void {
    const profile: THREE.Vector2[] = [];
    // tramo vertical
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      profile.push(new THREE.Vector2(4.6 - 3.8 * t, -3.10));
    }
    // curva de transición (cuarto de círculo)
    const radius = 1.1;
    for (let k = 1; k <= 12; k++) {
      const a = (k / 12) * (Math.PI / 2);
      profile.push(new THREE.Vector2(radius - Math.cos(a) * radius, -3.10 + radius - Math.sin(a) * radius));
    }
    // suelo hacia la cámara
    for (let k = 1; k <= 6; k++) {
      profile.push(new THREE.Vector2(0, -2.00 + (k / 6) * 6.5));
    }

    const halfWidth = 8.0;
    const cols = 24;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let r = 0; r < profile.length; r++) {
      for (let c = 0; c <= cols; c++) {
        const x = -halfWidth + (2 * halfWidth * c) / cols;
        positions.push(x, profile[r].x, profile[r].y);
        normals.push(0, 0, 0);
        uvs.push(c / cols, r / (profile.length - 1));
      }
    }
    const stride = cols + 1;
    for (let r = 0; r < profile.length - 1; r++) {
      for (let c = 0; c < cols; c++) {
        const a = r * stride + c;
        indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: 0xbfbcb6,
      roughness: 0.94,
      metalness: 0,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'cyclorama';
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.disposables.push(geo, mat);
  }

  private buildLights(ctx: Ctx): void {
    const size = ctx.config.q.shadowMapSize;

    // --- clave: softbox grande, alto y a la izquierda ---
    const key = new THREE.RectAreaLight(0xfff4ec, 4.6, 1.8, 2.4);
    key.position.set(-1.35, 2.05, 1.75);
    key.lookAt(0, 1.45, 0);
    this.group.add(key);

    // --- relleno: más grande, más lejos, la mitad de intensidad ---
    const fill = new THREE.RectAreaLight(0xeaf0ff, 1.3, 2.6, 2.6);
    fill.position.set(1.85, 1.55, 1.55);
    fill.lookAt(0, 1.35, 0);
    this.group.add(fill);

    // --- contraluz: el que hace que el pelo cobrizo se encienda ---
    // Sin esta luz la melena se funde con el fondo y el personaje pierde el
    // recorte que tienen todas las referencias.
    const rim = new THREE.DirectionalLight(0xffd7b0, 1.5);
    rim.position.set(1.1, 2.5, -2.3);
    rim.target.position.set(0, 1.45, 0);
    this.group.add(rim, rim.target);

    const rimLeft = new THREE.DirectionalLight(0xd6e4ff, 0.55);
    rimLeft.position.set(-2.1, 2.0, -1.6);
    rimLeft.target.position.set(0, 1.4, 0);
    this.group.add(rimLeft, rimLeft.target);

    // --- sombra ---
    // Las luces de área no proyectan sombra en three, así que una direccional
    // alineada con la clave hace ese trabajo: da el contacto con el suelo que
    // impide que la figura flote.
    const shadow = new THREE.DirectionalLight(0xffffff, 0.85);
    shadow.position.set(-1.5, 3.0, 1.9);
    shadow.target.position.set(0, 0.9, 0);
    shadow.castShadow = true;
    shadow.shadow.mapSize.set(size, size);
    const cam = shadow.shadow.camera;
    cam.left = -1.6;
    cam.right = 1.6;
    cam.top = 2.4;
    cam.bottom = -0.4;
    cam.near = 0.5;
    cam.far = 8;
    shadow.shadow.bias = -0.0006;
    shadow.shadow.normalBias = 0.012;
    shadow.shadow.radius = 3;
    this.group.add(shadow, shadow.target);

    // ambiente mínimo: sólo para que la nuca no caiga a negro puro
    this.group.add(new THREE.AmbientLight(0xb9c2d0, 0.10));
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.pmrem?.dispose();
    this.pmrem = null;
  }
}
