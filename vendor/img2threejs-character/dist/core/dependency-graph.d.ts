export interface DependencyNode {
    id: string;
    dependsOn: string[];
    produces: string[];
}
export interface InvalidationResult {
    changed: string;
    invalidated: string[];
    executionOrder: string[];
}
export declare class DependencyGraph {
    private readonly nodes;
    add(node: DependencyNode): this;
    get(id: string): DependencyNode | undefined;
    invalidate(changed: string): InvalidationResult;
    topologicalOrder(): string[];
}
export declare function defaultCharacterDependencies(): DependencyGraph;
