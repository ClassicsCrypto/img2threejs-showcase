import { fail, pass, warn } from "./gate.js";
export function fiberGates(compiled) {
    const fiber = compiled.fibers;
    const rigidHair = [...compiled.accessories.items.values()].filter((item) => String(item.userData.semanticRole ?? "").includes("hair"));
    const hasRigidHair = rigidHair.length > 0;
    const rigidHairAttached = rigidHair.every((item) => item.userData.attachmentJoint === "head");
    const rootsAttached = fiber.rootCount >= 0 && fiber.guideCount >= fiber.rootCount;
    const results = [];
    results.push(rootsAttached && fiber.rootAttachmentErrors.length === 0 ? pass("HAIR-ROOT-ATTACHMENT", { roots: fiber.rootCount, guides: fiber.guideCount }, [{ kind: "runtime", ref: "FiberEngine" }]) : fail("HAIR-ROOT-ATTACHMENT", fiber.rootAttachmentErrors.length ? fiber.rootAttachmentErrors : ["fiber roots outnumber compiled guides"], ["FiberEngine: bind roots to semantic emitter coordinates"], { roots: fiber.rootCount, guides: fiber.guideCount }));
    results.push(fiber.guideCount > 0 || hasRigidHair ? pass("HAIR-FLOW-CONTINUITY", { guides: fiber.guideCount, rigidHairMasses: rigidHair.length }, [{ kind: "runtime", ref: hasRigidHair ? "AccessoryEngine.rigidHairMasses" : "FiberEngine.guides" }]) : warn("HAIR-FLOW-CONTINUITY", { guides: 0, rigidHairMasses: 0 }, "No hair representation was supplied by this archetype."));
    results.push(fiber.rootCount === 0 || fiber.clumpCount > 0 ? pass("HAIR-CLUMP", { roots: fiber.rootCount, clumpGuides: fiber.clumpCount }, [{ kind: "ir", ref: "fiberGraph.clumps" }]) : warn("HAIR-CLUMP", { roots: fiber.rootCount, clumpGuides: fiber.clumpCount }, "Fiber guides are present without an explicit clump graph."));
    results.push(fiber.guideCount > 0 || (hasRigidHair && rigidHairAttached) ? pass("HAIR-SCALP-CONFORMITY", { guides: fiber.guideCount, intersections: fiber.intersections, rigidHairMasses: rigidHair.length }, [{ kind: "runtime", ref: hasRigidHair ? "AccessoryEngine.headAttachment" : "FiberEngine.rootCoordinate" }]) : warn("HAIR-SCALP-CONFORMITY", { guides: 0, rigidHairMasses: rigidHair.length }, hasRigidHair ? "Rigid hair masses are not attached to the head joint." : "No hair emitter or rigid hair mass was supplied by this archetype."));
    results.push(fiber.intersections === 0 ? pass("HAIR-PENETRATION", { intersections: fiber.intersections }, [{ kind: "runtime", ref: "FiberEngine.penetrationProbe" }]) : fail("HAIR-PENETRATION", [`${fiber.intersections} fiber penetration probes failed`], ["FiberEngine: offset roots and repair guide flow"], { intersections: fiber.intersections }));
    results.push(fiber.guideCount > 0 || hasRigidHair ? pass("HAIR-SILHOUETTE", { guides: fiber.guideCount, rigidHairMasses: rigidHair.length }, [{ kind: "runtime", ref: "multi-angle runtime probe" }]) : warn("HAIR-SILHOUETTE", { guides: 0, rigidHairMasses: 0 }, "No hair silhouette is applicable to this archetype."));
    results.push(fiber.guideCount === 0 || fiber.anisotropicMaterials > 0 ? pass("HAIR-ANISOTROPY", { anisotropicMaterials: fiber.anisotropicMaterials }, [{ kind: "runtime", ref: "materials.hair.anisotropy" }]) : fail("HAIR-ANISOTROPY", ["fiber material has no anisotropic response"], ["AppearanceEngine: compile hair with MeshPhysicalMaterial anisotropy or a TSL backend"]));
    return results;
}
//# sourceMappingURL=fiber-gates.js.map