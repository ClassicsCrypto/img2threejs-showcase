import type { CharacterEvidence } from "../ir/character-ir.js";
export interface EvidenceAdmission {
    accepted: boolean;
    observedSignals: number;
    errors: string[];
    warnings: string[];
}
export declare function admitCharacterEvidence(evidence: CharacterEvidence): EvidenceAdmission;
