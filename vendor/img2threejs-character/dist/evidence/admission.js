export function admitCharacterEvidence(evidence) {
    const errors = [];
    const warnings = [];
    const observedSignals = evidence.silhouettes.filter((item) => item.observed).length
        + evidence.landmarks.filter((item) => item.observed).length
        + evidence.semanticRegions.filter((item) => item.observed).length
        + evidence.materials.filter((item) => item.confidence > 0.5).length
        + evidence.surfaceFeatures.filter((item) => item.observed).length
        + evidence.fibers.filter((item) => item.confidence > 0.5).length
        + evidence.wearables.filter((item) => item.confidence > 0.5).length;
    if (evidence.camera.confidence < 0 || evidence.camera.confidence > 1)
        errors.push("camera confidence must be within [0,1]");
    if (evidence.symmetry.score < 0 || evidence.symmetry.score > 1)
        errors.push("symmetry score must be within [0,1]");
    for (const landmark of evidence.landmarks)
        if (landmark.confidence < 0 || landmark.confidence > 1)
            errors.push(`${landmark.id}: landmark confidence must be within [0,1]`);
    if (observedSignals === 0)
        warnings.push("no observed reference signal was admitted; archetype priors remain active");
    if (evidence.pose.restPoseConfidence < 0.5)
        warnings.push("rest pose confidence is below the standard admission threshold");
    return { accepted: errors.length === 0, observedSignals, errors, warnings };
}
//# sourceMappingURL=admission.js.map