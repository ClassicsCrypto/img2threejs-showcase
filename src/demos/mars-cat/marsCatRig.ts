import * as THREE from 'three';
import { MARS_CAT_RIG, MARS_CAT_SKIN } from './rig/rigData';
import { MARS_CAT_GAME_SKIN } from './rig/rigDataGame';

export interface MarsCatAnimationController {
  actions: ReadonlyArray<{ id: string; label: string; loop: boolean }>;
  readonly active: string;
  play(name: string): void;
  seek(name: string, timeSeconds: number): void;
  stop(): void;
  update(deltaSeconds: number): void;
  subscribe(listener: (active: string) => void): () => void;
}

export interface MarsCatRigRuntime {
  skeleton: THREE.Skeleton;
  bones: readonly THREE.Bone[];
  clips: readonly THREE.AnimationClip[];
  animationController: MarsCatAnimationController;
  update(deltaSeconds: number): void;
}

const decodeBytes = (encoded: string): Uint8Array => {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const decodeWeights = (encoded: string): Uint16Array => {
  const bytes = decodeBytes(encoded);
  const weights = new Uint16Array(bytes.length / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < weights.length; i += 1) weights[i] = view.getUint16(i * 2, true);
  return weights;
};

const deltaQuaternion = (
  rest: THREE.Quaternion,
  x: number,
  y: number,
  z: number,
): THREE.Quaternion => rest.clone().multiply(
  new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ')),
);

const track = (
  bones: readonly THREE.Bone[],
  slot: number,
  times: readonly number[],
  eulers: ReadonlyArray<readonly [number, number, number]>,
): THREE.QuaternionKeyframeTrack => {
  const rest = bones[slot].quaternion.clone();
  const values = eulers.flatMap(([x, y, z]) => {
    const q = deltaQuaternion(rest, x, y, z);
    return [q.x, q.y, q.z, q.w];
  });
  return new THREE.QuaternionKeyframeTrack(`${bones[slot].name}.quaternion`, [...times], values);
};

const createClips = (bones: readonly THREE.Bone[]): THREE.AnimationClip[] => {
  const idleTimes = [0, 0.75, 1.5, 2.25, 3];
  const idleTracks: THREE.KeyframeTrack[] = [
    track(bones, 3, idleTimes, [[0, 0, 0], [0.006, 0.008, 0], [0, 0, 0], [-0.006, -0.008, 0], [0, 0, 0]]),
    track(bones, 4, idleTimes, [[0, 0, 0], [-0.004, 0.012, 0], [0, 0, 0], [0.004, -0.012, 0], [0, 0, 0]]),
    track(bones, 6, idleTimes, [[0, 0, 0], [0, 0.018, 0], [0, 0, 0], [0, -0.018, 0], [0, 0, 0]]),
  ];
  for (let slot = 86; slot <= 93; slot += 1) {
    const amplitude = 0.012 + (slot - 86) * 0.004;
    idleTracks.push(track(bones, slot, idleTimes, [
      [0, 0, 0], [0, amplitude, 0], [0, 0, 0], [0, -amplitude, 0], [0, 0, 0],
    ]));
  }

  const gestureTimes = [0, 0.4, 0.8, 1.2, 1.6, 2];
  const gestureTracks: THREE.KeyframeTrack[] = [
    track(bones, 37, gestureTimes, [[0, 0, 0], [0, 0, 0.28], [0, 0, 0.28], [0, 0, 0.28], [0, 0, 0.12], [0, 0, 0]]),
    track(bones, 38, gestureTimes, [[0, 0, 0], [0, 0.38, 0], [0, 0.64, 0], [0, 0.30, 0], [0, 0.58, 0], [0, 0, 0]]),
    track(bones, 39, gestureTimes, [[0, 0, 0], [0.16, 0, 0], [-0.16, 0, 0], [0.16, 0, 0], [-0.16, 0, 0], [0, 0, 0]]),
  ];

  return [
    new THREE.AnimationClip('small-periodic-spine-tail-cycle', 3, idleTracks),
    new THREE.AnimationClip('right-arm-oscillation', 2, gestureTracks),
  ];
};

const createController = (
  root: THREE.Group,
  clips: readonly THREE.AnimationClip[],
): MarsCatAnimationController => {
  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map(clips.map((clip) => [clip.name, mixer.clipAction(clip)]));
  for (const action of actions.values()) action.setLoop(THREE.LoopRepeat, Infinity);
  const idleId = 'small-periodic-spine-tail-cycle';
  let active = idleId;
  actions.get(idleId)!.play();
  const listeners = new Set<(id: string) => void>();
  const transition = (id: string) => {
    const next = actions.get(id);
    if (!next) return;
    mixer.stopAllAction();
    next.reset().setLoop(THREE.LoopRepeat, Infinity).play();
    mixer.update(0);
    active = id;
    listeners.forEach((listener) => listener(active));
  };
  return {
    actions: [
      { id: 'right-arm-oscillation', label: 'Right-arm oscillation', loop: true },
    ],
    get active() { return active; },
    play: transition,
    seek: (id, timeSeconds) => {
      const next = actions.get(id);
      if (!next) throw new Error(`Mars Cat animation clip ${id} is absent`);
      mixer.stopAllAction();
      next.reset().setLoop(THREE.LoopRepeat, Infinity).play();
      next.paused = true;
      next.time = THREE.MathUtils.clamp(timeSeconds, 0, next.getClip().duration);
      mixer.update(0);
      active = id;
      listeners.forEach((listener) => listener(active));
    },
    stop: () => {
      mixer.stopAllAction();
      mixer.update(0);
      active = idleId;
      listeners.forEach((listener) => listener(active));
    },
    update: (deltaSeconds) => mixer.update(THREE.MathUtils.clamp(deltaSeconds, 0, 0.05)),
    subscribe: (listener) => {
      listeners.add(listener);
      listener(active);
      return () => listeners.delete(listener);
    },
  };
};

export function bindMarsCatRig(
  root: THREE.Group,
  skinTier: 'fidelity' | 'game' = 'fidelity',
): MarsCatRigRuntime {
  const bones = MARS_CAT_RIG.runtimeNames.map((name, slot) => {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.userData.sourceNodeIndex = MARS_CAT_RIG.jointNodes[slot];
    bone.userData.sourceName = MARS_CAT_RIG.sourceNames[slot];
    const matrix = new THREE.Matrix4().fromArray(MARS_CAT_RIG.localMatricesColumnMajor[slot]);
    matrix.decompose(bone.position, bone.quaternion, bone.scale);
    return bone;
  });
  MARS_CAT_RIG.parents.forEach((parent, slot) => {
    if (parent === null) root.add(bones[slot]);
    else bones[parent].add(bones[slot]);
  });
  root.updateMatrixWorld(true);
  const inverses = MARS_CAT_RIG.inverseBindMatricesColumnMajor.map(
    (matrix) => new THREE.Matrix4().fromArray(matrix),
  );
  const skeleton = new THREE.Skeleton(bones, inverses);

  const skinRecords: Record<string, {
    readonly vertexCount: number;
    readonly sourceNode: number;
    readonly indicesBase64: string;
    readonly weightsBase64: string;
  }> = skinTier === 'game' ? MARS_CAT_GAME_SKIN : MARS_CAT_SKIN;
  const sourceMeshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) sourceMeshes.push(object);
  });
  const parts = root.userData.parts as Record<string, THREE.Mesh> | undefined;
  for (const source of sourceMeshes) {
    const record = skinRecords[source.name];
    if (!record) throw new Error(`Mars Cat rig has no measured skin record for ${source.name}`);
    const vertexCount = source.geometry.getAttribute('position').count;
    if (record.vertexCount !== vertexCount) {
      throw new Error(`${source.name}: rig has ${record.vertexCount} vertices, geometry has ${vertexCount}`);
    }
    source.geometry.setAttribute(
      'skinIndex',
      new THREE.Uint8BufferAttribute(decodeBytes(record.indicesBase64), 4),
    );
    source.geometry.setAttribute(
      'skinWeight',
      new THREE.Uint16BufferAttribute(decodeWeights(record.weightsBase64), 4, true),
    );
    const mesh = new THREE.SkinnedMesh(source.geometry, source.material);
    mesh.name = source.name;
    mesh.position.copy(source.position);
    mesh.quaternion.copy(source.quaternion);
    mesh.scale.copy(source.scale);
    mesh.castShadow = source.castShadow;
    mesh.receiveShadow = source.receiveShadow;
    mesh.frustumCulled = false;
    mesh.userData = source.userData;
    const parent = source.parent;
    if (!parent) throw new Error(`${source.name}: mesh has no parent during rig bind`);
    const childIndex = parent.children.indexOf(source);
    parent.remove(source);
    parent.add(mesh);
    if (childIndex >= 0) {
      parent.children.splice(parent.children.indexOf(mesh), 1);
      parent.children.splice(childIndex, 0, mesh);
    }
    mesh.bindMode = 'attached';
    mesh.bind(skeleton, new THREE.Matrix4());
    if (parts?.[source.name] === source) parts[source.name] = mesh;
  }

  const clips = createClips(bones);
  root.animations = [...clips];
  const animationController = createController(root, clips);
  return {
    skeleton,
    bones,
    clips,
    animationController,
    update: (deltaSeconds) => {
      animationController.update(deltaSeconds);
      root.updateMatrixWorld(true);
      skeleton.update();
    },
  };
}
