import { validateSemanticCoordinates } from "../surface/uv/index.js";
import { validateTangents } from "../surface/tangents/index.js";
import { validateSurfaceCoordinate } from "../surface/features.js";
import { fail, pass } from "./gate.js";
export function surfaceGates(compiled) {
    const results = [];
    const uvErrors = [
        ...validateSemanticCoordinates(compiled.ir.surfaceGraph),
        ...compiled.ir.surfaceGraph.features.flatMap((feature) => feature.coordinate ? validateSurfaceCoordinate(feature.coordinate).map((error) => `${feature.id}: ${error}`) : []),
    ];
    const tangentErrors = [];
    const normalErrors = [];
    for (const mesh of compiled.bodyMeshes.values())
        tangentErrors.push(...validateTangents(mesh.geometry));
    for (const [region, mesh] of compiled.bodyMeshes) {
        const normal = mesh.geometry.getAttribute("normal");
        if (!normal || normal.itemSize !== 3 || normal.array.some((value) => !Number.isFinite(value)))
            normalErrors.push(`${region}: normal attribute is missing or non-finite`);
    }
    const checkedCoordinates = Object.keys(compiled.ir.surfaceGraph.coordinates).length + compiled.ir.surfaceGraph.features.filter((feature) => Boolean(feature.coordinate)).length;
    results.push(uvErrors.length ? fail("SURF-UV-VALID", uvErrors, ["SurfaceEngine: repair semantic UV coordinates"], { checkedCoordinates }) : pass("SURF-UV-VALID", { checkedCoordinates }, [{ kind: "geometry", ref: "bodyMeshes.uv" }]));
    results.push(tangentErrors.length ? fail("SURF-TANGENT-VALID", tangentErrors, ["SurfaceEngine: recompute tangent space after UV/topology changes"]) : pass("SURF-TANGENT-VALID", { meshes: compiled.bodyMeshes.size }, [{ kind: "geometry", ref: "bodyMeshes.tangent" }]));
    results.push(normalErrors.length ? fail("SURF-NORMAL-VALID", normalErrors, ["SurfaceEngine: recompute vertex normals after loft or projection changes"], { errors: normalErrors.length }) : pass("SURF-NORMAL-VALID", { meshes: compiled.bodyMeshes.size }, [{ kind: "geometry", ref: "bodyMeshes.normal" }]));
    const featureResult = compiled.surfaceFeatures;
    results.push(featureResult.featureCount === 0 || featureResult.unboundIds.length === 0
        ? pass("SURF-ATTACHMENT", { features: featureResult.featureCount, attached: featureResult.attachedCount }, [{ kind: "runtime", ref: "surface-features" }])
        : fail("SURF-ATTACHMENT", featureResult.unboundIds.map((id) => `${id} has no body surface anchor`), ["SurfaceEngine: resolve the semantic region before compiling the feature"], { features: featureResult.featureCount, attached: featureResult.attachedCount }));
    const tattooFeatures = compiled.ir.surfaceGraph.features.filter((feature) => feature.id.toLowerCase().includes("tattoo"));
    const scarFeatures = compiled.ir.surfaceGraph.features.filter((feature) => feature.id.toLowerCase().includes("scar"));
    results.push(tattooFeatures.every((feature) => Boolean(feature.coordinate)) ? pass("SURF-TATTOO-CONFORMITY", { features: tattooFeatures.length }, [{ kind: "ir", ref: "surfaceGraph.features" }]) : fail("SURF-TATTOO-CONFORMITY", ["tattoo feature lacks a semantic surface coordinate"], ["SurfaceEngine: attach tattoo as UV/decal/curve feature"]));
    results.push(scarFeatures.every((feature) => Boolean(feature.coordinate)) ? pass("SURF-SCAR-CONFORMITY", { features: scarFeatures.length }, [{ kind: "ir", ref: "surfaceGraph.features" }]) : fail("SURF-SCAR-CONFORMITY", ["scar feature lacks a semantic surface coordinate"], ["SurfaceEngine: attach scar as decal, normal, height or relief feature"]));
    const materialErrors = [...compiled.ir.appearanceGraph.materials].flatMap((definition) => {
        const errors = [];
        if (definition.roughness < 0 || definition.roughness > 1)
            errors.push(`${definition.id}: roughness outside [0,1]`);
        if (definition.metalness < 0 || definition.metalness > 1)
            errors.push(`${definition.id}: metalness outside [0,1]`);
        return errors;
    });
    results.push(materialErrors.length ? fail("SURF-MATERIAL-CHANNELS", materialErrors, ["AppearanceEngine: preserve independent PBR channels"]) : pass("SURF-MATERIAL-CHANNELS", { materials: compiled.materials.size }, [{ kind: "runtime", ref: "materials" }]));
    return results;
}
//# sourceMappingURL=surface-gates.js.map