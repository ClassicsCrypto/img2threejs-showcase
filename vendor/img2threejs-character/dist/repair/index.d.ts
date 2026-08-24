import { DependencyGraph, type InvalidationResult } from "../core/dependency-graph.js";
import { type CharacterSubsystem } from "../evaluation/failure-ownership.js";
export interface RepairPlan {
    owner: CharacterSubsystem;
    gateIds: string[];
    changedNode: string;
    invalidation: InvalidationResult;
    action: "refine-spec" | "refine-code" | "request-input";
}
export declare function planRepairs(failedGateIds: string[], dependencies?: DependencyGraph): RepairPlan[];
export declare function repairOwner(gateId: string): CharacterSubsystem;
