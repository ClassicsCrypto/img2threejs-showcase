export function ellipseContour(count = 16) {
    return Array.from({ length: Math.max(3, count) }, (_, index) => {
        const angle = (index / Math.max(3, count)) * Math.PI * 2;
        return [Math.cos(angle), Math.sin(angle)];
    });
}
export function makeCrossSection(center, width, depth, t, count = 16) {
    return { t, center, width, depth, contour: ellipseContour(count), orientation: [0, 0, 0, 1], landmarks: [], anatomicalInfluences: [] };
}
export function validateCrossSections(sections) {
    const errors = [];
    if (sections.length < 2)
        errors.push("a loft needs at least two cross-sections");
    let previous = -Infinity;
    for (const [index, section] of sections.entries()) {
        if (!Number.isFinite(section.t) || section.t < previous)
            errors.push(`section ${index} has non-monotonic t`);
        if (section.width <= 0 || section.depth <= 0)
            errors.push(`section ${index} has non-positive dimensions`);
        if (section.contour.length < 3)
            errors.push(`section ${index} has fewer than three contour points`);
        previous = section.t;
    }
    const count = sections[0]?.contour.length;
    if (count && sections.some((section) => section.contour.length !== count))
        errors.push("loft sections must have equal contour point counts");
    return errors;
}
export function mirrorSection(section) {
    return {
        ...section,
        center: [-section.center[0], section.center[1], section.center[2]],
        contour: section.contour.map(([x, z]) => [-x, z]),
        asymmetry: section.asymmetry ? { lateralBias: -section.asymmetry.lateralBias, depthBias: section.asymmetry.depthBias } : undefined,
    };
}
//# sourceMappingURL=index.js.map