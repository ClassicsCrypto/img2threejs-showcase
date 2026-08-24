import type { CharacterIR, CharacterArchetype } from "../ir/character-ir.js";
import { type HumanoidCharacterOptions } from "./humanoid/index.js";
export interface ArchetypeCharacterOptions extends Omit<HumanoidCharacterOptions, "archetype"> {
    archetype?: CharacterArchetype;
    traits?: string[];
}
/** Resolve a registered archetype into a compilable CharacterIR template. */
export declare function createCharacterForArchetype(id: string, options?: ArchetypeCharacterOptions): CharacterIR;
