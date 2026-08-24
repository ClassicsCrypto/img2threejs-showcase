import { computeCharacterTangents } from "../surface/tangents/index.js";
export function compileSurface(ir, geometry) {
    const tangent = computeCharacterTangents(geometry, ir.surfaceGraph.tangentSpace);
    return { geometry, tangentBackend: tangent.algorithm };
}
//# sourceMappingURL=surface-compiler.js.map