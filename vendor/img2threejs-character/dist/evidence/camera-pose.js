import * as THREE from "three";
/** A deterministic initial camera solve from landmark extents. A future
 * vision adapter can replace the estimates while preserving this contract. */
export function solveCameraPose(landmarks, aspect = 1) {
    const points = landmarks.map((landmark) => landmark.position);
    const minY = points.length ? Math.min(...points.map((point) => point[1])) : 0;
    const maxY = points.length ? Math.max(...points.map((point) => point[1])) : 1;
    const target = [0, (minY + maxY) / 2, 0];
    const height = Math.max(0.1, maxY - minY);
    const fovDegrees = 35;
    const distance = height / (2 * Math.tan((fovDegrees * Math.PI) / 360));
    const position = [0, target[1], distance];
    return { camera: { projection: "perspective", fovDegrees, aspect, position, target, confidence: points.length >= 2 ? 0.65 : 0.2 }, position, target, fovDegrees, residual: points.length ? 0 : 1 };
}
export function applyCameraEvidence(irCamera, camera) {
    if (camera instanceof THREE.PerspectiveCamera) {
        if (irCamera.fovDegrees !== undefined)
            camera.fov = irCamera.fovDegrees;
        if (irCamera.aspect !== undefined)
            camera.aspect = irCamera.aspect;
    }
    else if (irCamera.orthographicHalfHeight !== undefined) {
        const aspect = irCamera.aspect ?? ((camera.right - camera.left) / Math.max(1e-9, camera.top - camera.bottom));
        camera.top = irCamera.orthographicHalfHeight;
        camera.bottom = -irCamera.orthographicHalfHeight;
        camera.left = -irCamera.orthographicHalfHeight * aspect;
        camera.right = irCamera.orthographicHalfHeight * aspect;
    }
    if (irCamera.position)
        camera.position.set(...irCamera.position);
    camera.updateProjectionMatrix();
    if (irCamera.target)
        camera.lookAt(new THREE.Vector3(...irCamera.target));
}
//# sourceMappingURL=camera-pose.js.map