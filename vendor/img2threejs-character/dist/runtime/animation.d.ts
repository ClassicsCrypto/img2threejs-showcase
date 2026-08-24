import * as THREE from "three";
export type CharacterActionTrack = {
    target: string;
    property: "rotation";
    times: readonly number[];
    values: ReadonlyArray<readonly [number, number, number]>;
} | {
    target: string;
    property: "position";
    times: readonly number[];
    values: ReadonlyArray<readonly [number, number, number]>;
};
/** Renderer-agnostic action description compiled to Three.js clips at runtime. */
export interface CharacterActionSpec {
    id: string;
    label: string;
    duration: number;
    loop: boolean;
    expose?: boolean;
    returnToDefault?: boolean;
    /** Optional per-action entry blend. Zero is valid for collision-critical poses. */
    fadeSeconds?: number;
    tracks: readonly CharacterActionTrack[];
}
export interface CharacterAnimationController {
    actions: ReadonlyArray<{
        id: string;
        label: string;
        loop: boolean;
    }>;
    readonly active: string;
    play(name: string): void;
    stop(): void;
    update(deltaSeconds: number): void;
    subscribe(listener: (active: string) => void): () => void;
}
export interface CompiledCharacterActions {
    clips: ReadonlyMap<string, THREE.AnimationClip>;
    mixer: THREE.AnimationMixer;
    controller: CharacterAnimationController;
}
export declare class CharacterAnimationRuntime {
    readonly mixer: THREE.AnimationMixer;
    constructor(root: THREE.Object3D);
    play(clip: THREE.AnimationClip, fadeSeconds?: number): THREE.AnimationAction;
    update(deltaSeconds: number): void;
    stopAll(): void;
}
/**
 * Compile plain tuple tracks into an AnimationMixer-backed controller. The
 * default action is normally a subtle idle loop; one-shots can either return
 * to it or clamp on their final frame (for example a death pose).
 */
export declare function compileCharacterActions(root: THREE.Object3D, specs: readonly CharacterActionSpec[], defaultActionId?: string, fadeSeconds?: number): CompiledCharacterActions;
