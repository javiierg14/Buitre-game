/**
 * Subsistema `figure` — dueño del personaje femenino.
 *
 * Ensambla las piezas (cabeza, cuerpo, ojos, pelo, ropa) y las publica como un
 * único nodo. La superficie pública es estrecha a propósito: `root` para
 * colocarla, `setOutfit` para cambiar de conjunto y `stats` para que el
 * inspector de QA lea números medidos.
 *
 * Reparto de materiales — sólo cuatro, y cada uno existe por una razón:
 *   piel   (con color de vértice: rubor, labios, rojez de nariz y orejas)
 *   pelo   (anisotrópico, color por mechón)
 *   oscuro (pestañas y cejas)
 *   tela   (uno por prenda)
 */

import * as THREE from 'three';
import type { Ctx, System } from '../core/types';
import { appendMesh, emptyMesh, type MeshData } from '../character/geo';
import { paintVertexColors } from './sculpt';
import { buildHead, buildNeck } from './head';
import { buildArms, buildLegs, buildTorso } from './body';
import { buildBrows, buildEyelids, buildLashes, createEyeballs, type EyeParts } from './eyes';
import { buildHair, createHairMaterial } from './hair';
import { OUTFITS, createClothMaterial, type Outfit } from './clothing';
import { createSkinMaterial, createSkinTextures } from './skin';
import { F, PALETTE } from './proportions';

/** Encuadres pensados para esta figura, en las mismas unidades que `orbit`. */
export const FIGURE_FRAMINGS = {
  // Primer plano: es el encuadre que decide si la cara funciona.
  retrato: { yaw: 14, pitch: 2, distance: 0.60, height: 1.572 },
  // Busto: cara + pelo + hombros, como las referencias de estudio.
  busto: { yaw: 20, pitch: 3, distance: 1.05, height: 1.480 },
  // Tres cuartos de cuerpo entero: silueta y proporción.
  tresCuartos: { yaw: 32, pitch: 4, distance: 2.45, height: 1.010 },
  // Frontal entera.
  entera: { yaw: 8, pitch: 2, distance: 2.75, height: 0.960 },
  // De espaldas mirando por encima del hombro, como una de las referencias.
  espalda: { yaw: 158, pitch: 3, distance: 2.20, height: 1.090 },
  // Perfil: el que delata una nariz mal resuelta.
  perfilFigura: { yaw: 90, pitch: 2, distance: 0.95, height: 1.545 },
} as const;

export interface FigureStats {
  vertices: number;
  triangles: number;
  strands: number;
  materials: number;
  buildMs: number;
}

function toGeometry(m: MeshData, colors?: Float32Array): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(m.n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
  if (colors) g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(m.i), 1));
  return g;
}

/**
 * Color de vértice como RAZÓN sobre el color base del mapa. El atributo
 * multiplica al `map`, así que para llegar a un objetivo hay que pintar
 * objetivo/base, no el objetivo.
 */
function ratio(target: string, base: string): THREE.Color {
  const t = new THREE.Color(target);
  const b = new THREE.Color(base);
  return new THREE.Color(t.r / Math.max(1e-3, b.r), t.g / Math.max(1e-3, b.g), t.b / Math.max(1e-3, b.b));
}

export class FigureSystem implements System {
  static readonly id = 'figure';
  static readonly deps = ['render'] as const;

  readonly root = new THREE.Group();
  stats!: FigureStats;

  private outfit: Outfit = 'casual';
  private outfitGroup = new THREE.Group();
  private eyes!: EyeParts;
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private segments = 12;

  init(ctx: Ctx): void {
    const t0 = performance.now();
    const rng = ctx.rng.fork();
    const rand = (): number => rng.float();
    const q = ctx.config.q;
    this.segments = q.limbSegments;

    // ---------------------------------------------------------------
    // Piel: una sola malla para que no haya costura visible entre la
    // cabeza, el cuello y el tronco.
    // ---------------------------------------------------------------
    const skin = emptyMesh();
    appendMesh(skin, buildHead(this.segments));
    appendMesh(skin, buildNeck(this.segments));
    appendMesh(skin, buildTorso(this.segments));
    appendMesh(skin, buildArms(this.segments));
    appendMesh(skin, buildLegs(this.segments));
    appendMesh(skin, buildEyelids());

    const skinColors = paintVertexColors(skin, new THREE.Color(1, 1, 1), [
      // labios
      {
        at: [0, F.mouthY - 0.001, 0.078],
        radius: [0.023, 0.011, 0.020],
        color: ratio(PALETTE.lip, PALETTE.skin),
        amount: 0.92,
      },
      // rubor en la mejilla, alto y hacia la sien
      {
        at: [0.050, F.eyeY - 0.030, 0.058],
        radius: [0.032, 0.026, 0.036],
        color: ratio(PALETTE.blush, PALETTE.skin),
        amount: 0.42,
        mirror: true,
      },
      // punta de la nariz
      {
        at: [0, F.noseTipY, 0.092],
        radius: [0.014, 0.012, 0.018],
        color: ratio(PALETTE.blush, PALETTE.skin),
        amount: 0.30,
      },
      // orejas: la piel fina se ve roja a contraluz
      {
        at: [F.headRx * 1.02, F.headCenter, -0.012],
        radius: [0.018, 0.030, 0.024],
        color: ratio('#e09a86', PALETTE.skin),
        amount: 0.45,
        mirror: true,
      },
      // párpado: un punto de calor sobre el ojo
      {
        at: [F.eyeX, F.eyeY + 0.008, 0.066],
        radius: [0.020, 0.010, 0.016],
        color: ratio('#e8b3a2', PALETTE.skin),
        amount: 0.30,
        mirror: true,
      },
      // sombra bajo la mandíbula y en el cuello: oclusión pintada, barata y
      // más estable que cualquier AO en pantalla a esta escala
      {
        at: [0, F.neckTop - 0.02, 0.02],
        radius: [0.07, 0.05, 0.07],
        color: new THREE.Color(0.68, 0.63, 0.63),
        amount: 0.62,
      },
      // cuenca ocular: sin esta sombra el ojo no se hunde y la cara se aplana
      {
        at: [F.eyeX, F.eyeY + 0.004, 0.056],
        radius: [0.028, 0.017, 0.024],
        color: new THREE.Color(0.80, 0.74, 0.75),
        amount: 0.55,
        mirror: true,
      },
      // surco nasogeniano y comisura
      {
        at: [0.021, F.mouthY + 0.008, 0.066],
        radius: [0.016, 0.020, 0.018],
        color: new THREE.Color(0.86, 0.80, 0.80),
        amount: 0.40,
        mirror: true,
      },
      // bajo el labio inferior
      {
        at: [0, F.mouthY - 0.019, 0.072],
        radius: [0.017, 0.008, 0.014],
        color: new THREE.Color(0.85, 0.79, 0.79),
        amount: 0.42,
      },
    ]);

    const skinTex = createSkinTextures(q.textureSize, rand);
    const skinMat = createSkinMaterial(skinTex);
    const skinGeo = toGeometry(skin, skinColors);
    const skinMesh = new THREE.Mesh(skinGeo, skinMat);
    skinMesh.name = 'skin';
    skinMesh.castShadow = true;
    skinMesh.receiveShadow = true;
    this.root.add(skinMesh);
    this.disposables.push(skinGeo, skinMat, skinTex.albedo, skinTex.roughness, skinTex.bump);

    // ---------------------------------------------------------------
    // Pestañas y cejas
    // ---------------------------------------------------------------
    const dark = emptyMesh();
    appendMesh(dark, buildLashes());
    appendMesh(dark, buildBrows());
    const darkGeo = toGeometry(dark);
    const darkMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE.brow),
      roughness: 0.55,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const darkMesh = new THREE.Mesh(darkGeo, darkMat);
    darkMesh.name = 'lashes';
    darkMesh.castShadow = true;
    this.root.add(darkMesh);
    this.disposables.push(darkGeo, darkMat);

    // ---------------------------------------------------------------
    // Ojos
    // ---------------------------------------------------------------
    this.eyes = createEyeballs(q.textureSize, rand);
    this.root.add(this.eyes.group);
    this.disposables.push(...this.eyes.materials, ...this.eyes.textures, ...this.eyes.geometries);

    // ---------------------------------------------------------------
    // Pelo
    // ---------------------------------------------------------------
    // El conteo escala con el preset: es, de largo, la partida más cara.
    const strandCount = Math.round(F.hairStrands * (q.name === 'low' ? 0.45 : q.name === 'medium' ? 0.72 : 1));
    const hair = buildHair(rand, strandCount);
    const hairGeo = toGeometry(hair.mesh, hair.colors);
    const hairMat = createHairMaterial();
    const hairMesh = new THREE.Mesh(hairGeo, hairMat);
    hairMesh.name = 'hair';
    hairMesh.castShadow = true;
    this.root.add(hairMesh);
    this.disposables.push(hairGeo, hairMat);

    // ---------------------------------------------------------------
    // Ropa
    // ---------------------------------------------------------------
    this.root.add(this.outfitGroup);
    const params = new URLSearchParams(location.search);
    const requested = params.get('outfit');
    this.setOutfit(requested === 'dress' ? 'dress' : 'casual');

    ctx.scene.add(this.root);

    let triangles = 0;
    let vertices = 0;
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const g = mesh.geometry;
      vertices += g.attributes.position.count;
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    });

    this.stats = {
      vertices,
      triangles: Math.round(triangles),
      strands: strandCount,
      materials: 4 + OUTFITS[this.outfit].pieces.length,
      buildMs: Math.round(performance.now() - t0),
    };
  }

  /** Cambia de conjunto reconstruyendo sólo las prendas. */
  setOutfit(outfit: Outfit): void {
    this.outfit = outfit;
    for (const child of [...this.outfitGroup.children]) {
      this.outfitGroup.remove(child);
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material)?.dispose();
    }
    for (const piece of OUTFITS[outfit].pieces) {
      const geo = toGeometry(piece.build(this.segments));
      const mat = createClothMaterial(piece.color);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.outfitGroup.add(mesh);
    }
  }

  currentOutfit(): Outfit {
    return this.outfit;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}

export { F as FIGURE } from './proportions';
export type { Outfit } from './clothing';
