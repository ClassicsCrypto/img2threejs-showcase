import type { DensityField } from "../../ir/character-ir.js";
export declare function densityForRegion(fields: DensityField[], region: string): number;
export declare function segmentCount(fields: DensityField[], region: string, base?: number): number;
export declare function defaultDensityFields(): DensityField[];
