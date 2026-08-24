import { compileMaterials } from "../materials/index.js";
export function compileAppearance(graph, backend = "webgl") {
    return compileMaterials(graph, backend);
}
//# sourceMappingURL=material-compiler.js.map