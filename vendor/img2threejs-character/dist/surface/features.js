import * as THREE from "three";
import { compileSurfaceCurve } from "./surface-curves/index.js";
/**
 * Compiles semantic surface features into runtime objects. The marker backend
 * is intentionally small: it gives masks, decals and relief features a
 * stable semantic attachment point while leaving texture/decal authoring to
 * a later asset backend.
 */
export function compileSurfaceFeatures(ir, bodyMeshes, materials, accessories = new Map()) {
    const group = new THREE.Group();
    group.name = "surface-features";
    let attachedCount = 0;
    const unboundIds = [];
    const features = ir.surfaceGraph.features;
    for (const feature of features) {
        const adopted = feature.sourceAccessoryId ? accessories.get(feature.sourceAccessoryId) : undefined;
        if (adopted) {
            adopted.userData = { ...adopted.userData, characterSubsystem: "SurfaceEngine", surfaceFeature: feature.id, representation: feature.representation };
            attachedCount += 1;
            continue;
        }
        const mesh = resolveBodyMesh(feature.region, bodyMeshes);
        if (feature.representation === "surface-curve" && feature.points?.length && mesh) {
            const material = featureMaterial(feature, materials);
            const curve = compileSurfaceCurve(feature, material);
            curve.userData = { ...curve.userData, surfaceCoordinate: feature.coordinate, attachedTo: mesh.name };
            group.add(curve);
            attachedCount += 1;
            continue;
        }
        if (!mesh && !feature.points?.length) {
            unboundIds.push(feature.id);
            continue;
        }
        const marker = buildFeatureMarker(feature, mesh, materials);
        if (mesh)
            attachedCount += 1;
        else {
            group.add(marker);
            unboundIds.push(feature.id);
        }
    }
    group.userData = {
        characterSubsystem: "SurfaceEngine",
        semanticFeatureCount: features.length,
        attachedFeatureCount: attachedCount,
    };
    return { group, featureCount: features.length, attachedCount, unboundIds };
}
function resolveBodyMesh(region, bodyMeshes) {
    const direct = bodyMeshes.get(region);
    if (direct)
        return direct;
    if (region.includes("pectoral") || region.includes("shoulder") || region === "chest")
        return bodyMeshes.get("thorax");
    if (region.includes("abdomen") || region === "belly")
        return bodyMeshes.get("abdomen") ?? bodyMeshes.get("thorax");
    if (region.includes("pelvis") || region === "hip")
        return bodyMeshes.get("pelvis") ?? bodyMeshes.get("torso");
    if (region.includes("face") || region.includes("eye") || region === "jaw")
        return bodyMeshes.get("skull");
    return bodyMeshes.get("torso");
}
function buildFeatureMarker(feature, mesh, materials) {
    const material = featureMaterial(feature, materials);
    const coordinate = feature.coordinate;
    if (!mesh || !coordinate) {
        const marker = new THREE.Object3D();
        marker.name = feature.id;
        marker.userData = { characterSubsystem: "SurfaceEngine", surfaceFeature: feature.id, attached: false };
        return marker;
    }
    mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox ?? new THREE.Box3(new THREE.Vector3(-0.1, 0, -0.1), new THREE.Vector3(0.1, 1, 0.1));
    const position = new THREE.Vector3(THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, THREE.MathUtils.clamp(coordinate.u, 0, 1)), THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, THREE.MathUtils.clamp(coordinate.v, 0, 1)), bounds.max.z + coordinate.normalOffset);
    const radius = Math.max(0.002, Math.min(0.018, 0.004 + Math.abs(feature.intensity ?? 0.25) * 0.01));
    const marker = new THREE.Mesh(new THREE.CircleGeometry(radius, 16), material);
    marker.name = feature.id;
    marker.position.copy(position);
    marker.userData = {
        characterSubsystem: "SurfaceEngine",
        surfaceFeature: feature.id,
        representation: feature.representation,
        semanticCoordinate: coordinate,
        attachedTo: mesh.name,
        attached: true,
    };
    mesh.add(marker);
    return marker;
}
function featureMaterial(feature, materials) {
    const base = materials.get(feature.materialId ?? "skin") ?? new THREE.MeshPhysicalMaterial({ color: 0x32140f, roughness: 0.65 });
    const material = base.clone();
    if (feature.representation === "material-mask" || feature.representation === "decal") {
        material.color.multiplyScalar(Math.max(0.15, 1 - Math.abs(feature.intensity ?? 0.25) * 0.65));
    }
    material.userData = { ...material.userData, surfaceFeature: feature.id };
    return material;
}
export function validateSurfaceCoordinate(coordinate) {
    const errors = [];
    if (!Number.isFinite(coordinate.u) || coordinate.u < 0 || coordinate.u > 1)
        errors.push("u must be finite and within [0,1]");
    if (!Number.isFinite(coordinate.v) || coordinate.v < 0 || coordinate.v > 1)
        errors.push("v must be finite and within [0,1]");
    if (!Number.isFinite(coordinate.normalOffset))
        errors.push("normalOffset must be finite");
    return errors;
}
//# sourceMappingURL=features.js.map