export type CharacterSubsystem = "Evidence" | "ShapeEngine" | "ContinuousSurfaceEngine" | "TopologyEngine" | "SurfaceEngine" | "AppearanceEngine" | "RigCompiler" | "DeformationEngine" | "FiberEngine" | "WearableEngine" | "RuntimeCompiler";
export declare function ownerForGate(gateId: string): CharacterSubsystem;
export declare function groupFailures(gateIds: string[]): Map<CharacterSubsystem, string[]>;
