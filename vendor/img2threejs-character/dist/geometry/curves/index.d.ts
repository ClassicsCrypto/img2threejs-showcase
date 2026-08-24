import * as THREE from "three";
import type { SemanticCurve, Vec3 } from "../../ir/character-ir.js";
export declare function compileSemanticCurve(curve: SemanticCurve): THREE.CatmullRomCurve3;
export declare function sampleSemanticCurve(curve: SemanticCurve, divisions?: number): Vec3[];
export declare function tangentAt(curve: SemanticCurve, t: number): Vec3;
