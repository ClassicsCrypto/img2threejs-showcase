import assert from "node:assert/strict";
import test from "node:test";
import { planRepairs } from "../repair/index.js";
test("repair maps failures to the minimum owner and downstream invalidation", () => {
    const plans = planRepairs(["GEO-CONTINUITY", "RIG-WEIGHT-SUM", "HAIR-ROOT-ATTACHMENT"]);
    assert.equal(plans.find((plan) => plan.owner === "ContinuousSurfaceEngine")?.changedNode, "shape");
    assert.ok(plans.find((plan) => plan.owner === "RigCompiler")?.invalidation.invalidated.includes("weights"));
    assert.equal(plans.find((plan) => plan.owner === "FiberEngine")?.action, "refine-code");
});
//# sourceMappingURL=repair.test.js.map