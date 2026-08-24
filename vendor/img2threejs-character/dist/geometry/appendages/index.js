import * as THREE from "three";
import { compileSemanticCurve } from "../curves/index.js";
export function buildTubeAppendage(spec, radius = 0.025, tubularSegments = 16) {
    if (!spec.path)
        throw new Error(`appendage ${spec.id} needs a path for tube geometry`);
    return new THREE.TubeGeometry(compileSemanticCurve(spec.path), tubularSegments, radius, 8, false);
}
export function buildAppendageGeometry(spec) {
    if (spec.geometryMode === "tube")
        return buildTubeAppendage(spec);
    if (spec.geometryMode === "curve-sweep")
        return buildTubeAppendage(spec, 0.018, 20);
    if (spec.geometryMode === "sdf")
        return buildTubeAppendage(spec, 0.03, 24);
    return buildWingOrFin(spec);
}
export function buildWingOrFin(spec) {
    const points = spec.path?.points ?? [];
    if (points.length < 2)
        throw new Error(`appendage ${spec.id} needs path points`);
    const positions = [];
    const indices = [];
    for (const [x, y, z] of points)
        positions.push(x, y, z);
    for (const [x, y, z] of points)
        positions.push(x, y, z - 0.015);
    for (let i = 1; i < points.length - 1; i += 1) {
        indices.push(0, i, i + 1);
        const back = points.length;
        indices.push(back, back + i + 1, back + i);
    }
    for (let i = 0; i < points.length; i += 1) {
        const next = (i + 1) % points.length;
        indices.push(i, next, points.length + i, next, points.length + next, points.length + i);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}
//# sourceMappingURL=index.js.map