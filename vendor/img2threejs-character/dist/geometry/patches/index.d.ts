import type { Vec3 } from "../../ir/character-ir.js";
export interface SurfacePatchSample {
    u: number;
    v: number;
    position: Vec3;
    normal: Vec3;
}
export declare function bilinearPatch(corners: [Vec3, Vec3, Vec3, Vec3], u: number, v: number): SurfacePatchSample;
