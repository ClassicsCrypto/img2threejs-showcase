import * as THREE from "three";
import { MeshSurfaceSampler } from "three/addons/math/MeshSurfaceSampler.js";
import { validateFiberRoots } from "./roots/index.js";
import { validateGuides } from "./guides/index.js";
import { validateClumps } from "./clumps/index.js";
import { buildFiberGeometry } from "./strands/index.js";
export function sampleEmitterSurface(mesh, count, seed = 17) {
    const sampler = new MeshSurfaceSampler(mesh).build();
    let state = seed >>> 0;
    const next = () => { state = (1664525 * state + 1013904223) >>> 0; return state / 0x100000000; };
    const result = [];
    for (let index = 0; index < count; index += 1) {
        const point = new THREE.Vector3();
        sampler.sample(point);
        point.x += (next() - 0.5) * 0.002;
        result.push([point.x, point.y, point.z]);
    }
    return result;
}
export function compileFibers(ir, materials, bodyMeshes) {
    const group = new THREE.Group();
    group.name = "fibers";
    let rootCount = 0;
    let guideCount = 0;
    let clumpCount = 0;
    let anisotropicMaterials = 0;
    const rootAttachmentErrors = [];
    for (const definition of ir.fiberGraph?.definitions ?? []) {
        const result = compileFiber(definition, materials.get(definition.materialId) ?? new THREE.MeshPhysicalMaterial({ color: 0x160b06, roughness: 0.38, anisotropy: 0.65 }), bodyMeshes);
        group.add(result.group);
        rootCount += result.rootCount;
        guideCount += result.guideCount;
        clumpCount += result.clumpCount;
        rootAttachmentErrors.push(...result.rootAttachmentErrors);
        if ((materials.get(definition.materialId)?.anisotropy ?? 0) > 0)
            anisotropicMaterials += 1;
    }
    group.userData = { characterSubsystem: "FiberEngine", rootCount, guideCount, clumpCount, rootAttachmentErrors };
    return { group, rootCount, guideCount, clumpCount, rootAttachmentErrors, anisotropicMaterials, intersections: 0 };
}
function compileFiber(definition, material, bodyMeshes) {
    const group = new THREE.Group();
    group.name = definition.id;
    let rootCount = 0;
    const rootAttachmentErrors = [...validateFiberRoots(definition), ...validateGuides(definition.flow.guides), ...validateClumps(definition.flow.clumps, new Set(definition.flow.guides.map((guide) => guide.id)))];
    for (const root of definition.flow.roots) {
        rootCount += 1;
        const emitter = bodyMeshes.get(root.emitter);
        const guide = definition.flow.guides.find((candidate) => candidate.rootId === root.id);
        if (!guide || !emitter) {
            rootAttachmentErrors.push(`${root.id} cannot resolve emitter or guide`);
            continue;
        }
        const tube = new THREE.Mesh(buildFiberGeometry(definition, guide), material);
        tube.name = `${definition.id}:${guide.id}`;
        tube.userData = { characterSubsystem: "FiberEngine", emitter: root.emitter, rootCoordinate: root.coordinate, explodeWithParent: true, emitterObject: emitter.uuid, clumpIds: definition.flow.clumps.filter((clump) => clump.guideIds.includes(guide.id)).map((clump) => clump.id) };
        group.add(tube);
    }
    return { group, rootCount, guideCount: definition.flow.guides.length, clumpCount: definition.flow.clumps.length, rootAttachmentErrors, anisotropicMaterials: material instanceof THREE.MeshPhysicalMaterial && material.anisotropy > 0 ? 1 : 0, intersections: 0 };
}
export * from "./flow/index.js";
export * from "./roots/index.js";
export * from "./guides/index.js";
export * from "./clumps/index.js";
export * from "./strands/index.js";
export * from "./fur/index.js";
export * from "./feathers/index.js";
//# sourceMappingURL=index.js.map