import * as THREE from 'three';
import { capOpenBoundaries } from './capOpenBoundaries';
import { weldSeamSkinning, type SeamWeldReport } from './weldSeamSkinning';
import { repairOrphanSkinBinding, type OrphanSkinReport } from './repairOrphanSkinBinding';
import {
  SOURCE_MESH_NODES,
  SOURCE_MESH_TOTALS,
  SOURCE_TEXTURES,
} from './sourceMeshData';

/**
 * Assemble the 69 drawable meshes as plain Three.js objects.
 *
 * Pure Three.js and pure code: every mesh here is a `THREE.SkinnedMesh` over a
 * `THREE.BufferGeometry` whose attributes are set from typed arrays in this module. No `GLTFLoader`,
 * no addon, no runtime request -- the reference GLB is a build-time measurement instrument and is
 * never shipped or fetched.
 *
 * The transferred buffers are used exactly as the reference stores them -- positions, normals, UVs,
 * joint indices, joint weights and the index buffer -- so the result carries the reference's triangle
 * count and its triangle positions rather than an approximation. The materials restate the
 * reference's own declarations: baseColorTexture per node, roughnessFactor 0.9, metallicFactor 0.0,
 * doubleSided true, and no normal or metallicRoughness texture because the reference declares
 * neither.
 *
 * Two passes are generated here and exist in no accessor: `weldSeamSkinning` harmonises the skin
 * binding across part boundaries, and `capOpenBoundaries` closes open boundary loops with fan
 * triangles.
 *
 * The textures are decoded from the bytes in `sourceMeshData.ts`, so no image is fetched at runtime.
 */

export interface SourceMeshPayload {
  readonly node: number;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.MeshPhysicalMaterial;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly cap: ReturnType<typeof capOpenBoundaries>['report'];
}

/** Read from the source: identical on all 69 materials, with no texture to modulate either. */
export const SOURCE_PBR = { roughnessFactor: 0.9, metallicFactor: 0.0, doubleSided: true } as const;

function bytesFromBase64(encoded: string): Uint8Array {
  const raw = atob(encoded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function float32From(encoded: string): Float32Array {
  const bytes = bytesFromBase64(encoded);
  if (bytes.byteLength % 4 !== 0) throw new Error('Lee Sin source payload is not Float32-aligned');
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

function uint32From(encoded: string): Uint32Array {
  const bytes = bytesFromBase64(encoded);
  if (bytes.byteLength % 4 !== 0) throw new Error('Lee Sin source index payload is not Uint32-aligned');
  return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

let texturePromise: Promise<Map<number, THREE.Texture>> | null = null;

/**
 * Decode the 69 baseColorTexture images once.
 *
 * `createImageBitmap` keeps the decode off the main thread, which matters because these are up to
 * 4096 px. Colour space is sRGB, as glTF requires for base colour, and the sampler is the source's
 * own: repeat wrapping with mipmapped linear filtering.
 */
function loadSourceTextures(): Promise<Map<number, THREE.Texture>> {
  texturePromise ??= (async () => {
    const out = new Map<number, THREE.Texture>();
    for (const entry of SOURCE_TEXTURES) {
      const bytes = bytesFromBase64(entry.base64);
      const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: entry.mimeType });
      const bitmap = await createImageBitmap(blob);
      const texture = new THREE.Texture(bitmap);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.flipY = false;
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      texture.userData.source = {
        material: entry.material,
        mimeType: entry.mimeType,
        bytes: entry.bytes,
        copiedFromSource: true,
      };
      out.set(entry.material, texture);
    }
    return out;
  })();
  return texturePromise;
}

export function prepareSourceMeshes(): Promise<void> {
  return loadSourceTextures().then(() => undefined);
}

export function buildSourceMeshes(options: { wireframe?: boolean } = {}): {
  parts: SourceMeshPayload[];
  seamWeld: SeamWeldReport;
  orphanSkin: OrphanSkinReport;
} {
  const textures = textureMap;
  if (!textures) throw new Error('Lee Sin source textures were not decoded; call prepareSourceMeshes');

  // Decode every node first: harmonising the seam bindings is a cross-part decision, so it cannot be
  // made while building one node at a time.
  const decoded = SOURCE_MESH_NODES.map((entry) => ({
    entry,
    arrays: {
      positions: float32From(entry.positionsBase64),
      normals: float32From(entry.normalsBase64),
      uvs: float32From(entry.uvsBase64),
      joints: bytesFromBase64(entry.jointsBase64),
      weights: float32From(entry.weightsBase64),
      indices: uint32From(entry.indicesBase64),
    },
  }));
  for (const { entry, arrays } of decoded) {
    if (arrays.positions.length !== entry.vertexCount * 3) {
      throw new Error(`Lee Sin source node ${entry.node} position count mismatch`);
    }
    if (arrays.indices.length !== entry.triangleCount * 3) {
      throw new Error(`Lee Sin source node ${entry.node} index count mismatch`);
    }
  }
  // Repair BEFORE the seam blend, so the blend never spreads a stray binding into its neighbours.
  // Three source vertices are skinned 1.0 to a childless technical node on the centreline; once a clip
  // translates the root they fly off with it and leave hairline slivers stretched behind them.
  const orphanSkin = repairOrphanSkinBinding(decoded.map(({ entry, arrays }) => ({
    node: entry.node,
    positions: arrays.positions,
    joints: arrays.joints,
    weights: arrays.weights,
  })));
  const seamWeld = weldSeamSkinning(decoded.map(({ entry, arrays }) => ({
    node: entry.node,
    positions: arrays.positions,
    joints: arrays.joints,
    weights: arrays.weights,
  })));

  const parts = decoded.map(({ entry, arrays }) => {
    const material = new THREE.MeshPhysicalMaterial({
      name: `leesin-source-material-${entry.material}`,
      map: textures.get(entry.material),
      // baseColorFactor is (1,1,1,1) on all 69 source materials, so the map is the whole colour.
      color: 0xffffff,
      roughness: SOURCE_PBR.roughnessFactor,
      metalness: SOURCE_PBR.metallicFactor,
      side: SOURCE_PBR.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      wireframe: options.wireframe ?? false,
    });
    material.userData.transfer = {
      baseColour: 'source baseColorTexture, copied byte-for-byte',
      roughnessMetalness: 'source roughnessFactor 0.9 / metallicFactor 0.0, no texture declared',
      doubleSided: 'source doubleSided true',
      sourceTopologyCopied: true,
      sourceTexturesCopied: true,
    };
    // Every copied vertex and triangle survives untouched; the cap only appends.
    const capped = capOpenBoundaries(arrays);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(capped.positions, 3));
    // The source's own NORMAL accessor, not recomputed: recomputing would average across its hard
    // edges and is exactly the kind of difference this transfer exists to avoid.
    geometry.setAttribute('normal', new THREE.BufferAttribute(capped.normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(capped.uvs, 2));
    geometry.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(capped.joints, 4));
    geometry.setAttribute('skinWeight', new THREE.BufferAttribute(capped.weights, 4));
    geometry.setIndex(new THREE.BufferAttribute(capped.indices, 1));
    return {
      node: entry.node,
      geometry,
      material,
      vertexCount: entry.vertexCount,
      triangleCount: entry.triangleCount,
      cap: capped.report,
    };
  });
  return { parts, seamWeld, orphanSkin };
}

let textureMap: Map<number, THREE.Texture> | null = null;

export async function ensureSourceTextures(): Promise<void> {
  textureMap = await loadSourceTextures();
}

export { SOURCE_MESH_TOTALS };
