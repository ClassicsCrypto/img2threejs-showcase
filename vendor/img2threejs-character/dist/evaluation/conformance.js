import { deformationGates } from "./deformation-gates.js";
import { fiberGates } from "./fiber-gates.js";
import { geometryGates } from "./geometry-gates.js";
import { rigGates } from "./rig-gates.js";
import { runtimeGates } from "./runtime-gates.js";
import { surfaceGates } from "./surface-gates.js";
import { wearableGates } from "./wearable-gates.js";
import { evidenceGates } from "./evidence-gates.js";
import { proportionGates, anatomyGates } from "./proportion-gates.js";
import { visualFidelityGate } from "./visual-gate.js";
import { exportGate } from "./export-gate.js";
import { accessoryGates } from "./accessory-gates.js";
export function runCharacterConformance(ir, compiled, visualEvidence) {
    const gates = [...evidenceGates(ir), ...proportionGates(ir), ...anatomyGates(ir), ...geometryGates(compiled), ...surfaceGates(compiled), ...rigGates(compiled), ...deformationGates(compiled), ...fiberGates(compiled), ...wearableGates(compiled), ...accessoryGates(compiled), ...runtimeGates(compiled), visualFidelityGate(compiled, visualEvidence), exportGate(compiled)];
    const failedGateIds = gates.filter((gate) => gate.status === "FAIL" || gate.status === "BLOCKED").map((gate) => gate.gateId);
    const warnedGateIds = gates.filter((gate) => gate.status === "WARN").map((gate) => gate.gateId);
    return { status: failedGateIds.length ? "FAIL" : warnedGateIds.length ? "WARN" : "PASS", gates, failedGateIds, warnedGateIds, repairHints: gates.flatMap((gate) => gate.repairHints), profile: ir.meta.fidelityProfile };
}
//# sourceMappingURL=conformance.js.map