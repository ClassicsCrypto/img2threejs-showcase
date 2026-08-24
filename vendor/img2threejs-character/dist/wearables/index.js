import * as THREE from "three";
export function compileWearables(ir, materials, bodyMeshes = new Map(), accessories = new Map()) {
    const group = new THREE.Group();
    group.name = "wearables";
    const items = new Map();
    let penetration = 0;
    for (const spec of ir.wearableGraph?.items ?? []) {
        const item = buildWearable(spec, materials.get(spec.materialId) ?? new THREE.MeshPhysicalMaterial({ color: 0x182d56, roughness: 0.82 }), bodyMeshes, accessories);
        group.add(item);
        items.set(spec.id, item);
        item.userData.characterSubsystem = "WearableEngine";
        item.userData.covers = spec.covers;
        item.userData.clearance = spec.offset;
    }
    return { group, items, penetration };
}
function buildWearable(spec, material, bodyMeshes, accessories) {
    if (spec.sourceAccessoryIds?.length) {
        const proxy = new THREE.Group();
        proxy.name = spec.id;
        const adopted = [];
        for (const id of spec.sourceAccessoryIds) {
            const object = accessories.get(id);
            if (!object)
                continue;
            object.userData = { ...object.userData, characterSubsystem: "WearableEngine", wearableId: spec.id };
            adopted.push(id);
        }
        proxy.userData = { fitMode: "bone-attached-semantic-parts", adoptedAccessoryIds: adopted };
        return proxy;
    }
    const coveredMeshes = spec.attachmentMode === "surface-follows" || spec.attachmentMode === "skins-with"
        ? uniqueCoveredMeshes(spec, bodyMeshes)
        : [];
    if (coveredMeshes.length) {
        const shellGroup = new THREE.Group();
        shellGroup.name = spec.id;
        shellGroup.userData.fitMode = "body-derived-offset-shell";
        for (const body of coveredMeshes) {
            const geometry = body.geometry.clone();
            offsetShell(geometry, Math.max(0.0005, spec.offset));
            const shell = new THREE.SkinnedMesh(geometry, material.clone());
            shell.name = `${spec.id}:${body.name}`;
            shell.bind(body.skeleton, body.bindMatrix.clone());
            shell.userData = {
                characterSubsystem: "WearableEngine",
                garmentId: spec.id,
                coveredRegion: body.userData.semanticRegion,
                clearance: spec.offset,
                seams: spec.seamIds,
                foldStrength: spec.foldStrength,
                skinning: "copied-from-body",
            };
            shellGroup.add(shell);
        }
        return shellGroup;
    }
    const geometry = spec.kind === "shirt" || spec.kind === "dress" ? new THREE.SphereGeometry(1, 24, 16) : spec.kind === "pants" || spec.kind === "shorts" ? new THREE.CylinderGeometry(0.16, 0.13, 0.28, 20) : new THREE.BoxGeometry(0.24, 0.06, 0.18);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = spec.id;
    if (spec.kind === "shirt" || spec.kind === "dress") {
        mesh.position.y = 0.82;
        mesh.scale.set(0.115, 0.18, 0.085);
    }
    else if (spec.kind === "pants" || spec.kind === "shorts") {
        mesh.position.y = 0.53;
        mesh.scale.set(1, 1, 0.8);
    }
    else
        mesh.position.y = 0.1;
    mesh.userData.wearableSpec = spec;
    return mesh;
}
function uniqueCoveredMeshes(spec, bodyMeshes) {
    const result = [];
    const seen = new Set();
    for (const region of spec.covers) {
        const body = bodyMeshes.get(region);
        if (!body || seen.has(body.uuid))
            continue;
        seen.add(body.uuid);
        result.push(body);
    }
    return result;
}
function offsetShell(geometry, distance) {
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    if (!position || !normal)
        return;
    for (let index = 0; index < position.count; index += 1) {
        position.setXYZ(index, position.getX(index) + normal.getX(index) * distance, position.getY(index) + normal.getY(index) * distance, position.getZ(index) + normal.getZ(index) * distance);
    }
    position.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
}
//# sourceMappingURL=index.js.map