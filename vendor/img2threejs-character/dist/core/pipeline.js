import { knowledgeForStage } from "../knowledge/index.js";
export const CHARACTER_STAGES = [
    "C0_CHARACTER_ADMISSION",
    "C1_CHARACTER_EVIDENCE",
    "C2_ARCHETYPE_SEMANTIC_GRAPH",
    "C3_LANDMARK_PROPORTION_SOLVE",
    "C4_SHAPE_RECONSTRUCTION",
    "C5_CONTINUOUS_SURFACE_TOPOLOGY",
    "C6_SURFACE_APPEARANCE",
    "C7_RIG_CONSTRUCTION",
    "C8_FIBER_HAIR_FUR",
    "C9_DEFORMATION_WEARABLES_APPENDAGES",
    "C10_RUNTIME_COMPILATION",
    "C11_CHARACTER_CONFORMANCE",
    "C12_DEPENDENCY_AWARE_REPAIR",
];
const DOCS = {
    C0_CHARACTER_ADMISSION: ["https://threejs.org/docs/"],
    C1_CHARACTER_EVIDENCE: ["https://threejs.org/docs/pages/PerspectiveCamera.html", "https://threejs.org/docs/pages/Matrix4.html"],
    C2_ARCHETYPE_SEMANTIC_GRAPH: ["https://threejs.org/docs/pages/Object3D.html"],
    C3_LANDMARK_PROPORTION_SOLVE: ["https://threejs.org/docs/pages/Vector3.html", "https://threejs.org/docs/pages/Quaternion.html"],
    C4_SHAPE_RECONSTRUCTION: ["https://threejs.org/docs/pages/LoftGeometry.html", "https://threejs.org/docs/pages/Curve.html", "https://threejs.org/docs/pages/BufferGeometry.html"],
    C5_CONTINUOUS_SURFACE_TOPOLOGY: ["https://threejs.org/docs/pages/BufferGeometry.html", "https://threejs.org/docs/pages/module-BufferGeometryUtils.html"],
    C6_SURFACE_APPEARANCE: ["https://threejs.org/docs/pages/DecalGeometry.html", "https://threejs.org/docs/pages/Raycaster.html", "https://threejs.org/docs/pages/MeshPhysicalMaterial.html"],
    C7_RIG_CONSTRUCTION: ["https://threejs.org/docs/pages/Bone.html", "https://threejs.org/docs/pages/Skeleton.html", "https://threejs.org/docs/pages/SkinnedMesh.html"],
    C8_FIBER_HAIR_FUR: ["https://threejs.org/docs/pages/MeshSurfaceSampler.html", "https://threejs.org/docs/pages/TubeGeometry.html", "https://threejs.org/docs/pages/MeshPhysicalMaterial.html"],
    C9_DEFORMATION_WEARABLES_APPENDAGES: ["https://threejs.org/docs/pages/CCDIKSolver.html", "https://threejs.org/docs/pages/SkinnedMesh.html", "https://threejs.org/docs/pages/TubeGeometry.html"],
    C10_RUNTIME_COMPILATION: ["https://threejs.org/docs/pages/Object3D.html", "https://threejs.org/docs/pages/AnimationMixer.html"],
    C11_CHARACTER_CONFORMANCE: ["https://threejs.org/docs/pages/BufferGeometry.html", "https://threejs.org/docs/pages/Raycaster.html"],
    C12_DEPENDENCY_AWARE_REPAIR: ["https://threejs.org/docs/"],
};
export class CharacterPipeline {
    records = CHARACTER_STAGES.map((stage, index) => ({
        stage,
        status: index === 0 ? "active" : "pending",
        evidence: [],
        notes: [],
        requiredThreeDocs: DOCS[stage],
        knowledgeCollections: knowledgeForStage(stage).map((collection) => collection.id),
    }));
    get current() {
        return this.records.find((record) => record.status === "active") ?? this.records[this.records.length - 1];
    }
    recordEvidence(path, note) {
        this.current.evidence.push(path);
        if (note)
            this.current.notes.push(note);
    }
    decide(decision, note) {
        const current = this.current;
        current.decision = decision;
        if (note)
            current.notes.push(note);
        if (decision === "stop" || decision === "request-input") {
            current.status = "blocked";
            return;
        }
        current.status = "complete";
        const next = this.records[this.records.indexOf(current) + 1];
        if (next)
            next.status = "active";
    }
    assertReadyFor(stage) {
        const record = this.records.find((candidate) => candidate.stage === stage);
        if (!record)
            throw new Error(`unknown Character stage: ${stage}`);
        const index = this.records.indexOf(record);
        const unfinished = this.records.slice(0, index).filter((candidate) => candidate.status !== "complete");
        if (unfinished.length)
            throw new Error(`stage ${stage} is locked; incomplete prerequisites: ${unfinished.map((item) => item.stage).join(", ")}`);
        if (record.evidence.length === 0 && stage !== "C0_CHARACTER_ADMISSION")
            throw new Error(`stage ${stage} requires evidence before activation`);
    }
    toJSON() {
        return this.records.map((record) => ({ ...record, evidence: [...record.evidence], notes: [...record.notes], requiredThreeDocs: [...record.requiredThreeDocs], knowledgeCollections: [...record.knowledgeCollections] }));
    }
}
//# sourceMappingURL=pipeline.js.map