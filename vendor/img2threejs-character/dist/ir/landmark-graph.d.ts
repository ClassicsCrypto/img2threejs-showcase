export type { FacialLandmark } from "./character-ir.js";
import type { CharacterIR, FacialLandmark, ProportionKey, Vec3 } from "./character-ir.js";
export declare function canonicalProportionKey(value: string): ProportionKey | undefined;
export declare function setLandmark(ir: CharacterIR, landmark: FacialLandmark, semanticRole?: string): void;
export declare function getLandmark(ir: CharacterIR, idOrRole: string): Vec3 | undefined;
export declare function solveProportions(ir: CharacterIR): void;
