Audit the current correction-loop render of CS2 AWP | Medusa (Minimal Wear) using the two origin references, the 18 separate angle-01 through angle-18 images, and the technical sources already in this notebook.

The current procedural model has real authored geometry for receiver, stock, scope, rail, rings, turret, bolt, trigger guard, magazine, muzzle/bore, bipod hinge/lock/legs/feet, and a TubeGeometry coil. It also has front/back conforming Medusa layers and a material edge projection on the real extrusion side faces. Do not assume a dark region means missing geometry. Distinguish the CS2 appearance from Accuracy International construction priors.

Use these labels for every claim: OBSERVED, SUPPORTED, INFERRED, UNKNOWN, IMPLEMENTATION. Inspect every numbered angle separately, not a montage. For each region report confidence 0.00–1.00 and classify P0 identity/topology/connectivity, P1 major proportion/material, or P2 fine detail.

Audit and compare:
1. global silhouette, barrel length, bore/muzzle, receiver and stock envelope, buttpad;
2. scope tube, objective taper, objective/eyepiece glass reflection, rings/rail/saddles, turret bases/knobs/caps/screws, crown-up/skull-down sticker attachment;
3. receiver, bolt-parenting, handle reach/bend, ejection port, fasteners, magazine well and magazine;
4. trigger pivot/blade/guard and thumbhole alignment;
5. bipod spigot/socket, hinge plate, lock lug/pin, continuous legs, collars, true coil springs, feet;
6. Medusa continuity on front/back/edge/orbit and whether edge projection creates unsupported stripes or remains source-grounded;
7. visible gaps, floating meshes, intersections and component-parent errors.

For every P0/P1 finding give a concrete minimal Three.js correction with exact component ownership/pivot/socket/material strategy. Reject camera-only shells, depth extrusion, floating decals and invisible components used as proof.

Conclude with:
- ranked next correction actions (max 8);
- per-region confidence table and hidden-side confidence;
- lock gates for scope, action/trigger, bipod, texture/orbit and strict quality;
- which previous loop changes should be kept or reverted;
- exact claims that remain UNKNOWN and must not be coded as facts.
