import * as THREE from "three";
import type { AppendageSpec } from "../../ir/character-ir.js";
export declare function buildTubeAppendage(spec: AppendageSpec, radius?: number, tubularSegments?: number): THREE.BufferGeometry;
export declare function buildAppendageGeometry(spec: AppendageSpec): THREE.BufferGeometry;
export declare function buildWingOrFin(spec: AppendageSpec): THREE.BufferGeometry;
