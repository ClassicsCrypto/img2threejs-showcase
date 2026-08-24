import * as THREE from "three";
import type { CharacterIR } from "../ir/character-ir.js";
export declare function compileSurface(ir: CharacterIR, geometry: THREE.BufferGeometry): {
    geometry: THREE.BufferGeometry;
    tangentBackend: string;
};
