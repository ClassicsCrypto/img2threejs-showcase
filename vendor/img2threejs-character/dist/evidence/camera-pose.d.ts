import * as THREE from "three";
import type { CameraEvidence, LandmarkEvidence, Vec3 } from "../ir/character-ir.js";
export interface SolvedCameraPose {
    camera: CameraEvidence;
    position: Vec3;
    target: Vec3;
    fovDegrees: number;
    residual: number;
}
/** A deterministic initial camera solve from landmark extents. A future
 * vision adapter can replace the estimates while preserving this contract. */
export declare function solveCameraPose(landmarks: LandmarkEvidence[], aspect?: number): SolvedCameraPose;
export declare function applyCameraEvidence(irCamera: CameraEvidence, camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): void;
