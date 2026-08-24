import { defaultCapabilities } from "../core/capability-registry.js";
export function runtimeCapabilities(backend = "webgl") {
    return defaultCapabilities().get(backend);
}
//# sourceMappingURL=capabilities.js.map