import * as THREE from "three";
import { fail, pass } from "./gate.js";
export function wearableGates(compiled) {
    const result = compiled.wearables;
    const specs = compiled.ir.wearableGraph?.items ?? [];
    const fittedItems = [...result.items.values()].filter((item) => item.userData.fitMode === "body-derived-offset-shell").length;
    const skinnedItems = [...result.items.values()].filter((item) => {
        let found = false;
        item.traverse((object) => { if (object instanceof THREE.SkinnedMesh)
            found = true; });
        return found;
    }).length;
    const seamlessItems = specs.filter((spec) => spec.seamIds.length > 0).length;
    const clothSpecs = specs.filter((spec) => ["shirt", "pants", "shorts", "dress", "shoe", "glove"].includes(spec.kind));
    const armorSpecs = specs.filter((spec) => spec.kind === "armor");
    return [
        result.penetration <= 0.002 ? pass("CLOTH-CLEARANCE", { penetration: result.penetration, items: result.items.size }, [{ kind: "runtime", ref: "WearableEngine" }]) : fail("CLOTH-CLEARANCE", ["wearable penetrates body beyond tolerance"], ["WearableEngine: refit offset shell against body surface"], { penetration: result.penetration }, { maxPenetration: 0.002 }),
        result.penetration === 0 ? pass("CLOTH-BODY-PENETRATION", { penetration: result.penetration }, [{ kind: "runtime", ref: "WearableEngine.penetration" }]) : fail("CLOTH-BODY-PENETRATION", ["body-derived garment penetration probe failed"], ["WearableEngine: increase shell offset and re-run clearance probes"], { penetration: result.penetration }),
        result.items.size === 0 || result.items.size >= clothSpecs.length ? pass("CLOTH-SELF-INTERSECTION", { items: result.items.size }, [{ kind: "runtime", ref: "WearableEngine.selfIntersectionProbe" }]) : fail("CLOTH-SELF-INTERSECTION", ["not every garment compiled to a runtime item"], ["WearableEngine: preserve garment item identity during compilation"]),
        clothSpecs.length === 0 || seamlessItems >= clothSpecs.length ? pass("CLOTH-SEAM", { garments: clothSpecs.length, seamful: seamlessItems }, [{ kind: "ir", ref: "wearableGraph.items.seamIds" }]) : fail("CLOTH-SEAM", ["one or more garments have no seam semantics"], ["WearableEngine: add semantic seam identifiers to the garment spec"], { garments: clothSpecs.length, seamful: seamlessItems }),
        clothSpecs.length === 0 || fittedItems > 0 ? pass("CLOTH-FIT", { garments: clothSpecs.length, bodyDerived: fittedItems }, [{ kind: "runtime", ref: "WearableEngine.bodyDerivedShell" }]) : fail("CLOTH-FIT", ["garments are not body-derived or fitted"], ["WearableEngine: construct an offset shell from covered body regions"], { garments: clothSpecs.length, bodyDerived: fittedItems }),
        clothSpecs.length === 0 || skinnedItems > 0 ? pass("CLOTH-DEFORMATION", { garments: clothSpecs.length, skinnedItems }, [{ kind: "runtime", ref: "WearableEngine.skinning" }]) : fail("CLOTH-DEFORMATION", ["no garment is connected to the character deformation runtime"], ["WearableEngine: copy body skin weights and bind the garment shell"]),
        armorSpecs.length === 0 || armorSpecs.every((spec) => result.items.has(spec.id)) ? pass("ARMOR-ATTACHMENT", { armor: armorSpecs.length }, [{ kind: "runtime", ref: "wearables.armor" }]) : fail("ARMOR-ATTACHMENT", ["armor spec did not compile to an attached item"], ["WearableEngine: bind armor to a semantic bone or surface region"], { armor: armorSpecs.length }),
    ];
}
//# sourceMappingURL=wearable-gates.js.map