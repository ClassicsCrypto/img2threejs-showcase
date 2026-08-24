import * as THREE from "three";
import { clampJointEuler } from "../rig/constraints/index.js";
import { CharacterAnimationRuntime } from "./animation.js";
export class CharacterRuntime {
    root;
    meshes;
    skeletonBuild;
    eyeRuntime;
    ikController;
    ir;
    joints;
    morphs = new Map();
    materials;
    animation;
    pose;
    morph;
    ik;
    gaze;
    appearance;
    variant = "default";
    constructor(root, meshes, skeletonBuild, materials, eyeRuntime, ikController, ir) {
        this.root = root;
        this.meshes = meshes;
        this.skeletonBuild = skeletonBuild;
        this.eyeRuntime = eyeRuntime;
        this.ikController = ikController;
        this.ir = ir;
        this.joints = skeletonBuild.bones;
        this.materials = materials;
        this.animation = new CharacterAnimationRuntime(root);
        this.pose = {
            reset: () => { this.skeletonBuild.skeleton.pose(); this.skeletonBuild.root.updateMatrixWorld(true); },
            applyProfile: (name) => {
                const profile = this.ir?.runtimeGraph.poseProfiles.find((candidate) => candidate.id === name);
                if (!profile)
                    throw new Error(`unknown pose profile: ${name}`);
                this.skeletonBuild.skeleton.pose();
                for (const [joint, rotation] of Object.entries(profile.joints))
                    this.pose.setJoint(joint, new THREE.Quaternion(...rotation));
                this.skeletonBuild.root.updateMatrixWorld(true);
                this.skeletonBuild.skeleton.update();
            },
            setJoint: (joint, rotation) => {
                const bone = this.joints.get(joint);
                if (!bone)
                    throw new Error(`unknown joint: ${joint}`);
                const euler = new THREE.Euler().setFromQuaternion(rotation, "XYZ");
                const constraint = this.ir?.rigGraph?.constraints.find((candidate) => candidate.joint === joint);
                const clamped = clampJointEuler([euler.x, euler.y, euler.z], constraint);
                bone.rotation.set(clamped[0], clamped[1], clamped[2], "XYZ");
                bone.updateMatrixWorld(true);
            },
            getJoint: (joint) => { const bone = this.joints.get(joint); if (!bone)
                throw new Error(`unknown joint: ${joint}`); return bone.quaternion.clone(); },
        };
        this.morph = { set: (name, weight) => this.setMorph(name, weight) };
        this.ik = { setTarget: (name, target) => this.ikController?.setTarget(name, target), solve: () => this.ikController?.solve() };
        if (eyeRuntime)
            this.gaze = { lookAt: (target) => eyeRuntime.lookAt(target) };
        this.appearance = { setVariant: (name) => this.setVariant(name) };
        for (const definition of ir?.morphGraph?.definitions ?? [])
            this.morphs.set(definition.id, 0);
    }
    update(dt) {
        this.skeletonBuild.root.updateMatrixWorld(true);
        this.skeletonBuild.skeleton.update();
        this.animation.update(dt);
        this.applyMorphDrivers();
    }
    dispose() {
        this.animation.stopAll();
        this.root.traverse((object) => {
            const mesh = object;
            if (mesh.geometry)
                mesh.geometry.dispose();
            const material = mesh.material;
            if (Array.isArray(material))
                material.forEach((item) => item.dispose());
            else
                material?.dispose();
        });
        this.meshes.clear();
        this.materials.clear();
    }
    setMorph(name, weight) {
        const clamped = Math.min(1, Math.max(0, weight));
        this.morphs.set(name, clamped);
        this.meshes.forEach((object) => {
            const mesh = object;
            if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
                const index = mesh.morphTargetDictionary[name];
                if (index !== undefined)
                    mesh.morphTargetInfluences[index] = clamped;
            }
        });
        if (name === "blink-left" || name === "blink-right")
            this.eyeRuntime?.setBlink(clamped);
    }
    applyMorphDrivers() {
        for (const definition of this.ir?.morphGraph?.definitions ?? []) {
            if (!definition.driver)
                continue;
            const jointId = definition.driver.split(".")[0];
            const joint = this.joints.get(jointId);
            if (!joint)
                continue;
            this.setMorph(definition.id, Math.min(1, joint.quaternion.angleTo(new THREE.Quaternion()) / Math.PI));
        }
    }
    setVariant(name) {
        this.variant = name;
        const variants = this.ir?.appearanceGraph.variants[name];
        if (!variants)
            return;
        for (const [materialId, patch] of Object.entries(variants)) {
            const material = this.materials.get(materialId);
            if (!material)
                continue;
            if (patch.roughness !== undefined)
                material.roughness = patch.roughness;
            if (patch.metalness !== undefined)
                material.metalness = patch.metalness;
            if (patch.baseColor)
                material.color.setRGB(patch.baseColor[0], patch.baseColor[1], patch.baseColor[2]);
        }
    }
    get activeVariant() { return this.variant; }
}
//# sourceMappingURL=character-runtime.js.map