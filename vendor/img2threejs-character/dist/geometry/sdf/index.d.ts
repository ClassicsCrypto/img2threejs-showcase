import type { Vec3 } from "../../ir/character-ir.js";
export interface ImplicitField {
    sample(point: Vec3): number;
}
export declare function unionFields(...fields: ImplicitField[]): ImplicitField;
export declare function sphereField(center: Vec3, radius: number): ImplicitField;
export declare function smoothUnion(a: ImplicitField, b: ImplicitField, k: number): ImplicitField;
