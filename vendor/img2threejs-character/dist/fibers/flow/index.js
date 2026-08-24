export function sampleFiberField(field, point) {
    const { parameters } = field;
    if (field.type === "constant")
        return [parameters.x ?? 0, parameters.y ?? 1, parameters.z ?? 0];
    if (field.type === "radial") {
        const center = [parameters.cx ?? 0, parameters.cy ?? 0, parameters.cz ?? 0];
        const dx = point[0] - center[0];
        const dy = point[1] - center[1];
        const dz = point[2] - center[2];
        const length = Math.hypot(dx, dy, dz) || 1;
        return [dx / length, dy / length, dz / length];
    }
    return [
        (parameters.x ?? 0) + (parameters.xSlope ?? 0) * point[0],
        (parameters.y ?? 1) + (parameters.ySlope ?? 0) * point[1],
        (parameters.z ?? 0) + (parameters.zSlope ?? 0) * point[2],
    ];
}
export function validateFiberField(field) {
    return field.id && field.type ? [] : ["fiber directional field needs an id and type"];
}
//# sourceMappingURL=index.js.map