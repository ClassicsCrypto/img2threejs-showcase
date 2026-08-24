import * as THREE from "three";
export interface CharacterExportOptions {
    binary?: boolean;
    onlyVisible?: boolean;
    trs?: boolean;
    animations?: THREE.AnimationClip[];
}
export declare function exportCharacter(root: THREE.Object3D, options?: CharacterExportOptions): Promise<ArrayBuffer | Record<string, unknown>>;
