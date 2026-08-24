import { defaultCharacterDependencies } from "../core/dependency-graph.js";
import { groupFailures, ownerForGate } from "../evaluation/failure-ownership.js";
const OWNER_TO_NODE = { Evidence: "evidence", ShapeEngine: "shape", ContinuousSurfaceEngine: "shape", TopologyEngine: "topology", SurfaceEngine: "surface", AppearanceEngine: "materials", RigCompiler: "rig", DeformationEngine: "deformation", FiberEngine: "fibers", WearableEngine: "wearables", RuntimeCompiler: "runtime" };
export function planRepairs(failedGateIds, dependencies = defaultCharacterDependencies()) {
    return [...groupFailures(failedGateIds)].map(([owner, gateIds]) => { const changedNode = OWNER_TO_NODE[owner]; return { owner, gateIds, changedNode, invalidation: dependencies.invalidate(changedNode), action: owner === "Evidence" ? "request-input" : "refine-code" }; });
}
export function repairOwner(gateId) {
    return ownerForGate(gateId);
}
//# sourceMappingURL=index.js.map