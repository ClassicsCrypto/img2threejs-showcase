import * as THREE from "three";
import type { CharacterIR } from "../ir/character-ir.js";
import { type EyeRuntime } from "../face/index.js";
import { type SkeletonBuildResult } from "../rig/skeleton/index.js";
import { type FiberBuildResult } from "../fibers/index.js";
import { type WearableBuildResult } from "../wearables/index.js";
import { CharacterRuntime, type CharacterMeshRegistry } from "../runtime/character-runtime.js";
import { type SurfaceFeatureBuildResult } from "../surface/features.js";
import { type AccessoryBuildResult } from "../accessories/index.js";
export interface CharacterCompileOptions {
    backend?: "webgl" | "webgpu";
    addHelpers?: boolean;
}
export interface CompileDiagnostics {
    errors: string[];
    warnings: string[];
    lofts: Array<{
        id: string;
        vertices: number;
        triangles: number;
    }>;
    tangentBackends: string[];
    rigErrors: string[];
}
export interface CompiledCharacter {
    ir: CharacterIR;
    root: THREE.Group;
    runtime: CharacterRuntime;
    skeleton: SkeletonBuildResult;
    bodyMeshes: Map<string, THREE.SkinnedMesh>;
    meshes: CharacterMeshRegistry;
    materials: Map<string, THREE.MeshPhysicalMaterial>;
    eyes?: EyeRuntime;
    fibers: FiberBuildResult;
    surfaceFeatures: SurfaceFeatureBuildResult;
    wearables: WearableBuildResult;
    accessories: AccessoryBuildResult;
    diagnostics: CompileDiagnostics;
}
export declare function compileCharacter(ir: CharacterIR, options?: CharacterCompileOptions): CompiledCharacter;
export declare function compileCharacterHero(ir: CharacterIR, options?: CharacterCompileOptions): Promise<CompiledCharacter>;
