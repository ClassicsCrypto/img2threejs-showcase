import * as THREE from "three";
export function coordinateToUv(coordinate) {
    return new THREE.Vector2(Math.min(1, Math.max(0, coordinate.u)), Math.min(1, Math.max(0, coordinate.v)));
}
export function validateSemanticCoordinates(graph) {
    const errors = [];
    for (const [id, coordinate] of Object.entries(graph.coordinates)) {
        if (coordinate.u < 0 || coordinate.u > 1 || coordinate.v < 0 || coordinate.v > 1)
            errors.push(`${id} has UV outside [0,1]`);
        if (!Number.isFinite(coordinate.normalOffset))
            errors.push(`${id} has non-finite normal offset`);
    }
    return errors;
}
export function ensureUv(geometry) {
    if (!geometry.getAttribute("uv")) {
        const count = geometry.getAttribute("position")?.count ?? 0;
        geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    }
}
//# sourceMappingURL=index.js.map