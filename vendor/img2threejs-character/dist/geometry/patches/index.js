export function bilinearPatch(corners, u, v) {
    const [a, b, c, d] = corners;
    const position = [
        (1 - u) * (1 - v) * a[0] + u * (1 - v) * b[0] + u * v * c[0] + (1 - u) * v * d[0],
        (1 - u) * (1 - v) * a[1] + u * (1 - v) * b[1] + u * v * c[1] + (1 - u) * v * d[1],
        (1 - u) * (1 - v) * a[2] + u * (1 - v) * b[2] + u * v * c[2] + (1 - u) * v * d[2],
    ];
    const du = new Float32Array([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const dv = new Float32Array([d[0] - a[0], d[1] - a[1], d[2] - a[2]]);
    const normal = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]];
    return { u, v, position, normal };
}
//# sourceMappingURL=index.js.map