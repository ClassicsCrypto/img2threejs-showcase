import * as THREE from "three";
export function probeCharacterSurface(root, origin, direction) {
    const hit = new THREE.Raycaster(origin, direction.normalize()).intersectObject(root, true)[0];
    if (!hit)
        return undefined;
    return { object: hit.object, point: hit.point.clone(), normal: hit.face?.normal?.clone(), uv: hit.uv?.clone(), distance: hit.distance };
}
//# sourceMappingURL=diagnostics.js.map