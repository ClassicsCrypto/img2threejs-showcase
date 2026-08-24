export function unionFields(...fields) {
    return { sample: (point) => Math.min(...fields.map((field) => field.sample(point))) };
}
export function sphereField(center, radius) {
    return { sample: ([x, y, z]) => Math.hypot(x - center[0], y - center[1], z - center[2]) - radius };
}
export function smoothUnion(a, b, k) {
    return { sample: (point) => { const da = a.sample(point); const db = b.sample(point); const h = Math.max(k - Math.abs(da - db), 0) / k; return Math.min(da, db) - (h * h * k) / 4; } };
}
//# sourceMappingURL=index.js.map