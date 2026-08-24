import * as THREE from "three";
import { buildAppendageGeometry } from "../geometry/appendages/index.js";
export function compileAppendages(graph, materials) {
    const group = new THREE.Group();
    group.name = "appendages";
    for (const spec of graph?.items ?? []) {
        const geometry = buildAppendageGeometry(spec);
        const baseMaterial = materials.get(spec.materialId ?? "skin") ?? new THREE.MeshPhysicalMaterial({ color: 0x8a3d2a, roughness: 0.58 });
        const material = spec.geometryMode === "loft" ? baseMaterial.clone() : baseMaterial;
        if (spec.geometryMode === "loft" && "side" in material)
            material.side = THREE.DoubleSide;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = spec.id;
        mesh.userData = { characterSubsystem: "AppendageEngine", semanticRole: spec.semanticRole, rootRegion: spec.rootRegion };
        group.add(mesh);
    }
    return group;
}
//# sourceMappingURL=index.js.map