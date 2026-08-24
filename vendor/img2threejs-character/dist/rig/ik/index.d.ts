import * as THREE from "three";
import type { IKChain } from "../../ir/character-ir.js";
import type { SkeletonBuildResult } from "../skeleton/index.js";
export declare class CharacterIKController {
    private readonly skeleton;
    private readonly chains;
    private readonly targets;
    constructor(skeleton: SkeletonBuildResult, chains: IKChain[]);
    setTarget(id: string, target: THREE.Vector3): void;
    solve(iterations?: number): void;
}
