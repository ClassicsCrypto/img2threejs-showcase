import assert from "node:assert/strict";
import test from "node:test";
import { createHumanoidCharacterIR } from "../archetypes/humanoid/index.js";
import { compileCharacter } from "../compiler/character-compiler.js";
import { exportCharacter } from "../compiler/export.js";
test("GLTF exporter produces a binary delivery artifact", async () => {
    const compiled = compileCharacter(createHumanoidCharacterIR({ name: "Export test", profile: "lite" }));
    const result = await exportCharacter(compiled.root, { binary: true });
    assert.ok(result instanceof ArrayBuffer);
    assert.ok(result.byteLength > 1024);
    assert.ok(compiled.root.userData.sculptRuntime);
});
//# sourceMappingURL=export.test.js.map