/**
 * Close the open rims of the source's sheets so a posed frame cannot show background through them.
 *
 * Fifty-seven of the source's sixty-nine drawable meshes are open sheets -- 3,342 boundary edges in
 * total -- and the neck and shoulder are built from several of them overlapping. In bind pose the
 * overlap hides every rim. Posed, the parts slide against each other and the rims come apart: at
 * strike-wide, seen from 40 degrees, 742 pixels of background show through a crack running from the
 * neck across the collarbone.
 *
 * This is NOT a skinning error, and it was checked rather than assumed: at a posed frame the runtime's
 * skinned vertices match a glTF-correct CPU evaluation of the same clip to a median of 25 nanometres
 * and a maximum of 6.3 micrometres across all 52,322 vertices. The gap is in the source's own
 * geometry, so closing it means adding to the source rather than correcting it.
 *
 * The cap adds no vertex to the visible surface and moves no existing one. Each connected run of
 * boundary edges gets one new vertex at its centroid and one triangle per edge, and that vertex
 * inherits its UV, joints and weights from the rim vertex nearest the centroid -- so the cap is
 * skin-coloured, deforms with the same joints as the rim it closes, and can only ever be seen through
 * a gap that would otherwise have shown the background.
 *
 * A UV seam splits vertices, which makes an interior edge look like a boundary in index space. Edges
 * are therefore counted after welding by position, so only genuine rims are capped.
 */
export interface BoundaryCap {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly joints: Uint8Array;
  readonly weights: Float32Array;
  readonly indices: Uint32Array;
  readonly report: {
    readonly boundaryEdges: number;
    readonly loops: number;
    readonly addedVertices: number;
    readonly addedTriangles: number;
  };
}

interface SourceArrays {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  joints: Uint8Array;
  weights: Float32Array;
  indices: Uint32Array;
}

const WELD_DECIMALS = 6;

export function capOpenBoundaries(src: SourceArrays): BoundaryCap {
  const vertexCount = src.positions.length / 3;
  const triangleCount = src.indices.length / 3;

  // ---- weld by position ------------------------------------------------------------------------
  const scale = 10 ** WELD_DECIMALS;
  const weldOf = new Int32Array(vertexCount);
  const byKey = new Map<string, number>();
  const representative: number[] = [];
  for (let v = 0; v < vertexCount; v += 1) {
    const key = `${Math.round(src.positions[v * 3] * scale)},`
      + `${Math.round(src.positions[v * 3 + 1] * scale)},`
      + `${Math.round(src.positions[v * 3 + 2] * scale)}`;
    let id = byKey.get(key);
    if (id === undefined) {
      id = representative.length;
      byKey.set(key, id);
      representative.push(v);
    }
    weldOf[v] = id;
  }

  // ---- boundary edges in welded space ----------------------------------------------------------
  const uses = new Map<number, number>();
  const sample = new Map<number, [number, number]>();
  const stride = representative.length + 1;
  for (let t = 0; t < triangleCount; t += 1) {
    for (let c = 0; c < 3; c += 1) {
      const oa = src.indices[t * 3 + c];
      const ob = src.indices[t * 3 + ((c + 1) % 3)];
      const wa = weldOf[oa];
      const wb = weldOf[ob];
      if (wa === wb) continue;
      const key = wa < wb ? wa * stride + wb : wb * stride + wa;
      uses.set(key, (uses.get(key) ?? 0) + 1);
      if (!sample.has(key)) sample.set(key, [oa, ob]);
    }
  }
  const boundary: Array<[number, number]> = [];
  for (const [key, count] of uses) {
    if (count === 1) boundary.push(sample.get(key)!);
  }
  if (boundary.length === 0) {
    return {
      positions: src.positions,
      normals: src.normals,
      uvs: src.uvs,
      joints: src.joints,
      weights: src.weights,
      indices: src.indices,
      report: { boundaryEdges: 0, loops: 0, addedVertices: 0, addedTriangles: 0 },
    };
  }

  // ---- group the rims into connected runs ------------------------------------------------------
  const parent = new Int32Array(representative.length);
  for (let i = 0; i < parent.length; i += 1) parent[i] = i;
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    let c = x;
    while (parent[c] !== c) { const next = parent[c]; parent[c] = r; c = next; }
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a); const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (const [oa, ob] of boundary) union(weldOf[oa], weldOf[ob]);

  const members = new Map<number, number[]>();
  for (const [oa, ob] of boundary) {
    const root = find(weldOf[oa]);
    let list = members.get(root);
    if (!list) { list = []; members.set(root, list); }
    list.push(oa, ob);
  }

  const addedPositions: number[] = [];
  const addedNormals: number[] = [];
  const addedUvs: number[] = [];
  const addedJoints: number[] = [];
  const addedWeights: number[] = [];
  const centroidIndexOf = new Map<number, number>();
  let nextIndex = vertexCount;

  for (const [root, list] of members) {
    const unique = [...new Set(list)];
    let cx = 0; let cy = 0; let cz = 0;
    let nx = 0; let ny = 0; let nz = 0;
    for (const v of unique) {
      cx += src.positions[v * 3]; cy += src.positions[v * 3 + 1]; cz += src.positions[v * 3 + 2];
      nx += src.normals[v * 3]; ny += src.normals[v * 3 + 1]; nz += src.normals[v * 3 + 2];
    }
    const inv = 1 / unique.length;
    cx *= inv; cy *= inv; cz *= inv;
    const nlen = Math.hypot(nx, ny, nz) || 1;
    // The nearest rim vertex donates UV and skin binding: averaging UVs across a run that crosses a
    // UV seam would sample an unrelated chart, and averaging joint indices is meaningless.
    let donor = unique[0];
    let best = Infinity;
    for (const v of unique) {
      const d = (src.positions[v * 3] - cx) ** 2
        + (src.positions[v * 3 + 1] - cy) ** 2
        + (src.positions[v * 3 + 2] - cz) ** 2;
      if (d < best) { best = d; donor = v; }
    }
    addedPositions.push(cx, cy, cz);
    addedNormals.push(nx / nlen, ny / nlen, nz / nlen);
    addedUvs.push(src.uvs[donor * 2], src.uvs[donor * 2 + 1]);
    for (let k = 0; k < 4; k += 1) addedJoints.push(src.joints[donor * 4 + k]);
    for (let k = 0; k < 4; k += 1) addedWeights.push(src.weights[donor * 4 + k]);
    centroidIndexOf.set(root, nextIndex);
    nextIndex += 1;
  }

  const addedIndices: number[] = [];
  for (const [oa, ob] of boundary) {
    const centroid = centroidIndexOf.get(find(weldOf[oa]));
    if (centroid === undefined) continue;
    addedIndices.push(oa, ob, centroid);
  }

  const positions = new Float32Array(src.positions.length + addedPositions.length);
  positions.set(src.positions); positions.set(addedPositions, src.positions.length);
  const normals = new Float32Array(src.normals.length + addedNormals.length);
  normals.set(src.normals); normals.set(addedNormals, src.normals.length);
  const uvs = new Float32Array(src.uvs.length + addedUvs.length);
  uvs.set(src.uvs); uvs.set(addedUvs, src.uvs.length);
  const joints = new Uint8Array(src.joints.length + addedJoints.length);
  joints.set(src.joints); joints.set(addedJoints, src.joints.length);
  const weights = new Float32Array(src.weights.length + addedWeights.length);
  weights.set(src.weights); weights.set(addedWeights, src.weights.length);
  const indices = new Uint32Array(src.indices.length + addedIndices.length);
  indices.set(src.indices); indices.set(addedIndices, src.indices.length);

  return {
    positions,
    normals,
    uvs,
    joints,
    weights,
    indices,
    report: {
      boundaryEdges: boundary.length,
      loops: members.size,
      addedVertices: addedPositions.length / 3,
      addedTriangles: addedIndices.length / 3,
    },
  };
}
