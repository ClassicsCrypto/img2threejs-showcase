import * as THREE from "three";
import { fail, pass, warn } from "./gate.js";
export function deformationGates(compiled) {
    const results = [];
    results.push(probePose(compiled, "DEF-SHOULDER-RAISE", "left-shoulder", Math.PI / 4, new THREE.Vector3(0, 0, 1)));
    results.push(probePose(compiled, "DEF-ELBOW-45", "left-elbow", Math.PI / 4, new THREE.Vector3(1, 0, 0)));
    results.push(probePose(compiled, "DEF-ELBOW-90", "left-elbow", Math.PI / 2, new THREE.Vector3(1, 0, 0)));
    results.push(probePose(compiled, "DEF-ELBOW-135", "left-elbow", Math.PI * 0.75, new THREE.Vector3(1, 0, 0)));
    const twistSystems = compiled.ir.deformationGraph?.twistDistribution ?? [];
    results.push(twistSystems.length ? probePose(compiled, "DEF-FOREARM-TWIST", twistSystems[0].targetJoints[0] ?? "left-wrist", Math.PI / 2, new THREE.Vector3(0, 1, 0)) : warn("DEF-FOREARM-TWIST", { twistSystems: 0 }, "No semantic twist system was supplied by this archetype."));
    results.push(probePose(compiled, "DEF-HIP-FLEX", "left-hip", Math.PI / 3, new THREE.Vector3(1, 0, 0)));
    results.push(probePose(compiled, "DEF-KNEE-90", "left-knee", Math.PI / 2, new THREE.Vector3(1, 0, 0)));
    results.push(probePose(compiled, "DEF-ANKLE", "left-ankle", Math.PI / 6, new THREE.Vector3(1, 0, 0)));
    results.push(compiled.runtime.joints.has("left-finger") ? probePose(compiled, "DEF-FINGER-CURL", "left-finger", Math.PI / 3, new THREE.Vector3(1, 0, 0)) : warn("DEF-FINGER-CURL", { fingerJoints: 0 }, "The active blockout archetype has no explicit finger chain."));
    const expectedMorphs = compiled.ir.morphGraph?.definitions.length ?? 0;
    results.push(compiled.runtime.morphs instanceof Map && compiled.runtime.morphs.size === expectedMorphs ? pass("DEF-MORPH-REGISTRY", { morphs: compiled.runtime.morphs.size }, [{ kind: "runtime", ref: "CharacterRuntime.morph" }]) : fail("DEF-MORPH-REGISTRY", ["runtime morph registry does not match CharacterIR definitions"], ["MorphCompiler: register every semantic morph before runtime compilation"], { expectedMorphs, actualMorphs: compiled.runtime.morphs.size }));
    return results;
}
function probePose(compiled, gateId, jointId, angle, axis) {
    const joint = compiled.runtime.joints.get(jointId);
    if (!joint)
        return warn(gateId, { supported: 0 }, `Joint ${jointId} is not present in this archetype.`);
    const original = joint.quaternion.clone();
    joint.quaternion.setFromAxisAngle(axis, angle);
    compiled.runtime.update(0);
    let valid = true;
    let sampledVertices = 0;
    try {
        for (const mesh of compiled.bodyMeshes.values()) {
            const position = mesh.geometry.getAttribute("position");
            if (!position) {
                valid = false;
                continue;
            }
            const sample = new THREE.Vector3();
            for (let index = 0; index < position.count; index += 1) {
                mesh.getVertexPosition(index, sample);
                sampledVertices += 1;
                if (![sample.x, sample.y, sample.z].every(Number.isFinite))
                    valid = false;
            }
        }
    }
    catch {
        valid = false;
    }
    joint.quaternion.copy(original);
    compiled.runtime.update(0);
    return valid
        ? pass(gateId, { angle, sampledVertices }, [{ kind: "runtime", ref: "CharacterRuntime.pose" }])
        : fail(gateId, ["posed skinned vertices contain invalid data"], ["DeformationEngine: inspect weights, bind inverses and corrective deformation"], { angle, sampledVertices });
}
//# sourceMappingURL=deformation-gates.js.map