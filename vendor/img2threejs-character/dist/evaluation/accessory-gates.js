import { fail, pass } from "./gate.js";
export function accessoryGates(compiled) {
    const expected = compiled.ir.accessoryGraph?.items.length ?? 0;
    const built = compiled.accessories.items.size;
    const unbound = compiled.accessories.unboundJointIds;
    return [
        unbound.length === 0
            ? pass("ACCESSORY-ATTACHMENT", { expected, built, attached: compiled.accessories.attachedCount }, [{ kind: "runtime", ref: "AccessoryEngine" }])
            : fail("ACCESSORY-ATTACHMENT", unbound.map((item) => `${item} could not resolve its joint`), ["AccessoryEngine: repair joint ID or attachment space"], { expected, built, unbound: unbound.length }),
        built === expected
            ? pass("ACCESSORY-IDENTITY", { expected, built }, [{ kind: "ir", ref: "accessoryGraph.items" }])
            : fail("ACCESSORY-IDENTITY", [`expected ${expected} accessories but compiled ${built}`], ["AccessoryEngine: preserve one runtime item per declarative accessory"], { expected, built }),
    ];
}
//# sourceMappingURL=accessory-gates.js.map