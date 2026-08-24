import type { CharacterCrossSection, Vec2, Vec3 } from "../../ir/character-ir.js";
export declare function ellipseContour(count?: number): Vec2[];
export declare function makeCrossSection(center: Vec3, width: number, depth: number, t: number, count?: number): CharacterCrossSection;
export declare function validateCrossSections(sections: CharacterCrossSection[]): string[];
export declare function mirrorSection(section: CharacterCrossSection): CharacterCrossSection;
