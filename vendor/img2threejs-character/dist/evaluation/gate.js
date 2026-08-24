export function pass(gateId, metrics = {}, evidence = []) {
    return { gateId, status: "PASS", metrics, thresholds: {}, evidence, failureCodes: [], repairHints: [] };
}
export function fail(gateId, failureCodes, repairHints, metrics = {}, thresholds = {}, evidence = []) {
    return { gateId, status: "FAIL", metrics, thresholds, evidence, failureCodes, repairHints };
}
export function warn(gateId, metrics, detail) {
    return { gateId, status: "WARN", metrics, thresholds: {}, evidence: [{ kind: "runtime", ref: gateId, detail }], failureCodes: [], repairHints: [] };
}
//# sourceMappingURL=gate.js.map