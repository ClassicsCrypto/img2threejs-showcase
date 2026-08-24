/**
 * CharacterIR is deliberately renderer-agnostic.  It contains semantic
 * character data and plain tuples; Three.js types belong to compiler/runtime.
 */
export function emptyCharacterEvidence() {
    return {
        camera: { projection: "perspective", confidence: 0.2 },
        captureProfiles: [],
        silhouettes: [],
        landmarks: [],
        semanticRegions: [],
        pose: { restPoseConfidence: 0.2, confidence: 0.2 },
        proportions: [],
        depthHints: [],
        occlusionGraph: { edges: [] },
        symmetry: { plane: "sagittal", score: 0.5, exceptions: [], confidence: 0.2 },
        crossSectionHints: [],
        materials: [],
        surfaceFeatures: [],
        fibers: [],
        wearables: [],
        uncertainty: {},
    };
}
export function createCharacterIR(name, archetype, profile = "standard") {
    return {
        meta: {
            id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "character",
            name,
            version: "0.1.0",
            fidelityProfile: profile,
            sourceRefs: [],
            assumptions: [],
            nonGoals: ["full cloth simulation", "soft-body physics", "motion synthesis", "strand simulation"],
        },
        evidence: emptyCharacterEvidence(),
        archetype,
        coordinateSystem: { up: "+Y", front: "+Z", lateral: "X", groundY: 0, height: 1, leftSign: 1 },
        semanticGraph: { nodes: [], edges: [] },
        proportionModel: {
            stature: 1,
            headScale: 0.13,
            shoulderBreadth: 0.24,
            thoraxWidth: 0.2,
            thoraxDepth: 0.12,
            waistWidth: 0.14,
            pelvisWidth: 0.18,
            armSpan: 0.52,
            upperArmLength: 0.17,
            forearmLength: 0.16,
            handLength: 0.1,
            thighLength: 0.25,
            lowerLegLength: 0.24,
            footLength: 0.13,
            customSegments: [],
        },
        proportionBindings: [],
        landmarkGraph: { landmarks: [], semanticToId: {} },
        shapeGraph: { lofts: [], hands: [], curves: [], implicitFields: [], patches: [] },
        topologyGraph: { patches: [], edgeLoops: [], jointZones: [], facialLoops: [], poles: [], seams: [], densityFields: [] },
        surfaceGraph: { features: [], coordinates: {}, tangentSpace: { algorithm: "mikktspace", requirePosition: true, requireNormal: true, requireUV: true }, uvStrategy: "semantic-region" },
        appearanceGraph: { materials: [], variants: {} },
        runtimeGraph: { nodes: [], stableJointNames: [], stableMorphNames: [], poseProfiles: [] },
        optimizationGraph: {
            profile,
            geometryLod: profile === "lite" ? [1, 0.55] : profile === "standard" ? [1, 0.65, 0.3] : [1, 0.75, 0.45, 0.2],
            fiberLod: profile === "hero" ? [1, 0.6, 0.25] : [1, 0.35],
            boneBudget: profile === "lite" ? 48 : profile === "standard" ? 96 : 160,
            morphBudget: profile === "lite" ? 8 : profile === "standard" ? 32 : 96,
            textureBudgetMb: profile === "lite" ? 32 : profile === "standard" ? 128 : 512,
            materialBudget: profile === "lite" ? 8 : profile === "standard" ? 24 : 64,
        },
        validationGraph: { requiredGates: [], thresholds: {} },
    };
}
//# sourceMappingURL=character-ir.js.map