import { solveProportions } from "./landmark-graph.js";
/** Resolve evidence into a compiler-ready clone without mutating authored IR. */
export function resolveCharacterIR(source) {
    const resolved = structuredClone(source);
    const authored = { ...resolved.proportionModel };
    solveProportions(resolved);
    for (const binding of resolved.proportionBindings) {
        const before = Number(authored[binding.proportion]);
        const after = Number(resolved.proportionModel[binding.proportion]);
        const reference = binding.referenceValue || before;
        if (!Number.isFinite(after) || !Number.isFinite(reference) || Math.abs(reference) < 1e-9)
            continue;
        applyBinding(resolved, binding, after / reference);
    }
    return resolved;
}
function applyBinding(ir, binding, scale) {
    if (!Number.isFinite(scale) || scale <= 0)
        return;
    for (const target of binding.targets)
        applyTarget(ir, target, scale);
}
function applyTarget(ir, target, scale) {
    switch (target.kind) {
        case "loft-section-center":
            for (const loft of ir.shapeGraph.lofts.filter((item) => target.ids.includes(item.id))) {
                for (const section of loft.sections)
                    section.center = scalePoint(section.center, target.axes, target.origin, scale);
                loft.axis.points = loft.sections.map((section) => section.center);
            }
            return;
        case "loft-section-size":
            for (const loft of ir.shapeGraph.lofts.filter((item) => target.ids.includes(item.id))) {
                for (const section of loft.sections) {
                    if (target.components.includes("width"))
                        section.width *= scale;
                    if (target.components.includes("depth"))
                        section.depth *= scale;
                }
            }
            return;
        case "rig-joint-position":
            for (const joint of ir.rigGraph?.joints ?? []) {
                if (target.ids.includes(joint.id))
                    joint.restPosition = scalePoint(joint.restPosition, target.axes, target.origin, scale);
            }
            return;
        case "accessory-position":
            for (const accessory of matchingAccessories(ir, target.ids))
                accessory.position = scalePoint(accessory.position, target.axes, target.origin, scale);
            return;
        case "accessory-size":
            for (const accessory of matchingAccessories(ir, target.ids)) {
                if (accessory.size)
                    accessory.size = scalePoint(accessory.size, target.axes, [0, 0, 0], scale);
                if (accessory.scale)
                    accessory.scale = scalePoint(accessory.scale, target.axes, [0, 0, 0], scale);
            }
            return;
        case "landmark-position":
            for (const landmark of ir.landmarkGraph.landmarks) {
                if (target.ids.includes(landmark.id))
                    landmark.position = scalePoint(landmark.position, target.axes, target.origin, scale);
            }
            for (const landmark of ir.evidence.landmarks) {
                if (target.ids.includes(landmark.id))
                    landmark.position = scalePoint(landmark.position, target.axes, target.origin, scale);
            }
            return;
        case "face-skull-radius": {
            const skull = ir.shapeGraph.face?.skull;
            if (!skull)
                return;
            skull.radius = scalePoint(skull.radius, target.axes, [0, 0, 0], scale);
            return;
        }
        case "hand-digit-point":
            for (const hand of ir.shapeGraph.hands.filter((item) => target.handIds.includes(item.id))) {
                for (const digit of hand.digits)
                    digit.points = digit.points.map((point) => scalePoint(point, target.axes, target.origin, scale));
            }
            return;
    }
}
function matchingAccessories(ir, ids) {
    return (ir.accessoryGraph?.items ?? []).filter((item) => ids.includes(item.id));
}
function scalePoint(point, axes, origin = [0, 0, 0], scale = 1) {
    const result = [...point];
    const names = ["x", "y", "z"];
    for (let index = 0; index < 3; index += 1) {
        if (axes.includes(names[index]))
            result[index] = origin[index] + (point[index] - origin[index]) * scale;
    }
    return result;
}
export function proportionValue(ir, key) {
    return Number(ir.proportionModel[key]);
}
//# sourceMappingURL=character-resolver.js.map