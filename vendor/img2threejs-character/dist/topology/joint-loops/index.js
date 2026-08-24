export function validateJointZones(zones) {
    const errors = [];
    for (const zone of zones) {
        if (zone.preJointLoops < 1 || zone.coreLoops < 1 || zone.postJointLoops < 1)
            errors.push(`${zone.joint} needs loops before, at and after the joint`);
        if (zone.deformationDensity <= 0)
            errors.push(`${zone.joint} has no deformation density`);
    }
    return errors;
}
export function humanoidJointZones() {
    return ["left-shoulder", "right-shoulder", "left-elbow", "right-elbow", "left-wrist", "right-wrist", "left-finger", "right-finger", "left-hip", "right-hip", "left-knee", "right-knee", "left-ankle", "right-ankle", "left-toe", "right-toe", "neck"].map((joint) => ({ joint, preJointLoops: 2, coreLoops: 3, postJointLoops: 2, deformationDensity: 1 }));
}
//# sourceMappingURL=index.js.map