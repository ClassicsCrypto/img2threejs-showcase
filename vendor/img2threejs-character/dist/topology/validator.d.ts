import * as THREE from "three";
import type { TopologyGraph } from "../ir/character-ir.js";
export interface TopologyValidation {
    errors: string[];
    warnings: string[];
    vertexCount: number;
    triangleCount: number;
    degenerateTriangles: number;
    finite: boolean;
    boundaryEdges: number;
    nonManifoldEdges: number;
}
export declare function validateBufferGeometry(geometry: THREE.BufferGeometry, topology?: TopologyGraph): TopologyValidation;
export declare function addSemanticRegionAttribute(geometry: THREE.BufferGeometry, regionId: number): void;
export declare function addDeformationMaskAttribute(geometry: THREE.BufferGeometry, value?: number): void;
export declare function topologySummary(geometry: THREE.BufferGeometry): Record<string, number>;
