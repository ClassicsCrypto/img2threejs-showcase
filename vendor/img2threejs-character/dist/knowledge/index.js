export const CHARACTER_KNOWLEDGE = [
    { id: "anatomy", purpose: "landmarks, proportions and continuous anatomy" },
    { id: "biomechanics", purpose: "joint ranges, deformation and volume preservation" },
    { id: "topology", purpose: "deformation-aware loops, density and tangent space" },
    { id: "face", purpose: "facial landmarks, eyes and morph zones" },
    { id: "skin", purpose: "semantic PBR channels and optional SSS" },
    { id: "fibers", purpose: "hair, fur, feathers and fiber flow" },
    { id: "clothing", purpose: "garment shells, seams and clearance" },
    { id: "creatures", purpose: "non-human appendages and archetype priors" },
];
const STAGE_KNOWLEDGE = {
    C1_CHARACTER_EVIDENCE: ["anatomy"],
    C3_LANDMARK_PROPORTION_SOLVE: ["anatomy", "biomechanics"],
    C4_SHAPE_RECONSTRUCTION: ["anatomy", "creatures"],
    C5_CONTINUOUS_SURFACE_TOPOLOGY: ["topology", "biomechanics"],
    C6_SURFACE_APPEARANCE: ["skin", "topology"],
    C7_RIG_CONSTRUCTION: ["biomechanics", "topology"],
    C8_FIBER_HAIR_FUR: ["fibers", "skin"],
    C9_DEFORMATION_WEARABLES_APPENDAGES: ["biomechanics", "clothing", "creatures"],
};
export function knowledgeForStage(stage) {
    const ids = new Set(STAGE_KNOWLEDGE[stage] ?? []);
    return CHARACTER_KNOWLEDGE.filter((collection) => ids.has(collection.id));
}
//# sourceMappingURL=index.js.map