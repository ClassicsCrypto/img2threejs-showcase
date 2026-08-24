import * as THREE from "three";
export interface DecalRequest {
    mesh: THREE.Mesh;
    position: THREE.Vector3;
    orientation: THREE.Euler;
    size: THREE.Vector3;
}
export declare function projectDecal(request: DecalRequest): THREE.BufferGeometry;
