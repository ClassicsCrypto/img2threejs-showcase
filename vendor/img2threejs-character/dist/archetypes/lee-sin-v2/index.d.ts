import type { CharacterIR } from "../../ir/character-ir.js";
export interface LeeSinV2Options {
    name?: string;
    profile?: CharacterIR["meta"]["fidelityProfile"];
}
export declare function createLeeSinV2CharacterIR(options?: LeeSinV2Options): CharacterIR;
