import * as THREE from "three";
import { offsetAlongNormal } from "./projection/index.js";
export function createSurfaceCoordinateResolver(ir, meshes) {
    return {
        resolve(coordinate, fallback = new THREE.Vector3()) {
            const mesh = meshes.get(coordinate.region) ?? meshes.get("body");
            if (!mesh)
                return fallback.clone();
            const box = new THREE.Box3().setFromObject(mesh);
            const point = new THREE.Vector3(box.min.x + (box.max.x - box.min.x) * coordinate.u, box.min.y + (box.max.y - box.min.y) * coordinate.v, box.min.z + (box.max.z - box.min.z) * 0.5);
            return offsetAlongNormal(point, new THREE.Vector3(0, 0, 1), coordinate.normalOffset);
        },
    };
}
export function registerCoordinate(ir, id, coordinate) {
    ir.surfaceGraph.coordinates[id] = coordinate;
}
//# sourceMappingURL=surface-coordinates.js.map