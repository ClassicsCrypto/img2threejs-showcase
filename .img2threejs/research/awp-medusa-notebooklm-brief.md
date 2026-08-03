# AWP | Medusa correction audit brief

Role: TECHNICAL_SOURCE + QA_CONTEXT. This document is a request for source-grounded
analysis, not authoritative geometry. The supplied images are a CS2 AWP | Medusa
(Minimal Wear) game item; do not assume that every dimension or component is identical
to a real Accuracy International rifle.

## Current implementation defects to verify

- barrel appears too short; muzzle opening / bore is not visibly modeled;
- receiver and stock read too large and blocky;
- scope eyepiece and objective should read as reflective glass, while the scope body is
  matte coated metal;
- objective taper is oversized and lacks a readable front lens/glass surface;
- front/rear scope rings, clamp widths, turret knobs, and fasteners do not match the
  reference construction;
- trigger guard is misplaced; magazine is too coarse;
- bolt handle is too short for a usable grip and must remain receiver-parented;
- bipod hinge, lock, folded tubes, feet, and coil spring need source-consistent placement;
- stock buttpad and all visible screws need real attached geometry;
- Medusa and crown must remain attached on front/back/orbit; crown is crown-up,
  skull/head-down.

## Required evidence labels

For every claim use exactly one of OBSERVED, SUPPORTED, INFERRED, UNKNOWN, or
IMPLEMENTATION. Do not present a real-rifle measurement as the exact CS2 mesh size.
Separate the CS2 silhouette evidence from real Accuracy International AW/AWM/AWP
technical construction. Call out contradictions between the supplied front/back images
and the 24 current procedural renders.

## Questions for the technical review

1. Which real platform is the CS2 AWP most closely analogous to, and which details must
   not be transferred from the real platform without visual evidence?
2. For a bolt-action Accuracy International-style rifle, what are the mechanically
   correct parent/child relationships for receiver, bolt body, bolt handle, trigger
   guard, magazine, barrel, muzzle brake/bore, scope rail, rings, and bipod hinge?
3. What dimensions or ratios are documented for the real platform (overall length,
   barrel length, receiver/stock envelope, bipod folded reach), and how should they be
   used only as a calibration prior when the two game-item views have no scale marker?
4. What is the correct visual construction of a scope: objective bell, objective glass,
   ocular/eyepiece glass, turret housing, two rings, rail, screws, and reflective
   response? Which parts are glass, coated metal, or polymer?
5. What is the correct folded bipod construction: hinge plate, axle, locking lug,
   telescoping tubes, compression coil spring, collars, and feet? Which features are
   directly visible in the supplied images versus inferred?
6. Review each of the 24 QA renders against the two origin images. List P0/P1/P2
   findings by region, with confidence and a concrete procedural Three.js fix. Do not
   reward a frontal projection if an orbit exposes a shell, gap, or floating decal.

## Three.js route constraints

The target is a real procedural assembly: custom/profile geometry for stock and
receiver, cylinders/tubes only where the component is genuinely cylindrical, a true
TubeGeometry helix for the spring, a boolean/shape opening for the muzzle bore and
thumbhole, conforming surface layers only on authored receiving meshes, and explicit
parent sockets/pivots. No depth-extruded image, camera-facing billboard, root projection
shell, or fake component is acceptable.
