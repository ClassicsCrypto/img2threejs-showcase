# Scope review — correction loop 1

Status: `REFINE`

## Observed change

- Crown UV V was previously authored as `1 - v`, which inverted the extracted
  sticker crop on the objective bell.
- The crop is now sampled as `v`, preserving the source order: crown above,
  skull/head below.
- The sticker remains a conforming surface layer parented to `scope` and its
  `scope-objective-taper` contact contract is unchanged.
- The ring saddle was lowered and the mount lengthened so both ring mounts
  overlap the Picatinny rail in world space; the gate now measures the actual
  mount meshes rather than incorrectly requiring the optic tube to touch rail.
- Objective/ocular taper radii were re-fit from the two scope crops, and a
  chamfered windage housing with mirrored face/cap was added for both sides.
- The final review replaces the deep mirrored cylinder bodies with one rounded
  housing spanning the optic, so both faces read as a single attached assembly
  rather than two protruding tubes.
- The crown patch is now sized in the conical surface solve itself (`0.31 x
  0.40` footprint) instead of using post-solve group scaling; this keeps the
  larger source mark tangent at its corners in orbit.
- The receiver-parented bolt pivot was lowered from the optic-rail height to
  the receiver flank; the handle and ball now descend from the correct side
  socket in the receiver/bolt crop.

## Evidence

- `.img2threejs/references/scope-back-reference.png`
- `.img2threejs/renders/epoch-current/scope-back-crop.png`
- `.img2threejs/renders/epoch-current/orbit-right-white.png`
- `.img2threejs/renders/epoch-current/orbit-edge-right-white.png`
- `.img2threejs/renders/epoch-current/orbit-top-white.png`
- `.img2threejs/reviews/comparison-scope-front-loop1-final.png`
- `.img2threejs/reviews/comparison-scope-back-loop1-final.png`

## Current judgement

- Orientation: improved and visually correct.
- Attachment: remains seated in the objective surface in the captured orbit.
- Bolt placement: improved; the handle is now below the optic rail and remains
  receiver-parented, but the whole receiver/stock envelope is still below the
  silhouette gate.
- Mechanical attachment gate: pass for rear/front ring-to-rail and ring-to-tube;
  metadata audit pass with 20 attached nodes.
- Still open: the crop framing is not yet a strict pixel-fit to the supplied
  scope plates, crown foil remains lower contrast than the source, and hidden
  optic depth is inferred rather than observed. Keep scope at `refine-code`.
- Decision: `refine-code`; do not advance to the next component.

## Confidence

| Region | Confidence | Reason |
|---|---:|---|
| Crown orientation | 0.97 | Directly visible in the supplied back view and crop review. |
| Crown surface attachment | 0.82 | Confirmed in right and edge orbit, but hidden backside of the conforming patch is not observable. |
| Ring-to-rail attachment | 0.96 | Both actual mount meshes overlap the rail AABB by 0.0101 world units; orbit shows no air seam. |
| Scope taper proportions | 0.78 | Silhouette direction is corrected, but source crop framing and exact hidden depth remain uncertain. |
| Hidden optic interior | 0.20 | Not exposed by either reference view. |
