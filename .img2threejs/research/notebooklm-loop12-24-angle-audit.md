# NotebookLM audit — loop 12 — 24 angles

## Scope

NotebookLM reviewed the two origin views, technical/reference sources, 24 separate current-render angles, `muzzle-face-close.png`, and `scope-ring-contact-crop.png`. The raw answer is preserved in `notebooklm-loop12-24-angle-answer.txt`.

## NotebookLM result

NotebookLM returned **BLOCKED**. It reported a blocky stock/receiver, a truncated barrel, floating scope mounts, flat objective glass, a thick/flat crown decal, a floating trigger guard, insufficient magazine ribs, a muzzle with no inner bore and a floating lip, bipod springs that do not read as one helix, thumbhole stretching, and matte body/glass materials. It judged the wider framing experiment valid because the full stock and muzzle are visible.

## Evidence reconciliation

- **Barrel:** The “truncated” claim conflicts with the supplied side-by-side and previous local review: the current barrel was already extended and now reads long relative to the receiver. Do not increase it by 15% without a traced pixel measurement. Mark this as a **visual disagreement**, not an accepted correction.
- **Scope rings:** The dedicated local crop and runtime attachment gate show the lowered saddle/mount geometry meeting/intersecting the rail; the ring assemblies are parented under `scope` and their mounts carry rail attachment metadata. NotebookLM's “floating” read is a valid visual-contact concern but not proof of a disconnected component. Improve contact shadow/contour and fastener shape; do not re-parent blindly.
- **Objective glass:** Recessed objective and eyepiece cylinders are real components with a low-roughness physical glass material. The render still needs a stronger environmental reflection, but “missing entirely” is incorrect.
- **Muzzle:** The outer shell is intentionally open-ended, with a separate inner-wall tube, recessed dark back surface, crown and bore lip. NotebookLM's suggestion to replace it with a solid cylinder/boolean would risk reintroducing the capped-disc failure. The lip is a child of the muzzle group and runtime attachment data remains passing. Improve the visible inner-wall highlight and exact brake profile instead.
- **Bipod spring:** The implementation is a true 14-turn `TubeGeometry` helix with 96 tubular samples and 12 radial samples. NotebookLM's concern is readability at review scale, not absence of a helix. Keep the topology and improve contrast/scale only after a direct close-up proves the change.
- **Trigger/thumbhole/magazine:** These remain credible P1 visual refinements: the guard/trigger and thumbhole return edge are present but source-specific placement and bevel still need work; magazine ribs are procedural and simpler than the reference.
- **Framing:** The wider margin makes the full object inspectable, but deterministic Tier 1 worsened (`IoU 0.464`, aspect `0.254`, scale `0.332`). Retain it as an audit camera experiment, not as evidence that the geometry passed. Recalibrate against a traced subject bbox or revert before using it as the acceptance camera.

## Confidence by region

| Region | NotebookLM confidence | Local disposition |
| --- | ---: | --- |
| Silhouette/proportions | 0.90 | Refine; barrel-length claim conflicts with local trace |
| Scope assembly | 1.00 | Refine visual contact; metadata attachment passes |
| Crown/skull sticker | 0.85 | Orientation passes; foil/contact still approximate |
| Receiver/stock | 0.90 | Refine thumbhole/guard/magazine |
| Barrel/muzzle | 1.00 | Keep real open geometry; improve highlight/profile |
| Bipod mechanism | 0.90 | Keep true helix; improve review-scale readability |
| Medusa texture | 0.75 | Refine thumbhole grazing seam |
| Material response | 0.80 | Refine semi-gloss paint and visible glass reflection |

## Gate disposition

The audit does not advance the pass. Tier 1 remains blocked and strict-quality remains blocked; multi-angle is non-degenerate and runtime attachment/tick/pivot gates pass. The next correction must be based on traced macro proportions and direct crops, while preserving the valid procedural construction.

