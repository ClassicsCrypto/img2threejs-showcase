# NotebookLM Loop 20 — 24-angle audit

Date: 2026-08-03
Notebook: `8391cfbf-8d82-4edc-be6a-59dda24cc318`
Evidence: 24 separate loop-20 angle images plus `muzzle-face-close.png` and `scope-ring-contact-crop.png`; origin and technical sources preserved.

## Verdict

`REFINE` (confidence 0.90). Loop 20 is non-degenerate and structurally covered, but not Tier-1 complete: IoU `0.5425`, aspect delta `0.0633`, scale delta `0.0676`, bilateral error `0.1635`. NotebookLM recommends local non-linear profile edits rather than uniform thinning.

## Accepted findings

- **Macro receiver/stock/barrel — 0.90, OBSERVED/SUPPORTED:** receiver and stock remain blocky versus the source taper. The safe next move is a local taper/fillet at receiver shoulders and the thumbhole-to-buttpad transition; do not repeat the rejected uniform scale experiment. Technical source dimensions are family context, not exact hidden measurements for this image-only reconstruction.
- **Scope/rings/mount — 0.95, OBSERVED/SUPPORTED:** focused crop and orbits now show the mount overlapping the rail and the clamp seam visible; the P0 floating read is reduced to acceptable game-item contact. Ring screws still lack convincing hex-head depth.
- **Crown/Medusa — 0.95/0.80, OBSERVED/INFERRED:** crown-up/skull-down decal follows the objective taper and source-bound Medusa stays on authored shell meshes. Hidden underside wear/thickness remain unknowable from two broadside views.
- **Bolt/trigger/magazine — 0.85, OBSERVED/SUPPORTED/INFERRED:** loop-20 rollback is source-fit and avoids the loop-19 trigger-bow error. Magazine reads coarse; a rounded baseplate and release catch would improve it. Trigger underside remains partially inferred.
- **Muzzle/bipod — 0.90, OBSERVED/SUPPORTED/INFERRED:** open bore with inner wall/deeper back is readable; true helix and feet are present. Bipod hinge/lock read, but the forend spigot is visually submerged and needs a local contact/spigot refinement.
- **Glass/materials — 0.85, INFERRED/SUPPORTED:** material separation exists, but objective/ocular glass needs stronger specular response to read as mirror-like glass in Three.js.

## Reconciliation

1. The loop-20 crop supersedes the earlier loop-18 “floating” concern: contact is now visually sufficient, while metadata remains passing.
2. The loop-19 15–20% bolt extension was rejected by the source-side silhouette and rolled back; retain loop-20 proportions.
3. Keep the actual TubeGeometry spring and open muzzle construction; no zig-zag or flat front cap.
4. Exact internal chamber, underside trigger housing, top rail channels, hidden thickness, and wear distribution are UNKNOWN rather than invented.

## Next safe plan (requires a new authorized correction epoch)

1. Local receiver shoulder and stock thumbhole/buttpad taper/fillet; measure IoU before retaining.
2. Increase only scope lens specular/reflective response and add real hex-head depth to ring fasteners.
3. Add a magazine baseplate fillet/release catch and expose the bipod forend spigot without breaking attachment pairs.

## Gate decision

Do not mark complete. The authorized loop budget is exhausted at loop 20 and Tier-1 remains below threshold; continue only with a newly authorized correction budget.

