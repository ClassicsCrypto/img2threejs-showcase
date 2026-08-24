export function compileDeformation(graph) {
    return { skinningStrategy: graph?.skinning.strategy ?? "semantic-region", correctives: graph?.jointCorrectives.map((item) => item.id) ?? [], surfaceFollowers: graph?.surfaceFollowers.map((item) => item.featureId) ?? [] };
}
//# sourceMappingURL=deformation-compiler.js.map