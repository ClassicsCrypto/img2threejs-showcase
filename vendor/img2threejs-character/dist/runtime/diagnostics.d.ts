import * as THREE from "three";
export interface CharacterProbe {
    object: THREE.Object3D;
    point: THREE.Vector3;
    normal?: THREE.Vector3;
    uv?: THREE.Vector2;
    distance: number;
}
export declare function probeCharacterSurface(root: THREE.Object3D, origin: THREE.Vector3, direction: THREE.Vector3): CharacterProbe | undefined;
