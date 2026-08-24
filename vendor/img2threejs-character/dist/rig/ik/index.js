import * as THREE from "three";
export class CharacterIKController {
    skeleton;
    chains;
    targets = new Map();
    constructor(skeleton, chains) {
        this.skeleton = skeleton;
        this.chains = chains;
    }
    setTarget(id, target) {
        this.targets.set(id, target.clone());
    }
    solve(iterations = 4) {
        for (const chain of this.chains) {
            const target = this.targets.get(chain.target);
            if (!target)
                continue;
            const joints = chain.joints.map((id) => this.skeleton.bones.get(id)).filter((bone) => Boolean(bone));
            const effector = this.skeleton.bones.get(chain.effector);
            if (!effector || joints.length < 2)
                continue;
            for (let iteration = 0; iteration < iterations; iteration += 1) {
                for (let index = joints.length - 2; index >= 0; index -= 1) {
                    const joint = joints[index];
                    const jointPosition = joint.getWorldPosition(new THREE.Vector3());
                    const effectorPosition = effector.getWorldPosition(new THREE.Vector3());
                    const toEffector = effectorPosition.sub(jointPosition).normalize();
                    const toTarget = target.clone().sub(jointPosition).normalize();
                    if (toEffector.lengthSq() === 0 || toTarget.lengthSq() === 0)
                        continue;
                    const rotation = new THREE.Quaternion().setFromUnitVectors(toEffector, toTarget);
                    joint.quaternion.premultiply(rotation);
                    joint.updateMatrixWorld(true);
                }
            }
        }
        this.skeleton.root.updateMatrixWorld(true);
    }
}
//# sourceMappingURL=index.js.map