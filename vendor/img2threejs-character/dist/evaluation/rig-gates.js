import { validateWeights } from "../rig/weights/index.js";
import { validateConstraints } from "../rig/constraints/index.js";
import { fail, pass } from "./gate.js";
export function rigGates(compiled) {
    const results = [];
    const skeleton = compiled.skeleton.skeleton;
    results.push(skeleton.bones.length > 0 && skeleton.bones.some((bone) => !bone.parent || bone.parent.type === "Bone") ? pass("RIG-HIERARCHY", { bones: skeleton.bones.length }, [{ kind: "runtime", ref: "Skeleton.bones" }]) : fail("RIG-HIERARCHY", ["skeleton hierarchy is empty or malformed"], ["RigCompiler: rebuild Bone/Skeleton hierarchy"]));
    const weightErrors = [...compiled.bodyMeshes.values()].flatMap((mesh) => validateWeights(mesh.geometry));
    results.push(weightErrors.length ? fail("RIG-WEIGHT-SUM", weightErrors.slice(0, 10), ["SkinningEngine: normalize semantic-region weights"], { weightErrors: weightErrors.length }, { maxWeightErrors: 0 }) : pass("RIG-WEIGHT-SUM", { meshes: compiled.bodyMeshes.size }, [{ kind: "geometry", ref: "skinIndex+skinWeight" }]));
    const weightRangeErrors = [];
    for (const [region, mesh] of compiled.bodyMeshes) {
        const weights = mesh.geometry.getAttribute("skinWeight");
        const indices = mesh.geometry.getAttribute("skinIndex");
        if (weights)
            for (let vertex = 0; vertex < weights.count; vertex += 1) {
                for (const value of [weights.getX(vertex), weights.getY(vertex), weights.getZ(vertex), weights.getW(vertex)]) {
                    if (!Number.isFinite(value) || value < 0 || value > 1)
                        weightRangeErrors.push(`${region}: skinWeight outside [0,1]`);
                }
            }
        if (indices)
            for (let vertex = 0; vertex < indices.count; vertex += 1) {
                for (const value of [indices.getX(vertex), indices.getY(vertex), indices.getZ(vertex), indices.getW(vertex)]) {
                    if (value < 0 || value >= skeleton.bones.length)
                        weightRangeErrors.push(`${region}: skinIndex ${value} is outside skeleton`);
                }
            }
    }
    results.push(weightRangeErrors.length ? fail("RIG-WEIGHT-RANGE", weightRangeErrors.slice(0, 10), ["SkinningEngine: clamp indices and normalize weight attributes"], { errors: weightRangeErrors.length }) : pass("RIG-WEIGHT-RANGE", { meshes: compiled.bodyMeshes.size }, [{ kind: "geometry", ref: "skinIndex+skinWeight" }]));
    results.push(skeleton.boneInverses.length === skeleton.bones.length ? pass("RIG-BIND-POSE", { inverses: skeleton.boneInverses.length }, [{ kind: "runtime", ref: "Skeleton.boneInverses" }]) : fail("RIG-BIND-POSE", ["bone inverse count does not match bones"], ["RigCompiler: call calculateInverses after hierarchy construction"]));
    const axisErrors = (compiled.ir.rigGraph?.joints ?? []).flatMap((joint) => {
        if (!joint.axis || joint.axis.some((value) => !Number.isFinite(value)) || joint.axis.every((value) => Math.abs(value) < 1e-8))
            return [`${joint.id} has no usable joint axis`];
        return [];
    });
    results.push(axisErrors.length ? fail("RIG-BONE-AXES", axisErrors, ["RigCompiler: define a finite non-zero axis for every articulated joint"], { errors: axisErrors.length }) : pass("RIG-BONE-AXES", { joints: skeleton.bones.length }, [{ kind: "ir", ref: "rigGraph.joints.axis" }]));
    const restErrors = [...skeleton.bones.values()].flatMap((bone) => [bone.position.x, bone.position.y, bone.position.z].every(Number.isFinite) ? [] : [`${bone.name} rest position is non-finite`]);
    results.push(restErrors.length ? fail("RIG-REST-POSE", restErrors, ["RigCompiler: rebuild finite rest joint transforms"], { errors: restErrors.length }) : pass("RIG-REST-POSE", { joints: skeleton.bones.length }, [{ kind: "runtime", ref: "Skeleton.bones.restTransform" }]));
    const constraintErrors = validateConstraints(compiled.ir.rigGraph?.constraints ?? []);
    results.push(constraintErrors.length ? fail("RIG-CONSTRAINTS", constraintErrors, ["RigCompiler: repair joint limit ranges"], { errors: constraintErrors.length }) : pass("RIG-CONSTRAINTS", { constraints: compiled.ir.rigGraph?.constraints.length ?? 0 }, [{ kind: "ir", ref: "rigGraph.constraints" }]));
    const ikErrors = (compiled.ir.rigGraph?.ikChains ?? []).flatMap((chain) => {
        const missing = chain.joints.filter((joint) => !compiled.skeleton.bones.has(joint));
        if (!compiled.skeleton.bones.has(chain.effector) || missing.length)
            return [`${chain.id} references missing joints: ${[...missing, chain.effector].filter((id) => !compiled.skeleton.bones.has(id)).join(", ")}`];
        return [];
    });
    results.push(ikErrors.length ? fail("RIG-IK-TARGET", ikErrors, ["RigCompiler: bind IK effectors to the compiled skeleton"], { errors: ikErrors.length }) : pass("RIG-IK-TARGET", { chains: compiled.ir.rigGraph?.ikChains.length ?? 0 }, [{ kind: "ir", ref: "rigGraph.ikChains" }]));
    return results;
}
//# sourceMappingURL=rig-gates.js.map