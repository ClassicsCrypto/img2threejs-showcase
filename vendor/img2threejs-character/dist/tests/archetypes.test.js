import assert from "node:assert/strict";
import test from "node:test";
import { createCharacterForArchetype } from "../archetypes/factory.js";
import { compileCharacter } from "../compiler/character-compiler.js";
test("registered archetypes resolve to compilable CharacterIR templates", () => {
    for (const id of ["anime", "chibi", "quadruped", "winged", "reptilian", "serpentine", "multi-limb", "mechanical"]) {
        const ir = createCharacterForArchetype(id, { name: `archetype-${id}` });
        const compiled = compileCharacter(ir);
        assert.equal(compiled.diagnostics.errors.length, 0, id);
        assert.ok(compiled.bodyMeshes.size >= 7, id);
    }
});
//# sourceMappingURL=archetypes.test.js.map