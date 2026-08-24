export function clampJointEuler(euler, constraint) {
    if (!constraint || constraint.type === "ball")
        return euler;
    const min = constraint.min ?? -Math.PI;
    const max = constraint.max ?? Math.PI;
    return [Math.min(max, Math.max(min, euler[0])), euler[1], euler[2]];
}
export function validateConstraints(constraints) {
    return constraints.flatMap((constraint) => {
        if (constraint.min !== undefined && constraint.max !== undefined && constraint.min > constraint.max)
            return [`${constraint.joint} has min > max`];
        return [];
    });
}
//# sourceMappingURL=index.js.map