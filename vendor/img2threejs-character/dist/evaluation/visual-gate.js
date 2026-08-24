import { fail, warn } from "./gate.js";
const REQUIRED_VIEWS = ["front", "three-quarter", "side", "rear"];
export function visualFidelityGate(_compiled, evidence = {}) {
    const views = evidence.views ?? [];
    if (!views.length) {
        const legacyViews = (evidence.fixedViewPath ? 1 : 0) + (evidence.orbitViewPaths?.length ?? 0);
        return warn("G8-VISUAL-FIDELITY", { checkedViews: legacyViews, regionMetrics: 0 }, "Visual fidelity requires fresh front, three-quarter, side and rear evidence with region metrics.");
    }
    const thresholds = {
        silhouetteIoU: evidence.thresholds?.silhouetteIoU ?? 0.85,
        aspectRatioDelta: evidence.thresholds?.aspectRatioDelta ?? 0.05,
        scaleDelta: evidence.thresholds?.scaleDelta ?? 0.08,
        regionSilhouetteIoU: evidence.thresholds?.regionSilhouetteIoU ?? 0.72,
    };
    const byId = new Map(views.map((view) => [view.id, view]));
    const failures = [];
    let regionCount = 0;
    let worstIoU = 1;
    let worstRegionIoU = 1;
    let maxAspectDelta = 0;
    let maxScaleDelta = 0;
    for (const id of REQUIRED_VIEWS) {
        const view = byId.get(id);
        if (!view) {
            failures.push(`missing required view: ${id}`);
            continue;
        }
        worstIoU = Math.min(worstIoU, view.silhouetteIoU);
        maxAspectDelta = Math.max(maxAspectDelta, view.aspectRatioDelta);
        maxScaleDelta = Math.max(maxScaleDelta, view.scaleDelta);
        if (view.silhouetteIoU < thresholds.silhouetteIoU)
            failures.push(`${id} silhouette IoU ${view.silhouetteIoU.toFixed(4)} below ${thresholds.silhouetteIoU}`);
        if (view.aspectRatioDelta > thresholds.aspectRatioDelta)
            failures.push(`${id} aspect delta ${view.aspectRatioDelta.toFixed(4)} above ${thresholds.aspectRatioDelta}`);
        if (view.scaleDelta > thresholds.scaleDelta)
            failures.push(`${id} scale delta ${view.scaleDelta.toFixed(4)} above ${thresholds.scaleDelta}`);
        const entries = Object.entries(view.regions);
        if (!entries.length)
            failures.push(`${id} has no region metrics`);
        for (const [region, metric] of entries) {
            regionCount += 1;
            worstRegionIoU = Math.min(worstRegionIoU, metric.silhouetteIoU);
            if (metric.silhouetteIoU < thresholds.regionSilhouetteIoU)
                failures.push(`${id}:${region} region IoU ${metric.silhouetteIoU.toFixed(4)} below ${thresholds.regionSilhouetteIoU}`);
        }
    }
    const metrics = { checkedViews: views.length, regionMetrics: regionCount, worstSilhouetteIoU: worstIoU, worstRegionIoU, maxAspectRatioDelta: maxAspectDelta, maxScaleDelta };
    const gateEvidence = views.flatMap((view) => [{ kind: "screenshot", ref: view.renderPath, detail: `${view.id} against ${view.referencePath}` }]);
    if (failures.length)
        return fail("G8-VISUAL-FIDELITY", failures, ["VisualEvidence: repair the lowest-scoring region in one causal group, recapture all affected views, and re-run the gate."], metrics, thresholds, gateEvidence);
    return { gateId: "G8-VISUAL-FIDELITY", status: "PASS", metrics, thresholds, evidence: gateEvidence, failureCodes: [], repairHints: [] };
}
//# sourceMappingURL=visual-gate.js.map