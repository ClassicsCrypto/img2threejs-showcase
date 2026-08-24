import * as THREE from "three";
import { compileMaterial } from "./index.js";
/** Optional hero backend. Dynamic import keeps WebGL builds free of the WebGPU
 * renderer until the caller explicitly requests it. */
export async function compileHeroMaterial(definition, useSss = false) {
    try {
        const webgpu = await import("three/webgpu");
        const MaterialClass = useSss ? webgpu.MeshSSSNodeMaterial : webgpu.MeshPhysicalNodeMaterial;
        const material = new MaterialClass({ color: new THREE.Color(...definition.baseColor), roughness: definition.roughness, metalness: definition.metalness });
        material.name = definition.id;
        material.userData.characterMaterial = { semanticType: definition.semanticType, backend: useSss ? "sss-node" : "custom-tsl" };
        return { material, backend: useSss ? "node-sss" : "node-physical" };
    }
    catch (error) {
        return { material: compileMaterial(definition, "webgl"), backend: "physical", fallbackReason: error instanceof Error ? error.message : "WebGPU node material backend unavailable" };
    }
}
//# sourceMappingURL=hero.js.map