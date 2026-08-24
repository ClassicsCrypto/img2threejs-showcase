export function skinMaterial(id = "skin", baseColor = [0.64, 0.34, 0.22]) {
    return { id, semanticType: "skin", baseColor, roughness: 0.58, metalness: 0, backend: "physical", skin: { baseColor, roughness: 0.58, colorVariation: [0.03, 0.01, 0.005], thickness: 0.5 } };
}
//# sourceMappingURL=index.js.map