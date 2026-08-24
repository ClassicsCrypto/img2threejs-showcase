export function validateFiberRoots(definition) {
    const errors = [];
    const guideIds = new Set(definition.flow.guides.map((guide) => guide.id));
    for (const root of definition.flow.roots) {
        if (!root.emitter || !root.coordinate.region)
            errors.push(`${root.id} has no semantic emitter`);
        if (root.normalOffset < 0 || !Number.isFinite(root.normalOffset))
            errors.push(`${root.id} has invalid normal offset`);
        const guide = definition.flow.guides.find((candidate) => candidate.rootId === root.id);
        if (!guide || !guideIds.has(guide.id))
            errors.push(`${root.id} has no guide curve`);
    }
    return errors;
}
//# sourceMappingURL=index.js.map