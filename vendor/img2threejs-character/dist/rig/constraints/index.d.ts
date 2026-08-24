import type { JointConstraint, Vec3 } from "../../ir/character-ir.js";
export declare function clampJointEuler(euler: Vec3, constraint?: JointConstraint): Vec3;
export declare function validateConstraints(constraints: JointConstraint[]): string[];
