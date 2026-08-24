import * as THREE from "three";
import type { MaterialDefinition } from "../ir/character-ir.js";
export interface HeroMaterialResult {
    material: THREE.Material;
    backend: "physical" | "node-physical" | "node-sss";
    fallbackReason?: string;
}
/** Optional hero backend. Dynamic import keeps WebGL builds free of the WebGPU
 * renderer until the caller explicitly requests it. */
export declare function compileHeroMaterial(definition: MaterialDefinition, useSss?: boolean): Promise<HeroMaterialResult>;
