import type { CharacterArchetype } from "../ir/character-ir.js";
export interface ArchetypeDescriptor {
    id: string;
    label: string;
    archetype: CharacterArchetype;
    supports: string[];
}
export declare class ArchetypeRegistry {
    private readonly descriptors;
    register(descriptor: ArchetypeDescriptor): this;
    get(id: string): ArchetypeDescriptor | undefined;
    list(): ArchetypeDescriptor[];
    resolve(id: string, traits?: string[]): CharacterArchetype;
}
export declare function createDefaultArchetypes(): ArchetypeRegistry;
export { createHumanoidCharacterIR, type HumanoidCharacterOptions } from "./humanoid/index.js";
export { createCharacterForArchetype, type ArchetypeCharacterOptions } from "./factory.js";
export { createLeeSinV2CharacterIR, type LeeSinV2Options } from "./lee-sin-v2/index.js";
