import * as THREE from "three";
export function buildInstancedDetails(geometry, material, transforms) {
    const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
    const matrix = new THREE.Matrix4();
    transforms.forEach((transform, index) => { matrix.compose(transform.position, transform.quaternion ?? new THREE.Quaternion(), transform.scale ?? new THREE.Vector3(1, 1, 1)); mesh.setMatrixAt(index, matrix); });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.name = "InstancedCharacterDetails";
    mesh.userData.characterSubsystem = "CharacterOptimization";
    return mesh;
}
//# sourceMappingURL=instancing.js.map