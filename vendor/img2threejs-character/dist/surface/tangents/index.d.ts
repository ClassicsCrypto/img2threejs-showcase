import * as THREE from "three";
import type { TangentSpaceSpec } from "../../ir/character-ir.js";
export interface TangentBuildResult {
    algorithm: TangentSpaceSpec["algorithm"] | "deterministic-fallback";
    valid: boolean;
    reason?: string;
}
export declare function computeCharacterTangents(geometry: THREE.BufferGeometry, spec: TangentSpaceSpec): TangentBuildResult;
export declare function validateTangents(geometry: THREE.BufferGeometry): string[];
