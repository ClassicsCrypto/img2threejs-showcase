import * as THREE from "three";
import { validateJointZones } from "./joint-loops/index.js";
export function validateBufferGeometry(geometry, topology) {
    const errors = [];
    const warnings = [];
    const position = geometry.getAttribute("position");
    const index = geometry.getIndex();
    if (!position || position.itemSize !== 3)
        errors.push("position attribute is missing or not vec3");
    let finite = true;
    if (position)
        for (let i = 0; i < position.array.length; i += 1)
            if (!Number.isFinite(position.array[i]))
                finite = false;
    if (!finite)
        errors.push("position contains non-finite values");
    let degenerateTriangles = 0;
    const edgeCounts = new Map();
    if (index && position) {
        for (let i = 0; i < index.count; i += 3) {
            const a = index.getX(i);
            const b = index.getX(i + 1);
            const c = index.getX(i + 2);
            if (a >= position.count || b >= position.count || c >= position.count)
                errors.push(`index ${i} references a vertex outside position count`);
            if (a === b || b === c || c === a)
                degenerateTriangles += 1;
            for (const [from, to] of [[a, b], [b, c], [c, a]]) {
                const key = from < to ? `${from}:${to}` : `${to}:${from}`;
                edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
            }
        }
    }
    if (degenerateTriangles)
        warnings.push(`${degenerateTriangles} degenerate triangles`);
    if (topology) {
        errors.push(...validateJointZones(topology.jointZones));
        for (const loft of topology.seams)
            if (!loft.intentional && loft.regionA && loft.regionB)
                errors.push(`unintentional seam: ${loft.regionA} -> ${loft.regionB}`);
    }
    const boundaryEdges = [...edgeCounts.values()].filter((count) => count === 1).length;
    const nonManifoldEdges = [...edgeCounts.values()].filter((count) => count > 2).length;
    if (nonManifoldEdges)
        errors.push(`${nonManifoldEdges} non-manifold edges`);
    return { errors, warnings, vertexCount: position?.count ?? 0, triangleCount: index ? index.count / 3 : 0, degenerateTriangles, finite, boundaryEdges, nonManifoldEdges };
}
export function addSemanticRegionAttribute(geometry, regionId) {
    const count = geometry.getAttribute("position")?.count ?? 0;
    geometry.setAttribute("semanticRegion", new THREE.Uint16BufferAttribute(new Uint16Array(count).fill(regionId), 1));
}
export function addDeformationMaskAttribute(geometry, value = 1) {
    const count = geometry.getAttribute("position")?.count ?? 0;
    geometry.setAttribute("deformationMask", new THREE.Float32BufferAttribute(new Float32Array(count).fill(value), 1));
}
export function topologySummary(geometry) {
    const result = validateBufferGeometry(geometry);
    return { vertexCount: result.vertexCount, triangleCount: result.triangleCount, degenerateTriangles: result.degenerateTriangles, boundaryEdges: result.boundaryEdges, nonManifoldEdges: result.nonManifoldEdges, hasIndex: geometry.index ? 1 : 0 };
}
//# sourceMappingURL=validator.js.map