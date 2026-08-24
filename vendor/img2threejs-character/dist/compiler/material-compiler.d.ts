import type { AppearanceGraph } from "../ir/character-ir.js";
export declare function compileAppearance(graph: AppearanceGraph, backend?: "webgl" | "webgpu"): Map<string, import("three").MeshPhysicalMaterial>;
