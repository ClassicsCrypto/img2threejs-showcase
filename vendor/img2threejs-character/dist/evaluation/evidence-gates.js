import { admitCharacterEvidence } from "../evidence/admission.js";
import { fail, pass, warn } from "./gate.js";
export function evidenceGates(ir) {
    const admission = admitCharacterEvidence(ir.evidence);
    if (!admission.accepted)
        return [fail("G0-EVIDENCE", admission.errors, ["Evidence: repair confidence and coordinate fields before compilation"], { observedSignals: admission.observedSignals })];
    if (admission.observedSignals === 0 && ir.meta.sourceRefs.length === 0)
        return [warn("G0-EVIDENCE", { observedSignals: 0 }, "No reference evidence was attached; archetype priors are being used for the procedural benchmark.")];
    return admission.observedSignals > 0 ? [pass("G0-EVIDENCE", { observedSignals: admission.observedSignals }, [{ kind: "ir", ref: "CharacterEvidence" }])] : [fail("G0-EVIDENCE", ["evidence is present but has no observed signals"], ["Evidence: admit at least one readable view and landmark/silhouette record"])];
}
//# sourceMappingURL=evidence-gates.js.map