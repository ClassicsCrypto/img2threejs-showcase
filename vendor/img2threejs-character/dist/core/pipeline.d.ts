export declare const CHARACTER_STAGES: readonly ["C0_CHARACTER_ADMISSION", "C1_CHARACTER_EVIDENCE", "C2_ARCHETYPE_SEMANTIC_GRAPH", "C3_LANDMARK_PROPORTION_SOLVE", "C4_SHAPE_RECONSTRUCTION", "C5_CONTINUOUS_SURFACE_TOPOLOGY", "C6_SURFACE_APPEARANCE", "C7_RIG_CONSTRUCTION", "C8_FIBER_HAIR_FUR", "C9_DEFORMATION_WEARABLES_APPENDAGES", "C10_RUNTIME_COMPILATION", "C11_CHARACTER_CONFORMANCE", "C12_DEPENDENCY_AWARE_REPAIR"];
export type CharacterStage = (typeof CHARACTER_STAGES)[number];
export type StageDecision = "continue" | "refine-spec" | "refine-code" | "request-input" | "stop";
export interface StageRecord {
    stage: CharacterStage;
    status: "pending" | "active" | "complete" | "blocked";
    decision?: StageDecision;
    evidence: string[];
    notes: string[];
    requiredThreeDocs: string[];
    knowledgeCollections: string[];
}
export declare class CharacterPipeline {
    readonly records: StageRecord[];
    get current(): StageRecord;
    recordEvidence(path: string, note?: string): void;
    decide(decision: StageDecision, note?: string): void;
    assertReadyFor(stage: CharacterStage): void;
    toJSON(): StageRecord[];
}
