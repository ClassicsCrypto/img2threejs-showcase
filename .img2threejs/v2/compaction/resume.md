# img2threejs compact resume checkpoint

This file is generated from the authoritative state. Read it for context; use `state.py` and
`next.py` as the authority for ordering and gate decisions. Do not reconstruct progress from chat memory.

- state: `.img2threejs/state-v2.json`
- compaction version: `1`
- status: `active`
- current step: `await-pass-transition`
- current pass: `blockout`
- workflow version: `foundation-first-v2`
- phase: `macro-blockout`
- active family: `receiver-stock-macro-envelope`
- baseline pass: `pass-128`
- loop budget: `114/130 current, 114/130 total`
- locked families: `bolt, scope, projection, materials, micro-detail`

## Next command

```sh
python3 forge/next.py --state .img2threejs/state-v2.json src/demos/awp-medusa-v2/object-sculpt-spec-v2.json
```

## Gate summary

- acceptance target: `0.9`
- macro gate: `map-stripped broadside silhouette IoU >= 0.90 on both supplied views plus landmark/component-station gate`
- assembly gate: `rendered world-space contact/intersection evidence; socket metadata alone is insufficient`
- projection gate: `only after macroBlockout passes; visible-surface, normal, occlusion, and seam masks required`
- stop reason: `none`

## Latest checkpoint

- decision: `rejected-rolled-back-refine-code`
- scope: `receiver-bare-top-envelope`
- next family: `receiver-stock-macro-envelope`
- evidence: `.img2threejs/v2/reviews/review-contract-pass-129.md`

## Read-on-demand evidence

- spec: `src/demos/awp-medusa-v2/object-sculpt-spec-v2.json`
- latestReview: `.img2threejs/v2/reviews/comparison-pass-128-front.png`
- latestRender: `.img2threejs/v2/renders/pass-128/broadside-front.png`
- latestDiagnostics: `{"front":".img2threejs/v2/reviews/diagnostic/pass-128-front.json","back":".img2threejs/v2/reviews/diagnostic/pass-128-back.json"}`
- latestMultiAngle: `.img2threejs/v2/reviews/diagnostic/pass-128-multi-angle.json`
- latestRuntimeManifest: `.img2threejs/v2/renders/pass-128/runtime-manifest.json`
- latestFeatureReview: `.img2threejs/v2/reviews/feature-reviews-pass-128.json`
- latestReviewContract: `.img2threejs/v2/reviews/review-contract-pass-128.md`
- latestCs2Review: `.img2threejs/v2/reviews/cs2-review-pass-128.json`
- latestPartCoverage: `.img2threejs/v2/reviews/part-coverage-pass-128.json`
- latestNotebookAudit: `.img2threejs/v2/reviews/notebooklm-loop123-bolt-audit.md`

## Pending mandatory steps

- `action-ready`

## Resume rules

- Load this snapshot first; do not paste the full state or pass history into context.
- Run `forge/state.py status --state <active-state.json>` and `forge/next.py --state <active-state.json> <spec>` before edits.
- Read full history only for a retrospective, regression investigation, or the active family evidence review.
- Keep the state file authoritative and regenerate this snapshot after every state save.
