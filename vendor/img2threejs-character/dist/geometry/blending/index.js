export function smoothstep(edge0, edge1, value) {
    const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0 || 1)));
    return t * t * (3 - 2 * t);
}
export function blend(a, b, weight) {
    return a * (1 - weight) + b * weight;
}
//# sourceMappingURL=index.js.map