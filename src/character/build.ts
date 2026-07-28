/**
 * Ensamblado: convierte la librería de piezas en un `SkinnedMesh` terminado y
 * agrupado por material.
 *
 * UNA geometría por variante visual, compartida por todas las instancias de esa
 * variante; sólo el esqueleto es por instancia. Un `SkinnedMesh` puede compartir
 * geometría siempre que cada uno traiga su propio `Skeleton` y su propia
 * `bindMatrix`, y eso es lo que hace que veinte buitres cuesten veinte
 * esqueletos y no veinte mallas.
 *
 * PESOS DE SKIN — se derivan de la distancia a los segmentos de hueso en pose de
 * bind, restringida a los huesos que la pieza declara en `bind`. La restricción
 * es el truco: sin ella la gola acabaría pesada al ala, que pasa justo por al
 * lado, y el personaje se desmontaría al primer aleteo.
 */

import * as THREE from 'three';
import type { MeshData } from './geo';
import type { MaterialName, Part } from './parts';
import type { Rig } from './rig';

/** Metros de superficie por tile de textura, por conjunto de material. */
export const TILE: Record<MaterialName, number> = {
  feather: 0.30,
  down: 0.22,
  skin: 0.16,
  horn: 0.12,
  eye: 1.0,
};

/** Orden fijo de los grupos: el índice de material de un grupo no puede bailar
 *  entre builds o las baselines visuales se invalidan sin motivo. */
export const MATERIAL_ORDER: readonly MaterialName[] = ['feather', 'down', 'skin', 'horn', 'eye'];

/** Huesos por vértice. 3 basta para un bípedo: el cuarto nunca pesa nada. */
const INFLUENCES = 3;

export interface BuildResult {
  geometry: THREE.BufferGeometry;
  /** Índice de grupo -> nombre de material, en `MATERIAL_ORDER`. */
  groups: MaterialName[];
  stats: { vertices: number; triangles: number };
}

export function buildCharacterGeometry(rig: Rig, parts: readonly Part[]): BuildResult {
  // Agrupar por material para que cada uno sea UN grupo contiguo = UNA draw call.
  const byMaterial = new Map<MaterialName, Part[]>();
  for (const part of parts) {
    const list = byMaterial.get(part.material);
    if (list) list.push(part);
    else byMaterial.set(part.material, [part]);
  }

  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  const skinIndex: number[] = [];
  const skinWeight: number[] = [];
  const index: number[] = [];
  const groups: MaterialName[] = [];

  const geometry = new THREE.BufferGeometry();
  let groupStart = 0;
  let groupIndex = 0;

  for (const material of MATERIAL_ORDER) {
    const list = byMaterial.get(material);
    if (!list || !list.length) continue;
    const tile = TILE[material];
    let count = 0;

    for (const part of list) {
      const boneIds = part.bind.map((n) => rig.index(n));
      const base = position.length / 3;
      const m: MeshData = part.mesh;

      for (let v = 0; v < m.p.length; v += 3) {
        const x = m.p[v], y = m.p[v + 1], z = m.p[v + 2];
        position.push(x, y, z);
        normal.push(m.n[v], m.n[v + 1], m.n[v + 2]);
        // Las UV se guardan en metros; aquí se convierten a repeticiones de tile.
        const t = (v / 3) * 2;
        uv.push(m.uv[t] / tile, m.uv[t + 1] / tile);
        writeSkin(rig, boneIds, x, y, z, skinIndex, skinWeight);
      }
      for (let k = 0; k < m.i.length; k++) index.push(m.i[k] + base);
      count += m.i.length;
    }

    geometry.addGroup(groupStart, count, groupIndex);
    groups.push(material);
    groupStart += count;
    groupIndex++;
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();

  return {
    geometry,
    groups,
    stats: { vertices: position.length / 3, triangles: index.length / 3 },
  };
}

/**
 * Peso por distancia inversa a los segmentos de hueso candidatos.
 *
 * La potencia 4 es deliberada: con 2 la piel se vuelve gomosa y un vértice del
 * pecho sigue notando la mano; con 8 el reparto es casi rígido y aparece la
 * grieta clásica en el codo. 4 es donde el hombro se dobla sin pinzarse.
 */
function writeSkin(
  rig: Rig, boneIds: readonly number[],
  x: number, y: number, z: number,
  outIndex: number[], outWeight: number[],
): void {
  if (boneIds.length === 1) {
    outIndex.push(boneIds[0], 0, 0, 0);
    outWeight.push(1, 0, 0, 0);
    return;
  }

  // Top-N por proximidad. N es pequeño, así que una inserción lineal gana a ordenar.
  const bestId = [0, 0, 0];
  const bestW = [0, 0, 0];
  for (const id of boneIds) {
    const d = rig.distanceToBone(id, x, y, z);
    const w = 1 / Math.pow(d + 0.012, 4);
    for (let s = 0; s < INFLUENCES; s++) {
      if (w > bestW[s]) {
        for (let k = INFLUENCES - 1; k > s; k--) {
          bestW[k] = bestW[k - 1];
          bestId[k] = bestId[k - 1];
        }
        bestW[s] = w;
        bestId[s] = id;
        break;
      }
    }
  }

  const sum = bestW[0] + bestW[1] + bestW[2];
  if (sum <= 0) {
    outIndex.push(boneIds[0], 0, 0, 0);
    outWeight.push(1, 0, 0, 0);
    return;
  }
  outIndex.push(bestId[0], bestId[1], bestId[2], 0);
  outWeight.push(bestW[0] / sum, bestW[1] / sum, bestW[2] / sum, 0);
}

/**
 * Instancia: geometría compartida + esqueleto propio.
 * `bind()` con la matriz identidad porque la geometría ya está autorizada en el
 * espacio de bind del actor — no hay transformada de importación que deshacer.
 */
export function createInstance(
  rig: Rig,
  geometry: THREE.BufferGeometry,
  materials: THREE.Material[],
): { mesh: THREE.SkinnedMesh; bones: THREE.Bone[]; root: THREE.Bone } {
  const { bones, skeleton, root } = rig.createSkeleton();
  const mesh = new THREE.SkinnedMesh(geometry, materials);
  mesh.add(root);
  mesh.bind(skeleton, new THREE.Matrix4());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // El frustum culling por defecto usa la bounding sphere de la pose de bind;
  // con las alas abiertas el personaje se sale de ella y parpadea en los bordes.
  mesh.frustumCulled = false;
  return { mesh, bones, root };
}
