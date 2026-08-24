import assert from "node:assert/strict";
import test from "node:test";
import { createHumanoidCharacterIR } from "../archetypes/humanoid/index.js";
import { compileCharacter } from "../compiler/character-compiler.js";
import { runCharacterConformance } from "../evaluation/conformance.js";
test("standard conformance covers proposal gate families without failures", () => {
    const ir = createHumanoidCharacterIR({ name: "Gate coverage", addTail: true, addWings: true });
    const compiled = compileCharacter(ir);
    const report = runCharacterConformance(ir, compiled);
    assert.equal(report.failedGateIds.length, 0, report.failedGateIds.join(", "));
    for (const gateId of ["GEO-WATERTIGHT", "GEO-MANIFOLD", "SURF-ATTACHMENT", "RIG-BONE-AXES", "RIG-IK-TARGET", "DEF-ELBOW-45", "DEF-KNEE-90", "HAIR-CLUMP", "HAIR-ANISOTROPY", "CLOTH-FIT", "CLOTH-DEFORMATION", "G9-RUNTIME-EXPORT"]) {
        assert.ok(report.gates.some((gate) => gate.gateId === gateId), gateId);
    }
    assert.ok(compiled.surfaceFeatures.attachedCount >= 1);
});
//# sourceMappingURL=conformance.test.js.map