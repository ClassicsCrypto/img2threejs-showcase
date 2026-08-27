import * as THREE from 'three';
import { GLB_BINARY_BASE64, GLTF_SOURCE, SOURCE_BIN_SHA256, SOURCE_GLB_SHA256 } from './sourceData';
import { SOURCE_ANIMATION_CLIPS, SOURCE_ANIMATION_GLB_SHA256 } from './sourceAnimationData';

export interface RegretWarriorOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
}

type Source = Record<string, any>;
type TypedArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Uint32Array | Float32Array;
type TypedArrayConstructor = {
  new(length: number): TypedArray;
  new(buffer: ArrayBufferLike, byteOffset: number, length: number): TypedArray;
  readonly BYTES_PER_ELEMENT: number;
};

const COMPONENTS: Record<number, TypedArrayConstructor> = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};
const ITEMS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const ATTRIBUTE_NAMES: Record<string, string> = {
  POSITION: 'position', NORMAL: 'normal', TANGENT: 'tangent', TEXCOORD_0: 'uv', TEXCOORD_1: 'uv1',
  COLOR_0: 'color', JOINTS_0: 'skinIndex', WEIGHTS_0: 'skinWeight',
};

let decodedBinary: Uint8Array | undefined;

function binary(): Uint8Array {
  if (decodedBinary) return decodedBinary;
  const raw = atob(GLB_BINARY_BASE64);
  decodedBinary = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) decodedBinary[index] = raw.charCodeAt(index);
  return decodedBinary;
}

function readScalar(view: DataView, componentType: number, offset: number): number {
  switch (componentType) {
    case 5120: return view.getInt8(offset);
    case 5121: return view.getUint8(offset);
    case 5122: return view.getInt16(offset, true);
    case 5123: return view.getUint16(offset, true);
    case 5125: return view.getUint32(offset, true);
    case 5126: return view.getFloat32(offset, true);
    default: throw new Error(`Unsupported glTF component type ${componentType}`);
  }
}

function accessorArray(index: number): { array: TypedArray; itemSize: number; normalized: boolean } {
  const source = GLTF_SOURCE as Source;
  const accessor = source.accessors[index];
  if (accessor.sparse) throw new Error(`Sparse accessor ${index} was not admitted by the inventory`);
  const viewDef = source.bufferViews[accessor.bufferView];
  const Constructor = COMPONENTS[accessor.componentType];
  const itemSize = ITEMS[accessor.type];
  const count = accessor.count * itemSize;
  const componentBytes = Constructor.BYTES_PER_ELEMENT;
  const stride = viewDef.byteStride ?? itemSize * componentBytes;
  const start = (viewDef.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const out = new Constructor(count);
  const bytes = binary();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (stride === itemSize * componentBytes && start % componentBytes === 0) {
    const sourceArray = new Constructor(bytes.buffer, bytes.byteOffset + start, count);
    out.set(sourceArray as any);
  } else {
    for (let element = 0; element < accessor.count; element += 1) {
      const elementStart = start + element * stride;
      for (let lane = 0; lane < itemSize; lane += 1) {
        out[element * itemSize + lane] = readScalar(view, accessor.componentType, elementStart + lane * componentBytes);
      }
    }
  }
  return { array: out, itemSize, normalized: accessor.normalized === true };
}

function createAccessor(index: number): THREE.BufferAttribute {
  const value = accessorArray(index);
  return new THREE.BufferAttribute(value.array, value.itemSize, value.normalized);
}

function filter(value: number | undefined, fallback: THREE.MagnificationTextureFilter | THREE.MinificationTextureFilter) {
  const filters: Record<number, THREE.MagnificationTextureFilter | THREE.MinificationTextureFilter> = {
    9728: THREE.NearestFilter, 9729: THREE.LinearFilter, 9984: THREE.NearestMipmapNearestFilter,
    9985: THREE.LinearMipmapNearestFilter, 9986: THREE.NearestMipmapLinearFilter, 9987: THREE.LinearMipmapLinearFilter,
  };
  return value === undefined ? fallback : filters[value];
}

function wrapping(value: number | undefined): THREE.Wrapping {
  if (value === 33071) return THREE.ClampToEdgeWrapping;
  if (value === 33648) return THREE.MirroredRepeatWrapping;
  return THREE.RepeatWrapping;
}

const textureCache = new Map<string, THREE.Texture>();

function createTexture(index: number, colorSpace: THREE.ColorSpace, texCoord = 0): THREE.Texture {
  const cacheKey = `${index}:${colorSpace}:${texCoord}`;
  const cached = textureCache.get(cacheKey);
  if (cached) return cached;
  const source = GLTF_SOURCE as Source;
  const textureDef = source.textures[index];
  const imageDef = source.images[textureDef.source];
  const bufferView = source.bufferViews[imageDef.bufferView];
  const start = bufferView.byteOffset ?? 0;
  const encoded = binary().slice(start, start + bufferView.byteLength);
  const image = new Image();
  const texture = new THREE.Texture(image);
  texture.name = imageDef.name ?? `source-image-${textureDef.source}`;
  texture.flipY = false;
  texture.colorSpace = colorSpace;
  texture.channel = texCoord;
  const sampler = source.samplers?.[textureDef.sampler ?? -1] ?? {};
  texture.magFilter = filter(sampler.magFilter, THREE.LinearFilter) as THREE.MagnificationTextureFilter;
  texture.minFilter = filter(sampler.minFilter, THREE.LinearMipmapLinearFilter) as THREE.MinificationTextureFilter;
  texture.wrapS = wrapping(sampler.wrapS);
  texture.wrapT = wrapping(sampler.wrapT);
  texture.generateMipmaps = ![THREE.NearestFilter, THREE.LinearFilter].includes(texture.minFilter as any);
  texture.userData = { gltfTextureIndex: index, gltfImageIndex: textureDef.source, source: textureDef };
  const url = URL.createObjectURL(new Blob([encoded], { type: imageDef.mimeType }));
  image.onload = () => {
    texture.needsUpdate = true;
    URL.revokeObjectURL(url);
  };
  image.onerror = () => URL.revokeObjectURL(url);
  image.src = url;
  textureCache.set(cacheKey, texture);
  return texture;
}

function applyTextureTransform(texture: THREE.Texture, info: Source): void {
  const transform = info.extensions?.KHR_texture_transform;
  if (!transform) return;
  if (transform.offset) texture.offset.fromArray(transform.offset);
  if (transform.scale) texture.repeat.fromArray(transform.scale);
  if (transform.rotation !== undefined) texture.rotation = transform.rotation;
  if (transform.texCoord !== undefined) texture.channel = transform.texCoord;
  texture.matrixAutoUpdate = true;
}

function textureFromInfo(info: Source | undefined, colorSpace: THREE.ColorSpace): THREE.Texture | null {
  if (!info) return null;
  const texture = createTexture(info.index, colorSpace, info.texCoord ?? 0);
  applyTextureTransform(texture, info);
  return texture;
}

function createMaterial(index: number): THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial {
  const source = GLTF_SOURCE as Source;
  const value = source.materials[index] ?? {};
  const pbr = value.pbrMetallicRoughness ?? {};
  const physical = value.extensions?.KHR_materials_clearcoat
    || value.extensions?.KHR_materials_transmission
    || value.extensions?.KHR_materials_ior
    || value.extensions?.KHR_materials_sheen;
  const material = physical ? new THREE.MeshPhysicalMaterial() : new THREE.MeshStandardMaterial();
  const factor = pbr.baseColorFactor ?? [1, 1, 1, 1];
  material.name = value.name ?? `source-material-${index}`;
  material.color.fromArray(factor);
  material.opacity = factor[3];
  material.metalness = pbr.metallicFactor ?? 1;
  material.roughness = pbr.roughnessFactor ?? 1;
  material.map = textureFromInfo(pbr.baseColorTexture, THREE.SRGBColorSpace);
  const packed = textureFromInfo(pbr.metallicRoughnessTexture, THREE.NoColorSpace);
  material.metalnessMap = packed;
  material.roughnessMap = packed;
  material.normalMap = textureFromInfo(value.normalTexture, THREE.NoColorSpace);
  if (value.normalTexture?.scale !== undefined) material.normalScale.setScalar(value.normalTexture.scale);
  material.aoMap = textureFromInfo(value.occlusionTexture, THREE.NoColorSpace);
  material.aoMapIntensity = value.occlusionTexture?.strength ?? 1;
  const emissive = value.emissiveFactor ?? [0, 0, 0];
  material.emissive.fromArray(emissive);
  material.emissiveMap = textureFromInfo(value.emissiveTexture, THREE.SRGBColorSpace);
  material.side = value.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
  material.transparent = value.alphaMode === 'BLEND';
  material.alphaTest = value.alphaMode === 'MASK' ? (value.alphaCutoff ?? 0.5) : 0;
  material.depthWrite = value.alphaMode !== 'BLEND';
  if (material instanceof THREE.MeshPhysicalMaterial) {
    const clearcoat = value.extensions?.KHR_materials_clearcoat;
    if (clearcoat) {
      material.clearcoat = clearcoat.clearcoatFactor ?? 0;
      material.clearcoatRoughness = clearcoat.clearcoatRoughnessFactor ?? 0;
      material.clearcoatMap = textureFromInfo(clearcoat.clearcoatTexture, THREE.NoColorSpace);
      material.clearcoatRoughnessMap = textureFromInfo(clearcoat.clearcoatRoughnessTexture, THREE.NoColorSpace);
      material.clearcoatNormalMap = textureFromInfo(clearcoat.clearcoatNormalTexture, THREE.NoColorSpace);
    }
    const transmission = value.extensions?.KHR_materials_transmission;
    if (transmission) {
      material.transmission = transmission.transmissionFactor ?? 0;
      material.transmissionMap = textureFromInfo(transmission.transmissionTexture, THREE.NoColorSpace);
    }
    if (value.extensions?.KHR_materials_ior) material.ior = value.extensions.KHR_materials_ior.ior ?? 1.5;
  }
  material.userData = { gltfMaterialIndex: index, gltfSource: value };
  return material;
}

function createGeometry(primitive: Source): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  for (const [semantic, accessor] of Object.entries(primitive.attributes ?? {})) {
    const attributeName = ATTRIBUTE_NAMES[semantic];
    if (attributeName) geometry.setAttribute(attributeName, createAccessor(accessor as number));
  }
  if (primitive.indices !== undefined) geometry.setIndex(createAccessor(primitive.indices));
  const morphSemantic: Record<string, string> = { POSITION: 'position', NORMAL: 'normal', TANGENT: 'tangent' };
  for (const target of primitive.targets ?? []) {
    for (const [semantic, accessor] of Object.entries(target)) {
      const name = morphSemantic[semantic];
      if (name) (geometry.morphAttributes[name] ??= []).push(createAccessor(accessor as number));
    }
  }
  geometry.morphTargetsRelative = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.gltfPrimitive = primitive;
  return geometry;
}

type RigChain = 'root-core' | 'head-chain' | 'positive-x-leg-chain' | 'negative-x-leg-chain'
  | 'positive-x-arm-chain' | 'negative-x-arm-chain' | 'neutral-chain' | 'authored-cloth-chain';

const RIG_CHAIN_JOINTS: Record<RigChain, readonly number[]> = {
  'root-core': [0, 1, 2, 19, 20, 21],
  'head-chain': [22, 23, 24],
  'positive-x-leg-chain': [3, 4, 5, 6, 7, 8, 9, 10],
  'negative-x-leg-chain': [11, 12, 13, 14, 15, 16, 17, 18],
  'positive-x-arm-chain': [25, 26, 27, 28, 29, 30, 31, 32],
  'negative-x-arm-chain': [33, 34, 35, 36, 37, 38, 39, 40],
  'neutral-chain': [41],
  'authored-cloth-chain': [42, 43],
};

const RIG_CHAIN_BY_JOINT = new Map<number, RigChain>(
  Object.entries(RIG_CHAIN_JOINTS).flatMap(([chain, joints]) => joints.map((joint) => [joint, chain as RigChain])),
);
const RIG_CHAIN_CODE: Record<RigChain, number> = {
  'root-core': 0,
  'head-chain': 1,
  'positive-x-leg-chain': 2,
  'negative-x-leg-chain': 3,
  'positive-x-arm-chain': 4,
  'negative-x-arm-chain': 5,
  'neutral-chain': 6,
  'authored-cloth-chain': 7,
};

interface SkinCorrectionReport {
  componentCount: number;
  reassignedComponentCount: number;
  crossChainVertexCountBefore: number;
  crossChainVertexCountAfter: number;
  removedForeignWeight: number;
  fallbackVertexCount: number;
  rigidComponentCount: number;
  handZoneComponentCount: number;
  garmentCoreComponentCount: number;
  authoredClothComponentCount: number;
  authoredClothVertexCount: number;
  swordComponentCount: number;
  productionSwordSeedVertexCount: number;
  productionSwordVertexCount: number;
  userConfirmedMesh5ComponentCount: number;
  userConfirmedMesh5VertexCount: number;
  userConfirmedMesh5ArmComponentCountBefore: number;
  weldedContinuityApplied: number;
  indexedComponentCountBeforeWeld: number;
  weldedComponentCountAfter: number;
  synchronizedSeamGroupCount: number;
  synchronizedSeamVertexCount: number;
  globalSeamSynchronizationApplied: number;
  resolvedCrossChainSeamGroupCount: number;
  resolvedCrossChainSeamVertexCount: number;
}

interface AuthoredSecondaryRig {
  bones: THREE.Bone[];
  measurement: {
    parent: string;
    pivots: number[][];
    measuredRegion: string;
  };
}

function appendAuthoredClothBones(bones: THREE.Bone[], inverses: THREE.Matrix4[]): AuthoredSecondaryRig {
  if (bones.length !== 42) throw new Error(`Expected verified 42-joint source rig before cloth extension, got ${bones.length}`);
  const parent = bones.find((bone) => bone.name === 'Spine02') ?? bones[2];
  const pivots = [[0.055, 0.60, -0.08], [0.095, 0.49, -0.27]];
  const authored: THREE.Bone[] = [];
  let chainParent: THREE.Bone = parent;
  pivots.forEach((pivot, index) => {
      const bone = new THREE.Bone();
      bone.name = `Authored_ScarfTail_${index === 0 ? 'Base' : 'Tip'}`;
      const worldPivot = new THREE.Vector3().fromArray(pivot);
      bone.position.copy(chainParent.worldToLocal(worldPivot.clone()));
      bone.userData = {
        classification: 'new-authored-secondary-rig',
        measuredWorldPivot: pivot,
        measuredRegion: 'render-confirmed trailing cloth: z < -0.06, 0.34 < y < 0.72',
      };
      chainParent.add(bone);
      bone.updateMatrixWorld(true);
      bones.push(bone);
      inverses.push(bone.matrixWorld.clone().invert());
      authored.push(bone);
      chainParent = bone;
  });
  return {
    bones: authored,
    measurement: {
      parent: parent.name,
      pivots,
      measuredRegion: 'render-confirmed trailing cloth: z < -0.06, 0.34 < y < 0.72',
    },
  };
}

function indexedComponents(geometry: THREE.BufferGeometry, weldTolerance = 0): number[][] {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const indices = index
    ? Array.from({ length: index.count }, (_, offset) => index.getX(offset))
    : Array.from({ length: position.count }, (_, offset) => offset);
  const parent = Array.from({ length: position.count }, (_, value) => value);
  const find = (start: number): number => {
    let value = start;
    while (parent[value] !== value) {
      parent[value] = parent[parent[value]];
      value = parent[value];
    }
    return value;
  };
  const union = (a: number, b: number): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };
  const used = new Set<number>();
  for (let offset = 0; offset + 2 < indices.length; offset += 3) {
    const a = indices[offset];
    const b = indices[offset + 1];
    const c = indices[offset + 2];
    used.add(a); used.add(b); used.add(c);
    union(a, b); union(b, c);
  }
  if (weldTolerance > 0) {
    const buckets = new Map<string, number>();
    for (const vertex of used) {
      const key = [0, 1, 2].map((axis) => Math.round(
        position.getComponent(vertex, axis) / weldTolerance,
      )).join(':');
      const existing = buckets.get(key);
      if (existing === undefined) buckets.set(key, vertex);
      else union(existing, vertex);
    }
  }
  const groups = new Map<number, number[]>();
  for (const vertex of [...used].sort((a, b) => a - b)) {
    const root = find(vertex);
    const group = groups.get(root) ?? [];
    group.push(vertex);
    groups.set(root, group);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length || a[0] - b[0]);
}

function synchronizeCoincidentSkinWeights(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  skinIndices: Uint8Array,
  skinWeights: Float32Array,
  chains: Uint8Array,
  tolerance: number,
): {
  groupCount: number;
  vertexCount: number;
  resolvedCrossChainGroupCount: number;
  resolvedCrossChainVertexCount: number;
} {
  const buckets = new Map<string, number[]>();
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const key = [0, 1, 2].map((axis) => Math.round(
      position.getComponent(vertex, axis) / tolerance,
    )).join(':');
    const group = buckets.get(key) ?? [];
    group.push(vertex);
    buckets.set(key, group);
  }
  let groupCount = 0;
  let vertexCount = 0;
  let resolvedCrossChainGroupCount = 0;
  let resolvedCrossChainVertexCount = 0;
  for (const vertices of buckets.values()) {
    if (vertices.length < 2) continue;
    const chainCounts = new Map<number, number>();
    for (const vertex of vertices) {
      const chain = chains[vertex];
      chainCounts.set(chain, (chainCounts.get(chain) ?? 0) + 1);
    }
    const targetChain = [...chainCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    if (chainCounts.size > 1) {
      resolvedCrossChainGroupCount += 1;
      resolvedCrossChainVertexCount += vertices.length;
    }
    const jointWeights = new Map<number, number>();
    for (const vertex of vertices) {
      for (let lane = 0; lane < 4; lane += 1) {
        const weight = skinWeights[vertex * 4 + lane];
        if (weight <= 1e-8) continue;
        const joint = skinIndices[vertex * 4 + lane];
        if (RIG_CHAIN_CODE[RIG_CHAIN_BY_JOINT.get(joint) ?? 'neutral-chain'] !== targetChain) continue;
        jointWeights.set(joint, (jointWeights.get(joint) ?? 0) + weight);
      }
    }
    const influences = [...jointWeights.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 4);
    const normalization = influences.reduce((sum, [, weight]) => sum + weight, 0) || 1;
    for (const vertex of vertices) {
      chains[vertex] = targetChain;
      for (let lane = 0; lane < 4; lane += 1) {
        skinIndices[vertex * 4 + lane] = influences[lane]?.[0] ?? 0;
        skinWeights[vertex * 4 + lane] = influences[lane] ? influences[lane][1] / normalization : 0;
      }
    }
    groupCount += 1;
    vertexCount += vertices.length;
  }
  return {
    groupCount,
    vertexCount,
    resolvedCrossChainGroupCount,
    resolvedCrossChainVertexCount,
  };
}

function subsetGeometry(source: THREE.BufferGeometry, sourceIndices: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const used = [...new Set(sourceIndices)].sort((a, b) => a - b);
  const remap = new Map(used.map((vertex, index) => [vertex, index]));
  for (const [name, sourceAttribute] of Object.entries(source.attributes)) {
    if (sourceAttribute instanceof THREE.InterleavedBufferAttribute) {
      throw new Error(`Interleaved attribute ${name} is unsupported by the admitted Mesh_5 partition`);
    }
    const Constructor = sourceAttribute.array.constructor as TypedArrayConstructor;
    const array = new Constructor(used.length * sourceAttribute.itemSize);
    for (let targetVertex = 0; targetVertex < used.length; targetVertex += 1) {
      const sourceVertex = used[targetVertex];
      for (let lane = 0; lane < sourceAttribute.itemSize; lane += 1) {
        array[targetVertex * sourceAttribute.itemSize + lane] = sourceAttribute.array[
          sourceVertex * sourceAttribute.itemSize + lane
        ];
      }
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(array, sourceAttribute.itemSize, sourceAttribute.normalized));
  }
  for (const [name, sourceTargets] of Object.entries(source.morphAttributes)) {
    geometry.morphAttributes[name] = sourceTargets.map((sourceAttribute) => {
      if (sourceAttribute instanceof THREE.InterleavedBufferAttribute) {
        throw new Error(`Interleaved morph attribute ${name} is unsupported by the admitted Mesh_5 partition`);
      }
      const Constructor = sourceAttribute.array.constructor as TypedArrayConstructor;
      const array = new Constructor(used.length * sourceAttribute.itemSize);
      for (let targetVertex = 0; targetVertex < used.length; targetVertex += 1) {
        const sourceVertex = used[targetVertex];
        for (let lane = 0; lane < sourceAttribute.itemSize; lane += 1) {
          array[targetVertex * sourceAttribute.itemSize + lane] = sourceAttribute.array[
            sourceVertex * sourceAttribute.itemSize + lane
          ];
        }
      }
      return new THREE.BufferAttribute(array, sourceAttribute.itemSize, sourceAttribute.normalized);
    });
  }
  const RemappedIndex = used.length > 65535 ? Uint32Array : Uint16Array;
  geometry.setIndex(new THREE.BufferAttribute(
    new RemappedIndex(sourceIndices.map((vertex) => remap.get(vertex)!)),
    1,
  ));
  const inheritedSourceVertexIndex = source.getAttribute('sourceVertexIndex');
  const sourceVertexIndices = inheritedSourceVertexIndex
    ? used.map((vertex) => inheritedSourceVertexIndex.getX(vertex))
    : used;
  geometry.setAttribute('sourceVertexIndex', new THREE.Uint32BufferAttribute(sourceVertexIndices, 1));
  geometry.morphTargetsRelative = source.morphTargetsRelative;
  geometry.userData = {...source.userData};
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function copySkinnedMeshPartition(
  mesh: THREE.SkinnedMesh,
  skeleton: THREE.Skeleton,
  geometry: THREE.BufferGeometry,
  name: string,
  userData: Record<string, unknown>,
): THREE.SkinnedMesh {
  const partition = new THREE.SkinnedMesh(geometry, mesh.material);
  partition.name = name;
  partition.position.copy(mesh.position);
  partition.quaternion.copy(mesh.quaternion);
  partition.scale.copy(mesh.scale);
  partition.matrix.copy(mesh.matrix);
  partition.matrixAutoUpdate = mesh.matrixAutoUpdate;
  partition.castShadow = mesh.castShadow;
  partition.receiveShadow = mesh.receiveShadow;
  partition.frustumCulled = mesh.frustumCulled;
  partition.userData = {...mesh.userData, ...userData};
  partition.morphTargetInfluences = mesh.morphTargetInfluences ? [...mesh.morphTargetInfluences] : undefined;
  partition.bind(skeleton, mesh.bindMatrix);
  return partition;
}

function splitUserConfirmedMesh5(mesh: THREE.SkinnedMesh, skeleton: THREE.Skeleton): THREE.SkinnedMesh[] {
  if (mesh.userData.gltfMeshIndex !== 5) return [mesh];
  const index = mesh.geometry.getIndex();
  const chain = mesh.geometry.getAttribute('skinCorrectionChain');
  if (!index || !chain) throw new Error('User-confirmed Mesh_5 partition requires indexed geometry and skinCorrectionChain');
  const trianglesByChain = new Map<number, number[]>();
  for (let offset = 0; offset + 2 < index.count; offset += 3) {
    const triangle = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
    const codes = triangle.map((vertex) => chain.getX(vertex));
    if (!codes.every((code) => code === codes[0])) {
      throw new Error(`Mesh_5 triangle ${offset / 3} crosses corrected anatomical chains`);
    }
    const indices = trianglesByChain.get(codes[0]) ?? [];
    indices.push(...triangle);
    trianglesByChain.set(codes[0], indices);
  }
  const chainNameByCode = Object.fromEntries(Object.entries(RIG_CHAIN_CODE).map(([name, code]) => [code, name]));
  return [...trianglesByChain.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([code, sourceIndices]) => {
      return copySkinnedMeshPartition(
        mesh,
        skeleton,
        subsetGeometry(mesh.geometry, sourceIndices),
        `${mesh.name}-partition-${chainNameByCode[code]}`,
        {
        physicalSourceMesh: mesh.name,
        rigPartition: chainNameByCode[code],
        partitionReason: 'user-confirmed Mesh_5 clothing separation',
        },
      );
    });
}

function splitSwordAttachment(mesh: THREE.SkinnedMesh, skeleton: THREE.Skeleton): THREE.SkinnedMesh[] {
  const index = mesh.geometry.getIndex();
  const swordMask = mesh.geometry.getAttribute('productionSwordMask');
  if (!index || !swordMask) throw new Error(`Sword partition requires indexed productionSwordMask geometry on ${mesh.name}`);
  const bodyIndices: number[] = [];
  const swordIndices: number[] = [];
  for (let offset = 0; offset + 2 < index.count; offset += 3) {
    const triangle = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
    const selected = triangle.map((vertex) => swordMask.getX(vertex) > 0.5);
    if (!selected.every((value) => value === selected[0])) {
      throw new Error(`Sword partition triangle ${offset / 3} crosses the measured weapon boundary on ${mesh.name}`);
    }
    (selected[0] ? swordIndices : bodyIndices).push(...triangle);
  }
  if (swordIndices.length === 0) return [mesh];
  const meshIndex = Number(mesh.userData.gltfMeshIndex);
  const primitiveIndex = Number(mesh.userData.gltfPrimitiveIndex);
  const swordName = `regret-warrior-sword-partition-${meshIndex}-${primitiveIndex}`;
  if (bodyIndices.length === 0) {
    mesh.name = swordName;
    mesh.userData = {
      ...mesh.userData,
      physicalSourceMesh: mesh.userData.physicalSourceMesh ?? mesh.name,
      rigPartition: 'sword-attachment',
      partitionReason: 'measured productionSwordMask visibility isolation',
      animationVisibilityGroup: 'sword',
    };
    return [mesh];
  }
  const body = copySkinnedMeshPartition(
    mesh,
    skeleton,
    subsetGeometry(mesh.geometry, bodyIndices),
    `${mesh.name}-non-sword`,
    {
      physicalSourceMesh: mesh.userData.physicalSourceMesh ?? mesh.name,
      rigPartition: mesh.userData.rigPartition ?? 'body-or-garment',
      partitionReason: 'measured productionSwordMask visibility isolation',
      animationVisibilityGroup: 'character',
    },
  );
  const sword = copySkinnedMeshPartition(
    mesh,
    skeleton,
    subsetGeometry(mesh.geometry, swordIndices),
    swordName,
    {
      physicalSourceMesh: mesh.userData.physicalSourceMesh ?? mesh.name,
      rigPartition: 'sword-attachment',
      partitionReason: 'measured productionSwordMask visibility isolation',
      animationVisibilityGroup: 'sword',
    },
  );
  return [body, sword];
}

function correctSkinWeightLeakage(mesh: THREE.SkinnedMesh, skeleton: THREE.Skeleton): SkinCorrectionReport {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const sourceIndices = geometry.getAttribute('skinIndex');
  const sourceWeights = geometry.getAttribute('skinWeight');
  if (!position || !sourceIndices || !sourceWeights) throw new Error(`Skinned mesh ${mesh.name} lacks source skin attributes`);
  geometry.setAttribute('sourceSkinIndex', sourceIndices.clone());
  geometry.setAttribute('sourceSkinWeight', sourceWeights.clone());
  const correctedIndices = new Uint8Array(position.count * 4);
  const correctedWeights = new Float32Array(position.count * 4);
  const productionIndices = new Uint8Array(position.count * 4);
  const productionWeights = new Float32Array(position.count * 4);
  const productionSwordMask = new Uint8Array(position.count);
  const correctedChains = new Uint8Array(position.count);
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    for (let lane = 0; lane < 4; lane += 1) {
      productionIndices[vertex * 4 + lane] = sourceIndices.getComponent(vertex, lane);
      productionWeights[vertex * 4 + lane] = sourceWeights.getComponent(vertex, lane);
    }
  }
  const bonePositions = skeleton.bones.map((bone) => bone.getWorldPosition(new THREE.Vector3()));
  const local = new THREE.Vector3();
  const world = new THREE.Vector3();
  const report: SkinCorrectionReport = {
    componentCount: 0,
    reassignedComponentCount: 0,
    crossChainVertexCountBefore: 0,
    crossChainVertexCountAfter: 0,
    removedForeignWeight: 0,
    fallbackVertexCount: 0,
    rigidComponentCount: 0,
    handZoneComponentCount: 0,
    garmentCoreComponentCount: 0,
    authoredClothComponentCount: 0,
    authoredClothVertexCount: 0,
    swordComponentCount: 0,
    productionSwordSeedVertexCount: 0,
    productionSwordVertexCount: 0,
    userConfirmedMesh5ComponentCount: 0,
    userConfirmedMesh5VertexCount: 0,
    userConfirmedMesh5ArmComponentCountBefore: 0,
    weldedContinuityApplied: 0,
    indexedComponentCountBeforeWeld: 0,
    weldedComponentCountAfter: 0,
    synchronizedSeamGroupCount: 0,
    synchronizedSeamVertexCount: 0,
    globalSeamSynchronizationApplied: 0,
    resolvedCrossChainSeamGroupCount: 0,
    resolvedCrossChainSeamVertexCount: 0,
  };
  const readInfluences = (
    vertex: number,
    countCrossChain = false,
  ): Array<{ joint: number; weight: number; chain: RigChain }> => {
    const values: Array<{ joint: number; weight: number; chain: RigChain }> = [];
    const activeChains = new Set<RigChain>();
    for (let lane = 0; lane < 4; lane += 1) {
      const joint = sourceIndices.getComponent(vertex, lane);
      const weight = sourceWeights.getComponent(vertex, lane);
      if (weight <= 1e-6) continue;
      const chain = RIG_CHAIN_BY_JOINT.get(joint);
      if (!chain) throw new Error(`Source joint ordinal ${joint} is outside the verified 42-joint partition`);
      activeChains.add(chain);
      values.push({ joint, weight, chain });
    }
    if (countCrossChain && activeChains.size > 1) report.crossChainVertexCountBefore += 1;
    return values;
  };
  const nearestJoint = (point: THREE.Vector3, chain: RigChain): number => {
    let best = RIG_CHAIN_JOINTS[chain][0];
    let bestDistance = Infinity;
    for (const joint of RIG_CHAIN_JOINTS[chain]) {
      const distance = point.distanceToSquared(bonePositions[joint]);
      if (distance < bestDistance) {
        best = joint;
        bestDistance = distance;
      }
    }
    return best;
  };
  const preserveWeldedContinuity = mesh.userData.gltfMeshIndex === 39 || mesh.userData.gltfMeshIndex === 46;
  const indexed = indexedComponents(geometry);
  const components = preserveWeldedContinuity ? indexedComponents(geometry, 1e-7) : indexed;
  if (preserveWeldedContinuity) {
    report.weldedContinuityApplied = 1;
    report.indexedComponentCountBeforeWeld = indexed.length;
    report.weldedComponentCountAfter = components.length;
  }
  for (const vertices of components) {
    report.componentCount += 1;
    const minimum = new THREE.Vector3(Infinity, Infinity, Infinity);
    const maximum = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const center = new THREE.Vector3();
    const chainMass = new Map<RigChain, number>();
    const jointMass = new Map<number, number>();
    for (const vertex of vertices) {
      local.fromBufferAttribute(position, vertex);
      world.copy(local).applyMatrix4(mesh.matrixWorld);
      minimum.min(world);
      maximum.max(world);
      center.add(world);
      for (const influence of readInfluences(vertex, true)) {
        chainMass.set(influence.chain, (chainMass.get(influence.chain) ?? 0) + influence.weight);
        jointMass.set(influence.joint, (jointMass.get(influence.joint) ?? 0) + influence.weight);
      }
    }
    center.multiplyScalar(1 / vertices.length);
    const size = maximum.clone().sub(minimum);
    const ranked = [...chainMass.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const sourceDominant = ranked[0]?.[0] ?? 'neutral-chain';
    const mass = (chain: RigChain) => chainMass.get(chain) ?? 0;
    const positiveHand = center.x > 0.075 && center.y > 0.40 && center.y < 0.59 && center.z > 0.105
      && mass('positive-x-arm-chain') > vertices.length * 0.10;
    const negativeHand = center.x < -0.075 && center.y > 0.46 && center.y < 0.66 && center.z > 0.085
      && mass('negative-x-arm-chain') > vertices.length * 0.10;
    // Spatial position alone previously classified much of the negative-X leg
    // and lower garment as "sword", then rigid-bound those islands to R_Hand.
    // Require the measured source skin payload to already be overwhelmingly
    // on the negative-X arm chain and specifically on the R_Hand joint.
    const sword = center.x < -0.115 && center.y < 0.58
      && mass('negative-x-arm-chain') > vertices.length * 0.85
      && (jointMass.get(40) ?? 0) > vertices.length * 0.50;
    const trailingCloth = center.z < -0.06 && center.y > 0.34 && center.y < 0.72 && !sword;
    const userConfirmedMesh5Clothing = mesh.userData.gltfMeshIndex === 5 && center.y > 0.34;
    let target: RigChain = sourceDominant;
    if (center.y > 0.74) target = 'head-chain';
    else if (sword || negativeHand) target = 'negative-x-arm-chain';
    else if (positiveHand) target = 'positive-x-arm-chain';
    else if (trailingCloth) target = 'authored-cloth-chain';
    else if (Math.abs(center.x) < 0.065 && center.y > 0.43 && center.y < 0.73) target = 'root-core';
    else if (center.x > 0.055 && center.y > 0.58 && mass('positive-x-arm-chain') > vertices.length * 0.10) {
      target = 'positive-x-arm-chain';
    } else if (center.x < -0.03 && center.y > 0.55 && mass('negative-x-arm-chain') > vertices.length * 0.10) {
      target = 'negative-x-arm-chain';
    } else if (center.y < 0.50 && target !== 'neutral-chain') {
      target = center.x >= 0 ? 'positive-x-leg-chain' : 'negative-x-leg-chain';
    }
    if (userConfirmedMesh5Clothing) {
      report.userConfirmedMesh5ComponentCount += 1;
      report.userConfirmedMesh5VertexCount += vertices.length;
      if (sourceDominant === 'positive-x-arm-chain' || positiveHand) {
        report.userConfirmedMesh5ArmComponentCountBefore += 1;
      }
      target = 'root-core';
    }
    if (target !== sourceDominant) report.reassignedComponentCount += 1;
    if ((positiveHand || negativeHand) && !userConfirmedMesh5Clothing) report.handZoneComponentCount += 1;
    if (target === 'root-core' && center.y > 0.43) report.garmentCoreComponentCount += 1;
    if (trailingCloth) {
      report.authoredClothComponentCount += 1;
      report.authoredClothVertexCount += vertices.length;
    }
    if (sword) report.swordComponentCount += 1;
    const rigid = sword || trailingCloth || vertices.length <= 32 || Math.max(size.x, size.y, size.z) < 0.025;
    if (rigid) report.rigidComponentCount += 1;
    let rigidJoint = nearestJoint(center, target);
    if (positiveHand && !userConfirmedMesh5Clothing) rigidJoint = 30;
    if (negativeHand || sword) rigidJoint = 40;
    if (trailingCloth) rigidJoint = 42;
    if (center.y > 0.74 && target === 'head-chain') rigidJoint = 24;
    if (!rigid) {
      const allowedJointMass = [...jointMass.entries()]
        .filter(([joint]) => RIG_CHAIN_BY_JOINT.get(joint) === target)
        .sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      if (allowedJointMass.length > 0 && allowedJointMass[0][1] / vertices.length > 0.75) {
        rigidJoint = allowedJointMass[0][0];
      }
    }
    for (const vertex of vertices) {
      correctedChains[vertex] = RIG_CHAIN_CODE[target];
      const influences = readInfluences(vertex);
      const allowed = influences.filter((influence) => influence.chain === target);
      const allowedSum = allowed.reduce((sum, influence) => sum + influence.weight, 0);
      report.removedForeignWeight += influences
        .filter((influence) => influence.chain !== target)
        .reduce((sum, influence) => sum + influence.weight, 0);
      let finalInfluences: Array<{ joint: number; weight: number }>;
      if (trailingCloth) {
        finalInfluences = [{ joint: 42, weight: 0.85 }, { joint: 43, weight: 0.15 }];
      } else if (rigid) {
        finalInfluences = [{ joint: rigidJoint, weight: 1 }];
      } else if (allowedSum > 0.15) {
        finalInfluences = allowed.map(({ joint, weight }) => ({ joint, weight: weight / allowedSum }));
      } else {
        local.fromBufferAttribute(position, vertex);
        world.copy(local).applyMatrix4(mesh.matrixWorld);
        finalInfluences = [{ joint: nearestJoint(world, target), weight: 1 }];
        report.fallbackVertexCount += 1;
      }
      finalInfluences.sort((a, b) => b.weight - a.weight || a.joint - b.joint);
      const normalization = finalInfluences.reduce((sum, influence) => sum + influence.weight, 0) || 1;
      for (let lane = 0; lane < 4; lane += 1) {
        const influence = finalInfluences[lane];
        correctedIndices[vertex * 4 + lane] = influence?.joint ?? 0;
        correctedWeights[vertex * 4 + lane] = influence ? influence.weight / normalization : 0;
      }
      // The weapon is a rigid attachment, not a deformable body surface. Keep
      // production body weights byte-for-byte from the source, but bind every
      // vertex of each measured sword component entirely to R_Hand so the
      // blade, guard, grip, and gem cannot shear apart during animation.
      if (sword) {
        productionIndices[vertex * 4] = 40;
        productionWeights[vertex * 4] = 1;
        for (let lane = 1; lane < 4; lane += 1) {
          productionIndices[vertex * 4 + lane] = 0;
          productionWeights[vertex * 4 + lane] = 0;
        }
        productionSwordMask[vertex] = 1;
        report.productionSwordSeedVertexCount += 1;
      }
    }
  }
  // The exported sword uses duplicated vertices at material/UV seams. Expand
  // each measured seed across its welded indexed surface so coincident copies
  // and every triangle in that continuous weapon component receive one rigid
  // transform. This avoids a one-selected/two-unselected seam such as the
  // measured Mesh_66 vertices 627/628/629 failure.
  for (const weldedVertices of indexedComponents(geometry, 1e-7)) {
    if (!weldedVertices.some((vertex) => productionSwordMask[vertex] === 1)) continue;
    for (const vertex of weldedVertices) {
      productionIndices[vertex * 4] = 40;
      productionWeights[vertex * 4] = 1;
      for (let lane = 1; lane < 4; lane += 1) {
        productionIndices[vertex * 4 + lane] = 0;
        productionWeights[vertex * 4 + lane] = 0;
      }
      productionSwordMask[vertex] = 1;
    }
  }
  report.productionSwordVertexCount = productionSwordMask.reduce((sum, selected) => sum + selected, 0);
  const synchronizeSurfaceSeams = mesh.userData.gltfMeshIndex !== 5;
  if (synchronizeSurfaceSeams) {
    const synchronized = synchronizeCoincidentSkinWeights(
      position,
      correctedIndices,
      correctedWeights,
      correctedChains,
      1e-7,
    );
    report.synchronizedSeamGroupCount = synchronized.groupCount;
    report.synchronizedSeamVertexCount = synchronized.vertexCount;
    report.globalSeamSynchronizationApplied = 1;
    report.resolvedCrossChainSeamGroupCount = synchronized.resolvedCrossChainGroupCount;
    report.resolvedCrossChainSeamVertexCount = synchronized.resolvedCrossChainVertexCount;
  }
  geometry.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(correctedIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(correctedWeights, 4));
  geometry.setAttribute('productionSkinIndex', new THREE.Uint8BufferAttribute(productionIndices, 4));
  geometry.setAttribute('productionSkinWeight', new THREE.Float32BufferAttribute(productionWeights, 4));
  geometry.setAttribute('productionSwordMask', new THREE.Uint8BufferAttribute(productionSwordMask, 1));
  geometry.setAttribute('skinCorrectionChain', new THREE.Uint8BufferAttribute(correctedChains, 1));
  geometry.userData.skinWeightCorrection = {
    method: 'source-preserving production skin with measured rigid R_Hand sword attachment; corrected stress skin uses topological-island chain sanitation',
    sourceAttributesPreservedAs: ['sourceSkinIndex', 'sourceSkinWeight'],
    productionAttributes: ['productionSkinIndex', 'productionSkinWeight', 'productionSwordMask'],
    ...report,
  };
  return report;
}

function applyNodeTransform(object: THREE.Object3D, value: Source): void {
  if (value.matrix) {
    object.matrix.fromArray(value.matrix);
    object.matrixAutoUpdate = false;
    object.matrix.decompose(object.position, object.quaternion, object.scale);
    return;
  }
  if (value.translation) object.position.fromArray(value.translation);
  if (value.rotation) object.quaternion.fromArray(value.rotation);
  if (value.scale) object.scale.fromArray(value.scale);
}

const REQUIRED_LOGICAL_COMPONENTS = [
  'pelvis', 'abdomen', 'chest', 'head', 'hair',
  'upper-arm-l', 'upper-arm-r', 'thigh-l', 'shin-l', 'thigh-r', 'shin-r',
  'hand-l', 'hand-r',
  'scarf', 'scarf-tail-l', 'scarf-tail-r', 'shoulder-trim',
  'pauldron-l', 'pauldron-r', 'upper-arm-armor-l', 'upper-arm-armor-r',
  'forearm-armor-l', 'forearm-armor-r', 'gauntlet-l', 'gauntlet-r',
  'belt', 'skull-buckle', 'trousers', 'greave-l', 'greave-r',
  'sabaton-l', 'sabaton-r', 'sword', 'sword-guard', 'sword-grip', 'sword-gem',
] as const;

interface AnimationControllerRuntime {
  readonly active: string;
  readonly currentTime: number;
  readonly currentDuration: number;
}

function installAnimationController(
  root: THREE.Group,
  sourceNodes: THREE.Object3D[],
  jointIndices: number[],
  authoredSecondaryBones: THREE.Bone[],
  physicalMeshes: THREE.SkinnedMesh[],
  swordMeshes: THREE.SkinnedMesh[],
): void {
  const physicalMeshNames = physicalMeshes.map((mesh) => mesh.name);
  const sourceJoints = jointIndices.map((index) => sourceNodes[index]);
  const joints = [...sourceJoints, ...authoredSecondaryBones];
  const bindQuaternions = new Map(joints.map((joint) => [joint, joint.quaternion.clone()]));
  const bindPositions = new Map(joints.map((joint) => [joint, joint.position.clone()]));
  const bindScales = new Map(joints.map((joint) => [joint, joint.scale.clone()]));
  const bindRootPosition = root.position.clone();
  const bindRootQuaternion = root.quaternion.clone();
  const bindRootScale = root.scale.clone();
  const skinBindings = physicalMeshes.map((mesh) => {
    const sourceIndex = mesh.geometry.getAttribute('sourceSkinIndex');
    const sourceWeight = mesh.geometry.getAttribute('sourceSkinWeight');
    const productionIndex = mesh.geometry.getAttribute('productionSkinIndex');
    const productionWeight = mesh.geometry.getAttribute('productionSkinWeight');
    const correctedIndex = mesh.geometry.getAttribute('skinIndex');
    const correctedWeight = mesh.geometry.getAttribute('skinWeight');
    if (!sourceIndex || !sourceWeight || !productionIndex || !productionWeight || !correctedIndex || !correctedWeight) {
      throw new Error(`Animation-ready skin modes require source, production, and corrected attributes on ${mesh.name}`);
    }
    return { mesh, sourceIndex, sourceWeight, productionIndex, productionWeight, correctedIndex, correctedWeight };
  });
  let skinMode: 'production' | 'corrected' = 'corrected';
  const setSkinMode = (next: 'production' | 'corrected') => {
    if (skinMode === next) return;
    for (const binding of skinBindings) {
      binding.mesh.geometry.setAttribute(
        'skinIndex',
        next === 'production' ? binding.productionIndex : binding.correctedIndex,
      );
      binding.mesh.geometry.setAttribute(
        'skinWeight',
        next === 'production' ? binding.productionWeight : binding.correctedWeight,
      );
    }
    skinMode = next;
  };
  // Idle is the initial controller state, so install the production attributes
  // immediately instead of waiting for the first explicit play/seek call.
  setSkinMode('production');
  const makeReviveClip = (): THREE.AnimationClip => {
    const duration = 2.8;
    const times = [0, 0.42, 1.25, 2.08, duration];
    const bindScale = bindRootScale.clone();
    const scaleValues = [0.18, 0.34, 0.72, 1.06, 1].flatMap((factor) => (
      bindScale.clone().multiplyScalar(factor).toArray()
    ));
    const positionValues = [
      new THREE.Vector3(bindRootPosition.x, bindRootPosition.y - 0.18, bindRootPosition.z),
      new THREE.Vector3(bindRootPosition.x, bindRootPosition.y - 0.10, bindRootPosition.z),
      new THREE.Vector3(bindRootPosition.x, bindRootPosition.y - 0.035, bindRootPosition.z),
      new THREE.Vector3(bindRootPosition.x, bindRootPosition.y + 0.012, bindRootPosition.z),
      bindRootPosition.clone(),
    ].flatMap((position) => position.toArray());
    return new THREE.AnimationClip('revive-new', duration, [
      new THREE.VectorKeyframeTrack('.scale', times, scaleValues),
      new THREE.VectorKeyframeTrack('.position', times, positionValues),
    ]);
  };
  const authoredClips = [
    new THREE.AnimationClip('review-turn-new', 5, [
      new THREE.QuaternionKeyframeTrack('.quaternion', [0, 2.5, 5], [0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, -1]),
    ]),
    makeReviveClip(),
  ];
  const removedAnimationIds = new Set([
    'NlaTrack',
    'NlaTrack.001',
    // Byte-identical hidden duplicate of NlaTrack; remove it as part of the
    // same user-requested runtime animation deletion.
    'NlaTrack.002',
    'idle-breathe-new',
    'combat-ready-new',
    'extreme-joint-check-new',
    'weapon-grip-check-new',
    'bilateral-arm-isolation-new',
    'scarf-tail-secondary-new',
    'warm-up-new',
    'swagger-new',
    'slash-new',
    'bind-pose-return-new',
    'a-pose-sword-hidden-new',
  ]);
  const clips = authoredClips;
  root.animations = clips;
  const mixer = new THREE.AnimationMixer(root);
  let active = 'idle';
  let current: THREE.AnimationAction | undefined;
  let currentDuration = 0;
  const listeners = new Set<(value: string) => void>();
  const notify = () => listeners.forEach((listener) => listener(active));
  const restoreBindPose = () => {
    root.position.copy(bindRootPosition);
    root.quaternion.copy(bindRootQuaternion);
    root.scale.copy(bindRootScale);
    for (const joint of joints) {
      joint.position.copy(bindPositions.get(joint)!);
      joint.quaternion.copy(bindQuaternions.get(joint)!);
      joint.scale.copy(bindScales.get(joint)!);
    }
    for (const sword of swordMeshes) sword.visible = true;
    root.updateMatrixWorld(true);
  };
  const configureLoop = (action: THREE.AnimationAction, name: string) => {
    const oneShot = name === 'revive-new';
    action.setLoop(oneShot ? THREE.LoopOnce : THREE.LoopRepeat, oneShot ? 1 : Infinity);
    action.clampWhenFinished = oneShot;
  };
  const controller = {
    actions: [
      { id: 'review-turn-new', label: 'Review Turn (new)', loop: true },
      { id: 'revive-new', label: 'Revive (new)', loop: false },
    ],
    get active() { return active; },
    get currentTime() { return current?.time ?? 0; },
    get currentDuration() { return currentDuration; },
    get skinMode() { return skinMode; },
    play(name: string) {
      const clip = clips.find((candidate) => candidate.name === name);
      if (!clip) return;
      mixer.stopAllAction();
      restoreBindPose();
      setSkinMode('production');
      current = mixer.clipAction(clip).reset();
      configureLoop(current, name);
      current.play();
      currentDuration = clip.duration;
      active = name;
      notify();
    },
    seek(name: string, time: number) {
      const clip = clips.find((candidate) => candidate.name === name);
      if (!clip || !Number.isFinite(time)) return false;
      mixer.stopAllAction();
      restoreBindPose();
      setSkinMode('production');
      current = mixer.clipAction(clip).reset();
      current.setLoop(THREE.LoopOnce, 1);
      current.clampWhenFinished = true;
      current.play();
      current.paused = true;
      current.time = THREE.MathUtils.clamp(time, 0, clip.duration);
      currentDuration = clip.duration;
      mixer.update(0);
      root.updateMatrixWorld(true);
      active = name;
      notify();
      return true;
    },
    stop() {
      mixer.stopAllAction();
      restoreBindPose();
      setSkinMode('production');
      currentDuration = 0;
      active = 'idle';
      notify();
    },
    subscribe(listener: (value: string) => void) {
      listeners.add(listener);
      listener(active);
      return () => listeners.delete(listener);
    },
    advance(delta: number) {
      mixer.update(delta);
      root.updateMatrixWorld(true);
    },
  };
  const nodes = Object.fromEntries(sourceNodes.map((node, index) => [`source-node-${index}`, node]));
  const pivots = {
    ...Object.fromEntries(jointIndices.map((index) => [`source-joint-node-${index}`, sourceNodes[index]])),
    ...Object.fromEntries(authoredSecondaryBones.map((bone) => [bone.name, bone])),
  };
  const sockets: Record<string, THREE.Object3D> = {};
  for (const [socketName, boneName] of [
    ['weapon-grip-l', 'L_Hand'],
    ['weapon-grip-r', 'R_Hand'],
    ['head-attachment', 'Head'],
  ] as const) {
    const bone = joints.find((candidate) => candidate.name === boneName);
    if (!bone) continue;
    const socket = new THREE.Group();
    socket.name = socketName;
    socket.userData = {
      measuredBy: 'source bone local transform and preserved inverse bind matrix',
      semanticStatus: 'hypothesis-requires-render-confirmation',
    };
    bone.add(socket);
    sockets[socketName] = socket;
  }
  const logicalComponents = Object.fromEntries(REQUIRED_LOGICAL_COMPONENTS.map((name) => [name, {
    kind: 'logical-skinned-region',
    binding: 'preserved source skin weights; semantic boundary confirmed only where physical-ID render is unambiguous',
    boundMeshes: physicalMeshNames,
  }]));
  root.userData.tick = (delta: number) => controller.advance(delta);
  root.userData.sculptRuntime = {
    nodes,
    pivots,
    sockets,
    actionAnchors: {
      weaponGripLeft: { socket: 'weapon-grip-l', sourceJoint: 'L_Hand' },
      weaponGripRight: { socket: 'weapon-grip-r', sourceJoint: 'R_Hand' },
      headAttachment: { socket: 'head-attachment', sourceJoint: 'Head' },
    },
    colliders: [
      { id: 'torso', type: 'capsule', center: [0, 1.08, 0.08], radius: 0.23, height: 0.52 },
      { id: 'head', type: 'sphere', center: [0, 1.48, 0.08], radius: 0.18 },
      { id: 'legs', type: 'box', center: [0, 0.52, 0.08], size: [0.48, 0.92, 0.34] },
    ],
    logicalComponents,
    animationController: controller,
    classification: 'source animation payload remains specification evidence only; runtime provides Review Turn plus a new root-level Revive effect with rigid scale/translation recovery; no sword visibility mutation; Stop restores bind pose and sword visibility; two explicitly classified secondary cloth bones extend the preserved source rig',
    sourceAnimations: SOURCE_ANIMATION_CLIPS.map((clip) => ({
      index: clip.index,
      name: clip.sourceName,
      runtimeName: clip.name,
      duration: clip.duration,
      trackCount: clip.tracks.length,
      sourceGlbSha256: SOURCE_ANIMATION_GLB_SHA256,
      classification: 'copied-source-specification-archived-runtime-disabled-by-user',
      runtimeEnabled: false,
    })),
    animationSkinPolicy: {
      production: 'preserved source Tripo skin weights',
      correctionStressActions: [],
      reason: 'the retained Review Turn and Revive actions use root transforms only; removed joint-stress clips are not constructed at runtime',
      removedRuntimeAnimations: [...removedAnimationIds],
      hiddenDuplicateSourceClip: 'NlaTrack.002 is byte-identical to removed NlaTrack and is also removed from root.animations',
    },
    bindPose: {
      jointCount: joints.length,
      sourceJointCount: sourceJoints.length,
      authoredSecondaryJointCount: authoredSecondaryBones.length,
      inverseBindMatrices: 'preserved from source accessor 6',
      stopRestoresAllJointQuaternions: true,
    },
  };
}

interface ArmorGlintMeasurement {
  sampledVertexCount: number;
  robustPercentiles: [number, number];
  centerWorld: [number, number, number];
  robustBoundsWorld: {
    min: [number, number, number];
    max: [number, number, number];
  };
  armorEnvelopeRadiusWorld: number;
  orbitRadiusWorld: number;
  verticalAmplitudeWorld: number;
  periodSeconds: number;
}

const ENTRANCE_EFFECT_MEASUREMENT = {
  characterBoundsWorld: {
    min: [-0.3676209300624751, 1.5271741610698162e-7, -0.45742535959294556],
    max: [0.3676209124739068, 1.6999998917402646, 0.4574246532108519],
  },
  centerWorld: [-0.016640500483687024, 0.8499999999999999, 0.17963215948804923],
  durationSeconds: 2.35,
  initialCharacterScale: 0.82,
  ringRadiusWorld: 0.43,
  scanHeightWorld: 1.76,
  particleCount: 56,
} as const;

function installEntranceEffect(root: THREE.Group): void {
  root.updateMatrixWorld(true);
  const worldScale = root.getWorldScale(new THREE.Vector3());
  if (Math.abs(worldScale.x - worldScale.y) > 1e-9 || Math.abs(worldScale.x - worldScale.z) > 1e-9) {
    throw new Error('Entrance effect requires the verified uniform model scale');
  }
  const inverseScale = 1 / worldScale.x;
  const sourceChildren = [...root.children];
  const content = new THREE.Group();
  content.name = 'regret-warrior-entrance-content';
  root.add(content);
  content.add(...sourceChildren);

  const centerLocal = root.worldToLocal(new THREE.Vector3().fromArray(ENTRANCE_EFFECT_MEASUREMENT.centerWorld));
  const baseLocal = root.worldToLocal(new THREE.Vector3(
    ENTRANCE_EFFECT_MEASUREMENT.centerWorld[0],
    ENTRANCE_EFFECT_MEASUREMENT.characterBoundsWorld.min[1] + 0.02,
    ENTRANCE_EFFECT_MEASUREMENT.centerWorld[2],
  ));
  const effect = new THREE.Group();
  effect.name = 'regret-warrior-entrance-vfx';
  root.add(effect);

  const makeRing = (name: string, color: number, opacity: number): THREE.Mesh => {
    const geometry = new THREE.TorusGeometry(
      ENTRANCE_EFFECT_MEASUREMENT.ringRadiusWorld * inverseScale,
      0.012 * inverseScale,
      8,
      64,
    );
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const ring = new THREE.Mesh(geometry, material);
    ring.name = name;
    ring.rotation.x = Math.PI * 0.5;
    ring.position.copy(baseLocal);
    ring.renderOrder = 20;
    effect.add(ring);
    return ring;
  };
  const cyanRing = makeRing('regret-warrior-entrance-ring-cyan', 0x67dfff, 0);
  const goldRing = makeRing('regret-warrior-entrance-ring-gold', 0xffc35c, 0);

  const scanMaterial = new THREE.MeshBasicMaterial({
    color: 0x9ee9ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const scan = new THREE.Mesh(
    new THREE.CylinderGeometry(
      0.34 * inverseScale,
      0.48 * inverseScale,
      ENTRANCE_EFFECT_MEASUREMENT.scanHeightWorld * inverseScale,
      32,
      1,
      true,
    ),
    scanMaterial,
  );
  scan.name = 'regret-warrior-entrance-scan';
  scan.position.set(
    centerLocal.x,
    baseLocal.y + ENTRANCE_EFFECT_MEASUREMENT.scanHeightWorld * inverseScale * 0.5,
    centerLocal.z,
  );
  scan.renderOrder = 19;
  effect.add(scan);

  const particlePositions = new Float32Array(ENTRANCE_EFFECT_MEASUREMENT.particleCount * 3);
  const fractional = (value: number): number => value - Math.floor(value);
  for (let index = 0; index < ENTRANCE_EFFECT_MEASUREMENT.particleCount; index += 1) {
    const u = fractional(Math.sin((index + 1) * 12.9898) * 43758.5453);
    const v = fractional(Math.sin((index + 1) * 78.233) * 12345.6789);
    const angle = u * Math.PI * 2;
    const radius = (0.24 + v * 0.24) * inverseScale;
    particlePositions[index * 3] = Math.cos(angle) * radius;
    particlePositions[index * 3 + 1] = (v - 0.35) * 1.55 * inverseScale;
    particlePositions[index * 3 + 2] = Math.sin(angle) * radius;
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(particlePositions, 3));
  const particleMaterial = new THREE.PointsMaterial({
    color: 0xbcefff,
    size: 0.035 * inverseScale,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const particles = new THREE.Points(particleGeometry, particleMaterial);
  particles.name = 'regret-warrior-entrance-particles';
  particles.position.copy(centerLocal);
  particles.renderOrder = 21;
  effect.add(particles);

  const flash = new THREE.PointLight(0xb7eaff, 0, 2.4, 2);
  flash.name = 'regret-warrior-entrance-flash';
  flash.position.copy(centerLocal);
  effect.add(flash);

  const smoothStep = (value: number): number => value * value * (3 - 2 * value);
  const updateEntrance = (elapsedSeconds: number): void => {
    const t = THREE.MathUtils.clamp(elapsedSeconds / ENTRANCE_EFFECT_MEASUREMENT.durationSeconds, 0, 1);
    const reveal = smoothStep(THREE.MathUtils.clamp(t / 0.72, 0, 1));
    const overshoot = t < 1
      ? 1 + 1.70158 * (t - 1) ** 3 + 0.70158 * (t - 1) ** 2
      : 1;
    const scale = THREE.MathUtils.lerp(
      ENTRANCE_EFFECT_MEASUREMENT.initialCharacterScale,
      1,
      Math.max(reveal, overshoot),
    );
    content.scale.setScalar(scale);
    content.position.y = THREE.MathUtils.lerp(-0.055 * inverseScale, 0, reveal);
    content.rotation.y = THREE.MathUtils.lerp(-0.12, 0, reveal);

    const burst = Math.sin(Math.PI * t);
    cyanRing.scale.setScalar(THREE.MathUtils.lerp(0.35, 1.55, reveal));
    goldRing.scale.setScalar(THREE.MathUtils.lerp(0.58, 1.18, reveal));
    cyanRing.rotation.z = t * Math.PI * 1.6;
    goldRing.rotation.z = -t * Math.PI * 1.15;
    (cyanRing.material as THREE.MeshBasicMaterial).opacity = burst * 0.72;
    (goldRing.material as THREE.MeshBasicMaterial).opacity = burst * 0.58;
    scan.scale.y = Math.max(0.001, reveal);
    scanMaterial.opacity = burst * 0.12;
    particles.rotation.y = t * Math.PI * 3.2;
    particles.position.y = centerLocal.y + THREE.MathUtils.lerp(-0.18, 0.22, reveal) * inverseScale;
    particleMaterial.opacity = burst * 0.92;
    flash.intensity = burst * 13;
    if (t >= 1) {
      content.position.set(0, 0, 0);
      content.rotation.set(0, 0, 0);
      content.scale.set(1, 1, 1);
      effect.visible = false;
      flash.intensity = 0;
    } else {
      effect.visible = true;
    }
  };
  updateEntrance(0);

  const previousTick = root.userData.tick as ((delta: number, elapsed?: number) => void) | undefined;
  let entranceElapsedSeconds = 0;
  root.userData.tick = (delta: number, elapsed?: number): void => {
    previousTick?.(delta, elapsed);
    entranceElapsedSeconds += Math.max(0, Number.isFinite(delta) ? delta : 0);
    updateEntrance(entranceElapsedSeconds);
  };
  root.userData.sculptRuntime.entranceEffect = {
    ...ENTRANCE_EFFECT_MEASUREMENT,
    classification: 'new-authored-code-native-entrance-effect',
    geometry: ['two additive torus rings', 'open scan cylinder', 'deterministic point burst'],
    light: { type: 'THREE.PointLight', color: '#b7eaff', peakIntensity: 13 },
    deterministicParticleSeed: 'sin-index hash; no Math.random',
    sourceMaterialMutation: false,
    runtimeBinaryDependency: false,
  };
}

function installReviveEffect(root: THREE.Group, controller: AnimationControllerRuntime): void {
  root.updateMatrixWorld(true);
  const bindScale = root.scale.x;
  if (!Number.isFinite(bindScale) || bindScale <= 0) throw new Error('Revive effect requires a positive bind scale');
  const inverseScale = 1 / bindScale;
  const centerLocal = root.worldToLocal(new THREE.Vector3().fromArray(ENTRANCE_EFFECT_MEASUREMENT.centerWorld));
  const revive = new THREE.Group();
  revive.name = 'regret-warrior-revive-vfx';
  revive.position.copy(centerLocal);
  root.add(revive);

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0x9ff4ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.34 * inverseScale, 0.015 * inverseScale, 8, 72),
    ringMaterial,
  );
  ring.name = 'regret-warrior-revive-ring';
  ring.rotation.x = Math.PI * 0.5;
  ring.position.y = -0.49 * inverseScale;
  ring.renderOrder = 24;
  revive.add(ring);

  const haloMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd27a,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.25 * inverseScale, 0.009 * inverseScale, 8, 64),
    haloMaterial,
  );
  halo.name = 'regret-warrior-revive-halo';
  halo.rotation.x = Math.PI * 0.5;
  halo.position.y = 0.18 * inverseScale;
  halo.renderOrder = 25;
  revive.add(halo);

  const particleCount = 40;
  const particlePositions = new Float32Array(particleCount * 3);
  for (let index = 0; index < particleCount; index += 1) {
    const angle = (index / particleCount) * Math.PI * 2;
    const radius = (0.16 + ((index * 17) % 11) * 0.018) * inverseScale;
    particlePositions[index * 3] = Math.cos(angle) * radius;
    particlePositions[index * 3 + 1] = (-0.55 + (index % 10) * 0.11) * inverseScale;
    particlePositions[index * 3 + 2] = Math.sin(angle) * radius;
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(particlePositions, 3));
  const particleMaterial = new THREE.PointsMaterial({
    color: 0xd5f9ff,
    size: 0.028 * inverseScale,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const particles = new THREE.Points(particleGeometry, particleMaterial);
  particles.name = 'regret-warrior-revive-particles';
  particles.position.y = -0.42 * inverseScale;
  particles.renderOrder = 26;
  revive.add(particles);

  const flash = new THREE.PointLight(0x9feeff, 0, 2.2, 2);
  flash.name = 'regret-warrior-revive-flash';
  flash.position.y = 0.06 * inverseScale;
  revive.add(flash);

  const updateRevive = (): void => {
    const duration = 2.8;
    const active = controller.active === 'revive-new';
    const t = THREE.MathUtils.clamp(controller.currentTime / duration, 0, 1);
    const live = active && t < 1;
    const rise = THREE.MathUtils.smoothstep(t, 0, 0.75);
    const pulse = Math.sin(Math.PI * THREE.MathUtils.clamp(t / 0.9, 0, 1));
    const scaleRatio = Math.max(Math.abs(root.scale.x / bindScale), 0.001);
    revive.scale.setScalar(1 / scaleRatio);
    revive.visible = live;
    ring.scale.setScalar(THREE.MathUtils.lerp(0.42, 1.7, rise));
    halo.scale.setScalar(THREE.MathUtils.lerp(0.6, 1.35, rise));
    ring.rotation.z = t * Math.PI * 2.8;
    halo.rotation.z = -t * Math.PI * 2.1;
    ringMaterial.opacity = live ? (0.16 + pulse * 0.72) * (1 - t * 0.75) : 0;
    haloMaterial.opacity = live ? (0.12 + pulse * 0.48) * (1 - t) : 0;
    particles.rotation.y = t * Math.PI * 3.6;
    particles.position.y = (-0.42 + rise * 0.5) * inverseScale;
    particleMaterial.opacity = live ? (0.18 + pulse * 0.72) * (1 - t * 0.65) : 0;
    flash.intensity = live ? (1 - t) * 11 + pulse * 6 : 0;
  };
  updateRevive();

  const previousTick = root.userData.tick as ((delta: number, elapsed?: number) => void) | undefined;
  root.userData.tick = (delta: number, elapsed?: number): void => {
    previousTick?.(delta, elapsed);
    updateRevive();
  };
  root.userData.sculptRuntime.reviveEffect = {
    classification: 'new-authored-code-native-revive-effect',
    durationSeconds: 2.8,
    geometry: ['rising additive ring', 'gold halo', 'deterministic particle spiral'],
    light: { type: 'THREE.PointLight', peakIntensity: 17 },
    sourceMaterialMutation: false,
    runtimeBinaryDependency: false,
  };
}

const ARMOR_GLINT_MEASUREMENT: ArmorGlintMeasurement = {
  sampledVertexCount: 32694,
  robustPercentiles: [0.05, 0.95],
  centerWorld: [-0.016640500483687024, 1.0470276495596342, 0.17963215948804923],
  robustBoundsWorld: {
    min: [-0.2744704396169099, 0.13307270068287563, 0.004976829785664239],
    max: [0.24118943864953588, 1.4771240960898733, 0.35428748919043423],
  },
  armorEnvelopeRadiusWorld: 0.42284110017848553,
  orbitRadiusWorld: 0.7428411001784855,
  verticalAmplitudeWorld: 0.12096462558662979,
  periodSeconds: 4.8,
};

function installArmorGlint(root: THREE.Group): void {
  root.updateMatrixWorld(true);
  const worldScale = root.getWorldScale(new THREE.Vector3());
  if (Math.abs(worldScale.x - worldScale.y) > 1e-9 || Math.abs(worldScale.x - worldScale.z) > 1e-9) {
    throw new Error('Armor glint requires the verified uniform model scale');
  }
  const inverseScale = 1 / worldScale.x;
  const centerLocal = root.worldToLocal(
    new THREE.Vector3().fromArray(ARMOR_GLINT_MEASUREMENT.centerWorld),
  );
  const orbitRadiusLocal = ARMOR_GLINT_MEASUREMENT.orbitRadiusWorld * inverseScale;
  const verticalAmplitudeLocal = ARMOR_GLINT_MEASUREMENT.verticalAmplitudeWorld * inverseScale;

  const target = new THREE.Object3D();
  target.name = 'regret-warrior-armor-glint-target';
  target.position.copy(centerLocal);
  const light = new THREE.SpotLight(0xe4f2ff, 9.5, 1.65, 0.24, 0.82, 2);
  light.name = 'regret-warrior-armor-glint-light';
  light.target = target;
  light.castShadow = false;
  light.userData = {
    classification: 'new-authored-lighting-effect',
    purpose: 'automatic narrow specular sweep around the measured armor envelope',
    materialMutation: false,
    textureMutation: false,
    uvMutation: false,
  };
  root.add(target, light);

  const updateGlint = (elapsedSeconds: number): void => {
    const phase = (elapsedSeconds / ARMOR_GLINT_MEASUREMENT.periodSeconds) * Math.PI * 2;
    light.position.set(
      centerLocal.x + Math.cos(phase) * orbitRadiusLocal,
      centerLocal.y + Math.sin(phase * 2) * verticalAmplitudeLocal,
      centerLocal.z + Math.sin(phase) * orbitRadiusLocal,
    );
    // A restrained pulse prevents a flat constant hotspot while keeping the
    // source albedo, normal map, roughness, exposure, and tone mapping intact.
    light.intensity = 8.25 + (Math.sin(phase - Math.PI * 0.25) + 1) * 1.25;
    light.updateMatrixWorld(true);
    target.updateMatrixWorld(true);
  };
  updateGlint(0);

  const previousTick = root.userData.tick as ((delta: number, elapsed?: number) => void) | undefined;
  let accumulatedSeconds = 0;
  root.userData.tick = (delta: number, elapsed?: number): void => {
    previousTick?.(delta, elapsed);
    accumulatedSeconds = Number.isFinite(elapsed)
      ? Math.max(0, elapsed as number)
      : accumulatedSeconds + Math.max(0, Number.isFinite(delta) ? delta : 0);
    updateGlint(accumulatedSeconds);
  };
  root.userData.sculptRuntime.armorGlint = {
    ...ARMOR_GLINT_MEASUREMENT,
    type: 'THREE.SpotLight',
    color: '#e4f2ff',
    intensityRange: [8.25, 10.75],
    distanceWorld: 1.65,
    angleRadians: 0.24,
    penumbra: 0.82,
    decay: 2,
    target: ARMOR_GLINT_MEASUREMENT.centerWorld,
    preservesSourceAppearance: {
      materialInstancesChanged: 0,
      textureBindingsChanged: 0,
      uvAttributesChanged: 0,
      toneMappingChanged: false,
      exposureChanged: false,
    },
  };
}

/** Code-native reconstruction of the inventoried glTF 2.0 scene, with no runtime GLB/GLTF/BIN fetch. */
export function createRegretWarriorModel(options: RegretWarriorOptions = {}): THREE.Group {
  const source = GLTF_SOURCE as Source;
  const jointNodes = new Set<number>(source.skins.flatMap((skin: Source) => skin.joints));
  const nodes: THREE.Object3D[] = source.nodes.map((value: Source, index: number) => {
    const object = jointNodes.has(index) ? new THREE.Bone() : new THREE.Group();
    object.name = value.name ?? `source-node-${index}`;
    object.userData = { gltfNodeIndex: index, gltfSource: value, semanticStatus: 'physical-id-only' };
    applyNodeTransform(object, value);
    return object;
  });
  source.nodes.forEach((value: Source, index: number) => {
    for (const child of value.children ?? []) nodes[index].add(nodes[child]);
  });
  const materials = source.materials.map((_: Source, index: number) => createMaterial(index));
  const pendingSkins: Array<{ mesh: THREE.SkinnedMesh; skinIndex: number }> = [];
  source.nodes.forEach((value: Source, nodeIndex: number) => {
    if (value.mesh === undefined) return;
    const meshDef = source.meshes[value.mesh];
    meshDef.primitives.forEach((primitive: Source, primitiveIndex: number) => {
      if ((primitive.mode ?? 4) !== 4) throw new Error(`Primitive mode ${primitive.mode} is not triangles`);
      const geometry = createGeometry(primitive);
      const material = materials[primitive.material ?? 0];
      const mesh = value.skin === undefined
        ? new THREE.Mesh(geometry, material)
        : new THREE.SkinnedMesh(geometry, material);
      mesh.name = `${meshDef.name ?? `source-mesh-${value.mesh}`}-primitive-${primitiveIndex}`;
      mesh.castShadow = options.castShadow ?? true;
      mesh.receiveShadow = options.receiveShadow ?? true;
      mesh.userData = {
        gltfNodeIndex: nodeIndex, gltfMeshIndex: value.mesh, gltfPrimitiveIndex: primitiveIndex,
        semanticStatus: 'physical-id-only',
      };
      if (meshDef.weights) mesh.morphTargetInfluences = [...meshDef.weights];
      if (value.weights) mesh.morphTargetInfluences = [...value.weights];
      nodes[nodeIndex].add(mesh);
      if (mesh instanceof THREE.SkinnedMesh) pendingSkins.push({ mesh, skinIndex: value.skin });
    });
  });
  const root = new THREE.Group();
  root.name = 'regret-warrior-reconstruction';
  const sceneIndex = source.scene ?? 0;
  for (const nodeIndex of source.scenes[sceneIndex].nodes ?? []) root.add(nodes[nodeIndex]);
  root.updateMatrixWorld(true);
  const authoredSecondaryRigs: AuthoredSecondaryRig[] = [];
  const skeletons = source.skins.map((skin: Source) => {
    const inverse = accessorArray(skin.inverseBindMatrices).array;
    const matrices = skin.joints.map((_: number, index: number) => new THREE.Matrix4().fromArray(inverse as any, index * 16));
    const bones = skin.joints.map((index: number) => nodes[index] as THREE.Bone);
    const authoredRig = appendAuthoredClothBones(bones, matrices);
    authoredSecondaryRigs.push(authoredRig);
    return new THREE.Skeleton(bones, matrices);
  });
  const runtimeSkinnedMeshes: THREE.SkinnedMesh[] = [];
  const runtimeSwordMeshes: THREE.SkinnedMesh[] = [];
  const physicalMeshPartitions: Array<{sourceMesh: string; parts: string[]}> = [];
  const skinCorrections = pendingSkins.map((pending) => {
    const report = correctSkinWeightLeakage(pending.mesh, skeletons[pending.skinIndex]);
    pending.mesh.bind(skeletons[pending.skinIndex], pending.mesh.matrixWorld);
    const mesh5Partitions = splitUserConfirmedMesh5(pending.mesh, skeletons[pending.skinIndex]);
    const partitions = mesh5Partitions.flatMap((partition) => (
      splitSwordAttachment(partition, skeletons[pending.skinIndex])
    ));
    if (partitions.length > 1 || partitions[0] !== pending.mesh) {
      const parent = pending.mesh.parent;
      if (!parent) throw new Error(`Cannot partition detached skinned mesh ${pending.mesh.name}`);
      parent.remove(pending.mesh);
      parent.add(...partitions);
      physicalMeshPartitions.push({sourceMesh: pending.mesh.name, parts: partitions.map((part) => part.name)});
    }
    runtimeSkinnedMeshes.push(...partitions);
    runtimeSwordMeshes.push(...partitions.filter((partition) => (
      partition.userData.animationVisibilityGroup === 'sword'
    )));
    return { mesh: pending.mesh.name, ...report };
  });
  if (runtimeSwordMeshes.length === 0) {
    throw new Error('Measured productionSwordMask did not produce any independently hideable sword partition');
  }
  root.scale.setScalar(1.6999989867216427);
  root.userData.source = {
    glbSha256: SOURCE_GLB_SHA256,
    binSha256: SOURCE_BIN_SHA256,
    animationGlbSha256: SOURCE_ANIMATION_GLB_SHA256,
    realLongestDimension: 1.7,
    sourceAnimations: {
      source: 'offline animation measurement payload',
      runtimeDependency: false,
      archivedSpecificationClipCount: SOURCE_ANIMATION_CLIPS.length,
      runtimeClipCount: 0,
      runtimeStatus: 'source-clips-disabled-by-user-request; Review Turn and Revive are separately authored',
      transfer: 'exact Float32 payload retained as offline specification evidence; no source clip is installed in root.animations',
    },
    sourceMorphTargets: 'source-absent',
    sourceJointCount: 42,
    runtimeJointCount: 44,
    authoredSecondaryJointCount: 2,
    sourcePrimitiveCount: 92,
    sourceSkinAttributesPreserved: ['sourceSkinIndex', 'sourceSkinWeight'],
    productionSkinAttributes: ['productionSkinIndex', 'productionSkinWeight', 'productionSwordMask'],
    runtimeSkinWeights: 'Review Turn and Revive use root transforms without joint deformation; measured sword components are rigid-bound to R_Hand and physically partitioned for visibility; Stop restores bind pose and sword visibility',
  };
  installAnimationController(
    root,
    nodes,
    source.skins[0].joints,
    authoredSecondaryRigs[0].bones,
    runtimeSkinnedMeshes,
    runtimeSwordMeshes,
  );
  installEntranceEffect(root);
  installReviveEffect(root, root.userData.sculptRuntime.animationController as AnimationControllerRuntime);
  installArmorGlint(root);
  const aggregateSkinCorrection = skinCorrections.reduce((aggregate, current) => {
    for (const key of Object.keys(aggregate) as Array<keyof SkinCorrectionReport>) aggregate[key] += current[key];
    return aggregate;
  }, {
    componentCount: 0,
    reassignedComponentCount: 0,
    crossChainVertexCountBefore: 0,
    crossChainVertexCountAfter: 0,
    removedForeignWeight: 0,
    fallbackVertexCount: 0,
    rigidComponentCount: 0,
    handZoneComponentCount: 0,
    garmentCoreComponentCount: 0,
    authoredClothComponentCount: 0,
    authoredClothVertexCount: 0,
    swordComponentCount: 0,
    productionSwordSeedVertexCount: 0,
    productionSwordVertexCount: 0,
    userConfirmedMesh5ComponentCount: 0,
    userConfirmedMesh5VertexCount: 0,
    userConfirmedMesh5ArmComponentCountBefore: 0,
    weldedContinuityApplied: 0,
    indexedComponentCountBeforeWeld: 0,
    weldedComponentCountAfter: 0,
    synchronizedSeamGroupCount: 0,
    synchronizedSeamVertexCount: 0,
    globalSeamSynchronizationApplied: 0,
    resolvedCrossChainSeamGroupCount: 0,
    resolvedCrossChainSeamVertexCount: 0,
  } satisfies SkinCorrectionReport);
  root.userData.sculptRuntime.skinWeightCorrection = {
    partitionBasis: 'verified 42-joint hierarchy, measured bind locations, physical-island renders, and user-reported deformation defects',
    aggregate: aggregateSkinCorrection,
    meshes: skinCorrections,
  };
  root.userData.sculptRuntime.authoredSecondaryRig = {
    classification: 'new-authored-secondary-rig; source GLB has no dedicated cloth/scarf-tail bones',
    jointCount: authoredSecondaryRigs[0].bones.length,
    jointNames: authoredSecondaryRigs[0].bones.map((bone) => bone.name),
    ...authoredSecondaryRigs[0].measurement,
  };
  root.userData.sculptRuntime.physicalMeshPartitions = physicalMeshPartitions;
  return root;
}

export function createRegretWarriorLookDevLights(): THREE.Group {
  const lights = new THREE.Group();
  lights.name = 'regret-warrior-lookdev';
  const key = new THREE.DirectionalLight(0xfff3df, 3.2);
  key.position.set(4, 6, 5);
  key.castShadow = true;
  const fill = new THREE.HemisphereLight(0xc8d8ff, 0x221a18, 1.4);
  const rim = new THREE.DirectionalLight(0x9db9ff, 2);
  rim.position.set(-4, 3, -5);
  lights.add(key, fill, rim);
  return lights;
}
