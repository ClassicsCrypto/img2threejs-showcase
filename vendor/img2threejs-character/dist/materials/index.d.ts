import * as THREE from "three";
import type { AppearanceGraph, MaterialDefinition, Vec3 } from "../ir/character-ir.js";
export declare function color(value: Vec3): THREE.Color;
export declare function compileMaterial(definition: MaterialDefinition, backend?: "webgl" | "webgpu"): THREE.MeshPhysicalMaterial;
export declare function compileMaterials(graph: AppearanceGraph, backend?: "webgl" | "webgpu"): Map<string, THREE.MeshPhysicalMaterial>;
export declare function validateMaterialChannels(definition: MaterialDefinition): string[];
