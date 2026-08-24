import * as THREE from "three";
export class CharacterAnimationRuntime {
    mixer;
    constructor(root) {
        this.mixer = new THREE.AnimationMixer(root);
    }
    play(clip, fadeSeconds = 0.15) {
        const action = this.mixer.clipAction(clip);
        action.reset().fadeIn(fadeSeconds).play();
        return action;
    }
    update(deltaSeconds) {
        this.mixer.update(deltaSeconds);
    }
    stopAll() {
        this.mixer.stopAllAction();
    }
}
/**
 * Compile plain tuple tracks into an AnimationMixer-backed controller. The
 * default action is normally a subtle idle loop; one-shots can either return
 * to it or clamp on their final frame (for example a death pose).
 */
export function compileCharacterActions(root, specs, defaultActionId = "idle", fadeSeconds = 0.14) {
    const byId = new Map(specs.map((spec) => [spec.id, spec]));
    if (byId.size !== specs.length)
        throw new Error("character action ids must be unique");
    if (!byId.has(defaultActionId))
        throw new Error(`default character action is missing: ${defaultActionId}`);
    const clips = new Map();
    for (const spec of specs) {
        if (!(spec.duration > 0))
            throw new Error(`character action ${spec.id} has a non-positive duration`);
        const tracks = spec.tracks.map((track) => compileTrack(spec.id, track));
        clips.set(spec.id, new THREE.AnimationClip(spec.id, spec.duration, tracks));
    }
    root.animations = [...clips.values()];
    const mixer = new THREE.AnimationMixer(root);
    const mixerActions = new Map();
    for (const spec of specs) {
        const action = mixer.clipAction(clips.get(spec.id));
        if (spec.loop)
            action.setLoop(THREE.LoopRepeat, Infinity);
        else {
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = true;
        }
        mixerActions.set(spec.id, action);
    }
    const listeners = new Set();
    let active = defaultActionId;
    let current = mixerActions.get(defaultActionId);
    let remaining = 0;
    current.reset().setEffectiveWeight(1).play();
    const notify = () => listeners.forEach((listener) => listener(active));
    const transition = (nextId, duration) => {
        const nextSpec = byId.get(nextId);
        const next = mixerActions.get(nextId);
        if (!nextSpec || !next)
            throw new Error(`unknown character action: ${nextId}`);
        const transitionDuration = duration ?? nextSpec.fadeSeconds ?? fadeSeconds;
        if (transitionDuration < 0)
            throw new Error(`character action ${nextId} has a negative fade duration`);
        if (next === current && nextId === active)
            return;
        next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
        current.crossFadeTo(next, transitionDuration, false);
        current = next;
        active = nextId;
        remaining = !nextSpec.loop && nextSpec.returnToDefault ? nextSpec.duration : 0;
        notify();
    };
    const controller = {
        actions: specs
            .filter((spec) => spec.id !== defaultActionId && spec.expose !== false)
            .map(({ id, label, loop }) => ({ id, label, loop })),
        get active() { return active; },
        play: (name) => transition(name),
        stop: () => transition(defaultActionId, Math.min(fadeSeconds, 0.12)),
        update: (deltaSeconds) => {
            const safeDelta = Math.min(0.05, Math.max(0, deltaSeconds));
            mixer.update(safeDelta);
            if (remaining <= 0 || safeDelta <= 0)
                return;
            remaining -= safeDelta;
            if (remaining <= 0)
                transition(defaultActionId);
        },
        subscribe: (listener) => {
            listeners.add(listener);
            listener(active);
            return () => listeners.delete(listener);
        },
    };
    return { clips, mixer, controller };
}
function compileTrack(actionId, track) {
    if (track.times.length !== track.values.length || track.times.length < 2) {
        throw new Error(`character action ${actionId} track ${track.target}.${track.property} has mismatched samples`);
    }
    for (let index = 1; index < track.times.length; index += 1) {
        if (track.times[index] <= track.times[index - 1]) {
            throw new Error(`character action ${actionId} track times must be strictly increasing`);
        }
    }
    if (track.property === "position") {
        return new THREE.VectorKeyframeTrack(`${track.target}.position`, [...track.times], track.values.flatMap((value) => [...value]));
    }
    const values = track.values.flatMap(([x, y, z]) => {
        const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, "XYZ"));
        return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
    });
    return new THREE.QuaternionKeyframeTrack(`${track.target}.quaternion`, [...track.times], values);
}
//# sourceMappingURL=animation.js.map