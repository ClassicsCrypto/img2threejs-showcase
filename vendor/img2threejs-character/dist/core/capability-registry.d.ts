export type RendererBackend = "webgl" | "webgpu";
export interface CharacterRenderCapabilities {
    backend: RendererBackend;
    nodeMaterials: boolean;
    tsl: boolean;
    compute: boolean;
    addons: Set<string>;
}
export declare class CapabilityRegistry {
    private readonly capabilities;
    register(capabilities: CharacterRenderCapabilities): this;
    get(backend: RendererBackend): CharacterRenderCapabilities | undefined;
    require(backend: RendererBackend, feature?: keyof Omit<CharacterRenderCapabilities, "backend" | "addons">): CharacterRenderCapabilities;
    supports(backend: RendererBackend, feature: string): boolean;
    list(): CharacterRenderCapabilities[];
}
export declare function defaultCapabilities(): CapabilityRegistry;
