/**
 * Piel: texturas procedurales y material.
 *
 * Las pecas no son un adorno aquí — son el rasgo que identifica al personaje en
 * las referencias, así que van resueltas en el mapa de color y no insinuadas con
 * un tinte. La malla de la cabeza lleva UV en metros (pensadas para tilear), de
 * modo que la textura es *seamless* y la variación por zona (rubor, rojez de
 * nariz y orejas) llega por color de vértice, que multiplica al mapa.
 */

import * as THREE from 'three';
import { PALETTE } from './proportions';

export interface SkinTextures {
  albedo: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
}

function canvas(size: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('[skin] sin contexto 2d');
  return { c, ctx };
}

/** Dibuja con envoltura toroidal: la misma mancha en los 9 desplazamientos. */
function wrapped(size: number, x: number, y: number, draw: (px: number, py: number) => void): void {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const px = x + dx * size;
      const py = y + dy * size;
      if (px < -size * 0.2 || px > size * 1.2 || py < -size * 0.2 || py > size * 1.2) continue;
      draw(px, py);
    }
  }
}

export function createSkinTextures(size: number, rand: () => number): SkinTextures {
  // --- color ---
  const { c: alb, ctx: a } = canvas(size);
  a.fillStyle = PALETTE.skin;
  a.fillRect(0, 0, size, size);

  // grano de poro: ruido fino de baja amplitud, lo que impide que la piel se
  // vea como plástico bajo luz suave
  const img = a.getImageData(0, 0, size, size);
  for (let i = 0; i < size * size; i++) {
    const n = (rand() - 0.5) * 9;
    img.data[i * 4] += n;
    img.data[i * 4 + 1] += n * 0.85;
    img.data[i * 4 + 2] += n * 0.75;
  }
  a.putImageData(img, 0, 0);

  // manchas de tono sub-dérmico, muy suaves
  for (let k = 0; k < 40; k++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = size * (0.04 + rand() * 0.09);
    wrapped(size, x, y, (px, py) => {
      const g = a.createRadialGradient(px, py, 0, px, py, r);
      const warm = rand() > 0.5;
      g.addColorStop(0, warm ? 'rgba(226,150,128,0.10)' : 'rgba(196,176,182,0.08)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      a.fillStyle = g;
      a.beginPath();
      a.arc(px, py, r, 0, Math.PI * 2);
      a.fill();
    });
  }

  // --- pecas ---
  // Dos poblaciones: muchas pequeñas y tenues + unas pocas grandes y marcadas.
  // Una sola población da un patrón de lunares uniforme que se lee como suciedad.
  const freckle = new THREE.Color(PALETTE.freckle);
  const drawFreckles = (count: number, minR: number, maxR: number, minA: number, maxA: number): void => {
    for (let k = 0; k < count; k++) {
      const x = rand() * size;
      const y = rand() * size;
      // agrupadas: las pecas salen en racimos, no repartidas por igual
      const cluster = rand() < 0.62 ? 1 : 0;
      const jitter = cluster ? size * 0.03 : 0;
      const r = size * (minR + rand() * (maxR - minR));
      const alpha = minA + rand() * (maxA - minA);
      const tint = freckle.clone().offsetHSL((rand() - 0.5) * 0.03, (rand() - 0.5) * 0.12, (rand() - 0.5) * 0.1);
      wrapped(size, x + (rand() - 0.5) * jitter, y + (rand() - 0.5) * jitter, (px, py) => {
        const g = a.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, `rgba(${(tint.r * 255) | 0},${(tint.g * 255) | 0},${(tint.b * 255) | 0},${alpha})`);
        g.addColorStop(0.6, `rgba(${(tint.r * 255) | 0},${(tint.g * 255) | 0},${(tint.b * 255) | 0},${alpha * 0.45})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        a.fillStyle = g;
        a.beginPath();
        a.arc(px, py, r, 0, Math.PI * 2);
        a.fill();
      });
    }
  };
  drawFreckles(Math.round(size * 1.8), 0.0016, 0.0038, 0.30, 0.62);
  drawFreckles(Math.round(size * 0.35), 0.0035, 0.0068, 0.42, 0.78);

  // --- rugosidad ---
  const { c: rgh, ctx: r2 } = canvas(size >> 1);
  const rs = size >> 1;
  const rimg = r2.createImageData(rs, rs);
  for (let i = 0; i < rs * rs; i++) {
    // 0.42-0.60: la piel no es uniforme; la frente y la nariz brillan más que
    // la mejilla, y ese contraste es la mitad del "no es plástico"
    const v = (0.46 + (rand() - 0.5) * 0.14) * 255;
    rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = v;
    rimg.data[i * 4 + 3] = 255;
  }
  r2.putImageData(rimg, 0, 0);

  // --- relieve de poro ---
  const { c: bmp, ctx: b2 } = canvas(size >> 1);
  const bimg = b2.createImageData(rs, rs);
  for (let i = 0; i < rs * rs; i++) {
    const v = 128 + (rand() - 0.5) * 26;
    bimg.data[i * 4] = bimg.data[i * 4 + 1] = bimg.data[i * 4 + 2] = v;
    bimg.data[i * 4 + 3] = 255;
  }
  b2.putImageData(bimg, 0, 0);

  const mk = (el: HTMLCanvasElement, srgb: boolean, repeat: number): THREE.CanvasTexture => {
    const t = new THREE.CanvasTexture(el);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };

  // repeat 5.2: las UV vienen en metros, así que esto fija el tamaño real de
  // la peca en la cara. Subirlo las convierte en polvo; bajarlo, en lunares.
  return {
    albedo: mk(alb, true, 5.2),
    roughness: mk(rgh, false, 5.2),
    bump: mk(bmp, false, 14),
  };
}

/**
 * Material de piel. Sin subsurface real (three no lo trae), pero con las tres
 * cosas que más lo aparentan bajo luz de estudio: `sheen` cálido para el vello
 * facial a contraluz, especular bajo y variación de rugosidad.
 */
export function createSkinMaterial(tex: SkinTextures): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map: tex.albedo,
    roughnessMap: tex.roughness,
    bumpMap: tex.bump,
    bumpScale: 0.0022,
    roughness: 1, // el mapa manda
    metalness: 0,
    vertexColors: true,
    sheen: 0.55,
    sheenRoughness: 0.85,
    sheenColor: new THREE.Color('#ffb59a'),
    specularIntensity: 0.42,
    envMapIntensity: 0.55,
  });
}
