import * as THREE from "three";
import { sampleEmitterSurface } from "../index.js";
export function distributeEmitterRoots(mesh, count, seed = 17) {
    return sampleEmitterSurface(mesh, count, seed).map((point) => new THREE.Vector3(...point));
}
//# sourceMappingURL=index.js.map