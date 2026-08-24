import type { CharacterIR, ProportionKey } from "./character-ir.js";
/** Resolve evidence into a compiler-ready clone without mutating authored IR. */
export declare function resolveCharacterIR(source: CharacterIR): CharacterIR;
export declare function proportionValue(ir: CharacterIR, key: ProportionKey): number;
