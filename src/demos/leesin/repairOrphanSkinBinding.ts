/**
 * Rebind the handful of source vertices that are skinned to a joint nothing else uses.
 *
 * THE DEFECT, AND WHERE IT COMES FROM. Three of the reference model's 52,322 vertices -- 0.006% --
 * are bound with weight 1.0 to skin joint 41. That joint maps to `source-node-41`, a CHILDLESS
 * TECHNICAL NODE sitting on the centreline at y = 0.012: the root/ground marker, not a body joint.
 * No other vertex in the model touches it. It is an authoring slip in the original rig, and it is
 * copied along with everything else because this demo transfers the accessors verbatim.
 *
 * WHY IT ONLY SHOWS DURING ANIMATION. In bind pose the marker sits under the figure and the three
 * vertices look ordinary. As soon as a clip translates the root -- `dash-forward` travels 2.906
 * figure heights -- those vertices travel with it while every neighbouring vertex stays on the body.
 * The triangles between them stretch into three hairline slivers that reach 3.23 units from the
 * body's centre, 5.8x its radius. On screen that is a one-pixel dark line running off the character
 * into empty space, present in motion and absent at rest.
 *
 * WHY THIS IS A LEGITIMATE REPAIR. It changes SKIN WEIGHTS only. Positions, normals, UVs, index
 * buffers and textures stay byte-identical to the source, and the demo already declares that it
 * recomputes skin binding (`weldSeamSkinning` harmonises 10,243 vertices across part boundaries).
 * This is the same class of change, applied to 3 vertices instead of thousands.
 *
 * WHY IT IS NOT HARD-CODED TO JOINT 41. The rule is measured, not memorised: a joint whose share of
 * the model's total skin weight is below `ORPHAN_WEIGHT_SHARE` cannot be deforming anything real, so
 * any vertex leaning on it has been left behind. On this rig that test selects exactly joint 41 and
 * nothing else. A different asset with a different stray joint is repaired by the same code.
 */

/** 0.006% of vertices sit on joint 41 here; 0.05% of total weight is a decade of headroom above it. */
const ORPHAN_WEIGHT_SHARE = 0.0005;

/** Neighbours consulted when rebuilding a vertex's binding, within its own part. */
const DONOR_COUNT = 8;

export interface OrphanSkinInput {
  readonly node: number;
  readonly positions: Float32Array;
  readonly joints: Uint8Array;
  readonly weights: Float32Array;
}

export interface OrphanSkinReport {
  /** Joints whose total weight share fell below the threshold. */
  orphanJoints: number[];
  /** Vertices that had weight on one of them. */
  rebound: number;
  /** Vertices that could not be rebound because no clean donor was found in their part. */
  unresolved: number;
  /** Largest share any orphan joint held, as a fraction of all skin weight. */
  worstOrphanShare: number;
}

export function repairOrphanSkinBinding(parts: readonly OrphanSkinInput[]): OrphanSkinReport {
  const JOINT_COUNT = 256;
  const perJoint = new Float64Array(JOINT_COUNT);
  let total = 0;
  for (const part of parts) {
    for (let i = 0; i < part.weights.length; i += 1) {
      const w = part.weights[i];
      if (w <= 0) continue;
      perJoint[part.joints[i]] += w;
      total += w;
    }
  }

  const orphanJoints: number[] = [];
  let worstOrphanShare = 0;
  for (let j = 0; j < JOINT_COUNT; j += 1) {
    if (perJoint[j] <= 0) continue;
    const share = perJoint[j] / total;
    if (share >= ORPHAN_WEIGHT_SHARE) continue;
    orphanJoints.push(j);
    if (share > worstOrphanShare) worstOrphanShare = share;
  }
  if (!orphanJoints.length) {
    return { orphanJoints: [], rebound: 0, unresolved: 0, worstOrphanShare: 0 };
  }
  const isOrphan = new Uint8Array(JOINT_COUNT);
  for (const j of orphanJoints) isOrphan[j] = 1;

  const touchesOrphan = (part: OrphanSkinInput, vertex: number): boolean => {
    for (let k = 0; k < 4; k += 1) {
      if (part.weights[vertex * 4 + k] > 0 && isOrphan[part.joints[vertex * 4 + k]]) return true;
    }
    return false;
  };

  let rebound = 0;
  let unresolved = 0;
  const dense = new Float64Array(JOINT_COUNT);

  for (const part of parts) {
    const count = part.positions.length / 3;
    const bad: number[] = [];
    for (let v = 0; v < count; v += 1) if (touchesOrphan(part, v)) bad.push(v);
    if (!bad.length) continue;

    for (const v of bad) {
      const px = part.positions[v * 3];
      const py = part.positions[v * 3 + 1];
      const pz = part.positions[v * 3 + 2];
      // Nearest clean vertices in the same part. A stray vertex sits inside real geometry, so its
      // neighbours carry the binding it should have had.
      const donors: Array<{ index: number; d2: number }> = [];
      for (let q = 0; q < count; q += 1) {
        if (q === v || touchesOrphan(part, q)) continue;
        const dx = part.positions[q * 3] - px;
        const dy = part.positions[q * 3 + 1] - py;
        const dz = part.positions[q * 3 + 2] - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (donors.length < DONOR_COUNT) {
          donors.push({ index: q, d2 });
          if (donors.length === DONOR_COUNT) donors.sort((a, b) => a.d2 - b.d2);
        } else if (d2 < donors[DONOR_COUNT - 1].d2) {
          donors[DONOR_COUNT - 1] = { index: q, d2 };
          donors.sort((a, b) => a.d2 - b.d2);
        }
      }
      if (!donors.length) { unresolved += 1; continue; }

      dense.fill(0);
      let sum = 0;
      for (const donor of donors) {
        // Inverse-distance weighting, so the closest surface wins without dividing by zero.
        const influence = 1 / (Math.sqrt(donor.d2) + 1e-4);
        for (let k = 0; k < 4; k += 1) {
          const w = part.weights[donor.index * 4 + k];
          if (w <= 0) continue;
          dense[part.joints[donor.index * 4 + k]] += w * influence;
          sum += w * influence;
        }
      }
      if (sum <= 0) { unresolved += 1; continue; }

      const order: number[] = [];
      for (let j = 0; j < JOINT_COUNT; j += 1) if (dense[j] > 0) order.push(j);
      order.sort((a, b) => dense[b] - dense[a]);
      const top = order.slice(0, 4);
      let topSum = 0;
      for (const j of top) topSum += dense[j];
      if (topSum <= 0) { unresolved += 1; continue; }

      for (let k = 0; k < 4; k += 1) {
        part.joints[v * 4 + k] = k < top.length ? top[k] : 0;
        part.weights[v * 4 + k] = k < top.length ? dense[top[k]] / topSum : 0;
      }
      rebound += 1;
    }
  }

  return { orphanJoints, rebound, unresolved, worstOrphanShare };
}
