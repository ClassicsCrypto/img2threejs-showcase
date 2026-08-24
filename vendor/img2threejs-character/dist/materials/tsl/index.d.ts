export interface SemanticMaterialNodeGraph {
    id: string;
    channels: string[];
    backend: "tsl";
    fallback: "physical";
}
export declare function createTslGraph(id: string, channels: string[]): SemanticMaterialNodeGraph;
