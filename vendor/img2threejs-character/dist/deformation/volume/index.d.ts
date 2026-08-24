export interface VolumeSample {
    rest: number;
    posed: number;
}
export declare function volumeLoss(sample: VolumeSample): number;
export declare function passesVolumeGate(sample: VolumeSample, maxLoss?: number): boolean;
