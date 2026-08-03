# Loop 4 AWP Medusa cross-angle audit

Inspect every separate source `angle-01-white.png` through `angle-18-white.png` in this notebook. Compare the current procedural render against `front-medusa.webp`, `back-medusa.webp`, and the retained technical sources. Do not infer hidden geometry from a single view.

Return a concise implementation memo with:

1. The top eight P0/P1 visible mismatches, ordered by impact.
2. Scope: tube length and taper, objective/eyepiece glass response, ring width/placement/fasteners, rail contact, turrets, and crown orientation/conformal contact.
3. Receiver, stock, thumbhole, trigger/guard, bolt, magazine, barrel and muzzle bore.
4. Bipod: hinge plate, lock, telescoping legs, feet, spring coil readability and attachment.
5. Medusa continuity on front/back and grazing orbit, including seams or floating/intersections.
6. Exact KEEP / REVERT / NEXT-FIX actions for one correction loop.
7. A confidence score from 0 to 1 per region.

Every claim must be labeled `OBSERVED`, `SUPPORTED`, `INFERRED`, `UNKNOWN`, or `IMPLEMENTATION`. Treat the technical sources as support for real construction only; do not invent dimensions that the supplied images cannot calibrate. This is an audit, not a pass approval.
