import assert from "node:assert/strict";
import test from "node:test";
import { CharacterPipeline, CHARACTER_STAGES } from "../core/pipeline.js";
import { defaultCharacterDependencies } from "../core/dependency-graph.js";
test("pipeline declares all proposal stages and dependency repair is downstream-aware", () => {
    const pipeline = new CharacterPipeline();
    assert.equal(pipeline.records.length, 13);
    assert.deepEqual(pipeline.records.map((record) => record.stage), [...CHARACTER_STAGES]);
    assert.ok(pipeline.records.find((record) => record.stage === "C7_RIG_CONSTRUCTION").requiredThreeDocs.some((doc) => doc.includes("Skeleton")));
    const invalidation = defaultCharacterDependencies().invalidate("shape");
    assert.ok(invalidation.invalidated.includes("topology"));
    assert.ok(invalidation.invalidated.includes("runtime"));
    assert.ok(!invalidation.invalidated.includes("evidence"));
});
//# sourceMappingURL=pipeline.test.js.map