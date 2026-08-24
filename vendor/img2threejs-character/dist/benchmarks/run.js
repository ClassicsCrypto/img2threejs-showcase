import { createHumanoidCharacterIR } from "../archetypes/humanoid/index.js";
import { compileCharacter } from "../compiler/character-compiler.js";
import { runCharacterConformance } from "../evaluation/conformance.js";
const ir = createHumanoidCharacterIR({ name: "benchmark-humanoid", profile: "standard", addTail: true, addWings: true });
const compiled = compileCharacter(ir);
const report = runCharacterConformance(ir, compiled);
console.log(JSON.stringify({ name: ir.meta.name, profile: report.profile, status: report.status, failedGateIds: report.failedGateIds, warnedGateIds: report.warnedGateIds, bodyMeshes: compiled.bodyMeshes.size, bones: compiled.skeleton.skeleton.bones.length, fibers: compiled.fibers.guideCount, diagnostics: compiled.diagnostics }, null, 2));
//# sourceMappingURL=run.js.map