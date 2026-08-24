import type { CompiledCharacter } from "../compiler/character-compiler.js";
import { type GateResult } from "./gate.js";
export interface VisualRegionMetric {
    silhouetteIoU: number;
    referenceCrop?: [number, number, number, number];
    renderCrop?: [number, number, number, number];
}
export interface VisualViewEvidence {
    id: "front" | "three-quarter" | "side" | "rear";
    referencePath: string;
    renderPath: string;
    cameraProfileId: string;
    poseProfileId: string;
    silhouetteIoU: number;
    aspectRatioDelta: number;
    scaleDelta: number;
    regions: Record<string, VisualRegionMetric>;
}
export interface VisualEvidenceInput {
    fixedViewPath?: string;
    orbitViewPaths?: string[];
    comparisonSheetPath?: string;
    silhouetteIoU?: number;
    referenceHash?: string;
    renderHash?: string;
    views?: VisualViewEvidence[];
    thresholds?: {
        silhouetteIoU?: number;
        aspectRatioDelta?: number;
        scaleDelta?: number;
        regionSilhouetteIoU?: number;
    };
}
export declare function visualFidelityGate(_compiled: CompiledCharacter, evidence?: VisualEvidenceInput): GateResult;
