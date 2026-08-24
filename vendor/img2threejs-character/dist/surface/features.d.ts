import * as THREE from "three";
import type { CharacterIR, SemanticSurfaceCoordinate } from "../ir/character-ir.js";
export interface SurfaceFeatureBuildResult {
    group: THREE.Group;
    featureCount: number;
    attachedCount: number;
    unboundIds: string[];
}
/**
 * Compiles semantic surface features into runtime objects. The marker backend
 * is intentionally small: it gives masks, decals and relief features a
 * stable semantic attachment point while leaving texture/decal authoring to
 * a later asset backend.
 */
export declare function compileSurfaceFeatures(ir: CharacterIR, bodyMeshes: Map<string, THREE.SkinnedMesh>, materials: Map<string, THREE.MeshPhysicalMaterial>, accessories?: Map<string, THREE.Object3D>): SurfaceFeatureBuildResult;
export declare function validateSurfaceCoordinate(coordinate: SemanticSurfaceCoordinate): string[];
