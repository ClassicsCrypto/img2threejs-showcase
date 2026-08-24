import type { DeformationGraph } from "../ir/character-ir.js";
export interface DeformationCompileSummary {
    skinningStrategy: DeformationGraph["skinning"]["strategy"];
    correctives: string[];
    surfaceFollowers: string[];
}
export declare function compileDeformation(graph: DeformationGraph | undefined): DeformationCompileSummary;
