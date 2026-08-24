import * as THREE from "three";
import type { RigGraph, Vec3 } from "../../ir/character-ir.js";
export interface SkeletonBuildResult {
    root: THREE.Bone;
    bones: Map<string, THREE.Bone>;
    skeleton: THREE.Skeleton;
    restWorldPositions: Map<string, THREE.Vector3>;
}
export declare function buildSkeleton(graph: RigGraph): SkeletonBuildResult;
export declare function resetSkeleton(result: SkeletonBuildResult): void;
export declare function jointWorldPosition(result: SkeletonBuildResult, id: string): THREE.Vector3;
export declare function validateRigGraph(graph: RigGraph): string[];
export declare function asVector(position: Vec3): THREE.Vector3;
