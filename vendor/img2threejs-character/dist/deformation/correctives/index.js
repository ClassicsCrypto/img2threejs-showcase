export function correctiveWeight(corrective, driverValue) {
    if (driverValue <= corrective.threshold)
        return 0;
    return Math.min(corrective.maxWeight, (driverValue - corrective.threshold) / Math.max(0.0001, Math.PI - corrective.threshold));
}
//# sourceMappingURL=index.js.map