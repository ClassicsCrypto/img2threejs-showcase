import * as THREE from "three";
export function distributeTwist(system, source, targets) {
    const axis = new THREE.Vector3(0, 1, 0);
    const euler = new THREE.Euler().setFromQuaternion(source, "XYZ");
    system.targetJoints.forEach((id, index) => {
        const bone = targets.get(id);
        if (!bone)
            return;
        const weight = system.distribution[index] ?? 0;
        bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, euler.y * weight));
    });
}
//# sourceMappingURL=index.js.map