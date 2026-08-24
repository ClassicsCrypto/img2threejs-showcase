import * as THREE from "three";
export function attachMicrodetail(geometry, spec) {
    const count = geometry.getAttribute("position")?.count ?? 0;
    const values = new Float32Array(count);
    let state = spec.seed >>> 0;
    for (let index = 0; index < count; index += 1) {
        state = (1664525 * state + 1013904223) >>> 0;
        values[index] = ((state / 0x100000000) - 0.5) * 2 * spec.amplitude;
    }
    geometry.setAttribute(`micro_${spec.channel}`, new THREE.Float32BufferAttribute(values, 1));
    geometry.userData.microdetail = { id: spec.id, channel: spec.channel, frequency: spec.frequency, seed: spec.seed };
}
//# sourceMappingURL=index.js.map