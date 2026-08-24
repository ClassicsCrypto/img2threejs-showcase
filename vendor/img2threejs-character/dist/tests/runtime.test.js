import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createHumanoidCharacterIR } from "../archetypes/humanoid/index.js";
import { compileCharacter } from "../compiler/character-compiler.js";
import { compileCharacterActions } from "../runtime/animation.js";
test("runtime exposes pose, morph, gaze and IK hooks", () => {
    const compiled = compileCharacter(createHumanoidCharacterIR({ name: "Runtime test" }));
    compiled.runtime.pose.setJoint("left-elbow", new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 3));
    assert.ok(compiled.runtime.pose.getJoint("left-elbow").angleTo(new THREE.Quaternion()) > 0.1);
    compiled.runtime.morph.set("smile", 0.7);
    assert.equal(compiled.runtime.morphs.get("smile"), 0.7);
    compiled.runtime.gaze?.lookAt(new THREE.Vector3(0, 1, 2));
    compiled.runtime.ik.setTarget("left-hand-target", new THREE.Vector3(0.25, 0.75, 0.2));
    compiled.runtime.ik.solve();
    compiled.runtime.update(1 / 60);
});
test("declarative actions compile to looping, returning and clamped mixer actions", () => {
    const root = new THREE.Group();
    root.name = "test-character";
    const joint = new THREE.Bone();
    joint.name = "chest";
    root.add(joint);
    const compiled = compileCharacterActions(root, [
        {
            id: "idle", label: "Idle", duration: 1, loop: true, expose: false,
            tracks: [{ target: "chest", property: "rotation", times: [0, 1], values: [[0, 0, 0], [0, 0, 0]] }],
        },
        {
            id: "attack", label: "Attack", duration: 0.2, loop: false, returnToDefault: true,
            tracks: [{ target: "chest", property: "rotation", times: [0, 0.2], values: [[0, 0, 0], [0, 0.3, 0]] }],
        },
        {
            id: "died", label: "Died", duration: 0.2, loop: false,
            tracks: [{ target: "test-character", property: "position", times: [0, 0.2], values: [[0, 0, 0], [0, -0.1, 0]] }],
        },
    ]);
    assert.deepEqual(compiled.controller.actions.map((action) => action.id), ["attack", "died"]);
    compiled.controller.play("attack");
    for (let frame = 0; frame < 5; frame += 1)
        compiled.controller.update(0.05);
    assert.equal(compiled.controller.active, "idle");
    compiled.controller.play("died");
    for (let frame = 0; frame < 5; frame += 1)
        compiled.controller.update(0.05);
    assert.equal(compiled.controller.active, "died");
    compiled.controller.stop();
    assert.equal(compiled.controller.active, "idle");
});
//# sourceMappingURL=runtime.test.js.map