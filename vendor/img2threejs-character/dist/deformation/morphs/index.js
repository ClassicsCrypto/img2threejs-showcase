import * as THREE from "three";
export function attachMorphTargets(geometry, definitions) {
    const position = geometry.getAttribute("position");
    if (!position || definitions.length === 0)
        return;
    geometry.morphTargetsRelative = true;
    geometry.morphAttributes.position = definitions.map((definition) => {
        const values = new Float32Array(position.count * 3);
        if (definition.deltas && definition.deltas.length === position.count)
            definition.deltas.forEach((delta, index) => values.set(delta, index * 3));
        const attribute = new THREE.Float32BufferAttribute(values, 3);
        attribute.name = definition.id;
        return attribute;
    });
}
export function validateMorphTargets(geometry) {
    const position = geometry.getAttribute("position");
    const morphs = geometry.morphAttributes.position ?? [];
    const errors = [];
    if (!position && morphs.length)
        errors.push("morph targets exist without position attribute");
    for (const morph of morphs)
        if (position && morph.count !== position.count)
            errors.push(`morph ${morph.name} has ${morph.count} vertices; expected ${position.count}`);
    return errors;
}
//# sourceMappingURL=index.js.map