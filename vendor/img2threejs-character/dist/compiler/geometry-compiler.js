import { buildAnatomicalLoft } from "../geometry/loft/index.js";
export function compileShapeGraph(ir) {
    return ir.shapeGraph.lofts.map((loft) => ({ loft, result: buildAnatomicalLoft(loft) }));
}
//# sourceMappingURL=geometry-compiler.js.map