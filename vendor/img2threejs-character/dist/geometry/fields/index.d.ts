export interface ScalarField {
    id: string;
    sample(u: number, v: number, t: number): number;
}
export declare function constantField(id: string, value: number): ScalarField;
export declare function composeField(id: string, a: ScalarField, b: ScalarField, operation: "add" | "multiply" | "max" | "min"): ScalarField;
