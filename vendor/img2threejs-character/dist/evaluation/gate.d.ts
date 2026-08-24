export type GateStatus = "PASS" | "WARN" | "FAIL" | "BLOCKED";
export interface GateEvidence {
    kind: "runtime" | "geometry" | "screenshot" | "ir" | "export";
    ref: string;
    detail?: string;
}
export interface GateResult {
    gateId: string;
    status: GateStatus;
    region?: string;
    metrics: Record<string, number>;
    thresholds: Record<string, number>;
    evidence: GateEvidence[];
    failureCodes: string[];
    repairHints: string[];
}
export declare function pass(gateId: string, metrics?: Record<string, number>, evidence?: GateEvidence[]): GateResult;
export declare function fail(gateId: string, failureCodes: string[], repairHints: string[], metrics?: Record<string, number>, thresholds?: Record<string, number>, evidence?: GateEvidence[]): GateResult;
export declare function warn(gateId: string, metrics: Record<string, number>, detail: string): GateResult;
