import * as THREE from "three";
export function buildBatchedDetails(material, geometries, maxInstances = geometries.length) {
    const maxVertices = Math.max(1, geometries.reduce((sum, geometry) => sum + (geometry.getAttribute("position")?.count ?? 0), 0));
    const maxIndices = Math.max(1, geometries.reduce((sum, geometry) => sum + (geometry.index?.count ?? 0), 0));
    const mesh = new THREE.BatchedMesh(maxInstances, maxVertices, maxIndices, material);
    for (const geometry of geometries)
        mesh.addGeometry(geometry);
    mesh.name = "BatchedCharacterDetails";
    mesh.userData.characterSubsystem = "CharacterOptimization";
    return mesh;
}
//# sourceMappingURL=batching.js.map