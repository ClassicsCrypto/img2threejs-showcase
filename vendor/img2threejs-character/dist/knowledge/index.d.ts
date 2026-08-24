export interface KnowledgeCollection {
    id: "anatomy" | "biomechanics" | "topology" | "face" | "skin" | "fibers" | "clothing" | "creatures";
    purpose: string;
}
export declare const CHARACTER_KNOWLEDGE: KnowledgeCollection[];
export declare function knowledgeForStage(stage: string): KnowledgeCollection[];
