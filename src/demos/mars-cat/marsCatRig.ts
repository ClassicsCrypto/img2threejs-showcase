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

interface AuthoredClipMetadata {
  readonly label: string;
  readonly loop: boolean;
  readonly inferred: boolean;
  readonly measured: string;
}

interface AuthoredAnimationClip extends THREE.AnimationClip {
  userData: AuthoredClipMetadata & {
    readonly source: 'R4-authored-from-measured-GLB-rig';
    readonly sourceAnimationCount: 0;
  };
}

const authoredClip = (
  name: string,
  duration: number,
  tracks: THREE.KeyframeTrack[],
  metadata: AuthoredClipMetadata,
): AuthoredAnimationClip => {
  const clip = new THREE.AnimationClip(name, duration, tracks) as AuthoredAnimationClip;
  clip.userData = {
    ...metadata,
    source: 'R4-authored-from-measured-GLB-rig',
    sourceAnimationCount: 0,
  };
  return clip;
};

const phaseTimes = (duration: number, fractions: readonly number[]): number[] => (
  fractions.map((fraction) => duration * fraction)
);

const createClips = (bones: readonly THREE.Bone[]): AuthoredAnimationClip[] => {
  // Blender's measured arm chains run along each bone's local +Y. Shoulder
  // lowering therefore uses local Z, while elbow flexion uses local X; local
  // Y would only twist the sleeve around its length.
  const shoulderLeftDown = -1.05;
  const shoulderRightDown = 1.05;
  const elbowNeutral = 0.75;
  const hold = (count: number, x: number, y: number, z: number): Array<readonly [number, number, number]> => (
    Array.from({ length: count }, () => [x, y, z] as const)
  );
  const idleTimes = [0, 0.75, 1.5, 2.25, 3];
  const idleTracks: THREE.KeyframeTrack[] = [
    track(bones, 3, idleTimes, [[0, 0, 0], [0.006, 0.008, 0], [0, 0, 0], [-0.006, -0.008, 0], [0, 0, 0]]),
    track(bones, 4, idleTimes, [[0, 0, 0], [-0.004, 0.012, 0], [0, 0, 0], [0.004, -0.012, 0], [0, 0, 0]]),
    track(bones, 6, idleTimes, [[0, 0, 0], [0, 0.018, 0], [0, 0, 0], [0, -0.018, 0], [0, 0, 0]]),
    track(bones, 9, idleTimes, hold(5, 0, 0, shoulderLeftDown)),
    track(bones, 10, idleTimes, hold(5, elbowNeutral, 0, 0)),
    track(bones, 37, idleTimes, hold(5, 0, 0, shoulderRightDown)),
    track(bones, 38, idleTimes, hold(5, elbowNeutral, 0, 0)),
  ];
  for (let slot = 86; slot <= 93; slot += 1) {
    const amplitude = 0.012 + (slot - 86) * 0.004;
    idleTracks.push(track(bones, slot, idleTimes, [
      [0, 0, 0], [0, amplitude, 0], [0, 0, 0], [0, -amplitude, 0], [0, 0, 0],
    ]));
  }

  const gestureTimes = [0, 0.4, 0.8, 1.2, 1.6, 2];
  const gestureTracks: THREE.KeyframeTrack[] = [
    track(bones, 3, gestureTimes, [[0, 0, 0], [0, 0.08, 0], [0, -0.18, 0], [0, -0.12, 0], [0, 0.04, 0], [0, 0, 0]]),
    track(bones, 9, gestureTimes, hold(6, 0, 0, shoulderLeftDown)),
    track(bones, 10, gestureTimes, hold(6, elbowNeutral, 0, 0)),
    track(bones, 37, gestureTimes, [[0, 0, shoulderRightDown], [-0.18, 0, 0.92], [-0.52, 0, 0.62], [-0.34, 0, 0.78], [-0.10, 0, 0.96], [0, 0, shoulderRightDown]]),
    track(bones, 38, gestureTimes, [[elbowNeutral, 0, 0], [0.48, 0, 0], [0.08, 0, 0], [0.28, 0, 0], [0.58, 0, 0], [elbowNeutral, 0, 0]]),
    track(bones, 39, gestureTimes, [[0, 0, 0], [0.10, 0, 0], [-0.08, 0, 0], [0.04, 0, 0], [0.02, 0, 0], [0, 0, 0]]),
  ];

  const cyclicFractions = [0, 0.25, 0.5, 0.75, 1];
  const gaitFractions = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
  const walkTimes = phaseTimes(1.2, gaitFractions);
  const runTimes = phaseTimes(0.76, gaitFractions);
  const walkTracks: THREE.KeyframeTrack[] = [
    track(bones, 72, walkTimes, [[0, 0, 0], [-0.12, 0, 0], [-0.24, 0, 0], [-0.12, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]),
    track(bones, 79, walkTimes, [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0.12, 0, 0], [0.24, 0, 0], [0.12, 0, 0], [0, 0, 0]]),
    track(bones, 73, walkTimes, [[0, 0, 0], [0.08, 0, 0], [0.16, 0, 0], [0.08, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]),
    track(bones, 80, walkTimes, [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0.08, 0, 0], [0.16, 0, 0], [0.08, 0, 0], [0, 0, 0]]),
    track(bones, 9, walkTimes, [[0, 0, shoulderLeftDown], [0.08, 0, shoulderLeftDown], [0.16, 0, shoulderLeftDown], [0.08, 0, shoulderLeftDown], [0, 0, shoulderLeftDown], [-0.08, 0, shoulderLeftDown], [-0.16, 0, shoulderLeftDown], [-0.08, 0, shoulderLeftDown], [0, 0, shoulderLeftDown]]),
    track(bones, 10, walkTimes, hold(9, 0.58, 0, 0)),
    track(bones, 37, walkTimes, [[0, 0, shoulderRightDown], [-0.08, 0, shoulderRightDown], [-0.16, 0, shoulderRightDown], [-0.08, 0, shoulderRightDown], [0, 0, shoulderRightDown], [0.08, 0, shoulderRightDown], [0.16, 0, shoulderRightDown], [0.08, 0, shoulderRightDown], [0, 0, shoulderRightDown]]),
    track(bones, 38, walkTimes, hold(9, 0.58, 0, 0)),
    track(bones, 1, walkTimes, [[0, 0, 0], [0, 0.009, 0], [0, 0.018, 0], [0, 0.009, 0], [0, 0, 0], [0, -0.009, 0], [0, -0.018, 0], [0, -0.009, 0], [0, 0, 0]]),
  ];
  const runTracks: THREE.KeyframeTrack[] = [
    track(bones, 72, runTimes, [[0, 0, 0], [-0.21, 0, 0], [-0.42, 0, 0], [-0.21, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]),
    track(bones, 79, runTimes, [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0.21, 0, 0], [0.42, 0, 0], [0.21, 0, 0], [0, 0, 0]]),
    track(bones, 73, runTimes, [[0, 0, 0], [0.19, 0, 0], [0.38, 0, 0], [0.19, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]),
    track(bones, 80, runTimes, [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0.19, 0, 0], [0.38, 0, 0], [0.19, 0, 0], [0, 0, 0]]),
    track(bones, 9, runTimes, [[0, 0, shoulderLeftDown], [0.14, 0, shoulderLeftDown], [0.28, 0, shoulderLeftDown], [0.14, 0, shoulderLeftDown], [0, 0, shoulderLeftDown], [-0.14, 0, shoulderLeftDown], [-0.28, 0, shoulderLeftDown], [-0.14, 0, shoulderLeftDown], [0, 0, shoulderLeftDown]]),
    track(bones, 10, runTimes, hold(9, 0.46, 0, 0)),
    track(bones, 37, runTimes, [[0, 0, shoulderRightDown], [-0.14, 0, shoulderRightDown], [-0.28, 0, shoulderRightDown], [-0.14, 0, shoulderRightDown], [0, 0, shoulderRightDown], [0.14, 0, shoulderRightDown], [0.28, 0, shoulderRightDown], [0.14, 0, shoulderRightDown], [0, 0, shoulderRightDown]]),
    track(bones, 38, runTimes, hold(9, 0.46, 0, 0)),
    track(bones, 2, runTimes, [[0, 0, 0], [0.0125, 0, 0], [0.025, 0, 0], [0.0125, 0, 0], [0, 0, 0], [0.0125, 0, 0], [0.025, 0, 0], [0.0125, 0, 0], [0, 0, 0]]),
  ];

  const jumpTimes = phaseTimes(1.25, cyclicFractions);
  const jumpTracks: THREE.KeyframeTrack[] = [
    track(bones, 1, jumpTimes, [[0, 0, 0], [0.10, 0, 0], [-0.04, 0, 0], [0.08, 0, 0], [0, 0, 0]]),
    track(bones, 79, jumpTimes, [[0, 0, 0], [0.22, 0, 0], [-1.00, 0, 0], [-0.28, 0, 0], [0, 0, 0]]),
    track(bones, 80, jumpTimes, [[0, 0, 0], [0.50, 0, 0], [0.32, 0, 0], [0.44, 0, 0], [0, 0, 0]]),
    track(bones, 9, jumpTimes, [[0, 0, shoulderLeftDown], [-0.16, 0, -0.82], [-0.38, 0, -0.72], [-0.14, 0, -0.84], [0, 0, shoulderLeftDown]]),
    track(bones, 10, jumpTimes, [[elbowNeutral, 0, 0], [0.82, 0, 0], [1.00, 0, 0], [0.84, 0, 0], [elbowNeutral, 0, 0]]),
    track(bones, 37, jumpTimes, [[0, 0, shoulderRightDown], [-0.16, 0, 0.82], [-0.38, 0, 0.72], [-0.14, 0, 0.84], [0, 0, shoulderRightDown]]),
    track(bones, 38, jumpTimes, [[elbowNeutral, 0, 0], [0.82, 0, 0], [1.00, 0, 0], [0.84, 0, 0], [elbowNeutral, 0, 0]]),
  ];

  const strikeFractions = [0, 0.22, 0.48, 0.68, 1];
  const leadPunchTimes = phaseTimes(1.1, strikeFractions);
  const leadPunchTracks: THREE.KeyframeTrack[] = [
    track(bones, 3, leadPunchTimes, [[0, 0, 0], [0, 0.08, 0], [0, -0.12, 0], [0, -0.08, 0], [0, 0, 0]]),
    track(bones, 9, leadPunchTimes, hold(5, 0, 0, shoulderLeftDown)),
    track(bones, 10, leadPunchTimes, hold(5, 1.05, 0, 0)),
    track(bones, 37, leadPunchTimes, [[0, 0, shoulderRightDown], [-0.18, 0, 0.88], [-0.56, 0, 0.56], [-0.34, 0, 0.76], [0, 0, shoulderRightDown]]),
    track(bones, 38, leadPunchTimes, [[elbowNeutral, 0, 0], [0.50, 0, 0], [0.04, 0, 0], [0.28, 0, 0], [elbowNeutral, 0, 0]]),
    track(bones, 39, leadPunchTimes, [[0, 0, 0], [0.12, 0, 0], [-0.06, 0, 0], [0.06, 0, 0], [0, 0, 0]]),
  ];
  const combinationTimes = phaseTimes(1.7, [0, 0.16, 0.32, 0.50, 0.68, 0.84, 1]);
  const combinationTracks: THREE.KeyframeTrack[] = [
    track(bones, 3, combinationTimes, [[0, 0, 0], [0, 0.08, 0], [0, -0.08, 0], [0, -0.04, 0], [0, 0.10, 0], [0, 0.04, 0], [0, 0, 0]]),
    track(bones, 9, combinationTimes, [[0, 0, shoulderLeftDown], [0, 0, -0.84], [-0.48, 0, -0.58], [0, 0, shoulderLeftDown], [0, 0, -0.88], [-0.38, 0, -0.64], [0, 0, shoulderLeftDown]]),
    track(bones, 10, combinationTimes, [[elbowNeutral, 0, 0], [0.48, 0, 0], [0.05, 0, 0], [elbowNeutral, 0, 0], [0.54, 0, 0], [0.16, 0, 0], [elbowNeutral, 0, 0]]),
    track(bones, 37, combinationTimes, [[0, 0, shoulderRightDown], [-0.44, 0, 0.60], [0, 0, 0.92], [0, 0, shoulderRightDown], [-0.52, 0, 0.56], [0, 0, 0.86], [0, 0, shoulderRightDown]]),
    track(bones, 38, combinationTimes, [[elbowNeutral, 0, 0], [0.08, 0, 0], [0.48, 0, 0], [elbowNeutral, 0, 0], [0.04, 0, 0], [0.42, 0, 0], [elbowNeutral, 0, 0]]),
  ];
  const hookTimes = phaseTimes(1.2, strikeFractions);
  const hookTracks: THREE.KeyframeTrack[] = [
    track(bones, 3, hookTimes, [[0, 0, 0], [0, 0.14, 0], [0, -0.24, 0], [0, -0.10, 0], [0, 0, 0]]),
    track(bones, 9, hookTimes, hold(5, 0, 0, shoulderLeftDown)),
    track(bones, 10, hookTimes, hold(5, 1.0, 0, 0)),
    track(bones, 37, hookTimes, [[0, 0, shoulderRightDown], [-0.28, 0, 0.74], [-0.10, 0.38, 0.42], [-0.18, 0.16, 0.72], [0, 0, shoulderRightDown]]),
    track(bones, 38, hookTimes, [[elbowNeutral, 0, 0], [1.18, 0, 0], [1.42, 0, 0], [1.08, 0, 0], [elbowNeutral, 0, 0]]),
    track(bones, 39, hookTimes, [[0, 0, 0], [0.22, 0, 0], [0.38, 0, 0], [0.18, 0, 0], [0, 0, 0]]),
  ];

  const kickTimes = phaseTimes(1.35, [0, 0.20, 0.46, 0.66, 1]);
  const kickTracks: THREE.KeyframeTrack[] = [
    track(bones, 1, kickTimes, [[0, 0, 0], [0.08, 0, 0], [-0.06, 0, 0], [0.04, 0, 0], [0, 0, 0]]),
    track(bones, 79, kickTimes, [[0, 0, 0], [0.18, 0, 0], [-1.10, 0, 0], [-0.30, 0, 0], [0, 0, 0]]),
    track(bones, 80, kickTimes, [[0, 0, 0], [0.54, 0, 0], [0.35, 0, 0], [0.48, 0, 0], [0, 0, 0]]),
    track(bones, 81, kickTimes, [[0, 0, 0], [-0.10, 0, 0], [0.16, 0, 0], [0.04, 0, 0], [0, 0, 0]]),
    track(bones, 9, kickTimes, [[0, 0, shoulderLeftDown], [0.12, 0, -0.92], [-0.18, 0, -0.78], [-0.08, 0, -0.94], [0, 0, shoulderLeftDown]]),
    track(bones, 10, kickTimes, [[elbowNeutral, 0, 0], [0.92, 0, 0], [1.08, 0, 0], [0.88, 0, 0], [elbowNeutral, 0, 0]]),
    track(bones, 37, kickTimes, [[0, 0, shoulderRightDown], [-0.12, 0, 0.92], [0.18, 0, 0.78], [0.08, 0, 0.94], [0, 0, shoulderRightDown]]),
    track(bones, 38, kickTimes, [[elbowNeutral, 0, 0], [0.92, 0, 0], [1.08, 0, 0], [0.88, 0, 0], [elbowNeutral, 0, 0]]),
  ];

  const reactionTimes = phaseTimes(1.15, [0, 0.18, 0.44, 0.72, 1]);
  const hitReactionTracks: THREE.KeyframeTrack[] = [
    track(bones, 0, reactionTimes, [[0, 0, 0], [0.04, 0, 0], [-0.12, 0, 0.04], [0.04, 0, -0.02], [0, 0, 0]]),
    track(bones, 2, reactionTimes, [[0, 0, 0], [0.08, 0, 0], [-0.18, 0, 0.05], [0.06, 0, 0], [0, 0, 0]]),
    track(bones, 6, reactionTimes, [[0, 0, 0], [-0.06, 0.10, 0], [0.14, -0.12, 0], [-0.04, 0.04, 0], [0, 0, 0]]),
    track(bones, 9, reactionTimes, [[0, 0, shoulderLeftDown], [0.12, 0, -1.00], [0.34, 0, -0.78], [0.08, 0, -0.96], [0, 0, shoulderLeftDown]]),
    track(bones, 10, reactionTimes, [[elbowNeutral, 0, 0], [0.88, 0, 0], [1.18, 0, 0], [0.92, 0, 0], [elbowNeutral, 0, 0]]),
    track(bones, 37, reactionTimes, [[0, 0, shoulderRightDown], [-0.12, 0, 1.00], [-0.34, 0, 0.78], [-0.08, 0, 0.96], [0, 0, shoulderRightDown]]),
    track(bones, 38, reactionTimes, [[elbowNeutral, 0, 0], [0.88, 0, 0], [1.18, 0, 0], [0.92, 0, 0], [elbowNeutral, 0, 0]]),
  ];

  const rageTimes = phaseTimes(1.8, cyclicFractions);
  const rageTracks: THREE.KeyframeTrack[] = [
    track(bones, 2, rageTimes, [[0, 0, 0], [-0.06, 0, 0], [0.04, 0, 0], [-0.06, 0, 0], [0, 0, 0]]),
    track(bones, 6, rageTimes, [[0, 0, 0], [0, 0.08, 0], [0, -0.08, 0], [0, 0.08, 0], [0, 0, 0]]),
    track(bones, 9, rageTimes, [[0, 0, shoulderLeftDown], [0, 0, -0.62], [0, 0, -0.38], [0, 0, -0.62], [0, 0, shoulderLeftDown]]),
    track(bones, 37, rageTimes, [[0, 0, shoulderRightDown], [0, 0, 0.62], [0, 0, 0.38], [0, 0, 0.62], [0, 0, shoulderRightDown]]),
    track(bones, 10, rageTimes, [[elbowNeutral, 0, 0], [1.00, 0, 0], [1.20, 0, 0], [1.00, 0, 0], [elbowNeutral, 0, 0]]),
    track(bones, 38, rageTimes, [[elbowNeutral, 0, 0], [1.00, 0, 0], [1.20, 0, 0], [1.00, 0, 0], [elbowNeutral, 0, 0]]),
  ];
  const danceTimes = phaseTimes(2.2, cyclicFractions);
  const danceTracks: THREE.KeyframeTrack[] = [
    track(bones, 1, danceTimes, [[0, 0, 0], [0.05, 0, 0], [-0.04, 0, 0], [0.02, 0, 0], [0, 0, 0]]),
    track(bones, 72, danceTimes, [[0, 0, 0], [0.20, 0, 0], [-0.95, 0, 0], [-0.26, 0, 0], [0, 0, 0]]),
    track(bones, 73, danceTimes, [[0, 0, 0], [0.50, 0, 0], [0.30, 0, 0], [0.42, 0, 0], [0, 0, 0]]),
    track(bones, 9, danceTimes, [[0, 0, shoulderLeftDown], [0.16, 0, -0.90], [-0.12, 0, -0.76], [0.08, 0, -0.92], [0, 0, shoulderLeftDown]]),
    track(bones, 10, danceTimes, [[elbowNeutral, 0, 0], [0.92, 0, 0], [1.06, 0, 0], [0.88, 0, 0], [elbowNeutral, 0, 0]]),
    track(bones, 37, danceTimes, [[0, 0, shoulderRightDown], [-0.16, 0, 0.90], [0.12, 0, 0.76], [-0.08, 0, 0.92], [0, 0, shoulderRightDown]]),
    track(bones, 38, danceTimes, [[elbowNeutral, 0, 0], [0.92, 0, 0], [1.06, 0, 0], [0.88, 0, 0], [elbowNeutral, 0, 0]]),
  ];
  const guardTimes = phaseTimes(2.4, cyclicFractions);
  const guardTracks: THREE.KeyframeTrack[] = [
    track(bones, 2, guardTimes, [[0, 0, 0], [0.06, 0, 0], [0.08, 0, 0], [0.06, 0, 0], [0, 0, 0]]),
    track(bones, 6, guardTimes, [[0, 0, 0], [-0.04, 0, 0], [-0.06, 0, 0], [-0.04, 0, 0], [0, 0, 0]]),
    track(bones, 9, guardTimes, [[0, 0, shoulderLeftDown], [-0.08, 0, -0.80], [-0.12, 0, -0.68], [-0.08, 0, -0.80], [0, 0, shoulderLeftDown]]),
    track(bones, 37, guardTimes, [[0, 0, shoulderRightDown], [-0.08, 0, 0.80], [-0.12, 0, 0.68], [-0.08, 0, 0.80], [0, 0, shoulderRightDown]]),
    track(bones, 10, guardTimes, [[elbowNeutral, 0, 0], [1.10, 0, 0], [1.35, 0, 0], [1.10, 0, 0], [elbowNeutral, 0, 0]]),
    track(bones, 38, guardTimes, [[elbowNeutral, 0, 0], [1.10, 0, 0], [1.35, 0, 0], [1.10, 0, 0], [elbowNeutral, 0, 0]]),
  ];

  return [
    authoredClip('small-periodic-spine-tail-cycle', 3, idleTracks, {
      label: 'Idle - breathing and tail', loop: true, inferred: false,
      measured: 'authored neutral has shoulders 65 deg down and elbows 43.3 deg flexed; spine/tail return over 3.0 s',
    }),
    authoredClip('dash-punch-motion', 2, gestureTracks, {
      label: 'Dash Punch', loop: false, inferred: true,
      measured: 'right arm reach and spine rotation; translation remains host-controlled',
    }),
    authoredClip('footwork-cycle', 1.2, walkTracks, {
      label: 'Footwork', loop: true, inferred: true,
      measured: '1.2 s cycle on mirrored thigh/shin chains; zero authored root travel',
    }),
    authoredClip('charge-cycle', 0.76, runTracks, {
      label: 'Charge', loop: true, inferred: true,
      measured: '0.76 s cycle on mirrored limb chains; translation remains host-controlled',
    }),
    authoredClip('fireball-kick-motion', 1.25, jumpTracks, {
      label: 'Fireball Kick', loop: false, inferred: true,
      measured: 'right leg extension plus bilateral arm lift; zero authored root translation',
    }),
    authoredClip('lead-punch', 1.1, leadPunchTracks, {
      label: 'Lead Punch', loop: false, inferred: true,
      measured: 'right hand travels 0.273 m, elbow extends to 5.2 deg, planted feet, authored-neutral return',
    }),
    authoredClip('three-hit-combination', 1.7, combinationTracks, {
      label: 'Combination', loop: false, inferred: true,
      measured: 'three alternating arm-chain reach peaks with zero root travel',
    }),
    authoredClip('hook-motion', 1.2, hookTracks, {
      label: 'Hook', loop: false, inferred: true,
      measured: 'right hand arc driven by spine, shoulder, forearm and hand tracks',
    }),
    authoredClip('front-kick-motion', 1.35, kickTracks, {
      label: 'Front Kick', loop: false, inferred: true,
      measured: 'right measured leg-chain extension with the opposite foot planted',
    }),
    authoredClip('knockout-reaction', 1.15, hitReactionTracks, {
      label: 'Knockout', loop: false, inferred: true,
      measured: 'spine/head recoil with planted feet and exact authored-neutral return',
    }),
    authoredClip('rage-motion', 1.8, rageTracks, {
      label: 'Rage', loop: false, inferred: true,
      measured: 'bilateral arm lift and spine oscillation with planted feet',
    }),
    authoredClip('snap-kick-motion', 2.2, danceTracks, {
      label: 'Snap Kick', loop: false, inferred: true,
      measured: 'left measured leg-chain extension with the opposite foot planted',
    }),
    authoredClip('guard-down', 2.4, guardTracks, {
      label: 'Guard Down', loop: false, inferred: true,
      measured: 'bilateral arm fold and head dip with planted feet',
    }),
  ];
};

const createController = (
  root: THREE.Group,
  clips: readonly AuthoredAnimationClip[],
): MarsCatAnimationController => {
  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map(clips.map((clip) => [clip.name, mixer.clipAction(clip)]));
  for (const [name, action] of actions) {
    const loop = clips.find((clip) => clip.name === name)?.userData.loop !== false;
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
  }
  const idleId = 'small-periodic-spine-tail-cycle';
  const actionOrder = new Map([
    'three-hit-combination', 'lead-punch', 'hook-motion', 'front-kick-motion',
    'fireball-kick-motion', 'snap-kick-motion', 'knockout-reaction', 'dash-punch-motion',
    'rage-motion', 'footwork-cycle', 'charge-cycle', 'guard-down',
  ].map((id, index) => [id, index]));
  let active = idleId;
  actions.get(idleId)!.play();
  const listeners = new Set<(id: string) => void>();
  const transition = (id: string) => {
    const next = actions.get(id);
    if (!next) return;
    const loop = clips.find((clip) => clip.name === id)?.userData.loop !== false;
    mixer.stopAllAction();
    next.reset().setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1).play();
    next.clampWhenFinished = !loop;
    mixer.update(0);
    active = id;
    listeners.forEach((listener) => listener(active));
  };
  return {
    actions: clips
      .filter((clip) => clip.name !== idleId)
      .sort((a, b) => (actionOrder.get(a.name) ?? 99) - (actionOrder.get(b.name) ?? 99))
      .map((clip) => ({
        id: clip.name,
        label: String(clip.userData.label ?? clip.name),
        loop: clip.userData.loop !== false,
      })),
    get active() { return active; },
    play: transition,
    seek: (id, timeSeconds) => {
      const next = actions.get(id);
      if (!next) throw new Error(`Mars Cat animation clip ${id} is absent`);
      const loop = clips.find((clip) => clip.name === id)?.userData.loop !== false;
      mixer.stopAllAction();
      next.reset().setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1).play();
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
