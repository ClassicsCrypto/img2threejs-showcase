import type { CharacterIR } from "../ir/character-ir.js";
export declare function compileShapeGraph(ir: CharacterIR): {
    loft: import("../ir/character-ir.js").AnatomicalLoft;
    result: import("../geometry/loft/index.js").LoftBuildResult;
}[];
