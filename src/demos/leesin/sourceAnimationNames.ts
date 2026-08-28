/**
 * Readable names for the 11 source clips, derived from MEASURED motion, not from guesswork about
 * which game action each one is.
 *
 * The source exports them as `NlaTrack`, `NlaTrack.001` ... `NlaTrack.010` -- Blender NLA strip names,
 * which say nothing. Each clip was sampled at 25 evenly spaced times and the world position of the
 * Hip, Head, both Hands and both Feet joints was tracked. `travel` is the furthest the Hip moves in
 * the ground plane from where it started, `rise` its vertical range, and the hand/foot figures the
 * largest per-axis range of those joints. Every number below is in source units (the figure is 1.0
 * tall), and every clip measured `max |scale - 1| = 0.000`, so no joint is scaled in any of them.
 *
 * The names describe the measured motion. Where a name implies intent -- `guard`, `strike` -- that is
 * an interpretation of the measurement and is flagged `inferred: true`; the source name is always
 * kept on the clip's userData so nothing is lost.
 */
export interface SourceAnimationName {
  /** The clip name as the source GLB exports it. */
  readonly sourceName: string;
  /** Stable id used by the runtime and the UI. */
  readonly id: string;
  /** Short human label. */
  readonly label: string;
  /** The measurement the name rests on. */
  readonly measured: string;
  /** True when the wording implies an intent the measurement cannot prove. */
  readonly inferred: boolean;
  /** Loop, decided by measurement: a clip that neither travels nor rises can repeat seamlessly. */
  readonly loop: boolean;
  /**
   * Kept in the payload but not offered as an action.
   *
   * The clip is still constructed, still counted, and its key times and values are still transferred
   * byte-for-byte, so the accessor-parity chain and the 11-clip / 1,353-track / 20,466-key gates are
   * untouched. It is only absent from the buttons.
   */
  readonly hidden?: boolean;
}

export const LEESIN_SOURCE_ANIMATION_NAMES: readonly SourceAnimationName[] = [
  {
    sourceName: 'NlaTrack',
    id: 'run-forward',
    label: 'Run forward',
    measured: 'travels 1.465 in 1.833 s, hips flat (rise 0.021), feet range 1.492',
    inferred: false,
    loop: false,
  },
  {
    sourceName: 'NlaTrack.001',
    id: 'step-and-swing-arms',
    label: 'Step and swing arms',
    measured: 'travel 0.123, hands range 0.494, feet 0.374, head rise 0.157 over 2.833 s',
    inferred: false,
    /**
     * Looped on the owner's instruction, against the measurement.
     *
     * By the pose-return test this is the WORST clip in the set to loop: the joint orientations at
     * `t = duration` differ from `t = 0` by 71.11 degrees, where `idle-gesture` -- which does loop
     * cleanly -- differs by 0.04, and the next worst clip here is 21.27. The hips also end 0.083 from
     * where they started. So each wrap snaps visibly; that is inherent to the clip, not a bug in the
     * player, and it would need a blended cross-fade or a re-timed exit pose to remove.
     */
    loop: true,
  },
  {
    sourceName: 'NlaTrack.002',
    id: 'arms-only-feet-planted',
    label: 'Arms only, feet planted',
    measured: 'feet range 0.048 (planted), hands 0.472, hips flat (rise 0.008) over 2.917 s',
    inferred: false,
    loop: false,
  },
  {
    sourceName: 'NlaTrack.003',
    id: 'jump-in-place',
    label: 'Jump in place',
    measured: 'rise 0.248 with travel 0.272 in 0.833 s, the shortest and tallest clip',
    inferred: false,
    loop: false,
  },
  {
    sourceName: 'NlaTrack.004',
    id: 'idle-still',
    label: 'Idle, still',
    measured: '13.708 s with travel 0.013, rise 0.0001, hands 0.042 -- effectively motionless',
    inferred: false,
    loop: true,
    // Withdrawn from the UI on the owner's call: 13.7 s of measured near-stillness (travel 0.013,
    // rise 0.0001) has nothing to look at. `idle-gesture` remains as the looping idle.
    hidden: true,
  },
  {
    sourceName: 'NlaTrack.005',
    id: 'dash-forward',
    label: 'Dash forward',
    measured: 'travels 2.906 in 1.292 s -- 2.25 units per second, the fastest clip, hips flat',
    inferred: false,
    loop: false,
  },
  {
    sourceName: 'NlaTrack.006',
    id: 'leap-forward',
    label: 'Leap forward',
    measured: 'travels 2.826 AND rises 0.517 over 2.750 s -- the only clip that does both',
    inferred: false,
    loop: false,
  },
  {
    sourceName: 'NlaTrack.007',
    id: 'idle-gesture',
    label: 'Idle with gesture',
    measured: '13.833 s, travel 0.121, but hands range 0.609 and head rise 0.317',
    inferred: false,
    loop: true,
  },
  {
    sourceName: 'NlaTrack.008',
    id: 'strike-short',
    label: 'Short strike',
    measured: '2.000 s in place (travel 0.283), hands 0.366, feet 0.317',
    inferred: true,
    loop: false,
  },
  {
    sourceName: 'NlaTrack.009',
    id: 'walk-forward',
    label: 'Walk forward',
    measured: 'travels 1.133 in 2.833 s -- 0.40 units per second, hips flat (rise 0.019)',
    inferred: false,
    loop: false,
  },
  {
    sourceName: 'NlaTrack.010',
    id: 'strike-wide',
    label: 'Wide strike',
    measured: '2.250 s in place (travel 0.275), hands 0.552 -- the widest arm range of the in-place clips',
    inferred: true,
    loop: false,
  },
];

const BY_SOURCE = new Map(LEESIN_SOURCE_ANIMATION_NAMES.map((entry) => [entry.sourceName, entry]));

export function describeSourceAnimation(sourceName: string): SourceAnimationName {
  const entry = BY_SOURCE.get(sourceName);
  if (!entry) {
    throw new Error(`Lee Sin source animation ${sourceName} has no measured name entry`);
  }
  return entry;
}
