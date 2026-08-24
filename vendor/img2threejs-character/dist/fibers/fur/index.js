export function createFurDefinition(id, emitter, materialId, roots) {
    const fiberRoots = roots.map((point, index) => ({ id: `${id}-root-${index}`, emitter, coordinate: { region: emitter, u: 0.5, v: 0.5, normalOffset: 0.002 }, normalOffset: 0.002 }));
    const guides = roots.map((point, index) => ({ id: `${id}-guide-${index}`, rootId: `${id}-root-${index}`, points: [point, [point[0], point[1] + 0.018, point[2]]], taper: 0.7 }));
    return { id, kind: "fur", materialId, representation: "tube", lod: [1, 0.35], flow: { emitter, roots: fiberRoots, directionalField: { id: `${id}-field`, type: "constant", parameters: { y: 1 } }, guides, clumps: [], modifiers: { gravity: 0.2, attraction: 0.4 } } };
}
//# sourceMappingURL=index.js.map