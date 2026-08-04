# AWP Medusa V2 rebuild contract

## Authority

- Active version: `awp-medusa-v2`.
- Authority: `.img2threejs/state-v2.json`.
- Frozen baseline: AWP Medusa V1. V1 data is read-only and must not be edited.
- External research: `.img2threejs/research/external-image-to-3d-brief-2026-08-03.md`.

## Reconstruction objective

Build a procedural Three.js AWP | Medusa (Minimal Wear) from the supplied front/back broadside images without fake depth extrusion, camera-facing billboards, or texture used as geometry. The model must expose real component groups, pivots, sockets, and `userData.tick`.

## Authoritative references

- Front broadside: `public/front-medusa.webp`
- Back broadside: `public/back-medusa.webp`

Supplemental reference images may inform mechanical terminology or component topology, but they do not replace these two source images for silhouette, framing, or projection comparison.

## V2 non-negotiables

1. Treat the two source images as opposing broadside evidence, not calibrated stereo.
2. Produce a measured reference packet before geometry code: masks, camera hypothesis, landmark matrix, region matrix, component ownership, and observability/confidence.
3. Rebuild stock, receiver, barrel, trigger/guard, magazine, bolt station, scope station, and bipod macro geometry. Do not copy failed V1 geometry profiles or transforms.
4. Use real geometry for fasteners, scope rings, bolt, trigger, magazine, hinge, springs, legs, feet, and muzzle bore.
5. Projection is a visible-surface finish route only. It cannot repair a wrong profile or component station.
6. Use rendered contact/intersection evidence. Socket metadata and node counts are not sufficient.
7. Keep hidden depth and hidden fasteners explicitly uncertain.

## Locked order

`reference audit → landmark matrix → camera solve → macro blockout → map-stripped silhouette gate → semantic assembly/contact gate → projection → material/wear → orbit/runtime/optimization`

## Gates

- Macro blockout: silhouette IoU `>= 0.90` on both supplied broadside views, correct aspect/scale, and component-station checks for stock/receiver/barrel/scope/bipod.
- Assembly: rendered contact crops plus world-space closest-point/intersection checks for every attachment; metadata alone cannot pass.
- Projection: front/back pixels only on authored visible shell surfaces with normal/occlusion/seam masks.
- Orbit: at least three stress orbits show no projection drift, floating hardware, or component separation.
- Completion: all critical features meet `>= 0.90`; hidden regions carry confidence values.

## Evidence labels

- `observed`: directly visible and measured in a supplied image.
- `derived`: computed from observed landmarks/masks.
- `inferred`: mechanical or symmetry assumption required by missing views.
- `unknown`: not defensible from current references.

## Forbidden shortcuts

- No side-card or camera-facing shell geometry.
- No broadside texture used to hide an incorrect 3D silhouette.
- No detail pass before the macro gate.
- No claims that V1 metadata attachment proves physical correctness.

## Workflow revision — foundation-first / paused after pass 129 rollback

The active execution contract is now `foundation-first-v2`, defined in
`.img2threejs/v2/workflow/foundation-first-workflow-v2.md` and derived from the generic
`$img2threejs` foundation-first workflow. The phase order is:

`intake → calibration → macro-blockout → assembly → surface → final-audit`

The current checkpoint is deliberately paused at `await-pass-transition`:

- retained baseline: `pass-128` (provisional evidence, not acceptance);
- rejected experiment: `pass-129` (rolled back after macro IoU regression);
- current phase: `macro-blockout`;
- next family: `receiver-stock-macro-envelope`;
- locked families for the next loop: `bolt`, `scope`, `projection`, `materials`, `micro-detail`;
- no `pass-130` has started.

The next loop must record a different falsifiable receiver/stock macro hypothesis, its region metrics,
allowed changes, locked families, and rollback conditions before editing code. Broadside
map-stripped silhouette and per-region gates remain authoritative; projection and finish cannot
unlock or compensate for a failed macro gate. Two failed hypotheses in one family require
remeasurement and a new foundation epoch rather than more coordinate nudges. V1 remains
immutable.
