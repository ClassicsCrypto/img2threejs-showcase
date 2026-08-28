import * as THREE from 'three';
import {
  SOURCE_ANIMATION_CLIPS,
  SOURCE_GLB_SHA256,
  SOURCE_SCENE_ROOTS,
  SOURCE_SKIN,
  SOURCE_TECHNICAL_NODES,
} from './sourceRigAnimationData';
import { describeSourceAnimation } from './sourceAnimationNames';

export interface SourceAnimationController {
  readonly actions: ReadonlyArray<{ id: string; label: string; loop: boolean }>;
  readonly active: string;
  /**
   * Seconds into the running clip, read from the mixer's own action.
   *
   * Anything that has to stay in step with the pose -- effects, above all -- must read THIS rather
   * than accumulate its own delta. The two drift apart the moment a frame is long: a stall while the
   * payload decodes hands the next frame a delta worth the whole pause, the mixer swallows it, and a
   * parallel counter that was just reset does not.
   */
  readonly time: number;
  play(name: string): void;
  seek(name: string, time: number): boolean;
  stop(): void;
  subscribe(listener: (active: string) => void): () => void;
  advance(delta: number): void;
}

export interface SourceRigRuntime {
  container: THREE.Group;
  armature: THREE.Object3D;
  nodes: Map<number, THREE.Object3D>;
  skeleton: THREE.Skeleton;
  clips: THREE.AnimationClip[];
  controller: SourceAnimationController;
}

function decodeFloat32Base64(encoded: string): Float32Array {
  const raw = atob(encoded);
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  if (bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error(`Lee Sin Float32 payload has unaligned byte length ${bytes.byteLength}`);
  }
  return new Float32Array(bytes.buffer);
}

function createClips(nodes: Map<number, THREE.Object3D>): THREE.AnimationClip[] {
  return SOURCE_ANIMATION_CLIPS.map((clip) => {
    const tracks = clip.tracks.map((track) => {
      if (!nodes.has(track.nodeIndex)) {
        throw new Error(`Lee Sin animation ${clip.name} targets missing node ${track.nodeIndex}`);
      }
      const times = decodeFloat32Base64(track.timesBase64);
      const values = decodeFloat32Base64(track.valuesBase64);
      const interpolation = track.interpolation === 'STEP'
        ? THREE.InterpolateDiscrete
        : THREE.InterpolateLinear;
      const property = track.path === 'rotation'
        ? 'quaternion'
        : track.path === 'translation' ? 'position' : 'scale';
      const binding = `${track.nodeName}.${property}`;
      const keyframe = track.path === 'rotation'
        ? new THREE.QuaternionKeyframeTrack(binding, times, values, interpolation)
        : new THREE.VectorKeyframeTrack(binding, times, values, interpolation);
      Object.assign(keyframe, { userData: {
        sourceAnimationIndex: clip.index,
        sourceChannelIndex: track.channelIndex,
        sourceSamplerIndex: track.samplerIndex,
        sourceInterpolation: track.interpolation,
        timesSha256: track.timesSha256,
        valuesSha256: track.valuesSha256,
      } });
      return keyframe;
    });
    // Named from measured motion instead of the source's `NlaTrack.00N`. The source name stays on
    // userData, so the accessor-parity chain still points back at exactly one GLB animation.
    const named = describeSourceAnimation(clip.sourceName);
    const animation = new THREE.AnimationClip(named.id, clip.duration, tracks);
    Object.assign(animation, { userData: {
      sourceGlbSha256: SOURCE_GLB_SHA256,
      sourceAnimationIndex: clip.index,
      sourceAnimationName: clip.sourceName,
      measuredName: named,
      exactCodeNativeAccessorTransfer: true,
    } });
    return animation;
  });
}

function createController(
  container: THREE.Group,
  nodes: Map<number, THREE.Object3D>,
  clips: THREE.AnimationClip[],
): SourceAnimationController {
  const mixer = new THREE.AnimationMixer(container);
  const bind = new Map([...nodes].map(([index, node]) => [index, {
    position: node.position.clone(),
    quaternion: node.quaternion.clone(),
    scale: node.scale.clone(),
  }]));
  const listeners = new Set<(active: string) => void>();
  let active = 'idle';
  let current: THREE.AnimationAction | null = null;
  const restore = (): void => {
    for (const [index, transform] of bind) {
      const node = nodes.get(index)!;
      node.position.copy(transform.position);
      node.quaternion.copy(transform.quaternion);
      node.scale.copy(transform.scale);
    }
    container.updateMatrixWorld(true);
  };
  const notify = (): void => listeners.forEach((listener) => listener(active));
  const find = (name: string): THREE.AnimationClip | undefined => clips.find((clip) => clip.name === name);
  return {
    // Hidden clips stay in `clips` -- and therefore in the parity gates -- but are not offered as
    // actions. `flatMap` rather than `filter(...).map(...)` so the name lookup happens once.
    actions: clips.flatMap((clip) => {
      const named = describeSourceAnimation(
        (clip as unknown as { userData: { sourceAnimationName: string } }).userData.sourceAnimationName,
      );
      if (named.hidden) return [];
      return [{
        id: clip.name,
        label: `${named.label} · ${clip.duration.toFixed(2)} s`,
        // glTF carries no loop flag. Decided by measurement instead of assumed: a clip whose hips
        // neither travel nor rise can repeat seamlessly, the rest play once.
        loop: named.loop,
      }];
    }),
    get active() { return active; },
    get time() { return current ? current.time : 0; },
    play(name: string) {
      const clip = find(name);
      if (!clip) throw new Error(`Unknown Lee Sin source animation ${name}`);
      mixer.stopAllAction();
      restore();
      const named = describeSourceAnimation(
        (clip as unknown as { userData: { sourceAnimationName: string } }).userData.sourceAnimationName,
      );
      current = mixer.clipAction(clip).reset();
      if (named.loop) current.setLoop(THREE.LoopRepeat, Infinity);
      else { current.setLoop(THREE.LoopOnce, 1); current.clampWhenFinished = true; }
      current.play();
      active = name;
      notify();
    },
    seek(name: string, time: number) {
      const clip = find(name);
      if (!clip) return false;
      mixer.stopAllAction();
      restore();
      current = mixer.clipAction(clip).reset();
      current.setLoop(THREE.LoopOnce, 1);
      current.clampWhenFinished = true;
      current.play();
      current.paused = true;
      current.time = THREE.MathUtils.clamp(time, 0, clip.duration);
      mixer.update(0);
      container.updateMatrixWorld(true);
      active = name;
      notify();
      return true;
    },
    stop() {
      mixer.stopAllAction();
      current = null;
      restore();
      active = 'idle';
      notify();
    },
    subscribe(listener: (value: string) => void) {
      listeners.add(listener);
      listener(active);
      return () => listeners.delete(listener);
    },
    advance(delta: number) {
      if (!current) return;
      mixer.update(delta);
      container.updateMatrixWorld(true);
    },
  };
}

export function createSourceRigRuntime(): SourceRigRuntime {
  const jointIndices = new Set<number>(SOURCE_SKIN.joints);
  const nodes = new Map<number, THREE.Object3D>();
  for (const value of SOURCE_TECHNICAL_NODES) {
    const object = jointIndices.has(value.index) ? new THREE.Bone() : new THREE.Group();
    object.name = value.name;
    object.position.fromArray(value.translation);
    object.quaternion.fromArray(value.rotation);
    object.scale.fromArray(value.scale);
    object.userData = {
      sourceNodeIndex: value.index,
      semanticStatus: 'technical-animation-binding-only',
    };
    nodes.set(value.index, object);
  }
  for (const value of SOURCE_TECHNICAL_NODES) {
    const parent = nodes.get(value.index)!;
    for (const childIndex of value.children) parent.add(nodes.get(childIndex)!);
  }
  const container = new THREE.Group();
  container.name = 'leesin-code-native-source-rig';
  for (const rootIndex of SOURCE_SCENE_ROOTS) container.add(nodes.get(rootIndex)!);
  container.updateMatrixWorld(true);

  const inverse = decodeFloat32Base64(SOURCE_SKIN.inverseBindMatricesBase64);
  const boneInverses = SOURCE_SKIN.joints.map(
    (_, index) => new THREE.Matrix4().fromArray(inverse, index * 16),
  );
  const bones = SOURCE_SKIN.joints.map((index) => nodes.get(index) as THREE.Bone);
  const skeleton = new THREE.Skeleton(bones, boneInverses);
  const clips = createClips(nodes);
  const controller = createController(container, nodes, clips);
  return {
    container,
    armature: nodes.get(111)!,
    nodes,
    skeleton,
    clips,
    controller,
  };
}
