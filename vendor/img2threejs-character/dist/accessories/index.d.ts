import * as THREE from "three";
import type { AccessoryGraph, AccessorySpec } from "../ir/character-ir.js";
import type { SkeletonBuildResult } from "../rig/skeleton/index.js";
export interface AccessoryBuildResult {
    group: THREE.Group;
    items: Map<string, THREE.Object3D>;
    attachedCount: number;
    unboundJointIds: string[];
}
/** Compile declarative, rigid character details and attach them in bone-local space. */
export declare function compileAccessories(graph: AccessoryGraph | undefined, materials: Map<string, THREE.MeshPhysicalMaterial>, skeleton: SkeletonBuildResult): AccessoryBuildResult;
export declare function buildAccessoryGeometry(spec: AccessorySpec): THREE.BufferGeometry;
