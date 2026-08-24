import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { buildAnatomicalLoft } from "../loft/index.js";
export function addHandDigits(base, hand) {
    const geometries = [base, ...hand.digits.map((digit) => {
            const sections = digit.points.map((center, index) => {
                const orientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), directionAt(digit.points, index));
                const t = digit.points.length === 1 ? 0 : index / (digit.points.length - 1);
                const radius = THREE.MathUtils.lerp(digit.radiusStart, digit.radiusEnd, t);
                const contour = Array.from({ length: digit.sides }, (_, side) => {
                    const angle = side / digit.sides * Math.PI * 2;
                    return [Math.cos(angle), Math.sin(angle)];
                });
                return { t, center, orientation: orientation.toArray(), contour, width: radius, depth: radius * 0.82, landmarks: [], anatomicalInfluences: [{ source: digit.jointId, strength: 1 }], deformationZone: digit.jointId };
            });
            const loft = {
                id: digit.id,
                region: digit.jointId,
                axis: { id: `${digit.id}-axis`, role: "digit-axis", points: digit.points },
                sections,
                continuityConstraints: [],
                topologyIntent: "deformable-organic",
            };
            return buildAnatomicalLoft(loft).geometry;
        })];
    const merged = mergeGeometries(geometries, false);
    if (!merged)
        throw new Error(`could not merge digit geometry for ${hand.id}`);
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
}
function directionAt(points, index) {
    const previous = new THREE.Vector3(...points[Math.max(0, index - 1)]);
    const next = new THREE.Vector3(...points[Math.min(points.length - 1, index + 1)]);
    return next.sub(previous).normalize();
}
//# sourceMappingURL=index.js.map