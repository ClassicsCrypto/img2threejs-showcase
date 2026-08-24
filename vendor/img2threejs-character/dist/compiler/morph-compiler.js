import { attachMorphTargets } from "../deformation/morphs/index.js";
export function compileMorphs(graph, geometry) {
    if (graph)
        attachMorphTargets(geometry, graph.definitions);
}
//# sourceMappingURL=morph-compiler.js.map