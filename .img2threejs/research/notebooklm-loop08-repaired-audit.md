# NotebookLM repaired-ledger loop 08 audit — 24 separate angles + 2 crops

- Notebook: `8391cfbf-8d82-4edc-be6a-59dda24cc318`
- Uploaded QA: 24 separate turntable images, plus separate `scope-ring-contact-crop.png` and `muzzle-face-close.png`
- Verdict: **REFINE**
- Confidence: **0.85**
- This audit belongs to the repaired authoritative ledger (`8/20`); it supersedes the older historical `loop8-24-angle` entry.

## Observed

- The new paired vertical hex heads and washers are attached 3D geometry, not floating billboards.
- Scope rings are coaxial with the tube and visually seated on the rail saddles.
- Objective and ocular faces show a distinct specular response consistent with coated physical glass.
- Crown is crown-up/skull-down and remains tangent to the objective taper.
- Muzzle has a visible open aperture and inner depth.
- Bipod spring is a readable `TubeGeometry` helix.
- Medusa paint remains on authored stock/receiver surfaces at grazing angles; no floating shell was identified.
- Receiver and stock still read too rectangular/blocky; trigger guard and magazine remain coarse.

## Inferred / unknown

- Magazine beveling and release detail need refinement; this is an inference from the supplied broadside views.
- Internal chamber and exact Picatinny channel depth are not visible and remain unknown.
- No absolute centimetre calibration is claimed from the two source plates.

## Region scorecard

| Region | Confidence | Severity | Result |
|---|---:|---|---|
| Scope rings, clamps, fasteners | 0.95 | P1 | PASS for contact/readability |
| Objective/eyepiece glass | 0.95 | P1 | PASS for reflective physical surface |
| Crown and Medusa seating | 0.95 | P2 | PASS |
| Muzzle/bipod spring | 0.90 | P1 | PASS for open bore/true helix |
| Trigger/magazine assembly | 0.80 | P1 | REFINE |
| Receiver/stock macro silhouette | 0.85 | P0 | REFINE |

## Explicit checks

- Ring-to-rail contact: **YES**
- Ring-to-tube contact: **YES**
- Glass reflection: **YES**
- Crown orientation/contact: **YES**
- Bolt below optic: **YES**
- Trigger placement/read: **NO — still blocky**
- Bipod spring: **YES — true helix**
- Muzzle bore: **YES**
- Medusa seating: **YES**

## Next smallest correction

Refine receiver and stock local fillets/taper non-linearly. Do not uniformly scale the macro groups: the previous uniform-thinning experiment regressed Tier1 IoU. Preserve the now-accepted scope, crown, muzzle and helix components while changing only the receiver shoulder, stock thumbhole-to-buttpad contour, and then re-check trigger contact.

## Gate reconciliation

- Build: passed.
- strict-quality: passed.
- part coverage: 0 errors / 0 warnings.
- multi-angle degenerate detector: passed (`degenerate=false`).
- Tier1: still failed (`IoU 0.5425`, aspect delta `0.0633`, scale delta `0.0676`); this prevents advancing the pass.
