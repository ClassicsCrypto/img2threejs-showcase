import { fail, pass } from "./gate.js";
export function proportionGates(ir) {
    const p = ir.proportionModel;
    const values = [p.stature, p.headScale, p.shoulderBreadth, p.thoraxWidth, p.thoraxDepth, p.waistWidth, p.pelvisWidth, p.armSpan, p.upperArmLength, p.forearmLength, p.handLength, p.thighLength, p.lowerLegLength, p.footLength];
    const invalid = values.filter((value) => !Number.isFinite(value) || value <= 0).length;
    return [invalid ? fail("G1-PROPORTION", [`${invalid} proportion values are invalid`], ["LandmarkSolver: solve positive normalized measurements"], { invalid }) : pass("G1-PROPORTION", { measuredValues: values.length, stature: p.stature }, [{ kind: "ir", ref: "proportionModel" }])];
}
export function anatomyGates(ir) {
    const regions = ir.shapeGraph.lofts.length;
    return [regions >= 3 ? pass("G2-ANATOMY-SHAPE", { anatomicalLofts: regions }, [{ kind: "ir", ref: "shapeGraph.lofts" }]) : fail("G2-ANATOMY-SHAPE", ["fewer than three continuous shape regions"], ["ShapeEngine: add axial and appendage lofts"], { anatomicalLofts: regions })];
}
//# sourceMappingURL=proportion-gates.js.map