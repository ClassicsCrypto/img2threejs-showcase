/**
 * Where the strikes are, measured rather than eyeballed.
 *
 * Effects are worthless if they fire at the wrong instant, and "watch it and pick a timestamp" does
 * not survive a clip being renamed or reordered. So every entry below came out of a sweep of all
 * eleven clips at 200 samples each, tracking the WORLD position of both hands, both feet and the hip.
 *
 * A strike is defined as three things happening together, which is what separates a landed hit from
 * an arm merely reversing direction:
 *
 *   1. a local maximum in limb speed at or above 60% of that limb's 95th-percentile speed for the
 *      clip, and at least 1.0 H/s;
 *   2. that speed collapsing by at least 55% within 0.14 s -- the limb is stopped, not curving;
 *   3. the stop happening at EXTENSION: hip-to-limb distance in the top 30% of that limb's range for
 *      the clip. A gesture reverses close to the body; a strike ends reaching out.
 *
 * Percentiles, not maxima, on purpose. A first pass thresholded against the per-clip maximum and
 * `leap-forward` reported a 28.6 H/s peak, which pushed its threshold to 12.9 H/s and rejected every
 * real event in the clip. That peak was a sampling artifact -- the last sample sat exactly on
 * `t = duration`, where `clampWhenFinished` snaps the pose and produces a 0.197-unit jump across a
 * 6.9 ms step. The clip data is clean. Nothing is ever scheduled at `t = duration`, and the detector
 * now uses the 95th percentile, where a single bad sample cannot move the threshold.
 *
 * What the sweep found, and what it correctly did NOT find:
 *
 *   strike-short   hand.r @ 0.462 s   v 3.10 H/s   reach 0.296   <- one clean strike
 *   strike-wide    hand.r @ 0.464 s   v 2.29 H/s   reach 0.375   <- one, reaching further
 *   jump-in-place  foot.l @ 0.201 s   v 1.10 H/s   reach 0.576   <- landing, not a strike
 *   walk-forward   foot.r @ 1.125 s and 2.549 s    reach 0.623   <- footfalls
 *   dash-forward   nothing, despite the highest limb speeds in the set (p95 4.7-5.2 H/s)
 *   run-forward    nothing
 *   idle-still     nothing
 *
 * `dash-forward` and `run-forward` returning nothing is the detector working, not failing: fast
 * locomotion never decelerates at extension. `strike-wide` reaching 0.375 against `strike-short`'s
 * 0.296 is independent support for the two names, which were flagged `inferred` when they were given.
 *
 * `arms-only-feet-planted` and `idle-gesture` are deliberately left with no discrete events. Their
 * median hand speed is 1.56-1.62 H/s -- the whole clip is arm movement -- so discrete bursts fire
 * constantly and read as noise. The continuous speed-driven trail carries those clips instead.
 */

/** Limb endpoints, resolved from rig topology rather than from joint names. */
export const STRIKE_LIMBS = {
  /**
   * Hands are the rig's two upper-limb endpoints, already resolved for the weapon sockets.
   * Feet are the two LOWEST leaf joints that are laterally separated (|x| > 0.03).
   *
   * The lateral filter is load-bearing. Taking simply the lowest leaves picks node 41 first, which
   * sits at x = 0.000, y = 0.012 -- a centreline root marker, not a foot. Node 17 (x = 0.013,
   * y = 0.782) is the other centreline leaf. With those excluded the feet come out as 0 and 10.
   */
  'hand.l': 32,
  'hand.r': 22,
  'foot.l': 0,
  'foot.r': 10,
} as const;

/** Highest-degree joint in the skeleton; the reach reference for the extension test. */
export const STRIKE_HIP_NODE = 36;

/**
 * How far past the wrist the fist sits, as a fraction of the forearm's length.
 *
 * The hand joints are at the WRIST -- `source-node-32` at (-0.335, 0.548, 0.156) with its parent
 * `source-node-33` at (-0.235, 0.620, 0.111), a forearm of 0.1313 -- so an effect placed on the joint
 * appears at the wrist, a little behind where a punch actually connects. The fist is carried forward
 * along the same axis.
 *
 * Derived from the joint chain rather than from vertices, deliberately. Skinned vertex positions and
 * joint world positions do NOT share a frame in this demo: attached bind mode cancels `matrixWorld`
 * inside the skinning path but not inside `getWorldPosition`, so mixing the two put the "fist"
 * 0.39-0.63 units from its own wrist -- further than the body's radius. The forearm axis needs no
 * vertex data and cannot drift.
 */
export const HAND_TIP_FOREARM_FRACTION = 0.35;

export type StrikeLimb = keyof typeof STRIKE_LIMBS;

/**
 * How a hit should read.
 *
 * `impact`   a landed blow -- concentric flare and air ring, warm embers.
 * `punch`    a fast straight strike -- adds a wind tear, the 3D crescent that reads as air being cut.
 * `footfall` weight meeting the ground -- a low dust ring, no heat.
 */
export type StrikeKind = 'impact' | 'footfall' | 'punch';

export interface StrikeEvent {
  readonly clip: string;
  readonly limb: StrikeLimb;
  /** Seconds into the clip. Never equal to the clip duration. */
  readonly time: number;
  /** Limb speed at the peak, in figure heights per second. */
  readonly speed: number;
  /** Fraction of that speed lost within 0.14 s. */
  readonly decel: number;
  /** Hip-to-limb distance at the stop, in figure heights. */
  readonly reach: number;
  readonly kind: StrikeKind;
  /**
   * Launch a travelling orb from the fist as well as the local burst.
   *
   * Set only where the strike reads as a release rather than a contact. `strike-wide` reaches 0.377 --
   * the widest of the in-place strikes -- and ends with the arm thrown fully open, which is the shape
   * of a throw. The other strikes stop short and read as connecting with something.
   */
  readonly projectile?: boolean;
}

export const STRIKE_EVENTS: readonly StrikeEvent[] = [
  /**
   * `time` is the instant the hand FINISHES its travel, not the instant it is fastest.
   *
   * The detector locates a strike by its peak speed, and the first version fired the burst there.
   * That is too early: the hand is still travelling at 3 H/s and has not landed anything. Measured at
   * 500 samples per clip, maximum hip-to-hand reach -- the visual moment a strike arrives -- lands
   * 0.040 to 0.135 s later, and the difference is large:
   *
   *   strike-short          peak 0.462  ->  full reach 0.502   reach 0.366 -> 0.380
   *   strike-wide           peak 0.464  ->  full reach 0.599   reach 0.234 -> 0.377  (+61%)
   *   step-and-swing hand.r peak 1.905  ->  full reach 1.962   reach 0.254 -> 0.287
   *   step-and-swing hand.l peak 2.118  ->  full reach 2.243   reach 0.311 -> 0.410
   *
   * `speed` and `decel` still describe the peak, because that is what identified the strike.
   */
  { clip: 'strike-short', limb: 'hand.r', time: 0.502, speed: 3.10, decel: 0.58, reach: 0.380, kind: 'impact' },
  { clip: 'strike-wide', limb: 'hand.r', time: 0.599, speed: 2.29, decel: 0.63, reach: 0.377, kind: 'impact', projectile: true },
  /**
   * The one-two in `step-and-swing-arms`, added after the clip was re-measured at 400 samples.
   *
   * The strict pass in the first sweep kept only the left hand, because it gated reach at the 70th
   * percentile and demanded 60% of p95 speed. Relaxing to the 60th percentile and 40% of p95 -- still
   * requiring a stop AT extension, which is what separates a punch from a swing -- resolves both
   * hands, 0.213 s apart:
   *
   *   hand.r 1.905 s  v 3.08  reach 0.268 = 93% of that hand's maximum reach in the clip
   *   hand.l 2.118 s  v 4.61  reach 0.410 = 100% of maximum, and the fastest hand event measured
   *                                          across all eleven clips
   *
   * Both stopping at essentially full extension is the evidence they are punches and not the arm
   * swings the rest of this clip is made of.
   */
  { clip: 'step-and-swing-arms', limb: 'hand.r', time: 1.962, speed: 3.08, decel: 0.56, reach: 0.287, kind: 'punch' },
  { clip: 'step-and-swing-arms', limb: 'hand.l', time: 2.243, speed: 4.61, decel: 0.87, reach: 0.410, kind: 'punch' },
  { clip: 'jump-in-place', limb: 'foot.l', time: 0.201, speed: 1.10, decel: 0.86, reach: 0.576, kind: 'footfall' },
  { clip: 'walk-forward', limb: 'foot.r', time: 1.125, speed: 1.16, decel: 0.65, reach: 0.623, kind: 'footfall' },
  { clip: 'walk-forward', limb: 'foot.r', time: 2.549, speed: 1.27, decel: 0.69, reach: 0.623, kind: 'footfall' },
];

/**
 * Speed at which a limb's trail reaches full strength, per clip, in figure heights per second.
 *
 * Taken from each clip's measured 95th-percentile limb speed so the trail is calibrated to the clip
 * it plays in: a value tuned on `dash-forward` (p95 ~5.1) would leave `strike-short` (p95 2.44)
 * almost invisible, and one tuned on `idle-still` (p95 0.34) would smear everything.
 */
export const CLIP_TRAIL_REFERENCE: Readonly<Record<string, number>> = {
  'run-forward': 2.6,
  'step-and-swing-arms': 3.7,
  'arms-only-feet-planted': 2.9,
  'jump-in-place': 1.4,
  'idle-still': 0.35,
  'dash-forward': 5.1,
  'leap-forward': 4.7,
  'idle-gesture': 1.7,
  'strike-short': 2.4,
  'walk-forward': 2.3,
  'strike-wide': 1.9,
};

/** Below this share of the clip reference a limb leaves no trail at all, so idle stays clean. */
export const TRAIL_GATE = 0.28;

export function strikesForClip(clip: string): readonly StrikeEvent[] {
  return STRIKE_EVENTS.filter((event) => event.clip === clip);
}
