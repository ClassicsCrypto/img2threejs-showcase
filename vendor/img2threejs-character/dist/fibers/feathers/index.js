export function createFeatherDefinition(id, emitter, materialId, roots) {
    const fiberRoots = roots.map((point, index) => ({ id: `${id}-root-${index}`, emitter, coordinate: { region: emitter, u: 0.5, v: 0.5, normalOffset: 0.004 }, normalOffset: 0.004 }));
    const guides = roots.map((point, index) => ({ id: `${id}-guide-${index}`, rootId: `${id}-root-${index}`, points: [point, [point[0], point[1] + 0.04, point[2] + 0.015]], taper: 0.45 }));
    return { id, kind: "feather", materialId, representation: "ribbon", lod: [1, 0.4], flow: { emitter, roots: fiberRoots, directionalField: { id: `${id}-field`, type: "linear", parameters: { y: 1, zSlope: 0.2 } }, guides, clumps: [], modifiers: { gravity: 0.1, spread: 0.2 } } };
}
//# sourceMappingURL=index.js.map