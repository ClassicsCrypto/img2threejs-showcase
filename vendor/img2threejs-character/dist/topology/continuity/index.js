export function validateContinuity(constraints) {
    const errors = [];
    for (const constraint of constraints) {
        if (!constraint.regionA || !constraint.regionB)
            errors.push("continuity constraint has missing region");
        if (!constraint.positionalContinuity)
            errors.push(`${constraint.regionA} -> ${constraint.regionB} lacks positional continuity`);
        if (constraint.curvaturePreference !== undefined && (constraint.curvaturePreference < 0 || constraint.curvaturePreference > 1))
            errors.push(`${constraint.regionA} -> ${constraint.regionB} curvature preference is outside [0,1]`);
    }
    return errors;
}
export function continuityPairs(regions) {
    return regions.slice(0, -1).map((regionA, index) => ({ regionA, regionB: regions[index + 1], positionalContinuity: true, tangentContinuity: true, curvaturePreference: 0.7, topologyBridge: "shared-boundary", deformationBridge: "shared-weight-zone" }));
}
//# sourceMappingURL=index.js.map