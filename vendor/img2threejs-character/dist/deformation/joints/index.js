import * as THREE from "three";
export function jointAngle(a, b) {
    return a.quaternion.angleTo(b.quaternion);
}
export function preserveVolume(scale, amount) {
    const factor = Math.pow(Math.max(0.001, scale.x * scale.y * scale.z), (1 - amount) / 3);
    return new THREE.Vector3(scale.x * factor, scale.y * factor, scale.z * factor);
}
//# sourceMappingURL=index.js.map