Audit loop 20 (final authorized loop of this epoch) for the procedural Three.js AWP | Medusa (Minimal Wear) reconstruction.

Use the origin front/back images, technical sources, and exactly 24 separate loop-20 white-background angle images plus muzzle-face and scope-ring-contact crops. Current deterministic evidence: build PASS; strict-quality PASS; part coverage PASS with 113 built parts and 0 errors; multi-angle non-degenerate; Tier-1 `silhouetteIoU=0.5425`, `aspectRatioDelta=0.0633`, `scaleDelta=0.0676`, `bilateralSymmetryError=0.1635` (IoU/aspect remain below thresholds).

Known correction history: loop17 uniform receiver/stock thinning was rejected because IoU fell to 0.5084. Loop18 reduced objective taper/lens and added clamp split seam without macro regression. Loop19 increased mount overlap and deepened the open bore, but extending bolt handle 15–20% made it read as a trigger bow and worsened the envelope; loop20 restored the source-fit bolt length while retaining mount/bore fixes. The model contains real geometry: source-bound Medusa on authored shell meshes, crown-up/skull-down tangent decal, attached scope/rings/rail, receiver-parented bolt pivot, open muzzle shell with inner wall/deeper back, and true TubeGeometry bipod helix.

Return REFINE/BLOCKED/PASS with confidence 0–1 and evidence labels OBSERVED, SUPPORTED, INFERRED, or UNKNOWN. Inspect:

1. Macro receiver/stock/barrel profile and the smallest local geometry changes that could improve IoU without uniform scaling.
2. Scope body/rings/mount physical contact from the focused crop and orbits; decide whether the loop19 mount overlap is visually sufficient.
3. Crown orientation/contact, Medusa projection contact from front/back/orbits, and material separation.
4. Bolt handle source proportion after rollback, trigger guard, magazine, and their real parent/contact relationships.
5. Muzzle open-bore depth and bipod hinge/lock/feet/true helix readability. Do not cap the bore or replace the helix.
6. Which remaining defects are unknowable from two broadside source images.

Reconcile visual claims with the known runtime geometry; do not invent exact hidden dimensions. Order a safe next plan, but do not claim the Tier-1 pass when the reported metrics fail.
