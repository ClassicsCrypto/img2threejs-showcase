import * as THREE from "three";
export function color(value) {
    return new THREE.Color().setRGB(value[0], value[1], value[2], THREE.SRGBColorSpace);
}
export function compileMaterial(definition, backend = "webgl") {
    const material = new THREE.MeshPhysicalMaterial({
        name: definition.id,
        color: color(definition.baseColor),
        roughness: definition.roughness,
        metalness: definition.metalness,
        transmission: definition.transmission ?? 0,
        thickness: definition.thickness ?? 0,
        clearcoat: definition.clearcoat ?? 0,
        sheen: definition.sheen ?? 0,
        anisotropy: definition.anisotropy ?? 0,
        iridescence: definition.iridescence ?? 0,
        emissive: definition.emissive ? color(definition.emissive) : new THREE.Color(0, 0, 0),
        flatShading: definition.flatShading ?? false,
    });
    material.userData.characterMaterial = { semanticType: definition.semanticType, backend: definition.backend ?? "physical", rendererBackend: backend };
    if (definition.backend === "sss-node" && backend === "webgl")
        material.userData.sssFallback = "physical";
    if (definition.backend === "custom-tsl" && backend === "webgl")
        material.userData.tslFallback = "physical";
    return material;
}
export function compileMaterials(graph, backend = "webgl") {
    return new Map(graph.materials.map((definition) => [definition.id, compileMaterial(definition, backend)]));
}
export function validateMaterialChannels(definition) {
    const errors = [];
    if (definition.roughness < 0 || definition.roughness > 1)
        errors.push(`${definition.id}: roughness outside [0,1]`);
    if (definition.metalness < 0 || definition.metalness > 1)
        errors.push(`${definition.id}: metalness outside [0,1]`);
    if (definition.transmission !== undefined && (definition.transmission < 0 || definition.transmission > 1))
        errors.push(`${definition.id}: transmission outside [0,1]`);
    return errors;
}
//# sourceMappingURL=index.js.map