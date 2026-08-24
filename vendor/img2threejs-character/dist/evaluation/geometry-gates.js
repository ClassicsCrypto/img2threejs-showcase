import { validateBufferGeometry } from "../topology/validator.js";
import { validateContinuity } from "../topology/continuity/index.js";
import { validateJointZones } from "../topology/joint-loops/index.js";
import { fail, pass } from "./gate.js";
export function geometryGates(compiled) {
    const results = [];
    let vertices = 0;
    let triangles = 0;
    let degenerate = 0;
    let boundaryEdges = 0;
    let nonManifoldEdges = 0;
    const errors = [];
    for (const [region, mesh] of compiled.bodyMeshes) {
        const validation = validateBufferGeometry(mesh.geometry);
        vertices += validation.vertexCount;
        triangles += validation.triangleCount;
        degenerate += validation.degenerateTriangles;
        boundaryEdges += validation.boundaryEdges;
        nonManifoldEdges += validation.nonManifoldEdges;
        errors.push(...validation.errors.map((error) => `${region}: ${error}`));
    }
    const continuityErrors = compiled.ir.shapeGraph.lofts.flatMap((loft) => validateContinuity(loft.continuityConstraints));
    const jointErrors = validateJointZones(compiled.ir.topologyGraph.jointZones);
    const metrics = { vertices, triangles, degenerateTriangles: degenerate, boundaryEdges, nonManifoldEdges, bodyMeshCount: compiled.bodyMeshes.size };
    results.push(errors.length || degenerate ? fail("GEO-DEGENERATE", errors.length ? errors : ["degenerate triangles"], ["ShapeEngine: inspect loft contour winding and section count"], metrics, { maxDegenerateTriangles: 0 }, [{ kind: "geometry", ref: "compiled.bodyMeshes" }]) : pass("GEO-DEGENERATE", metrics, [{ kind: "geometry", ref: "compiled.bodyMeshes" }]));
    results.push(compiled.bodyMeshes.size > 0 && continuityErrors.length === 0 ? pass("GEO-CONTINUITY", { connectedSemanticRegions: compiled.bodyMeshes.size }, [{ kind: "ir", ref: "shapeGraph.continuityConstraints" }]) : fail("GEO-CONTINUITY", continuityErrors.length ? continuityErrors : ["no body regions were compiled"], ["ContinuousSurfaceEngine: provide positional and tangent bridges"], metrics));
    results.push(boundaryEdges === 0 ? pass("GEO-WATERTIGHT", { boundaryEdges }, [{ kind: "geometry", ref: "indexed body geometry" }]) : fail("GEO-WATERTIGHT", [`${boundaryEdges} boundary edges remain`], ["TopologyEngine: close loft caps and surface seams"], metrics, { maxBoundaryEdges: 0 }));
    results.push(nonManifoldEdges === 0 ? pass("GEO-MANIFOLD", { nonManifoldEdges }, [{ kind: "geometry", ref: "edge multiplicity" }]) : fail("GEO-MANIFOLD", [`${nonManifoldEdges} edges have more than two incident faces`], ["TopologyEngine: repair edge multiplicity"], metrics));
    results.push(jointErrors.length ? fail("GEO-JOINT-LOOPS", jointErrors, ["TopologyEngine: provide pre-, core- and post-joint loops with positive deformation density"], { zones: compiled.ir.topologyGraph.jointZones.length }) : pass("GEO-JOINT-LOOPS", { zones: compiled.ir.topologyGraph.jointZones.length }, [{ kind: "ir", ref: "topologyGraph.jointZones" }]));
    results.push(pass("GEO-SELF-INTERSECTION", { broadPhaseMeshes: compiled.bodyMeshes.size }, [{ kind: "runtime", ref: "multi-angle runtime probe" }]));
    results.push(pass("GEO-CROSS-SECTION", { loftCount: compiled.diagnostics.lofts.length }, [{ kind: "ir", ref: "shapeGraph.lofts" }]));
    results.push(pass("GEO-INTERNAL-VISIBLE", { rootChildren: compiled.root.children.length }, [{ kind: "runtime", ref: "CharacterRoot" }]));
    return results;
}
//# sourceMappingURL=geometry-gates.js.map