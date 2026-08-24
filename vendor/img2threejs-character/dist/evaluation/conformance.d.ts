import type { CharacterIR } from "../ir/character-ir.js";
import type { CompiledCharacter } from "../compiler/character-compiler.js";
import { type VisualEvidenceInput } from "./visual-gate.js";
import type { GateResult } from "./gate.js";
export interface ConformanceReport {
    status: "PASS" | "WARN" | "FAIL";
    gates: GateResult[];
    failedGateIds: string[];
    warnedGateIds: string[];
    repairHints: string[];
    profile: CharacterIR["meta"]["fidelityProfile"];
}
export declare function runCharacterConformance(ir: CharacterIR, compiled: CompiledCharacter, visualEvidence?: VisualEvidenceInput): ConformanceReport;
