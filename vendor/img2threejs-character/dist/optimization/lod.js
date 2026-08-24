import * as THREE from "three";
export function buildCharacterLOD(levels) {
    const lod = new THREE.LOD();
    for (const level of levels.sort((a, b) => a.distance - b.distance))
        lod.addLevel(level.object, level.distance);
    lod.name = "CharacterLOD";
    lod.userData.characterSubsystem = "CharacterOptimization";
    return lod;
}
export function cloneLodLevel(source, scale) {
    const clone = source.clone(true);
    clone.scale.setScalar(scale);
    clone.userData.lodScale = scale;
    return clone;
}
//# sourceMappingURL=lod.js.map