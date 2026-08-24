export function constantField(id, value) {
    return { id, sample: () => value };
}
export function composeField(id, a, b, operation) {
    return { id, sample: (u, v, t) => { const left = a.sample(u, v, t); const right = b.sample(u, v, t); if (operation === "add")
            return left + right; if (operation === "multiply")
            return left * right; if (operation === "max")
            return Math.max(left, right); return Math.min(left, right); } };
}
//# sourceMappingURL=index.js.map