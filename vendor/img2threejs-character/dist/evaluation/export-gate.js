import { pass } from "./gate.js";
export function exportGate(compiled) {
    return pass("G9-RUNTIME-EXPORT", { namedMeshes: compiled.meshes.size, bones: compiled.skeleton.skeleton.bones.length, morphs: compiled.ir.morphGraph?.definitions.length ?? 0 }, [{ kind: "export", ref: "compiler/export.ts" }]);
}
//# sourceMappingURL=export-gate.js.map