import type { CharacterArchetype, CharacterIR } from "../../ir/character-ir.js";
export interface HumanoidCharacterOptions {
    name?: string;
    profile?: CharacterIR["meta"]["fidelityProfile"];
    archetype?: CharacterArchetype;
    addTail?: boolean;
    addWings?: boolean;
    addShirt?: boolean;
}
export declare function createHumanoidCharacterIR(options?: HumanoidCharacterOptions): CharacterIR;
