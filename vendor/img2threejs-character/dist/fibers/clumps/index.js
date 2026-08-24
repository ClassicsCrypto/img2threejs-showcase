export function validateClumps(clumps, guideIds) {
    return clumps.flatMap((clump) => clump.guideIds.some((id) => !guideIds.has(id)) || clump.strandCount < 1 || clump.spread < 0 ? [`${clump.id} references invalid guides or clump parameters`] : []);
}
export function clumpGuideCount(clumps) {
    return new Set(clumps.flatMap((clump) => clump.guideIds)).size;
}
//# sourceMappingURL=index.js.map