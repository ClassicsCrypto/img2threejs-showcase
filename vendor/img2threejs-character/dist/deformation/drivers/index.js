export function evaluateResponse(response, input) {
    if (response.length === 0)
        return 0;
    const sorted = [...response].sort((a, b) => a[0] - b[0]);
    if (input <= sorted[0][0])
        return sorted[0][1];
    if (input >= sorted[sorted.length - 1][0])
        return sorted[sorted.length - 1][1];
    for (let index = 0; index < sorted.length - 1; index += 1) {
        const [x0, y0] = sorted[index];
        const [x1, y1] = sorted[index + 1];
        if (input >= x0 && input <= x1) {
            const t = (input - x0) / (x1 - x0 || 1);
            return y0 * (1 - t) + y1 * t;
        }
    }
    return 0;
}
export function driverMap(drivers, source, value) {
    return new Map(drivers.filter((driver) => driver.source === source).map((driver) => [driver.target, evaluateResponse(driver.response, value)]));
}
//# sourceMappingURL=index.js.map