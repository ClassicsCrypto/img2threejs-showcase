import * as THREE from "three";
import { compileSemanticCurve } from "../../geometry/curves/index.js";
export function compileSurfaceCurve(feature, material, radius = 0.0015) {
    if (!feature.points || feature.points.length < 2)
        throw new Error(`surface curve ${feature.id} needs at least two points`);
    const curve = compileSemanticCurve({ id: feature.id, role: "surface-curve", points: feature.points });
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, radius, 5, false), material);
    mesh.name = feature.id;
    mesh.userData = { characterSubsystem: "SurfaceEngine", surfaceFeature: feature.id, explodeWithParent: true };
    return mesh;
}
//# sourceMappingURL=index.js.map