import * as THREE from "three";
export interface InstanceTransform {
    position: THREE.Vector3;
    quaternion?: THREE.Quaternion;
    scale?: THREE.Vector3;
}
export declare function buildInstancedDetails(geometry: THREE.BufferGeometry, material: THREE.Material, transforms: InstanceTransform[]): THREE.InstancedMesh;
