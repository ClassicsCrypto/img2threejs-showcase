import * as THREE from "three";
/** Compile declarative, rigid character details and attach them in bone-local space. */
export function compileAccessories(graph, materials, skeleton) {
    const group = new THREE.Group();
    group.name = "accessories";
    const items = new Map();
    const unboundJointIds = [];
    let attachedCount = 0;
    for (const spec of graph?.items ?? []) {
        const base = materials.get(spec.materialId) ?? new THREE.MeshPhysicalMaterial({ color: 0x6f241d, roughness: 0.65 });
        const material = base.clone();
        if (spec.flatShading !== undefined)
            material.flatShading = spec.flatShading;
        if (spec.doubleSided)
            material.side = THREE.DoubleSide;
        material.needsUpdate = true;
        const mesh = new THREE.Mesh(buildAccessoryGeometry(spec), material);
        mesh.name = spec.id;
        mesh.position.set(...spec.position);
        if (spec.rotation)
            mesh.rotation.set(...spec.rotation);
        if (spec.scale)
            mesh.scale.set(...spec.scale);
        mesh.userData = {
            characterSubsystem: "AccessoryEngine",
            semanticRole: spec.semanticRole,
            characterLayer: spec.layer,
            attachmentJoint: spec.jointId,
            sourceSpace: spec.space ?? "model",
            explodeWithParent: spec.explodeWithParent ?? true,
        };
        if (spec.primitive === "anchor")
            mesh.visible = false;
        if (spec.jointId) {
            const bone = skeleton.bones.get(spec.jointId);
            const rest = skeleton.restWorldPositions.get(spec.jointId);
            if (!bone || !rest) {
                unboundJointIds.push(`${spec.id}:${spec.jointId}`);
                group.add(mesh);
            }
            else {
                if ((spec.space ?? "model") === "model")
                    mesh.position.sub(rest);
                bone.add(mesh);
                attachedCount += 1;
            }
        }
        else {
            group.add(mesh);
            attachedCount += 1;
        }
        items.set(spec.id, mesh);
    }
    group.userData = {
        characterSubsystem: "AccessoryEngine",
        itemCount: items.size,
        attachedCount,
        unboundJointIds,
    };
    return { group, items, attachedCount, unboundJointIds };
}
export function buildAccessoryGeometry(spec) {
    const size = spec.size ?? [0.05, 0.05, 0.05];
    const radialSegments = Math.max(3, spec.radialSegments ?? 8);
    switch (spec.primitive) {
        case "anchor": {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
            return geometry;
        }
        case "box":
            return new THREE.BoxGeometry(size[0], size[1], size[2]);
        case "ellipsoid":
            return scaledGeometry(new THREE.SphereGeometry(1, Math.max(6, spec.tubularSegments ?? 12), radialSegments), size);
        case "dodecahedron":
            return scaledGeometry(new THREE.DodecahedronGeometry(1, spec.detail ?? 0), size);
        case "cylinder":
            return new THREE.CylinderGeometry(spec.radiusTop ?? spec.radius ?? size[0], spec.radiusBottom ?? spec.radius ?? size[0], size[1], radialSegments, 1, false);
        case "cone":
            return new THREE.ConeGeometry(spec.radius ?? size[0], size[1], radialSegments, 1, false);
        case "torus":
            return new THREE.TorusGeometry(spec.radius ?? size[0], spec.tube ?? Math.max(0.002, size[1]), radialSegments, Math.max(6, spec.tubularSegments ?? 16));
        case "polygon":
            return polygonGeometry(spec);
    }
}
function scaledGeometry(geometry, size) {
    geometry.scale(size[0], size[1], size[2]);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
}
function polygonGeometry(spec) {
    const points = spec.points ?? [];
    if (points.length < 3)
        throw new Error(`polygon accessory ${spec.id} needs at least three points`);
    const shape = new THREE.Shape();
    shape.moveTo(points[0][0], points[0][1]);
    for (const point of points.slice(1))
        shape.lineTo(point[0], point[1]);
    shape.closePath();
    if (spec.doubleSided === false) {
        const geometry = new THREE.ShapeGeometry(shape, 1);
        geometry.computeVertexNormals();
        return geometry;
    }
    const depth = Math.max(0.0005, spec.size?.[2] ?? 0.002);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1, steps: 1 });
    geometry.translate(0, 0, -depth * 0.5);
    geometry.computeVertexNormals();
    return geometry;
}
//# sourceMappingURL=index.js.map