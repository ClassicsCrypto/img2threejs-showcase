import * as THREE from 'three';
import { SOURCE_GLB_SHA256 } from './sourceRigAnimationData';
import { SOURCE_MESH_SHA256 } from './sourceMeshData';
import { STRIKE_EVENTS } from './strikeEvents';
import { createSourceRigRuntime, type SourceRigRuntime } from './sourceRigRuntime';
import { createStrikeVfx, VFX_ELEMENTS, type VfxElementKey } from './strikeVfx';
import {
  buildSourceMeshes,
  ensureSourceTextures,
  SOURCE_MESH_TOTALS,
  SOURCE_PBR,
} from './buildSourceMeshes';

/**
 * The Lee Sin model, assembled entirely in Three.js.
 *
 * PURE THREE.JS. Everything the viewer sees is constructed here from `THREE.BufferGeometry`,
 * `THREE.SkinnedMesh`, `THREE.Skeleton`, `THREE.Bone`, `THREE.AnimationClip` and
 * `THREE.MeshPhysicalMaterial`. There is no `GLTFLoader`, no `three/examples` addon and no loader of
 * any kind in this demo, and nothing is fetched at runtime -- no .glb, .bin, .gltf or image request.
 * The reference GLB is a BUILD-TIME MEASUREMENT INSTRUMENT: it is not in this repository, is not
 * served, and never reaches a viewer. The button on the demo page links to where it was generated.
 *
 * Generated in code: the 42-bone skeleton and its 11 `AnimationClip`s are constructed from measured
 * tracks; `weldSeamSkinning` recomputes the skin binding across part boundaries; `capOpenBoundaries`
 * closes open boundary loops with fan triangles; vertex tangents are computed here.
 *
 * Copied, and stated plainly: the vertex attributes and index buffers of the 69 drawable nodes, and
 * their 69 baseColorTexture images, are transferred bit-for-bit from the reference because the owner
 * asked for exact triangle parity, which no reconstruction reaches. See `sourceMeshData.ts`.
 */
export interface LeesinModelOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
  wireframe?: boolean;
}
const MEASURED_NODE_FIRST = 42;
const MEASURED_NODE_LAST = 110;

/**
 * Printed from the emitted 69-node grid metadata. The reconstruction is kept at scale 1:1;
 * translation only seats the conservative grid bounds on Y=0 and centres the orbit target.
 */
const MEASURED_GRID_BOUNDS = {
  min: [-0.3982346824742711, -0.5124508825430412, -0.22700568676916336] as const,
  max: [0.3987665340601713, 0.5228354601444521, 0.25921801398972083] as const,
  center: [0.0002659257929501224, 0.005192288800705491, 0.016106163610278737] as const,
};
/**
 * One seat for both the surface and the rig. The decoded surfaces are measured in the source node's
 * LOCAL frame (verified: reconstruction bounds = source local bounds + this offset, to 4 decimals) and
 * the source joints resolve into the same frame, so a single translation has to move them together; adding the
 * Armature node's own Y translation on top of it (as this offset used to) moved the joints half a
 * figure height above the flesh they drive. Bind pose hid that -- the skin matrix is identity there
 * -- while every posed frame rotated the surface about pivots 0.5 m out. Measured: the median
 * distance from a vertex to its own dominant joint was 0.5034 m on a 1.0 m figure, and intra-part
 * pairwise distances distorted 13-31% on average, up to 24.8x.
 */
const MEASURED_DISPLAY_OFFSET = new THREE.Vector3(
  -MEASURED_GRID_BOUNDS.center[0],
  -MEASURED_GRID_BOUNDS.min[1],
  -MEASURED_GRID_BOUNDS.center[2],
);





/**
 * Decode the measured payload. Everything in this module -- the 7.6 MB surface stream, the 18 MB
 * skin/palette measurements and the 1 MB source rig -- is reachable only through the dynamic import
 * in leesinDemo.ts, so none of it enters the eagerly loaded chunk that every showcase page pulls.
 */
export function prepareLeesinMeasured(): Promise<void> {
  return ensureSourceTextures();
}

/**
 * ONE material, and the colour comes off the vertices.
 *
 * This used to be six authored families -- flat constants picked by a per-vertex categorical guess at
 * the source colour -- with procedural 64 px albedo/normal/roughness maps on top. Measured against the
 * GLB that is wrong three ways: the source carries 69 baseColorTextures (up to 4096 px, 78.2 M texels)
 * whose colour cannot be held by six constants; it declares roughness 0.9 and metalness 0.0 uniformly
 * on all 69 materials, not six different values with an invented 0.72 metal; and it has NO
 * normalTexture and NO metallicRoughnessTexture, so every authored map was detail the source does not
 * have. The measured base colour now rides in the stream's own per-vertex colour channel, which the
 * encoder always shipped and geometry-only mode had filled with white.
 */


function addMeasuredSockets(rig: SourceRigRuntime): Record<string, THREE.Object3D> {
  rig.container.updateMatrixWorld(true);
  const upperLimbEndpoints = [22, 32]
    .map((index) => ({ index, x: rig.nodes.get(index)!.getWorldPosition(new THREE.Vector3()).x }))
    .sort((left, right) => left.x - right.x);
  const leafJoints = [...rig.nodes.entries()].filter(([index, node]) => (
    index <= 40 && node.children.every((child) => !(child as THREE.Bone).isBone)
  ));
  const head = leafJoints
    .map(([index, node]) => ({ index, y: node.getWorldPosition(new THREE.Vector3()).y }))
    .sort((left, right) => right.y - left.y)[0];
  const bindings = {
    // Coordinate contract: +X character-left / -X character-right, as the source stores it.
    'weapon-grip-l': upperLimbEndpoints[1].index,
    'weapon-grip-r': upperLimbEndpoints[0].index,
    'head-attachment': head.index,
  } as const;
  return Object.fromEntries(Object.entries(bindings).map(([name, index]) => {
    const socket = new THREE.Group();
    socket.name = name;
    socket.userData = {
      sourceJointIndex: index,
      selection: name === 'head-attachment'
        ? 'highest measured terminal joint in rest world-space'
        : 'terminal upper-limb pair ordered by measured rest world-space lateral coordinate',
      semanticStatus: 'hypothesis-requires-render-confirmation',
    };
    rig.nodes.get(index)!.add(socket);
    return [name, socket];
  }));
}

function buildMeasuredGeometry(
  options: LeesinModelOptions,
): { group: THREE.Group; rig: SourceRigRuntime; meshes: THREE.SkinnedMesh[] } {
  const group = new THREE.Group();
  group.name = 'leesin-measured-surface-nets';
  const rig = createSourceRigRuntime();
  group.add(rig.container);

  let vertexCount = 0;
  let triangleCount = 0;
  const meshes: THREE.SkinnedMesh[] = [];
  const source = buildSourceMeshes({ wireframe: options.wireframe });
  for (const part of source.parts) {
    // Tangents are derived, not copied: the source declares no TANGENT accessor, and nothing here
    // samples a normal map, so this exists only so the rig/material audit can assert completeness.
    part.geometry.computeTangents();
    const mesh = new THREE.SkinnedMesh(part.geometry, part.material);
    mesh.name = `measured-node-${part.node}`;
    mesh.castShadow = options.castShadow ?? true;
    mesh.receiveShadow = options.receiveShadow ?? true;
    mesh.frustumCulled = false;
    mesh.userData.measurement = {
      node: part.node,
      status: 'source-transfer',
      method: 'reference POSITION, NORMAL, TEXCOORD_0, JOINTS_0, WEIGHTS_0 and index buffer transferred bit-for-bit; boundary caps and tangents generated in code',
      vertexCount: part.vertexCount,
      triangleCount: part.triangleCount,
      rigBinding: 'source JOINTS_0/WEIGHTS_0; exact source animation accessors',
      material: 'source baseColorTexture with the source roughness 0.9 / metalness 0.0 / doubleSided',
      sourceTopologyCopied: true,
      sourceTexturesCopied: true,
      boundaryCap: part.cap,
    };
    vertexCount += part.vertexCount;
    triangleCount += part.triangleCount;
    rig.armature.add(mesh);
    meshes.push(mesh);
  }
  group.updateMatrixWorld(true);
  // Identity bind. Three's attached bind mode recomputes bindMatrixInverse from matrixWorld on every
  // updateMatrixWorld, so both the render path and the raycast path evaluate skinMatrix * bindMatrix
  // * v and the mesh's own world matrix cancels out -- parenting cannot move a skinned vertex here,
  // and only the bind matrix can. The decoded vertices are already in source world space, the space
  // the source inverse bind matrices expect, so the identity is the whole map. Binding
  // mesh.matrixWorld instead (the Armature's own -0.5 Y seat) is what displaced the surface half a
  // figure height from its joints and tore every posed frame apart.
  const measuredWorldBind = new THREE.Matrix4();
  for (const mesh of meshes) mesh.bind(rig.skeleton, measuredWorldBind);
  group.position.copy(MEASURED_DISPLAY_OFFSET);
  group.updateMatrixWorld(true);

  group.userData.measuredGeometry = {
    pipelineVersion: 'img2threejs 1.5.1',
    nodeCount: SOURCE_MESH_TOTALS.nodes,
    nodeRange: [MEASURED_NODE_FIRST, MEASURED_NODE_LAST],
    vertexCount,
    triangleCount,
    /**
     * The source GLB is normalised to a 1.0-unit figure height (measured extents 0.778199 x 1.0 x
     * 0.443084), and no real-world longest dimension was supplied for this subject. Every length this
     * demo reports -- cell sizes in "millimetres", residuals in "metres" -- is therefore a GLB unit
     * treated as a metre. That is an assumption, not a measurement, and the whole figure rescales by
     * one factor the moment a real height is given.
     */
    sourceTransfer: {
      contract: 'pure Three.js and no runtime fetch, but the code-only rule on topology and textures is deliberately set aside here, on the owner\'s instruction',
      copied: ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0', 'indices', 'baseColorTexture'],
      totals: SOURCE_MESH_TOTALS,
      seamWeld: source.seamWeld,
      orphanSkin: source.orphanSkin,
      pbr: SOURCE_PBR,
      runtimeFetches: 'none -- no .glb, .bin, .gltf or image request; the reference GLB is never shipped',
      generatedInCode: ['skeleton', 'animation clips', 'seam skin weights', 'boundary caps', 'tangents'],
    },
    unitBasis: {
      sourceFigureExtents: [0.778199, 1.0, 0.443084],
      realLongestDimensionSupplied: false,
      lengthUnitAssumption: 'one GLB unit is reported as one metre',
    },
    sourceAssetFetchedAtRuntime: false,
    sourceTopologyCopied: true,
    sourceMaterialsCopied: true,
    sourceTexturesCopied: true,
    sourceAnimationAccessorTransfer: 'exact Float32 key times/values, target indices, paths, durations and STEP/LINEAR interpolation',
    sourceGlbSha256: SOURCE_GLB_SHA256,
    sourceMeshSha256: SOURCE_MESH_SHA256,
    sourceJointCount: rig.skeleton.bones.length,
    sourceClipCount: rig.clips.length,
    skinnedMeshCount: meshes.length,
    displayOffset: MEASURED_DISPLAY_OFFSET.toArray(),
    scale: [1, 1, 1],
    supersededReconstruction: {
      method: 'per-node SDF splat contoured with Surface Nets, colour baked per vertex',
      vertices: 747062,
      triangles: 1495764,
      ratioToSource: '14.3x vertices, 29.6x triangles -- its surface could approach the source but '
        + 'never coincide with it, which is why the transfer replaced it',
    },
  };

  return { group, rig, meshes };
}

export function installMeasuredGeometry(root: THREE.Group, options: LeesinModelOptions): void {
  const previous = root.getObjectByName('leesin-measured-surface-nets');
  if (previous) root.remove(previous);

  // Sweep any mesh already on the root. Nothing puts one there now that the demo builds its own
  // empty root, but a re-install after a detail-level switch must not leave the previous build's
  // meshes behind as invisible selectable ghosts in the viewer hierarchy.
  const stale: THREE.Object3D[] = [];
  root.traverse((object) => {
    // `instanceof` is intentionally avoided: a production split chunk can carry a second Three.js
    // module instance even when development dedupes it.
    if (!(object as THREE.Mesh).isMesh) return;
    stale.push(object);
  });
  for (const mesh of stale) mesh.parent?.remove(mesh);
  const { group: measured, rig, meshes } = buildMeasuredGeometry(options);
  root.add(measured);
  const sockets = addMeasuredSockets(rig);
  root.animations = rig.clips;
  /**
   * Strike effects, advanced from the same tick that advances the rig.
   *
   * Attached to the model's PARENT, never to the model. The parts inspector, the explode layout and
   * the rig gate all walk `leesin-procedural` and assert 69 visible skinned meshes; an effect mesh
   * inside it would be listed as a body part, fly apart on explode and fail that assertion.
   *
   * Clip time is accumulated here rather than read from the mixer, because the controller exposes the
   * active clip but not the action's time. It is reset whenever the active clip changes and wrapped
   * for looping clips, which is also what re-arms the one-shot bursts.
   */
  const vfx = createStrikeVfx(rig.nodes);
  (root.parent ?? root).add(vfx.group);
  let vfxClip: string | null = null;
  let vfxTime = 0;
  /**
   * Bumped by the controller on every play/seek/stop, and compared in the tick.
   *
   * Comparing clip NAMES alone is not enough: pressing the same action button twice restarts the clip
   * from zero, but the name has not changed, so the effect timeline kept running and its one-shot
   * bursts stayed armed -- the second press produced trails and nothing else.
   */
  let playToken = 0;
  let seenToken = -1;
  rig.controller.subscribe(() => { playToken += 1; });
  root.userData.tick = (delta: number) => {
    // A stall -- decoding the payload, a background tab -- hands the first frame afterwards a delta
    // worth the whole pause. Clamping keeps one long frame from teleporting the pose.
    const step = Math.min(delta, 1 / 20);
    rig.controller.advance(step);
    const active = rig.controller.active;
    const playing = active === 'idle' ? null : active;
    /**
     * Clip time comes from the MIXER, not from a counter kept here.
     *
     * It used to be accumulated locally, and that is what made the default animation fire its effects
     * half a second out of step while a manual press was exact: autoplay starts right after the 20 MB
     * payload finishes decoding, the frame after that stall carries the whole pause as its delta, and
     * the mixer advanced by it while the local counter had just been reset to zero. Measured at 1.483 s
     * against 1.983 s for the same strike. Reading the action's own time cannot drift by construction.
     */
    const now = playing ? rig.controller.time : 0;
    const looped = playing !== vfxClip || playToken !== seenToken || now < vfxTime - 1e-4;
    vfxClip = playing;
    seenToken = playToken;
    vfxTime = now;
    vfx.update(step, vfxClip, vfxTime, looped);
  };
  root.userData.disposeStrikeVfx = () => vfx.dispose();

  // Created by leesinDemo, but defended here so a caller that built the root some other way still
  // gets a populated runtime rather than a crash.
  root.userData.sculptRuntime ??= {};
  const runtime = root.userData.sculptRuntime as Record<string, unknown>;
  runtime.route = 'img2threejs 1.5.1 -- pure Three.js, built in code with no loader and no runtime fetch. The reference GLB is a build-time measurement instrument, never shipped. Its 69 meshes and textures are transferred bit-for-bit for exact triangle parity; skeleton, clips, seam weights, boundary caps and tangents are generated here.';
  runtime.measuredGeometry = measured.userData.measuredGeometry;
  runtime.visualGeometryRigBinding = '69 visible SkinnedMesh parts bound to the preserved 42-joint source skeleton';
  runtime.animationController = rig.controller;
  runtime.strikeVfx = {
    elements: VFX_ELEMENTS.map((entry) => ({ id: entry.key, label: entry.label })),
    get current(): VfxElementKey { return vfx.element; },
    setElement: (key: VfxElementKey) => vfx.setElement(key),
    attachedTo: 'model parent, so the parts inspector and rig gate still see exactly 69 meshes',
    layers: ['speed-driven limb trail', 'impact flare ring', 'air ring', 'ember sparks'],
    assets: 'none -- the single spark texture is a canvas gradient built at runtime',
    events: STRIKE_EVENTS.length,
  };
  runtime.sourceAnimations = rig.clips.map((clip, index) => ({
    index,
    name: clip.name,
    duration: clip.duration,
    trackCount: clip.tracks.length,
    sourceGlbSha256: SOURCE_GLB_SHA256,
    classification: 'exact-code-native-accessor-transfer',
  }));
  runtime.nodes = Object.fromEntries([...rig.nodes].map(([index, node]) => [`source-node-${index}`, node]));
  runtime.pivots = Object.fromEntries([...rig.nodes].map(([index, node]) => [`source-joint-node-${index}`, node]));
  runtime.sockets = sockets;
  runtime.actionAnchors = {
    weaponGripLeft: { socket: 'weapon-grip-l' },
    weaponGripRight: { socket: 'weapon-grip-r' },
    headAttachment: { socket: 'head-attachment' },
  };
  runtime.rigBindingAudit = {
    visibleMeshCount: meshes.length,
    skinnedVisibleMeshCount: meshes.filter((mesh) => mesh.isSkinnedMesh).length,
    jointCount: rig.skeleton.bones.length,
    inverseBindMatrices: 'exact code-native Float32 transfer from source accessor 6',
  };
}
