import assert from "node:assert/strict";
import test from "node:test";
import { createCharacterIR } from "../ir/character-ir.js";
import { addSemanticNode, addSemanticRelation, validateSemanticGraph } from "../ir/semantic-graph.js";
test("CharacterIR remains declarative and graph relations are validated", () => {
    const ir = createCharacterIR("Graph test", { baseFamily: "quadruped", traits: [], appendages: [{ id: "legs", semanticRole: "leg", count: 4 }] });
    addSemanticNode(ir.semanticGraph, { id: "body", kind: "anatomy" });
    addSemanticNode(ir.semanticGraph, { id: "tail", kind: "appendage" });
    addSemanticRelation(ir.semanticGraph, "tail", "body", "attached-to");
    assert.deepEqual(validateSemanticGraph(ir.semanticGraph), []);
    assert.equal(typeof ir.shapeGraph.lofts, "object");
    assert.equal("three" in ir, false);
    assert.doesNotThrow(() => structuredClone(ir));
});
//# sourceMappingURL=ir.test.js.map