/**
 * Make neighbouring parts deform together, so the skin cannot split where they meet.
 *
 * The source builds the neck, shoulders and every wrap from separate overlapping sheets. Two vertices
 * that sit on top of each other in bind pose but answer to different joints MUST separate as soon as
 * those joints diverge, and that is what tore the skin open when a clip played.
 *
 * A first version only harmonised vertices at exactly the same position (within 0.1 mm). It closed the
 * long neck-to-collarbone crack, but a sweep of all eleven clips at four times and three azimuths
 * still found cracks in 28 of 132 frames -- 1,410 pixels of background through thin slits, worst on
 * `arms-only-feet-planted` and around the shoulder. The reason is that adjacent parts mostly OVERLAP
 * rather than share a rim: their vertices are near each other, not coincident, so nothing was welded.
 *
 * This version blends by proximity instead. Every vertex that has a vertex from ANOTHER part within
 * `BLEND_RADIUS_METRES` mixes its four-influence binding with theirs, weighted by (1 - d/R)^2, then
 * reduces back to the strongest four and renormalises. Vertices with no foreign neighbour -- the
 * interior of every part, which is most of the model -- keep the source's binding untouched, as do all
 * positions, normals and UVs.
 *
 * The trade is explicit: inside the overlap band the deformation is no longer bit-identical to the
 * source's, because the source's own deformation is what pulls the parts apart there.
 */
export interface SeamWeldReport {
  /** Vertices that had at least one neighbour from a different part inside the radius. */
  boundaryZoneVertices: number;
  /** Vertices whose binding actually changed. */
  harmonisedVertices: number;
  /** Largest L1 change to a single vertex's dense weight vector. */
  maxWeightChangeL1: number;
  /** Mean L1 change over the vertices that changed. */
  meanWeightChangeL1: number;
  radiusMetres: number;
}

export interface SeamWeldInput {
  readonly node: number;
  readonly positions: Float32Array;
  readonly joints: Uint8Array;
  readonly weights: Float32Array;
}

/**
 * 6 mm, chosen against a control run with the blend switched off. Sweeping all eleven clips at four
 * times, both shoulders and two azimuths -- 176 frames -- and counting only background visible through
 * a slit narrow enough to be a split rather than a real opening:
 *
 *     blend off : 974 px in 30 blobs
 *     blend 6 mm: 287 px in 15 blobs
 *
 * The same sweep counts thin dark lines inside the silhouette, and there the blend costs a little:
 * 31,316 px off against 36,470 px on. Averaging two parts' bindings makes them travel together, which
 * is what closes the opening, but it also pulls each slightly off the path its own joints would have
 * taken, and where two parts overlap that shows as a crease instead of a hole. Closing the hole is the
 * better trade: a hole shows the background, a crease shows skin.
 */
const BLEND_RADIUS_METRES = 0.006;
const JOINT_COUNT = 256;
const CHANGE_EPSILON = 1e-4;

export function weldSeamSkinning(parts: readonly SeamWeldInput[]): SeamWeldReport {
  const radius = BLEND_RADIUS_METRES;
  const radiusSq = radius * radius;

  // Uniform grid hash at one radius per cell, so a query touches at most 27 buckets.
  const buckets = new Map<string, number[]>();
  const partOf: number[] = [];
  const vertexOf: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  parts.forEach((part, partIndex) => {
    const count = part.positions.length / 3;
    for (let v = 0; v < count; v += 1) {
      const x = part.positions[v * 3];
      const y = part.positions[v * 3 + 1];
      const z = part.positions[v * 3 + 2];
      const id = partOf.length;
      partOf.push(partIndex); vertexOf.push(v); xs.push(x); ys.push(y); zs.push(z);
      const key = `${Math.floor(x / radius)},${Math.floor(y / radius)},${Math.floor(z / radius)}`;
      let list = buckets.get(key);
      if (!list) { list = []; buckets.set(key, list); }
      list.push(id);
    }
  });

  const total = partOf.length;
  const denseOf = (id: number, out: Float64Array): void => {
    out.fill(0);
    const part = parts[partOf[id]];
    const v = vertexOf[id];
    for (let k = 0; k < 4; k += 1) out[part.joints[v * 4 + k]] += part.weights[v * 4 + k];
  };

  const own = new Float64Array(JOINT_COUNT);
  const other = new Float64Array(JOINT_COUNT);
  const mixed = new Float64Array(JOINT_COUNT);
  // Written after every vertex has been read, so the blend uses only source bindings and the result
  // does not depend on iteration order.
  const outJoints = parts.map((p) => p.joints.slice());
  const outWeights = parts.map((p) => p.weights.slice());

  let boundaryZoneVertices = 0;
  let harmonisedVertices = 0;
  let maxWeightChangeL1 = 0;
  let sumChange = 0;

  for (let id = 0; id < total; id += 1) {
    const px = xs[id]; const py = ys[id]; const pz = zs[id];
    const bx = Math.floor(px / radius); const by = Math.floor(py / radius); const bz = Math.floor(pz / radius);
    let foreign = 0;
    denseOf(id, own);
    mixed.set(own);
    let weightSum = 1;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const list = buckets.get(`${bx + dx},${by + dy},${bz + dz}`);
          if (!list) continue;
          for (const q of list) {
            if (partOf[q] === partOf[id]) continue;
            const ddx = xs[q] - px; const ddy = ys[q] - py; const ddz = zs[q] - pz;
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d2 > radiusSq) continue;
            const falloff = (1 - Math.sqrt(d2) / radius) ** 2;
            if (falloff <= 0) continue;
            foreign += 1;
            denseOf(q, other);
            for (let j = 0; j < JOINT_COUNT; j += 1) mixed[j] += other[j] * falloff;
            weightSum += falloff;
          }
        }
      }
    }
    if (foreign === 0) continue;
    boundaryZoneVertices += 1;
    for (let j = 0; j < JOINT_COUNT; j += 1) mixed[j] /= weightSum;

    const order: number[] = [];
    for (let j = 0; j < JOINT_COUNT; j += 1) if (mixed[j] > 0) order.push(j);
    order.sort((a, b) => mixed[b] - mixed[a]);
    const top = order.slice(0, 4);
    let sum = 0;
    for (const j of top) sum += mixed[j];
    if (sum <= 0) continue;

    let change = 0;
    for (let j = 0; j < JOINT_COUNT; j += 1) {
      const after = top.includes(j) ? mixed[j] / sum : 0;
      change += Math.abs(after - own[j]);
    }
    if (change <= CHANGE_EPSILON) continue;

    const part = partOf[id];
    const v = vertexOf[id];
    for (let k = 0; k < 4; k += 1) {
      outJoints[part][v * 4 + k] = k < top.length ? top[k] : 0;
      outWeights[part][v * 4 + k] = k < top.length ? mixed[top[k]] / sum : 0;
    }
    harmonisedVertices += 1;
    sumChange += change;
    if (change > maxWeightChangeL1) maxWeightChangeL1 = change;
  }

  parts.forEach((part, index) => {
    part.joints.set(outJoints[index]);
    part.weights.set(outWeights[index]);
  });

  return {
    boundaryZoneVertices,
    harmonisedVertices,
    maxWeightChangeL1,
    meanWeightChangeL1: harmonisedVertices ? sumChange / harmonisedVertices : 0,
    radiusMetres: radius,
  };
}
