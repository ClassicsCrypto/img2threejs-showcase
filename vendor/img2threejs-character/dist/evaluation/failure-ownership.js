const OWNERS = [[/^GEO-CONTINUITY|^GEO-CROSS-SECTION/, "ContinuousSurfaceEngine"], [/^GEO-/, "ShapeEngine"], [/^SURF-/, "SurfaceEngine"], [/^RIG-/, "RigCompiler"], [/^DEF-/, "DeformationEngine"], [/^HAIR-/, "FiberEngine"], [/^CLOTH-|^ARMOR-/, "WearableEngine"], [/^RUNTIME-/, "RuntimeCompiler"]];
export function ownerForGate(gateId) {
    return OWNERS.find(([pattern]) => pattern.test(gateId))?.[1] ?? "Evidence";
}
export function groupFailures(gateIds) {
    const result = new Map();
    for (const gateId of gateIds) {
        const owner = ownerForGate(gateId);
        result.set(owner, [...(result.get(owner) ?? []), gateId]);
    }
    return result;
}
//# sourceMappingURL=failure-ownership.js.map