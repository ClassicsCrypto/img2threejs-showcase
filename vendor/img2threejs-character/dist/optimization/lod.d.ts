import * as THREE from "three";
export interface LodLevelSpec {
    distance: number;
    object: THREE.Object3D;
}
export declare function buildCharacterLOD(levels: LodLevelSpec[]): THREE.LOD;
export declare function cloneLodLevel(source: THREE.Object3D, scale: number): THREE.Object3D;
