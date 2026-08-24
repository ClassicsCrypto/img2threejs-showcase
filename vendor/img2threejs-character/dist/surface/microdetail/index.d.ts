import * as THREE from "three";
export interface MicrodetailSpec {
    id: string;
    channel: "normal" | "height" | "roughness" | "mask";
    amplitude: number;
    frequency: number;
    seed: number;
}
export declare function attachMicrodetail(geometry: THREE.BufferGeometry, spec: MicrodetailSpec): void;
