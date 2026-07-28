/**
 * Ojos: globo, iris, córnea, párpados, pestañas y cejas.
 *
 * Es la inversión con mejor retorno de todo el personaje. Un ojo con anillo
 * limbal, fibras de iris y una córnea que capta el brillo del softbox levanta
 * la cara entera; sin eso, cualquier cabeza bien modelada se queda en maniquí.
 *
 * Reparto: lo que debe compartir material con la piel (párpados) se devuelve
 * como MeshData para fundirse en la malla del cuerpo; lo que necesita material
 * propio (globo, iris, córnea) se devuelve como objetos de three.
 */

import * as THREE from 'three';
import { computeNormals, type MeshData } from '../character/geo';
import { F, PALETTE } from './proportions';

/** Centro del globo, en espacio de la figura. Es el pivote de todo lo demás. */
export const EYE_CENTER = { x: F.eyeX, y: F.eyeY, z: 0.0585 } as const;
const R = F.eyeRadius;

/* ------------------------------------------------------------------ */
/* Apertura palpebral                                                  */
/* ------------------------------------------------------------------ */

/**
 * Semiángulo de la apertura para un ángulo `theta` alrededor del eje de mirada
 * (0 = hacia la sien, π/2 = arriba). Una elipse en espacio angular, con el
 * párpado superior más abierto que el inferior: así sale la almendra, y no un
 * círculo, que es lo que delata a un ojo mal hecho.
 */
function aperture(theta: number): number {
  const horizontal = 0.80;
  const vertical = Math.sin(theta) > 0 ? 0.54 : 0.44;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return (horizontal * vertical) / Math.sqrt((vertical * c) ** 2 + (horizontal * s) ** 2);
}

/** Punto sobre la esfera del ojo a (theta, phi) desde el eje de mirada +Z. */
function onEye(theta: number, phi: number, radius: number, side: 1 | -1, out = new THREE.Vector3()): THREE.Vector3 {
  const sp = Math.sin(phi);
  out.set(Math.cos(theta) * sp * side, Math.sin(theta) * sp, Math.cos(phi));
  out.multiplyScalar(radius);
  out.x += EYE_CENTER.x * side;
  out.y += EYE_CENTER.y;
  out.z += EYE_CENTER.z;
  return out;
}

/**
 * Párpados: casquete anular que va del borde libre hacia fuera, hasta fundirse
 * con la cuenca. El radio crece al alejarse del borde para que el párpado tenga
 * grosor y no parezca una calcomanía sobre el globo.
 */
export function buildEyelids(): MeshData {
  const m: MeshData = { p: [], n: [], uv: [], i: [] };
  const segTheta = 72;
  const segRadial = 7;
  const v = new THREE.Vector3();

  for (const side of [1, -1] as const) {
    const base = m.p.length / 3;
    for (let t = 0; t <= segTheta; t++) {
      const theta = (t / segTheta) * Math.PI * 2;
      const phi0 = aperture(theta);
      for (let s = 0; s <= segRadial; s++) {
        const k = s / segRadial;
        // del borde libre (k=0) hacia la cuenca (k=1)
        const phi = phi0 + k * 0.62;
        // grosor: el borde es fino, el cuerpo del párpado abulta
        const radius = R * (1.012 + 0.10 * Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.5) + 0.03 * k);
        onEye(theta, phi, radius, side, v);
        m.p.push(v.x, v.y, v.z);
        m.n.push(0, 0, 0);
        m.uv.push(theta * 0.012, k * 0.012);
      }
    }
    const stride = segRadial + 1;
    for (let t = 0; t < segTheta; t++) {
      for (let s = 0; s < segRadial; s++) {
        const a = base + t * stride + s;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        // el sentido se invierte en el ojo espejado
        if (side === 1) m.i.push(a, c, b, b, c, d);
        else m.i.push(a, b, c, b, d, c);
      }
    }
  }
  return computeNormals(m);
}

/* ------------------------------------------------------------------ */
/* Iris                                                                */
/* ------------------------------------------------------------------ */

/**
 * Textura del iris en polares: fibras radiales, corona interior cálida, anillo
 * limbal oscuro y pupila. Las referencias tienen ojos azul verdoso con centro
 * ambarino, que es justo lo que hace este degradado en dos tramos.
 */
function createIrisTexture(size: number, rand: () => number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('[eyes] sin contexto 2d');
  const mid = size / 2;

  const outer = new THREE.Color(PALETTE.iris);
  const inner = new THREE.Color(PALETTE.irisInner);

  ctx.fillStyle = `#${outer.getHexString()}`;
  ctx.fillRect(0, 0, size, size);

  // fibras: radios finos con variación de tono y longitud
  const fibres = 260;
  for (let k = 0; k < fibres; k++) {
    const a = (k / fibres) * Math.PI * 2 + (rand() - 0.5) * 0.02;
    const reach = 0.30 + rand() * 0.66;
    const tint = outer.clone().offsetHSL((rand() - 0.5) * 0.05, (rand() - 0.5) * 0.25, (rand() - 0.5) * 0.34);
    ctx.strokeStyle = `rgba(${(tint.r * 255) | 0},${(tint.g * 255) | 0},${(tint.b * 255) | 0},${0.35 + rand() * 0.5})`;
    ctx.lineWidth = 0.8 + rand() * 2.0;
    ctx.beginPath();
    ctx.moveTo(mid + Math.cos(a) * mid * 0.19, mid + Math.sin(a) * mid * 0.19);
    const wob = (rand() - 0.5) * 0.10;
    ctx.lineTo(mid + Math.cos(a + wob) * mid * reach, mid + Math.sin(a + wob) * mid * reach);
    ctx.stroke();
  }

  // corona cálida alrededor de la pupila
  const halo = ctx.createRadialGradient(mid, mid, mid * 0.17, mid, mid, mid * 0.52);
  halo.addColorStop(0, `rgba(${(inner.r * 255) | 0},${(inner.g * 255) | 0},${(inner.b * 255) | 0},0.85)`);
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(mid, mid, mid, 0, Math.PI * 2);
  ctx.fill();

  // anillo limbal: el borde oscuro que hace que el iris "recorte"
  const limbal = ctx.createRadialGradient(mid, mid, mid * 0.72, mid, mid, mid);
  limbal.addColorStop(0, 'rgba(0,0,0,0)');
  limbal.addColorStop(0.72, `${PALETTE.limbal}88`);
  limbal.addColorStop(1, `${PALETTE.limbal}ff`);
  ctx.fillStyle = limbal;
  ctx.beginPath();
  ctx.arc(mid, mid, mid, 0, Math.PI * 2);
  ctx.fill();

  // pupila
  ctx.fillStyle = '#08080a';
  ctx.beginPath();
  ctx.arc(mid, mid, mid * 0.185, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export interface EyeParts {
  group: THREE.Group;
  materials: THREE.Material[];
  textures: THREE.Texture[];
  geometries: THREE.BufferGeometry[];
}

/**
 * Globo + iris + córnea, por duplicado. El iris va HUNDIDO respecto a la
 * córnea: ese hueco de medio milímetro es lo que produce el paralaje del ojo
 * real cuando la cabeza gira.
 */
export function createEyeballs(textureSize: number, rand: () => number): EyeParts {
  const group = new THREE.Group();
  group.name = 'eyes';

  const irisTex = createIrisTexture(Math.min(512, textureSize), rand);

  const scleraMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(PALETTE.sclera),
    roughness: 0.28,
    metalness: 0,
    sheen: 0.3,
    sheenColor: new THREE.Color('#ffd8d8'),
    envMapIntensity: 0.6,
  });

  const irisMat = new THREE.MeshStandardMaterial({
    map: irisTex,
    roughness: 0.22,
    metalness: 0,
    envMapIntensity: 0.9,
  });

  const corneaMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#ffffff'),
    transparent: true,
    opacity: 0.16,
    roughness: 0.015,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.015,
    envMapIntensity: 2.0,
    depthWrite: false,
  });

  const caruncleMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#d98a86'),
    roughness: 0.42,
  });

  const scleraGeo = new THREE.SphereGeometry(R, 40, 32);
  // iris: casquete curvo, no un disco plano
  const irisGeo = new THREE.SphereGeometry(R * 0.995, 40, 24, 0, Math.PI * 2, 0, 0.52);
  const corneaGeo = new THREE.SphereGeometry(R * 1.055, 36, 24, 0, Math.PI * 2, 0, 0.62);
  const caruncleGeo = new THREE.SphereGeometry(R * 0.19, 10, 8);

  // Las UV del casquete van de polo a borde; el mapa del iris es cuadrado y
  // radial, así que se remapean a coordenadas polares centradas.
  const uv = irisGeo.attributes.uv;
  const pos = irisGeo.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const r = Math.min(1, Math.hypot(x, y) / (R * Math.sin(0.52)));
    const a = Math.atan2(y, x);
    uv.setXY(i, 0.5 + Math.cos(a) * r * 0.5, 0.5 + Math.sin(a) * r * 0.5);
  }
  uv.needsUpdate = true;

  for (const side of [1, -1] as const) {
    const eye = new THREE.Group();
    eye.position.set(EYE_CENTER.x * side, EYE_CENTER.y, EYE_CENTER.z);

    const sclera = new THREE.Mesh(scleraGeo, scleraMat);
    eye.add(sclera);

    // el casquete nace mirando +Y; girarlo lo pone mirando +Z (la mirada)
    const iris = new THREE.Mesh(irisGeo, irisMat);
    iris.rotation.x = Math.PI / 2;
    iris.position.z = R * 0.012;
    eye.add(iris);

    const cornea = new THREE.Mesh(corneaGeo, corneaMat);
    cornea.rotation.x = Math.PI / 2;
    eye.add(cornea);

    const caruncle = new THREE.Mesh(caruncleGeo, caruncleMat);
    caruncle.position.set(-side * R * 0.92, -R * 0.12, R * 0.30);
    eye.add(caruncle);

    // convergencia: las miradas paralelas se ven muertas; un grado hacia dentro
    // hace que los ojos enfoquen a la cámara
    eye.rotation.y = -side * 0.028;
    group.add(eye);
  }

  return {
    group,
    materials: [scleraMat, irisMat, corneaMat, caruncleMat],
    textures: [irisTex],
    geometries: [scleraGeo, irisGeo, corneaGeo, caruncleGeo],
  };
}

/* ------------------------------------------------------------------ */
/* Pestañas y cejas                                                    */
/* ------------------------------------------------------------------ */

/**
 * Pestañas: una banda estrecha en el borde libre del párpado, inclinada hacia
 * fuera. Como geometría sólida y no como pelos sueltos — a esta escala una
 * banda con buen perfil se lee mejor y cuesta cien veces menos.
 */
export function buildLashes(): MeshData {
  const m: MeshData = { p: [], n: [], uv: [], i: [] };
  const seg = 48;
  const v = new THREE.Vector3();

  for (const side of [1, -1] as const) {
    for (const lid of ['upper', 'lower'] as const) {
      const base = m.p.length / 3;
      const from = lid === 'upper' ? 0.12 : Math.PI + 0.18;
      const to = lid === 'upper' ? Math.PI - 0.12 : Math.PI * 2 - 0.18;
      const length = lid === 'upper' ? 0.30 : 0.13;
      const rows = 2;

      for (let t = 0; t <= seg; t++) {
        const theta = from + (to - from) * (t / seg);
        const phi0 = aperture(theta);
        // más largas en el centro-exterior del ojo, como en un ojo real
        const bias = Math.sin((t / seg) * Math.PI) * 0.6 + 0.4;
        for (let s = 0; s <= rows; s++) {
          const k = s / rows;
          const phi = phi0 - k * length * bias;
          const radius = R * (1.03 + k * 0.16);
          onEye(theta, phi, radius, side, v);
          m.p.push(v.x, v.y, v.z);
          m.n.push(0, 0, 0);
          m.uv.push(theta * 0.01, k * 0.01);
        }
      }
      const stride = rows + 1;
      for (let t = 0; t < seg; t++) {
        for (let s = 0; s < rows; s++) {
          const a = base + t * stride + s;
          const b = a + 1;
          const c = a + stride;
          const d = c + 1;
          if (side === 1) m.i.push(a, c, b, b, c, d);
          else m.i.push(a, b, c, b, d, c);
        }
      }
    }
  }
  return computeNormals(m);
}

/** Cejas: cinta fina siguiendo el borde orbital superior, con grosor variable. */
export function buildBrows(): MeshData {
  const m: MeshData = { p: [], n: [], uv: [], i: [] };
  const seg = 32;
  const v = new THREE.Vector3();

  for (const side of [1, -1] as const) {
    const base = m.p.length / 3;
    for (let t = 0; t <= seg; t++) {
      const k = t / seg; // 0 = cabeza de la ceja (interior), 1 = cola
      const theta = Math.PI * (0.86 - 0.72 * k);
      // la cola de la ceja cae y se aleja
      const phi = aperture(theta) + 0.30 + 0.10 * Math.sin(k * Math.PI);
      // grosor: gruesa en la cabeza, afilada en la cola
      const thick = (0.115 - 0.085 * k * k) * (0.35 + 0.75 * Math.sin(Math.min(1, k * 1.4) * Math.PI * 0.7));
      for (let s = 0; s <= 1; s++) {
        const p = phi + (s === 0 ? -thick * 0.5 : thick * 0.5);
        onEye(theta, p, R * 1.30, side, v);
        m.p.push(v.x, v.y, v.z);
        m.n.push(0, 0, 0);
        m.uv.push(k * 0.02, s * 0.004);
      }
    }
    for (let t = 0; t < seg; t++) {
      const a = base + t * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      if (side === 1) m.i.push(a, c, b, b, c, d);
      else m.i.push(a, b, c, b, d, c);
    }
  }
  return computeNormals(m);
}
