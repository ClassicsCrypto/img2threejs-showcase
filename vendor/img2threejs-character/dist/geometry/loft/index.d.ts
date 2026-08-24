import * as THREE from "three";
import type { AnatomicalLoft, CharacterCrossSection } from "../../ir/character-ir.js";
export interface LoftBuildResult {
    geometry: THREE.BufferGeometry;
    vertexCount: number;
    triangleCount: number;
    sectionCount: number;
    errors: string[];
}
/**
 * A deterministic semantic loft backend.  CharacterIR owns sections; this
 * adapter owns only BufferGeometry construction and never leaks Three.js types
 * back into the IR.
 */
export declare function buildAnatomicalLoft(loft: AnatomicalLoft, capEnds?: boolean): LoftBuildResult;
export declare function buildLoftWithAttributes(loft: AnatomicalLoft): THREE.BufferGeometry;
export declare function sectionAt(geometry: THREE.BufferGeometry, index: number): THREE.Vector3[];
export declare function sectionNormal(section: CharacterCrossSection): THREE.Vector3;
