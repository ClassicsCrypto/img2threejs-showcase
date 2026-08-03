# NotebookLM audit — AWP Medusa correction baseline

Notebook: `8391cfbf-8d82-4edc-be6a-59dda24cc318`  
Audit date: 2026-08-03  
Inputs: two origin references, 18 numbered angle renders, 6 named orbit renders, technical-source bundle.

## Evidence boundary

The target identity is the CS2 `AWP | Medusa (Minimal Wear)`. Accuracy International AW/AWM/AXMC documents are construction priors for hierarchy and articulation only. They must not overwrite a visible CS2 feature. Exact CS2 millimetre dimensions remain UNKNOWN unless directly visible or sourced.

## NotebookLM findings

### Global silhouette

- Confidence: 0.85.
- P0 OBSERVED: barrel-to-stock proportion is too short in the current QA renders.
- P1 OBSERVED: receiver and stock are blocky primitives, lacking the refined ergonomic profile of the origin images.
- P2 OBSERVED: muzzle opening/bore is not visibly modeled.
- SUPPORTED calibration prior: an AW-family 24-inch barrel is a prior only; CS2 exact length remains UNKNOWN.
- IMPLEMENTATION: refit the barrel-to-stock ratio from the origin silhouette and author a real muzzle ring plus dark interior bore, not a flat cap.

### Scope

- Confidence: 0.90.
- P0 OBSERVED: objective taper is oversized and front glass is unreadable; scope rings and turret knobs do not match the origin construction.
- P1 SUPPORTED: a 34 mm main tube / 56 mm objective is a real optic prior, not a CS2 exact dimension.
- P2 OBSERVED: crown-up/skull-down sticker orientation is required.
- IMPLEMENTATION: refit objective bell; use a recessed glass surface with physical transmission/reflectivity; keep the crown as a conforming decal attached to the bell; rebuild rings, mounts, turret bases, knobs, caps, and fasteners as separate attached components.

### Receiver and action

- Confidence: 0.80.
- P0 OBSERVED: bolt handle is too short and lacks the ergonomic bend; magazine seating/shape is coarse.
- P1 SUPPORTED: the AI action is a bolt-action construction prior; 60-degree throw and ~20 mm bolt body must not be treated as exact CS2 dimensions.
- P2 OBSERVED: ejection-port and fastener detail is absent or unreadable.
- IMPLEMENTATION: keep bolt body and handle receiver-parented, extend the handle to a usable grip, and seat a chamfered magazine into a visible receiver magazine well.

### Trigger group

- Confidence: 0.85.
- P0 OBSERVED: trigger guard is misplaced relative to the thumbhole.
- P1 SUPPORTED: the platform uses an adjustable two-stage trigger as a mechanical prior.
- P2 OBSERVED: trigger pivot/blade detailing is missing or unclear.
- IMPLEMENTATION: align the trigger pivot and blade inside a closed guard whose socket is owned by the receiver/stock junction; preserve a real thumbhole opening rather than a camera-only cutout.

### Bipod

- Confidence: 0.75.
- P0 OBSERVED: hinge/lock/spigot placement is poorly defined in the QA set.
- P1 SUPPORTED: spigot/socket attachment, telescoping legs, and a central pivot are construction priors.
- P2 OBSERVED: feet are blocky and do not match the bootie-like source silhouette.
- IMPLEMENTATION: keep the authored `TubeGeometry` helix springs; fix the spigot/socket and hinge ownership, continuous telescoping legs, collars, and source-shaped feet. NotebookLM described the spring as a low-fidelity sprite, but current code inspection confirms a real 193-point TubeGeometry helix; this specific claim is marked NEEDS RECHECK, not accepted as fact.

### Materials and texture

- Confidence: 0.80.
- P0 OBSERVED: painted/composite and metal zones lack contrast; Medusa continuity is broken across sides/orbits.
- P1 INFERRED: the skin requires higher-fidelity UV/projection continuity for Minimal Wear detail.
- P2 OBSERVED: crown foil lacks a convincing specular response.
- IMPLEMENTATION: preserve authored component geometry and bind the Medusa treatment to those components; prevent dark-blue tone-mapping crush; use a physically reflective/transmissive material for glass and controlled foil response for crown.

### Connectivity findings

- CONFIRMED P0: floating bipod spigot in `angle-09`.
- CONFIRMED P0: receiver/stock gap in `angle-10`.
- CONFIRMED P0: scope-ring intersection/overlap with rail in `angle-11`.
- OCCLUSION/lighting caveat: black regions in `angle-15` and `angle-18` are not proof of missing geometry.

## Ranked next correction loop

1. Refine barrel-to-stock length ratio and real muzzle bore.
2. Verify bipod spigot socket and hinge attachment; retain true helix geometry.
3. Refine objective taper and add recessed reflective/transmissive front and eyepiece glass.
4. Align scope rings, rail saddles, turret bases/knobs and screws without overlap or floating parts.
5. Align trigger guard/blade with thumbhole and receiver/stock junction.
6. Extend the receiver-parented bolt handle to a usable bent grip.
7. Refine magazine seating/shape and buttpad/stock envelope.
8. Audit Medusa continuity and tone-mapping across both side and orbit views.

## Do-not-advance gates

- Scope: bell, rings, turrets, glass and crown must be attached and readable.
- Action/trigger: bolt handle must have ergonomic reach; trigger blade must be inside the guard.
- Bipod: spigot cannot float; legs/springs/feet must be connected authored geometry.
- Texture/orbit: Medusa must remain bound to the authored stock/receiver components on both sides.
- Strict quality: no camera-only shell, floating decal, or flat cap substituted for a component.

## Calibration priors, not CS2 claims

| Item | Prior | Status |
|---|---:|---|
| AW-family overall length | ~1120 mm with spacers | SUPPORTED prior; CS2 UNKNOWN |
| AW-family barrel | 24 in / 27.25 in variants in sources | SUPPORTED prior; CS2 UNKNOWN |
| Bolt opening | ~60 degrees | SUPPORTED prior; CS2 UNKNOWN |
| Scope main tube | 34 mm | SUPPORTED optic prior; CS2 UNKNOWN |
| Magazine | 10-round double stack | SUPPORTED AW-family prior; CS2 visible shape must win |

## Unsupported claims not to code

- Exact millimetres of the CS2 Medusa mesh.
- Hidden trigger springs/sears.
- Manufacturer markings not visible in the supplied CS2 refs.
- Internal firing-pin state unless explicitly animated.

## Local implementation note

This is a research/audit artifact, not a pass approval. The current tier-1 silhouette remains below threshold and strict-quality remains false. The 24 QA image sources remain in NotebookLM until this audit is converted into a local review record; then they may be deleted per user authorization.
