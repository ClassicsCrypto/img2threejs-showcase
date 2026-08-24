import * as THREE from "three";
import type { CharacterIR, SemanticSurfaceCoordinate } from "../ir/character-ir.js";
export interface SurfaceCoordinateResolver {
    resolve(coordinate: SemanticSurfaceCoordinate, fallback?: THREE.Vector3): THREE.Vector3;
}
export declare function createSurfaceCoordinateResolver(ir: CharacterIR, meshes: Map<string, THREE.Object3D>): SurfaceCoordinateResolver;
export declare function registerCoordinate(ir: CharacterIR, id: string, coordinate: SemanticSurfaceCoordinate): void;
