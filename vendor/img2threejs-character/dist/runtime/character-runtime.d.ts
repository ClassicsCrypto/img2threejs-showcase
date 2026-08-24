import * as THREE from "three";
import type { CharacterIR } from "../ir/character-ir.js";
import type { EyeRuntime } from "../face/index.js";
import type { CharacterIKController } from "../rig/ik/index.js";
import type { SkeletonBuildResult } from "../rig/skeleton/index.js";
import { CharacterAnimationRuntime } from "./animation.js";
export interface CharacterMeshRegistry extends Map<string, THREE.Object3D> {
}
export declare class CharacterRuntime {
    readonly root: THREE.Group;
    readonly meshes: CharacterMeshRegistry;
    private readonly skeletonBuild;
    private readonly eyeRuntime?;
    private readonly ikController?;
    private readonly ir?;
    readonly joints: Map<string, THREE.Bone>;
    readonly morphs: Map<string, number>;
    readonly materials: Map<string, THREE.Material>;
    readonly animation: CharacterAnimationRuntime;
    readonly pose: {
        reset(): void;
        applyProfile(name: string): void;
        setJoint(joint: string, rotation: THREE.Quaternion): void;
        getJoint(joint: string): THREE.Quaternion;
    };
    readonly morph: {
        set(name: string, weight: number): void;
    };
    readonly ik: {
        setTarget(name: string, target: THREE.Vector3): void;
        solve(): void;
    };
    readonly gaze?: {
        lookAt(target: THREE.Vector3): void;
    };
    readonly appearance: {
        setVariant(name: string): void;
    };
    private variant;
    constructor(root: THREE.Group, meshes: CharacterMeshRegistry, skeletonBuild: SkeletonBuildResult, materials: Map<string, THREE.Material>, eyeRuntime?: EyeRuntime | undefined, ikController?: CharacterIKController | undefined, ir?: CharacterIR | undefined);
    update(dt: number): void;
    dispose(): void;
    private setMorph;
    private applyMorphDrivers;
    private setVariant;
    get activeVariant(): string;
}
