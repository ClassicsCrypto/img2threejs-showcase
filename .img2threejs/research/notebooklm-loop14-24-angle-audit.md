# NotebookLM audit — loop 14 — 24 angles

## Result

NotebookLM verdict: **REFINE**. It agrees that the vertical proportion correction improved the deterministic aspect/scale result, while silhouette IoU remains low at about `0.532`. Its strongest useful finding is that the remaining macro mismatch is primarily barrel over-length relative to the stock/receiver mass. It also recommends more robust scope saddles/fasteners, a larger bolt grip, a curved trigger guard, a more visibly dimensional muzzle, and clearer bipod spring/foot readability.

## Local reconciliation

- **Macro:** accepted as OBSERVED with confidence 0.85. The loop 14 root scale correction was real and moved the render bbox from `1598x240` to `1598x307`; Tier 1 now fails only silhouette IoU while aspect and scale pass. The current side-by-side supports reducing barrel length relative to the receiver/stock. Do not use the cited 1120 mm as a hidden exact measurement; it is SUPPORTED platform context, not recoverable from the image.
- **Scope:** the crop shows ring supports seated to the rail and runtime attachment pairs pass. NotebookLM's “thin posts” is a valid source-fidelity complaint; next action is contouring the lower saddle and improving fastener heads, not re-parenting.
- **Crown/Medusa:** crown orientation remains crown-up/skull-down from the direct authored asset review. The Medusa seam/grazing break is real P1 evidence; no blind tri-planar projection should replace authored surfaces.
- **Bolt/trigger:** bolt is receiver-parented below the scope and has been lengthened, but a larger grip and more source-specific bend are reasonable. Guard is real geometry and attached; curvature/placement remain approximate.
- **Muzzle:** code already contains an open outer shell, a separate open inner-wall tube, a recessed back surface, crown and lip. NotebookLM's statement that no inner wall exists is incorrect; its request for stronger visible wall/crown profile is accepted. Do not introduce a boolean that can cap the aperture.
- **Bipod:** code already uses a true 14-turn `TubeGeometry` helix with 96/12 sampling, collars, telescoping legs and feet. The audit correctly identifies review-scale readability and foot simplification as remaining issues, but replacing the valid helix is unnecessary.
- **Materials:** improve the navy-vs-metal roughness/metalness separation only after geometry changes; current glass and foil are real material classes but reflections remain lighting-dependent.

## Confidence table

| Region | Status | Confidence | Local disposition |
| --- | --- | ---: | --- |
| Macro silhouette | REFINE | 0.85 | Reduce barrel relative to receiver/stock |
| Scope mounting | REFINE | 0.95 | Contoured saddles and fasteners; keep attachment graph |
| Crown/Medusa | REFINE | 0.75 | Keep orientation; repair authored seam/grazing read |
| Muzzle/bore | REFINE | 1.00 | Keep open geometry; strengthen inner-wall/crown read |
| Bipod spring/feet | REFINE | 0.85 | Keep true helix; improve readability/feet |
| Bolt/trigger | REFINE | 0.90 | Increase grip and refine curvature |
| Materials | REFINE | 0.70 | Increase finish-class separation |

## Gate disposition

No pass unlock. Strict-quality, multi-angle, runtime attachment/pivot/tick and coverage gates pass; Tier 1 remains blocked by silhouette IoU. The next correction should reduce barrel length using the observed pixel proportion, then re-run the same gates before touching secondary materials.

