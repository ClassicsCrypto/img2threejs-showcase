export class DependencyGraph {
    nodes = new Map();
    add(node) {
        this.nodes.set(node.id, { ...node, dependsOn: [...node.dependsOn], produces: [...node.produces] });
        return this;
    }
    get(id) {
        return this.nodes.get(id);
    }
    invalidate(changed) {
        const invalidated = new Set([changed]);
        let grew = true;
        while (grew) {
            grew = false;
            for (const node of this.nodes.values()) {
                if (node.dependsOn.some((dependency) => invalidated.has(dependency)) && !invalidated.has(node.id)) {
                    invalidated.add(node.id);
                    grew = true;
                }
            }
        }
        const executionOrder = this.topologicalOrder().filter((id) => invalidated.has(id));
        return { changed, invalidated: [...invalidated], executionOrder };
    }
    topologicalOrder() {
        const remaining = new Map([...this.nodes].map(([id, node]) => [id, new Set(node.dependsOn)]));
        const output = [];
        while (remaining.size > 0) {
            const ready = [...remaining.entries()].filter(([, deps]) => [...deps].every((dep) => output.includes(dep) || !remaining.has(dep)));
            if (ready.length === 0)
                throw new Error("dependency graph contains a cycle");
            for (const [id] of ready) {
                output.push(id);
                remaining.delete(id);
            }
        }
        return output;
    }
}
export function defaultCharacterDependencies() {
    return new DependencyGraph()
        .add({ id: "evidence", dependsOn: [], produces: ["archetype", "landmarks", "proportions"] })
        .add({ id: "archetype", dependsOn: ["evidence"], produces: ["shape"] })
        .add({ id: "landmarks", dependsOn: ["evidence"], produces: ["shape", "face", "fibers"] })
        .add({ id: "proportions", dependsOn: ["evidence", "archetype"], produces: ["shape", "topology"] })
        .add({ id: "shape", dependsOn: ["archetype", "landmarks", "proportions"], produces: ["topology", "surface", "weights"] })
        .add({ id: "topology", dependsOn: ["shape"], produces: ["surface", "weights", "morphs"] })
        .add({ id: "surface", dependsOn: ["shape", "topology"], produces: ["materials", "features"] })
        .add({ id: "materials", dependsOn: ["surface"], produces: ["runtime", "visual"] })
        .add({ id: "weights", dependsOn: ["shape", "topology", "rig"], produces: ["runtime", "deformation"] })
        .add({ id: "rig", dependsOn: ["archetype", "proportions"], produces: ["weights", "deformation", "animation"] })
        .add({ id: "morphs", dependsOn: ["topology", "face"], produces: ["deformation", "runtime"] })
        .add({ id: "face", dependsOn: ["landmarks", "shape", "topology"], produces: ["morphs", "eyes"] })
        .add({ id: "fibers", dependsOn: ["shape", "surface"], produces: ["runtime", "visual"] })
        .add({ id: "wearables", dependsOn: ["shape", "rig", "surface"], produces: ["runtime", "visual"] })
        .add({ id: "deformation", dependsOn: ["weights", "rig", "morphs"], produces: ["runtime", "gates"] })
        .add({ id: "runtime", dependsOn: ["materials", "weights", "morphs", "fibers", "wearables", "deformation"], produces: ["gates", "export"] })
        .add({ id: "gates", dependsOn: ["runtime"], produces: [] })
        .add({ id: "export", dependsOn: ["runtime"], produces: [] });
}
//# sourceMappingURL=dependency-graph.js.map