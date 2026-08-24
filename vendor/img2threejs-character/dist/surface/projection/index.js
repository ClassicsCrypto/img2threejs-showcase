import * as THREE from "three";
export function projectOntoSurface(origin, direction, object) {
    const raycaster = new THREE.Raycaster(origin, direction.clone().normalize());
    const hit = raycaster.intersectObject(object, true)[0];
    if (!hit)
        return undefined;
    const normal = hit.face?.normal?.clone() ?? new THREE.Vector3(0, 1, 0);
    return { point: hit.point.clone(), normal, uv: hit.uv?.clone(), faceIndex: hit.faceIndex ?? undefined, distance: hit.distance };
}
export function offsetAlongNormal(point, normal, distance) {
    return point.clone().addScaledVector(normal.clone().normalize(), distance);
}
//# sourceMappingURL=index.js.map