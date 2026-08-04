# AWP Medusa V2 compaction-safe handoff

## Current goal

Rebuild AWP | Medusa (Minimal Wear) as a new procedural Three.js model using the external researched workflow. V1 remains frozen; do not modify it.

## Authoritative source images

- `front-broadside`: `public/front-medusa.webp`
- `back-broadside`: `public/back-medusa.webp`
- Absolute front path: `/Users/tamlh/workspaces/self/AI/img2threejs-org/img2threejs-showcase/public/front-medusa.webp`
- Absolute back path: `/Users/tamlh/workspaces/self/AI/img2threejs-org/img2threejs-showcase/public/back-medusa.webp`

Supplemental real-AWP images are research-only and must not replace these two source images for silhouette, framing, or projection comparison.

## Read before any action

1. `.img2threejs/state-v2.json`
2. `.img2threejs/awp-v2-rebuild-contract.md`
3. `.img2threejs/research/external-image-to-3d-brief-2026-08-03.md`
4. `/Users/tamlh/.codex/skills/img2threejs/SKILL.md`
5. `/Users/tamlh/.codex/skills/img2threejs/grimoire/intake/image_analysis.md`

## Frozen V1

- State: `.img2threejs/state.json`
- Spec: `src/demos/awp-medusa/object-sculpt-spec.json`
- Code: `src/demos/awp-medusa/createAwpMedusaModel.ts`
- Best known silhouette IoU: `0.5986`; this is baseline evidence, not a target to preserve.
- Do not edit, reset, delete, or append V2 reviews to V1 files.

## V2 paths

- State: `.img2threejs/state-v2.json`
- Spec: `src/demos/awp-medusa-v2/object-sculpt-spec-v2.json`
- Entry: `src/demos/awp-medusa-v2/createAwpMedusaModelV2.ts`
- Active procedural core: `src/demos/awp-medusa-v2/awpMedusaV2Core.ts`
- Artifacts: `.img2threejs/v2/`

## Required first step

Run the versioned state gate first:

```sh
python3 /Users/tamlh/.codex/skills/img2threejs/forge/next.py \
  --state .img2threejs/state-v2.json
```

Read `.img2threejs/v2-rebuild-plan.json`, then complete the intake/measurement packet before authoring `object-sculpt-spec-v2.json` or writing geometry code:

`reference masks → normalized landmark matrix → region matrix → camera hypothesis → observability/confidence → V2 spec`

## Do not forget

- The first V2 gate is map-stripped macro silhouette, not texture likeness.
- Use the 0.90 acceptance target.
- Do not reuse V1 stock/receiver/trigger/bolt profiles.
- NotebookLM is research evidence, not the visual pass/fail judge.
- If compacted, recover from this file and `state-v2.json`, not chat memory.

## Latest retained correction loop

- `pass-17` retained a camera-only correction in `src/demos/registry.ts`:
  `captureTargetOffsetY=0.08` and `captureTargetOffsetYBack=0.08`.
- Evidence: `.img2threejs/v2/renders/pass-17/` and
  `.img2threejs/v2/reviews/comparison-pass-17-front.png`.
- Result: FRONT/BACK silhouette IoU `0.6949/0.6827`; macro gate still fails.
- Pass-13/14/15/18 geometry experiments were rejected and are not part of the active model.
- `pass-19` retained a stock lower-contour station refinement; `pass-20` retained a quadratic
  molded lower-shell contour in `awpMedusaV2Core.ts`. The pass-20 comparison sheets are
  `.img2threejs/v2/reviews/comparison-pass-20-front.png` and
  `.img2threejs/v2/reviews/comparison-pass-20-back.png`.
- Pass-20 remains below the macro gate at FRONT/BACK silhouette IoU `0.6963/0.6849`.
- NotebookLM construction audit after pass-20 is recorded at
  `.img2threejs/v2/reviews/notebooklm-loop20-construction-audit.md`. It confirms the next
  evidence-backed target is receiver/chassis ownership and scope mount hardware; it also
  confirms the bipod springs must remain independent parallel compression/tension coils with
  hooks and collars, not coils wrapped around the legs.
- Next action: refine receiver/chassis as separate real component geometry using crop-local
  landmarks, then re-capture and gate. Keep the camera offset and independent spring topology;
  do not advance to projection.
- `pass-21` retained a separate embedded machined receiver action block, seam, and action
  fasteners. IoU remained `0.6963/0.6849`; the block is semantically useful but still too
  recessed and the fasteners are too prominent.
- `pass-22` retained real scope-ring clamp caps, side plates, and upper/lower screw heads.
  IoU is `0.6946/0.6834`; the deterministic gate remains failed. NotebookLM loop-22 audit is
  recorded at `.img2threejs/v2/reviews/notebooklm-loop22-construction-audit.md` and flags rings
  as too wide/mis-stationed, rail teeth as too tall, and the side plate as too thick/floating.
- Next action: re-author the trigger guard/pistol-grip fillet as watertight real geometry and
  verify shell contact. Keep projection locked; after that, refine ring width/station and rail
  height without inventing dimensions.
- `pass-23` moved the trigger guard forward of the thumbhole and added a real swept shell bridge
  plus pivot pins. IoU is `0.6956/0.6841`; the change is retained but the receiving stock/grip
  fillet is still not source-fitted and the macro gate remains failed.
- Next action: fit the receiving stock/pistol-grip contour around the guard from the crop-local
  landmarks, then capture a close-up and both broadsides. Do not advance projection.
- `pass-24` added the curved stock/pistol-grip receiving fillet and improved physical guard contact.
  IoU is `0.6967/0.6849`; the change is retained provisionally. NotebookLM loop-24 audit is at
  `.img2threejs/v2/reviews/notebooklm-loop24-construction-audit.md`.
- Loop-24 audit confirms the independent bipod spring architecture, but still flags simplified
  feet, smooth magazine, flat scope glass/turrets, and unreadable muzzle bore. Next correction
  targets one of those real mechanical deficits; projection remains blocked.
- `pass-25` retained a real annular muzzle face and recessed inner bore. Dedicated evidence is at
  `.img2threejs/v2/renders/pass-25/muzzle-close.png`; front/back IoU is `0.6954/0.6852` and the
  macro gate remains failed. Next action is scope glass/turret or stamped magazine geometry.
- `pass-26` retained single recessed eyepiece/objective glass surfaces and added a separate central
  turret housing/shoulder. Scope close-up evidence is `.img2threejs/v2/renders/pass-26/scope-close.png`;
  front/back IoU is `0.6968/0.6863`. The macro gate remains failed; ring width/station, magazine
  ribs, and bipod feet remain open.
- `pass-27` retained a slimmer scope-ring/clamp profile, corrected the objective-side ring station,
  reduced screw prominence, and lowered rail teeth. IoU improved to `0.6991/0.6881`; macro gate
  remains failed. Next action is stamped magazine ribs or supported bipod feet.
- `pass-28` made the magazine/well/ribs real and visible, but IoU regressed to `0.6932/0.6822`.
  NotebookLM loop-28 identifies the local correction: keep the well internal and align the visible
  magazine flush to the stock cutout and trigger-guard forward edge.
- `pass-29/30` added and then reduced real bipod boot/collar/end-cap geometry; IoU was
  `0.6928/0.6814`, so feet are not locked. Preserve the supported independent springs.
- `pass-31` tested a lower magazine/well station and rejected it after IoU fell to
  `0.6858/0.6756`; `pass-32` restored the previous station. Evidence and rollback rationale are
  in `.img2threejs/v2/reviews/feature-reviews-pass-31.json` and `feature-reviews-pass-32.json`.
- `pass-33` extended the real receiver-parented bolt handle below the optic. The bolt close-up is
  `.img2threejs/v2/renders/pass-33/bolt-close.png`; broadside IoU is `0.6904/0.6806` and the
  macro gate remains failed.
- `pass-34` raised the folded bipod toward the fore-end, reduced the receiver lower belly,
  narrowed the guard curve, and widened the buttpad. IoU improved to `0.7321/0.7225`, but the
  trigger guard, stock/receiver profile, and bipod station remain provisional.
- `pass-35` changed the thumbhole to a taller real negative-space cut and widened the cheek rest
  and buttpad. IoU is `0.7323/0.7234`; this is the current retained build, still below both the
  `0.85` diagnostic and `0.90` acceptance gates. Current evidence is
  `.img2threejs/v2/reviews/comparison-pass-35-front.png` plus the pass-35 render/orbit directory.
- The original 20-loop bound was extended to 30 in `state-v2.json` because the macro gate failed
  without an external blocker and the persistent goal requires continued correction. The state is
  active at loop `22/30`; do not advance to projection until macro blockout passes.

## Latest retained correction loops (after compaction)

- `pass-36` lowered the stock top contour; `pass-37` scope shrink was rejected and rolled back.
- `pass-38` narrowed the real trigger guard; `pass-39` raised the stock lower contour; `pass-40`
  shifted the physical magazine/well toward the trigger-guard forward edge and remains the best
  retained macro baseline before the later local tests.
- `pass-41` receiver/rail compression was rejected and rolled back.
- `pass-42` raised scope/receiver/barrel together and was rejected because the rendered bbox grew
  and IoU fell to `0.6865/0.6825`. `pass-43` receiver/barrel-only raise was also rejected at
  `0.6824/0.6723`; pass-40 stations were restored.
- `pass-44` tested a square rounded-rectangle thumbhole and rejected it visually. `pass-45`
  retained the narrower, taller, heavily rounded real thumbhole. `pass-46` added explicit
  hinge-side and leg-side spring anchors while preserving independent parallel helix springs.
- Pass-46 evidence: front/back map-stripped IoU `0.7437/0.7340`; orbit-left/right/top are
  non-degenerate. The macro gate remains failed; projection remains locked.
- NotebookLM construction audit for loops 42–46 is
  `.img2threejs/v2/reviews/notebooklm-loop44-construction-audit.md`. It supports the next order:
  extend bolt handle, refit trigger-guard station, replace simplified scope clamp blocks with
  source-proportioned rings/real paired fasteners, then close-review bipod contacts.
- The 30-loop bound was extended to 50 in `state-v2.json` because the active persistent goal
  requires continuing while deterministic corrections remain possible. Current state is active
  at loop `33/50`; do not advance to projection until macro blockout passes.
- `pass-47` extended the receiver-parented bolt handle approximately 18–20%. Orbit-right confirms
  a continuous physical lever and knob below the optic without a scope intersection. Front/back
  IoU is `0.7434/0.7328`; this is retained as a semantic improvement, not a macro-gate pass.
- `pass-48` moved the real swept trigger guard to the visible side-shell station with a small
  physical overlap. Broadside and orbit now show the loop instead of an occluded/missing guard;
  front/back IoU remains `0.7434/0.7328`.
- `pass-49` reduced the scope ring torus/saddle/clamp bulk while retaining two real ring stations
  and paired fasteners. Orbit reads closer to the source clamp construction; IoU is `0.7428/0.7327`.
- `pass-50` shifted the real trigger guard, trigger pivot, and receiving stock fillet left together
  toward the measured source station. The station relationship is visually closer in broadside and
  orbit, although IoU is `0.7382/0.7271`; the macro gate remains failed and this is retained as a
  provisional semantic correction. Evidence is in `.img2threejs/v2/reviews/feature-reviews-pass-50.json`.
- `pass-59` tested a broader/lower thumbhole (`0.78 x 0.54`) from the measured stock crop and was
  rejected: front/back IoU changed to `0.7371/0.7266` from pass-58 `0.7381/0.7251`; the code was
  rolled back and the failed experiment is preserved in `feature-reviews-pass-59.json`.
- `pass-60` raised the receiver lower contour from `0.14–0.23` to `0.23–0.30` while preserving
  upper profile, calibrated stations, and object-space depth. Front/back IoU improved to
  `0.7434/0.7312`; this is retained provisionally, but the macro gate is still failed.
- `pass-61` over-raised the same contour and regressed to `0.7347/0.7225`; it was rejected and
  rolled back to pass-60.
- `pass-62` retained the pass-60 macro profile and corrected the bipod spring attachment contract:
  terminal hooks now wrap the authored hinge/leg anchor neighborhoods, and runtime evidence includes
  both spring-to-leg contact pairs. All four spring contact pairs report `intersects-or-touches` and
  `closestGap=0`; front/back IoU is `0.7434/0.7311`, so the macro gate remains failed.
- NotebookLM loop-60 audit is recorded at `.img2threejs/v2/reviews/notebooklm-loop60-construction-audit.md`.
  Its spring warning led to the missing runtime contact-pair correction; its stale split-ring claim was
  rejected against the local orbit evidence.
- `pass-63` retained an intermediate real thumbhole profile (`0.72 x 0.60`, synchronized on stock and
  paint panel) because the source crop visibly has a wider-than-tall opening. Front/back IoU is
  `0.7429/0.7311`; the tiny front metric trade-off is documented and the macro gate remains failed.
- `pass-64` retained a compacted trigger-guard lower turn (`y=0.085–0.12`) matching the rounded
  rectangular source loop more closely without changing station, pivot, or shell overlap. Front/back
  IoU remains `0.7429/0.7311`; the macro gate remains failed.
- Current state is active at loop `59/70`; latest retained artifacts are pass-71 in `state-v2.json`.
- NotebookLM loop-64 audit is recorded at `.img2threejs/v2/reviews/notebooklm-loop64-construction-audit.md`.
  Its repeated spring-floating and magazine-flush claims conflict with local orbit/runtime and aligned
  source-crop evidence, so they are explicitly marked stale; the next valid target is stock lower contour.
- `pass-67` retained a source-audited buttpad correction: height `1.14 → 1.00` and center `y=0.05 → 0.12`.
  The aligned stock crop is closer and front/back IoU improved to `0.7450/0.7394`, the best current
  retained result. The macro gate still fails below `0.90`; orbit-left/right/top remain non-degenerate,
  projection remains locked, and the next correction must target another source-measured macro mismatch.
- `pass-68` tested a uniform `+0.05` lift of the stock shell, grip fillet, buttpad, and paint panel. It
  regressed front/back IoU to `0.7272/0.7263` and was rolled back; the experiment is preserved in
  `feature-reviews-pass-68.json`. This proves the next stock change must be a local profile/curvature edit,
  not a global translation.
- NotebookLM loop-68 audit is recorded at `.img2threejs/v2/reviews/notebooklm-loop68-construction-audit.md`.
  It supports rejecting the global stock lift. Its magazine-flush and spring-floating claims conflict with
  local source-crop/runtime evidence and are marked stale; do not move the magazine or rewrite the spring
  topology from that audit alone.
- `pass-69` retained a bounded receiver lower-contour correction: only the central points at
  `x=0.60, 0.02, -0.48` were raised by `0.04`. Front/back IoU improved to `0.7478/0.7427`, with
  non-degenerate orbit-left/right/top evidence. The macro gate remains failed and projection remains locked.
- `pass-70` tested local rear stock top/lower-tail lifts plus a synchronized paint-panel edit and was
  rejected: front/back IoU regressed to `0.7382/0.7344`. It is recorded in
  `feature-reviews-pass-70.json`; pass69 remains authoritative. The rear discrepancy needs a different
  profile/ownership hypothesis, not another direct lift of the same contour points.
- `pass-71` retained a real 24-segment elliptical thumbhole at the existing station and dimensions
  (`center=-3.28,0.17`, `size=0.72×0.60`). Front/back IoU improved to `0.7483/0.7439`, and the three
  orbit views remain non-degenerate. This is a provisional topology improvement; the macro gate still fails.
- `pass-72` tested a source-column-derived rear stock crown/lower-tail profile on the real shell only and
  was rejected: front/back IoU regressed to `0.7411/0.7399`. It is recorded in
  `feature-reviews-pass-72.json`; pass71 remains authoritative. Do not repeat direct rear point lifts;
  the remaining mismatch needs a camera/region-ownership or topology hypothesis.
- NotebookLM loop-72 audit is recorded at `.img2threejs/v2/reviews/notebooklm-loop72-construction-audit.md`.
  It identifies scope, barrel/muzzle, bipod visual terminals, trigger/receiver contour, and stock as the
  remaining construction review areas. Its repeated magazine-floating claim is stale against the current
  local contact/runtime evidence; its spring warning must be checked against current orbit pixels before any
  edit. Projection remains locked and the next correction must be one bounded non-stock parameter family.
- `pass-73` applied one bounded scope-only correction: each solid ring saddle was replaced by two narrow
  physical cheek posts while preserving the measured ring stations, split half-rings, caps, and paired
  fasteners. Build and capture passed; front/back silhouette remains `0.7483/0.7439`, so the macro gate is
  still failed. Orbit views remain non-degenerate. Evidence is in
  `.img2threejs/v2/reviews/feature-reviews-pass-73.json` and
  `.img2threejs/v2/reviews/comparison-pass-73-front.png`. Do not treat this as scope completion; the next
  loop must choose one bounded family from the remaining evidence.
- `pass-74` retained a source-landmark-driven barrel correction: the real barrel now spans `x=0.60..5.20`
  with a subtle taper, while the muzzle brake and recessed bore remain unchanged. Front/back IoU improved
  to `0.7492/0.7450`; receiver/barrel orbit contact remains plausible and the macro gate still fails.
  NotebookLM loop-74 is recorded at `.img2threejs/v2/reviews/notebooklm-loop74-construction-audit.md`.
  Its repeated magazine-floating and spring-floating claims are explicitly stale/contradicted by local
  contact/runtime evidence; do not move the magazine or rewrite spring topology from that audit alone.
- `pass-75` retained a bounded bipod-spring correction: each spring coil now has a separate lateral station
  beside its telescoping leg, with real side seats/connectors to the hinge and leg anchors. Orbit-top/right
  visibly show the coils external to the legs; all four spring contact pairs report `closestGap=0`.
  Front/back IoU is `0.7494/0.7459`; the macro gate remains failed. Evidence is in
  `.img2threejs/v2/reviews/feature-reviews-pass-75.json` and
  `.img2threejs/v2/reviews/comparison-pass-75-front.png`. Preserve this spring topology in future edits.
- `pass-76` tested a flatter trigger-guard sweep and was rejected/rolled back because IoU and orbit reading
  did not change. `feature-reviews-pass-76.json` preserves the experiment; pass75 remains authoritative.
  NotebookLM loop-76 is recorded at `.img2threejs/v2/reviews/notebooklm-loop76-construction-audit.md`.
  Its supported next target is the simplified muzzle-brake/bore terminal; its repeated magazine-floating
  claim remains stale against local source/runtime evidence.
- `pass-77` tested that muzzle target with a sparse open annular cage and open-ended bore tube. Although the
  bore became visible in muzzle orbit, the cage was unlike the compact source brake and regressed front/back
  IoU to `0.7478/0.7443`; it was rolled back. `feature-reviews-pass-77.json` preserves the failure and
  pass75 remains authoritative. The next muzzle attempt must use a compact open-ended sleeve/chamber form,
  not a sparse ring cage.
- `pass-78` retained the compact muzzle experiment: an open-ended outer sleeve plus four physical brake rails
  around a real through-bore. It is more mechanically legible than pass77's sparse cage and the bore is
  visible in muzzle orbit, but front/back IoU is `0.7482/0.7446`, a small trade-off from pass75. It remains
  provisional, not a macro-gate pass; evidence is in `feature-reviews-pass-78.json` and
  `comparison-pass-78-front.png`. Next audit must decide whether port proportions justify retaining it.
- NotebookLM loop-78 is recorded at `.img2threejs/v2/reviews/notebooklm-loop78-construction-audit.md`.
  It rejects pass78's rails and supports replacing them with internal double-chamber baffles inside a compact
  sleeve. The repeated magazine claim is stale against local evidence; scope ring topology is preserved.
- `pass-79` applied that bounded muzzle correction: removed the rails, kept a compact open-ended sleeve, and
  added two real annular internal baffles plus an open-ended bore tube. Front/back IoU is `0.7481/0.7445`;
  this is retained provisionally for construction fidelity, not accepted as a macro gate. Evidence is in
  `feature-reviews-pass-79.json` and `comparison-pass-79-front.png`.
- `pass-80` retained a bounded bipod-foot correction based on the supplied close-up: each authored leg now
  terminates in a broader tapered rubber boot with a steel collar and end cap. The independent lateral spring
  topology from pass75 is preserved, including runtime contact evidence. Fixed broadside diagnostics are
  `0.7448/0.7414`; the local foot construction is more plausible but does not pass the macro silhouette gate.
  Evidence is in `feature-reviews-pass-80.json`, `comparison-pass-80-front.png`, and the pass80 runtime manifest.
- `pass-81` tested a landmark-driven forward shift of the scope front ring/objective, but it created a real
  tube-to-taper gap because the main tube was not extended. It was rejected at front/back IoU `0.7313/0.7263`
  and preserved in `feature-reviews-pass-81.json`.
- `pass-82` extended the main tube to restore continuity, but the full forward-shift family still regressed to
  `0.7333/0.7290`. It was rejected and the scope front-half code was rolled back to the pass80 calibration.
  Evidence is in `feature-reviews-pass-82.json` and `comparison-pass-82-front.png`.
- `pass-84` retained a bounded trigger/stock correction from the aligned source crop: the oversized circular
  `stock-pistol-grip-fillet` was reduced to a narrow receiving fillet around the real guard bridge. Front/back
  IoU improved to `0.7484/0.7458`; runtime still reports all authored contact pairs and the orbit views remain
  non-degenerate. The macro gate is still failed, so this is provisional rather than completion.
- NotebookLM loop70 audit is recorded at `.img2threejs/v2/reviews/notebooklm-loop70-construction-audit.md`.
  Its magazine-floating recommendation was contradicted by the aligned local crop and runtime contact evidence;
  its trigger/stock contour finding was supported and produced pass84. The scope shift/flare hypotheses remain
  rejected by passes81–83.
- Current state is active at loop `71/90`; V1 remains immutable. Projection/materials remain locked until
  both map-stripped broadside silhouettes pass. The next correction must be a different source-grounded macro
  family, with the pass84 fillet and external spring topology preserved.
- `pass-85` retained a source-crop-driven bolt correction: the receiver-parented pivot was raised from `y=0.56`
  to `0.70` and the lever/knob drop was compacted from `-0.86` to `-0.23` local units. This moves the knob
  into the observed side-action region above the trigger guard and improves front/back IoU to `0.7537/0.7522`.
  Runtime receiver-to-bolt contact and the animation pivot remain intact; the macro gate is still failed.
- Current state is active at loop `72/90`; pass85 bolt station is retained provisionally. Do not move the bolt
  back above the optic or below the trigger. Projection/materials remain locked and the next correction must
  target a separate source-grounded macro mismatch.
- `pass-86` tested a synchronized central lower-sweep lift for the stock and paint panel. It regressed to
  front/back IoU `0.7486/0.7457`, so it was rejected and rolled back. Pass85 remains the retained code baseline;
  do not repeat this direct lower-sweep lift without a new camera/ownership hypothesis.
- `pass-87` tested a receiver-only upper-crown reduction from the pass85 profile. It was rejected and rolled
  back: front/back IoU was `0.7524/0.7522` versus pass85 `0.7537/0.7522`, and orbit-left/right/top remained
  non-degenerate without resolving the oversized receiver slab. Evidence is in
  `.img2threejs/v2/reviews/feature-reviews-pass-87.json` and `.img2threejs/v2/reviews/comparison-pass-87-front.png`.
- `pass-88` retained a bounded trigger/guard cross-section correction from the loop74 construction audit:
  real guard radius `0.032 → 0.024` and trigger radius `0.045 → 0.028`, with station, pins, sockets,
  and shell overlap unchanged. Front/back IoU is `0.7539/0.7522`; orbit-left/right/top remain
  non-degenerate and runtime reports the trigger contact pairs at `closestGap=0`. This is a local
  construction improvement, not a macro gate pass. Evidence is in
  `.img2threejs/v2/reviews/feature-reviews-pass-88.json` and `.img2threejs/v2/reviews/comparison-pass-88-front.png`.
- Current state is active at loop `75/90`; latest retained evidence is pass88 and latest rejected evidence is
  pass87. V1 is immutable, projection/materials remain locked, and the next correction must be a different
  source-grounded macro family. Preserve the thinner guard, pass85 bolt station, pass75 external spring
  topology, and all authored contact/runtime evidence while testing the next family.
- `pass-89` tested a source-column-derived stock lower-contour re-ownership: a raised rear-middle underside
  followed by a deeper forward grip sweep, synchronized on the shallow painted-shell panel. It was rejected
  after the broadside diagnostics regressed to FRONT/BACK IoU `0.7465/0.7482` from retained pass88
  `0.7539/0.7522`; visual review showed a large diagonal wedge unlike the rounded source stock. Evidence is in
  `.img2threejs/v2/reviews/feature-reviews-pass-89.json`, `.img2threejs/v2/reviews/comparison-pass-89-front.png`,
  and `.img2threejs/v2/reviews/diagnostic/pass-89-multi-angle.json`. The code is rolled back to pass88;
  preserve pass88 stock contour and choose a different source-grounded family next.
- Current state is active at loop `76/90`; retained pass remains pass88, latest rejected experiment is pass89,
  projection/materials remain locked, and V1 is immutable. The next correction must not repeat the pass89
  lower-contour hypothesis.
- NotebookLM loop-76 construction audit is recorded at `.img2threejs/v2/reviews/notebooklm-loop76-construction-audit.md`.
  Its supported next family is the scope-ring/mount profile: keep the optic tube, measured ring stations,
  rail/action station, bolt, magazine, and independent springs fixed while replacing only the heavy broad
  ring-side support/cap silhouette with a thinner split clamp and real screw heads. Its exact screw count
  and dimensions are treated as low-confidence because the cited manuals mix AI AW/AW50/AX families.
- `pass-90` retained the first bounded scope-ring construction correction from that audit: thinner split-ring,
  saddle, cap, and side-plate cross-sections with the optic tube, measured stations, rail, screws, and
  contacts unchanged. FRONT/BACK IoU is `0.7526/0.7507`; strict-quality passed, three orbit views were
  non-degenerate, and runtime reported all 13 physical contact pairs at `closestGap=0`. Evidence is in
  `.img2threejs/v2/reviews/feature-reviews-pass-90.json`, `.img2threejs/v2/reviews/comparison-pass-90-front.png`,
  and `.img2threejs/v2/renders/pass-90/runtime-manifest.json`. This is provisional, not a macro-gate pass.
- `pass-91` retained a second bounded scope-only correction: replaced the remaining rectangular saddle posts
  and side plates with chamfered tapered profile-extrusions. It did not move any station or change any contact;
  FRONT/BACK IoU stayed `0.7526/0.7507`, orbit views stayed non-degenerate, and strict-quality passed. The
  local visual improvement is recorded in `.img2threejs/v2/reviews/feature-reviews-pass-91.json` and
  `.img2threejs/v2/reviews/comparison-pass-91-front.png`; the hard Tier-1 macro gate remains failed.
- NotebookLM loop-78 is recorded at `.img2threejs/v2/reviews/notebooklm-loop78-construction-audit.md`.
  It selects receiver/stock silhouette ownership as the next family, but its suggested direct stock lower-belly
  lift is rejected by local pass86/pass89 regressions. The next test must use a new receiver/stock seam or
  terminal-attachment ownership hypothesis, keep the lower contour and all locked stations/contacts fixed,
  and must not repeat the rejected diagonal-wedge contour edit. Current state is active at loop `78/90`,
  retained pass `pass-91`, with projection/materials still locked.
- `pass-92` retained the bounded terminal-attachment hypothesis: the oversized rectangular `stock-buttpad`
  became a sloped/chamfered profile-extruded rubber pad. Stock station, depth, lower contour, thumbhole,
  receiver seam, and all contacts stayed fixed. FRONT/BACK IoU improved to `0.7588/0.7590`; strict-quality
  passed, orbit-left/right/top remained non-degenerate, and the runtime contact manifest remains physical.
  Evidence is in `.img2threejs/v2/reviews/feature-reviews-pass-92.json`,
  `.img2threejs/v2/reviews/comparison-pass-92-front.png`, and
  `.img2threejs/v2/renders/pass-92/runtime-manifest.json`. The macro gate is still failed. Current state is
  active at loop `79/90`; pass92 is retained provisionally and the next correction must preserve this pad.
- `pass-93` tested one receiver-only hypothesis: raising the receiver shell lower edge by `0.05` object
  units while preserving the upper crown, action block, rail, stock/buttpad, and attachments. It was rejected:
  FRONT/BACK IoU regressed to `0.7577/0.7584` from pass92 `0.7588/0.7590`, and the lower action/receiver
  transition read too thin. The code is rolled back to pass92; evidence is in
  `.img2threejs/v2/reviews/feature-reviews-pass-93.json`, `.img2threejs/v2/reviews/comparison-pass-93-front.png`,
  and `.img2threejs/v2/reviews/diagnostic/pass-93-multi-angle.json`. Current state is active at loop `80/90`,
  retained pass `pass-92`, latest rejected experiment `pass-93`; do not repeat this exact lower-edge lift.
- NotebookLM loop-80 selected the bipod hinge/independent spring/foot family and recorded the source
  vocabulary of quick-detachable spigot/socket, hinge plate, telescoping tubes, tapered boots, collars,
  end caps, and separate parallel compression coils. Exact hidden spigot depth, hinge thickness, spring
  gauge/pitch, and leg overlap remain inferred/unknown. The audit is at
  `.img2threejs/v2/reviews/notebooklm-loop80-construction-audit.md`.
- `pass-94` retained that audit's single bounded hypothesis: hinge vertical thickness `0.30 -> 0.264`
  and telescoping tube radii `0.052 -> 0.056`, `0.032 -> 0.0345`; spring paths, hooks, collars, stations,
  and contacts remained unchanged. FRONT/BACK IoU improved to `0.7591/0.7594`; strict-quality passed,
  orbit views remained non-degenerate, and physical contact evidence remains 13 pairs at `closestGap=0`.
  Evidence is in `.img2threejs/v2/reviews/feature-reviews-pass-94.json`,
  `.img2threejs/v2/reviews/comparison-pass-94-front.png`, and
  `.img2threejs/v2/renders/pass-94/runtime-manifest.json`. Current state is active at loop `81/90`,
  retained pass `pass-94`, with projection/materials still locked.
- `pass-95` retained a source-crop-driven magazine-envelope correction. The former long hanging block
  became a short tapered stamped profile with real feed lip, base, and side ribs; the group station stayed
  `(-1.62, 0.02, 0)`, the well station stayed fixed, and all magazine contacts remained physical. FRONT/BACK
  IoU improved to `0.7662/0.7666`; strict-quality passed and orbit views remained non-degenerate. Evidence is in
  `.img2threejs/v2/reviews/feature-reviews-pass-95.json`, `.img2threejs/v2/reviews/comparison-pass-95-front.png`,
  `.img2threejs/v2/reviews/crops/magazine-aligned-pass-95-front.png`, and
  `.img2threejs/v2/renders/pass-95/runtime-manifest.json`. Current state is active at loop `82/90`, retained
  pass `pass-95`; projection/materials remain locked and the next audit is due now.
- NotebookLM loop-82 selected the scope objective/ocular/ring family. It confirmed integral rail,
  recoil-lug/clamping interface, split-half rings with paired hex fasteners, objective/ocular housings,
  and recessed physical glass. Generic Schmidt & Bender 62/50 values are not accepted as exact CS2
  dimensions; hidden lens groups, mount pocket depth, thread count, and exact diameters remain unknown.
  The audit is at `.img2threejs/v2/reviews/notebooklm-loop82-construction-audit.md`.
- `pass-96` retained a bounded scope profile correction: objective taper/rim radius `0.34 -> 0.30` and
  recessed objective glass radius `0.29 -> 0.255`, with axial station, rings, turret, rail, and contacts
  fixed. The close crop is closer to the source's slimmer objective; FRONT/BACK IoU is `0.7649/0.7654`,
  a small trade-off from pass95 `0.7662/0.7666`. Strict-quality passed, orbit views remained non-degenerate,
  and the hard macro gate remains failed. Evidence is in `.img2threejs/v2/reviews/feature-reviews-pass-96.json`,
  `.img2threejs/v2/reviews/comparison-pass-96-front.png`,
  `.img2threejs/v2/reviews/crops/scope-aligned-pass-96-front.png`, and
  `.img2threejs/v2/renders/pass-96/runtime-manifest.json`. Current state is active at loop `83/90`,
  retained pass `pass-96`; projection/materials remain locked.
- `pass-97` retained one isolated bolt-handle correction: the receiver-side pivot and station stayed fixed,
  while the real curved lever/knob was extended downward from local `0.23` to `0.29` object units. The
  handle remains below the side action and above the trigger opening, so it no longer reads as a scope-mounted
  or floating part. FRONT/BACK map-stripped IoU stayed `0.7649/0.7654`; strict-quality passed, orbit views
  remained non-degenerate, and the runtime manifest still reports all 13 physical contact pairs with
  `closestGap=0`. Evidence is in `.img2threejs/v2/reviews/feature-reviews-pass-97.json`,
  `.img2threejs/v2/reviews/comparison-pass-97-front.png`, `.img2threejs/v2/reviews/diagnose-pass-97-front.json`,
  `.img2threejs/v2/reviews/diagnose-pass-97-back.json`,
  `.img2threejs/v2/reviews/diagnostic/pass-97-multi-angle.json`, and
  `.img2threejs/v2/renders/pass-97/runtime-manifest.json`. Current state is active at loop `84/90`,
  retained pass `pass-97`; the macro gate remains failed and projection/materials remain locked. The next
  correction should review the trigger-guard profile in isolation; do not change bolt station or contacts.
- `pass-98` retained a bounded trigger-guard profile correction: the real swept loop now uses two mostly
  vertical side legs and a shallow rounded bottom, closer to the compact stamped loop in the source crop.
  Trigger station, receiving bridge, pins, pivot, shell seam and all contacts stayed fixed. FRONT/BACK IoU is
  `0.7648/0.7654`; strict-quality passed, orbit views remained non-degenerate, and projection/materials remain
  locked because the macro gate is still failed. Evidence is in
  `.img2threejs/v2/reviews/feature-reviews-pass-98.json`, `.img2threejs/v2/reviews/comparison-pass-98-front.png`,
  `.img2threejs/v2/reviews/crops/trigger-bolt-aligned-pass-98.png`, and
  `.img2threejs/v2/renders/pass-98/runtime-manifest.json`. Current state advanced to loop `85/90`, retained
  pass `pass-98` provisionally.
- NotebookLM loop-84 selected the bipod hinge/spring/foot family. It supplied vocabulary for a forend spigot,
  hinge plate, telescoping outer/inner legs, independent lateral helixes, spring collars/hooks, and tapered
  boots, and proposed a `+0.03` Y translation. The audit and local adjudication are in
  `.img2threejs/v2/reviews/notebooklm-loop84-construction-audit.md`; generic AW/AW50/AX dimensions and hidden
  spigot/hinge internals remain inferred/unknown.
- `pass-99` rejected that translation hypothesis. Moving the complete bipod as one rigid assembly preserved
  spring separation and contact topology but regressed FRONT/BACK IoU from `0.7648/0.7654` to `0.7641/0.7641`.
  The code was rolled back; rollback front/back hashes match pass98 exactly. Evidence is in
  `.img2threejs/v2/reviews/feature-reviews-pass-99.json`, `.img2threejs/v2/reviews/comparison-pass-99-front.png`,
  `.img2threejs/v2/reviews/diagnose-pass-99-front.json`,
  `.img2threejs/v2/reviews/diagnose-pass-99-back.json`,
  `.img2threejs/v2/reviews/diagnostic/pass-99-multi-angle.json`, and
  `.img2threejs/v2/renders/rollback-pass99-to-pass98/`. Current state retains pass98 at loop `85/90`;
  do not repeat the rigid `+0.03` bipod shift.
- `pass-100` retained a source-crop-driven muzzle/bore profile correction. The compact sleeve, annular rims,
  baffles, recessed bore tube, annular bore face and bore rim were reduced together at the fixed coaxial
  muzzle station; the real open/recessed bore remains authored geometry. FRONT/BACK IoU improved to
  `0.7677/0.7677`; strict-quality passed, orbit views remained non-degenerate, and the macro gate is still
  failed so projection/materials remain locked. Evidence is in
  `.img2threejs/v2/reviews/feature-reviews-pass-100.json`, `.img2threejs/v2/reviews/comparison-pass-100-front.png`,
  `.img2threejs/v2/reviews/crops/muzzle-aligned-pass-100.png`,
  `.img2threejs/v2/reviews/diagnostic/pass-100-multi-angle.json`, and
  `.img2threejs/v2/renders/pass-100/runtime-manifest.json`. Current state is active at loop `86/90`,
  retained pass `pass-100` provisionally.
- `pass-101` retained a bounded scope-ocular correction: the real eyepiece housing, rear rim and recessed
  glass were slimmed together at the fixed scope station. The source crop reads less over-sized, though its
  explicit taper/markings remain open; reflective material work stays locked. FRONT/BACK IoU is `0.7672/0.7677`
  versus pass100 `0.7677/0.7677`; strict-quality passed, orbit views remained non-degenerate, and all scope
  mount/contact stations stayed fixed. Evidence is in
  `.img2threejs/v2/reviews/feature-reviews-pass-101.json`, `.img2threejs/v2/reviews/comparison-pass-101-front.png`,
  `.img2threejs/v2/reviews/crops/scope-aligned-pass-101.png`, and
  `.img2threejs/v2/renders/pass-101/runtime-manifest.json`. Current state is active at loop `87/90`,
  retained pass `pass-101` provisionally; do not repeat ocular slimming immediately.
- `pass-102` retained a source-crop-driven stock negative-space correction: the real thumbhole ellipse
  changed from `0.72 x 0.60` to a taller/narrower `0.62 x 0.70`, synchronized in the shell and shallow
  shell panel while outer stock, buttpad, receiver seam, trigger guard and contacts stayed fixed.
  FRONT/BACK IoU improved to `0.7678/0.7680`; strict-quality passed, orbit views remained non-degenerate,
  and projection/materials remain locked. Evidence is in
  `.img2threejs/v2/reviews/feature-reviews-pass-102.json`, `.img2threejs/v2/reviews/comparison-pass-102-front.png`,
  `.img2threejs/v2/reviews/crops/stock-aligned-pass-102.png`, and
  `.img2threejs/v2/renders/pass-102/runtime-manifest.json`. Current state is active at loop `88/90`,
  retained pass `pass-102` provisionally.
- NotebookLM loop-88 selected a new bipod sub-family: independent spring pitch/density, not the rejected
  rigid bipod translation. Its audit and local adjudication are in
  `.img2threejs/v2/reviews/notebooklm-loop88-construction-audit.md`. The supplied close-up supports a
  denser separate lateral coil; exact wire gauge, spring rate, hidden release catch, spigot depth and
  hinge internals remain inferred/unknown.
- `pass-103` retained that spring-only hypothesis provisionally: the real independent lateral helix increased
  from 10 to 16 turns over the unchanged endpoint span and radius, with hooks, collars, anchors, legs, feet
  and contacts fixed. The orbit close-up is denser and closer to the supplied spring reference, while
  FRONT/BACK IoU trades to `0.7668/0.7670` from pass102 `0.7678/0.7680`; strict-quality passed and orbit
  views remained non-degenerate. Projection/materials remain locked. Evidence is in
  `.img2threejs/v2/reviews/feature-reviews-pass-103.json`, `.img2threejs/v2/reviews/comparison-pass-103-front.png`,
  `.img2threejs/v2/reviews/diagnose-pass-103-front.json`, `.img2threejs/v2/reviews/diagnose-pass-103-back.json`,
  `.img2threejs/v2/reviews/diagnostic/pass-103-multi-angle.json`,
  `.img2threejs/v2/renders/pass-103/orbit-right.png`, and
  `.img2threejs/v2/renders/pass-103/runtime-manifest.json`. Current state is active at loop `89/110`,
  retained pass `pass-103` provisionally. The loop budget was extended from 90 to 110 because the macro
  gate remains failed but source-grounded corrections continue; V1 remains immutable.
- `pass-104` retained a source-measured stock upper-crown correction. The upper crown was lifted only through
  the butt/cheek shoulder using alpha-column measurements from `public/front-medusa.webp`; thumbhole, lower
  contour, buttpad, receiver seam, component stations, and contacts stayed fixed. FRONT/BACK map-stripped
  IoU improved to `0.7707/0.7712`; strict-quality passed, orbit-left/right/top stayed non-degenerate, and
  all authored runtime contacts remained at `closestGap=0`. This remains a provisional blockout correction,
  not acceptance. Evidence: `.img2threejs/v2/reviews/feature-reviews-pass-104.json`,
  `.img2threejs/v2/reviews/comparison-pass-104-front.png`, and
  `.img2threejs/v2/renders/pass-104/runtime-manifest.json`.
- `pass-105` retained one bounded receiver/action construction hypothesis. The machined action block was
  shortened longitudinally and forward-seated with controlled overlap so it reads as a real nested action
  inside the painted receiver shell; optic, bolt, trigger, magazine, barrel, stock, bipod, stations, sockets,
  and contacts were not translated. Orbit-right/top confirm volume and the runtime manifest reports `hasTick`,
  five pivots, five sockets, 16 colliders, 13 physical contact pairs, and zero closest gaps. FRONT/BACK
  map-stripped IoU is `0.7707/0.7712`; front max deltaE worsened to `8.30`, so this is retained only as a
  semantic assembly improvement. The macro gate remains failed (`<0.85` diagnostic, `<0.90` acceptance),
  and projection/materials remain locked. Evidence: `.img2threejs/v2/reviews/feature-reviews-pass-105.json`,
  `.img2threejs/v2/reviews/review-contract-pass-105.md`, `.img2threejs/v2/reviews/diagnose-pass-105-front.json`,
  `.img2threejs/v2/reviews/diagnose-pass-105-back.json`, `.img2threejs/v2/reviews/diagnostic/pass-105-multi-angle.json`,
  `.img2threejs/v2/reviews/comparison-pass-105-front.png`, and
  `.img2threejs/v2/renders/pass-105/runtime-manifest.json`.
- State was synchronized from the V2 review ledger after pass105: `.img2threejs/state-v2.json` is active at
  loop `92/110`, with `latestRetainedPass=pass-105`. The authoritative source pair remains
  `/Users/tamlh/workspaces/self/AI/img2threejs-org/img2threejs-showcase/public/front-medusa.webp` and
  `/Users/tamlh/workspaces/self/AI/img2threejs-org/img2threejs-showcase/public/back-medusa.webp`; V1 is
  immutable. Next loop must use a new source-grounded receiver/stock macro-envelope ownership hypothesis,
  preserve the action nesting and contacts, and keep projection/materials locked until the map-stripped
  broadside gate passes.
- `pass-106` retained a measured stock negative-space correction. Source-grid rows/columns showed the
  thumbhole gap centered about 9 px farther right and 14 px lower than pass105, with a wider horizontal
  opening but less vertical height. The real ellipse changed from `(-3.28, 0.17, 0.62 × 0.70)` to
  `(-3.22, 0.07, 0.74 × 0.56)`; the outer stock contour, buttpad, receiver/action, stations, parentage,
  and contacts stayed fixed. FRONT/BACK map-stripped IoU improved to `0.7778/0.7801`; front max deltaE
  improved to `8.19`. Strict-quality passed, orbit-left/right/top stayed non-degenerate, and all 13
  physical contact pairs still report `closestGap=0`. This is a provisional blockout retention, not a macro
  gate pass. Evidence is in `.img2threejs/v2/measurements/pass-106-thumbhole-grid.md`,
  `.img2threejs/v2/reviews/feature-reviews-pass-106.json`, `.img2threejs/v2/reviews/comparison-pass-106-front.png`,
  `.img2threejs/v2/reviews/diagnose-pass-106-front.json`, `.img2threejs/v2/reviews/diagnose-pass-106-back.json`,
  `.img2threejs/v2/reviews/diagnostic/pass-106-multi-angle.json`, and
  `.img2threejs/v2/renders/pass-106/runtime-manifest.json`.
- The V2 ledger/state is now synchronized at loop `93/110`, with `latestRetainedPass=pass-106`.
  Projection/materials remain locked. The next bounded family is the source-measured trigger-guard opening:
  preserve pass106 thumbhole, action nesting, scope/bolt/magazine stations, and all contacts while matching
  the source's compact guard/trigger negative space. Do not claim acceptance until the map-stripped broadside
  gate reaches both thresholds.
- The required two-loop NotebookLM audit is now recorded at
  `.img2threejs/v2/reviews/notebooklm-loop93-construction-audit.md` (raw response:
  `.img2threejs/v2/reviews/notebooklm-loop93-construction-audit.json`). It supports a separate stamped
  swept guard, a separate trigger blade, transverse real pins, a shell/chassis receiving bridge, and an
  explicitly open trigger clearance. It does not supply exact CS2 dimensions; generic Accuracy International
  wall thickness, fillets, and hidden pocket depth remain unknown. The next pass107 hypothesis is therefore
  guard/trigger cross-section plus a synchronized bridge pocket only, with rollback on any orbit gap or
  trigger/guard intersection.
- `pass-107` was tested and rejected. The enlarged stamped guard/bridge trial passed strict-quality, preserved
  all 13 world-space contacts (`closestGap=0`), and kept orbit-left/right/top non-degenerate, but its aligned
  trigger crop visibly overshot the compact source opening. Deterministic map-stripped IoU regressed from
  pass106 `0.7778/0.7801` to `0.7777/0.7800`; evidence is in
  `.img2threejs/v2/reviews/feature-reviews-pass-107.json`, `.img2threejs/v2/reviews/comparison-pass-107-front.png`,
  `.img2threejs/v2/reviews/diagnose-pass-107-front.json`, `.img2threejs/v2/reviews/diagnose-pass-107-back.json`,
  `.img2threejs/v2/reviews/diagnostic/pass-107-multi-angle.json`, and
  `.img2threejs/v2/renders/pass-107/runtime-manifest.json`.
- The code is rolled back to the compact guard baseline. Rollback evidence is retained under
  `.img2threejs/v2/renders/rollback-pass107-to-pass106/` and the corresponding rollback diagnostics/review
  contract. The retained baseline restores IoU `0.7778/0.7801`; it remains below the diagnostic `0.85` and
  acceptance `0.90` macro gates. State is synchronized at loop `94/110`; the next family is a new measured
  `receiver-stock-envelope-grid-fit` hypothesis. Do not repeat the enlarged guard experiment, and keep
  projection/materials locked.
- `pass-108` retained one source-grid ownership correction provisionally. The visible shallow shell panel now
  reuses the real stock profile and the retained pass106 thumbhole loop; the stale independently authored panel
  contour was removed. No camera, component station, parentage, or contact was moved. Front/back map-stripped
  IoU improved to `0.7823/0.7814`; strict-quality passed, orbit-left/right/top/muzzle remained non-degenerate,
  and runtime still reports `root.userData.tick`, five pivots, five sockets, 16 colliders, 13 physical contacts,
  `metadataOnly=false`, and `closestGap=0` for every contact. The macro gate remains failed, so projection and
  materials stay locked. Evidence is in `.img2threejs/v2/measurements/pass-108-stock-shell-panel-grid.md`,
  `.img2threejs/v2/reviews/feature-reviews-pass-108.json`, `.img2threejs/v2/reviews/review-contract-pass-108.md`,
  `.img2threejs/v2/reviews/diagnose-pass-108-front.json`, `.img2threejs/v2/reviews/diagnose-pass-108-back.json`,
  `.img2threejs/v2/reviews/diagnostic/pass-108-multi-angle.json`, `.img2threejs/v2/reviews/comparison-pass-108-front.png`,
  and `.img2threejs/v2/renders/pass-108/runtime-manifest.json`. The required NotebookLM audit is recorded at
  `.img2threejs/v2/reviews/notebooklm-loop95-construction-audit.md`; it supports testing a small real action/shell
  seam, not a projection fix. State is synchronized at loop `95/110`, with `latestRetainedPass=pass-108`; next
  hypothesis is a `0.02`-unit inward reduction of the real machined action-block depth, with rollback on any
  broadside regression, seam gap, bolt/action clipping, or orbit separation.
- `pass-109` retained that single action-depth test provisionally. The real receiver-parented machined action
  extrusion changed from `0.40` to `0.38` object units; its longitudinal profile, `z=0.14` station, fasteners,
  seam, bolt station, and contact graph stayed fixed. Front/back map-stripped IoU held at `0.7823/0.7814`;
  strict-quality passed, the deterministic multi-angle check remained non-degenerate, and runtime still reports
  five pivots, five sockets, 16 colliders, 13 physical contacts, `metadataOnly=false`, and `closestGap=0` for
  every contact. Orbit-right/top show no floating action, shell gap, or bolt/action clipping; the seam remains
  subtle because hidden pocket depth is inferred. The macro gate remains failed, so projection/materials remain
  locked. Evidence is in `.img2threejs/v2/measurements/pass-109-action-seam-depth.md`,
  `.img2threejs/v2/reviews/feature-reviews-pass-109.json`, `.img2threejs/v2/reviews/review-contract-pass-109.md`,
  `.img2threejs/v2/reviews/diagnose-pass-109-front.json`, `.img2threejs/v2/reviews/diagnose-pass-109-back.json`,
  `.img2threejs/v2/reviews/diagnostic/pass-109-multi-angle.json`, `.img2threejs/v2/reviews/comparison-pass-109-front.png`,
  and `.img2threejs/v2/renders/pass-109/runtime-manifest.json`. State is synchronized at loop `96/110`, with
  `latestRetainedPass=pass-109`; the next family is a new measured receiver/stock macro-envelope correction.
  Do not repeat the pass107 guard enlargement or pass109 depth edit without new source evidence. The next
  NotebookLM audit is due after the next correction loop, maintaining the two-loop cadence.

- `pass-110` retained one bounded barrel-reach hypothesis provisionally. The real coaxial barrel tube changed
  from center/length `(2.90, 4.60)` to `(2.15, 6.10)`, extending its rear endpoint toward the scope rear-saddle
  neighborhood while keeping the muzzle/front station, radius, shoulder, optic, rail, bolt, bipod, parentage,
  sockets, and contacts fixed. The source-aligned barrel crop supports the rearward reach. FRONT/BACK
  map-stripped IoU improved to `0.7831/0.7833`; strict-quality passed, broadside-back/orbit-left/right/top/muzzle
  stayed non-degenerate, and runtime still reports a tick, five pivots, five sockets, 16 colliders, 13 physical
  contact pairs, `metadataOnly=false`, and `closestGap=0` for every contact. The macro gate remains failed, so
  projection/materials remain locked. Evidence: `.img2threejs/v2/measurements/pass-110-barrel-root-grid.md`,
  `.img2threejs/v2/reviews/feature-reviews-pass-110.json`, `.img2threejs/v2/reviews/review-contract-pass-110.md`,
  `.img2threejs/v2/reviews/diagnose-pass-110-front.json`, `.img2threejs/v2/reviews/diagnose-pass-110-back.json`,
  `.img2threejs/v2/reviews/diagnostic/pass-110-multi-angle.json`, `.img2threejs/v2/reviews/comparison-pass-110-front.png`,
  and `.img2threejs/v2/renders/pass-110/runtime-manifest.json`.
- NotebookLM loop-97 was run in a fresh ten-source audit notebook because the prior notebook had reached its
  50-source tier limit. The audit supports the barrel reach as observed, identifies the barrel seat as hidden,
  and gives the functional bolt contract: receiver raceway/bolt sleeve, handle-root socket on the bolt body,
  and rigid body/handle/knob motion during cycle/locking. It also confirms a separate stamped guard, trigger
  blade, receiving fillet and open clearance, with exact hidden dimensions unknown. Raw and distilled evidence:
  `.img2threejs/v2/reviews/notebooklm-loop97-construction-audit.json` and
  `.img2threejs/v2/reviews/notebooklm-loop97-construction-audit.md`. State is synchronized at loop `97/130`,
  retained pass `pass-110`; next family is `trigger-fillet-clearance`, followed by `bolt-action-integration`.

- `pass-111` retained a functional bolt/action integration provisionally. The previous root-level short cylinder
  and lever were replaced with a receiver-parented assembly: static `bolt-raceway`, sliding `bolt-body` sleeve,
  rear collar, locking lug, transverse `bolt-handle-root` socket, hinge pin, and a longer down/rearward handle
  with knob. `bolt.userData.applyCycle(progress)` translates the sleeve on X and rotates the rigid body/handle
  around Z; `root.userData.tick` drives a bounded idle cycle. Motion evidence shows the knob changing by about
  `[0.0579, -0.0351, 0]` world units from closed to open, with no independent handle motion. The action crop now
  reads connected to the receiver rather than floating above the optic. Front/back IoU is `0.7824/0.7793`, a
  slight semantic-pass tradeoff and still below both macro gates; do not call this silhouette acceptance.
  Strict-quality passed, orbit views were non-degenerate, and runtime reports five pivots, six sockets, 16
  colliders, 13 physical contact pairs, `metadataOnly=false`, and `closestGap=0` for every contact. Evidence:
  `.img2threejs/v2/measurements/pass-111-bolt-action-integration.md`,
  `.img2threejs/v2/reviews/feature-reviews-pass-111.json`,
  `.img2threejs/v2/reviews/review-contract-pass-111.md`,
  `.img2threejs/v2/renders/pass-111/bolt-action-motion-test.json`,
  `.img2threejs/v2/reviews/crops/render-bolt-action-pass-111-after.png`, and
  `.img2threejs/v2/renders/pass-111/runtime-manifest.json`. State is synchronized at loop `98/130`, retained
  pass `pass-111`; projection/materials remain locked and the next family is `trigger-fillet-clearance`.

- `pass-112` retained a bounded trigger/fillet correction provisionally. The stock pistol-grip receiving fillet
  was narrowed and reduced from `depth=0.62` to `0.50`, seated toward the near-side guard; the trigger blade
  was thinned from `0.028` to `0.022`, tightened, and its pivot socket moved onto the guard side plane at
  `z=0.38`. The source-aligned compact pass111 guard baseline was restored after an initial pass112 subtrial
  made the loop too small; the rejected pass107 enlargement was not repeated. The trigger/fillet crop and
  orbit review show a real open loop with a thinner blade and no new gap. FRONT/BACK IoU is `0.7821/0.7781`,
  still below the macro gates; strict-quality passed, non-degenerate orbits remained valid, and runtime still
  reports five pivots, six sockets, 16 colliders, 13 physical contact pairs, `metadataOnly=false`, and zero
  closest gaps. NotebookLM loop99 supports the compact thin guard, slender blade and narrower fillet, warns not
  to shrink the guard further, and recommends the next stock butt/thumbhole macro family. Evidence:
  `.img2threejs/v2/measurements/pass-112-trigger-fillet-clearance.md`,
  `.img2threejs/v2/reviews/feature-reviews-pass-112.json`,
  `.img2threejs/v2/reviews/review-contract-pass-112.md`,
  `.img2threejs/v2/reviews/notebooklm-loop99-construction-audit.md`,
  `.img2threejs/v2/reviews/diagnose-pass-112-front.json`,
  `.img2threejs/v2/reviews/diagnose-pass-112-back.json`, and
  `.img2threejs/v2/renders/pass-112/runtime-manifest.json`. State is synchronized at loop `99/130`, retained
  pass `pass-112`; next family is source-grid `stock-butt-thumbhole-macro` alignment and projection/materials
  remain locked.
- `pass-113` stock lower-contour trial was rejected and rolled back. The candidate raised only the lower
  pistol-grip/throat control points to test the user's stock-thickness observation, while butt, crown,
  thumbhole, receiver, fasteners, component stations, contacts, projection and materials stayed fixed.
  FRONT/BACK map-stripped IoU fell from retained pass112 `0.7821/0.7781` to `0.7781/0.7745`, and the
  aligned stock crop became less faithful. The active code was restored exactly; broadside hashes in
  `.img2threejs/v2/renders/rollback-pass113-to-pass112/` match pass112 byte-for-byte. Evidence is in
  `.img2threejs/v2/measurements/pass-113-stock-lower-contour-rejection.md`,
  `.img2threejs/v2/reviews/feature-reviews-pass-113.json`,
  `.img2threejs/v2/reviews/review-contract-pass-113.md`,
  `.img2threejs/v2/reviews/comparison-pass-113-front.png`, and
  `.img2threejs/v2/renders/pass-113/runtime-manifest.json`. The rejection is recorded once in the V2
  ledger; `latestRetainedPass` remains `pass-112`, state review cursor is `100/130`, and the next family
  is a new low-confidence `stock-depth-thickness-or-ownership` hypothesis. Do not repeat the rejected
  lower-contour lift; projection/materials remain locked.
- `pass-114` retained one bounded bolt-axis seating correction provisionally. The receiver-parented
  `bolt-raceway` and sliding `bolt-body` moved from the near-side `z=0.28/0.33` placement to the
  barrel/rail action centerline `z=0`; only the real `bolt-handle-root` hinge remains offset to the
  visible side at `z=0.20`. Orbit-right now shows a seated action with the handle crossing the receiver
  side instead of a floating silver body. Closed/open evidence proves the same rigid body/handle/knob
  hierarchy moves: knob delta `[0.057859,-0.035104,0]`, body delta `[0.112592,-0.092405,0]`.
  Front/back IoU is unchanged from pass112 at `0.7821/0.7781`, so the macro gate remains failed; this
  is a component/ownership retention only. Strict-quality passed, multi-angle remained non-degenerate,
  and runtime still reports five pivots, six sockets, 16 colliders, 13 physical contacts, `metadataOnly=false`,
  and zero closest gaps. Evidence: `.img2threejs/v2/measurements/pass-114-bolt-axis-seating.md`,
  `.img2threejs/v2/reviews/feature-reviews-pass-114.json`,
  `.img2threejs/v2/reviews/review-contract-pass-114.md`,
  `.img2threejs/v2/reviews/comparison-pass-114-front.png`,
  `.img2threejs/v2/reviews/diagnostic/pass-114-multi-angle.json`, and
  `.img2threejs/v2/renders/pass-114/`. State is synchronized at loop `101/130`, with
  `latestRetainedPass=pass-114`; next family is a new evidence-backed stock-depth/ownership or
  projection-attachment correction. Do not reintroduce a near-side bolt body.

## Recovery update — pass 122 / loop 109

The active V2 source is now `src/demos/awp-medusa-v2/awpMedusaV2Core.ts`; V1 remains frozen. The
review ledger contains passes 115–122, all under the still-locked `blockout` pass. The current
state authority is `.img2threejs/state-v2.json` and its current step is `build-current-pass`.

- Pass 115 retained the stock-owned shallow shell panels and kept projection locked.
- Pass 116 retained the receiver-parented functional bolt hierarchy and exposed the handle root.
- Pass 117 added the real tapered knob neck.
- Pass 118 registered the receiver relief and body rear-face handle-root station.
- Pass 119 added a body-owned bolt shroud for high-angle observability.
- Pass 120 centered the trigger/guard at `z=0` and added a real stock-throat clearance hole.
- Pass 121 corrected the source crop's down/rearward lever direction and added a body-owned near-side sleeve.
- Pass 122 reduced and re-seated the shroud/sleeve, moved the sleeve to `z=0.38`, moved the hinge root to
  `z=0.42`, shortened the real transverse hinge pin, and added a controlled 3/4 bolt audit render.

Pass-122 evidence:
`.img2threejs/v2/renders/pass-122/orbit-top.png`,
`.img2threejs/v2/renders/pass-122/bolt-3q-close.png`,
`.img2threejs/v2/renders/pass-122/bolt-action-motion-test.json`,
`.img2threejs/v2/renders/pass-122/runtime-manifest.json`,
`.img2threejs/v2/reviews/diagnose-pass-122-front.json`,
`.img2threejs/v2/reviews/diagnose-pass-122-back.json`,
`.img2threejs/v2/reviews/part-coverage-pass-122.json`, and
`.img2threejs/v2/reviews/review-contract-pass-122.md`.

The latest deterministic metrics are front/back silhouette IoU `0.7820/0.7796`, below diagnostic
`0.85` and acceptance `0.90`; strict-quality passes, part coverage has zero errors, runtime publishes
`hasTick=true`, five pivots, six sockets, 17 colliders, 14 contacts/adjacency records, and zero closest
gaps. The multi-angle test is non-degenerate but is not a likeness score. Projection/materials remain
locked. NotebookLM loop 120 is advisory at `.img2threejs/v2/reviews/notebooklm-loop120-bolt-audit.md`:
it confirms the lever direction and warns that a steep top view is an occlusion test, not proof of hidden
side geometry. The next family is `receiver-stock-macro-envelope-and-cs2-rifle-adapter-gate`.

## Recovery update — pass 123 / loop 110

Pass 123 is retained provisionally and the active state is synchronized at loop `110/130`. The
bounded change addressed the latest `orbit-top`/bolt complaint without mirroring or floating a
second mechanism: `bolt-body` is now a coaxial sliding cylinder, `bolt-shroud` is a low profile
machined edge, and `bolt-side-sleeve` is a circular near-side hinge boss. The receiver parent,
rear scope-saddle station, `bolt-handle-root`, downward/rearward lever and cycle controls were held
fixed. V1 remains untouched.

Pass-123 evidence:
`.img2threejs/v2/renders/pass-123/broadside-front.png`,
`.img2threejs/v2/renders/pass-123/orbit-right.png`,
`.img2threejs/v2/renders/pass-123/bolt-3q-close.png`,
`.img2threejs/v2/renders/pass-123/bolt-3q-closed.png`,
`.img2threejs/v2/renders/pass-123/bolt-3q-open.png`,
`.img2threejs/v2/renders/pass-123/bolt-action-motion-test.json`,
`.img2threejs/v2/renders/pass-123/runtime-manifest.json`,
`.img2threejs/v2/reviews/diagnose-pass-123-front.json`,
`.img2threejs/v2/reviews/diagnose-pass-123-back.json`,
`.img2threejs/v2/reviews/diagnostic/pass-123-multi-angle.json`,
`.img2threejs/v2/reviews/part-coverage-pass-123.json`, and
`.img2threejs/v2/reviews/review-contract-pass-123.md`.

The local visual review shows a seated circular boss and a rigid closed/open handle movement. The
published runtime reports `hasTick=true`, five pivots, six sockets, 17 colliders, 14 contact/
adjacency records, and zero closest gaps. Strict-quality and build pass. Front/back silhouette IoU
is `0.7818/0.7791`, still below diagnostic `0.85` and acceptance `0.90`; projection/materials stay
locked. The pure top view remains an occlusion stress view because no top orthographic source plate
establishes a visible bolt silhouette.

NotebookLM pass-123 sources were uploaded separately and reached ready status, but three chat attempts
were rate-limited/rejected. This is recorded in `.img2threejs/v2/reviews/notebooklm-loop123-bolt-audit.md`;
no external score is used. The next bounded family remains `receiver-stock-macro-envelope-and-cs2-rifle-adapter-gate`.

## Recovery update — rifle adapter gate / pass 123 follow-up

The installed `img2threejs` skill and forge registry were corrected so this AWP no longer enters a
false `unsupported-family` branch. The concrete route is now `rifle/awp → cs2-rifle-v2`; pistol has
`cs2-pistol-v1`, and known CS2 families without a concrete adapter use an explicit
`cs2-generic-v1` authoring scaffold instead of the knife tree. The skill documentation now requires
the LLM to author and validate that scaffold before review can pass.

Project evidence:

- `.img2threejs/v2/reference/cs2-intake-v2.json` now reports `state=proceed`, `componentAdapter=cs2-rifle-v2`.
- `.img2threejs/v2/reviews/cs2-review-pass-123.json` rejects only the honest visual gates: macro silhouette,
  critical features, projection lock, and pre-material finish scores. It no longer reports a missing rifle adapter
  or unsupported family.
- `.img2threejs/v2/reviews/cs2-review-inputs-pass-123.json` records the pass-123 measurements and per-region
  confidence without using NotebookLM as a visual score.

The next geometry action remains the receiver/stock macro envelope. Bolt evidence is now split correctly:
side-close and closed/open motion validate ownership and function; the top view remains an occlusion stress
view because the supplied references contain no top orthographic plate. Do not unlock projection or material
work while the broadside macro IoU remains below `0.90`.

## Recovery update — pass 126 / loop 111

The active V2 correction now keeps the bolt action as one physical receiver-parented hierarchy while making
the source-like metal station readable from the requested stress angles. The correction was intentionally
bounded to the bolt family:

- `bolt-shroud` is a body-owned steel machined edge at the rear scope-saddle station.
- `bolt-head-block` is a new body-owned steel block whose rear half is embedded in the receiver wall and whose
  near face reaches the existing positive-Z hinge-boss socket. It is not a floating mesh.
- `bolt-handle` remains a single near-side swept lever, now longer toward the stock/rear and ending in a
  real neck and spherical grip. No mirrored far-side bolt was added.

The local review confirms the head block is visible and connected in `.img2threejs/v2/renders/pass-126/bolt-3q-close.png`
and `.img2threejs/v2/renders/pass-126/bolt-top-observation.png`; the broadside comparison is in
`.img2threejs/v2/reviews/comparison-pass-126-front.png`. Runtime evidence is in
`.img2threejs/v2/renders/pass-126/runtime-manifest.json` and
`.img2threejs/v2/renders/pass-126/bolt-action-motion-test.json`: `hasTick=true`, five pivots, six sockets,
17 colliders, 14 contact/adjacency records, and zero closest gaps. The motion audit records a knob delta of
`[0.26098, -0.12544, 0]` while preserving the rigid hierarchy.

The broadside gate remains honestly failed: front/back silhouette IoU is `0.7823/0.7796`, below diagnostic
`0.85` and acceptance `0.90`. Multi-angle geometry is non-degenerate (`collapseRatio=0.15`), but the top
view is only an occlusion stress test because no top orthographic bolt source was supplied. Projection and
finish remain locked. Pass-126 review evidence is `.img2threejs/v2/reviews/feature-reviews-pass-126.json`,
`.img2threejs/v2/reviews/review-contract-pass-126.md`,
`.img2threejs/v2/reviews/cs2-review-pass-126.json`, and
`.img2threejs/v2/reviews/diagnostic/pass-126-front.json`/`pass-126-back.json`.

The state authority is synchronized at loop `111/130` in `.img2threejs/state-v2.json`; the next family is
`receiver-stock-macro-envelope`. NotebookLM remains advisory only; the latest available audit is loop 123,
whose chat was rate-limited, so no external score was substituted for the local source comparison.

## Recovery update — pass 127 / loop 112 (rejected and rolled back)

Pass 127 tested a single stock negative-space hypothesis: the thumbhole center moved from `(-3.22, 0.07)`
to `(-3.10, 0.20)` and the stock-owned paint-panel construction used the same center. The local crop looked
closer, but the full-frame deterministic gate overruled it: front IoU fell from `0.7823` to `0.7697`, and
back IoU fell from `0.7796` to `0.7659`. Aspect/scale stayed stable, so this was a geometry-mask regression,
not a camera change. The code is restored to the pass-126 station; do not repeat this crop-only thumbhole move.

Evidence: `.img2threejs/v2/measurements/pass-127-thumbhole-station-rejection.md`,
`.img2threejs/v2/reviews/comparison-pass-127-front.png`,
`.img2threejs/v2/reviews/diagnostic/pass-127-front.json`,
`.img2threejs/v2/reviews/diagnostic/pass-127-back.json`,
`.img2threejs/v2/reviews/feature-reviews-pass-127.json`, and
`.img2threejs/v2/reviews/review-contract-pass-127.md`. The retained pass remains `pass-126`; state is
synchronized at loop `112/130` and the next loop must use a different measured macro hypothesis.

## Recovery update — pass 128 / loop 113 (retained provisionally; stopped at boundary)

Pass 128 addressed the latest bolt observability complaint with one bounded geometry change only:
`bolt-head-block` moved body-local `z=0.16 -> 0.23`. The receiver-parented `bolt` pivot, coaxial
body/raceway, circular near-side hinge boss, handle-root socket, long rearward/downward handle, knob,
cycle travel, and no-far-side-duplicate policy stayed fixed. This exposes the machined head edge beneath
the rear scope saddle in broadside/orbit-right and in the top stress orbit without adding a camera-facing
marker or floating mechanism.

Evidence: `.img2threejs/v2/measurements/pass-128-bolt-top-observability.md`,
`.img2threejs/v2/renders/pass-128/broadside-front.png`,
`.img2threejs/v2/renders/pass-128/orbit-right.png`,
`.img2threejs/v2/renders/pass-128/orbit-top.png`,
`.img2threejs/v2/renders/pass-128/runtime-manifest.json`,
`.img2threejs/v2/renders/pass-128/bolt-action-motion-test.json`,
`.img2threejs/v2/reviews/comparison-pass-128-front.png`,
`.img2threejs/v2/reviews/diagnostic/pass-128-front.json`,
`.img2threejs/v2/reviews/diagnostic/pass-128-back.json`,
`.img2threejs/v2/reviews/diagnostic/pass-128-multi-angle.json`,
`.img2threejs/v2/reviews/feature-reviews-pass-128.json`,
`.img2threejs/v2/reviews/cs2-review-pass-128.json`, and
`.img2threejs/v2/reviews/review-contract-pass-128.md`.

The local runtime audit passes (`hasTick=true`, cycle hook present, 14 authored contacts, zero closest
gaps), and the multi-angle check remains non-degenerate. The broadside macro gate is still failed at
front/back IoU `0.7823/0.7796`; projection and finish remain locked. The review action is
`refine-code`, so the correction is retained provisionally, not accepted as final likeness. State is
current in `.img2threejs/state-v2.json` at `113/130`, `currentStep=await-pass-transition`; no pass-129
work was started. Resume only after explicitly choosing the next measured macro family.

## Workflow handoff — foundation-first-v2 checkpoint

The generic workflow now enforces `intake → calibration → macro-blockout → assembly → surface →
final-audit`, per-region macro gates, and one falsifiable hypothesis per correction loop. The
project-local execution contract is `.img2threejs/v2/workflow/foundation-first-workflow-v2.md`.

This V2 checkpoint is paused safely at `await-pass-transition` after pass 128. The next eligible
family is `receiver-stock-macro-envelope`; `bolt`, `scope`, `projection`, `materials`, and
`micro-detail` are locked for that loop. Before any edit, record the receiver/stock macro
hypothesis, baseline metrics, allowed changes, target regions, and rollback conditions. A global
score cannot override a failed critical region, and two failed hypotheses in one family require
remeasurement/new foundation epoch. No pass 129 has started and V1 remains immutable.

## Recovery update — pass 129 / loop 113 (rejected and rolled back)

Pass 129 was the first attempt in the `receiver-stock-macro-envelope` family. Measurement is in
`.img2threejs/v2/measurements/pass-129-receiver-bare-top-envelope.md`. Comparing an aligned crop
of the reference against pass-128 showed the receiver reading as a thin gray strip beneath the
top rail in the source, but as a tall slab fused with the rail in the render. Root cause: the
receiver top-edge polygon was flat at `y=0.70` from `x=-2.52` to `x=0.83`, but `addRail()` only
covers `x=-1.90..0.80`, so the bare span `x=-2.52..-1.90` (behind the stock/bolt-handle junction)
already sat at the rail's own height with no visible step.

The bounded fix replaced the single point `[-2.52, 0.70]` with `[-2.52, 0.52] -> [-1.92, 0.52] ->
[-1.90, 0.70]`, lowering only that bare span while leaving the crown, muzzle-side taper, bottom
edge, rail, bolt, scope, stock, barrel, magazine, bipod, trigger/guard, action block, fasteners,
bolt pocket, and every contact/pivot/socket untouched. Front/back map-stripped silhouette IoU
regressed from the retained pass-128 `0.7823/0.7796` to `0.7798/0.7764`, tripping the pre-declared
rollback condition. The code was restored exactly; `broadside-front.png`/`broadside-back.png`
hashes in `.img2threejs/v2/renders/rollback-pass129-to-pass128/` match pass-128 byte-for-byte.

Evidence: `.img2threejs/v2/measurements/pass-129-receiver-bare-top-envelope.md`,
`.img2threejs/v2/reviews/feature-reviews-pass-129.json`,
`.img2threejs/v2/reviews/review-contract-pass-129.md`,
`.img2threejs/v2/reviews/comparison-pass-129-front.png`,
`.img2threejs/v2/reviews/diagnostic/pass-129-front.json`,
`.img2threejs/v2/reviews/diagnostic/pass-129-back.json`,
`.img2threejs/v2/reviews/diagnostic/pass-129-multi-angle.json`, and
`.img2threejs/v2/renders/pass-129/runtime-manifest.json`.

State is synchronized at loop `114/130` in `.img2threejs/state-v2.json`, with
`latestRetainedPass=pass-128` and `latestRejectedPass=pass-129`; `currentStep` is set back to
`await-pass-transition` after the sync. This is attempt `1/2` in the `receiver-stock-macro-envelope`
family: the next loop must try a *different* receiver-stock-macro-envelope hypothesis (not repeat
this exact bare-span step). If a second distinct hypothesis in this family also fails, stop
nudging this family and remeasure the source/camera/region matrix before a third attempt. No
pass-130 work has started, `bolt`/`scope`/`projection`/`materials`/`micro-detail` remain locked,
and V1 remains immutable.
