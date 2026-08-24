import assert from "node:assert/strict";
import test from "node:test";
import { createHumanoidCharacterIR } from "../archetypes/humanoid/index.js";
import { compileCharacter } from "../compiler/character-compiler.js";
import { runCharacterConformance } from "../evaluation/conformance.js";
test("standard humanoid compiles to shared Skeleton and SkinnedMesh geometry", () => {
    const ir = createHumanoidCharacterIR({ name: "Conformance humanoid", addTail: true, addWings: true });
    const compiled = compileCharacter(ir);
    assert.ok(compiled.root.getObjectByName("CharacterRoot"));
    assert.ok(compiled.skeleton.skeleton.bones.length >= 10);
    assert.notDeepEqual(compiled.skeleton.skeleton.boneInverses[1].elements.slice(12, 15), [0, 0, 0]);
    assert.ok(compiled.bodyMeshes.size >= 5);
    const firstMesh = [...compiled.bodyMeshes.values()][0];
    assert.ok(firstMesh.geometry.getAttribute("skinIndex"));
    const report = runCharacterConformance(ir, compiled);
    assert.equal(report.failedGateIds.length, 0, report.gates.filter((gate) => gate.status === "FAIL").map((gate) => `${gate.gateId}: ${gate.failureCodes.join(",")}`).join("\n"));
});
//# sourceMappingURL=compiler.test.js.map