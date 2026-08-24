import type { RigDriver } from "../../ir/character-ir.js";
export declare function evaluateResponse(response: Array<[number, number]>, input: number): number;
export declare function driverMap(drivers: RigDriver[], source: string, value: number): Map<string, number>;
