# NotebookLM audit — loop 10 — 24 angles

## Scope

NotebookLM reviewed the two origin images, the technical/reference sources, 24 separate current-render angle images, `muzzle-face-close.png`, and `scope-ring-contact-crop.png`. The answer is preserved verbatim in `notebooklm-loop10-24-angle-answer.txt`.

## NotebookLM result

NotebookLM verdict: **REFINE**.

It reported: the overall silhouette is recognizable but the receiver/stock transition is blocky; scope-ring contact remains visually ambiguous and fasteners are too simple; the crown orientation is correct but the sticker reads too thick; the bolt is correctly below/beside the scope but its usable grip is short; the muzzle has an open shell but the bore reads as a flat black disk; the bipod spring does not read as a continuous helix at review scale; Medusa remains centered but stretches at grazing thumbhole/safety regions; scope glass reads opaque/matte and the buttpad lacks rubber response.

NotebookLM's five suggested priorities were: bipod spring readability, recessed muzzle bore, scope-ring visual contact, reflective scope glass, and a longer bolt handle.

## Local reconciliation

- **Bipod helix:** the recommendation to replace the spring with a true `TubeGeometry` helix is already satisfied in code. The loop 9 change increased tubular resolution from 64/8 to 96/12. This remains a **visual readability** defect, not a topology absence; the next fix should improve contrast/scale/profile, not replace the valid construction blindly.
- **Scope rings:** deterministic attachment metadata passes and the enlarged local crop shows the support bars meeting the rail/tooth region. NotebookLM's “gap” is therefore recorded as a **visual review issue** requiring a camera/contrast and contact-shadow check, not proof that the nodes are disconnected. The next pass should make the physical seating unmistakable and use cylindrical cap/hex fasteners.
- **Muzzle:** loop 9 changed the outer muzzle shell to an open-ended cylinder so its end cap cannot hide the aperture. The direct close-up proves a dark aperture behind the crown/lip, but NotebookLM is right that the current inner-wall read is weak. Add a clearly recessed inner bore wall and highlight without using a flat black face as the only cue.
- **Scope glass:** code already uses a recessed physical glass material with metalness, low roughness, transmission, environment intensity, and iridescence. The review still reads it as opaque because the current light/background does not produce a strong reflection. Improve reflection readability rather than merely setting roughness to zero.
- **Crown:** orientation is confirmed crown-up/skull-down. The remaining issue is thin decal contact and foil response; do not rotate it again.
- **Medusa projection:** authored front/back side surfaces remain the source of the paint and the runtime attachment gate passes. Grazing-angle stretching near the thumbhole/seam remains a known P1 visual issue.

## Confidence by region

| Region | NotebookLM confidence | Local disposition |
| --- | ---: | --- |
| Silhouette/proportions | 0.90 | Refine receiver/stock blockiness |
| Scope assembly | 0.60 | Refine visual contact and fasteners |
| Crown/skull sticker | 0.70 | Keep orientation; thin/contact foil pass |
| Receiver/stock/bolt | 0.80 | Lengthen usable bolt grip; refine magazine |
| Barrel/muzzle | 0.50 | Add visibly recessed inner bore wall |
| Bipod | 0.40 | Keep true helix; improve readability and hinge depth |
| Medusa paint | 0.80 | Refine grazing thumbhole/seam mask |
| Material classes | 0.70 | Improve glass reflection and rubber buttpad |

## Gate disposition

This audit does **not** advance the quality gate. Verdict is REFINE: strict-quality and Tier 1 still fail, and the report identifies P1 visual issues. The next loop must address the five priorities while preserving the already-passing runtime attachment/pivot/tick metadata.

