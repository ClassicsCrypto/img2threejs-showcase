import { addDeformationMaskAttribute, addSemanticRegionAttribute } from "../topology/validator.js";
export function compileTopology(ir, geometry, region) {
    addSemanticRegionAttribute(geometry, Math.abs(hash(region)) % 65535);
    addDeformationMaskAttribute(geometry, 1);
    geometry.userData = { topology: ir.topologyGraph, semanticRegion: region };
    return geometry;
}
function hash(value) {
    let output = 2166136261;
    for (let index = 0; index < value.length; index += 1)
        output = Math.imul(output ^ value.charCodeAt(index), 16777619);
    return output >>> 0;
}
//# sourceMappingURL=topology-compiler.js.map