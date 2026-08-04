# AWP Medusa V2 foundation-first workflow contract

This file is the project-local execution contract for the generic
`$img2threejs` workflow. The generic rules live in
`/Users/tamlh/.codex/skills/img2threejs/grimoire/review/foundation_first_workflow.md`;
this file binds them to the AWP V2 state without changing V1.

## Objective

Rebuild the supplied AWP | Medusa references as a real procedural Three.js object. The
workflow must improve measured 3D structure and attachment before any projection, material,
or micro-detail work is allowed to influence likeness.

## Phase order

`intake → calibration → macro-blockout → assembly → surface → final-audit`

- `intake`: source admission, observed/derived/inferred/unknown labels, detail inventory,
  family classification, and source bounds.
- `calibration`: camera packet, normalized landmark matrix, region bounds, and confidence.
- `macro-blockout`: map-stripped silhouette, proportions, thickness, component stations, and
  negative spaces for stock, receiver, barrel, scope, bolt, trigger/guard, magazine, and bipod.
- `assembly`: real component hierarchy, sockets, pivots, contact/intersection evidence, and
  functional relationships.
- `surface`: projection/decal/paint, PBR, wear, fastener finish, and controlled micro-detail.
- `final-audit`: multi-angle, strict quality, coverage, runtime, and action-ready checks.

## Current checkpoint

- `workflowVersion`: `foundation-first-v2`
- `phase`: `macro-blockout`
- `baselinePass`: `pass-128`
- `activeFamily`: `receiver-stock-macro-envelope`
- `lockedFamilies`: `bolt`, `scope`, `projection`, `materials`, `micro-detail`
- `currentStep`: `await-pass-transition`
- `nextLoopStarted`: `false`
- `familyAttempts`: `1/2 failed` (pass-129 receiver-bare-top-envelope, rejected/rolled back)
- V1 remains immutable; do not copy its transforms or geometry profiles.

Pass 128 is retained provisionally for evidence only. Its broadside macro gate remains failed
(front/back IoU `0.7823/0.7796`, target `0.90`). Pass 129 tested one receiver-bare-top-envelope
hypothesis in the `receiver-stock-macro-envelope` family; it regressed IoU to `0.7798/0.7764` and
was rolled back byte-for-byte (see `.img2threejs/v2/measurements/pass-129-receiver-bare-top-envelope.md`
and `.img2threejs/v2/reviews/review-contract-pass-129.md`). This is a safe pause, not an
acceptance claim. The next loop must try a different hypothesis in this family before a second
failure would require remeasurement/new foundation epoch.

## Correction-loop contract

Each loop must name one active family and one falsifiable hypothesis before code changes. The
record must include:

1. accepted baseline pass and source regions;
2. allowed files/components and explicitly locked families;
3. target metrics (region bbox/landmarks/silhouette and contact metrics where applicable);
4. rollback conditions, including any critical-region regression;
5. render evidence from the fixed broadside stations plus at least two stress orbits;
6. review decision: `retain`, `refine`, `rollback`, `request-input`, or `stop`.

Global scores cannot hide a failed critical region. If two hypotheses in the same family fail,
stop nudging that family, remeasure the source/camera/region matrix, and begin a new foundation
epoch before trying another implementation.

## Resume rule

At resume, read `state-v2.json`, this contract, `awp-v2-handoff.md`, and the latest review
artifacts. Then run:

```sh
python3 /Users/tamlh/.codex/skills/img2threejs/forge/next.py \
  --state .img2threejs/state-v2.json \
  src/demos/awp-medusa-v2/object-sculpt-spec-v2.json
```

Do not start a new pass while the state reports `await-pass-transition` until the next family,
hypothesis, metrics, and rollback conditions are written to the state/review record. The first
eligible family after this checkpoint is `receiver-stock-macro-envelope`; do not touch bolt,
scope, projection, materials, or micro-detail in that loop.

## Evidence required to unlock later phases

- Macro unlock: map-stripped front/back silhouette and region gates pass; component stations and
  critical negative spaces are stable.
- Assembly unlock: rendered contact crops and world-space closest-point/intersection evidence
  pass for every authored attachment; node names/sockets alone do not pass.
- Surface unlock: projection/decal masks are restricted to authored visible shell surfaces and
  cannot compensate for geometry errors.
- Final unlock: strict quality, multi-angle non-degeneracy, per-region confidence, coverage,
  pivots/sockets, and `userData.tick` all pass.
