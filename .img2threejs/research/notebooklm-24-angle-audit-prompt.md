You are the independent evidence reviewer for a procedural Three.js reconstruction of the CS2 item AWP | Medusa (Minimal Wear).

Use the two origin images, all 24 separate QA renders, and the technical sources in this notebook. Inspect each QA image individually; do not treat a black/unlit region as proof that geometry or texture is absent. Separate statements into exactly one of: OBSERVED (visible in an image), SUPPORTED (technical source), INFERRED (reasonable reconstruction hypothesis), UNKNOWN (not recoverable from the supplied evidence), and IMPLEMENTATION (actionable Three.js correction).

First state the identity boundary: the target is the CS2 AWP | Medusa appearance, while Accuracy International AW/AWM/AXMC references are construction priors only. Never overwrite a visible CS2 feature with an unsupported real-rifle feature. Do not invent exact CS2 dimensions. Use real dimensions only as scale/calibration priors and label them SUPPORTED/INFERRED.

Audit every requested group:
1. Global silhouette and proportions: barrel-to-stock length, receiver and stock envelope, buttpad, bore/muzzle opening.
2. Scope: tube length/diameter, objective taper and front glass, eyepiece/ocular mirror/glass, two ring widths and positions, rail attachment, turret bases/knobs/caps, screws/fasteners, crown-skull sticker orientation and surface attachment.
3. Receiver and action: bolt position as receiver child, bolt handle reach/grip, ejection port, fasteners, magazine seating and shape.
4. Trigger group: trigger pivot, blade, guard location and connection to receiver/stock, thumbhole alignment.
5. Bipod: hinge plate, pivot pin, lock lug, two continuous telescoping legs, true helical coil springs, collars, feet and attachment to the fore-end.
6. Materials: dark painted/composite zones vs metal, glass reflectivity/transmission, crown foil, Medusa projection continuity on both sides and orbit views. Identify tone-mapping risks.
7. Connectivity: list every visible gap/floating/intersection and whether it is a confirmed topology/placement error or just occlusion/lighting.

For each group provide:
- per-region confidence 0.00–1.00;
- P0 (identity/topology/connectivity), P1 (major proportion/material), P2 (fine detail) findings;
- evidence source names or image numbers;
- a minimal implementation correction that can be expressed as authored Three.js components, parent-child attachment, pivot/socket, conforming decal, or physically plausible material. Reject camera-only shells, depth-map extrusion, and floating decals.

Conclude with:
- a ranked next-loop action list (maximum 8 actions);
- “do not advance” gates for scope, action/trigger, bipod, texture/orbit, and strict-quality;
- a short table of dimensions or ratios that are safe as calibration priors, with the caveat that exact CS2 dimensions remain UNKNOWN unless visible or directly sourced;
- a final list of unsupported claims that must not be coded.
