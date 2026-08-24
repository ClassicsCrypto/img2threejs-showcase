import * as THREE from "three";
import { assertCharacterGraph } from "../ir/semantic-graph.js";
import { buildAnatomicalLoft } from "../geometry/loft/index.js";
import { compileMaterials } from "../materials/index.js";
import { buildFace } from "../face/index.js";
import { addDeformationMaskAttribute, addSemanticRegionAttribute } from "../topology/validator.js";
import { computeCharacterTangents } from "../surface/tangents/index.js";
import { buildSkeleton, validateRigGraph } from "../rig/skeleton/index.js";
import { buildSemanticWeights } from "../rig/weights/index.js";
import { attachMorphTargets } from "../deformation/morphs/index.js";
import { CharacterIKController } from "../rig/ik/index.js";
import { compileFibers } from "../fibers/index.js";
import { compileWearables } from "../wearables/index.js";
import { compileAppendages } from "../appendages/index.js";
import { CharacterRuntime } from "../runtime/character-runtime.js";
import { compileSurfaceFeatures } from "../surface/features.js";
import { compileAccessories } from "../accessories/index.js";
import { resolveCharacterIR } from "../ir/character-resolver.js";
import { addHandDigits } from "../geometry/hands/index.js";
export function compileCharacter(ir, options = {}) {
    ir = resolveCharacterIR(ir);
    assertCharacterGraph(ir);
    if (!ir.rigGraph)
        throw new Error("CharacterIR requires rigGraph for the animation-ready compiler");
    const diagnostics = { errors: [], warnings: [], lofts: [], tangentBackends: [], rigErrors: validateRigGraph(ir.rigGraph) };
    if (diagnostics.rigErrors.length)
        throw new Error(`invalid rig graph: ${diagnostics.rigErrors.join("; ")}`);
    const root = new THREE.Group();
    root.name = "CharacterRoot";
    root.userData = { characterId: ir.meta.id, characterIRVersion: ir.meta.version, sculptRuntime: "CharacterRuntime", semanticGraph: true };
    const materials = compileMaterials(ir.appearanceGraph, options.backend ?? "webgl");
    const skeleton = buildSkeleton(ir.rigGraph);
    root.add(skeleton.root);
    const bodyMeshes = new Map();
    const meshes = new Map();
    for (const loft of ir.shapeGraph.lofts) {
        const built = buildAnatomicalLoft(loft);
        const hand = ir.shapeGraph.hands.find((candidate) => candidate.loftId === loft.id);
        if (hand && built.errors.length === 0) {
            built.geometry = addHandDigits(built.geometry, hand);
            built.vertexCount = built.geometry.getAttribute("position").count;
            built.triangleCount = (built.geometry.index?.count ?? built.vertexCount) / 3;
        }
        diagnostics.lofts.push({ id: loft.id, vertices: built.vertexCount, triangles: built.triangleCount });
        if (built.errors.length) {
            diagnostics.errors.push(`${loft.id}: ${built.errors.join("; ")}`);
            continue;
        }
        addSemanticRegionAttribute(built.geometry, Math.abs(hash(loft.region)) % 65535);
        addDeformationMaskAttribute(built.geometry, 1);
        computeCharacterTangents(built.geometry, ir.surfaceGraph.tangentSpace).algorithm && diagnostics.tangentBackends.push(loft.id);
        buildSemanticWeights(built.geometry, skeleton, ir.rigGraph.joints);
        const loftMorphs = (ir.morphGraph?.definitions ?? []).filter((morph) => morph.region === loft.region || morph.region === "body");
        if (loftMorphs.length > 0)
            attachMorphTargets(built.geometry, loftMorphs);
        const material = materials.get(loft.materialId ?? "skin") ?? new THREE.MeshPhysicalMaterial({ color: 0x9b5539, roughness: 0.58 });
        const mesh = new THREE.SkinnedMesh(built.geometry, material);
        mesh.name = loft.id;
        mesh.bind(skeleton.skeleton);
        mesh.userData = { characterSubsystem: "ShapeEngine", semanticRegion: loft.region, topologyIntent: loft.topologyIntent, partId: loft.id };
        root.add(mesh);
        bodyMeshes.set(loft.region, mesh);
        meshes.set(loft.id, mesh);
    }
    const face = buildFace(ir, materials);
    const headBone = skeleton.bones.get("head");
    const headRest = skeleton.restWorldPositions.get("head");
    if (headBone && headRest) {
        face.group.position.set(-headRest.x, -headRest.y, -headRest.z);
        headBone.add(face.group);
    }
    else
        root.add(face.group);
    meshes.set("face", face.group);
    const emitterMeshes = new Map();
    bodyMeshes.forEach((mesh, region) => emitterMeshes.set(region, mesh));
    emitterMeshes.set("scalp", face.group);
    emitterMeshes.set("skull", face.group);
    const fibers = compileFibers(ir, materials, emitterMeshes);
    const headFiberOnly = (ir.fiberGraph?.definitions ?? []).flatMap((definition) => definition.flow.roots).every((fiberRoot) => fiberRoot.emitter === "scalp" || fiberRoot.emitter === "skull");
    if (headFiberOnly && (ir.fiberGraph?.definitions.length ?? 0) > 0 && headBone && headRest) {
        fibers.group.position.set(-headRest.x, -headRest.y, -headRest.z);
        headBone.add(fibers.group);
    }
    else
        root.add(fibers.group);
    meshes.set("fibers", fibers.group);
    const accessories = compileAccessories(ir.accessoryGraph, materials, skeleton);
    root.add(accessories.group);
    meshes.set("accessories", accessories.group);
    accessories.items.forEach((item, id) => meshes.set(id, item));
    if (accessories.unboundJointIds.length)
        diagnostics.errors.push(...accessories.unboundJointIds.map((item) => `accessory attachment unresolved: ${item}`));
    const surfaceFeatures = compileSurfaceFeatures(ir, bodyMeshes, materials, accessories.items);
    root.add(surfaceFeatures.group);
    meshes.set("surface-features", surfaceFeatures.group);
    const wearables = compileWearables(ir, materials, bodyMeshes, accessories.items);
    root.add(wearables.group);
    wearables.items.forEach((item, id) => meshes.set(id, item));
    const appendages = compileAppendages(ir.appendageGraph, materials);
    root.add(appendages);
    meshes.set("appendages", appendages);
    const ik = new CharacterIKController(skeleton, ir.rigGraph.ikChains);
    const runtime = new CharacterRuntime(root, meshes, skeleton, materials, face.eyes, ik, ir);
    root.userData.sculptRuntime = runtime;
    return { ir, root, runtime, skeleton, bodyMeshes, meshes, materials, eyes: face.eyes, fibers, surfaceFeatures, wearables, accessories, diagnostics };
}
export async function compileCharacterHero(ir, options = {}) {
    const compiled = compileCharacter(ir, { ...options, backend: "webgpu" });
    const { compileHeroMaterial } = await import("../materials/hero.js");
    for (const definition of ir.appearanceGraph.materials) {
        const result = await compileHeroMaterial(definition, definition.semanticType === "skin" && ir.meta.fidelityProfile === "hero");
        const previous = compiled.materials.get(definition.id);
        if (!previous)
            continue;
        compiled.materials.set(definition.id, result.material);
        compiled.root.traverse((object) => { const mesh = object; if (mesh.material === previous)
            mesh.material = result.material; });
        if (result.fallbackReason)
            compiled.diagnostics.warnings.push(`${definition.id}: ${result.fallbackReason}`);
    }
    return compiled;
}
function hash(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1)
        hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
    return hash >>> 0;
}
//# sourceMappingURL=character-compiler.js.map