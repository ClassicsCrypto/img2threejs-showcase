import * as THREE from "three";
export interface SurfaceProjection {
    point: THREE.Vector3;
    normal: THREE.Vector3;
    uv?: THREE.Vector2;
    faceIndex?: number;
    distance: number;
}
export declare function projectOntoSurface(origin: THREE.Vector3, direction: THREE.Vector3, object: THREE.Object3D): SurfaceProjection | undefined;
export declare function offsetAlongNormal(point: THREE.Vector3, normal: THREE.Vector3, distance: number): THREE.Vector3;
