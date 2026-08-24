import type { ContinuityConstraint } from "../../ir/character-ir.js";
export declare function validateContinuity(constraints: ContinuityConstraint[]): string[];
export declare function continuityPairs(regions: string[]): ContinuityConstraint[];
