import * as THREE from "three";
import type { MorphDefinition } from "../../ir/character-ir.js";
export declare function attachMorphTargets(geometry: THREE.BufferGeometry, definitions: MorphDefinition[]): void;
export declare function validateMorphTargets(geometry: THREE.BufferGeometry): string[];
