const PROPORTION_ALIASES = {
    "head-scale": "headScale",
    "head-unit": "headScale",
    "head-height": "headScale",
    "shoulder-breadth": "shoulderBreadth",
    "shoulder-width": "shoulderBreadth",
    "thorax-width": "thoraxWidth",
    "thorax-depth": "thoraxDepth",
    "waist-width": "waistWidth",
    "pelvis-width": "pelvisWidth",
    "arm-span": "armSpan",
    "finger-span": "armSpan",
    "upper-arm-length": "upperArmLength",
    "forearm-length": "forearmLength",
    "hand-length": "handLength",
    "thigh-length": "thighLength",
    "lower-leg-length": "lowerLegLength",
    "foot-length": "footLength",
    stature: "stature",
};
export function canonicalProportionKey(value) {
    const kebab = value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[_\s]+/g, "-").toLowerCase();
    return PROPORTION_ALIASES[kebab];
}
export function setLandmark(ir, landmark, semanticRole = landmark.role) {
    const existing = ir.landmarkGraph.landmarks.findIndex((item) => item.id === landmark.id);
    if (existing >= 0)
        ir.landmarkGraph.landmarks[existing] = landmark;
    else
        ir.landmarkGraph.landmarks.push(landmark);
    ir.landmarkGraph.semanticToId[semanticRole] = landmark.id;
    const evidence = ir.evidence.landmarks.find((item) => item.id === landmark.id);
    if (evidence)
        evidence.position = landmark.position;
}
export function getLandmark(ir, idOrRole) {
    const id = ir.landmarkGraph.semanticToId[idOrRole] ?? idOrRole;
    return ir.landmarkGraph.landmarks.find((landmark) => landmark.id === id)?.position;
}
export function solveProportions(ir) {
    const observations = new Map();
    for (const item of ir.evidence.proportions) {
        const key = canonicalProportionKey(item.id) ?? canonicalProportionKey(item.numerator);
        if (!key || (observations.get(key)?.confidence ?? -1) > item.confidence)
            continue;
        observations.set(key, item);
    }
    const blend = (key, current) => {
        const observation = observations.get(key);
        if (!observation)
            return current;
        const confidence = Math.min(1, Math.max(0, observation.confidence));
        return current * (1 - confidence) + observation.ratio * confidence;
    };
    for (const key of observations.keys())
        ir.proportionModel[key] = blend(key, Number(ir.proportionModel[key]));
    const note = "Proportions blend archetype priors with confidence-weighted observations; strong evidence wins.";
    if (!ir.meta.assumptions.includes(note))
        ir.meta.assumptions.push(note);
}
//# sourceMappingURL=landmark-graph.js.map