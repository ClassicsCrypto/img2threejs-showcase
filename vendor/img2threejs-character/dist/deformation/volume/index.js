export function volumeLoss(sample) {
    return sample.rest <= 0 ? 0 : Math.max(0, 1 - sample.posed / sample.rest);
}
export function passesVolumeGate(sample, maxLoss = 0.2) {
    return volumeLoss(sample) <= maxLoss;
}
//# sourceMappingURL=index.js.map