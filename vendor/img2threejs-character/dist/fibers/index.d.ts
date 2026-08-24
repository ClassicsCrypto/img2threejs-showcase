import * as THREE from "three";
import type { CharacterIR, Vec3 } from "../ir/character-ir.js";
export interface FiberBuildResult {
    group: THREE.Group;
    rootCount: number;
    guideCount: number;
    clumpCount: number;
    rootAttachmentErrors: string[];
    anisotropicMaterials: number;
    intersections: number;
}
export declare function sampleEmitterSurface(mesh: THREE.Mesh, count: number, seed?: number): Vec3[];
export declare function compileFibers(ir: CharacterIR, materials: Map<string, THREE.MeshPhysicalMaterial>, bodyMeshes: Map<string, THREE.Object3D>): FiberBuildResult;
export * from "./flow/index.js";
export * from "./roots/index.js";
export * from "./guides/index.js";
export * from "./clumps/index.js";
export * from "./strands/index.js";
export * from "./fur/index.js";
export * from "./feathers/index.js";
