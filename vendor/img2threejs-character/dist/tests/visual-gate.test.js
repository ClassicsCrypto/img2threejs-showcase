import assert from "node:assert/strict";
import test from "node:test";
import { createLeeSinV2CharacterIR } from "../archetypes/lee-sin-v2/index.js";
import { compileCharacter } from "../compiler/character-compiler.js";
import { visualFidelityGate } from "../evaluation/visual-gate.js";
const view = (id, silhouetteIoU = 0.9, regionIoU = 0.8) => ({
    id,
    referencePath: `${id}-reference.png`,
    renderPath: `${id}-render.png`,
    cameraProfileId: `turnaround-${id}`,
    poseProfileId: "turnaround-a-pose",
    silhouetteIoU,
    aspectRatioDelta: 0.02,
    scaleDelta: 0.03,
    regions: { head: { silhouetteIoU: regionIoU }, torso: { silhouetteIoU: regionIoU } },
});
test("visual gate is fail-closed across required views and semantic regions", () => {
    const compiled = compileCharacter(createLeeSinV2CharacterIR());
    const missing = visualFidelityGate(compiled, { views: [view("front")] });
    assert.equal(missing.status, "FAIL");
    assert.ok(missing.failureCodes.some((failure) => failure.includes("missing required view: side")));
    const regional = visualFidelityGate(compiled, { views: [view("front"), view("three-quarter"), view("side", 0.9, 0.6), view("rear")] });
    assert.equal(regional.status, "FAIL");
    assert.ok(regional.failureCodes.some((failure) => failure.includes("side:head")));
    const passed = visualFidelityGate(compiled, { views: [view("front"), view("three-quarter"), view("side"), view("rear")] });
    assert.equal(passed.status, "PASS");
    assert.equal(passed.metrics.checkedViews, 4);
    assert.equal(passed.metrics.regionMetrics, 8);
});
//# sourceMappingURL=visual-gate.test.js.map