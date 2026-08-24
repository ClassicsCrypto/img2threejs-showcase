import type { CharacterIR, SemanticEdge, SemanticGraph, SemanticNode, SemanticRelation } from "./character-ir.js";
export declare function addSemanticNode(graph: SemanticGraph, node: SemanticNode): void;
export declare function addSemanticRelation(graph: SemanticGraph, from: string, to: string, relation: SemanticRelation, confidence?: number): void;
export declare function relationsFor(graph: SemanticGraph, nodeId: string, relation?: SemanticRelation): SemanticEdge[];
export declare function validateSemanticGraph(graph: SemanticGraph): string[];
export declare function assertCharacterGraph(ir: CharacterIR): void;
