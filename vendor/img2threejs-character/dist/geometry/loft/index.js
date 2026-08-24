import * as THREE from "three";
import { validateCrossSections } from "../cross-section/index.js";
/**
 * A deterministic semantic loft backend.  CharacterIR owns sections; this
 * adapter owns only BufferGeometry construction and never leaks Three.js types
 * back into the IR.
 */
export function buildAnatomicalLoft(loft, capEnds = true) {
    const errors = validateCrossSections(loft.sections);
    if (errors.length)
        return { geometry: new THREE.BufferGeometry(), vertexCount: 0, triangleCount: 0, sectionCount: loft.sections.length, errors };
    const sections = loft.sections;
    const contourCount = sections[0].contour.length;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (const section of sections) {
        const orientation = new THREE.Quaternion(...section.orientation);
        for (const [x, z] of section.contour) {
            const asymmetryX = section.asymmetry?.lateralBias ?? 0;
            const asymmetryZ = section.asymmetry?.depthBias ?? 0;
            const local = new THREE.Vector3((x + asymmetryX) * section.width, 0, (z + asymmetryZ) * section.depth).applyQuaternion(orientation);
            positions.push(section.center[0] + local.x, section.center[1] + local.y, section.center[2] + local.z);
            uvs.push((x + 1) * 0.5, section.t);
        }
    }
    for (let row = 0; row < sections.length - 1; row += 1) {
        for (let col = 0; col < contourCount; col += 1) {
            const next = (col + 1) % contourCount;
            const a = row * contourCount + col;
            const b = row * contourCount + next;
            const c = (row + 1) * contourCount + next;
            const d = (row + 1) * contourCount + col;
            indices.push(a, b, d, b, c, d);
        }
    }
    if (capEnds) {
        const startCenter = positions.length / 3;
        positions.push(...sections[0].center);
        uvs.push(0.5, sections[0].t);
        const endCenter = positions.length / 3;
        positions.push(...sections[sections.length - 1].center);
        uvs.push(0.5, sections[sections.length - 1].t);
        for (let col = 0; col < contourCount; col += 1) {
            const next = (col + 1) % contourCount;
            indices.push(startCenter, next, col);
            const end = (sections.length - 1) * contourCount;
            indices.push(endCenter, end + col, end + next);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return { geometry, vertexCount: positions.length / 3, triangleCount: indices.length / 3, sectionCount: sections.length, errors: [] };
}
export function buildLoftWithAttributes(loft) {
    const result = buildAnatomicalLoft(loft);
    if (result.errors.length)
        throw new Error(`${loft.id}: ${result.errors.join("; ")}`);
    return result.geometry;
}
export function sectionAt(geometry, index) {
    const position = geometry.getAttribute("position");
    const result = [];
    for (let i = 0; i < position.count; i += 1) {
        if (i % index === 0)
            result.push(new THREE.Vector3().fromBufferAttribute(position, i));
    }
    return result;
}
export function sectionNormal(section) {
    return new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(...section.orientation));
}
//# sourceMappingURL=index.js.map