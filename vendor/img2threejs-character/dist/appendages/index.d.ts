import * as THREE from "three";
import type { AppendageGraph } from "../ir/character-ir.js";
export declare function compileAppendages(graph: AppendageGraph | undefined, materials: Map<string, THREE.MeshPhysicalMaterial>): THREE.Group;
