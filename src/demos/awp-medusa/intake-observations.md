# AWP | Medusa (Minimal Wear) — intake record

Status: `PROCEED` after user-authorized activation of the documented `cs2-rifle-v1`
adapter route. The first intake run was intentionally blocked by the historical
knife-only boundary; this record is retained as the audit trail for that decision.

## Evidence boundary

- `front-medusa.webp` and `back-medusa.webp` are both readable 2560×1440 WebP images.
- Deterministic admission passed for both views; each has one dominant foreground component and no duplicate hash.
- The views are opposite broadside projections. They provide strong silhouette and painted-surface coverage, but no calibrated depth.
- User metadata supplies the identity: `AWP | Medusa (Minimal Wear)`.
- Classification record: `itemFamily=rifle`, `subtype=awp`, confidence `0.99`.

## Observation before inference

### Observed

- Long bolt-action sniper-rifle silhouette with a heavy cylindrical barrel, receiver, raised scope, thumbhole stock, pistol grip, trigger guard, box magazine, bolt handle, muzzle device, and folded support hardware under the fore-end.
- The stock is a broad profiled shell with an elevated cheek-rest region and a large thumbhole opening; the grip and trigger guard form a separate lower contour.
- The receiver has a long top rail and a large optic held by two ring mounts. The optic has a narrow tube, central turret block, and flared objective end.
- The painted shell is very dark blue/charcoal with blue, cyan, and green serpent forms. A Medusa face is visible on one broadside near the stock/thumbhole region; a gold crown-like mark is visible on the opposite scope-side surface.
- Exposed receiver, barrel, bolt, scope, fasteners, rail, and muzzle hardware read as dark satin-to-semi-gloss metal. The painted shell has broader low-roughness highlight bands than the matte black background.

### Supported by local technical sources

- AWP is a bolt-action sniper identity whose external bolt handle is a key discriminator.
- The major route candidates are profile/lofted shells for the stock and receiver, revolved or tube forms for barrel/optic, and projected reference pixels for the image-specific Medusa finish.
- The supplied AWP implementation spec lists animation sockets for bolt cycling, trigger, magazine, muzzle flash, shell ejection, bipod folding, and scope interaction; these are implementation evidence, not visible geometry evidence.

### Inferred

- The receiver, stock, and optic need variable cross-sections rather than constant-thickness plates to survive orbit review.
- The broadside painted regions should use front/back de-lit projections; procedural blue-green snakes would not be image-matched.
- Minimal Wear is best represented as restrained edge/fastener wear, but the exact float and paint seed are unavailable.

### Unknown / hidden

- Receiver, stock, grip, optic, and barrel thickness profiles; undersides; internal bolt and feed mechanism; exact bipod joint construction; opposite-side fastener placement; scope lens geometry; exact float value and paint seed.
- The images contain baked lighting, so per-channel PBR values and tone-mapping survival cannot be treated as exact inverse-rendering evidence. Region confidence is therefore lower for roughness/metalness than for silhouette or painted placement.

## Per-region confidence

| Region | Confidence | Reason |
|---|---:|---|
| Whole-object family/silhouette | 0.99 | User identity plus two readable broadside views |
| Receiver and stock outline | 0.95 | Strongly visible in both projections |
| Thumbhole/grip/trigger relationship | 0.92 | Clear broadside contour, depth hidden |
| Barrel/muzzle profile | 0.94 | Long profile and muzzle hardware visible |
| Scope silhouette and mounts | 0.90 | Both views show the optic; underside/details occluded |
| Bolt handle/action | 0.88 | External handle visible; internal action hidden |
| Front/back paint placement | 0.96 | Reference pixels directly visible |
| Minimal-Wear distribution | 0.55 | Wear is subtle and lighting is baked in |
| Roughness/metalness/PBR | 0.48 | Inferred from highlights, not measured maps |
| Hidden thickness/underside/internals | 0.25 | Not resolved by the two broadside views |

## Gate decision

The historical intake contract was knife-only and produced the first
`unsupported-family: rifle` stop. The user explicitly authorized the existing
documented rifle/AWP adapter expansion, so the active contract is now
`cs2-rifle-v1` with fixture `cs2-rifle-awp-front-v1`. Geometry may proceed through
the normal evidence, strict-validation, review, and runtime gates.

## Adapter decision

- Route: `reference-projection` with two opposing broadside views.
- Supported family: `rifle`; supported subtype: `awp`.
- Projection inputs: `front-paint.png` and `back-paint.png`, each manually masked to
  the painted shell and de-lit as an approximation.
- The de-lit reports remain below the normal 0.70 material-evidence confidence
  target (`0.63` front, `0.619` back). This is a flagged approximation, not a claim
  of ground-truth PBR recovery.

NotebookLM source-grounded review was completed in notebook `0df2850b-b50f-48af-9db5-67feeed6e04f`, with the two origin images and four local technical sources registered. Its implementation suggestions are retained as evidence, but they cannot override the deterministic repository family gate.
