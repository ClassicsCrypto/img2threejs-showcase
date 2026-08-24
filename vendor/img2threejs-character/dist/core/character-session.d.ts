import type { CharacterIR } from "../ir/character-ir.js";
import { DependencyGraph, type InvalidationResult } from "./dependency-graph.js";
import { CapabilityRegistry } from "./capability-registry.js";
import { CharacterPipeline, type CharacterStage, type StageDecision } from "./pipeline.js";
import { type CharacterCompileOptions, type CompiledCharacter } from "../compiler/character-compiler.js";
import { type ConformanceReport } from "../evaluation/conformance.js";
export interface CharacterSessionOptions {
    name: string;
    archetype: CharacterIR["archetype"];
    profile?: CharacterIR["meta"]["fidelityProfile"];
}
export declare class CharacterSession {
    readonly ir: CharacterIR;
    readonly pipeline: CharacterPipeline;
    readonly dependencies: DependencyGraph;
    readonly capabilities: CapabilityRegistry;
    private compiled?;
    constructor(ir: CharacterIR);
    static create(options: CharacterSessionOptions): CharacterSession;
    recordEvidence(path: string, note?: string): void;
    completeStage(decision: StageDecision, note?: string): void;
    mark(stage: CharacterStage, evidence: string, note?: string): void;
    invalidate(changed: string): InvalidationResult;
    compile(options?: CharacterCompileOptions): CompiledCharacter;
    conformance(): ConformanceReport;
    get runtime(): CompiledCharacter["runtime"];
    snapshot(): {
        ir: CharacterIR;
        pipeline: ReturnType<CharacterPipeline["toJSON"]>;
    };
}
