import * as THREE from "three";
import type { RigJoint } from "../../ir/character-ir.js";
import type { SkeletonBuildResult } from "../skeleton/index.js";
export interface WeightBuildResult {
    indices: THREE.Uint16BufferAttribute;
    weights: THREE.Float32BufferAttribute;
    maxWeightError: number;
}
export interface CompactWeightBuildResult {
    indices: THREE.Uint8BufferAttribute;
    weights: THREE.Uint8BufferAttribute;
}
/**
 * Bind each vertex to one semantic joint using compact normalized bytes. This
 * is intended for reconstructed multipart surfaces where smoothing across an
 * unknown source seam would be less truthful than a rigid semantic region.
 */
export declare function buildRigidSemanticWeights(geometry: THREE.BufferGeometry, skeleton: SkeletonBuildResult, resolveJoint: (x: number, y: number, z: number, vertex: number) => string): CompactWeightBuildResult;
export declare function buildSemanticWeights(geometry: THREE.BufferGeometry, skeleton: SkeletonBuildResult, joints: RigJoint[], maxInfluences?: number): WeightBuildResult;
export declare function validateWeights(geometry: THREE.BufferGeometry, tolerance?: number): string[];
