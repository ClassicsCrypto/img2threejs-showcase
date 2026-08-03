# NotebookLM Loop 18 — 24-angle audit

Date: 2026-08-03
Notebook: `8391cfbf-8d82-4edc-be6a-59dda24cc318`
Evidence: 24 separate loop-18 angle images plus `muzzle-face-close.png` and `scope-ring-contact-crop.png`; origin and technical sources preserved.

## Verdict

`REFINE`. Loop 18 is not a Tier-1 pass: strict-quality, multi-angle, and part coverage pass, but Tier 1 remains `IoU=0.5425`, `aspectRatioDelta=0.0633`, `scaleDelta=0.0676`. The scope contact crop exposes a visible ring/mount-to-tube gap even though runtime attachment metadata passes. This is a geometry contact defect, not a bookkeeping defect.

## Findings and confidence

- **Macro receiver/stock/barrel — 0.90, OBSERVED/SUPPORTED:** receiver and stock remain blocky/thick in the broadside. The loop-17 uniform 6% group thinning improved aspect only to `0.0513` but reduced IoU to `0.5084`; it was rejected and restored. Use localized profile edits at the receiver/fore-end and stock transition instead of uniform group scaling.
- **Scope body/rings/mount — 1.00, OBSERVED/SUPPORTED:** `scope-ring-contact-crop.png` shows the optic/ring/mount relationship reading as floating. The next fix must increase visible physical contact between the ring saddles/mount posts and the scope tube/rail, while keeping the ring assemblies parented to the scope and rail. Narrow the ring around the tube only if the crop remains oversized after contact correction.
- **Crown sticker — 0.95, OBSERVED/SUPPORTED:** crown-up/skull-down and tangent contact are correct. Do not rotate it.
- **Bolt/trigger/magazine — 0.85, OBSERVED/SUPPORTED:** bolt handle remains too short for a usable grip; extend about 15–20% along its authored bend. Trigger guard and magazine material separation exist but local surface detail is simplified.
- **Muzzle/bipod — 0.90, OBSERVED/SUPPORTED:** open muzzle bore and true TubeGeometry helix are present. Muzzle still benefits from deeper internal wall/back readability; do not cap the bore or replace the helix with zig-zag geometry.
- **Medusa projection/wear — 0.80, OBSERVED/INFERRED:** authored Medusa surface remains source-bound on real shell meshes; hidden underside wear and hidden thickness remain inferred because only two broadside origin views exist.

## Reconciliation constraints

1. NotebookLM's “floating” scope finding is accepted as a visible contact issue even though attachment metadata and world-pair gates pass; visual contact outranks metadata for this defect.
2. Crown orientation is locked and already correct.
3. The bipod spring is a real 14-turn tubular helix; keep its construction.
4. The muzzle is an open-ended shell with inner wall and deeper back surface; deepen/reveal it without adding a flat front cap.
5. The failed loop-17 uniform receiver/stock scale experiment is recorded as rejected; it must not be silently treated as an improvement.

## Ordered next corrections

1. Fix scope ring/mount physical contact in the authored geometry and rerun the focused crop.
2. Extend the receiver-parented bolt handle by 15–20% while keeping its pivot below the optic.
3. Make the muzzle bore depth readable from the muzzle crop.
4. Replace only local receiver/stock profile vertices/sections that cause the blocky silhouette; do not apply another uniform scale without a measured IoU improvement.

## Gate decision

Continue to loop 19. Do not mark complete; Tier 1 remains failed and the scope contact defect is P0 for the next correction.

