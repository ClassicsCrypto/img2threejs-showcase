import * as THREE from "three";
import type { SemanticSurfaceCoordinate, SurfaceGraph } from "../../ir/character-ir.js";
export declare function coordinateToUv(coordinate: SemanticSurfaceCoordinate): THREE.Vector2;
export declare function validateSemanticCoordinates(graph: SurfaceGraph): string[];
export declare function ensureUv(geometry: THREE.BufferGeometry): void;
