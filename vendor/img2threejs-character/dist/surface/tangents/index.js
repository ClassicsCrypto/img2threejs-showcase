import * as THREE from "three";
import { ensureUv } from "../uv/index.js";
export function computeCharacterTangents(geometry, spec) {
    ensureUv(geometry);
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const uv = geometry.getAttribute("uv");
    if (!position || !normal || !uv)
        return { algorithm: "deterministic-fallback", valid: false, reason: "position, normal and UV are required" };
    try {
        geometry.computeTangents();
        const tangent = geometry.getAttribute("tangent");
        if (tangent && tangent.itemSize === 4)
            return { algorithm: spec.algorithm, valid: true };
    }
    catch {
        // Some procedural inputs do not have the triangle layout expected by the
        // convenience method.  Use a stable orthogonal tangent so the gate can
        // report the fallback instead of silently losing the attribute.
    }
    const values = new Float32Array(position.count * 4);
    for (let index = 0; index < position.count; index += 1) {
        const n = new THREE.Vector3().fromBufferAttribute(normal, index).normalize();
        const reference = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        const tangent = new THREE.Vector3().crossVectors(reference, n).normalize();
        values.set([tangent.x, tangent.y, tangent.z, 1], index * 4);
    }
    geometry.setAttribute("tangent", new THREE.Float32BufferAttribute(values, 4));
    return { algorithm: "deterministic-fallback", valid: true, reason: `${spec.algorithm} backend unavailable for this geometry; orthogonal fallback emitted` };
}
export function validateTangents(geometry) {
    const tangent = geometry.getAttribute("tangent");
    const errors = [];
    if (!tangent || tangent.itemSize !== 4)
        return ["tangent attribute is missing or not vec4"];
    for (let i = 0; i < tangent.array.length; i += 1)
        if (!Number.isFinite(tangent.array[i]))
            errors.push(`tangent contains non-finite value at ${i}`);
    return errors;
}
//# sourceMappingURL=index.js.map