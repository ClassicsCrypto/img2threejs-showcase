import * as THREE from "three";
import type { TwistSystem } from "../../ir/character-ir.js";
export declare function distributeTwist(system: TwistSystem, source: THREE.Quaternion, targets: Map<string, THREE.Bone>): void;
