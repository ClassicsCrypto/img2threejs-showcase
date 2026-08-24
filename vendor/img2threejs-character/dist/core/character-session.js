import { createCharacterIR } from "../ir/character-ir.js";
import { defaultCharacterDependencies } from "./dependency-graph.js";
import { defaultCapabilities } from "./capability-registry.js";
import { CharacterPipeline } from "./pipeline.js";
import { compileCharacter } from "../compiler/character-compiler.js";
import { runCharacterConformance } from "../evaluation/conformance.js";
export class CharacterSession {
    ir;
    pipeline;
    dependencies;
    capabilities;
    compiled;
    constructor(ir) {
        this.ir = ir;
        this.pipeline = new CharacterPipeline();
        this.dependencies = defaultCharacterDependencies();
        this.capabilities = defaultCapabilities();
    }
    static create(options) {
        return new CharacterSession(createCharacterIR(options.name, options.archetype, options.profile));
    }
    recordEvidence(path, note) {
        this.pipeline.recordEvidence(path, note);
        this.ir.meta.sourceRefs.push(path);
    }
    completeStage(decision, note) {
        this.pipeline.decide(decision, note);
    }
    mark(stage, evidence, note) {
        const record = this.pipeline.records.find((candidate) => candidate.stage === stage);
        if (!record)
            throw new Error(`unknown Character stage: ${stage}`);
        record.evidence.push(evidence);
        if (note)
            record.notes.push(note);
    }
    invalidate(changed) {
        return this.dependencies.invalidate(changed);
    }
    compile(options = {}) {
        this.compiled = compileCharacter(this.ir, options);
        return this.compiled;
    }
    conformance() {
        if (!this.compiled)
            throw new Error("compile the CharacterIR before running conformance");
        return runCharacterConformance(this.compiled.ir, this.compiled);
    }
    get runtime() {
        if (!this.compiled)
            throw new Error("compile the CharacterIR before reading runtime");
        return this.compiled.runtime;
    }
    snapshot() {
        return { ir: structuredClone(this.ir), pipeline: this.pipeline.toJSON() };
    }
}
//# sourceMappingURL=character-session.js.map