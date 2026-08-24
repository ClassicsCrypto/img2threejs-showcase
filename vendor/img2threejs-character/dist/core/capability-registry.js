export class CapabilityRegistry {
    capabilities = new Map();
    register(capabilities) {
        this.capabilities.set(capabilities.backend, capabilities);
        return this;
    }
    get(backend) {
        return this.capabilities.get(backend);
    }
    require(backend, feature) {
        const result = this.capabilities.get(backend);
        if (!result)
            throw new Error(`renderer capability is not registered: ${backend}`);
        if (feature && !result[feature])
            throw new Error(`${backend} capability is unavailable: ${feature}`);
        return result;
    }
    supports(backend, feature) {
        const result = this.capabilities.get(backend);
        if (!result)
            return false;
        if (feature in result)
            return Boolean(result[feature]);
        return result.addons.has(feature);
    }
    list() {
        return [...this.capabilities.values()].map((item) => ({ ...item, addons: new Set(item.addons) }));
    }
}
export function defaultCapabilities() {
    return new CapabilityRegistry()
        .register({ backend: "webgl", nodeMaterials: false, tsl: false, compute: false, addons: new Set(["gltf-export", "ik", "mikkts"]) })
        .register({ backend: "webgpu", nodeMaterials: true, tsl: true, compute: true, addons: new Set(["gltf-export", "ik", "mikkts"]) });
}
//# sourceMappingURL=capability-registry.js.map