import * as THREE from "three";
import { compileSemanticCurve } from "../../geometry/curves/index.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
export function buildFiberGeometry(definition, guide) {
    const curve = compileSemanticCurve({ id: guide.id, role: "fiber-guide", points: guide.points });
    const radius = Math.max(0.0008, (definition.radius ?? 0.004) * (1 - Math.min(0.85, guide.taper)));
    if (definition.representation === "ribbon" || definition.representation === "card")
        return buildRibbon(guide, radius);
    if (definition.representation === "shell")
        return buildClumpMass(guide, definition.radius ?? radius);
    if (definition.representation === "lock")
        return buildClosedLock(guide, definition.radius ?? radius);
    const radialSegments = 5;
    return new THREE.TubeGeometry(curve, Math.max(4, guide.points.length * 4), radius, radialSegments, false);
}
function buildClumpMass(guide, radius) {
    const start = new THREE.Vector3(...guide.points[0]);
    const end = new THREE.Vector3(...guide.points[guide.points.length - 1]);
    const direction = end.clone().sub(start);
    const length = Math.max(0.001, direction.length());
    const geometry = new THREE.DodecahedronGeometry(1, 0);
    geometry.scale(radius * 1.35, Math.max(radius * 1.05, length * 0.72), radius * 1.15);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    geometry.translate(...start.clone().lerp(end, 0.5).toArray());
    geometry.computeVertexNormals();
    return geometry;
}
function buildClosedLock(guide, radius) {
    const segments = [];
    for (let index = 1; index < guide.points.length; index += 1) {
        const start = new THREE.Vector3(...guide.points[index - 1]);
        const end = new THREE.Vector3(...guide.points[index]);
        const direction = end.clone().sub(start);
        const length = direction.length();
        const startT = (index - 1) / Math.max(1, guide.points.length - 1);
        const endT = index / Math.max(1, guide.points.length - 1);
        const startRadius = radius * THREE.MathUtils.lerp(1, 1 - guide.taper, startT);
        const endRadius = radius * THREE.MathUtils.lerp(1, 1 - guide.taper, endT);
        const geometry = new THREE.CylinderGeometry(endRadius, startRadius, length, 6, 1, false);
        geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
        geometry.translate(...start.clone().lerp(end, 0.5).toArray());
        segments.push(geometry);
    }
    const merged = mergeGeometries(segments, false);
    if (!merged)
        throw new Error(`could not compile closed fiber lock ${guide.id}`);
    merged.computeVertexNormals();
    return merged;
}
function buildRibbon(guide, halfWidth) {
    const points = guide.points;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let index = 0; index < points.length; index += 1) {
        const point = new THREE.Vector3(...points[index]);
        const previous = new THREE.Vector3(...points[Math.max(0, index - 1)]);
        const next = new THREE.Vector3(...points[Math.min(points.length - 1, index + 1)]);
        const tangent = next.sub(previous).normalize();
        const side = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0));
        if (side.lengthSq() < 1e-8)
            side.set(1, 0, 0);
        side.normalize().multiplyScalar(halfWidth * (1 - index / Math.max(1, points.length) * 0.5));
        positions.push(point.x - side.x, point.y - side.y, point.z - side.z, point.x + side.x, point.y + side.y, point.z + side.z);
        uvs.push(0, index / Math.max(1, points.length - 1), 1, index / Math.max(1, points.length - 1));
        if (index > 0) {
            const row = (index - 1) * 2;
            const current = index * 2;
            indices.push(row, row + 1, current, row + 1, current + 1, current);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}
//# sourceMappingURL=index.js.map