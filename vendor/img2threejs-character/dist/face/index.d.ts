import * as THREE from "three";
import type { CharacterIR } from "../ir/character-ir.js";
export interface EyeRuntime {
    left: THREE.Group;
    right: THREE.Group;
    setBlink(value: number): void;
    setPupil(value: number): void;
    lookAt(target: THREE.Vector3): void;
}
export declare function buildFace(ir: CharacterIR, materials: Map<string, THREE.MeshPhysicalMaterial>): {
    group: THREE.Group;
    eyes: EyeRuntime;
};
