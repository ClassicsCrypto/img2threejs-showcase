import * as THREE from "three";
import type { CharacterIR } from "../ir/character-ir.js";
export interface WearableBuildResult {
    group: THREE.Group;
    items: Map<string, THREE.Object3D>;
    penetration: number;
}
export declare function compileWearables(ir: CharacterIR, materials: Map<string, THREE.MeshPhysicalMaterial>, bodyMeshes?: Map<string, THREE.SkinnedMesh>, accessories?: Map<string, THREE.Object3D>): WearableBuildResult;
