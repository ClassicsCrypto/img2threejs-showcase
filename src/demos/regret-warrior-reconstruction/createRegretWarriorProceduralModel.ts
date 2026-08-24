import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

type ProudRingStack = { rings: [number, number, number, number][] };

// Signed distance to a stack of ellipse rings. Negative inside, positive outside.
//
// The sign is exact; the magnitude is the first-order estimate f / |grad f|, which UNDERSTATES how
// clear an outside point is and OVERSTATES how deep an inside point is. Both errors make the march
// below push slightly further than strictly necessary, which is the safe direction: the failure
// being prevented is a component sinking into the one beneath it and rendering as a bare patch.
function ringStackDistance(stack: ProudRingStack, x: number, y: number, z: number): number {
  const rings = stack.rings;
  const yMin = rings[0][0];
  const yMax = rings[rings.length - 1][0];
  let rx = rings[0][1];
  let rz = rings[0][2];
  let zc = rings[0][3];
  if (y >= yMax) {
    const last = rings[rings.length - 1];
    rx = last[1]; rz = last[2]; zc = last[3];
  } else if (y > yMin) {
    for (let i = 0; i + 1 < rings.length; i += 1) {
      const lo = rings[i];
      const hi = rings[i + 1];
      if (y >= lo[0] && y <= hi[0]) {
        const span = hi[0] - lo[0];
        const t = span > 1e-9 ? (y - lo[0]) / span : 0;
        rx = lo[1] + (hi[1] - lo[1]) * t;
        rz = lo[2] + (hi[2] - lo[2]) * t;
        zc = lo[3] + (hi[3] - lo[3]) * t;
        break;
      }
    }
  }
  const dx = x / rx;
  const dz = (z - zc) / rz;
  const f = dx * dx + dz * dz - 1;
  const gx = (2 * x) / (rx * rx);
  const gz = (2 * (z - zc)) / (rz * rz);
  const grad = Math.hypot(gx, gz);
  const radial = grad < 1e-12 ? -Math.min(rx, rz) : f / grad;
  const axial = Math.max(yMin - y, y - yMax);
  return Math.hypot(Math.max(radial, 0), Math.max(axial, 0)) + Math.min(Math.max(radial, axial), 0);
}

// Push every vertex outward until it stands `clearance` clear of the target's surface.
//
// WHY THE AUTHORED NUMBERS ARE ONLY A LOWER BOUND. A ring is an ELLIPSE, and the surface it has to
// clear generally is not. Any single ellipse that clears the widest point is loose at the narrowest
// and vice versa, so hand-widening moves the error rather than shrinking it -- measured on hair,
// where widening the side masses took closure from 42.2% to 40.9%, worse on all six views, with
// dark coverage DOWN because the widened mass had slid off the skull. Here the authored width is a
// floor and the real radius is MEASURED per vertex.
//
// Each vertex travels along its OWN radial spoke rather than along the field's gradient, so the
// ring keeps its vertex order and its seam positions and only its radius changes. `maxPush` is
// required, not a safeguard: an uncapped march walks inner vertices straight through the target and
// out the far side, closing the very gap the component exists to leave.
function applyStandProud(
  geometry: THREE.BufferGeometry,
  marcher: THREE.Object3D,
  target: THREE.Object3D,
  stack: ProudRingStack,
  clearance: number,
  maxPush: number,
): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  marcher.updateWorldMatrix(true, false);
  target.updateWorldMatrix(true, false);
  const toTarget = new THREE.Matrix4().copy(target.matrixWorld).invert().multiply(marcher.matrixWorld);
  const fromTarget = new THREE.Matrix4().copy(toTarget).invert();
  const p = new THREE.Vector3();
  // A vertex can exhaust `maxPush` and still be inside the target. That is the cap doing its job --
  // an uncapped march walks vertices out the far side -- but it means the clearance this function
  // promises was NOT achieved, and saying nothing there hides exactly the defect the caller asked
  // to be protected from. Measured on the shipped fixture: 2 of 8 sampled hair vertices sat 0.059
  // inside a skull against a 0.04 cap and could never have reached clear.
  let unresolved = 0;

  for (let i = 0; i < position.count; i += 1) {
    p.fromBufferAttribute(position, i).applyMatrix4(toTarget);
    // The spoke is the vertex's own radial direction in the target's frame; marching along it keeps
    // each ring a ring, since every vertex holds its own angle and only its radius changes.
    //
    // A vertex on the axis has no radial direction at all -- and that is precisely the crown, the
    // one place a bald patch is most visible. Skipping it leaves the exact failure this function
    // exists to prevent. So a degenerate spoke marches axially instead, out through whichever cap
    // it is nearer, which is the direction the field itself measures there.
    const spokeLength = Math.hypot(p.x, p.z);
    const onAxis = spokeLength < 1e-9;
    const midHeight = (stack.rings[0][0] + stack.rings[stack.rings.length - 1][0]) / 2;
    const sx = onAxis ? 0 : p.x / spokeLength;
    const sz = onAxis ? 0 : p.z / spokeLength;
    const sy = onAxis ? (p.y >= midHeight ? 1 : -1) : 0;

    let travelled = 0;
    for (let step = 0; step < 24; step += 1) {
      const gap = ringStackDistance(stack, p.x, p.y, p.z);
      if (gap >= clearance) break;
      const move = Math.min(Math.max(0.002, clearance - gap), maxPush - travelled);
      if (move <= 0) break;
      p.x += sx * move;
      p.y += sy * move;
      p.z += sz * move;
      travelled += move;
    }

    if (ringStackDistance(stack, p.x, p.y, p.z) < clearance) unresolved += 1;

    p.applyMatrix4(fromTarget);
    position.setXYZ(i, p.x, p.y, p.z);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();

  geometry.userData.standProud = { clearance, maxPush, unresolved, total: position.count };
  if (unresolved > 0) {
    console.warn(
      `standProud: ${unresolved}/${position.count} vertices could not reach ${clearance} within ` +
      `maxPush ${maxPush}. They are still inside the target and will render as bare patches. ` +
      `Raise maxPush, or move the component out so it does not start that deep.`,
    );
  }
}

type SdfVector = readonly [number, number, number];
type SdfTransform = { position?: SdfVector; translation?: SdfVector; rotation?: SdfVector; scale?: SdfVector };
type SdfPrimitive = {
  readonly id: string;
  readonly type: 'sphere' | 'capsule' | 'box' | 'cone' | 'ellipsoid';
  readonly center?: SdfVector;
  readonly radius?: number | SdfVector;
  readonly height?: number;
  readonly size?: SdfVector;
  readonly dimensions?: SdfVector;
  readonly radii?: SdfVector;
  readonly transform?: SdfTransform;
};
type SdfOperation = {
  readonly id?: string;
  readonly output?: string;
  readonly type: 'smooth-union' | 'subtract' | 'intersect';
  readonly left: string;
  readonly right: string;
  readonly radius?: number;
};
type SdfDescriptor = {
  readonly primitives: readonly SdfPrimitive[];
  readonly operations?: readonly SdfOperation[];
  readonly resolution: number;
  readonly bounds?: { readonly min: SdfVector; readonly max: SdfVector };
};
type SdfFunction = (point: THREE.Vector3) => number;

function sdfSphere(point: THREE.Vector3, radius: number): number {
  return point.length() - radius;
}

function sdfCapsule(point: THREE.Vector3, radius: number, height: number): number {
  const halfHeight = height * 0.5;
  const y = Math.max(-halfHeight, Math.min(halfHeight, point.y));
  return point.distanceTo(new THREE.Vector3(0, y, 0)) - radius;
}

function sdfBox(point: THREE.Vector3, size: SdfVector): number {
  const q = new THREE.Vector3(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z))
    .sub(new THREE.Vector3(size[0] * 0.5, size[1] * 0.5, size[2] * 0.5));
  return q.clone().max(new THREE.Vector3()).length() + Math.min(Math.max(q.x, q.y, q.z), 0);
}

function sdfCone(point: THREE.Vector3, radius: number, height: number): number {
  const halfHeight = height * 0.5;
  const taper = radius * (1 - (point.y + halfHeight) / height);
  return Math.max(Math.hypot(point.x, point.z) - Math.max(0, taper), Math.abs(point.y) - halfHeight);
}

function sdfEllipsoid(point: THREE.Vector3, radii: SdfVector): number {
  const scaled = new THREE.Vector3(point.x / radii[0], point.y / radii[1], point.z / radii[2]);
  return (scaled.length() - 1) * Math.min(radii[0], radii[1], radii[2]);
}

function sdfRadii(primitive: SdfPrimitive): SdfVector {
  const radius = primitive.radius;
  if (primitive.radii) return primitive.radii;
  if (typeof radius === 'number') return [radius, radius, radius];
  return radius ?? [0.5, 0.5, 0.5];
}

function smin(left: number, right: number, radius: number): number {
  const blend = Math.max(radius - Math.abs(left - right), 0) / radius;
  return Math.min(left, right) - blend * blend * radius * 0.25;
}

function sdfLocalPoint(point: THREE.Vector3, primitive: SdfPrimitive): { point: THREE.Vector3; scale: number } {
  const transform = primitive.transform;
  const translation = transform?.position ?? transform?.translation ?? primitive.center ?? [0, 0, 0];
  const rotation = transform?.rotation ?? [0, 0, 0];
  const scale = transform?.scale ?? [1, 1, 1];
  const local = point.clone().sub(new THREE.Vector3(translation[0], translation[1], translation[2]));
  const inverseRotation = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2]))
    .invert();
  local.applyQuaternion(inverseRotation);
  local.set(local.x / scale[0], local.y / scale[1], local.z / scale[2]);
  return { point: local, scale: Math.min(scale[0], scale[1], scale[2]) };
}

function sdfPrimitive(point: THREE.Vector3, primitive: SdfPrimitive): number {
  const local = sdfLocalPoint(point, primitive);
  let distance: number;
  switch (primitive.type) {
    case 'sphere':
      distance = sdfSphere(local.point, typeof primitive.radius === 'number' ? primitive.radius : 0.5);
      break;
    case 'capsule':
      distance = sdfCapsule(local.point, typeof primitive.radius === 'number' ? primitive.radius : 0.25, primitive.height ?? 1);
      break;
    case 'box':
      distance = sdfBox(local.point, primitive.size ?? primitive.dimensions ?? [1, 1, 1]);
      break;
    case 'cone':
      distance = sdfCone(local.point, typeof primitive.radius === 'number' ? primitive.radius : 0.5, primitive.height ?? 1);
      break;
    case 'ellipsoid':
      distance = sdfEllipsoid(local.point, sdfRadii(primitive));
      break;
  }
  return distance * local.scale;
}

function sdfSample(descriptor: SdfDescriptor): SdfFunction {
  const nodes = new Map<string, SdfFunction>();
  for (const primitive of descriptor.primitives) nodes.set(primitive.id, (point) => sdfPrimitive(point, primitive));
  let result = descriptor.primitives.length > 0 ? nodes.get(descriptor.primitives[0].id) : undefined;
  for (let index = 0; index < (descriptor.operations?.length ?? 0); index += 1) {
    const operation = descriptor.operations?.[index];
    if (!operation) continue;
    const left = nodes.get(operation.left);
    const right = nodes.get(operation.right);
    if (!left || !right) continue;
    let combined: SdfFunction;
    switch (operation.type) {
      case 'smooth-union':
        combined = (point) => smin(left(point), right(point), operation.radius ?? 0.1);
        break;
      case 'subtract':
        combined = (point) => Math.max(left(point), -right(point));
        break;
      case 'intersect':
        combined = (point) => Math.max(left(point), right(point));
        break;
    }
    nodes.set(operation.id ?? operation.output ?? `operation-${index}`, combined);
    result = combined;
  }
  return result ?? (() => Infinity);
}

function polygonizeSdf(descriptor: SdfDescriptor): THREE.BufferGeometry {
  // SURFACE NETS, not a voxel shell.
  //
  // This used to emit one axis-aligned quad per exposed voxel face, which is a Minecraft surface:
  // every face is axis-aligned, every edge is a 90-degree step, and the result is stair-stepped at
  // exactly the scale of the sampling grid. For a subject whose whole identity is smooth blended
  // organic form -- which is the only kind of subject anyone reaches for an implicit surface to
  // build -- that is worse than the assembled primitives it was meant to replace.
  //
  // Naive surface nets places ONE vertex per sign-changing cell, at the average of the linearly
  // interpolated crossings on that cell's edges, and joins the four cells around each crossing
  // edge into a quad. It is compact, manifold, and smooth, and it is a natural fit for a field
  // that can be sampled anywhere rather than only at corners.
  //
  // Normals come from the field GRADIENT, not from face averaging: the gradient is the exact
  // surface normal of the implicit surface, so shading no longer carries the grid's imprint.
  const resolution = Math.max(4, Math.min(64, Math.floor(descriptor.resolution)));
  const defaultBounds: { readonly min: SdfVector; readonly max: SdfVector } = { min: [-2, -2, -2], max: [2, 2, 2] };
  const bounds = descriptor.bounds ?? defaultBounds;
  const min = new THREE.Vector3(bounds.min[0], bounds.min[1], bounds.min[2]);
  const step = new THREE.Vector3(
    (bounds.max[0] - bounds.min[0]) / resolution,
    (bounds.max[1] - bounds.min[1]) / resolution,
    (bounds.max[2] - bounds.min[2]) / resolution,
  );
  const sample = sdfSample(descriptor);
  const scratch = new THREE.Vector3();

  // Corner grid: one more corner than cells on each axis.
  const side = resolution + 1;
  const field = new Float32Array(side * side * side);
  const cornerAt = (x: number, y: number, z: number): number => (z * side + y) * side + x;
  for (let z = 0; z < side; z += 1) {
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        scratch.set(min.x + x * step.x, min.y + y * step.y, min.z + z * step.z);
        field[cornerAt(x, y, z)] = sample(scratch);
      }
    }
  }

  // The 12 cell edges as corner-offset pairs.
  const CUBE_EDGES: readonly (readonly [number, number, number, number, number, number])[] = [
    [0, 0, 0, 1, 0, 0], [1, 0, 0, 1, 1, 0], [0, 1, 0, 1, 1, 0], [0, 0, 0, 0, 1, 0],
    [0, 0, 1, 1, 0, 1], [1, 0, 1, 1, 1, 1], [0, 1, 1, 1, 1, 1], [0, 0, 1, 0, 1, 1],
    [0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 1], [1, 1, 0, 1, 1, 1], [0, 1, 0, 0, 1, 1],
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const cellVertex = new Int32Array(resolution * resolution * resolution).fill(-1);
  const cellAt = (x: number, y: number, z: number): number => (z * resolution + y) * resolution + x;

  // Central-difference gradient, stepped at a fraction of a cell so it follows the field rather
  // than the grid.
  const epsilon = Math.min(step.x, step.y, step.z) * 0.25;
  const gradient = (point: THREE.Vector3): THREE.Vector3 => {
    const gx = sample(scratch.set(point.x + epsilon, point.y, point.z))
      - sample(scratch.set(point.x - epsilon, point.y, point.z));
    const gy = sample(scratch.set(point.x, point.y + epsilon, point.z))
      - sample(scratch.set(point.x, point.y - epsilon, point.z));
    const gz = sample(scratch.set(point.x, point.y, point.z + epsilon))
      - sample(scratch.set(point.x, point.y, point.z - epsilon));
    const normal = new THREE.Vector3(gx, gy, gz);
    // A point where the field is flat has no defined normal; +Y is arbitrary but finite, and
    // leaving a zero vector would poison every lighting calculation downstream.
    return normal.lengthSq() < 1e-20 ? new THREE.Vector3(0, 1, 0) : normal.normalize();
  };

  for (let z = 0; z < resolution; z += 1) {
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        let crossings = 0;
        let sumX = 0;
        let sumY = 0;
        let sumZ = 0;
        for (const [ax, ay, az, bx, by, bz] of CUBE_EDGES) {
          const a = field[cornerAt(x + ax, y + ay, z + az)];
          const b = field[cornerAt(x + bx, y + by, z + bz)];
          if ((a <= 0) === (b <= 0)) continue;
          const t = a / (a - b);
          sumX += (ax + (bx - ax) * t);
          sumY += (ay + (by - ay) * t);
          sumZ += (az + (bz - az) * t);
          crossings += 1;
        }
        if (crossings === 0) continue;
        const px = min.x + (x + sumX / crossings) * step.x;
        const py = min.y + (y + sumY / crossings) * step.y;
        const pz = min.z + (z + sumZ / crossings) * step.z;
        cellVertex[cellAt(x, y, z)] = positions.length / 3;
        positions.push(px, py, pz);
        const normal = gradient(new THREE.Vector3(px, py, pz));
        normals.push(normal.x, normal.y, normal.z);
      }
    }
  }

  // One quad per sign-changing grid edge, joining the four cells that share it.
  //
  // Winding, worked out rather than guessed. For the +x edge from corner (x,y,z), the four cells
  // around it are (x, y-1, z-1), (x, y, z-1), (x, y, z), (x, y-1, z); in the (y,z) plane that
  // traversal is +y, +z, -y, whose cross product is +x. So when the corner is INSIDE and its
  // neighbour is outside, the unflipped order already faces out, and the flip belongs on the
  // opposite case. Getting this backwards is invisible in the normals -- those come from the
  // gradient and stay correct -- and shows only as back-face culling removing the front surface,
  // i.e. the model rendering as a hollow shell with its interior visible.
  const quad = (a: number, b: number, c: number, d: number, flip: boolean): void => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) indices.push(a, c, b, a, d, c);
    else indices.push(a, b, c, a, c, d);
  };
  // Each quad joins the FOUR cells sharing one grid edge, so every one of those cells must exist.
  // Bounding only the edge axis and the lower end of the other two let y/z reach `resolution`, which
  // is a corner index, not a cell index: `cellAt` then strides into an unrelated slot (with
  // resolution 8, `cellAt(3, 8, 1)` is 131 -- the slot for cell (3, 0, 2)) or past the end of the
  // array, where a typed-array read yields `undefined`. `undefined < 0` is false, so the guard in
  // `quad` passed it through to `setIndex`, which coerces it to 0. Measured on a sphere reaching its
  // own bounds at resolution 8: 60 out-of-range reads and 108 aliased reads. A surface that touches
  // the sampling box is therefore left OPEN at that face rather than closed with wrong triangles --
  // pad `bounds` past the surface to get a closed mesh.
  for (let z = 0; z < side; z += 1) {
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        const here = field[cornerAt(x, y, z)] <= 0;
        if (x + 1 < side && y > 0 && z > 0 && y < side - 1 && z < side - 1
          && here !== (field[cornerAt(x + 1, y, z)] <= 0)) {
          quad(
            cellVertex[cellAt(x, y - 1, z - 1)], cellVertex[cellAt(x, y, z - 1)],
            cellVertex[cellAt(x, y, z)], cellVertex[cellAt(x, y - 1, z)], !here,
          );
        }
        if (y + 1 < side && x > 0 && z > 0 && x < side - 1 && z < side - 1
          && here !== (field[cornerAt(x, y + 1, z)] <= 0)) {
          quad(
            cellVertex[cellAt(x - 1, y, z - 1)], cellVertex[cellAt(x - 1, y, z)],
            cellVertex[cellAt(x, y, z)], cellVertex[cellAt(x, y, z - 1)], !here,
          );
        }
        if (z + 1 < side && x > 0 && y > 0 && x < side - 1 && y < side - 1
          && here !== (field[cornerAt(x, y, z + 1)] <= 0)) {
          quad(
            cellVertex[cellAt(x - 1, y - 1, z)], cellVertex[cellAt(x, y - 1, z)],
            cellVertex[cellAt(x, y, z)], cellVertex[cellAt(x - 1, y, z)], !here,
          );
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

// THREE.CapsuleGeometry duplicates every UV-seam vertex (measured: 194 boundary
// edges on the default radius/segments below) -- same benign pattern as box/
// cylinder/sphere/torus, all of which weld cleanly to 0 given a CORRECT weld.
// (A naive vertex-only mergeVertices() reports 64 'non-manifold' edges here, but
// that is a counting artifact, not a real defect: it double-counts a handful of
// near-pole triangles that become degenerate once two of their three corners
// coincide -- confirmed by replicating subdivideCatmullClark's own degenerate-
// triangle-aware vertex identity, which finds a perfectly ordinary 2-manifold.)
// A capsule is the primary shape for skinned limbs/torso (PLAN_1.5), and skinning
// weight computation is O(vertices x bones), so fewer, guaranteed-simple vertices
// is worth having regardless -- authored as a deterministic, closed-by-
// construction mesh instead: shared pole vertices, and
// the radial index taken `% radialSegments` so the seam is never a duplicate
// vertex in the first place, rather than something to weld away afterward.
// Adapted from forge/stage5_rig/emit_rig.py's buildWatertightCapsule (verified
// there: 0 boundary edges, 0 non-manifold edges, deterministic across repeated
// runs) -- ported here rather than imported because this factory and the rig
// emitter are separate generated-output surfaces with no shared runtime module;
// see forge/tests/test_primitive_watertightness.py for the measured proof, and
// coordinate with the rig owner before changing either copy independently.
function buildWatertightCapsule(
  radius: number,
  cylLength: number,
  capSegments: number,
  radialSegments: number,
  heightSegments: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const halfCyl = cylLength / 2;
  const totalSpan = 2 * (Math.PI / 2 * radius) + Math.max(0, cylLength);
  const vOf = (fromBottom: number) => (totalSpan > 0 ? fromBottom / totalSpan : 0);

  const bottomPoleIndex = positions.length / 3;
  positions.push(0, -halfCyl - radius, 0);
  uvs.push(0.5, vOf(0));

  const ringStarts: number[] = [];
  const ringV: number[] = [];
  for (let ring = 1; ring <= capSegments; ring += 1) {
    const phi = (Math.PI / 2) * (ring / capSegments);
    const y = -halfCyl - radius * Math.cos(phi);
    const r = radius * Math.sin(phi);
    const start = positions.length / 3;
    ringStarts.push(start);
    ringV.push(vOf(radius * phi));
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const theta = (radial / radialSegments) * Math.PI * 2;
      positions.push(r * Math.cos(theta), y, r * Math.sin(theta));
      uvs.push(radial / radialSegments, vOf(radius * phi));
    }
  }

  const cylinderRingStarts: number[] = [];
  if (cylLength > 0) {
    for (let step = 1; step <= heightSegments; step += 1) {
      const y = -halfCyl + (cylLength * step) / heightSegments;
      const start = positions.length / 3;
      cylinderRingStarts.push(start);
      const v = vOf(radius * (Math.PI / 2) + halfCyl + y);
      for (let radial = 0; radial < radialSegments; radial += 1) {
        const theta = (radial / radialSegments) * Math.PI * 2;
        positions.push(radius * Math.cos(theta), y, radius * Math.sin(theta));
        uvs.push(radial / radialSegments, v);
      }
    }
  }

  const topRingStarts: number[] = [];
  for (let ring = capSegments - 1; ring >= 1; ring -= 1) {
    const phi = (Math.PI / 2) * (ring / capSegments);
    const y = halfCyl + radius * Math.cos(phi);
    const r = radius * Math.sin(phi);
    const start = positions.length / 3;
    topRingStarts.push(start);
    const v = vOf(radius * (Math.PI / 2) + Math.max(0, cylLength) + radius * (Math.PI / 2 - phi));
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const theta = (radial / radialSegments) * Math.PI * 2;
      positions.push(r * Math.cos(theta), y, r * Math.sin(theta));
      uvs.push(radial / radialSegments, v);
    }
  }

  const topPoleIndex = positions.length / 3;
  positions.push(0, halfCyl + radius, 0);
  uvs.push(0.5, vOf(totalSpan));

  const firstBottomRing = ringStarts[0];
  for (let radial = 0; radial < radialSegments; radial += 1) {
    const next = (radial + 1) % radialSegments;
    indices.push(bottomPoleIndex, firstBottomRing + radial, firstBottomRing + next);
  }

  const allRings = [...ringStarts, ...cylinderRingStarts, ...topRingStarts];
  for (let i = 0; i < allRings.length - 1; i += 1) {
    const a = allRings[i];
    const b = allRings[i + 1];
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const next = (radial + 1) % radialSegments;
      indices.push(a + radial, a + next, b + next);
      indices.push(a + radial, b + next, b + radial);
    }
  }

  const lastRing = allRings[allRings.length - 1];
  for (let radial = 0; radial < radialSegments; radial += 1) {
    const next = (radial + 1) % radialSegments;
    indices.push(topPoleIndex, lastRing + next, lastRing + radial);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  if (typeof url !== 'string' || !url.trim()) return null;
  const clean = url.trim();
  if (!/^data:image\//i.test(clean) && !/\.(?:png|jpe?g|webp|avif)(?:[?#].*)?$/i.test(clean)) return null;
  return clean;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Regret Warrior
// Sculpt build pass: structural-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createRegretWarriorModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "regret-warrior-reconstruction";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["hidden"] = createSculptMaterial(
    "hidden",
    {"id": "hidden", "name": "Hidden", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#000000", "color": "#000000", "opacity": {"base": 0.0}, "albedo": {"dominant": "rgba(0, 0, 0, 0)", "secondary": ["rgba(0, 0, 0, 0)"], "samplingNotes": "Generated DataTexture palette will be derived from the mapped embedded JPEG pixels."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.68, "variation": 0.12, "map": "code-native:hidden:roughness", "localResponse": "independent luminance/edge-derived channel; not aliased to albedo"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "sourceMaterialMapping": {"policy": "many-source-materials-to-semantic-code-material", "sourceMaterialCount": 92, "sourceMaterialIndices": [0, 13, 26, 39, 52, 65, 78, 91], "status": "hypothesis-requires-render-confirmation"}, "referencePbr": {"version": "1", "sourceImage": "embedded GLB JPEG inventory plus deterministic derived channels", "extractor": "extract_material_evidence.py", "method": "hash-linked texture decode and code-native resampling", "verdict": "usable for specification transfer; semantic grouping awaits render confirmation", "hardLimit": "promotional JPEG is not quantitative evidence", "usable": true, "confidence": 0.76, "estimatedFidelity": 0.78, "targetThreshold": 0.72, "maps": {"albedo": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/hidden/albedo.json", "channel": "albedo"}, "roughness": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/hidden/roughness.json", "channel": "roughness"}, "height": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/hidden/height.json", "channel": "height"}, "normal": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/hidden/normal.json", "channel": "normal"}, "ao": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/hidden/ao.json", "channel": "ao"}}}},
    options
  );
  materialMap["skin-material"] = createSculptMaterial(
    "skin-material",
    {"id": "skin-material", "name": "Skin Material", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#E1B092", "color": "#E1B092", "albedo": {"dominant": "rgba(225, 176, 146, 1)", "secondary": ["rgba(151, 96, 78, 1)"], "samplingNotes": "Generated DataTexture palette will be derived from the mapped embedded JPEG pixels."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.53, "variation": 0.12, "map": "code-native:skin-material:roughness", "localResponse": "independent luminance/edge-derived channel; not aliased to albedo"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "sourceMaterialMapping": {"policy": "many-source-materials-to-semantic-code-material", "sourceMaterialCount": 92, "sourceMaterialIndices": [1, 14, 27, 40, 53, 66, 79], "status": "hypothesis-requires-render-confirmation"}, "referencePbr": {"version": "1", "sourceImage": "embedded GLB JPEG inventory plus deterministic derived channels", "extractor": "extract_material_evidence.py", "method": "hash-linked texture decode and code-native resampling", "verdict": "usable for specification transfer; semantic grouping awaits render confirmation", "hardLimit": "promotional JPEG is not quantitative evidence", "usable": true, "confidence": 0.76, "estimatedFidelity": 0.78, "targetThreshold": 0.72, "maps": {"albedo": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/skin-material/albedo.json", "channel": "albedo"}, "roughness": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/skin-material/roughness.json", "channel": "roughness"}, "height": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/skin-material/height.json", "channel": "height"}, "normal": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/skin-material/normal.json", "channel": "normal"}, "ao": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/skin-material/ao.json", "channel": "ao"}}}},
    options
  );
  materialMap["hair-material"] = createSculptMaterial(
    "hair-material",
    {"id": "hair-material", "name": "Hair Material", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#F0C653", "color": "#F0C653", "albedo": {"dominant": "rgba(240, 198, 83, 1)", "secondary": ["rgba(117, 66, 32, 1)"], "samplingNotes": "Generated DataTexture palette will be derived from the mapped embedded JPEG pixels."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.68, "variation": 0.12, "map": "code-native:hair-material:roughness", "localResponse": "independent luminance/edge-derived channel; not aliased to albedo"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "hair-material.root-shadow", "color": "rgba(240, 198, 83, 1)", "roughness": 0.56, "notes": "Semantic local response; linked to detail inventory and verified by physical-ID render before acceptance."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "sourceMaterialMapping": {"policy": "many-source-materials-to-semantic-code-material", "sourceMaterialCount": 92, "sourceMaterialIndices": [2, 15, 28, 41, 54, 67, 80], "status": "hypothesis-requires-render-confirmation"}, "referencePbr": {"version": "1", "sourceImage": "embedded GLB JPEG inventory plus deterministic derived channels", "extractor": "extract_material_evidence.py", "method": "hash-linked texture decode and code-native resampling", "verdict": "usable for specification transfer; semantic grouping awaits render confirmation", "hardLimit": "promotional JPEG is not quantitative evidence", "usable": true, "confidence": 0.76, "estimatedFidelity": 0.78, "targetThreshold": 0.72, "maps": {"albedo": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/hair-material/albedo.json", "channel": "albedo"}, "roughness": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/hair-material/roughness.json", "channel": "roughness"}, "height": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/hair-material/height.json", "channel": "height"}, "normal": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/hair-material/normal.json", "channel": "normal"}, "ao": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/hair-material/ao.json", "channel": "ao"}}}},
    options
  );
  materialMap["eye-material"] = createSculptMaterial(
    "eye-material",
    {"id": "eye-material", "name": "Eye Material", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#D838AE", "color": "#D838AE", "albedo": {"dominant": "rgba(216, 56, 174, 1)", "secondary": ["rgba(38, 7, 31, 1)"], "samplingNotes": "Generated DataTexture palette will be derived from the mapped embedded JPEG pixels."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.28, "variation": 0.12, "map": "code-native:eye-material:roughness", "localResponse": "independent luminance/edge-derived channel; not aliased to albedo"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "eye-material.magenta-irises", "color": "rgba(216, 56, 174, 1)", "roughness": 0.16000000000000003, "notes": "Semantic local response; linked to detail inventory and verified by physical-ID render before acceptance."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "sourceMaterialMapping": {"policy": "many-source-materials-to-semantic-code-material", "sourceMaterialCount": 92, "sourceMaterialIndices": [3, 16, 29, 42, 55, 68, 81], "status": "hypothesis-requires-render-confirmation"}, "referencePbr": {"version": "1", "sourceImage": "embedded GLB JPEG inventory plus deterministic derived channels", "extractor": "extract_material_evidence.py", "method": "hash-linked texture decode and code-native resampling", "verdict": "usable for specification transfer; semantic grouping awaits render confirmation", "hardLimit": "promotional JPEG is not quantitative evidence", "usable": true, "confidence": 0.76, "estimatedFidelity": 0.78, "targetThreshold": 0.72, "maps": {"albedo": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/eye-material/albedo.json", "channel": "albedo"}, "roughness": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/eye-material/roughness.json", "channel": "roughness"}, "height": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/eye-material/height.json", "channel": "height"}, "normal": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/eye-material/normal.json", "channel": "normal"}, "ao": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/eye-material/ao.json", "channel": "ao"}}}},
    options
  );
  materialMap["dark-cloth-material"] = createSculptMaterial(
    "dark-cloth-material",
    {"id": "dark-cloth-material", "name": "Dark Cloth Material", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#201E26", "color": "#201E26", "albedo": {"dominant": "rgba(32, 30, 38, 1)", "secondary": ["rgba(10, 9, 13, 1)"], "samplingNotes": "Generated DataTexture palette will be derived from the mapped embedded JPEG pixels."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.68, "variation": 0.12, "map": "code-native:dark-cloth-material:roughness", "localResponse": "independent luminance/edge-derived channel; not aliased to albedo"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "sourceMaterialMapping": {"policy": "many-source-materials-to-semantic-code-material", "sourceMaterialCount": 92, "sourceMaterialIndices": [4, 17, 30, 43, 56, 69, 82], "status": "hypothesis-requires-render-confirmation"}, "referencePbr": {"version": "1", "sourceImage": "embedded GLB JPEG inventory plus deterministic derived channels", "extractor": "extract_material_evidence.py", "method": "hash-linked texture decode and code-native resampling", "verdict": "usable for specification transfer; semantic grouping awaits render confirmation", "hardLimit": "promotional JPEG is not quantitative evidence", "usable": true, "confidence": 0.76, "estimatedFidelity": 0.78, "targetThreshold": 0.72, "maps": {"albedo": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/dark-cloth-material/albedo.json", "channel": "albedo"}, "roughness": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/dark-cloth-material/roughness.json", "channel": "roughness"}, "height": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/dark-cloth-material/height.json", "channel": "height"}, "normal": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/dark-cloth-material/normal.json", "channel": "normal"}, "ao": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/dark-cloth-material/ao.json", "channel": "ao"}}}},
    options
  );
  materialMap["red-cloth-material"] = createSculptMaterial(
    "red-cloth-material",
    {"id": "red-cloth-material", "name": "Red Cloth Material", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#921C24", "color": "#921C24", "albedo": {"dominant": "rgba(146, 28, 36, 1)", "secondary": ["rgba(68, 12, 19, 1)"], "samplingNotes": "Generated DataTexture palette will be derived from the mapped embedded JPEG pixels."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.68, "variation": 0.12, "map": "code-native:red-cloth-material:roughness", "localResponse": "independent luminance/edge-derived channel; not aliased to albedo"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "sourceMaterialMapping": {"policy": "many-source-materials-to-semantic-code-material", "sourceMaterialCount": 92, "sourceMaterialIndices": [5, 18, 31, 44, 57, 70, 83], "status": "hypothesis-requires-render-confirmation"}, "referencePbr": {"version": "1", "sourceImage": "embedded GLB JPEG inventory plus deterministic derived channels", "extractor": "extract_material_evidence.py", "method": "hash-linked texture decode and code-native resampling", "verdict": "usable for specification transfer; semantic grouping awaits render confirmation", "hardLimit": "promotional JPEG is not quantitative evidence", "usable": true, "confidence": 0.76, "estimatedFidelity": 0.78, "targetThreshold": 0.72, "maps": {"albedo": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/red-cloth-material/albedo.json", "channel": "albedo"}, "roughness": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/red-cloth-material/roughness.json", "channel": "roughness"}, "height": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/red-cloth-material/height.json", "channel": "height"}, "normal": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/red-cloth-material/normal.json", "channel": "normal"}, "ao": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/red-cloth-material/ao.json", "channel": "ao"}}}},
    options
  );
  materialMap["blue-cloth-material"] = createSculptMaterial(
    "blue-cloth-material",
    {"id": "blue-cloth-material", "name": "Blue Cloth Material", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#36346F", "color": "#36346F", "albedo": {"dominant": "rgba(54, 52, 111, 1)", "secondary": ["rgba(23, 21, 58, 1)"], "samplingNotes": "Generated DataTexture palette will be derived from the mapped embedded JPEG pixels."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.68, "variation": 0.12, "map": "code-native:blue-cloth-material:roughness", "localResponse": "independent luminance/edge-derived channel; not aliased to albedo"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "sourceMaterialMapping": {"policy": "many-source-materials-to-semantic-code-material", "sourceMaterialCount": 92, "sourceMaterialIndices": [6, 19, 32, 45, 58, 71, 84], "status": "hypothesis-requires-render-confirmation"}, "referencePbr": {"version": "1", "sourceImage": "embedded GLB JPEG inventory plus deterministic derived channels", "extractor": "extract_material_evidence.py", "method": "hash-linked texture decode and code-native resampling", "verdict": "usable for specification transfer; semantic grouping awaits render confirmation", "hardLimit": "promotional JPEG is not quantitative evidence", "usable": true, "confidence": 0.76, "estimatedFidelity": 0.78, "targetThreshold": 0.72, "maps": {"albedo": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/blue-cloth-material/albedo.json", "channel": "albedo"}, "roughness": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/blue-cloth-material/roughness.json", "channel": "roughness"}, "height": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/blue-cloth-material/height.json", "channel": "height"}, "normal": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/blue-cloth-material/normal.json", "channel": "normal"}, "ao": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/blue-cloth-material/ao.json", "channel": "ao"}}}},
    options
  );
  materialMap["white-trim-material"] = createSculptMaterial(
    "white-trim-material",
    {"id": "white-trim-material", "name": "White Trim Material", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#DEDCCC", "color": "#DEDCCC", "albedo": {"dominant": "rgba(222, 220, 204, 1)", "secondary": ["rgba(139, 135, 125, 1)"], "samplingNotes": "Generated DataTexture palette will be derived from the mapped embedded JPEG pixels."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.68, "variation": 0.12, "map": "code-native:white-trim-material:roughness", "localResponse": "independent luminance/edge-derived channel; not aliased to albedo"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "sourceMaterialMapping": {"policy": "many-source-materials-to-semantic-code-material", "sourceMaterialCount": 92, "sourceMaterialIndices": [7, 20, 33, 46, 59, 72, 85], "status": "hypothesis-requires-render-confirmation"}, "referencePbr": {"version": "1", "sourceImage": "embedded GLB JPEG inventory plus deterministic derived channels", "extractor": "extract_material_evidence.py", "method": "hash-linked texture decode and code-native resampling", "verdict": "usable for specification transfer; semantic grouping awaits render confirmation", "hardLimit": "promotional JPEG is not quantitative evidence", "usable": true, "confidence": 0.76, "estimatedFidelity": 0.78, "targetThreshold": 0.72, "maps": {"albedo": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/white-trim-material/albedo.json", "channel": "albedo"}, "roughness": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/white-trim-material/roughness.json", "channel": "roughness"}, "height": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/white-trim-material/height.json", "channel": "height"}, "normal": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/white-trim-material/normal.json", "channel": "normal"}, "ao": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/white-trim-material/ao.json", "channel": "ao"}}}},
    options
  );
  materialMap["silver-metal-material"] = createSculptMaterial(
    "silver-metal-material",
    {"id": "silver-metal-material", "name": "Silver Metal Material", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#767C88", "color": "#767C88", "albedo": {"dominant": "rgba(118, 124, 136, 1)", "secondary": ["rgba(38, 42, 50, 1)"], "samplingNotes": "Generated DataTexture palette will be derived from the mapped embedded JPEG pixels."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.28, "variation": 0.12, "map": "code-native:silver-metal-material:roughness", "localResponse": "independent luminance/edge-derived channel; not aliased to albedo"}, "metalness": {"base": 0.82, "variation": 0.08}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "sourceMaterialMapping": {"policy": "many-source-materials-to-semantic-code-material", "sourceMaterialCount": 92, "sourceMaterialIndices": [8, 21, 34, 47, 60, 73, 86], "status": "hypothesis-requires-render-confirmation"}, "referencePbr": {"version": "1", "sourceImage": "embedded GLB JPEG inventory plus deterministic derived channels", "extractor": "extract_material_evidence.py", "method": "hash-linked texture decode and code-native resampling", "verdict": "usable for specification transfer; semantic grouping awaits render confirmation", "hardLimit": "promotional JPEG is not quantitative evidence", "usable": true, "confidence": 0.76, "estimatedFidelity": 0.78, "targetThreshold": 0.72, "maps": {"albedo": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/silver-metal-material/albedo.json", "channel": "albedo"}, "roughness": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/silver-metal-material/roughness.json", "channel": "roughness"}, "height": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/silver-metal-material/height.json", "channel": "height"}, "normal": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/silver-metal-material/normal.json", "channel": "normal"}, "ao": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/silver-metal-material/ao.json", "channel": "ao"}}}},
    options
  );
  materialMap["gold-metal-material"] = createSculptMaterial(
    "gold-metal-material",
    {"id": "gold-metal-material", "name": "Gold Metal Material", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#B87C27", "color": "#B87C27", "albedo": {"dominant": "rgba(184, 124, 39, 1)", "secondary": ["rgba(63, 37, 14, 1)"], "samplingNotes": "Generated DataTexture palette will be derived from the mapped embedded JPEG pixels."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.28, "variation": 0.12, "map": "code-native:gold-metal-material:roughness", "localResponse": "independent luminance/edge-derived channel; not aliased to albedo"}, "metalness": {"base": 0.82, "variation": 0.08}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "sourceMaterialMapping": {"policy": "many-source-materials-to-semantic-code-material", "sourceMaterialCount": 92, "sourceMaterialIndices": [9, 22, 35, 48, 61, 74, 87], "status": "hypothesis-requires-render-confirmation"}, "referencePbr": {"version": "1", "sourceImage": "embedded GLB JPEG inventory plus deterministic derived channels", "extractor": "extract_material_evidence.py", "method": "hash-linked texture decode and code-native resampling", "verdict": "usable for specification transfer; semantic grouping awaits render confirmation", "hardLimit": "promotional JPEG is not quantitative evidence", "usable": true, "confidence": 0.76, "estimatedFidelity": 0.78, "targetThreshold": 0.72, "maps": {"albedo": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/gold-metal-material/albedo.json", "channel": "albedo"}, "roughness": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/gold-metal-material/roughness.json", "channel": "roughness"}, "height": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/gold-metal-material/height.json", "channel": "height"}, "normal": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/gold-metal-material/normal.json", "channel": "normal"}, "ao": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/gold-metal-material/ao.json", "channel": "ao"}}}},
    options
  );
  materialMap["sword-blade-material"] = createSculptMaterial(
    "sword-blade-material",
    {"id": "sword-blade-material", "name": "Sword Blade Material", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#2B2A30", "color": "#2B2A30", "albedo": {"dominant": "rgba(43, 42, 48, 1)", "secondary": ["rgba(222, 111, 34, 1)"], "samplingNotes": "Generated DataTexture palette will be derived from the mapped embedded JPEG pixels."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.28, "variation": 0.12, "map": "code-native:sword-blade-material:roughness", "localResponse": "independent luminance/edge-derived channel; not aliased to albedo"}, "metalness": {"base": 0.82, "variation": 0.08}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "sword-blade-material.inscription", "color": "rgba(43, 42, 48, 1)", "roughness": 0.16000000000000003, "notes": "Semantic local response; linked to detail inventory and verified by physical-ID render before acceptance."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "sourceMaterialMapping": {"policy": "many-source-materials-to-semantic-code-material", "sourceMaterialCount": 92, "sourceMaterialIndices": [10, 23, 36, 49, 62, 75, 88], "status": "hypothesis-requires-render-confirmation"}, "referencePbr": {"version": "1", "sourceImage": "embedded GLB JPEG inventory plus deterministic derived channels", "extractor": "extract_material_evidence.py", "method": "hash-linked texture decode and code-native resampling", "verdict": "usable for specification transfer; semantic grouping awaits render confirmation", "hardLimit": "promotional JPEG is not quantitative evidence", "usable": true, "confidence": 0.76, "estimatedFidelity": 0.78, "targetThreshold": 0.72, "maps": {"albedo": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/sword-blade-material/albedo.json", "channel": "albedo"}, "roughness": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/sword-blade-material/roughness.json", "channel": "roughness"}, "height": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/sword-blade-material/height.json", "channel": "height"}, "normal": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/sword-blade-material/normal.json", "channel": "normal"}, "ao": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/sword-blade-material/ao.json", "channel": "ao"}}}},
    options
  );
  materialMap["skull-material"] = createSculptMaterial(
    "skull-material",
    {"id": "skull-material", "name": "Skull Material", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#C1B58D", "color": "#C1B58D", "albedo": {"dominant": "rgba(193, 181, 141, 1)", "secondary": ["rgba(72, 59, 43, 1)"], "samplingNotes": "Generated DataTexture palette will be derived from the mapped embedded JPEG pixels."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.68, "variation": 0.12, "map": "code-native:skull-material:roughness", "localResponse": "independent luminance/edge-derived channel; not aliased to albedo"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "skull-material.eye-emission", "color": "rgba(193, 181, 141, 1)", "roughness": 0.56, "notes": "Semantic local response; linked to detail inventory and verified by physical-ID render before acceptance."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "sourceMaterialMapping": {"policy": "many-source-materials-to-semantic-code-material", "sourceMaterialCount": 92, "sourceMaterialIndices": [11, 24, 37, 50, 63, 76, 89], "status": "hypothesis-requires-render-confirmation"}, "referencePbr": {"version": "1", "sourceImage": "embedded GLB JPEG inventory plus deterministic derived channels", "extractor": "extract_material_evidence.py", "method": "hash-linked texture decode and code-native resampling", "verdict": "usable for specification transfer; semantic grouping awaits render confirmation", "hardLimit": "promotional JPEG is not quantitative evidence", "usable": true, "confidence": 0.76, "estimatedFidelity": 0.78, "targetThreshold": 0.72, "maps": {"albedo": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/skull-material/albedo.json", "channel": "albedo"}, "roughness": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/skull-material/roughness.json", "channel": "roughness"}, "height": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/skull-material/height.json", "channel": "height"}, "normal": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/skull-material/normal.json", "channel": "normal"}, "ao": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/skull-material/ao.json", "channel": "ao"}}}},
    options
  );
  materialMap["sword-gem-material"] = createSculptMaterial(
    "sword-gem-material",
    {"id": "sword-gem-material", "name": "Sword Gem Material", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#37B566", "color": "#37B566", "albedo": {"dominant": "rgba(55, 181, 102, 1)", "secondary": ["rgba(11, 55, 30, 1)"], "samplingNotes": "Generated DataTexture palette will be derived from the mapped embedded JPEG pixels."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.28, "variation": 0.12, "map": "code-native:sword-gem-material:roughness", "localResponse": "independent luminance/edge-derived channel; not aliased to albedo"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "sword-gem-material.green-emission", "color": "rgba(55, 181, 102, 1)", "roughness": 0.16000000000000003, "notes": "Semantic local response; linked to detail inventory and verified by physical-ID render before acceptance."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "sourceMaterialMapping": {"policy": "many-source-materials-to-semantic-code-material", "sourceMaterialCount": 92, "sourceMaterialIndices": [12, 25, 38, 51, 64, 77, 90], "status": "hypothesis-requires-render-confirmation"}, "referencePbr": {"version": "1", "sourceImage": "embedded GLB JPEG inventory plus deterministic derived channels", "extractor": "extract_material_evidence.py", "method": "hash-linked texture decode and code-native resampling", "verdict": "usable for specification transfer; semantic grouping awaits render confirmation", "hardLimit": "promotional JPEG is not quantitative evidence", "usable": true, "confidence": 0.76, "estimatedFidelity": 0.78, "targetThreshold": 0.72, "maps": {"albedo": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/sword-gem-material/albedo.json", "channel": "albedo"}, "roughness": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/sword-gem-material/roughness.json", "channel": "roughness"}, "height": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/sword-gem-material/height.json", "channel": "height"}, "normal": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/sword-gem-material/normal.json", "channel": "normal"}, "ao": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/sword-gem-material/ao.json", "channel": "ao"}}}},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Character (root)__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Character (root)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.64, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Character (root) is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0.0, 0.0, 0.0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 0)", "secondaryAlbedo": "rgba(0, 0, 0, 0)", "materialClass": "unknown", "materialClassConfidence": 1.0, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Character (root)";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Character (root)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.64, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Character (root) is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0.0, 0.0, 0.0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 0)", "secondaryAlbedo": "rgba(0, 0, 0, 0)", "materialClass": "unknown", "materialClassConfidence": 1.0, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);

  const endpoint_pelvis_1 = makeAttachmentEndpoint(null);
  const node_pelvis_1 = new THREE.Group();
  node_pelvis_1.name = "Pelvis__pivot";
  node_pelvis_1.scale.set(1, 1, 1);
  if (endpoint_pelvis_1) {
    node_pelvis_1.position.copy(endpoint_pelvis_1.start);
    node_pelvis_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pelvis_1.position.set(0.0, -0.16099999999999995, 0.0);
    node_pelvis_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_pelvis_1.userData.sculptComponent = {"id": "pelvis", "name": "Pelvis", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.64, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Pelvis is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.38038, "height": 0.24024, "depth": 0.3003, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "dark-cloth-material", "materialLayers": ["dark-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 30, 38, 1)", "secondaryAlbedo": "rgba(10, 9, 13, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_pelvis_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["root"] ?? root).add(node_pelvis_1);
  nodes["pelvis"] = node_pelvis_1;
  const mesh_pelvis_1Geometry = endpoint_pelvis_1
    ? new THREE.CylinderGeometry(endpoint_pelvis_1.endRadius, endpoint_pelvis_1.baseRadius, endpoint_pelvis_1.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_pelvis_1) {
    mesh_pelvis_1Geometry.scale(0.38038, 0.24024, 0.3003);
  }
  const mesh_pelvis_1 = new THREE.Mesh(
    mesh_pelvis_1Geometry,
    materialMap["dark-cloth-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pelvis_1.name = "Pelvis";
  if (endpoint_pelvis_1) {
    mesh_pelvis_1.position.copy(endpoint_pelvis_1.midpoint);
    mesh_pelvis_1.quaternion.copy(endpoint_pelvis_1.quaternion);
  }
  mesh_pelvis_1.castShadow = options.castShadow ?? true;
  mesh_pelvis_1.receiveShadow = options.receiveShadow ?? true;
  mesh_pelvis_1.userData.sculptComponent = {"id": "pelvis", "name": "Pelvis", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.64, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Pelvis is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.38038, "height": 0.24024, "depth": 0.3003, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "dark-cloth-material", "materialLayers": ["dark-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 30, 38, 1)", "secondaryAlbedo": "rgba(10, 9, 13, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_pelvis_1.add(mesh_pelvis_1);
  meshes["pelvis"] = mesh_pelvis_1;
  colliders["pelvis"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pelvis"] ??= [];
  destructionGroups["pelvis"].push(node_pelvis_1);

  const attachment_abdomen_2 = {"parentSocket": "pelvis-waist", "localStart": [0.0, 0.028, 0.0], "localEnd": [0.0, 0.26908, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.16016, "endRadius": 0.18278, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_abdomen_2 = makeAttachmentEndpoint(attachment_abdomen_2);
  const node_abdomen_2 = new THREE.Group();
  node_abdomen_2.name = "Abdomen__pivot";
  node_abdomen_2.scale.set(1, 1, 1);
  if (endpoint_abdomen_2) {
    node_abdomen_2.position.copy(endpoint_abdomen_2.start);
    node_abdomen_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_abdomen_2.position.set(0.0, 0.027999999999999997, 0.0);
    node_abdomen_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_abdomen_2.userData.sculptComponent = {"id": "abdomen", "name": "Abdomen", "level": "macro", "role": "shell", "importance": 0.95, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Abdomen is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "pelvis", "attachment": {"parentSocket": "pelvis-waist", "localStart": [0.0, 0.028, 0.0], "localEnd": [0.0, 0.26908, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.16016, "endRadius": 0.18278, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.36036, "height": 0.24107999999999996, "depth": 0.32032000000000005, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, 0.027999999999999997, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.36036, 0.24107999999999996, 0.32032000000000005]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "abdomen", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shirt"}}, "material": "dark-cloth-material", "materialLayers": ["dark-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 30, 38, 1)", "secondaryAlbedo": "rgba(10, 9, 13, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_abdomen_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "abdomen", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shirt"}};
  (nodes["pelvis"] ?? root).add(node_abdomen_2);
  nodes["abdomen"] = node_abdomen_2;
  const mesh_abdomen_2Geometry = endpoint_abdomen_2
    ? new THREE.CylinderGeometry(endpoint_abdomen_2.endRadius, endpoint_abdomen_2.baseRadius, endpoint_abdomen_2.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_abdomen_2) {
    mesh_abdomen_2Geometry.scale(0.36036, 0.24107999999999996, 0.32032000000000005);
  }
  const mesh_abdomen_2 = new THREE.Mesh(
    mesh_abdomen_2Geometry,
    materialMap["dark-cloth-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_abdomen_2.name = "Abdomen";
  if (endpoint_abdomen_2) {
    mesh_abdomen_2.position.copy(endpoint_abdomen_2.midpoint);
    mesh_abdomen_2.quaternion.copy(endpoint_abdomen_2.quaternion);
  }
  mesh_abdomen_2.castShadow = options.castShadow ?? true;
  mesh_abdomen_2.receiveShadow = options.receiveShadow ?? true;
  mesh_abdomen_2.userData.sculptComponent = {"id": "abdomen", "name": "Abdomen", "level": "macro", "role": "shell", "importance": 0.95, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Abdomen is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "pelvis", "attachment": {"parentSocket": "pelvis-waist", "localStart": [0.0, 0.028, 0.0], "localEnd": [0.0, 0.26908, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.16016, "endRadius": 0.18278, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.36036, "height": 0.24107999999999996, "depth": 0.32032000000000005, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, 0.027999999999999997, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.36036, 0.24107999999999996, 0.32032000000000005]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "abdomen", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shirt"}}, "material": "dark-cloth-material", "materialLayers": ["dark-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 30, 38, 1)", "secondaryAlbedo": "rgba(10, 9, 13, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_abdomen_2.add(mesh_abdomen_2);
  meshes["abdomen"] = mesh_abdomen_2;
  colliders["abdomen"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["abdomen"] ??= [];
  destructionGroups["abdomen"].push(node_abdomen_2);

  const attachment_chest_3 = {"parentSocket": "abdomen-chest", "localStart": [0.0, 0.24108, 0.0028], "localEnd": [0.0, 0.574, 0.0056], "contactType": "rigid-weld", "baseRadius": 0.20429, "endRadius": 0.13978, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_chest_3 = makeAttachmentEndpoint(attachment_chest_3);
  const node_chest_3 = new THREE.Group();
  node_chest_3.name = "Chest__pivot";
  node_chest_3.scale.set(1, 1, 1);
  if (endpoint_chest_3) {
    node_chest_3.position.copy(endpoint_chest_3.start);
    node_chest_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_chest_3.position.set(0.0, 0.24107999999999996, 0.0028000000000000004);
    node_chest_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_chest_3.userData.sculptComponent = {"id": "chest", "name": "Chest", "level": "macro", "role": "shell", "importance": 1.0, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Chest is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "abdomen", "attachment": {"parentSocket": "abdomen-chest", "localStart": [0.0, 0.24108, 0.0028], "localEnd": [0.0, 0.574, 0.0056], "contactType": "rigid-weld", "baseRadius": 0.20429, "endRadius": 0.13978, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.5107200000000001, "height": 0.33292, "depth": 0.34034000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, 0.24107999999999996, 0.0028000000000000004], "rotation": [0.0, 0.0, 0.0], "scale": [0.5107200000000001, 0.33292, 0.34034000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chest", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shirt"}}, "material": "dark-cloth-material", "materialLayers": ["dark-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "pauldrons.chamfered-rims", "name": "pauldron-bevels", "kind": "bevel", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c1.png", "status": "specified-pending-render-confirmation"}, {"id": "sabatons.pointed-toes", "name": "sabatons-pointed-toes", "kind": "contour", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r2c1.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 30, 38, 1)", "secondaryAlbedo": "rgba(10, 9, 13, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_chest_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chest", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shirt"}};
  (nodes["abdomen"] ?? root).add(node_chest_3);
  nodes["chest"] = node_chest_3;
  const mesh_chest_3Geometry = endpoint_chest_3
    ? new THREE.CylinderGeometry(endpoint_chest_3.endRadius, endpoint_chest_3.baseRadius, endpoint_chest_3.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_chest_3) {
    mesh_chest_3Geometry.scale(0.5107200000000001, 0.33292, 0.34034000000000003);
  }
  const mesh_chest_3 = new THREE.Mesh(
    mesh_chest_3Geometry,
    materialMap["dark-cloth-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chest_3.name = "Chest";
  if (endpoint_chest_3) {
    mesh_chest_3.position.copy(endpoint_chest_3.midpoint);
    mesh_chest_3.quaternion.copy(endpoint_chest_3.quaternion);
  }
  mesh_chest_3.castShadow = options.castShadow ?? true;
  mesh_chest_3.receiveShadow = options.receiveShadow ?? true;
  mesh_chest_3.userData.sculptComponent = {"id": "chest", "name": "Chest", "level": "macro", "role": "shell", "importance": 1.0, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Chest is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "abdomen", "attachment": {"parentSocket": "abdomen-chest", "localStart": [0.0, 0.24108, 0.0028], "localEnd": [0.0, 0.574, 0.0056], "contactType": "rigid-weld", "baseRadius": 0.20429, "endRadius": 0.13978, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.5107200000000001, "height": 0.33292, "depth": 0.34034000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, 0.24107999999999996, 0.0028000000000000004], "rotation": [0.0, 0.0, 0.0], "scale": [0.5107200000000001, 0.33292, 0.34034000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chest", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shirt"}}, "material": "dark-cloth-material", "materialLayers": ["dark-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "pauldrons.chamfered-rims", "name": "pauldron-bevels", "kind": "bevel", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c1.png", "status": "specified-pending-render-confirmation"}, {"id": "sabatons.pointed-toes", "name": "sabatons-pointed-toes", "kind": "contour", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r2c1.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 30, 38, 1)", "secondaryAlbedo": "rgba(10, 9, 13, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_chest_3.add(mesh_chest_3);
  meshes["chest"] = mesh_chest_3;
  colliders["chest"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["chest"] ??= [];
  destructionGroups["chest"].push(node_chest_3);

  const attachment_neck_4 = {"parentSocket": "chest-neck-base", "localStart": [0.0, 0.31052, 0.0028], "localEnd": [0.0, 0.40292, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.0728, "endRadius": 0.056, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_neck_4 = makeAttachmentEndpoint(attachment_neck_4);
  const node_neck_4 = new THREE.Group();
  node_neck_4.name = "Neck__pivot";
  node_neck_4.scale.set(1, 1, 1);
  if (endpoint_neck_4) {
    node_neck_4.position.copy(endpoint_neck_4.start);
    node_neck_4.rotation.set(-0.06981317007977318, 0.13962634015954636, -0.03490658503988659);
  } else {
    node_neck_4.position.set(0.0, 0.31051999999999996, 0.0028000000000000004);
    node_neck_4.rotation.set(-0.06981317007977318, 0.13962634015954636, -0.03490658503988659);
  }
  node_neck_4.userData.sculptComponent = {"id": "neck", "name": "Neck", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.64, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Neck is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chest", "attachment": {"parentSocket": "chest-neck-base", "localStart": [0.0, 0.31052, 0.0028], "localEnd": [0.0, 0.40292, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.0728, "endRadius": 0.056, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.15400000000000003, "height": 0.09240000000000004, "depth": 0.15400000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, 0.31051999999999996, 0.0028000000000000004], "rotation": [-0.06981317007977318, 0.13962634015954636, -0.03490658503988659], "scale": [0.15400000000000003, 0.09240000000000004, 0.15400000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin-material", "materialLayers": ["skin-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(225, 176, 146, 1)", "secondaryAlbedo": "rgba(151, 96, 78, 1)", "materialClass": "skin", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_neck_4.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["chest"] ?? root).add(node_neck_4);
  nodes["neck"] = node_neck_4;
  const mesh_neck_4Geometry = endpoint_neck_4
    ? new THREE.CylinderGeometry(endpoint_neck_4.endRadius, endpoint_neck_4.baseRadius, endpoint_neck_4.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_neck_4) {
    mesh_neck_4Geometry.scale(0.15400000000000003, 0.09240000000000004, 0.15400000000000003);
  }
  const mesh_neck_4 = new THREE.Mesh(
    mesh_neck_4Geometry,
    materialMap["skin-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_neck_4.name = "Neck";
  if (endpoint_neck_4) {
    mesh_neck_4.position.copy(endpoint_neck_4.midpoint);
    mesh_neck_4.quaternion.copy(endpoint_neck_4.quaternion);
  }
  mesh_neck_4.castShadow = options.castShadow ?? true;
  mesh_neck_4.receiveShadow = options.receiveShadow ?? true;
  mesh_neck_4.userData.sculptComponent = {"id": "neck", "name": "Neck", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.64, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Neck is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chest", "attachment": {"parentSocket": "chest-neck-base", "localStart": [0.0, 0.31052, 0.0028], "localEnd": [0.0, 0.40292, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.0728, "endRadius": 0.056, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.15400000000000003, "height": 0.09240000000000004, "depth": 0.15400000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, 0.31051999999999996, 0.0028000000000000004], "rotation": [-0.06981317007977318, 0.13962634015954636, -0.03490658503988659], "scale": [0.15400000000000003, 0.09240000000000004, 0.15400000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin-material", "materialLayers": ["skin-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(225, 176, 146, 1)", "secondaryAlbedo": "rgba(151, 96, 78, 1)", "materialClass": "skin", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_neck_4.add(mesh_neck_4);
  meshes["neck"] = mesh_neck_4;
  colliders["neck"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_neck_4);

  const endpoint_head_5 = makeAttachmentEndpoint(null);
  const node_head_5 = new THREE.Group();
  node_head_5.name = "Head__pivot";
  node_head_5.scale.set(1, 1, 1);
  if (endpoint_head_5) {
    node_head_5.position.copy(endpoint_head_5.start);
    node_head_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_head_5.position.set(0.0, 0.2380000000000001, 0.0);
    node_head_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_head_5.userData.sculptComponent = {"id": "head", "name": "Head", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.64, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Head is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "neck", "attachment": null, "dimensions": {"width": 0.25760000000000005, "height": 0.31360000000000005, "depth": 0.27440000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, 0.2380000000000001, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.25760000000000005, 0.31360000000000005, 0.27440000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin-material", "materialLayers": ["skin-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "eye-material.magenta-irises", "name": "face-magenta-irises", "kind": "gloss", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r0c1.png", "status": "specified-pending-render-confirmation"}, {"id": "face.eye-rims", "name": "face-lid-lash-line", "kind": "linework", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r0c1.png", "status": "specified-pending-render-confirmation"}, {"id": "face.mouth-cavity", "name": "face-mouth-cavity", "kind": "hole", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r0c1.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(225, 176, 146, 1)", "secondaryAlbedo": "rgba(151, 96, 78, 1)", "materialClass": "skin", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_head_5.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["neck"] ?? root).add(node_head_5);
  nodes["head"] = node_head_5;
  const mesh_head_5Geometry = endpoint_head_5
    ? new THREE.CylinderGeometry(endpoint_head_5.endRadius, endpoint_head_5.baseRadius, endpoint_head_5.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_head_5) {
    mesh_head_5Geometry.scale(0.25760000000000005, 0.31360000000000005, 0.27440000000000003);
  }
  const mesh_head_5 = new THREE.Mesh(
    mesh_head_5Geometry,
    materialMap["skin-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_head_5.name = "Head";
  if (endpoint_head_5) {
    mesh_head_5.position.copy(endpoint_head_5.midpoint);
    mesh_head_5.quaternion.copy(endpoint_head_5.quaternion);
  }
  mesh_head_5.castShadow = options.castShadow ?? true;
  mesh_head_5.receiveShadow = options.receiveShadow ?? true;
  mesh_head_5.userData.sculptComponent = {"id": "head", "name": "Head", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.64, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Head is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "neck", "attachment": null, "dimensions": {"width": 0.25760000000000005, "height": 0.31360000000000005, "depth": 0.27440000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, 0.2380000000000001, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.25760000000000005, 0.31360000000000005, 0.27440000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin-material", "materialLayers": ["skin-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "eye-material.magenta-irises", "name": "face-magenta-irises", "kind": "gloss", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r0c1.png", "status": "specified-pending-render-confirmation"}, {"id": "face.eye-rims", "name": "face-lid-lash-line", "kind": "linework", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r0c1.png", "status": "specified-pending-render-confirmation"}, {"id": "face.mouth-cavity", "name": "face-mouth-cavity", "kind": "hole", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r0c1.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(225, 176, 146, 1)", "secondaryAlbedo": "rgba(151, 96, 78, 1)", "materialClass": "skin", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_head_5.add(mesh_head_5);
  meshes["head"] = mesh_head_5;
  colliders["head"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["head"] ??= [];
  destructionGroups["head"].push(node_head_5);

  const endpoint_hair_6 = makeAttachmentEndpoint(null);
  const node_hair_6 = new THREE.Group();
  node_hair_6.name = "Hair__pivot";
  node_hair_6.scale.set(1, 1, 1);
  if (endpoint_hair_6) {
    node_hair_6.position.copy(endpoint_hair_6.start);
    node_hair_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_hair_6.position.set(0.0, 0.084, -0.005600000000000001);
    node_hair_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_hair_6.userData.sculptComponent = {"id": "hair", "name": "Hair", "level": "meso", "role": "hair", "importance": 0.8, "confidence": 0.64, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "Continuous scalp shell with connected swept locks; no floating hair primitives.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": null, "dimensions": {"width": 0.28, "height": 0.21840000000000004, "depth": 0.2856, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.084, -0.005600000000000001], "rotation": [0.0, 0.0, 0.0], "scale": [0.28, 0.21840000000000004, 0.2856]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hair", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hair"}}, "material": "hair-material", "materialLayers": ["hair-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["short, neutral stylized hairstyle", {"id": "hair-crown.primary-locks", "name": "hair-primary-locks", "kind": "ridge", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r0c1.png", "status": "specified-pending-render-confirmation"}, {"id": "hair-crown.central-spike", "name": "hair-central-spike", "kind": "contour", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r0c1.png", "status": "specified-pending-render-confirmation"}, {"id": "hair-material.root-shadow", "name": "hair-root-shadow", "kind": "gloss", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r0c1.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(240, 198, 83, 1)", "secondaryAlbedo": "rgba(117, 66, 32, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}, "standProud": {"againstComponentId": "head", "clearance": 0.004, "maxPush": 0.012}};
  node_hair_6.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hair", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hair"}};
  (nodes["head"] ?? root).add(node_hair_6);
  nodes["hair"] = node_hair_6;
  const mesh_hair_6Geometry = endpoint_hair_6
    ? new THREE.CylinderGeometry(endpoint_hair_6.endRadius, endpoint_hair_6.baseRadius, endpoint_hair_6.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_hair_6) {
    mesh_hair_6Geometry.scale(0.28, 0.21840000000000004, 0.2856);
  }
  const mesh_hair_6 = new THREE.Mesh(
    mesh_hair_6Geometry,
    materialMap["hair-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hair_6.name = "Hair";
  if (endpoint_hair_6) {
    mesh_hair_6.position.copy(endpoint_hair_6.midpoint);
    mesh_hair_6.quaternion.copy(endpoint_hair_6.quaternion);
  }
  mesh_hair_6.castShadow = options.castShadow ?? true;
  mesh_hair_6.receiveShadow = options.receiveShadow ?? true;
  mesh_hair_6.userData.sculptComponent = {"id": "hair", "name": "Hair", "level": "meso", "role": "hair", "importance": 0.8, "confidence": 0.64, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "Continuous scalp shell with connected swept locks; no floating hair primitives.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": null, "dimensions": {"width": 0.28, "height": 0.21840000000000004, "depth": 0.2856, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.084, -0.005600000000000001], "rotation": [0.0, 0.0, 0.0], "scale": [0.28, 0.21840000000000004, 0.2856]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hair", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hair"}}, "material": "hair-material", "materialLayers": ["hair-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["short, neutral stylized hairstyle", {"id": "hair-crown.primary-locks", "name": "hair-primary-locks", "kind": "ridge", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r0c1.png", "status": "specified-pending-render-confirmation"}, {"id": "hair-crown.central-spike", "name": "hair-central-spike", "kind": "contour", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r0c1.png", "status": "specified-pending-render-confirmation"}, {"id": "hair-material.root-shadow", "name": "hair-root-shadow", "kind": "gloss", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r0c1.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(240, 198, 83, 1)", "secondaryAlbedo": "rgba(117, 66, 32, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}, "standProud": {"againstComponentId": "head", "clearance": 0.004, "maxPush": 0.012}};
  node_hair_6.add(mesh_hair_6);
  meshes["hair"] = mesh_hair_6;
  colliders["hair"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["hair"] ??= [];
  destructionGroups["hair"].push(node_hair_6);

  const endpoint_brow_l_7 = makeAttachmentEndpoint(null);
  const node_brow_l_7 = new THREE.Group();
  node_brow_l_7.name = "Eyebrow L__pivot";
  node_brow_l_7.scale.set(1, 1, 1);
  if (endpoint_brow_l_7) {
    node_brow_l_7.position.copy(endpoint_brow_l_7.start);
    node_brow_l_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_brow_l_7.position.set(0.05600000000000001, 0.033600000000000005, 0.12880000000000003);
    node_brow_l_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_brow_l_7.userData.sculptComponent = {"id": "brow-l", "name": "Eyebrow L", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.64, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Eyebrow L is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": null, "dimensions": {"width": 0.06160000000000001, "height": 0.011200000000000002, "depth": 0.016800000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.05600000000000001, 0.033600000000000005, 0.12880000000000003], "rotation": [0.0, 0.0, 0.0], "scale": [0.06160000000000001, 0.011200000000000002, 0.016800000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "brow-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hair"}}, "material": "hair-material", "materialLayers": ["hair-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(240, 198, 83, 1)", "secondaryAlbedo": "rgba(117, 66, 32, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_brow_l_7.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "brow-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hair"}};
  (nodes["head"] ?? root).add(node_brow_l_7);
  nodes["brow-l"] = node_brow_l_7;
  const mesh_brow_l_7Geometry = endpoint_brow_l_7
    ? new THREE.CylinderGeometry(endpoint_brow_l_7.endRadius, endpoint_brow_l_7.baseRadius, endpoint_brow_l_7.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_brow_l_7) {
    mesh_brow_l_7Geometry.scale(0.06160000000000001, 0.011200000000000002, 0.016800000000000002);
  }
  const mesh_brow_l_7 = new THREE.Mesh(
    mesh_brow_l_7Geometry,
    materialMap["hair-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_brow_l_7.name = "Eyebrow L";
  if (endpoint_brow_l_7) {
    mesh_brow_l_7.position.copy(endpoint_brow_l_7.midpoint);
    mesh_brow_l_7.quaternion.copy(endpoint_brow_l_7.quaternion);
  }
  mesh_brow_l_7.castShadow = options.castShadow ?? true;
  mesh_brow_l_7.receiveShadow = options.receiveShadow ?? true;
  mesh_brow_l_7.userData.sculptComponent = {"id": "brow-l", "name": "Eyebrow L", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.64, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Eyebrow L is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": null, "dimensions": {"width": 0.06160000000000001, "height": 0.011200000000000002, "depth": 0.016800000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.05600000000000001, 0.033600000000000005, 0.12880000000000003], "rotation": [0.0, 0.0, 0.0], "scale": [0.06160000000000001, 0.011200000000000002, 0.016800000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "brow-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hair"}}, "material": "hair-material", "materialLayers": ["hair-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(240, 198, 83, 1)", "secondaryAlbedo": "rgba(117, 66, 32, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_brow_l_7.add(mesh_brow_l_7);
  meshes["brow-l"] = mesh_brow_l_7;
  colliders["brow-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["brow-l"] ??= [];
  destructionGroups["brow-l"].push(node_brow_l_7);

  const endpoint_brow_r_8 = makeAttachmentEndpoint(null);
  const node_brow_r_8 = new THREE.Group();
  node_brow_r_8.name = "Eyebrow R__pivot";
  node_brow_r_8.scale.set(1, 1, 1);
  if (endpoint_brow_r_8) {
    node_brow_r_8.position.copy(endpoint_brow_r_8.start);
    node_brow_r_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_brow_r_8.position.set(-0.05600000000000001, 0.033600000000000005, 0.12880000000000003);
    node_brow_r_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_brow_r_8.userData.sculptComponent = {"id": "brow-r", "name": "Eyebrow R", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.64, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Eyebrow R is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": null, "dimensions": {"width": 0.06160000000000001, "height": 0.011200000000000002, "depth": 0.016800000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.05600000000000001, 0.033600000000000005, 0.12880000000000003], "rotation": [0.0, 0.0, 0.0], "scale": [0.06160000000000001, 0.011200000000000002, 0.016800000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "brow-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hair"}}, "material": "hair-material", "materialLayers": ["hair-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(240, 198, 83, 1)", "secondaryAlbedo": "rgba(117, 66, 32, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_brow_r_8.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "brow-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hair"}};
  (nodes["head"] ?? root).add(node_brow_r_8);
  nodes["brow-r"] = node_brow_r_8;
  const mesh_brow_r_8Geometry = endpoint_brow_r_8
    ? new THREE.CylinderGeometry(endpoint_brow_r_8.endRadius, endpoint_brow_r_8.baseRadius, endpoint_brow_r_8.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_brow_r_8) {
    mesh_brow_r_8Geometry.scale(0.06160000000000001, 0.011200000000000002, 0.016800000000000002);
  }
  const mesh_brow_r_8 = new THREE.Mesh(
    mesh_brow_r_8Geometry,
    materialMap["hair-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_brow_r_8.name = "Eyebrow R";
  if (endpoint_brow_r_8) {
    mesh_brow_r_8.position.copy(endpoint_brow_r_8.midpoint);
    mesh_brow_r_8.quaternion.copy(endpoint_brow_r_8.quaternion);
  }
  mesh_brow_r_8.castShadow = options.castShadow ?? true;
  mesh_brow_r_8.receiveShadow = options.receiveShadow ?? true;
  mesh_brow_r_8.userData.sculptComponent = {"id": "brow-r", "name": "Eyebrow R", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.64, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Eyebrow R is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": null, "dimensions": {"width": 0.06160000000000001, "height": 0.011200000000000002, "depth": 0.016800000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.05600000000000001, 0.033600000000000005, 0.12880000000000003], "rotation": [0.0, 0.0, 0.0], "scale": [0.06160000000000001, 0.011200000000000002, 0.016800000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "brow-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hair"}}, "material": "hair-material", "materialLayers": ["hair-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(240, 198, 83, 1)", "secondaryAlbedo": "rgba(117, 66, 32, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_brow_r_8.add(mesh_brow_r_8);
  meshes["brow-r"] = mesh_brow_r_8;
  colliders["brow-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["brow-r"] ??= [];
  destructionGroups["brow-r"].push(node_brow_r_8);

  const endpoint_ear_l_9 = makeAttachmentEndpoint(null);
  const node_ear_l_9 = new THREE.Group();
  node_ear_l_9.name = "Ear L__pivot";
  node_ear_l_9.scale.set(1, 1, 1);
  if (endpoint_ear_l_9) {
    node_ear_l_9.position.copy(endpoint_ear_l_9.start);
    node_ear_l_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_ear_l_9.position.set(0.12040000000000001, 0.005600000000000001, -0.005600000000000001);
    node_ear_l_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_ear_l_9.userData.sculptComponent = {"id": "ear-l", "name": "Ear L", "level": "micro", "role": "detail", "importance": 0.45, "confidence": 0.64, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Ear L is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": null, "dimensions": {"width": 0.0252, "height": 0.0728, "depth": 0.04760000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.12040000000000001, 0.005600000000000001, -0.005600000000000001], "rotation": [0.0, 0.0, 0.0], "scale": [0.0252, 0.0728, 0.04760000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin-material", "materialLayers": ["skin-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["outer helix reads as a flattened shell against the skull, not a disc"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(225, 176, 146, 1)", "secondaryAlbedo": "rgba(151, 96, 78, 1)", "materialClass": "skin", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_ear_l_9.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["head"] ?? root).add(node_ear_l_9);
  nodes["ear-l"] = node_ear_l_9;
  const mesh_ear_l_9Geometry = endpoint_ear_l_9
    ? new THREE.CylinderGeometry(endpoint_ear_l_9.endRadius, endpoint_ear_l_9.baseRadius, endpoint_ear_l_9.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_ear_l_9) {
    mesh_ear_l_9Geometry.scale(0.0252, 0.0728, 0.04760000000000001);
  }
  const mesh_ear_l_9 = new THREE.Mesh(
    mesh_ear_l_9Geometry,
    materialMap["skin-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ear_l_9.name = "Ear L";
  if (endpoint_ear_l_9) {
    mesh_ear_l_9.position.copy(endpoint_ear_l_9.midpoint);
    mesh_ear_l_9.quaternion.copy(endpoint_ear_l_9.quaternion);
  }
  mesh_ear_l_9.castShadow = options.castShadow ?? true;
  mesh_ear_l_9.receiveShadow = options.receiveShadow ?? true;
  mesh_ear_l_9.userData.sculptComponent = {"id": "ear-l", "name": "Ear L", "level": "micro", "role": "detail", "importance": 0.45, "confidence": 0.64, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Ear L is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": null, "dimensions": {"width": 0.0252, "height": 0.0728, "depth": 0.04760000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.12040000000000001, 0.005600000000000001, -0.005600000000000001], "rotation": [0.0, 0.0, 0.0], "scale": [0.0252, 0.0728, 0.04760000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin-material", "materialLayers": ["skin-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["outer helix reads as a flattened shell against the skull, not a disc"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(225, 176, 146, 1)", "secondaryAlbedo": "rgba(151, 96, 78, 1)", "materialClass": "skin", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_ear_l_9.add(mesh_ear_l_9);
  meshes["ear-l"] = mesh_ear_l_9;
  colliders["ear-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["ear-l"] ??= [];
  destructionGroups["ear-l"].push(node_ear_l_9);

  const endpoint_ear_r_10 = makeAttachmentEndpoint(null);
  const node_ear_r_10 = new THREE.Group();
  node_ear_r_10.name = "Ear R__pivot";
  node_ear_r_10.scale.set(1, 1, 1);
  if (endpoint_ear_r_10) {
    node_ear_r_10.position.copy(endpoint_ear_r_10.start);
    node_ear_r_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_ear_r_10.position.set(-0.12040000000000001, 0.005600000000000001, -0.005600000000000001);
    node_ear_r_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_ear_r_10.userData.sculptComponent = {"id": "ear-r", "name": "Ear R", "level": "micro", "role": "detail", "importance": 0.45, "confidence": 0.64, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Ear R is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": null, "dimensions": {"width": 0.0252, "height": 0.0728, "depth": 0.04760000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.12040000000000001, 0.005600000000000001, -0.005600000000000001], "rotation": [0.0, 0.0, 0.0], "scale": [0.0252, 0.0728, 0.04760000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin-material", "materialLayers": ["skin-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["outer helix reads as a flattened shell against the skull, not a disc"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(225, 176, 146, 1)", "secondaryAlbedo": "rgba(151, 96, 78, 1)", "materialClass": "skin", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_ear_r_10.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["head"] ?? root).add(node_ear_r_10);
  nodes["ear-r"] = node_ear_r_10;
  const mesh_ear_r_10Geometry = endpoint_ear_r_10
    ? new THREE.CylinderGeometry(endpoint_ear_r_10.endRadius, endpoint_ear_r_10.baseRadius, endpoint_ear_r_10.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_ear_r_10) {
    mesh_ear_r_10Geometry.scale(0.0252, 0.0728, 0.04760000000000001);
  }
  const mesh_ear_r_10 = new THREE.Mesh(
    mesh_ear_r_10Geometry,
    materialMap["skin-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ear_r_10.name = "Ear R";
  if (endpoint_ear_r_10) {
    mesh_ear_r_10.position.copy(endpoint_ear_r_10.midpoint);
    mesh_ear_r_10.quaternion.copy(endpoint_ear_r_10.quaternion);
  }
  mesh_ear_r_10.castShadow = options.castShadow ?? true;
  mesh_ear_r_10.receiveShadow = options.receiveShadow ?? true;
  mesh_ear_r_10.userData.sculptComponent = {"id": "ear-r", "name": "Ear R", "level": "micro", "role": "detail", "importance": 0.45, "confidence": 0.64, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Ear R is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": null, "dimensions": {"width": 0.0252, "height": 0.0728, "depth": 0.04760000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.12040000000000001, 0.005600000000000001, -0.005600000000000001], "rotation": [0.0, 0.0, 0.0], "scale": [0.0252, 0.0728, 0.04760000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin-material", "materialLayers": ["skin-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["outer helix reads as a flattened shell against the skull, not a disc"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(225, 176, 146, 1)", "secondaryAlbedo": "rgba(151, 96, 78, 1)", "materialClass": "skin", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_ear_r_10.add(mesh_ear_r_10);
  meshes["ear-r"] = mesh_ear_r_10;
  colliders["ear-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["ear-r"] ??= [];
  destructionGroups["ear-r"].push(node_ear_r_10);

  const endpoint_nose_11 = makeAttachmentEndpoint(null);
  const node_nose_11 = new THREE.Group();
  node_nose_11.name = "Nose__pivot";
  node_nose_11.scale.set(1, 1, 1);
  if (endpoint_nose_11) {
    node_nose_11.position.copy(endpoint_nose_11.start);
    node_nose_11.rotation.set(0.024434609527920613, 0.0, 0.0);
  } else {
    node_nose_11.position.set(0.0, -0.011200000000000002, 0.14);
    node_nose_11.rotation.set(0.024434609527920613, 0.0, 0.0);
  }
  node_nose_11.userData.sculptComponent = {"id": "nose", "name": "Nose", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.64, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Nose is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": null, "dimensions": {"width": 0.039200000000000006, "height": 0.07840000000000001, "depth": 0.0504, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, -0.011200000000000002, 0.14], "rotation": [0.024434609527920613, 0.0, 0.0], "scale": [0.039200000000000006, 0.07840000000000001, 0.0504]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nose", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin-material", "materialLayers": ["skin-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(225, 176, 146, 1)", "secondaryAlbedo": "rgba(151, 96, 78, 1)", "materialClass": "skin", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_nose_11.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nose", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["head"] ?? root).add(node_nose_11);
  nodes["nose"] = node_nose_11;
  const mesh_nose_11Geometry = endpoint_nose_11
    ? new THREE.CylinderGeometry(endpoint_nose_11.endRadius, endpoint_nose_11.baseRadius, endpoint_nose_11.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_nose_11) {
    mesh_nose_11Geometry.scale(0.039200000000000006, 0.07840000000000001, 0.0504);
  }
  const mesh_nose_11 = new THREE.Mesh(
    mesh_nose_11Geometry,
    materialMap["skin-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nose_11.name = "Nose";
  if (endpoint_nose_11) {
    mesh_nose_11.position.copy(endpoint_nose_11.midpoint);
    mesh_nose_11.quaternion.copy(endpoint_nose_11.quaternion);
  }
  mesh_nose_11.castShadow = options.castShadow ?? true;
  mesh_nose_11.receiveShadow = options.receiveShadow ?? true;
  mesh_nose_11.userData.sculptComponent = {"id": "nose", "name": "Nose", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.64, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Nose is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": null, "dimensions": {"width": 0.039200000000000006, "height": 0.07840000000000001, "depth": 0.0504, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, -0.011200000000000002, 0.14], "rotation": [0.024434609527920613, 0.0, 0.0], "scale": [0.039200000000000006, 0.07840000000000001, 0.0504]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nose", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin-material", "materialLayers": ["skin-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(225, 176, 146, 1)", "secondaryAlbedo": "rgba(151, 96, 78, 1)", "materialClass": "skin", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_nose_11.add(mesh_nose_11);
  meshes["nose"] = mesh_nose_11;
  colliders["nose"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["nose"] ??= [];
  destructionGroups["nose"].push(node_nose_11);

  const endpoint_mouth_12 = makeAttachmentEndpoint(null);
  const node_mouth_12 = new THREE.Group();
  node_mouth_12.name = "Mouth__pivot";
  node_mouth_12.scale.set(1, 1, 1);
  if (endpoint_mouth_12) {
    node_mouth_12.position.copy(endpoint_mouth_12.start);
    node_mouth_12.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_mouth_12.position.set(0.0, -0.09520000000000002, 0.12880000000000003);
    node_mouth_12.rotation.set(0.0, 0.0, 0.0);
  }
  node_mouth_12.userData.sculptComponent = {"id": "mouth", "name": "Mouth", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.64, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mouth is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": null, "dimensions": {"width": 0.06720000000000001, "height": 0.011200000000000002, "depth": 0.014000000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, -0.09520000000000002, 0.12880000000000003], "rotation": [0.0, 0.0, 0.0], "scale": [0.06720000000000001, 0.011200000000000002, 0.014000000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "lips"}}, "material": "skin-material", "materialLayers": ["skin-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(225, 176, 146, 1)", "secondaryAlbedo": "rgba(151, 96, 78, 1)", "materialClass": "skin", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_mouth_12.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "lips"}};
  (nodes["head"] ?? root).add(node_mouth_12);
  nodes["mouth"] = node_mouth_12;
  const mesh_mouth_12Geometry = endpoint_mouth_12
    ? new THREE.CylinderGeometry(endpoint_mouth_12.endRadius, endpoint_mouth_12.baseRadius, endpoint_mouth_12.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_mouth_12) {
    mesh_mouth_12Geometry.scale(0.06720000000000001, 0.011200000000000002, 0.014000000000000002);
  }
  const mesh_mouth_12 = new THREE.Mesh(
    mesh_mouth_12Geometry,
    materialMap["skin-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mouth_12.name = "Mouth";
  if (endpoint_mouth_12) {
    mesh_mouth_12.position.copy(endpoint_mouth_12.midpoint);
    mesh_mouth_12.quaternion.copy(endpoint_mouth_12.quaternion);
  }
  mesh_mouth_12.castShadow = options.castShadow ?? true;
  mesh_mouth_12.receiveShadow = options.receiveShadow ?? true;
  mesh_mouth_12.userData.sculptComponent = {"id": "mouth", "name": "Mouth", "level": "micro", "role": "detail", "importance": 0.4, "confidence": 0.64, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mouth is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": null, "dimensions": {"width": 0.06720000000000001, "height": 0.011200000000000002, "depth": 0.014000000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, -0.09520000000000002, 0.12880000000000003], "rotation": [0.0, 0.0, 0.0], "scale": [0.06720000000000001, 0.011200000000000002, 0.014000000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "lips"}}, "material": "skin-material", "materialLayers": ["skin-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(225, 176, 146, 1)", "secondaryAlbedo": "rgba(151, 96, 78, 1)", "materialClass": "skin", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_mouth_12.add(mesh_mouth_12);
  meshes["mouth"] = mesh_mouth_12;
  colliders["mouth"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["mouth"] ??= [];
  destructionGroups["mouth"].push(node_mouth_12);

  const endpoint_eye_l_13 = makeAttachmentEndpoint(null);
  const node_eye_l_13 = new THREE.Group();
  node_eye_l_13.name = "Eye L__pivot";
  node_eye_l_13.scale.set(1, 1, 1);
  if (endpoint_eye_l_13) {
    node_eye_l_13.position.copy(endpoint_eye_l_13.start);
    node_eye_l_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_eye_l_13.position.set(0.053200000000000004, 0.008400000000000001, 0.11200000000000002);
    node_eye_l_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_eye_l_13.userData.sculptComponent = {"id": "eye-l", "name": "Eye L", "level": "micro", "role": "detail", "importance": 0.5, "confidence": 0.64, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Eye L is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": null, "dimensions": {"width": 0.030800000000000004, "height": 0.030800000000000004, "depth": 0.030800000000000004, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.053200000000000004, 0.008400000000000001, 0.11200000000000002], "rotation": [0.0, 0.0, 0.0], "scale": [0.030800000000000004, 0.030800000000000004, 0.030800000000000004]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eye"}}, "material": "eye-material", "materialLayers": ["eye-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(216, 56, 174, 1)", "secondaryAlbedo": "rgba(38, 7, 31, 1)", "materialClass": "glass", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_eye_l_13.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eye"}};
  (nodes["head"] ?? root).add(node_eye_l_13);
  nodes["eye-l"] = node_eye_l_13;
  const mesh_eye_l_13Geometry = endpoint_eye_l_13
    ? new THREE.CylinderGeometry(endpoint_eye_l_13.endRadius, endpoint_eye_l_13.baseRadius, endpoint_eye_l_13.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_eye_l_13) {
    mesh_eye_l_13Geometry.scale(0.030800000000000004, 0.030800000000000004, 0.030800000000000004);
  }
  const mesh_eye_l_13 = new THREE.Mesh(
    mesh_eye_l_13Geometry,
    materialMap["eye-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eye_l_13.name = "Eye L";
  if (endpoint_eye_l_13) {
    mesh_eye_l_13.position.copy(endpoint_eye_l_13.midpoint);
    mesh_eye_l_13.quaternion.copy(endpoint_eye_l_13.quaternion);
  }
  mesh_eye_l_13.castShadow = options.castShadow ?? true;
  mesh_eye_l_13.receiveShadow = options.receiveShadow ?? true;
  mesh_eye_l_13.userData.sculptComponent = {"id": "eye-l", "name": "Eye L", "level": "micro", "role": "detail", "importance": 0.5, "confidence": 0.64, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Eye L is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": null, "dimensions": {"width": 0.030800000000000004, "height": 0.030800000000000004, "depth": 0.030800000000000004, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.053200000000000004, 0.008400000000000001, 0.11200000000000002], "rotation": [0.0, 0.0, 0.0], "scale": [0.030800000000000004, 0.030800000000000004, 0.030800000000000004]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eye"}}, "material": "eye-material", "materialLayers": ["eye-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(216, 56, 174, 1)", "secondaryAlbedo": "rgba(38, 7, 31, 1)", "materialClass": "glass", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_eye_l_13.add(mesh_eye_l_13);
  meshes["eye-l"] = mesh_eye_l_13;
  colliders["eye-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["eye-l"] ??= [];
  destructionGroups["eye-l"].push(node_eye_l_13);

  const endpoint_eye_cavity_l_14 = makeAttachmentEndpoint(null);
  const node_eye_cavity_l_14 = new THREE.Group();
  node_eye_cavity_l_14.name = "Eye cavity L__pivot";
  node_eye_cavity_l_14.scale.set(1, 1, 1);
  if (endpoint_eye_cavity_l_14) {
    node_eye_cavity_l_14.position.copy(endpoint_eye_cavity_l_14.start);
    node_eye_cavity_l_14.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_eye_cavity_l_14.position.set(0.053200000000000004, 0.008400000000000001, 0.12040000000000001);
    node_eye_cavity_l_14.rotation.set(0.0, 0.0, 0.0);
  }
  node_eye_cavity_l_14.userData.sculptComponent = {"id": "eye-cavity-l", "name": "Eye cavity L", "level": "micro", "role": "cavity", "importance": 0.4, "confidence": 0.64, "primitive": "sphere", "topologyClass": "implicit", "topologyRationale": "The eye reads as a recessed concave cavity carved out of the head volume with a boolean subtraction (US-004), not a flat decal or shaded patch.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "sdf": {"primitives": [{"id": "shell", "type": "sphere", "center": [0.0, 0.0, 0.0], "radius": 0.0252}, {"id": "carve", "type": "sphere", "center": [0.0, 0.0, 0.0154], "radius": 0.021}], "operations": [{"id": "socket", "type": "subtract", "left": "shell", "right": "carve"}], "bounds": {"min": [-0.0455, -0.0455, -0.0455], "max": [0.0455, 0.0455, 0.0455]}, "resolution": 24}}, "parent": "head", "attachment": null, "dimensions": {"width": 0.0504, "height": 0.0504, "depth": 0.0504, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.053200000000000004, 0.008400000000000001, 0.12040000000000001], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-cavity-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin-material", "materialLayers": ["skin-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(225, 176, 146, 1)", "secondaryAlbedo": "rgba(151, 96, 78, 1)", "materialClass": "skin", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_eye_cavity_l_14.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-cavity-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["head"] ?? root).add(node_eye_cavity_l_14);
  nodes["eye-cavity-l"] = node_eye_cavity_l_14;
  const mesh_eye_cavity_l_14Geometry = polygonizeSdf({"primitives": [{"id": "shell", "type": "sphere", "center": [0.0, 0.0, 0.0], "radius": 0.0252}, {"id": "carve", "type": "sphere", "center": [0.0, 0.0, 0.0154], "radius": 0.021}], "operations": [{"id": "socket", "type": "subtract", "left": "shell", "right": "carve"}], "bounds": {"min": [-0.0455, -0.0455, -0.0455], "max": [0.0455, 0.0455, 0.0455]}, "resolution": 24});
  if (!endpoint_eye_cavity_l_14) {
    mesh_eye_cavity_l_14Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_eye_cavity_l_14 = new THREE.Mesh(
    mesh_eye_cavity_l_14Geometry,
    createSculptMaterial("skin-material", {"id": "skin-material", "name": "Skin Material", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#E1B092", "color": "#E1B092", "albedo": {"dominant": "rgba(225, 176, 146, 1)", "secondary": ["rgba(151, 96, 78, 1)"], "samplingNotes": "Generated DataTexture palette will be derived from the mapped embedded JPEG pixels."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.53, "variation": 0.12, "map": "code-native:skin-material:roughness", "localResponse": "independent luminance/edge-derived channel; not aliased to albedo"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "sourceMaterialMapping": {"policy": "many-source-materials-to-semantic-code-material", "sourceMaterialCount": 92, "sourceMaterialIndices": [1, 14, 27, 40, 53, 66, 79], "status": "hypothesis-requires-render-confirmation"}, "referencePbr": {"version": "1", "sourceImage": "embedded GLB JPEG inventory plus deterministic derived channels", "extractor": "extract_material_evidence.py", "method": "hash-linked texture decode and code-native resampling", "verdict": "usable for specification transfer; semantic grouping awaits render confirmation", "hardLimit": "promotional JPEG is not quantitative evidence", "usable": true, "confidence": 0.76, "estimatedFidelity": 0.78, "targetThreshold": 0.72, "maps": {"albedo": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/skin-material/albedo.json", "channel": "albedo"}, "roughness": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/skin-material/roughness.json", "channel": "roughness"}, "height": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/skin-material/height.json", "channel": "height"}, "normal": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/skin-material/normal.json", "channel": "normal"}, "ao": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/skin-material/ao.json", "channel": "ao"}}}}, options, true)
  );
  mesh_eye_cavity_l_14.name = "Eye cavity L";
  if (endpoint_eye_cavity_l_14) {
    mesh_eye_cavity_l_14.position.copy(endpoint_eye_cavity_l_14.midpoint);
    mesh_eye_cavity_l_14.quaternion.copy(endpoint_eye_cavity_l_14.quaternion);
  }
  mesh_eye_cavity_l_14.castShadow = options.castShadow ?? true;
  mesh_eye_cavity_l_14.receiveShadow = options.receiveShadow ?? true;
  mesh_eye_cavity_l_14.userData.sculptComponent = {"id": "eye-cavity-l", "name": "Eye cavity L", "level": "micro", "role": "cavity", "importance": 0.4, "confidence": 0.64, "primitive": "sphere", "topologyClass": "implicit", "topologyRationale": "The eye reads as a recessed concave cavity carved out of the head volume with a boolean subtraction (US-004), not a flat decal or shaded patch.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "sdf": {"primitives": [{"id": "shell", "type": "sphere", "center": [0.0, 0.0, 0.0], "radius": 0.0252}, {"id": "carve", "type": "sphere", "center": [0.0, 0.0, 0.0154], "radius": 0.021}], "operations": [{"id": "socket", "type": "subtract", "left": "shell", "right": "carve"}], "bounds": {"min": [-0.0455, -0.0455, -0.0455], "max": [0.0455, 0.0455, 0.0455]}, "resolution": 24}}, "parent": "head", "attachment": null, "dimensions": {"width": 0.0504, "height": 0.0504, "depth": 0.0504, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.053200000000000004, 0.008400000000000001, 0.12040000000000001], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-cavity-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin-material", "materialLayers": ["skin-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(225, 176, 146, 1)", "secondaryAlbedo": "rgba(151, 96, 78, 1)", "materialClass": "skin", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_eye_cavity_l_14.add(mesh_eye_cavity_l_14);
  meshes["eye-cavity-l"] = mesh_eye_cavity_l_14;
  colliders["eye-cavity-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["eye-cavity-l"] ??= [];
  destructionGroups["eye-cavity-l"].push(node_eye_cavity_l_14);

  const endpoint_eye_r_15 = makeAttachmentEndpoint(null);
  const node_eye_r_15 = new THREE.Group();
  node_eye_r_15.name = "Eye R__pivot";
  node_eye_r_15.scale.set(1, 1, 1);
  if (endpoint_eye_r_15) {
    node_eye_r_15.position.copy(endpoint_eye_r_15.start);
    node_eye_r_15.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_eye_r_15.position.set(-0.053200000000000004, 0.008400000000000001, 0.11200000000000002);
    node_eye_r_15.rotation.set(0.0, 0.0, 0.0);
  }
  node_eye_r_15.userData.sculptComponent = {"id": "eye-r", "name": "Eye R", "level": "micro", "role": "detail", "importance": 0.5, "confidence": 0.64, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Eye R is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": null, "dimensions": {"width": 0.030800000000000004, "height": 0.030800000000000004, "depth": 0.030800000000000004, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.053200000000000004, 0.008400000000000001, 0.11200000000000002], "rotation": [0.0, 0.0, 0.0], "scale": [0.030800000000000004, 0.030800000000000004, 0.030800000000000004]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eye"}}, "material": "eye-material", "materialLayers": ["eye-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(216, 56, 174, 1)", "secondaryAlbedo": "rgba(38, 7, 31, 1)", "materialClass": "glass", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_eye_r_15.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eye"}};
  (nodes["head"] ?? root).add(node_eye_r_15);
  nodes["eye-r"] = node_eye_r_15;
  const mesh_eye_r_15Geometry = endpoint_eye_r_15
    ? new THREE.CylinderGeometry(endpoint_eye_r_15.endRadius, endpoint_eye_r_15.baseRadius, endpoint_eye_r_15.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_eye_r_15) {
    mesh_eye_r_15Geometry.scale(0.030800000000000004, 0.030800000000000004, 0.030800000000000004);
  }
  const mesh_eye_r_15 = new THREE.Mesh(
    mesh_eye_r_15Geometry,
    materialMap["eye-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eye_r_15.name = "Eye R";
  if (endpoint_eye_r_15) {
    mesh_eye_r_15.position.copy(endpoint_eye_r_15.midpoint);
    mesh_eye_r_15.quaternion.copy(endpoint_eye_r_15.quaternion);
  }
  mesh_eye_r_15.castShadow = options.castShadow ?? true;
  mesh_eye_r_15.receiveShadow = options.receiveShadow ?? true;
  mesh_eye_r_15.userData.sculptComponent = {"id": "eye-r", "name": "Eye R", "level": "micro", "role": "detail", "importance": 0.5, "confidence": 0.64, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Eye R is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": null, "dimensions": {"width": 0.030800000000000004, "height": 0.030800000000000004, "depth": 0.030800000000000004, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.053200000000000004, 0.008400000000000001, 0.11200000000000002], "rotation": [0.0, 0.0, 0.0], "scale": [0.030800000000000004, 0.030800000000000004, 0.030800000000000004]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eye"}}, "material": "eye-material", "materialLayers": ["eye-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(216, 56, 174, 1)", "secondaryAlbedo": "rgba(38, 7, 31, 1)", "materialClass": "glass", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_eye_r_15.add(mesh_eye_r_15);
  meshes["eye-r"] = mesh_eye_r_15;
  colliders["eye-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["eye-r"] ??= [];
  destructionGroups["eye-r"].push(node_eye_r_15);

  const endpoint_eye_cavity_r_16 = makeAttachmentEndpoint(null);
  const node_eye_cavity_r_16 = new THREE.Group();
  node_eye_cavity_r_16.name = "Eye cavity R__pivot";
  node_eye_cavity_r_16.scale.set(1, 1, 1);
  if (endpoint_eye_cavity_r_16) {
    node_eye_cavity_r_16.position.copy(endpoint_eye_cavity_r_16.start);
    node_eye_cavity_r_16.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_eye_cavity_r_16.position.set(-0.053200000000000004, 0.008400000000000001, 0.12040000000000001);
    node_eye_cavity_r_16.rotation.set(0.0, 0.0, 0.0);
  }
  node_eye_cavity_r_16.userData.sculptComponent = {"id": "eye-cavity-r", "name": "Eye cavity R", "level": "micro", "role": "cavity", "importance": 0.4, "confidence": 0.64, "primitive": "sphere", "topologyClass": "implicit", "topologyRationale": "The eye reads as a recessed concave cavity carved out of the head volume with a boolean subtraction (US-004), not a flat decal or shaded patch.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "sdf": {"primitives": [{"id": "shell", "type": "sphere", "center": [0.0, 0.0, 0.0], "radius": 0.0252}, {"id": "carve", "type": "sphere", "center": [0.0, 0.0, 0.0154], "radius": 0.021}], "operations": [{"id": "socket", "type": "subtract", "left": "shell", "right": "carve"}], "bounds": {"min": [-0.0455, -0.0455, -0.0455], "max": [0.0455, 0.0455, 0.0455]}, "resolution": 24}}, "parent": "head", "attachment": null, "dimensions": {"width": 0.0504, "height": 0.0504, "depth": 0.0504, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.053200000000000004, 0.008400000000000001, 0.12040000000000001], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-cavity-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin-material", "materialLayers": ["skin-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(225, 176, 146, 1)", "secondaryAlbedo": "rgba(151, 96, 78, 1)", "materialClass": "skin", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_eye_cavity_r_16.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-cavity-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["head"] ?? root).add(node_eye_cavity_r_16);
  nodes["eye-cavity-r"] = node_eye_cavity_r_16;
  const mesh_eye_cavity_r_16Geometry = polygonizeSdf({"primitives": [{"id": "shell", "type": "sphere", "center": [0.0, 0.0, 0.0], "radius": 0.0252}, {"id": "carve", "type": "sphere", "center": [0.0, 0.0, 0.0154], "radius": 0.021}], "operations": [{"id": "socket", "type": "subtract", "left": "shell", "right": "carve"}], "bounds": {"min": [-0.0455, -0.0455, -0.0455], "max": [0.0455, 0.0455, 0.0455]}, "resolution": 24});
  if (!endpoint_eye_cavity_r_16) {
    mesh_eye_cavity_r_16Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_eye_cavity_r_16 = new THREE.Mesh(
    mesh_eye_cavity_r_16Geometry,
    createSculptMaterial("skin-material", {"id": "skin-material", "name": "Skin Material", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#E1B092", "color": "#E1B092", "albedo": {"dominant": "rgba(225, 176, 146, 1)", "secondary": ["rgba(151, 96, 78, 1)"], "samplingNotes": "Generated DataTexture palette will be derived from the mapped embedded JPEG pixels."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.53, "variation": 0.12, "map": "code-native:skin-material:roughness", "localResponse": "independent luminance/edge-derived channel; not aliased to albedo"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "sourceMaterialMapping": {"policy": "many-source-materials-to-semantic-code-material", "sourceMaterialCount": 92, "sourceMaterialIndices": [1, 14, 27, 40, 53, 66, 79], "status": "hypothesis-requires-render-confirmation"}, "referencePbr": {"version": "1", "sourceImage": "embedded GLB JPEG inventory plus deterministic derived channels", "extractor": "extract_material_evidence.py", "method": "hash-linked texture decode and code-native resampling", "verdict": "usable for specification transfer; semantic grouping awaits render confirmation", "hardLimit": "promotional JPEG is not quantitative evidence", "usable": true, "confidence": 0.76, "estimatedFidelity": 0.78, "targetThreshold": 0.72, "maps": {"albedo": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/skin-material/albedo.json", "channel": "albedo"}, "roughness": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/skin-material/roughness.json", "channel": "roughness"}, "height": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/skin-material/height.json", "channel": "height"}, "normal": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/skin-material/normal.json", "channel": "normal"}, "ao": {"path": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/materials/skin-material/ao.json", "channel": "ao"}}}}, options, true)
  );
  mesh_eye_cavity_r_16.name = "Eye cavity R";
  if (endpoint_eye_cavity_r_16) {
    mesh_eye_cavity_r_16.position.copy(endpoint_eye_cavity_r_16.midpoint);
    mesh_eye_cavity_r_16.quaternion.copy(endpoint_eye_cavity_r_16.quaternion);
  }
  mesh_eye_cavity_r_16.castShadow = options.castShadow ?? true;
  mesh_eye_cavity_r_16.receiveShadow = options.receiveShadow ?? true;
  mesh_eye_cavity_r_16.userData.sculptComponent = {"id": "eye-cavity-r", "name": "Eye cavity R", "level": "micro", "role": "cavity", "importance": 0.4, "confidence": 0.64, "primitive": "sphere", "topologyClass": "implicit", "topologyRationale": "The eye reads as a recessed concave cavity carved out of the head volume with a boolean subtraction (US-004), not a flat decal or shaded patch.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "sdf": {"primitives": [{"id": "shell", "type": "sphere", "center": [0.0, 0.0, 0.0], "radius": 0.0252}, {"id": "carve", "type": "sphere", "center": [0.0, 0.0, 0.0154], "radius": 0.021}], "operations": [{"id": "socket", "type": "subtract", "left": "shell", "right": "carve"}], "bounds": {"min": [-0.0455, -0.0455, -0.0455], "max": [0.0455, 0.0455, 0.0455]}, "resolution": 24}}, "parent": "head", "attachment": null, "dimensions": {"width": 0.0504, "height": 0.0504, "depth": 0.0504, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.053200000000000004, 0.008400000000000001, 0.12040000000000001], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-cavity-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin-material", "materialLayers": ["skin-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(225, 176, 146, 1)", "secondaryAlbedo": "rgba(151, 96, 78, 1)", "materialClass": "skin", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_eye_cavity_r_16.add(mesh_eye_cavity_r_16);
  meshes["eye-cavity-r"] = mesh_eye_cavity_r_16;
  colliders["eye-cavity-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["eye-cavity-r"] ??= [];
  destructionGroups["eye-cavity-r"].push(node_eye_cavity_r_16);

  const attachment_clavicle_l_17 = {"parentSocket": "chest-clavicle-l", "localStart": [0.04301, 0.31612, 0.0056], "localEnd": [0.2688, 0.31052, 0.0112], "contactType": "rigid-weld", "baseRadius": 0.0308, "endRadius": 0.0476, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_clavicle_l_17 = makeAttachmentEndpoint(attachment_clavicle_l_17);
  const node_clavicle_l_17 = new THREE.Group();
  node_clavicle_l_17.name = "Clavicle L__pivot";
  node_clavicle_l_17.scale.set(1, 1, 1);
  if (endpoint_clavicle_l_17) {
    node_clavicle_l_17.position.copy(endpoint_clavicle_l_17.start);
    node_clavicle_l_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_clavicle_l_17.position.set(0.043008000000000005, 0.31611999999999996, 0.005600000000000001);
    node_clavicle_l_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_clavicle_l_17.userData.sculptComponent = {"id": "clavicle-l", "name": "Clavicle L", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Clavicle L is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chest", "attachment": {"parentSocket": "chest-clavicle-l", "localStart": [0.04301, 0.31612, 0.0056], "localEnd": [0.2688, 0.31052, 0.0112], "contactType": "rigid-weld", "baseRadius": 0.0308, "endRadius": 0.0476, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.22579200000000002, "height": 0.09520000000000002, "depth": 0.09520000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.043008000000000005, 0.31611999999999996, 0.005600000000000001], "rotation": [0.0, 0.0, 0.0], "scale": [0.22579200000000002, 0.09520000000000002, 0.09520000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "clavicle-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "dark-cloth-material", "materialLayers": ["dark-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 30, 38, 1)", "secondaryAlbedo": "rgba(10, 9, 13, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_clavicle_l_17.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "clavicle-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["chest"] ?? root).add(node_clavicle_l_17);
  nodes["clavicle-l"] = node_clavicle_l_17;
  const mesh_clavicle_l_17Geometry = endpoint_clavicle_l_17
    ? new THREE.CylinderGeometry(endpoint_clavicle_l_17.endRadius, endpoint_clavicle_l_17.baseRadius, endpoint_clavicle_l_17.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_clavicle_l_17) {
    mesh_clavicle_l_17Geometry.scale(0.22579200000000002, 0.09520000000000002, 0.09520000000000002);
  }
  const mesh_clavicle_l_17 = new THREE.Mesh(
    mesh_clavicle_l_17Geometry,
    materialMap["dark-cloth-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_clavicle_l_17.name = "Clavicle L";
  if (endpoint_clavicle_l_17) {
    mesh_clavicle_l_17.position.copy(endpoint_clavicle_l_17.midpoint);
    mesh_clavicle_l_17.quaternion.copy(endpoint_clavicle_l_17.quaternion);
  }
  mesh_clavicle_l_17.castShadow = options.castShadow ?? true;
  mesh_clavicle_l_17.receiveShadow = options.receiveShadow ?? true;
  mesh_clavicle_l_17.userData.sculptComponent = {"id": "clavicle-l", "name": "Clavicle L", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Clavicle L is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chest", "attachment": {"parentSocket": "chest-clavicle-l", "localStart": [0.04301, 0.31612, 0.0056], "localEnd": [0.2688, 0.31052, 0.0112], "contactType": "rigid-weld", "baseRadius": 0.0308, "endRadius": 0.0476, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.22579200000000002, "height": 0.09520000000000002, "depth": 0.09520000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.043008000000000005, 0.31611999999999996, 0.005600000000000001], "rotation": [0.0, 0.0, 0.0], "scale": [0.22579200000000002, 0.09520000000000002, 0.09520000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "clavicle-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "dark-cloth-material", "materialLayers": ["dark-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 30, 38, 1)", "secondaryAlbedo": "rgba(10, 9, 13, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_clavicle_l_17.add(mesh_clavicle_l_17);
  meshes["clavicle-l"] = mesh_clavicle_l_17;
  colliders["clavicle-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["clavicle-l"] ??= [];
  destructionGroups["clavicle-l"].push(node_clavicle_l_17);

  const attachment_upper_arm_l_18 = {"parentSocket": "clavicle-shoulder-l", "localStart": [0.22579, -0.0056, 0.0056], "localEnd": [0.28538, -0.29954, 0.0056], "contactType": "socket-joint", "baseRadius": 0.0448, "endRadius": 0.0364, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_upper_arm_l_18 = makeAttachmentEndpoint(attachment_upper_arm_l_18);
  const node_upper_arm_l_18 = new THREE.Group();
  node_upper_arm_l_18.name = "Upper arm L__pivot";
  node_upper_arm_l_18.scale.set(1, 1, 1);
  if (endpoint_upper_arm_l_18) {
    node_upper_arm_l_18.position.copy(endpoint_upper_arm_l_18.start);
    node_upper_arm_l_18.rotation.set(0.6283185307179586, -0.3141592653589793, -0.7330382858376184);
  } else {
    node_upper_arm_l_18.position.set(0.22579200000000005, -0.005599999999999994, 0.005600000000000001);
    node_upper_arm_l_18.rotation.set(0.6283185307179586, -0.3141592653589793, -0.7330382858376184);
  }
  node_upper_arm_l_18.userData.sculptComponent = {"id": "upper-arm-l", "name": "Upper arm L", "level": "meso", "role": "arm", "importance": 0.7, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Upper arm L is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "clavicle-l", "attachment": {"parentSocket": "clavicle-shoulder-l", "localStart": [0.22579, -0.0056, 0.0056], "localEnd": [0.28538, -0.29954, 0.0056], "contactType": "socket-joint", "baseRadius": 0.0448, "endRadius": 0.0364, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.08960000000000001, "height": 0.299915, "depth": 0.08960000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.22579200000000005, -0.005599999999999994, 0.005600000000000001], "rotation": [0.6283185307179586, -0.3141592653589793, -0.7330382858376184], "scale": [0.08960000000000001, 0.299915, 0.08960000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-arm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shirt"}}, "material": "dark-cloth-material", "materialLayers": ["dark-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 30, 38, 1)", "secondaryAlbedo": "rgba(10, 9, 13, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_upper_arm_l_18.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-arm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shirt"}};
  (nodes["clavicle-l"] ?? root).add(node_upper_arm_l_18);
  nodes["upper-arm-l"] = node_upper_arm_l_18;
  const mesh_upper_arm_l_18Geometry = endpoint_upper_arm_l_18
    ? new THREE.CylinderGeometry(endpoint_upper_arm_l_18.endRadius, endpoint_upper_arm_l_18.baseRadius, endpoint_upper_arm_l_18.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_upper_arm_l_18) {
    mesh_upper_arm_l_18Geometry.scale(0.08960000000000001, 0.299915, 0.08960000000000001);
  }
  const mesh_upper_arm_l_18 = new THREE.Mesh(
    mesh_upper_arm_l_18Geometry,
    materialMap["dark-cloth-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_upper_arm_l_18.name = "Upper arm L";
  if (endpoint_upper_arm_l_18) {
    mesh_upper_arm_l_18.position.copy(endpoint_upper_arm_l_18.midpoint);
    mesh_upper_arm_l_18.quaternion.copy(endpoint_upper_arm_l_18.quaternion);
  }
  mesh_upper_arm_l_18.castShadow = options.castShadow ?? true;
  mesh_upper_arm_l_18.receiveShadow = options.receiveShadow ?? true;
  mesh_upper_arm_l_18.userData.sculptComponent = {"id": "upper-arm-l", "name": "Upper arm L", "level": "meso", "role": "arm", "importance": 0.7, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Upper arm L is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "clavicle-l", "attachment": {"parentSocket": "clavicle-shoulder-l", "localStart": [0.22579, -0.0056, 0.0056], "localEnd": [0.28538, -0.29954, 0.0056], "contactType": "socket-joint", "baseRadius": 0.0448, "endRadius": 0.0364, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.08960000000000001, "height": 0.299915, "depth": 0.08960000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.22579200000000005, -0.005599999999999994, 0.005600000000000001], "rotation": [0.6283185307179586, -0.3141592653589793, -0.7330382858376184], "scale": [0.08960000000000001, 0.299915, 0.08960000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-arm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shirt"}}, "material": "dark-cloth-material", "materialLayers": ["dark-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 30, 38, 1)", "secondaryAlbedo": "rgba(10, 9, 13, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_upper_arm_l_18.add(mesh_upper_arm_l_18);
  meshes["upper-arm-l"] = mesh_upper_arm_l_18;
  colliders["upper-arm-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["upper-arm-l"] ??= [];
  destructionGroups["upper-arm-l"].push(node_upper_arm_l_18);

  const attachment_forearm_l_19 = {"parentSocket": "upper-arm-elbow-l", "localStart": [0.05958, -0.29394, 0.0], "localEnd": [0.08896, -0.53756, 0.0], "contactType": "hinge-joint", "baseRadius": 0.0336, "endRadius": 0.0252, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_forearm_l_19 = makeAttachmentEndpoint(attachment_forearm_l_19);
  const node_forearm_l_19 = new THREE.Group();
  node_forearm_l_19.name = "Forearm L__pivot";
  node_forearm_l_19.scale.set(1, 1, 1);
  if (endpoint_forearm_l_19) {
    node_forearm_l_19.position.copy(endpoint_forearm_l_19.start);
    node_forearm_l_19.rotation.set(1.361356816555577, 0.0, -0.13962634015954636);
  } else {
    node_forearm_l_19.position.set(0.05958391234540078, -0.293936667693256, 0.0);
    node_forearm_l_19.rotation.set(1.361356816555577, 0.0, -0.13962634015954636);
  }
  node_forearm_l_19.userData.sculptComponent = {"id": "forearm-l", "name": "Forearm L", "level": "meso", "role": "arm", "importance": 0.65, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Forearm L is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "upper-arm-l", "attachment": {"parentSocket": "upper-arm-elbow-l", "localStart": [0.05958, -0.29394, 0.0], "localEnd": [0.08896, -0.53756, 0.0], "contactType": "hinge-joint", "baseRadius": 0.0336, "endRadius": 0.0252, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.0728, "height": 0.24538499999999996, "depth": 0.0728, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.05958391234540078, -0.293936667693256, 0.0], "rotation": [1.361356816555577, 0.0, -0.13962634015954636], "scale": [0.0728, 0.24538499999999996, 0.0728]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "forearm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "dark-cloth-material", "materialLayers": ["dark-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 30, 38, 1)", "secondaryAlbedo": "rgba(10, 9, 13, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_forearm_l_19.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "forearm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["upper-arm-l"] ?? root).add(node_forearm_l_19);
  nodes["forearm-l"] = node_forearm_l_19;
  const mesh_forearm_l_19Geometry = endpoint_forearm_l_19
    ? new THREE.CylinderGeometry(endpoint_forearm_l_19.endRadius, endpoint_forearm_l_19.baseRadius, endpoint_forearm_l_19.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_forearm_l_19) {
    mesh_forearm_l_19Geometry.scale(0.0728, 0.24538499999999996, 0.0728);
  }
  const mesh_forearm_l_19 = new THREE.Mesh(
    mesh_forearm_l_19Geometry,
    materialMap["dark-cloth-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_forearm_l_19.name = "Forearm L";
  if (endpoint_forearm_l_19) {
    mesh_forearm_l_19.position.copy(endpoint_forearm_l_19.midpoint);
    mesh_forearm_l_19.quaternion.copy(endpoint_forearm_l_19.quaternion);
  }
  mesh_forearm_l_19.castShadow = options.castShadow ?? true;
  mesh_forearm_l_19.receiveShadow = options.receiveShadow ?? true;
  mesh_forearm_l_19.userData.sculptComponent = {"id": "forearm-l", "name": "Forearm L", "level": "meso", "role": "arm", "importance": 0.65, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Forearm L is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "upper-arm-l", "attachment": {"parentSocket": "upper-arm-elbow-l", "localStart": [0.05958, -0.29394, 0.0], "localEnd": [0.08896, -0.53756, 0.0], "contactType": "hinge-joint", "baseRadius": 0.0336, "endRadius": 0.0252, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.0728, "height": 0.24538499999999996, "depth": 0.0728, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.05958391234540078, -0.293936667693256, 0.0], "rotation": [1.361356816555577, 0.0, -0.13962634015954636], "scale": [0.0728, 0.24538499999999996, 0.0728]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "forearm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "dark-cloth-material", "materialLayers": ["dark-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 30, 38, 1)", "secondaryAlbedo": "rgba(10, 9, 13, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_forearm_l_19.add(mesh_forearm_l_19);
  meshes["forearm-l"] = mesh_forearm_l_19;
  colliders["forearm-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["forearm-l"] ??= [];
  destructionGroups["forearm-l"].push(node_forearm_l_19);

  const endpoint_hand_l_20 = makeAttachmentEndpoint(null);
  const node_hand_l_20 = new THREE.Group();
  node_hand_l_20.name = "Hand L__pivot";
  node_hand_l_20.scale.set(1, 1, 1);
  if (endpoint_hand_l_20) {
    node_hand_l_20.position.copy(endpoint_hand_l_20.start);
    node_hand_l_20.rotation.set(0.20943951023931956, -0.17453292519943295, -0.3490658503988659);
  } else {
    node_hand_l_20.position.set(0.03473868687213505, -0.28809817399525417, 0.0);
    node_hand_l_20.rotation.set(0.20943951023931956, -0.17453292519943295, -0.3490658503988659);
  }
  node_hand_l_20.userData.sculptComponent = {"id": "hand-l", "name": "Hand L", "level": "meso", "role": "hand", "importance": 0.55, "confidence": 0.64, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Hand L is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "forearm-l", "attachment": null, "dimensions": {"width": 0.06160000000000001, "height": 0.08960000000000001, "depth": 0.0364, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.03473868687213505, -0.28809817399525417, 0.0], "rotation": [0.20943951023931956, -0.17453292519943295, -0.3490658503988659], "scale": [0.06160000000000001, 0.08960000000000001, 0.0364]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hand-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "dark-cloth-material", "materialLayers": ["dark-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 30, 38, 1)", "secondaryAlbedo": "rgba(10, 9, 13, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_hand_l_20.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hand-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["forearm-l"] ?? root).add(node_hand_l_20);
  nodes["hand-l"] = node_hand_l_20;
  const mesh_hand_l_20Geometry = endpoint_hand_l_20
    ? new THREE.CylinderGeometry(endpoint_hand_l_20.endRadius, endpoint_hand_l_20.baseRadius, endpoint_hand_l_20.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_hand_l_20) {
    mesh_hand_l_20Geometry.scale(0.06160000000000001, 0.08960000000000001, 0.0364);
  }
  const mesh_hand_l_20 = new THREE.Mesh(
    mesh_hand_l_20Geometry,
    materialMap["dark-cloth-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hand_l_20.name = "Hand L";
  if (endpoint_hand_l_20) {
    mesh_hand_l_20.position.copy(endpoint_hand_l_20.midpoint);
    mesh_hand_l_20.quaternion.copy(endpoint_hand_l_20.quaternion);
  }
  mesh_hand_l_20.castShadow = options.castShadow ?? true;
  mesh_hand_l_20.receiveShadow = options.receiveShadow ?? true;
  mesh_hand_l_20.userData.sculptComponent = {"id": "hand-l", "name": "Hand L", "level": "meso", "role": "hand", "importance": 0.55, "confidence": 0.64, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Hand L is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "forearm-l", "attachment": null, "dimensions": {"width": 0.06160000000000001, "height": 0.08960000000000001, "depth": 0.0364, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.03473868687213505, -0.28809817399525417, 0.0], "rotation": [0.20943951023931956, -0.17453292519943295, -0.3490658503988659], "scale": [0.06160000000000001, 0.08960000000000001, 0.0364]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hand-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "dark-cloth-material", "materialLayers": ["dark-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 30, 38, 1)", "secondaryAlbedo": "rgba(10, 9, 13, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_hand_l_20.add(mesh_hand_l_20);
  meshes["hand-l"] = mesh_hand_l_20;
  colliders["hand-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["hand-l"] ??= [];
  destructionGroups["hand-l"].push(node_hand_l_20);

  const attachment_thumb_l_1_21 = {"parentSocket": "hand-l-thumb-1", "localStart": [-0.028, -0.00538, 0.0056], "localEnd": [-0.04312, -0.0184, 0.0119], "contactType": "rigid-weld", "baseRadius": 0.00896, "endRadius": 0.00735, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_thumb_l_1_21 = makeAttachmentEndpoint(attachment_thumb_l_1_21);
  const node_thumb_l_1_21 = new THREE.Group();
  node_thumb_l_1_21.name = "Thumb L phalanx 1__pivot";
  node_thumb_l_1_21.scale.set(1, 1, 1);
  if (endpoint_thumb_l_1_21) {
    node_thumb_l_1_21.position.copy(endpoint_thumb_l_1_21.start);
    node_thumb_l_1_21.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_thumb_l_1_21.position.set(-0.028000000000000025, -0.005375999999999992, 0.005600000000000001);
    node_thumb_l_1_21.rotation.set(0.0, 0.0, 0.0);
  }
  node_thumb_l_1_21.userData.sculptComponent = {"id": "thumb-l-1", "name": "Thumb L phalanx 1", "level": "micro", "role": "finger", "importance": 0.3, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Thumb L phalanx 1 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-l", "attachment": {"parentSocket": "hand-l-thumb-1", "localStart": [-0.028, -0.00538, 0.0056], "localEnd": [-0.04312, -0.0184, 0.0119], "contactType": "rigid-weld", "baseRadius": 0.00896, "endRadius": 0.00735, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.017920000000000002, "height": 0.021, "depth": 0.017920000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.028000000000000025, -0.005375999999999992, 0.005600000000000001], "rotation": [0.0, 0.0, 0.0], "scale": [0.017920000000000002, 0.021, 0.017920000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thumb-l-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_thumb_l_1_21.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thumb-l-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["hand-l"] ?? root).add(node_thumb_l_1_21);
  nodes["thumb-l-1"] = node_thumb_l_1_21;
  const mesh_thumb_l_1_21Geometry = endpoint_thumb_l_1_21
    ? new THREE.CylinderGeometry(endpoint_thumb_l_1_21.endRadius, endpoint_thumb_l_1_21.baseRadius, endpoint_thumb_l_1_21.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_thumb_l_1_21) {
    mesh_thumb_l_1_21Geometry.scale(0.017920000000000002, 0.021, 0.017920000000000002);
  }
  const mesh_thumb_l_1_21 = new THREE.Mesh(
    mesh_thumb_l_1_21Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_thumb_l_1_21.name = "Thumb L phalanx 1";
  if (endpoint_thumb_l_1_21) {
    mesh_thumb_l_1_21.position.copy(endpoint_thumb_l_1_21.midpoint);
    mesh_thumb_l_1_21.quaternion.copy(endpoint_thumb_l_1_21.quaternion);
  }
  mesh_thumb_l_1_21.castShadow = options.castShadow ?? true;
  mesh_thumb_l_1_21.receiveShadow = options.receiveShadow ?? true;
  mesh_thumb_l_1_21.userData.sculptComponent = {"id": "thumb-l-1", "name": "Thumb L phalanx 1", "level": "micro", "role": "finger", "importance": 0.3, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Thumb L phalanx 1 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-l", "attachment": {"parentSocket": "hand-l-thumb-1", "localStart": [-0.028, -0.00538, 0.0056], "localEnd": [-0.04312, -0.0184, 0.0119], "contactType": "rigid-weld", "baseRadius": 0.00896, "endRadius": 0.00735, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.017920000000000002, "height": 0.021, "depth": 0.017920000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.028000000000000025, -0.005375999999999992, 0.005600000000000001], "rotation": [0.0, 0.0, 0.0], "scale": [0.017920000000000002, 0.021, 0.017920000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thumb-l-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_thumb_l_1_21.add(mesh_thumb_l_1_21);
  meshes["thumb-l-1"] = mesh_thumb_l_1_21;
  colliders["thumb-l-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["thumb-l-1"] ??= [];
  destructionGroups["thumb-l-1"].push(node_thumb_l_1_21);

  const attachment_thumb_l_2_22 = {"parentSocket": "thumb-l-1-thumb-2", "localStart": [-0.01512, -0.01302, 0.0063], "localEnd": [-0.02621, -0.02257, 0.01092], "contactType": "hinge-joint", "baseRadius": 0.00896, "endRadius": 0.00735, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_thumb_l_2_22 = makeAttachmentEndpoint(attachment_thumb_l_2_22);
  const node_thumb_l_2_22 = new THREE.Group();
  node_thumb_l_2_22.name = "Thumb L phalanx 2__pivot";
  node_thumb_l_2_22.scale.set(1, 1, 1);
  if (endpoint_thumb_l_2_22) {
    node_thumb_l_2_22.position.copy(endpoint_thumb_l_2_22.start);
    node_thumb_l_2_22.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_thumb_l_2_22.position.set(-0.015120000000000022, -0.013020000000000004, 0.0063);
    node_thumb_l_2_22.rotation.set(0.0, 0.0, 0.0);
  }
  node_thumb_l_2_22.userData.sculptComponent = {"id": "thumb-l-2", "name": "Thumb L phalanx 2", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Thumb L phalanx 2 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "thumb-l-1", "attachment": {"parentSocket": "thumb-l-1-thumb-2", "localStart": [-0.01512, -0.01302, 0.0063], "localEnd": [-0.02621, -0.02257, 0.01092], "contactType": "hinge-joint", "baseRadius": 0.00896, "endRadius": 0.00735, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.017920000000000002, "height": 0.015400000000000002, "depth": 0.017920000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.015120000000000022, -0.013020000000000004, 0.0063], "rotation": [0.0, 0.0, 0.0], "scale": [0.017920000000000002, 0.015400000000000002, 0.017920000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thumb-l-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_thumb_l_2_22.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thumb-l-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["thumb-l-1"] ?? root).add(node_thumb_l_2_22);
  nodes["thumb-l-2"] = node_thumb_l_2_22;
  const mesh_thumb_l_2_22Geometry = endpoint_thumb_l_2_22
    ? new THREE.CylinderGeometry(endpoint_thumb_l_2_22.endRadius, endpoint_thumb_l_2_22.baseRadius, endpoint_thumb_l_2_22.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_thumb_l_2_22) {
    mesh_thumb_l_2_22Geometry.scale(0.017920000000000002, 0.015400000000000002, 0.017920000000000002);
  }
  const mesh_thumb_l_2_22 = new THREE.Mesh(
    mesh_thumb_l_2_22Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_thumb_l_2_22.name = "Thumb L phalanx 2";
  if (endpoint_thumb_l_2_22) {
    mesh_thumb_l_2_22.position.copy(endpoint_thumb_l_2_22.midpoint);
    mesh_thumb_l_2_22.quaternion.copy(endpoint_thumb_l_2_22.quaternion);
  }
  mesh_thumb_l_2_22.castShadow = options.castShadow ?? true;
  mesh_thumb_l_2_22.receiveShadow = options.receiveShadow ?? true;
  mesh_thumb_l_2_22.userData.sculptComponent = {"id": "thumb-l-2", "name": "Thumb L phalanx 2", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Thumb L phalanx 2 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "thumb-l-1", "attachment": {"parentSocket": "thumb-l-1-thumb-2", "localStart": [-0.01512, -0.01302, 0.0063], "localEnd": [-0.02621, -0.02257, 0.01092], "contactType": "hinge-joint", "baseRadius": 0.00896, "endRadius": 0.00735, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.017920000000000002, "height": 0.015400000000000002, "depth": 0.017920000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.015120000000000022, -0.013020000000000004, 0.0063], "rotation": [0.0, 0.0, 0.0], "scale": [0.017920000000000002, 0.015400000000000002, 0.017920000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thumb-l-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_thumb_l_2_22.add(mesh_thumb_l_2_22);
  meshes["thumb-l-2"] = mesh_thumb_l_2_22;
  colliders["thumb-l-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["thumb-l-2"] ??= [];
  destructionGroups["thumb-l-2"].push(node_thumb_l_2_22);

  const attachment_thumb_l_3_23 = {"parentSocket": "thumb-l-2-thumb-3", "localStart": [-0.01109, -0.00955, 0.00462], "localEnd": [-0.01915, -0.01649, 0.00798], "contactType": "hinge-joint", "baseRadius": 0.00896, "endRadius": 0.00735, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_thumb_l_3_23 = makeAttachmentEndpoint(attachment_thumb_l_3_23);
  const node_thumb_l_3_23 = new THREE.Group();
  node_thumb_l_3_23.name = "Thumb L phalanx 3__pivot";
  node_thumb_l_3_23.scale.set(1, 1, 1);
  if (endpoint_thumb_l_3_23) {
    node_thumb_l_3_23.position.copy(endpoint_thumb_l_3_23.start);
    node_thumb_l_3_23.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_thumb_l_3_23.position.set(-0.011087999999999987, -0.009548000000000001, 0.004620000000000003);
    node_thumb_l_3_23.rotation.set(0.0, 0.0, 0.0);
  }
  node_thumb_l_3_23.userData.sculptComponent = {"id": "thumb-l-3", "name": "Thumb L phalanx 3", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Thumb L phalanx 3 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "thumb-l-2", "attachment": {"parentSocket": "thumb-l-2-thumb-3", "localStart": [-0.01109, -0.00955, 0.00462], "localEnd": [-0.01915, -0.01649, 0.00798], "contactType": "hinge-joint", "baseRadius": 0.00896, "endRadius": 0.00735, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.017920000000000002, "height": 0.011200000000000002, "depth": 0.017920000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.011087999999999987, -0.009548000000000001, 0.004620000000000003], "rotation": [0.0, 0.0, 0.0], "scale": [0.017920000000000002, 0.011200000000000002, 0.017920000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thumb-l-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_thumb_l_3_23.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thumb-l-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["thumb-l-2"] ?? root).add(node_thumb_l_3_23);
  nodes["thumb-l-3"] = node_thumb_l_3_23;
  const mesh_thumb_l_3_23Geometry = endpoint_thumb_l_3_23
    ? new THREE.CylinderGeometry(endpoint_thumb_l_3_23.endRadius, endpoint_thumb_l_3_23.baseRadius, endpoint_thumb_l_3_23.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_thumb_l_3_23) {
    mesh_thumb_l_3_23Geometry.scale(0.017920000000000002, 0.011200000000000002, 0.017920000000000002);
  }
  const mesh_thumb_l_3_23 = new THREE.Mesh(
    mesh_thumb_l_3_23Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_thumb_l_3_23.name = "Thumb L phalanx 3";
  if (endpoint_thumb_l_3_23) {
    mesh_thumb_l_3_23.position.copy(endpoint_thumb_l_3_23.midpoint);
    mesh_thumb_l_3_23.quaternion.copy(endpoint_thumb_l_3_23.quaternion);
  }
  mesh_thumb_l_3_23.castShadow = options.castShadow ?? true;
  mesh_thumb_l_3_23.receiveShadow = options.receiveShadow ?? true;
  mesh_thumb_l_3_23.userData.sculptComponent = {"id": "thumb-l-3", "name": "Thumb L phalanx 3", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Thumb L phalanx 3 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "thumb-l-2", "attachment": {"parentSocket": "thumb-l-2-thumb-3", "localStart": [-0.01109, -0.00955, 0.00462], "localEnd": [-0.01915, -0.01649, 0.00798], "contactType": "hinge-joint", "baseRadius": 0.00896, "endRadius": 0.00735, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.017920000000000002, "height": 0.011200000000000002, "depth": 0.017920000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.011087999999999987, -0.009548000000000001, 0.004620000000000003], "rotation": [0.0, 0.0, 0.0], "scale": [0.017920000000000002, 0.011200000000000002, 0.017920000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thumb-l-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_thumb_l_3_23.add(mesh_thumb_l_3_23);
  meshes["thumb-l-3"] = mesh_thumb_l_3_23;
  colliders["thumb-l-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["thumb-l-3"] ??= [];
  destructionGroups["thumb-l-3"].push(node_thumb_l_3_23);

  const attachment_index_l_1_24 = {"parentSocket": "hand-l-index-1", "localStart": [-0.021, -0.03763, 0.0028], "localEnd": [-0.01748, -0.06682, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.00784, "endRadius": 0.00643, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_index_l_1_24 = makeAttachmentEndpoint(attachment_index_l_1_24);
  const node_index_l_1_24 = new THREE.Group();
  node_index_l_1_24.name = "Index L phalanx 1__pivot";
  node_index_l_1_24.scale.set(1, 1, 1);
  if (endpoint_index_l_1_24) {
    node_index_l_1_24.position.copy(endpoint_index_l_1_24.start);
    node_index_l_1_24.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_index_l_1_24.position.set(-0.02100000000000002, -0.037632, 0.0028000000000000004);
    node_index_l_1_24.rotation.set(0.0, 0.0, 0.0);
  }
  node_index_l_1_24.userData.sculptComponent = {"id": "index-l-1", "name": "Index L phalanx 1", "level": "micro", "role": "finger", "importance": 0.3, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Index L phalanx 1 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-l", "attachment": {"parentSocket": "hand-l-index-1", "localStart": [-0.021, -0.03763, 0.0028], "localEnd": [-0.01748, -0.06682, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.00784, "endRadius": 0.00643, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.015680000000000003, "height": 0.029400000000000003, "depth": 0.015680000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.02100000000000002, -0.037632, 0.0028000000000000004], "rotation": [0.0, 0.0, 0.0], "scale": [0.015680000000000003, 0.029400000000000003, 0.015680000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "index-l-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_index_l_1_24.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "index-l-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["hand-l"] ?? root).add(node_index_l_1_24);
  nodes["index-l-1"] = node_index_l_1_24;
  const mesh_index_l_1_24Geometry = endpoint_index_l_1_24
    ? new THREE.CylinderGeometry(endpoint_index_l_1_24.endRadius, endpoint_index_l_1_24.baseRadius, endpoint_index_l_1_24.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_index_l_1_24) {
    mesh_index_l_1_24Geometry.scale(0.015680000000000003, 0.029400000000000003, 0.015680000000000003);
  }
  const mesh_index_l_1_24 = new THREE.Mesh(
    mesh_index_l_1_24Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_index_l_1_24.name = "Index L phalanx 1";
  if (endpoint_index_l_1_24) {
    mesh_index_l_1_24.position.copy(endpoint_index_l_1_24.midpoint);
    mesh_index_l_1_24.quaternion.copy(endpoint_index_l_1_24.quaternion);
  }
  mesh_index_l_1_24.castShadow = options.castShadow ?? true;
  mesh_index_l_1_24.receiveShadow = options.receiveShadow ?? true;
  mesh_index_l_1_24.userData.sculptComponent = {"id": "index-l-1", "name": "Index L phalanx 1", "level": "micro", "role": "finger", "importance": 0.3, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Index L phalanx 1 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-l", "attachment": {"parentSocket": "hand-l-index-1", "localStart": [-0.021, -0.03763, 0.0028], "localEnd": [-0.01748, -0.06682, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.00784, "endRadius": 0.00643, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.015680000000000003, "height": 0.029400000000000003, "depth": 0.015680000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.02100000000000002, -0.037632, 0.0028000000000000004], "rotation": [0.0, 0.0, 0.0], "scale": [0.015680000000000003, 0.029400000000000003, 0.015680000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "index-l-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_index_l_1_24.add(mesh_index_l_1_24);
  meshes["index-l-1"] = mesh_index_l_1_24;
  colliders["index-l-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["index-l-1"] ??= [];
  destructionGroups["index-l-1"].push(node_index_l_1_24);

  const attachment_index_l_2_25 = {"parentSocket": "index-l-1-index-2", "localStart": [0.00352, -0.02919, 0.0], "localEnd": [0.00593, -0.0492, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00784, "endRadius": 0.00643, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_index_l_2_25 = makeAttachmentEndpoint(attachment_index_l_2_25);
  const node_index_l_2_25 = new THREE.Group();
  node_index_l_2_25.name = "Index L phalanx 2__pivot";
  node_index_l_2_25.scale.set(1, 1, 1);
  if (endpoint_index_l_2_25) {
    node_index_l_2_25.position.copy(endpoint_index_l_2_25.start);
    node_index_l_2_25.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_index_l_2_25.position.set(0.0035195388942942385, -0.029188573894103675, 0.0);
    node_index_l_2_25.rotation.set(0.0, 0.0, 0.0);
  }
  node_index_l_2_25.userData.sculptComponent = {"id": "index-l-2", "name": "Index L phalanx 2", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Index L phalanx 2 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "index-l-1", "attachment": {"parentSocket": "index-l-1-index-2", "localStart": [0.00352, -0.02919, 0.0], "localEnd": [0.00593, -0.0492, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00784, "endRadius": 0.00643, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.015680000000000003, "height": 0.02016, "depth": 0.015680000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0035195388942942385, -0.029188573894103675, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.015680000000000003, 0.02016, 0.015680000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "index-l-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_index_l_2_25.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "index-l-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["index-l-1"] ?? root).add(node_index_l_2_25);
  nodes["index-l-2"] = node_index_l_2_25;
  const mesh_index_l_2_25Geometry = endpoint_index_l_2_25
    ? new THREE.CylinderGeometry(endpoint_index_l_2_25.endRadius, endpoint_index_l_2_25.baseRadius, endpoint_index_l_2_25.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_index_l_2_25) {
    mesh_index_l_2_25Geometry.scale(0.015680000000000003, 0.02016, 0.015680000000000003);
  }
  const mesh_index_l_2_25 = new THREE.Mesh(
    mesh_index_l_2_25Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_index_l_2_25.name = "Index L phalanx 2";
  if (endpoint_index_l_2_25) {
    mesh_index_l_2_25.position.copy(endpoint_index_l_2_25.midpoint);
    mesh_index_l_2_25.quaternion.copy(endpoint_index_l_2_25.quaternion);
  }
  mesh_index_l_2_25.castShadow = options.castShadow ?? true;
  mesh_index_l_2_25.receiveShadow = options.receiveShadow ?? true;
  mesh_index_l_2_25.userData.sculptComponent = {"id": "index-l-2", "name": "Index L phalanx 2", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Index L phalanx 2 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "index-l-1", "attachment": {"parentSocket": "index-l-1-index-2", "localStart": [0.00352, -0.02919, 0.0], "localEnd": [0.00593, -0.0492, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00784, "endRadius": 0.00643, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.015680000000000003, "height": 0.02016, "depth": 0.015680000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0035195388942942385, -0.029188573894103675, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.015680000000000003, 0.02016, 0.015680000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "index-l-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_index_l_2_25.add(mesh_index_l_2_25);
  meshes["index-l-2"] = mesh_index_l_2_25;
  colliders["index-l-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["index-l-2"] ??= [];
  destructionGroups["index-l-2"].push(node_index_l_2_25);

  const attachment_index_l_3_26 = {"parentSocket": "index-l-2-index-3", "localStart": [0.00241, -0.02002, 0.0], "localEnd": [0.00402, -0.03336, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00784, "endRadius": 0.00643, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_index_l_3_26 = makeAttachmentEndpoint(attachment_index_l_3_26);
  const node_index_l_3_26 = new THREE.Group();
  node_index_l_3_26.name = "Index L phalanx 3__pivot";
  node_index_l_3_26.scale.set(1, 1, 1);
  if (endpoint_index_l_3_26) {
    node_index_l_3_26.position.copy(endpoint_index_l_3_26.start);
    node_index_l_3_26.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_index_l_3_26.position.set(0.0024133980989446413, -0.020015022098813923, 0.0);
    node_index_l_3_26.rotation.set(0.0, 0.0, 0.0);
  }
  node_index_l_3_26.userData.sculptComponent = {"id": "index-l-3", "name": "Index L phalanx 3", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Index L phalanx 3 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "index-l-2", "attachment": {"parentSocket": "index-l-2-index-3", "localStart": [0.00241, -0.02002, 0.0], "localEnd": [0.00402, -0.03336, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00784, "endRadius": 0.00643, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.015680000000000003, "height": 0.013440000000000002, "depth": 0.015680000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0024133980989446413, -0.020015022098813923, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.015680000000000003, 0.013440000000000002, 0.015680000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "index-l-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_index_l_3_26.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "index-l-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["index-l-2"] ?? root).add(node_index_l_3_26);
  nodes["index-l-3"] = node_index_l_3_26;
  const mesh_index_l_3_26Geometry = endpoint_index_l_3_26
    ? new THREE.CylinderGeometry(endpoint_index_l_3_26.endRadius, endpoint_index_l_3_26.baseRadius, endpoint_index_l_3_26.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_index_l_3_26) {
    mesh_index_l_3_26Geometry.scale(0.015680000000000003, 0.013440000000000002, 0.015680000000000003);
  }
  const mesh_index_l_3_26 = new THREE.Mesh(
    mesh_index_l_3_26Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_index_l_3_26.name = "Index L phalanx 3";
  if (endpoint_index_l_3_26) {
    mesh_index_l_3_26.position.copy(endpoint_index_l_3_26.midpoint);
    mesh_index_l_3_26.quaternion.copy(endpoint_index_l_3_26.quaternion);
  }
  mesh_index_l_3_26.castShadow = options.castShadow ?? true;
  mesh_index_l_3_26.receiveShadow = options.receiveShadow ?? true;
  mesh_index_l_3_26.userData.sculptComponent = {"id": "index-l-3", "name": "Index L phalanx 3", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Index L phalanx 3 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "index-l-2", "attachment": {"parentSocket": "index-l-2-index-3", "localStart": [0.00241, -0.02002, 0.0], "localEnd": [0.00402, -0.03336, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00784, "endRadius": 0.00643, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.015680000000000003, "height": 0.013440000000000002, "depth": 0.015680000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0024133980989446413, -0.020015022098813923, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.015680000000000003, 0.013440000000000002, 0.015680000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "index-l-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_index_l_3_26.add(mesh_index_l_3_26);
  meshes["index-l-3"] = mesh_index_l_3_26;
  colliders["index-l-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["index-l-3"] ??= [];
  destructionGroups["index-l-3"].push(node_index_l_3_26);

  const attachment_middle_l_1_27 = {"parentSocket": "hand-l-middle-1", "localStart": [-0.007, -0.03763, 0.0028], "localEnd": [-0.00315, -0.0696, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.00812, "endRadius": 0.00666, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_middle_l_1_27 = makeAttachmentEndpoint(attachment_middle_l_1_27);
  const node_middle_l_1_27 = new THREE.Group();
  node_middle_l_1_27.name = "Middle L phalanx 1__pivot";
  node_middle_l_1_27.scale.set(1, 1, 1);
  if (endpoint_middle_l_1_27) {
    node_middle_l_1_27.position.copy(endpoint_middle_l_1_27.start);
    node_middle_l_1_27.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_middle_l_1_27.position.set(-0.007000000000000006, -0.037632, 0.0028000000000000004);
    node_middle_l_1_27.rotation.set(0.0, 0.0, 0.0);
  }
  node_middle_l_1_27.userData.sculptComponent = {"id": "middle-l-1", "name": "Middle L phalanx 1", "level": "micro", "role": "finger", "importance": 0.3, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Middle L phalanx 1 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-l", "attachment": {"parentSocket": "hand-l-middle-1", "localStart": [-0.007, -0.03763, 0.0028], "localEnd": [-0.00315, -0.0696, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.00812, "endRadius": 0.00666, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.01624, "height": 0.032200000000000006, "depth": 0.01624, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.007000000000000006, -0.037632, 0.0028000000000000004], "rotation": [0.0, 0.0, 0.0], "scale": [0.01624, 0.032200000000000006, 0.01624]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "middle-l-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_middle_l_1_27.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "middle-l-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["hand-l"] ?? root).add(node_middle_l_1_27);
  nodes["middle-l-1"] = node_middle_l_1_27;
  const mesh_middle_l_1_27Geometry = endpoint_middle_l_1_27
    ? new THREE.CylinderGeometry(endpoint_middle_l_1_27.endRadius, endpoint_middle_l_1_27.baseRadius, endpoint_middle_l_1_27.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_middle_l_1_27) {
    mesh_middle_l_1_27Geometry.scale(0.01624, 0.032200000000000006, 0.01624);
  }
  const mesh_middle_l_1_27 = new THREE.Mesh(
    mesh_middle_l_1_27Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_middle_l_1_27.name = "Middle L phalanx 1";
  if (endpoint_middle_l_1_27) {
    mesh_middle_l_1_27.position.copy(endpoint_middle_l_1_27.midpoint);
    mesh_middle_l_1_27.quaternion.copy(endpoint_middle_l_1_27.quaternion);
  }
  mesh_middle_l_1_27.castShadow = options.castShadow ?? true;
  mesh_middle_l_1_27.receiveShadow = options.receiveShadow ?? true;
  mesh_middle_l_1_27.userData.sculptComponent = {"id": "middle-l-1", "name": "Middle L phalanx 1", "level": "micro", "role": "finger", "importance": 0.3, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Middle L phalanx 1 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-l", "attachment": {"parentSocket": "hand-l-middle-1", "localStart": [-0.007, -0.03763, 0.0028], "localEnd": [-0.00315, -0.0696, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.00812, "endRadius": 0.00666, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.01624, "height": 0.032200000000000006, "depth": 0.01624, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.007000000000000006, -0.037632, 0.0028000000000000004], "rotation": [0.0, 0.0, 0.0], "scale": [0.01624, 0.032200000000000006, 0.01624]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "middle-l-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_middle_l_1_27.add(mesh_middle_l_1_27);
  meshes["middle-l-1"] = mesh_middle_l_1_27;
  colliders["middle-l-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["middle-l-1"] ??= [];
  destructionGroups["middle-l-1"].push(node_middle_l_1_27);

  const attachment_middle_l_2_28 = {"parentSocket": "middle-l-1-middle-2", "localStart": [0.00385, -0.03197, 0.0], "localEnd": [0.00654, -0.05421, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00812, "endRadius": 0.00666, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_middle_l_2_28 = makeAttachmentEndpoint(attachment_middle_l_2_28);
  const node_middle_l_2_28 = new THREE.Group();
  node_middle_l_2_28.name = "Middle L phalanx 2__pivot";
  node_middle_l_2_28.scale.set(1, 1, 1);
  if (endpoint_middle_l_2_28) {
    node_middle_l_2_28.position.copy(endpoint_middle_l_2_28.start);
    node_middle_l_2_28.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_middle_l_2_28.position.set(0.003854733074703187, -0.03196843807449448, 0.0);
    node_middle_l_2_28.rotation.set(0.0, 0.0, 0.0);
  }
  node_middle_l_2_28.userData.sculptComponent = {"id": "middle-l-2", "name": "Middle L phalanx 2", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Middle L phalanx 2 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "middle-l-1", "attachment": {"parentSocket": "middle-l-1-middle-2", "localStart": [0.00385, -0.03197, 0.0], "localEnd": [0.00654, -0.05421, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00812, "endRadius": 0.00666, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.01624, "height": 0.022400000000000003, "depth": 0.01624, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.003854733074703187, -0.03196843807449448, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.01624, 0.022400000000000003, 0.01624]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "middle-l-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_middle_l_2_28.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "middle-l-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["middle-l-1"] ?? root).add(node_middle_l_2_28);
  nodes["middle-l-2"] = node_middle_l_2_28;
  const mesh_middle_l_2_28Geometry = endpoint_middle_l_2_28
    ? new THREE.CylinderGeometry(endpoint_middle_l_2_28.endRadius, endpoint_middle_l_2_28.baseRadius, endpoint_middle_l_2_28.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_middle_l_2_28) {
    mesh_middle_l_2_28Geometry.scale(0.01624, 0.022400000000000003, 0.01624);
  }
  const mesh_middle_l_2_28 = new THREE.Mesh(
    mesh_middle_l_2_28Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_middle_l_2_28.name = "Middle L phalanx 2";
  if (endpoint_middle_l_2_28) {
    mesh_middle_l_2_28.position.copy(endpoint_middle_l_2_28.midpoint);
    mesh_middle_l_2_28.quaternion.copy(endpoint_middle_l_2_28.quaternion);
  }
  mesh_middle_l_2_28.castShadow = options.castShadow ?? true;
  mesh_middle_l_2_28.receiveShadow = options.receiveShadow ?? true;
  mesh_middle_l_2_28.userData.sculptComponent = {"id": "middle-l-2", "name": "Middle L phalanx 2", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Middle L phalanx 2 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "middle-l-1", "attachment": {"parentSocket": "middle-l-1-middle-2", "localStart": [0.00385, -0.03197, 0.0], "localEnd": [0.00654, -0.05421, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00812, "endRadius": 0.00666, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.01624, "height": 0.022400000000000003, "depth": 0.01624, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.003854733074703187, -0.03196843807449448, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.01624, 0.022400000000000003, 0.01624]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "middle-l-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_middle_l_2_28.add(mesh_middle_l_2_28);
  meshes["middle-l-2"] = mesh_middle_l_2_28;
  colliders["middle-l-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["middle-l-2"] ??= [];
  destructionGroups["middle-l-2"].push(node_middle_l_2_28);

  const attachment_middle_l_3_29 = {"parentSocket": "middle-l-2-middle-3", "localStart": [0.00268, -0.02224, 0.0], "localEnd": [0.00436, -0.03614, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00812, "endRadius": 0.00666, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_middle_l_3_29 = makeAttachmentEndpoint(attachment_middle_l_3_29);
  const node_middle_l_3_29 = new THREE.Group();
  node_middle_l_3_29.name = "Middle L phalanx 3__pivot";
  node_middle_l_3_29.scale.set(1, 1, 1);
  if (endpoint_middle_l_3_29) {
    node_middle_l_3_29.position.copy(endpoint_middle_l_3_29.start);
    node_middle_l_3_29.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_middle_l_3_29.position.set(0.0026815534432718113, -0.022238913443126618, 0.0);
    node_middle_l_3_29.rotation.set(0.0, 0.0, 0.0);
  }
  node_middle_l_3_29.userData.sculptComponent = {"id": "middle-l-3", "name": "Middle L phalanx 3", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Middle L phalanx 3 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "middle-l-2", "attachment": {"parentSocket": "middle-l-2-middle-3", "localStart": [0.00268, -0.02224, 0.0], "localEnd": [0.00436, -0.03614, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00812, "endRadius": 0.00666, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.01624, "height": 0.014000000000000002, "depth": 0.01624, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0026815534432718113, -0.022238913443126618, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.01624, 0.014000000000000002, 0.01624]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "middle-l-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_middle_l_3_29.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "middle-l-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["middle-l-2"] ?? root).add(node_middle_l_3_29);
  nodes["middle-l-3"] = node_middle_l_3_29;
  const mesh_middle_l_3_29Geometry = endpoint_middle_l_3_29
    ? new THREE.CylinderGeometry(endpoint_middle_l_3_29.endRadius, endpoint_middle_l_3_29.baseRadius, endpoint_middle_l_3_29.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_middle_l_3_29) {
    mesh_middle_l_3_29Geometry.scale(0.01624, 0.014000000000000002, 0.01624);
  }
  const mesh_middle_l_3_29 = new THREE.Mesh(
    mesh_middle_l_3_29Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_middle_l_3_29.name = "Middle L phalanx 3";
  if (endpoint_middle_l_3_29) {
    mesh_middle_l_3_29.position.copy(endpoint_middle_l_3_29.midpoint);
    mesh_middle_l_3_29.quaternion.copy(endpoint_middle_l_3_29.quaternion);
  }
  mesh_middle_l_3_29.castShadow = options.castShadow ?? true;
  mesh_middle_l_3_29.receiveShadow = options.receiveShadow ?? true;
  mesh_middle_l_3_29.userData.sculptComponent = {"id": "middle-l-3", "name": "Middle L phalanx 3", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Middle L phalanx 3 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "middle-l-2", "attachment": {"parentSocket": "middle-l-2-middle-3", "localStart": [0.00268, -0.02224, 0.0], "localEnd": [0.00436, -0.03614, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00812, "endRadius": 0.00666, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.01624, "height": 0.014000000000000002, "depth": 0.01624, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0026815534432718113, -0.022238913443126618, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.01624, 0.014000000000000002, 0.01624]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "middle-l-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_middle_l_3_29.add(mesh_middle_l_3_29);
  meshes["middle-l-3"] = mesh_middle_l_3_29;
  colliders["middle-l-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["middle-l-3"] ??= [];
  destructionGroups["middle-l-3"].push(node_middle_l_3_29);

  const attachment_ring_l_1_30 = {"parentSocket": "hand-l-ring-1", "localStart": [0.007, -0.03763, 0.0028], "localEnd": [0.01052, -0.06682, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.00756, "endRadius": 0.0062, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_ring_l_1_30 = makeAttachmentEndpoint(attachment_ring_l_1_30);
  const node_ring_l_1_30 = new THREE.Group();
  node_ring_l_1_30.name = "Ring L phalanx 1__pivot";
  node_ring_l_1_30.scale.set(1, 1, 1);
  if (endpoint_ring_l_1_30) {
    node_ring_l_1_30.position.copy(endpoint_ring_l_1_30.start);
    node_ring_l_1_30.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_ring_l_1_30.position.set(0.007000000000000006, -0.037632, 0.0028000000000000004);
    node_ring_l_1_30.rotation.set(0.0, 0.0, 0.0);
  }
  node_ring_l_1_30.userData.sculptComponent = {"id": "ring-l-1", "name": "Ring L phalanx 1", "level": "micro", "role": "finger", "importance": 0.3, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Ring L phalanx 1 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-l", "attachment": {"parentSocket": "hand-l-ring-1", "localStart": [0.007, -0.03763, 0.0028], "localEnd": [0.01052, -0.06682, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.00756, "endRadius": 0.0062, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.015120000000000001, "height": 0.029400000000000003, "depth": 0.015120000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.007000000000000006, -0.037632, 0.0028000000000000004], "rotation": [0.0, 0.0, 0.0], "scale": [0.015120000000000001, 0.029400000000000003, 0.015120000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ring-l-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_ring_l_1_30.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ring-l-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["hand-l"] ?? root).add(node_ring_l_1_30);
  nodes["ring-l-1"] = node_ring_l_1_30;
  const mesh_ring_l_1_30Geometry = endpoint_ring_l_1_30
    ? new THREE.CylinderGeometry(endpoint_ring_l_1_30.endRadius, endpoint_ring_l_1_30.baseRadius, endpoint_ring_l_1_30.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_ring_l_1_30) {
    mesh_ring_l_1_30Geometry.scale(0.015120000000000001, 0.029400000000000003, 0.015120000000000001);
  }
  const mesh_ring_l_1_30 = new THREE.Mesh(
    mesh_ring_l_1_30Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ring_l_1_30.name = "Ring L phalanx 1";
  if (endpoint_ring_l_1_30) {
    mesh_ring_l_1_30.position.copy(endpoint_ring_l_1_30.midpoint);
    mesh_ring_l_1_30.quaternion.copy(endpoint_ring_l_1_30.quaternion);
  }
  mesh_ring_l_1_30.castShadow = options.castShadow ?? true;
  mesh_ring_l_1_30.receiveShadow = options.receiveShadow ?? true;
  mesh_ring_l_1_30.userData.sculptComponent = {"id": "ring-l-1", "name": "Ring L phalanx 1", "level": "micro", "role": "finger", "importance": 0.3, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Ring L phalanx 1 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-l", "attachment": {"parentSocket": "hand-l-ring-1", "localStart": [0.007, -0.03763, 0.0028], "localEnd": [0.01052, -0.06682, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.00756, "endRadius": 0.0062, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.015120000000000001, "height": 0.029400000000000003, "depth": 0.015120000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.007000000000000006, -0.037632, 0.0028000000000000004], "rotation": [0.0, 0.0, 0.0], "scale": [0.015120000000000001, 0.029400000000000003, 0.015120000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ring-l-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_ring_l_1_30.add(mesh_ring_l_1_30);
  meshes["ring-l-1"] = mesh_ring_l_1_30;
  colliders["ring-l-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["ring-l-1"] ??= [];
  destructionGroups["ring-l-1"].push(node_ring_l_1_30);

  const attachment_ring_l_2_31 = {"parentSocket": "ring-l-1-ring-2", "localStart": [0.00352, -0.02919, 0.0], "localEnd": [0.00593, -0.0492, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00756, "endRadius": 0.0062, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_ring_l_2_31 = makeAttachmentEndpoint(attachment_ring_l_2_31);
  const node_ring_l_2_31 = new THREE.Group();
  node_ring_l_2_31.name = "Ring L phalanx 2__pivot";
  node_ring_l_2_31.scale.set(1, 1, 1);
  if (endpoint_ring_l_2_31) {
    node_ring_l_2_31.position.copy(endpoint_ring_l_2_31.start);
    node_ring_l_2_31.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_ring_l_2_31.position.set(0.0035195388942942385, -0.029188573894103675, 0.0);
    node_ring_l_2_31.rotation.set(0.0, 0.0, 0.0);
  }
  node_ring_l_2_31.userData.sculptComponent = {"id": "ring-l-2", "name": "Ring L phalanx 2", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Ring L phalanx 2 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "ring-l-1", "attachment": {"parentSocket": "ring-l-1-ring-2", "localStart": [0.00352, -0.02919, 0.0], "localEnd": [0.00593, -0.0492, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00756, "endRadius": 0.0062, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.015120000000000001, "height": 0.02016, "depth": 0.015120000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0035195388942942385, -0.029188573894103675, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.015120000000000001, 0.02016, 0.015120000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ring-l-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_ring_l_2_31.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ring-l-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["ring-l-1"] ?? root).add(node_ring_l_2_31);
  nodes["ring-l-2"] = node_ring_l_2_31;
  const mesh_ring_l_2_31Geometry = endpoint_ring_l_2_31
    ? new THREE.CylinderGeometry(endpoint_ring_l_2_31.endRadius, endpoint_ring_l_2_31.baseRadius, endpoint_ring_l_2_31.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_ring_l_2_31) {
    mesh_ring_l_2_31Geometry.scale(0.015120000000000001, 0.02016, 0.015120000000000001);
  }
  const mesh_ring_l_2_31 = new THREE.Mesh(
    mesh_ring_l_2_31Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ring_l_2_31.name = "Ring L phalanx 2";
  if (endpoint_ring_l_2_31) {
    mesh_ring_l_2_31.position.copy(endpoint_ring_l_2_31.midpoint);
    mesh_ring_l_2_31.quaternion.copy(endpoint_ring_l_2_31.quaternion);
  }
  mesh_ring_l_2_31.castShadow = options.castShadow ?? true;
  mesh_ring_l_2_31.receiveShadow = options.receiveShadow ?? true;
  mesh_ring_l_2_31.userData.sculptComponent = {"id": "ring-l-2", "name": "Ring L phalanx 2", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Ring L phalanx 2 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "ring-l-1", "attachment": {"parentSocket": "ring-l-1-ring-2", "localStart": [0.00352, -0.02919, 0.0], "localEnd": [0.00593, -0.0492, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00756, "endRadius": 0.0062, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.015120000000000001, "height": 0.02016, "depth": 0.015120000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0035195388942942385, -0.029188573894103675, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.015120000000000001, 0.02016, 0.015120000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ring-l-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_ring_l_2_31.add(mesh_ring_l_2_31);
  meshes["ring-l-2"] = mesh_ring_l_2_31;
  colliders["ring-l-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["ring-l-2"] ??= [];
  destructionGroups["ring-l-2"].push(node_ring_l_2_31);

  const attachment_ring_l_3_32 = {"parentSocket": "ring-l-2-ring-3", "localStart": [0.00241, -0.02002, 0.0], "localEnd": [0.00396, -0.0328, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00756, "endRadius": 0.0062, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_ring_l_3_32 = makeAttachmentEndpoint(attachment_ring_l_3_32);
  const node_ring_l_3_32 = new THREE.Group();
  node_ring_l_3_32.name = "Ring L phalanx 3__pivot";
  node_ring_l_3_32.scale.set(1, 1, 1);
  if (endpoint_ring_l_3_32) {
    node_ring_l_3_32.position.copy(endpoint_ring_l_3_32.start);
    node_ring_l_3_32.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_ring_l_3_32.position.set(0.0024133980989446413, -0.020015022098813923, 0.0);
    node_ring_l_3_32.rotation.set(0.0, 0.0, 0.0);
  }
  node_ring_l_3_32.userData.sculptComponent = {"id": "ring-l-3", "name": "Ring L phalanx 3", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Ring L phalanx 3 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "ring-l-2", "attachment": {"parentSocket": "ring-l-2-ring-3", "localStart": [0.00241, -0.02002, 0.0], "localEnd": [0.00396, -0.0328, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00756, "endRadius": 0.0062, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.015120000000000001, "height": 0.01288, "depth": 0.015120000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0024133980989446413, -0.020015022098813923, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.015120000000000001, 0.01288, 0.015120000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ring-l-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_ring_l_3_32.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ring-l-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["ring-l-2"] ?? root).add(node_ring_l_3_32);
  nodes["ring-l-3"] = node_ring_l_3_32;
  const mesh_ring_l_3_32Geometry = endpoint_ring_l_3_32
    ? new THREE.CylinderGeometry(endpoint_ring_l_3_32.endRadius, endpoint_ring_l_3_32.baseRadius, endpoint_ring_l_3_32.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_ring_l_3_32) {
    mesh_ring_l_3_32Geometry.scale(0.015120000000000001, 0.01288, 0.015120000000000001);
  }
  const mesh_ring_l_3_32 = new THREE.Mesh(
    mesh_ring_l_3_32Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ring_l_3_32.name = "Ring L phalanx 3";
  if (endpoint_ring_l_3_32) {
    mesh_ring_l_3_32.position.copy(endpoint_ring_l_3_32.midpoint);
    mesh_ring_l_3_32.quaternion.copy(endpoint_ring_l_3_32.quaternion);
  }
  mesh_ring_l_3_32.castShadow = options.castShadow ?? true;
  mesh_ring_l_3_32.receiveShadow = options.receiveShadow ?? true;
  mesh_ring_l_3_32.userData.sculptComponent = {"id": "ring-l-3", "name": "Ring L phalanx 3", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Ring L phalanx 3 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "ring-l-2", "attachment": {"parentSocket": "ring-l-2-ring-3", "localStart": [0.00241, -0.02002, 0.0], "localEnd": [0.00396, -0.0328, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00756, "endRadius": 0.0062, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.015120000000000001, "height": 0.01288, "depth": 0.015120000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0024133980989446413, -0.020015022098813923, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.015120000000000001, 0.01288, 0.015120000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ring-l-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_ring_l_3_32.add(mesh_ring_l_3_32);
  meshes["ring-l-3"] = mesh_ring_l_3_32;
  colliders["ring-l-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["ring-l-3"] ??= [];
  destructionGroups["ring-l-3"].push(node_ring_l_3_32);

  const attachment_little_l_1_33 = {"parentSocket": "hand-l-little-1", "localStart": [0.0196, -0.03763, 0.0028], "localEnd": [0.02228, -0.05987, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.00672, "endRadius": 0.00551, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_little_l_1_33 = makeAttachmentEndpoint(attachment_little_l_1_33);
  const node_little_l_1_33 = new THREE.Group();
  node_little_l_1_33.name = "Little L phalanx 1__pivot";
  node_little_l_1_33.scale.set(1, 1, 1);
  if (endpoint_little_l_1_33) {
    node_little_l_1_33.position.copy(endpoint_little_l_1_33.start);
    node_little_l_1_33.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_little_l_1_33.position.set(0.019600000000000006, -0.037632, 0.0028000000000000004);
    node_little_l_1_33.rotation.set(0.0, 0.0, 0.0);
  }
  node_little_l_1_33.userData.sculptComponent = {"id": "little-l-1", "name": "Little L phalanx 1", "level": "micro", "role": "finger", "importance": 0.3, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Little L phalanx 1 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-l", "attachment": {"parentSocket": "hand-l-little-1", "localStart": [0.0196, -0.03763, 0.0028], "localEnd": [0.02228, -0.05987, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.00672, "endRadius": 0.00551, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.013440000000000002, "height": 0.022400000000000003, "depth": 0.013440000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.019600000000000006, -0.037632, 0.0028000000000000004], "rotation": [0.0, 0.0, 0.0], "scale": [0.013440000000000002, 0.022400000000000003, 0.013440000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "little-l-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_little_l_1_33.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "little-l-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["hand-l"] ?? root).add(node_little_l_1_33);
  nodes["little-l-1"] = node_little_l_1_33;
  const mesh_little_l_1_33Geometry = endpoint_little_l_1_33
    ? new THREE.CylinderGeometry(endpoint_little_l_1_33.endRadius, endpoint_little_l_1_33.baseRadius, endpoint_little_l_1_33.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_little_l_1_33) {
    mesh_little_l_1_33Geometry.scale(0.013440000000000002, 0.022400000000000003, 0.013440000000000002);
  }
  const mesh_little_l_1_33 = new THREE.Mesh(
    mesh_little_l_1_33Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_little_l_1_33.name = "Little L phalanx 1";
  if (endpoint_little_l_1_33) {
    mesh_little_l_1_33.position.copy(endpoint_little_l_1_33.midpoint);
    mesh_little_l_1_33.quaternion.copy(endpoint_little_l_1_33.quaternion);
  }
  mesh_little_l_1_33.castShadow = options.castShadow ?? true;
  mesh_little_l_1_33.receiveShadow = options.receiveShadow ?? true;
  mesh_little_l_1_33.userData.sculptComponent = {"id": "little-l-1", "name": "Little L phalanx 1", "level": "micro", "role": "finger", "importance": 0.3, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Little L phalanx 1 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-l", "attachment": {"parentSocket": "hand-l-little-1", "localStart": [0.0196, -0.03763, 0.0028], "localEnd": [0.02228, -0.05987, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.00672, "endRadius": 0.00551, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.013440000000000002, "height": 0.022400000000000003, "depth": 0.013440000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.019600000000000006, -0.037632, 0.0028000000000000004], "rotation": [0.0, 0.0, 0.0], "scale": [0.013440000000000002, 0.022400000000000003, 0.013440000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "little-l-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_little_l_1_33.add(mesh_little_l_1_33);
  meshes["little-l-1"] = mesh_little_l_1_33;
  colliders["little-l-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["little-l-1"] ??= [];
  destructionGroups["little-l-1"].push(node_little_l_1_33);

  const attachment_little_l_2_34 = {"parentSocket": "little-l-1-little-2", "localStart": [0.00268, -0.02224, 0.0], "localEnd": [0.00463, -0.03836, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00672, "endRadius": 0.00551, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_little_l_2_34 = makeAttachmentEndpoint(attachment_little_l_2_34);
  const node_little_l_2_34 = new THREE.Group();
  node_little_l_2_34.name = "Little L phalanx 2__pivot";
  node_little_l_2_34.scale.set(1, 1, 1);
  if (endpoint_little_l_2_34) {
    node_little_l_2_34.position.copy(endpoint_little_l_2_34.start);
    node_little_l_2_34.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_little_l_2_34.position.set(0.0026815534432718113, -0.022238913443126618, 0.0);
    node_little_l_2_34.rotation.set(0.0, 0.0, 0.0);
  }
  node_little_l_2_34.userData.sculptComponent = {"id": "little-l-2", "name": "Little L phalanx 2", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Little L phalanx 2 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "little-l-1", "attachment": {"parentSocket": "little-l-1-little-2", "localStart": [0.00268, -0.02224, 0.0], "localEnd": [0.00463, -0.03836, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00672, "endRadius": 0.00551, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.013440000000000002, "height": 0.01624, "depth": 0.013440000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0026815534432718113, -0.022238913443126618, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.013440000000000002, 0.01624, 0.013440000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "little-l-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_little_l_2_34.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "little-l-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["little-l-1"] ?? root).add(node_little_l_2_34);
  nodes["little-l-2"] = node_little_l_2_34;
  const mesh_little_l_2_34Geometry = endpoint_little_l_2_34
    ? new THREE.CylinderGeometry(endpoint_little_l_2_34.endRadius, endpoint_little_l_2_34.baseRadius, endpoint_little_l_2_34.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_little_l_2_34) {
    mesh_little_l_2_34Geometry.scale(0.013440000000000002, 0.01624, 0.013440000000000002);
  }
  const mesh_little_l_2_34 = new THREE.Mesh(
    mesh_little_l_2_34Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_little_l_2_34.name = "Little L phalanx 2";
  if (endpoint_little_l_2_34) {
    mesh_little_l_2_34.position.copy(endpoint_little_l_2_34.midpoint);
    mesh_little_l_2_34.quaternion.copy(endpoint_little_l_2_34.quaternion);
  }
  mesh_little_l_2_34.castShadow = options.castShadow ?? true;
  mesh_little_l_2_34.receiveShadow = options.receiveShadow ?? true;
  mesh_little_l_2_34.userData.sculptComponent = {"id": "little-l-2", "name": "Little L phalanx 2", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Little L phalanx 2 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "little-l-1", "attachment": {"parentSocket": "little-l-1-little-2", "localStart": [0.00268, -0.02224, 0.0], "localEnd": [0.00463, -0.03836, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00672, "endRadius": 0.00551, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.013440000000000002, "height": 0.01624, "depth": 0.013440000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0026815534432718113, -0.022238913443126618, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.013440000000000002, 0.01624, 0.013440000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "little-l-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_little_l_2_34.add(mesh_little_l_2_34);
  meshes["little-l-2"] = mesh_little_l_2_34;
  colliders["little-l-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["little-l-2"] ??= [];
  destructionGroups["little-l-2"].push(node_little_l_2_34);

  const attachment_little_l_3_35 = {"parentSocket": "little-l-2-little-3", "localStart": [0.00194, -0.01612, 0.0], "localEnd": [0.00322, -0.02669, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00672, "endRadius": 0.00551, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_little_l_3_35 = makeAttachmentEndpoint(attachment_little_l_3_35);
  const node_little_l_3_35 = new THREE.Group();
  node_little_l_3_35.name = "Little L phalanx 3__pivot";
  node_little_l_3_35.scale.set(1, 1, 1);
  if (endpoint_little_l_3_35) {
    node_little_l_3_35.position.copy(endpoint_little_l_3_35.start);
    node_little_l_3_35.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_little_l_3_35.position.set(0.0019441262463720244, -0.016123212246266783, 0.0);
    node_little_l_3_35.rotation.set(0.0, 0.0, 0.0);
  }
  node_little_l_3_35.userData.sculptComponent = {"id": "little-l-3", "name": "Little L phalanx 3", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Little L phalanx 3 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "little-l-2", "attachment": {"parentSocket": "little-l-2-little-3", "localStart": [0.00194, -0.01612, 0.0], "localEnd": [0.00322, -0.02669, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00672, "endRadius": 0.00551, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.013440000000000002, "height": 0.01064, "depth": 0.013440000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0019441262463720244, -0.016123212246266783, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.013440000000000002, 0.01064, 0.013440000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "little-l-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_little_l_3_35.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "little-l-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["little-l-2"] ?? root).add(node_little_l_3_35);
  nodes["little-l-3"] = node_little_l_3_35;
  const mesh_little_l_3_35Geometry = endpoint_little_l_3_35
    ? new THREE.CylinderGeometry(endpoint_little_l_3_35.endRadius, endpoint_little_l_3_35.baseRadius, endpoint_little_l_3_35.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_little_l_3_35) {
    mesh_little_l_3_35Geometry.scale(0.013440000000000002, 0.01064, 0.013440000000000002);
  }
  const mesh_little_l_3_35 = new THREE.Mesh(
    mesh_little_l_3_35Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_little_l_3_35.name = "Little L phalanx 3";
  if (endpoint_little_l_3_35) {
    mesh_little_l_3_35.position.copy(endpoint_little_l_3_35.midpoint);
    mesh_little_l_3_35.quaternion.copy(endpoint_little_l_3_35.quaternion);
  }
  mesh_little_l_3_35.castShadow = options.castShadow ?? true;
  mesh_little_l_3_35.receiveShadow = options.receiveShadow ?? true;
  mesh_little_l_3_35.userData.sculptComponent = {"id": "little-l-3", "name": "Little L phalanx 3", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Little L phalanx 3 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "little-l-2", "attachment": {"parentSocket": "little-l-2-little-3", "localStart": [0.00194, -0.01612, 0.0], "localEnd": [0.00322, -0.02669, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00672, "endRadius": 0.00551, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.013440000000000002, "height": 0.01064, "depth": 0.013440000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0019441262463720244, -0.016123212246266783, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.013440000000000002, 0.01064, 0.013440000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "little-l-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_little_l_3_35.add(mesh_little_l_3_35);
  meshes["little-l-3"] = mesh_little_l_3_35;
  colliders["little-l-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["little-l-3"] ??= [];
  destructionGroups["little-l-3"].push(node_little_l_3_35);

  const attachment_clavicle_r_36 = {"parentSocket": "chest-clavicle-r", "localStart": [-0.04301, 0.31612, 0.0056], "localEnd": [-0.2688, 0.31052, 0.0112], "contactType": "rigid-weld", "baseRadius": 0.0308, "endRadius": 0.0476, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_clavicle_r_36 = makeAttachmentEndpoint(attachment_clavicle_r_36);
  const node_clavicle_r_36 = new THREE.Group();
  node_clavicle_r_36.name = "Clavicle R__pivot";
  node_clavicle_r_36.scale.set(1, 1, 1);
  if (endpoint_clavicle_r_36) {
    node_clavicle_r_36.position.copy(endpoint_clavicle_r_36.start);
    node_clavicle_r_36.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_clavicle_r_36.position.set(-0.043008000000000005, 0.31611999999999996, 0.005600000000000001);
    node_clavicle_r_36.rotation.set(0.0, 0.0, 0.0);
  }
  node_clavicle_r_36.userData.sculptComponent = {"id": "clavicle-r", "name": "Clavicle R", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Clavicle R is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chest", "attachment": {"parentSocket": "chest-clavicle-r", "localStart": [-0.04301, 0.31612, 0.0056], "localEnd": [-0.2688, 0.31052, 0.0112], "contactType": "rigid-weld", "baseRadius": 0.0308, "endRadius": 0.0476, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.22579200000000002, "height": 0.09520000000000002, "depth": 0.09520000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.043008000000000005, 0.31611999999999996, 0.005600000000000001], "rotation": [0.0, 0.0, 0.0], "scale": [0.22579200000000002, 0.09520000000000002, 0.09520000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "clavicle-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "dark-cloth-material", "materialLayers": ["dark-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 30, 38, 1)", "secondaryAlbedo": "rgba(10, 9, 13, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_clavicle_r_36.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "clavicle-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["chest"] ?? root).add(node_clavicle_r_36);
  nodes["clavicle-r"] = node_clavicle_r_36;
  const mesh_clavicle_r_36Geometry = endpoint_clavicle_r_36
    ? new THREE.CylinderGeometry(endpoint_clavicle_r_36.endRadius, endpoint_clavicle_r_36.baseRadius, endpoint_clavicle_r_36.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_clavicle_r_36) {
    mesh_clavicle_r_36Geometry.scale(0.22579200000000002, 0.09520000000000002, 0.09520000000000002);
  }
  const mesh_clavicle_r_36 = new THREE.Mesh(
    mesh_clavicle_r_36Geometry,
    materialMap["dark-cloth-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_clavicle_r_36.name = "Clavicle R";
  if (endpoint_clavicle_r_36) {
    mesh_clavicle_r_36.position.copy(endpoint_clavicle_r_36.midpoint);
    mesh_clavicle_r_36.quaternion.copy(endpoint_clavicle_r_36.quaternion);
  }
  mesh_clavicle_r_36.castShadow = options.castShadow ?? true;
  mesh_clavicle_r_36.receiveShadow = options.receiveShadow ?? true;
  mesh_clavicle_r_36.userData.sculptComponent = {"id": "clavicle-r", "name": "Clavicle R", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Clavicle R is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chest", "attachment": {"parentSocket": "chest-clavicle-r", "localStart": [-0.04301, 0.31612, 0.0056], "localEnd": [-0.2688, 0.31052, 0.0112], "contactType": "rigid-weld", "baseRadius": 0.0308, "endRadius": 0.0476, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.22579200000000002, "height": 0.09520000000000002, "depth": 0.09520000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.043008000000000005, 0.31611999999999996, 0.005600000000000001], "rotation": [0.0, 0.0, 0.0], "scale": [0.22579200000000002, 0.09520000000000002, 0.09520000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "clavicle-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "dark-cloth-material", "materialLayers": ["dark-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 30, 38, 1)", "secondaryAlbedo": "rgba(10, 9, 13, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_clavicle_r_36.add(mesh_clavicle_r_36);
  meshes["clavicle-r"] = mesh_clavicle_r_36;
  colliders["clavicle-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["clavicle-r"] ??= [];
  destructionGroups["clavicle-r"].push(node_clavicle_r_36);

  const attachment_upper_arm_r_37 = {"parentSocket": "clavicle-shoulder-r", "localStart": [-0.22579, -0.0056, 0.0056], "localEnd": [-0.28538, -0.29954, 0.0056], "contactType": "socket-joint", "baseRadius": 0.0448, "endRadius": 0.0364, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_upper_arm_r_37 = makeAttachmentEndpoint(attachment_upper_arm_r_37);
  const node_upper_arm_r_37 = new THREE.Group();
  node_upper_arm_r_37.name = "Upper arm R__pivot";
  node_upper_arm_r_37.scale.set(1, 1, 1);
  if (endpoint_upper_arm_r_37) {
    node_upper_arm_r_37.position.copy(endpoint_upper_arm_r_37.start);
    node_upper_arm_r_37.rotation.set(0.3839724354387525, 0.24434609527920614, 0.4188790204786391);
  } else {
    node_upper_arm_r_37.position.set(-0.22579200000000005, -0.005599999999999994, 0.005600000000000001);
    node_upper_arm_r_37.rotation.set(0.3839724354387525, 0.24434609527920614, 0.4188790204786391);
  }
  node_upper_arm_r_37.userData.sculptComponent = {"id": "upper-arm-r", "name": "Upper arm R", "level": "meso", "role": "arm", "importance": 0.7, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Upper arm R is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "clavicle-r", "attachment": {"parentSocket": "clavicle-shoulder-r", "localStart": [-0.22579, -0.0056, 0.0056], "localEnd": [-0.28538, -0.29954, 0.0056], "contactType": "socket-joint", "baseRadius": 0.0448, "endRadius": 0.0364, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.08960000000000001, "height": 0.299915, "depth": 0.08960000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.22579200000000005, -0.005599999999999994, 0.005600000000000001], "rotation": [0.3839724354387525, 0.24434609527920614, 0.4188790204786391], "scale": [0.08960000000000001, 0.299915, 0.08960000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-arm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shirt"}}, "material": "dark-cloth-material", "materialLayers": ["dark-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 30, 38, 1)", "secondaryAlbedo": "rgba(10, 9, 13, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_upper_arm_r_37.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-arm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shirt"}};
  (nodes["clavicle-r"] ?? root).add(node_upper_arm_r_37);
  nodes["upper-arm-r"] = node_upper_arm_r_37;
  const mesh_upper_arm_r_37Geometry = endpoint_upper_arm_r_37
    ? new THREE.CylinderGeometry(endpoint_upper_arm_r_37.endRadius, endpoint_upper_arm_r_37.baseRadius, endpoint_upper_arm_r_37.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_upper_arm_r_37) {
    mesh_upper_arm_r_37Geometry.scale(0.08960000000000001, 0.299915, 0.08960000000000001);
  }
  const mesh_upper_arm_r_37 = new THREE.Mesh(
    mesh_upper_arm_r_37Geometry,
    materialMap["dark-cloth-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_upper_arm_r_37.name = "Upper arm R";
  if (endpoint_upper_arm_r_37) {
    mesh_upper_arm_r_37.position.copy(endpoint_upper_arm_r_37.midpoint);
    mesh_upper_arm_r_37.quaternion.copy(endpoint_upper_arm_r_37.quaternion);
  }
  mesh_upper_arm_r_37.castShadow = options.castShadow ?? true;
  mesh_upper_arm_r_37.receiveShadow = options.receiveShadow ?? true;
  mesh_upper_arm_r_37.userData.sculptComponent = {"id": "upper-arm-r", "name": "Upper arm R", "level": "meso", "role": "arm", "importance": 0.7, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Upper arm R is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "clavicle-r", "attachment": {"parentSocket": "clavicle-shoulder-r", "localStart": [-0.22579, -0.0056, 0.0056], "localEnd": [-0.28538, -0.29954, 0.0056], "contactType": "socket-joint", "baseRadius": 0.0448, "endRadius": 0.0364, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.08960000000000001, "height": 0.299915, "depth": 0.08960000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.22579200000000005, -0.005599999999999994, 0.005600000000000001], "rotation": [0.3839724354387525, 0.24434609527920614, 0.4188790204786391], "scale": [0.08960000000000001, 0.299915, 0.08960000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-arm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shirt"}}, "material": "dark-cloth-material", "materialLayers": ["dark-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 30, 38, 1)", "secondaryAlbedo": "rgba(10, 9, 13, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_upper_arm_r_37.add(mesh_upper_arm_r_37);
  meshes["upper-arm-r"] = mesh_upper_arm_r_37;
  colliders["upper-arm-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["upper-arm-r"] ??= [];
  destructionGroups["upper-arm-r"].push(node_upper_arm_r_37);

  const attachment_forearm_r_38 = {"parentSocket": "upper-arm-elbow-r", "localStart": [-0.05958, -0.29394, 0.0], "localEnd": [-0.08896, -0.53756, 0.0], "contactType": "hinge-joint", "baseRadius": 0.0336, "endRadius": 0.0252, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_forearm_r_38 = makeAttachmentEndpoint(attachment_forearm_r_38);
  const node_forearm_r_38 = new THREE.Group();
  node_forearm_r_38.name = "Forearm R__pivot";
  node_forearm_r_38.scale.set(1, 1, 1);
  if (endpoint_forearm_r_38) {
    node_forearm_r_38.position.copy(endpoint_forearm_r_38.start);
    node_forearm_r_38.rotation.set(1.0821041362364843, 0.0, 0.20943951023931956);
  } else {
    node_forearm_r_38.position.set(-0.05958391234540078, -0.293936667693256, 0.0);
    node_forearm_r_38.rotation.set(1.0821041362364843, 0.0, 0.20943951023931956);
  }
  node_forearm_r_38.userData.sculptComponent = {"id": "forearm-r", "name": "Forearm R", "level": "meso", "role": "arm", "importance": 0.65, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Forearm R is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "upper-arm-r", "attachment": {"parentSocket": "upper-arm-elbow-r", "localStart": [-0.05958, -0.29394, 0.0], "localEnd": [-0.08896, -0.53756, 0.0], "contactType": "hinge-joint", "baseRadius": 0.0336, "endRadius": 0.0252, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.0728, "height": 0.24538499999999996, "depth": 0.0728, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.05958391234540078, -0.293936667693256, 0.0], "rotation": [1.0821041362364843, 0.0, 0.20943951023931956], "scale": [0.0728, 0.24538499999999996, 0.0728]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "forearm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "dark-cloth-material", "materialLayers": ["dark-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 30, 38, 1)", "secondaryAlbedo": "rgba(10, 9, 13, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_forearm_r_38.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "forearm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["upper-arm-r"] ?? root).add(node_forearm_r_38);
  nodes["forearm-r"] = node_forearm_r_38;
  const mesh_forearm_r_38Geometry = endpoint_forearm_r_38
    ? new THREE.CylinderGeometry(endpoint_forearm_r_38.endRadius, endpoint_forearm_r_38.baseRadius, endpoint_forearm_r_38.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_forearm_r_38) {
    mesh_forearm_r_38Geometry.scale(0.0728, 0.24538499999999996, 0.0728);
  }
  const mesh_forearm_r_38 = new THREE.Mesh(
    mesh_forearm_r_38Geometry,
    materialMap["dark-cloth-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_forearm_r_38.name = "Forearm R";
  if (endpoint_forearm_r_38) {
    mesh_forearm_r_38.position.copy(endpoint_forearm_r_38.midpoint);
    mesh_forearm_r_38.quaternion.copy(endpoint_forearm_r_38.quaternion);
  }
  mesh_forearm_r_38.castShadow = options.castShadow ?? true;
  mesh_forearm_r_38.receiveShadow = options.receiveShadow ?? true;
  mesh_forearm_r_38.userData.sculptComponent = {"id": "forearm-r", "name": "Forearm R", "level": "meso", "role": "arm", "importance": 0.65, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Forearm R is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "upper-arm-r", "attachment": {"parentSocket": "upper-arm-elbow-r", "localStart": [-0.05958, -0.29394, 0.0], "localEnd": [-0.08896, -0.53756, 0.0], "contactType": "hinge-joint", "baseRadius": 0.0336, "endRadius": 0.0252, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.0728, "height": 0.24538499999999996, "depth": 0.0728, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.05958391234540078, -0.293936667693256, 0.0], "rotation": [1.0821041362364843, 0.0, 0.20943951023931956], "scale": [0.0728, 0.24538499999999996, 0.0728]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "forearm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "dark-cloth-material", "materialLayers": ["dark-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 30, 38, 1)", "secondaryAlbedo": "rgba(10, 9, 13, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_forearm_r_38.add(mesh_forearm_r_38);
  meshes["forearm-r"] = mesh_forearm_r_38;
  colliders["forearm-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["forearm-r"] ??= [];
  destructionGroups["forearm-r"].push(node_forearm_r_38);

  const endpoint_hand_r_39 = makeAttachmentEndpoint(null);
  const node_hand_r_39 = new THREE.Group();
  node_hand_r_39.name = "Hand R__pivot";
  node_hand_r_39.scale.set(1, 1, 1);
  if (endpoint_hand_r_39) {
    node_hand_r_39.position.copy(endpoint_hand_r_39.start);
    node_hand_r_39.rotation.set(-0.3141592653589793, 0.13962634015954636, 0.3141592653589793);
  } else {
    node_hand_r_39.position.set(-0.03473868687213505, -0.28809817399525417, 0.0);
    node_hand_r_39.rotation.set(-0.3141592653589793, 0.13962634015954636, 0.3141592653589793);
  }
  node_hand_r_39.userData.sculptComponent = {"id": "hand-r", "name": "Hand R", "level": "meso", "role": "hand", "importance": 0.55, "confidence": 0.64, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Hand R is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "forearm-r", "attachment": null, "dimensions": {"width": 0.06160000000000001, "height": 0.08960000000000001, "depth": 0.0364, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.03473868687213505, -0.28809817399525417, 0.0], "rotation": [-0.3141592653589793, 0.13962634015954636, 0.3141592653589793], "scale": [0.06160000000000001, 0.08960000000000001, 0.0364]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hand-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "dark-cloth-material", "materialLayers": ["dark-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 30, 38, 1)", "secondaryAlbedo": "rgba(10, 9, 13, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_hand_r_39.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hand-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["forearm-r"] ?? root).add(node_hand_r_39);
  nodes["hand-r"] = node_hand_r_39;
  const mesh_hand_r_39Geometry = endpoint_hand_r_39
    ? new THREE.CylinderGeometry(endpoint_hand_r_39.endRadius, endpoint_hand_r_39.baseRadius, endpoint_hand_r_39.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_hand_r_39) {
    mesh_hand_r_39Geometry.scale(0.06160000000000001, 0.08960000000000001, 0.0364);
  }
  const mesh_hand_r_39 = new THREE.Mesh(
    mesh_hand_r_39Geometry,
    materialMap["dark-cloth-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hand_r_39.name = "Hand R";
  if (endpoint_hand_r_39) {
    mesh_hand_r_39.position.copy(endpoint_hand_r_39.midpoint);
    mesh_hand_r_39.quaternion.copy(endpoint_hand_r_39.quaternion);
  }
  mesh_hand_r_39.castShadow = options.castShadow ?? true;
  mesh_hand_r_39.receiveShadow = options.receiveShadow ?? true;
  mesh_hand_r_39.userData.sculptComponent = {"id": "hand-r", "name": "Hand R", "level": "meso", "role": "hand", "importance": 0.55, "confidence": 0.64, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Hand R is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "forearm-r", "attachment": null, "dimensions": {"width": 0.06160000000000001, "height": 0.08960000000000001, "depth": 0.0364, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.03473868687213505, -0.28809817399525417, 0.0], "rotation": [-0.3141592653589793, 0.13962634015954636, 0.3141592653589793], "scale": [0.06160000000000001, 0.08960000000000001, 0.0364]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hand-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "dark-cloth-material", "materialLayers": ["dark-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 30, 38, 1)", "secondaryAlbedo": "rgba(10, 9, 13, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_hand_r_39.add(mesh_hand_r_39);
  meshes["hand-r"] = mesh_hand_r_39;
  colliders["hand-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["hand-r"] ??= [];
  destructionGroups["hand-r"].push(node_hand_r_39);

  const attachment_thumb_r_1_40 = {"parentSocket": "hand-r-thumb-1", "localStart": [0.028, -0.00538, 0.0056], "localEnd": [0.04312, -0.0184, 0.0119], "contactType": "rigid-weld", "baseRadius": 0.00896, "endRadius": 0.00735, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_thumb_r_1_40 = makeAttachmentEndpoint(attachment_thumb_r_1_40);
  const node_thumb_r_1_40 = new THREE.Group();
  node_thumb_r_1_40.name = "Thumb R phalanx 1__pivot";
  node_thumb_r_1_40.scale.set(1, 1, 1);
  if (endpoint_thumb_r_1_40) {
    node_thumb_r_1_40.position.copy(endpoint_thumb_r_1_40.start);
    node_thumb_r_1_40.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_thumb_r_1_40.position.set(0.028000000000000025, -0.005375999999999992, 0.005600000000000001);
    node_thumb_r_1_40.rotation.set(0.0, 0.0, 0.0);
  }
  node_thumb_r_1_40.userData.sculptComponent = {"id": "thumb-r-1", "name": "Thumb R phalanx 1", "level": "micro", "role": "finger", "importance": 0.3, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Thumb R phalanx 1 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-r", "attachment": {"parentSocket": "hand-r-thumb-1", "localStart": [0.028, -0.00538, 0.0056], "localEnd": [0.04312, -0.0184, 0.0119], "contactType": "rigid-weld", "baseRadius": 0.00896, "endRadius": 0.00735, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.017920000000000002, "height": 0.021, "depth": 0.017920000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.028000000000000025, -0.005375999999999992, 0.005600000000000001], "rotation": [0.0, 0.0, 0.0], "scale": [0.017920000000000002, 0.021, 0.017920000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thumb-r-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_thumb_r_1_40.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thumb-r-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["hand-r"] ?? root).add(node_thumb_r_1_40);
  nodes["thumb-r-1"] = node_thumb_r_1_40;
  const mesh_thumb_r_1_40Geometry = endpoint_thumb_r_1_40
    ? new THREE.CylinderGeometry(endpoint_thumb_r_1_40.endRadius, endpoint_thumb_r_1_40.baseRadius, endpoint_thumb_r_1_40.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_thumb_r_1_40) {
    mesh_thumb_r_1_40Geometry.scale(0.017920000000000002, 0.021, 0.017920000000000002);
  }
  const mesh_thumb_r_1_40 = new THREE.Mesh(
    mesh_thumb_r_1_40Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_thumb_r_1_40.name = "Thumb R phalanx 1";
  if (endpoint_thumb_r_1_40) {
    mesh_thumb_r_1_40.position.copy(endpoint_thumb_r_1_40.midpoint);
    mesh_thumb_r_1_40.quaternion.copy(endpoint_thumb_r_1_40.quaternion);
  }
  mesh_thumb_r_1_40.castShadow = options.castShadow ?? true;
  mesh_thumb_r_1_40.receiveShadow = options.receiveShadow ?? true;
  mesh_thumb_r_1_40.userData.sculptComponent = {"id": "thumb-r-1", "name": "Thumb R phalanx 1", "level": "micro", "role": "finger", "importance": 0.3, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Thumb R phalanx 1 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-r", "attachment": {"parentSocket": "hand-r-thumb-1", "localStart": [0.028, -0.00538, 0.0056], "localEnd": [0.04312, -0.0184, 0.0119], "contactType": "rigid-weld", "baseRadius": 0.00896, "endRadius": 0.00735, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.017920000000000002, "height": 0.021, "depth": 0.017920000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.028000000000000025, -0.005375999999999992, 0.005600000000000001], "rotation": [0.0, 0.0, 0.0], "scale": [0.017920000000000002, 0.021, 0.017920000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thumb-r-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_thumb_r_1_40.add(mesh_thumb_r_1_40);
  meshes["thumb-r-1"] = mesh_thumb_r_1_40;
  colliders["thumb-r-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["thumb-r-1"] ??= [];
  destructionGroups["thumb-r-1"].push(node_thumb_r_1_40);

  const attachment_thumb_r_2_41 = {"parentSocket": "thumb-r-1-thumb-2", "localStart": [0.01512, -0.01302, 0.0063], "localEnd": [0.02621, -0.02257, 0.01092], "contactType": "hinge-joint", "baseRadius": 0.00896, "endRadius": 0.00735, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_thumb_r_2_41 = makeAttachmentEndpoint(attachment_thumb_r_2_41);
  const node_thumb_r_2_41 = new THREE.Group();
  node_thumb_r_2_41.name = "Thumb R phalanx 2__pivot";
  node_thumb_r_2_41.scale.set(1, 1, 1);
  if (endpoint_thumb_r_2_41) {
    node_thumb_r_2_41.position.copy(endpoint_thumb_r_2_41.start);
    node_thumb_r_2_41.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_thumb_r_2_41.position.set(0.015120000000000022, -0.013020000000000004, 0.0063);
    node_thumb_r_2_41.rotation.set(0.0, 0.0, 0.0);
  }
  node_thumb_r_2_41.userData.sculptComponent = {"id": "thumb-r-2", "name": "Thumb R phalanx 2", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Thumb R phalanx 2 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "thumb-r-1", "attachment": {"parentSocket": "thumb-r-1-thumb-2", "localStart": [0.01512, -0.01302, 0.0063], "localEnd": [0.02621, -0.02257, 0.01092], "contactType": "hinge-joint", "baseRadius": 0.00896, "endRadius": 0.00735, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.017920000000000002, "height": 0.015400000000000002, "depth": 0.017920000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.015120000000000022, -0.013020000000000004, 0.0063], "rotation": [0.0, 0.0, 0.0], "scale": [0.017920000000000002, 0.015400000000000002, 0.017920000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thumb-r-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_thumb_r_2_41.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thumb-r-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["thumb-r-1"] ?? root).add(node_thumb_r_2_41);
  nodes["thumb-r-2"] = node_thumb_r_2_41;
  const mesh_thumb_r_2_41Geometry = endpoint_thumb_r_2_41
    ? new THREE.CylinderGeometry(endpoint_thumb_r_2_41.endRadius, endpoint_thumb_r_2_41.baseRadius, endpoint_thumb_r_2_41.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_thumb_r_2_41) {
    mesh_thumb_r_2_41Geometry.scale(0.017920000000000002, 0.015400000000000002, 0.017920000000000002);
  }
  const mesh_thumb_r_2_41 = new THREE.Mesh(
    mesh_thumb_r_2_41Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_thumb_r_2_41.name = "Thumb R phalanx 2";
  if (endpoint_thumb_r_2_41) {
    mesh_thumb_r_2_41.position.copy(endpoint_thumb_r_2_41.midpoint);
    mesh_thumb_r_2_41.quaternion.copy(endpoint_thumb_r_2_41.quaternion);
  }
  mesh_thumb_r_2_41.castShadow = options.castShadow ?? true;
  mesh_thumb_r_2_41.receiveShadow = options.receiveShadow ?? true;
  mesh_thumb_r_2_41.userData.sculptComponent = {"id": "thumb-r-2", "name": "Thumb R phalanx 2", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Thumb R phalanx 2 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "thumb-r-1", "attachment": {"parentSocket": "thumb-r-1-thumb-2", "localStart": [0.01512, -0.01302, 0.0063], "localEnd": [0.02621, -0.02257, 0.01092], "contactType": "hinge-joint", "baseRadius": 0.00896, "endRadius": 0.00735, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.017920000000000002, "height": 0.015400000000000002, "depth": 0.017920000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.015120000000000022, -0.013020000000000004, 0.0063], "rotation": [0.0, 0.0, 0.0], "scale": [0.017920000000000002, 0.015400000000000002, 0.017920000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thumb-r-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_thumb_r_2_41.add(mesh_thumb_r_2_41);
  meshes["thumb-r-2"] = mesh_thumb_r_2_41;
  colliders["thumb-r-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["thumb-r-2"] ??= [];
  destructionGroups["thumb-r-2"].push(node_thumb_r_2_41);

  const attachment_thumb_r_3_42 = {"parentSocket": "thumb-r-2-thumb-3", "localStart": [0.01109, -0.00955, 0.00462], "localEnd": [0.01915, -0.01649, 0.00798], "contactType": "hinge-joint", "baseRadius": 0.00896, "endRadius": 0.00735, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_thumb_r_3_42 = makeAttachmentEndpoint(attachment_thumb_r_3_42);
  const node_thumb_r_3_42 = new THREE.Group();
  node_thumb_r_3_42.name = "Thumb R phalanx 3__pivot";
  node_thumb_r_3_42.scale.set(1, 1, 1);
  if (endpoint_thumb_r_3_42) {
    node_thumb_r_3_42.position.copy(endpoint_thumb_r_3_42.start);
    node_thumb_r_3_42.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_thumb_r_3_42.position.set(0.011087999999999987, -0.009548000000000001, 0.004620000000000003);
    node_thumb_r_3_42.rotation.set(0.0, 0.0, 0.0);
  }
  node_thumb_r_3_42.userData.sculptComponent = {"id": "thumb-r-3", "name": "Thumb R phalanx 3", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Thumb R phalanx 3 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "thumb-r-2", "attachment": {"parentSocket": "thumb-r-2-thumb-3", "localStart": [0.01109, -0.00955, 0.00462], "localEnd": [0.01915, -0.01649, 0.00798], "contactType": "hinge-joint", "baseRadius": 0.00896, "endRadius": 0.00735, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.017920000000000002, "height": 0.011200000000000002, "depth": 0.017920000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.011087999999999987, -0.009548000000000001, 0.004620000000000003], "rotation": [0.0, 0.0, 0.0], "scale": [0.017920000000000002, 0.011200000000000002, 0.017920000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thumb-r-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_thumb_r_3_42.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thumb-r-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["thumb-r-2"] ?? root).add(node_thumb_r_3_42);
  nodes["thumb-r-3"] = node_thumb_r_3_42;
  const mesh_thumb_r_3_42Geometry = endpoint_thumb_r_3_42
    ? new THREE.CylinderGeometry(endpoint_thumb_r_3_42.endRadius, endpoint_thumb_r_3_42.baseRadius, endpoint_thumb_r_3_42.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_thumb_r_3_42) {
    mesh_thumb_r_3_42Geometry.scale(0.017920000000000002, 0.011200000000000002, 0.017920000000000002);
  }
  const mesh_thumb_r_3_42 = new THREE.Mesh(
    mesh_thumb_r_3_42Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_thumb_r_3_42.name = "Thumb R phalanx 3";
  if (endpoint_thumb_r_3_42) {
    mesh_thumb_r_3_42.position.copy(endpoint_thumb_r_3_42.midpoint);
    mesh_thumb_r_3_42.quaternion.copy(endpoint_thumb_r_3_42.quaternion);
  }
  mesh_thumb_r_3_42.castShadow = options.castShadow ?? true;
  mesh_thumb_r_3_42.receiveShadow = options.receiveShadow ?? true;
  mesh_thumb_r_3_42.userData.sculptComponent = {"id": "thumb-r-3", "name": "Thumb R phalanx 3", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Thumb R phalanx 3 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "thumb-r-2", "attachment": {"parentSocket": "thumb-r-2-thumb-3", "localStart": [0.01109, -0.00955, 0.00462], "localEnd": [0.01915, -0.01649, 0.00798], "contactType": "hinge-joint", "baseRadius": 0.00896, "endRadius": 0.00735, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.017920000000000002, "height": 0.011200000000000002, "depth": 0.017920000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.011087999999999987, -0.009548000000000001, 0.004620000000000003], "rotation": [0.0, 0.0, 0.0], "scale": [0.017920000000000002, 0.011200000000000002, 0.017920000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thumb-r-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_thumb_r_3_42.add(mesh_thumb_r_3_42);
  meshes["thumb-r-3"] = mesh_thumb_r_3_42;
  colliders["thumb-r-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["thumb-r-3"] ??= [];
  destructionGroups["thumb-r-3"].push(node_thumb_r_3_42);

  const attachment_index_r_1_43 = {"parentSocket": "hand-r-index-1", "localStart": [0.021, -0.03763, 0.0028], "localEnd": [0.01748, -0.06682, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.00784, "endRadius": 0.00643, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_index_r_1_43 = makeAttachmentEndpoint(attachment_index_r_1_43);
  const node_index_r_1_43 = new THREE.Group();
  node_index_r_1_43.name = "Index R phalanx 1__pivot";
  node_index_r_1_43.scale.set(1, 1, 1);
  if (endpoint_index_r_1_43) {
    node_index_r_1_43.position.copy(endpoint_index_r_1_43.start);
    node_index_r_1_43.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_index_r_1_43.position.set(0.02100000000000002, -0.037632, 0.0028000000000000004);
    node_index_r_1_43.rotation.set(0.0, 0.0, 0.0);
  }
  node_index_r_1_43.userData.sculptComponent = {"id": "index-r-1", "name": "Index R phalanx 1", "level": "micro", "role": "finger", "importance": 0.3, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Index R phalanx 1 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-r", "attachment": {"parentSocket": "hand-r-index-1", "localStart": [0.021, -0.03763, 0.0028], "localEnd": [0.01748, -0.06682, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.00784, "endRadius": 0.00643, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.015680000000000003, "height": 0.029400000000000003, "depth": 0.015680000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.02100000000000002, -0.037632, 0.0028000000000000004], "rotation": [0.0, 0.0, 0.0], "scale": [0.015680000000000003, 0.029400000000000003, 0.015680000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "index-r-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_index_r_1_43.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "index-r-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["hand-r"] ?? root).add(node_index_r_1_43);
  nodes["index-r-1"] = node_index_r_1_43;
  const mesh_index_r_1_43Geometry = endpoint_index_r_1_43
    ? new THREE.CylinderGeometry(endpoint_index_r_1_43.endRadius, endpoint_index_r_1_43.baseRadius, endpoint_index_r_1_43.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_index_r_1_43) {
    mesh_index_r_1_43Geometry.scale(0.015680000000000003, 0.029400000000000003, 0.015680000000000003);
  }
  const mesh_index_r_1_43 = new THREE.Mesh(
    mesh_index_r_1_43Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_index_r_1_43.name = "Index R phalanx 1";
  if (endpoint_index_r_1_43) {
    mesh_index_r_1_43.position.copy(endpoint_index_r_1_43.midpoint);
    mesh_index_r_1_43.quaternion.copy(endpoint_index_r_1_43.quaternion);
  }
  mesh_index_r_1_43.castShadow = options.castShadow ?? true;
  mesh_index_r_1_43.receiveShadow = options.receiveShadow ?? true;
  mesh_index_r_1_43.userData.sculptComponent = {"id": "index-r-1", "name": "Index R phalanx 1", "level": "micro", "role": "finger", "importance": 0.3, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Index R phalanx 1 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-r", "attachment": {"parentSocket": "hand-r-index-1", "localStart": [0.021, -0.03763, 0.0028], "localEnd": [0.01748, -0.06682, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.00784, "endRadius": 0.00643, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.015680000000000003, "height": 0.029400000000000003, "depth": 0.015680000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.02100000000000002, -0.037632, 0.0028000000000000004], "rotation": [0.0, 0.0, 0.0], "scale": [0.015680000000000003, 0.029400000000000003, 0.015680000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "index-r-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_index_r_1_43.add(mesh_index_r_1_43);
  meshes["index-r-1"] = mesh_index_r_1_43;
  colliders["index-r-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["index-r-1"] ??= [];
  destructionGroups["index-r-1"].push(node_index_r_1_43);

  const attachment_index_r_2_44 = {"parentSocket": "index-r-1-index-2", "localStart": [-0.00352, -0.02919, 0.0], "localEnd": [-0.00593, -0.0492, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00784, "endRadius": 0.00643, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_index_r_2_44 = makeAttachmentEndpoint(attachment_index_r_2_44);
  const node_index_r_2_44 = new THREE.Group();
  node_index_r_2_44.name = "Index R phalanx 2__pivot";
  node_index_r_2_44.scale.set(1, 1, 1);
  if (endpoint_index_r_2_44) {
    node_index_r_2_44.position.copy(endpoint_index_r_2_44.start);
    node_index_r_2_44.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_index_r_2_44.position.set(-0.0035195388942942385, -0.029188573894103675, 0.0);
    node_index_r_2_44.rotation.set(0.0, 0.0, 0.0);
  }
  node_index_r_2_44.userData.sculptComponent = {"id": "index-r-2", "name": "Index R phalanx 2", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Index R phalanx 2 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "index-r-1", "attachment": {"parentSocket": "index-r-1-index-2", "localStart": [-0.00352, -0.02919, 0.0], "localEnd": [-0.00593, -0.0492, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00784, "endRadius": 0.00643, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.015680000000000003, "height": 0.02016, "depth": 0.015680000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.0035195388942942385, -0.029188573894103675, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.015680000000000003, 0.02016, 0.015680000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "index-r-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_index_r_2_44.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "index-r-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["index-r-1"] ?? root).add(node_index_r_2_44);
  nodes["index-r-2"] = node_index_r_2_44;
  const mesh_index_r_2_44Geometry = endpoint_index_r_2_44
    ? new THREE.CylinderGeometry(endpoint_index_r_2_44.endRadius, endpoint_index_r_2_44.baseRadius, endpoint_index_r_2_44.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_index_r_2_44) {
    mesh_index_r_2_44Geometry.scale(0.015680000000000003, 0.02016, 0.015680000000000003);
  }
  const mesh_index_r_2_44 = new THREE.Mesh(
    mesh_index_r_2_44Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_index_r_2_44.name = "Index R phalanx 2";
  if (endpoint_index_r_2_44) {
    mesh_index_r_2_44.position.copy(endpoint_index_r_2_44.midpoint);
    mesh_index_r_2_44.quaternion.copy(endpoint_index_r_2_44.quaternion);
  }
  mesh_index_r_2_44.castShadow = options.castShadow ?? true;
  mesh_index_r_2_44.receiveShadow = options.receiveShadow ?? true;
  mesh_index_r_2_44.userData.sculptComponent = {"id": "index-r-2", "name": "Index R phalanx 2", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Index R phalanx 2 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "index-r-1", "attachment": {"parentSocket": "index-r-1-index-2", "localStart": [-0.00352, -0.02919, 0.0], "localEnd": [-0.00593, -0.0492, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00784, "endRadius": 0.00643, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.015680000000000003, "height": 0.02016, "depth": 0.015680000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.0035195388942942385, -0.029188573894103675, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.015680000000000003, 0.02016, 0.015680000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "index-r-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_index_r_2_44.add(mesh_index_r_2_44);
  meshes["index-r-2"] = mesh_index_r_2_44;
  colliders["index-r-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["index-r-2"] ??= [];
  destructionGroups["index-r-2"].push(node_index_r_2_44);

  const attachment_index_r_3_45 = {"parentSocket": "index-r-2-index-3", "localStart": [-0.00241, -0.02002, 0.0], "localEnd": [-0.00402, -0.03336, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00784, "endRadius": 0.00643, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_index_r_3_45 = makeAttachmentEndpoint(attachment_index_r_3_45);
  const node_index_r_3_45 = new THREE.Group();
  node_index_r_3_45.name = "Index R phalanx 3__pivot";
  node_index_r_3_45.scale.set(1, 1, 1);
  if (endpoint_index_r_3_45) {
    node_index_r_3_45.position.copy(endpoint_index_r_3_45.start);
    node_index_r_3_45.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_index_r_3_45.position.set(-0.0024133980989446413, -0.020015022098813923, 0.0);
    node_index_r_3_45.rotation.set(0.0, 0.0, 0.0);
  }
  node_index_r_3_45.userData.sculptComponent = {"id": "index-r-3", "name": "Index R phalanx 3", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Index R phalanx 3 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "index-r-2", "attachment": {"parentSocket": "index-r-2-index-3", "localStart": [-0.00241, -0.02002, 0.0], "localEnd": [-0.00402, -0.03336, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00784, "endRadius": 0.00643, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.015680000000000003, "height": 0.013440000000000002, "depth": 0.015680000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.0024133980989446413, -0.020015022098813923, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.015680000000000003, 0.013440000000000002, 0.015680000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "index-r-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_index_r_3_45.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "index-r-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["index-r-2"] ?? root).add(node_index_r_3_45);
  nodes["index-r-3"] = node_index_r_3_45;
  const mesh_index_r_3_45Geometry = endpoint_index_r_3_45
    ? new THREE.CylinderGeometry(endpoint_index_r_3_45.endRadius, endpoint_index_r_3_45.baseRadius, endpoint_index_r_3_45.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_index_r_3_45) {
    mesh_index_r_3_45Geometry.scale(0.015680000000000003, 0.013440000000000002, 0.015680000000000003);
  }
  const mesh_index_r_3_45 = new THREE.Mesh(
    mesh_index_r_3_45Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_index_r_3_45.name = "Index R phalanx 3";
  if (endpoint_index_r_3_45) {
    mesh_index_r_3_45.position.copy(endpoint_index_r_3_45.midpoint);
    mesh_index_r_3_45.quaternion.copy(endpoint_index_r_3_45.quaternion);
  }
  mesh_index_r_3_45.castShadow = options.castShadow ?? true;
  mesh_index_r_3_45.receiveShadow = options.receiveShadow ?? true;
  mesh_index_r_3_45.userData.sculptComponent = {"id": "index-r-3", "name": "Index R phalanx 3", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Index R phalanx 3 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "index-r-2", "attachment": {"parentSocket": "index-r-2-index-3", "localStart": [-0.00241, -0.02002, 0.0], "localEnd": [-0.00402, -0.03336, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00784, "endRadius": 0.00643, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.015680000000000003, "height": 0.013440000000000002, "depth": 0.015680000000000003, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.0024133980989446413, -0.020015022098813923, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.015680000000000003, 0.013440000000000002, 0.015680000000000003]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "index-r-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_index_r_3_45.add(mesh_index_r_3_45);
  meshes["index-r-3"] = mesh_index_r_3_45;
  colliders["index-r-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["index-r-3"] ??= [];
  destructionGroups["index-r-3"].push(node_index_r_3_45);

  const attachment_middle_r_1_46 = {"parentSocket": "hand-r-middle-1", "localStart": [0.007, -0.03763, 0.0028], "localEnd": [0.00315, -0.0696, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.00812, "endRadius": 0.00666, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_middle_r_1_46 = makeAttachmentEndpoint(attachment_middle_r_1_46);
  const node_middle_r_1_46 = new THREE.Group();
  node_middle_r_1_46.name = "Middle R phalanx 1__pivot";
  node_middle_r_1_46.scale.set(1, 1, 1);
  if (endpoint_middle_r_1_46) {
    node_middle_r_1_46.position.copy(endpoint_middle_r_1_46.start);
    node_middle_r_1_46.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_middle_r_1_46.position.set(0.007000000000000006, -0.037632, 0.0028000000000000004);
    node_middle_r_1_46.rotation.set(0.0, 0.0, 0.0);
  }
  node_middle_r_1_46.userData.sculptComponent = {"id": "middle-r-1", "name": "Middle R phalanx 1", "level": "micro", "role": "finger", "importance": 0.3, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Middle R phalanx 1 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-r", "attachment": {"parentSocket": "hand-r-middle-1", "localStart": [0.007, -0.03763, 0.0028], "localEnd": [0.00315, -0.0696, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.00812, "endRadius": 0.00666, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.01624, "height": 0.032200000000000006, "depth": 0.01624, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.007000000000000006, -0.037632, 0.0028000000000000004], "rotation": [0.0, 0.0, 0.0], "scale": [0.01624, 0.032200000000000006, 0.01624]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "middle-r-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_middle_r_1_46.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "middle-r-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["hand-r"] ?? root).add(node_middle_r_1_46);
  nodes["middle-r-1"] = node_middle_r_1_46;
  const mesh_middle_r_1_46Geometry = endpoint_middle_r_1_46
    ? new THREE.CylinderGeometry(endpoint_middle_r_1_46.endRadius, endpoint_middle_r_1_46.baseRadius, endpoint_middle_r_1_46.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_middle_r_1_46) {
    mesh_middle_r_1_46Geometry.scale(0.01624, 0.032200000000000006, 0.01624);
  }
  const mesh_middle_r_1_46 = new THREE.Mesh(
    mesh_middle_r_1_46Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_middle_r_1_46.name = "Middle R phalanx 1";
  if (endpoint_middle_r_1_46) {
    mesh_middle_r_1_46.position.copy(endpoint_middle_r_1_46.midpoint);
    mesh_middle_r_1_46.quaternion.copy(endpoint_middle_r_1_46.quaternion);
  }
  mesh_middle_r_1_46.castShadow = options.castShadow ?? true;
  mesh_middle_r_1_46.receiveShadow = options.receiveShadow ?? true;
  mesh_middle_r_1_46.userData.sculptComponent = {"id": "middle-r-1", "name": "Middle R phalanx 1", "level": "micro", "role": "finger", "importance": 0.3, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Middle R phalanx 1 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-r", "attachment": {"parentSocket": "hand-r-middle-1", "localStart": [0.007, -0.03763, 0.0028], "localEnd": [0.00315, -0.0696, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.00812, "endRadius": 0.00666, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.01624, "height": 0.032200000000000006, "depth": 0.01624, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.007000000000000006, -0.037632, 0.0028000000000000004], "rotation": [0.0, 0.0, 0.0], "scale": [0.01624, 0.032200000000000006, 0.01624]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "middle-r-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_middle_r_1_46.add(mesh_middle_r_1_46);
  meshes["middle-r-1"] = mesh_middle_r_1_46;
  colliders["middle-r-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["middle-r-1"] ??= [];
  destructionGroups["middle-r-1"].push(node_middle_r_1_46);

  const attachment_middle_r_2_47 = {"parentSocket": "middle-r-1-middle-2", "localStart": [-0.00385, -0.03197, 0.0], "localEnd": [-0.00654, -0.05421, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00812, "endRadius": 0.00666, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_middle_r_2_47 = makeAttachmentEndpoint(attachment_middle_r_2_47);
  const node_middle_r_2_47 = new THREE.Group();
  node_middle_r_2_47.name = "Middle R phalanx 2__pivot";
  node_middle_r_2_47.scale.set(1, 1, 1);
  if (endpoint_middle_r_2_47) {
    node_middle_r_2_47.position.copy(endpoint_middle_r_2_47.start);
    node_middle_r_2_47.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_middle_r_2_47.position.set(-0.003854733074703187, -0.03196843807449448, 0.0);
    node_middle_r_2_47.rotation.set(0.0, 0.0, 0.0);
  }
  node_middle_r_2_47.userData.sculptComponent = {"id": "middle-r-2", "name": "Middle R phalanx 2", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Middle R phalanx 2 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "middle-r-1", "attachment": {"parentSocket": "middle-r-1-middle-2", "localStart": [-0.00385, -0.03197, 0.0], "localEnd": [-0.00654, -0.05421, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00812, "endRadius": 0.00666, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.01624, "height": 0.022400000000000003, "depth": 0.01624, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.003854733074703187, -0.03196843807449448, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.01624, 0.022400000000000003, 0.01624]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "middle-r-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_middle_r_2_47.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "middle-r-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["middle-r-1"] ?? root).add(node_middle_r_2_47);
  nodes["middle-r-2"] = node_middle_r_2_47;
  const mesh_middle_r_2_47Geometry = endpoint_middle_r_2_47
    ? new THREE.CylinderGeometry(endpoint_middle_r_2_47.endRadius, endpoint_middle_r_2_47.baseRadius, endpoint_middle_r_2_47.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_middle_r_2_47) {
    mesh_middle_r_2_47Geometry.scale(0.01624, 0.022400000000000003, 0.01624);
  }
  const mesh_middle_r_2_47 = new THREE.Mesh(
    mesh_middle_r_2_47Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_middle_r_2_47.name = "Middle R phalanx 2";
  if (endpoint_middle_r_2_47) {
    mesh_middle_r_2_47.position.copy(endpoint_middle_r_2_47.midpoint);
    mesh_middle_r_2_47.quaternion.copy(endpoint_middle_r_2_47.quaternion);
  }
  mesh_middle_r_2_47.castShadow = options.castShadow ?? true;
  mesh_middle_r_2_47.receiveShadow = options.receiveShadow ?? true;
  mesh_middle_r_2_47.userData.sculptComponent = {"id": "middle-r-2", "name": "Middle R phalanx 2", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Middle R phalanx 2 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "middle-r-1", "attachment": {"parentSocket": "middle-r-1-middle-2", "localStart": [-0.00385, -0.03197, 0.0], "localEnd": [-0.00654, -0.05421, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00812, "endRadius": 0.00666, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.01624, "height": 0.022400000000000003, "depth": 0.01624, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.003854733074703187, -0.03196843807449448, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.01624, 0.022400000000000003, 0.01624]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "middle-r-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_middle_r_2_47.add(mesh_middle_r_2_47);
  meshes["middle-r-2"] = mesh_middle_r_2_47;
  colliders["middle-r-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["middle-r-2"] ??= [];
  destructionGroups["middle-r-2"].push(node_middle_r_2_47);

  const attachment_middle_r_3_48 = {"parentSocket": "middle-r-2-middle-3", "localStart": [-0.00268, -0.02224, 0.0], "localEnd": [-0.00436, -0.03614, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00812, "endRadius": 0.00666, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_middle_r_3_48 = makeAttachmentEndpoint(attachment_middle_r_3_48);
  const node_middle_r_3_48 = new THREE.Group();
  node_middle_r_3_48.name = "Middle R phalanx 3__pivot";
  node_middle_r_3_48.scale.set(1, 1, 1);
  if (endpoint_middle_r_3_48) {
    node_middle_r_3_48.position.copy(endpoint_middle_r_3_48.start);
    node_middle_r_3_48.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_middle_r_3_48.position.set(-0.0026815534432718113, -0.022238913443126618, 0.0);
    node_middle_r_3_48.rotation.set(0.0, 0.0, 0.0);
  }
  node_middle_r_3_48.userData.sculptComponent = {"id": "middle-r-3", "name": "Middle R phalanx 3", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Middle R phalanx 3 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "middle-r-2", "attachment": {"parentSocket": "middle-r-2-middle-3", "localStart": [-0.00268, -0.02224, 0.0], "localEnd": [-0.00436, -0.03614, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00812, "endRadius": 0.00666, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.01624, "height": 0.014000000000000002, "depth": 0.01624, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.0026815534432718113, -0.022238913443126618, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.01624, 0.014000000000000002, 0.01624]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "middle-r-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_middle_r_3_48.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "middle-r-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["middle-r-2"] ?? root).add(node_middle_r_3_48);
  nodes["middle-r-3"] = node_middle_r_3_48;
  const mesh_middle_r_3_48Geometry = endpoint_middle_r_3_48
    ? new THREE.CylinderGeometry(endpoint_middle_r_3_48.endRadius, endpoint_middle_r_3_48.baseRadius, endpoint_middle_r_3_48.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_middle_r_3_48) {
    mesh_middle_r_3_48Geometry.scale(0.01624, 0.014000000000000002, 0.01624);
  }
  const mesh_middle_r_3_48 = new THREE.Mesh(
    mesh_middle_r_3_48Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_middle_r_3_48.name = "Middle R phalanx 3";
  if (endpoint_middle_r_3_48) {
    mesh_middle_r_3_48.position.copy(endpoint_middle_r_3_48.midpoint);
    mesh_middle_r_3_48.quaternion.copy(endpoint_middle_r_3_48.quaternion);
  }
  mesh_middle_r_3_48.castShadow = options.castShadow ?? true;
  mesh_middle_r_3_48.receiveShadow = options.receiveShadow ?? true;
  mesh_middle_r_3_48.userData.sculptComponent = {"id": "middle-r-3", "name": "Middle R phalanx 3", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Middle R phalanx 3 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "middle-r-2", "attachment": {"parentSocket": "middle-r-2-middle-3", "localStart": [-0.00268, -0.02224, 0.0], "localEnd": [-0.00436, -0.03614, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00812, "endRadius": 0.00666, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.01624, "height": 0.014000000000000002, "depth": 0.01624, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.0026815534432718113, -0.022238913443126618, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.01624, 0.014000000000000002, 0.01624]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "middle-r-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_middle_r_3_48.add(mesh_middle_r_3_48);
  meshes["middle-r-3"] = mesh_middle_r_3_48;
  colliders["middle-r-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["middle-r-3"] ??= [];
  destructionGroups["middle-r-3"].push(node_middle_r_3_48);

  const attachment_ring_r_1_49 = {"parentSocket": "hand-r-ring-1", "localStart": [-0.007, -0.03763, 0.0028], "localEnd": [-0.01052, -0.06682, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.00756, "endRadius": 0.0062, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_ring_r_1_49 = makeAttachmentEndpoint(attachment_ring_r_1_49);
  const node_ring_r_1_49 = new THREE.Group();
  node_ring_r_1_49.name = "Ring R phalanx 1__pivot";
  node_ring_r_1_49.scale.set(1, 1, 1);
  if (endpoint_ring_r_1_49) {
    node_ring_r_1_49.position.copy(endpoint_ring_r_1_49.start);
    node_ring_r_1_49.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_ring_r_1_49.position.set(-0.007000000000000006, -0.037632, 0.0028000000000000004);
    node_ring_r_1_49.rotation.set(0.0, 0.0, 0.0);
  }
  node_ring_r_1_49.userData.sculptComponent = {"id": "ring-r-1", "name": "Ring R phalanx 1", "level": "micro", "role": "finger", "importance": 0.3, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Ring R phalanx 1 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-r", "attachment": {"parentSocket": "hand-r-ring-1", "localStart": [-0.007, -0.03763, 0.0028], "localEnd": [-0.01052, -0.06682, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.00756, "endRadius": 0.0062, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.015120000000000001, "height": 0.029400000000000003, "depth": 0.015120000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.007000000000000006, -0.037632, 0.0028000000000000004], "rotation": [0.0, 0.0, 0.0], "scale": [0.015120000000000001, 0.029400000000000003, 0.015120000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ring-r-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_ring_r_1_49.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ring-r-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["hand-r"] ?? root).add(node_ring_r_1_49);
  nodes["ring-r-1"] = node_ring_r_1_49;
  const mesh_ring_r_1_49Geometry = endpoint_ring_r_1_49
    ? new THREE.CylinderGeometry(endpoint_ring_r_1_49.endRadius, endpoint_ring_r_1_49.baseRadius, endpoint_ring_r_1_49.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_ring_r_1_49) {
    mesh_ring_r_1_49Geometry.scale(0.015120000000000001, 0.029400000000000003, 0.015120000000000001);
  }
  const mesh_ring_r_1_49 = new THREE.Mesh(
    mesh_ring_r_1_49Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ring_r_1_49.name = "Ring R phalanx 1";
  if (endpoint_ring_r_1_49) {
    mesh_ring_r_1_49.position.copy(endpoint_ring_r_1_49.midpoint);
    mesh_ring_r_1_49.quaternion.copy(endpoint_ring_r_1_49.quaternion);
  }
  mesh_ring_r_1_49.castShadow = options.castShadow ?? true;
  mesh_ring_r_1_49.receiveShadow = options.receiveShadow ?? true;
  mesh_ring_r_1_49.userData.sculptComponent = {"id": "ring-r-1", "name": "Ring R phalanx 1", "level": "micro", "role": "finger", "importance": 0.3, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Ring R phalanx 1 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-r", "attachment": {"parentSocket": "hand-r-ring-1", "localStart": [-0.007, -0.03763, 0.0028], "localEnd": [-0.01052, -0.06682, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.00756, "endRadius": 0.0062, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.015120000000000001, "height": 0.029400000000000003, "depth": 0.015120000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.007000000000000006, -0.037632, 0.0028000000000000004], "rotation": [0.0, 0.0, 0.0], "scale": [0.015120000000000001, 0.029400000000000003, 0.015120000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ring-r-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_ring_r_1_49.add(mesh_ring_r_1_49);
  meshes["ring-r-1"] = mesh_ring_r_1_49;
  colliders["ring-r-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["ring-r-1"] ??= [];
  destructionGroups["ring-r-1"].push(node_ring_r_1_49);

  const attachment_ring_r_2_50 = {"parentSocket": "ring-r-1-ring-2", "localStart": [-0.00352, -0.02919, 0.0], "localEnd": [-0.00593, -0.0492, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00756, "endRadius": 0.0062, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_ring_r_2_50 = makeAttachmentEndpoint(attachment_ring_r_2_50);
  const node_ring_r_2_50 = new THREE.Group();
  node_ring_r_2_50.name = "Ring R phalanx 2__pivot";
  node_ring_r_2_50.scale.set(1, 1, 1);
  if (endpoint_ring_r_2_50) {
    node_ring_r_2_50.position.copy(endpoint_ring_r_2_50.start);
    node_ring_r_2_50.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_ring_r_2_50.position.set(-0.0035195388942942385, -0.029188573894103675, 0.0);
    node_ring_r_2_50.rotation.set(0.0, 0.0, 0.0);
  }
  node_ring_r_2_50.userData.sculptComponent = {"id": "ring-r-2", "name": "Ring R phalanx 2", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Ring R phalanx 2 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "ring-r-1", "attachment": {"parentSocket": "ring-r-1-ring-2", "localStart": [-0.00352, -0.02919, 0.0], "localEnd": [-0.00593, -0.0492, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00756, "endRadius": 0.0062, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.015120000000000001, "height": 0.02016, "depth": 0.015120000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.0035195388942942385, -0.029188573894103675, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.015120000000000001, 0.02016, 0.015120000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ring-r-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_ring_r_2_50.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ring-r-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["ring-r-1"] ?? root).add(node_ring_r_2_50);
  nodes["ring-r-2"] = node_ring_r_2_50;
  const mesh_ring_r_2_50Geometry = endpoint_ring_r_2_50
    ? new THREE.CylinderGeometry(endpoint_ring_r_2_50.endRadius, endpoint_ring_r_2_50.baseRadius, endpoint_ring_r_2_50.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_ring_r_2_50) {
    mesh_ring_r_2_50Geometry.scale(0.015120000000000001, 0.02016, 0.015120000000000001);
  }
  const mesh_ring_r_2_50 = new THREE.Mesh(
    mesh_ring_r_2_50Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ring_r_2_50.name = "Ring R phalanx 2";
  if (endpoint_ring_r_2_50) {
    mesh_ring_r_2_50.position.copy(endpoint_ring_r_2_50.midpoint);
    mesh_ring_r_2_50.quaternion.copy(endpoint_ring_r_2_50.quaternion);
  }
  mesh_ring_r_2_50.castShadow = options.castShadow ?? true;
  mesh_ring_r_2_50.receiveShadow = options.receiveShadow ?? true;
  mesh_ring_r_2_50.userData.sculptComponent = {"id": "ring-r-2", "name": "Ring R phalanx 2", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Ring R phalanx 2 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "ring-r-1", "attachment": {"parentSocket": "ring-r-1-ring-2", "localStart": [-0.00352, -0.02919, 0.0], "localEnd": [-0.00593, -0.0492, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00756, "endRadius": 0.0062, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.015120000000000001, "height": 0.02016, "depth": 0.015120000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.0035195388942942385, -0.029188573894103675, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.015120000000000001, 0.02016, 0.015120000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ring-r-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_ring_r_2_50.add(mesh_ring_r_2_50);
  meshes["ring-r-2"] = mesh_ring_r_2_50;
  colliders["ring-r-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["ring-r-2"] ??= [];
  destructionGroups["ring-r-2"].push(node_ring_r_2_50);

  const attachment_ring_r_3_51 = {"parentSocket": "ring-r-2-ring-3", "localStart": [-0.00241, -0.02002, 0.0], "localEnd": [-0.00396, -0.0328, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00756, "endRadius": 0.0062, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_ring_r_3_51 = makeAttachmentEndpoint(attachment_ring_r_3_51);
  const node_ring_r_3_51 = new THREE.Group();
  node_ring_r_3_51.name = "Ring R phalanx 3__pivot";
  node_ring_r_3_51.scale.set(1, 1, 1);
  if (endpoint_ring_r_3_51) {
    node_ring_r_3_51.position.copy(endpoint_ring_r_3_51.start);
    node_ring_r_3_51.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_ring_r_3_51.position.set(-0.0024133980989446413, -0.020015022098813923, 0.0);
    node_ring_r_3_51.rotation.set(0.0, 0.0, 0.0);
  }
  node_ring_r_3_51.userData.sculptComponent = {"id": "ring-r-3", "name": "Ring R phalanx 3", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Ring R phalanx 3 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "ring-r-2", "attachment": {"parentSocket": "ring-r-2-ring-3", "localStart": [-0.00241, -0.02002, 0.0], "localEnd": [-0.00396, -0.0328, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00756, "endRadius": 0.0062, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.015120000000000001, "height": 0.01288, "depth": 0.015120000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.0024133980989446413, -0.020015022098813923, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.015120000000000001, 0.01288, 0.015120000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ring-r-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_ring_r_3_51.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ring-r-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["ring-r-2"] ?? root).add(node_ring_r_3_51);
  nodes["ring-r-3"] = node_ring_r_3_51;
  const mesh_ring_r_3_51Geometry = endpoint_ring_r_3_51
    ? new THREE.CylinderGeometry(endpoint_ring_r_3_51.endRadius, endpoint_ring_r_3_51.baseRadius, endpoint_ring_r_3_51.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_ring_r_3_51) {
    mesh_ring_r_3_51Geometry.scale(0.015120000000000001, 0.01288, 0.015120000000000001);
  }
  const mesh_ring_r_3_51 = new THREE.Mesh(
    mesh_ring_r_3_51Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ring_r_3_51.name = "Ring R phalanx 3";
  if (endpoint_ring_r_3_51) {
    mesh_ring_r_3_51.position.copy(endpoint_ring_r_3_51.midpoint);
    mesh_ring_r_3_51.quaternion.copy(endpoint_ring_r_3_51.quaternion);
  }
  mesh_ring_r_3_51.castShadow = options.castShadow ?? true;
  mesh_ring_r_3_51.receiveShadow = options.receiveShadow ?? true;
  mesh_ring_r_3_51.userData.sculptComponent = {"id": "ring-r-3", "name": "Ring R phalanx 3", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Ring R phalanx 3 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "ring-r-2", "attachment": {"parentSocket": "ring-r-2-ring-3", "localStart": [-0.00241, -0.02002, 0.0], "localEnd": [-0.00396, -0.0328, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00756, "endRadius": 0.0062, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.015120000000000001, "height": 0.01288, "depth": 0.015120000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.0024133980989446413, -0.020015022098813923, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.015120000000000001, 0.01288, 0.015120000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ring-r-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_ring_r_3_51.add(mesh_ring_r_3_51);
  meshes["ring-r-3"] = mesh_ring_r_3_51;
  colliders["ring-r-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["ring-r-3"] ??= [];
  destructionGroups["ring-r-3"].push(node_ring_r_3_51);

  const attachment_little_r_1_52 = {"parentSocket": "hand-r-little-1", "localStart": [-0.0196, -0.03763, 0.0028], "localEnd": [-0.02228, -0.05987, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.00672, "endRadius": 0.00551, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_little_r_1_52 = makeAttachmentEndpoint(attachment_little_r_1_52);
  const node_little_r_1_52 = new THREE.Group();
  node_little_r_1_52.name = "Little R phalanx 1__pivot";
  node_little_r_1_52.scale.set(1, 1, 1);
  if (endpoint_little_r_1_52) {
    node_little_r_1_52.position.copy(endpoint_little_r_1_52.start);
    node_little_r_1_52.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_little_r_1_52.position.set(-0.019600000000000006, -0.037632, 0.0028000000000000004);
    node_little_r_1_52.rotation.set(0.0, 0.0, 0.0);
  }
  node_little_r_1_52.userData.sculptComponent = {"id": "little-r-1", "name": "Little R phalanx 1", "level": "micro", "role": "finger", "importance": 0.3, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Little R phalanx 1 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-r", "attachment": {"parentSocket": "hand-r-little-1", "localStart": [-0.0196, -0.03763, 0.0028], "localEnd": [-0.02228, -0.05987, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.00672, "endRadius": 0.00551, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.013440000000000002, "height": 0.022400000000000003, "depth": 0.013440000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.019600000000000006, -0.037632, 0.0028000000000000004], "rotation": [0.0, 0.0, 0.0], "scale": [0.013440000000000002, 0.022400000000000003, 0.013440000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "little-r-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_little_r_1_52.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "little-r-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["hand-r"] ?? root).add(node_little_r_1_52);
  nodes["little-r-1"] = node_little_r_1_52;
  const mesh_little_r_1_52Geometry = endpoint_little_r_1_52
    ? new THREE.CylinderGeometry(endpoint_little_r_1_52.endRadius, endpoint_little_r_1_52.baseRadius, endpoint_little_r_1_52.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_little_r_1_52) {
    mesh_little_r_1_52Geometry.scale(0.013440000000000002, 0.022400000000000003, 0.013440000000000002);
  }
  const mesh_little_r_1_52 = new THREE.Mesh(
    mesh_little_r_1_52Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_little_r_1_52.name = "Little R phalanx 1";
  if (endpoint_little_r_1_52) {
    mesh_little_r_1_52.position.copy(endpoint_little_r_1_52.midpoint);
    mesh_little_r_1_52.quaternion.copy(endpoint_little_r_1_52.quaternion);
  }
  mesh_little_r_1_52.castShadow = options.castShadow ?? true;
  mesh_little_r_1_52.receiveShadow = options.receiveShadow ?? true;
  mesh_little_r_1_52.userData.sculptComponent = {"id": "little-r-1", "name": "Little R phalanx 1", "level": "micro", "role": "finger", "importance": 0.3, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Little R phalanx 1 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-r", "attachment": {"parentSocket": "hand-r-little-1", "localStart": [-0.0196, -0.03763, 0.0028], "localEnd": [-0.02228, -0.05987, 0.0028], "contactType": "rigid-weld", "baseRadius": 0.00672, "endRadius": 0.00551, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.013440000000000002, "height": 0.022400000000000003, "depth": 0.013440000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.019600000000000006, -0.037632, 0.0028000000000000004], "rotation": [0.0, 0.0, 0.0], "scale": [0.013440000000000002, 0.022400000000000003, 0.013440000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "little-r-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_little_r_1_52.add(mesh_little_r_1_52);
  meshes["little-r-1"] = mesh_little_r_1_52;
  colliders["little-r-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["little-r-1"] ??= [];
  destructionGroups["little-r-1"].push(node_little_r_1_52);

  const attachment_little_r_2_53 = {"parentSocket": "little-r-1-little-2", "localStart": [-0.00268, -0.02224, 0.0], "localEnd": [-0.00463, -0.03836, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00672, "endRadius": 0.00551, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_little_r_2_53 = makeAttachmentEndpoint(attachment_little_r_2_53);
  const node_little_r_2_53 = new THREE.Group();
  node_little_r_2_53.name = "Little R phalanx 2__pivot";
  node_little_r_2_53.scale.set(1, 1, 1);
  if (endpoint_little_r_2_53) {
    node_little_r_2_53.position.copy(endpoint_little_r_2_53.start);
    node_little_r_2_53.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_little_r_2_53.position.set(-0.0026815534432718113, -0.022238913443126618, 0.0);
    node_little_r_2_53.rotation.set(0.0, 0.0, 0.0);
  }
  node_little_r_2_53.userData.sculptComponent = {"id": "little-r-2", "name": "Little R phalanx 2", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Little R phalanx 2 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "little-r-1", "attachment": {"parentSocket": "little-r-1-little-2", "localStart": [-0.00268, -0.02224, 0.0], "localEnd": [-0.00463, -0.03836, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00672, "endRadius": 0.00551, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.013440000000000002, "height": 0.01624, "depth": 0.013440000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.0026815534432718113, -0.022238913443126618, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.013440000000000002, 0.01624, 0.013440000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "little-r-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_little_r_2_53.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "little-r-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["little-r-1"] ?? root).add(node_little_r_2_53);
  nodes["little-r-2"] = node_little_r_2_53;
  const mesh_little_r_2_53Geometry = endpoint_little_r_2_53
    ? new THREE.CylinderGeometry(endpoint_little_r_2_53.endRadius, endpoint_little_r_2_53.baseRadius, endpoint_little_r_2_53.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_little_r_2_53) {
    mesh_little_r_2_53Geometry.scale(0.013440000000000002, 0.01624, 0.013440000000000002);
  }
  const mesh_little_r_2_53 = new THREE.Mesh(
    mesh_little_r_2_53Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_little_r_2_53.name = "Little R phalanx 2";
  if (endpoint_little_r_2_53) {
    mesh_little_r_2_53.position.copy(endpoint_little_r_2_53.midpoint);
    mesh_little_r_2_53.quaternion.copy(endpoint_little_r_2_53.quaternion);
  }
  mesh_little_r_2_53.castShadow = options.castShadow ?? true;
  mesh_little_r_2_53.receiveShadow = options.receiveShadow ?? true;
  mesh_little_r_2_53.userData.sculptComponent = {"id": "little-r-2", "name": "Little R phalanx 2", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Little R phalanx 2 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "little-r-1", "attachment": {"parentSocket": "little-r-1-little-2", "localStart": [-0.00268, -0.02224, 0.0], "localEnd": [-0.00463, -0.03836, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00672, "endRadius": 0.00551, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.013440000000000002, "height": 0.01624, "depth": 0.013440000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.0026815534432718113, -0.022238913443126618, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.013440000000000002, 0.01624, 0.013440000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "little-r-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_little_r_2_53.add(mesh_little_r_2_53);
  meshes["little-r-2"] = mesh_little_r_2_53;
  colliders["little-r-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["little-r-2"] ??= [];
  destructionGroups["little-r-2"].push(node_little_r_2_53);

  const attachment_little_r_3_54 = {"parentSocket": "little-r-2-little-3", "localStart": [-0.00194, -0.01612, 0.0], "localEnd": [-0.00322, -0.02669, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00672, "endRadius": 0.00551, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_little_r_3_54 = makeAttachmentEndpoint(attachment_little_r_3_54);
  const node_little_r_3_54 = new THREE.Group();
  node_little_r_3_54.name = "Little R phalanx 3__pivot";
  node_little_r_3_54.scale.set(1, 1, 1);
  if (endpoint_little_r_3_54) {
    node_little_r_3_54.position.copy(endpoint_little_r_3_54.start);
    node_little_r_3_54.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_little_r_3_54.position.set(-0.0019441262463720244, -0.016123212246266783, 0.0);
    node_little_r_3_54.rotation.set(0.0, 0.0, 0.0);
  }
  node_little_r_3_54.userData.sculptComponent = {"id": "little-r-3", "name": "Little R phalanx 3", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Little R phalanx 3 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "little-r-2", "attachment": {"parentSocket": "little-r-2-little-3", "localStart": [-0.00194, -0.01612, 0.0], "localEnd": [-0.00322, -0.02669, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00672, "endRadius": 0.00551, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.013440000000000002, "height": 0.01064, "depth": 0.013440000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.0019441262463720244, -0.016123212246266783, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.013440000000000002, 0.01064, 0.013440000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "little-r-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_little_r_3_54.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "little-r-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["little-r-2"] ?? root).add(node_little_r_3_54);
  nodes["little-r-3"] = node_little_r_3_54;
  const mesh_little_r_3_54Geometry = endpoint_little_r_3_54
    ? new THREE.CylinderGeometry(endpoint_little_r_3_54.endRadius, endpoint_little_r_3_54.baseRadius, endpoint_little_r_3_54.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_little_r_3_54) {
    mesh_little_r_3_54Geometry.scale(0.013440000000000002, 0.01064, 0.013440000000000002);
  }
  const mesh_little_r_3_54 = new THREE.Mesh(
    mesh_little_r_3_54Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_little_r_3_54.name = "Little R phalanx 3";
  if (endpoint_little_r_3_54) {
    mesh_little_r_3_54.position.copy(endpoint_little_r_3_54.midpoint);
    mesh_little_r_3_54.quaternion.copy(endpoint_little_r_3_54.quaternion);
  }
  mesh_little_r_3_54.castShadow = options.castShadow ?? true;
  mesh_little_r_3_54.receiveShadow = options.receiveShadow ?? true;
  mesh_little_r_3_54.userData.sculptComponent = {"id": "little-r-3", "name": "Little R phalanx 3", "level": "micro", "role": "finger", "importance": 0.2, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Little R phalanx 3 is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "little-r-2", "attachment": {"parentSocket": "little-r-2-little-3", "localStart": [-0.00194, -0.01612, 0.0], "localEnd": [-0.00322, -0.02669, 0.0], "contactType": "hinge-joint", "baseRadius": 0.00672, "endRadius": 0.00551, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.013440000000000002, "height": 0.01064, "depth": 0.013440000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.0019441262463720244, -0.016123212246266783, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.013440000000000002, 0.01064, 0.013440000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "little-r-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_little_r_3_54.add(mesh_little_r_3_54);
  meshes["little-r-3"] = mesh_little_r_3_54;
  colliders["little-r-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["little-r-3"] ??= [];
  destructionGroups["little-r-3"].push(node_little_r_3_54);

  const attachment_thigh_l_55 = {"parentSocket": "pelvis-hip-l", "localStart": [0.12012, -0.10612, 0.0056], "localEnd": [0.12012, -0.52906, 0.0056], "contactType": "socket-joint", "baseRadius": 0.056, "endRadius": 0.0448, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_thigh_l_55 = makeAttachmentEndpoint(attachment_thigh_l_55);
  const node_thigh_l_55 = new THREE.Group();
  node_thigh_l_55.name = "Thigh L__pivot";
  node_thigh_l_55.scale.set(1, 1, 1);
  if (endpoint_thigh_l_55) {
    node_thigh_l_55.position.copy(endpoint_thigh_l_55.start);
    node_thigh_l_55.rotation.set(0.06981317007977318, 0.0, -0.06981317007977318);
  } else {
    node_thigh_l_55.position.set(0.12012, -0.10611999999999996, 0.005600000000000001);
    node_thigh_l_55.rotation.set(0.06981317007977318, 0.0, -0.06981317007977318);
  }
  node_thigh_l_55.userData.sculptComponent = {"id": "thigh-l", "name": "Thigh L", "level": "meso", "role": "leg", "importance": 0.75, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Thigh L is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "pelvis", "attachment": {"parentSocket": "pelvis-hip-l", "localStart": [0.12012, -0.10612, 0.0056], "localEnd": [0.12012, -0.52906, 0.0056], "contactType": "socket-joint", "baseRadius": 0.056, "endRadius": 0.0448, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.10640000000000001, "height": 0.4229400000000001, "depth": 0.10640000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.12012, -0.10611999999999996, 0.005600000000000001], "rotation": [0.06981317007977318, 0.0, -0.06981317007977318], "scale": [0.10640000000000001, 0.4229400000000001, 0.10640000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thigh-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "blue-cloth-material", "materialLayers": ["blue-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(54, 52, 111, 1)", "secondaryAlbedo": "rgba(23, 21, 58, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_thigh_l_55.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thigh-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["pelvis"] ?? root).add(node_thigh_l_55);
  nodes["thigh-l"] = node_thigh_l_55;
  const mesh_thigh_l_55Geometry = endpoint_thigh_l_55
    ? new THREE.CylinderGeometry(endpoint_thigh_l_55.endRadius, endpoint_thigh_l_55.baseRadius, endpoint_thigh_l_55.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_thigh_l_55) {
    mesh_thigh_l_55Geometry.scale(0.10640000000000001, 0.4229400000000001, 0.10640000000000001);
  }
  const mesh_thigh_l_55 = new THREE.Mesh(
    mesh_thigh_l_55Geometry,
    materialMap["blue-cloth-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_thigh_l_55.name = "Thigh L";
  if (endpoint_thigh_l_55) {
    mesh_thigh_l_55.position.copy(endpoint_thigh_l_55.midpoint);
    mesh_thigh_l_55.quaternion.copy(endpoint_thigh_l_55.quaternion);
  }
  mesh_thigh_l_55.castShadow = options.castShadow ?? true;
  mesh_thigh_l_55.receiveShadow = options.receiveShadow ?? true;
  mesh_thigh_l_55.userData.sculptComponent = {"id": "thigh-l", "name": "Thigh L", "level": "meso", "role": "leg", "importance": 0.75, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Thigh L is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "pelvis", "attachment": {"parentSocket": "pelvis-hip-l", "localStart": [0.12012, -0.10612, 0.0056], "localEnd": [0.12012, -0.52906, 0.0056], "contactType": "socket-joint", "baseRadius": 0.056, "endRadius": 0.0448, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.10640000000000001, "height": 0.4229400000000001, "depth": 0.10640000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.12012, -0.10611999999999996, 0.005600000000000001], "rotation": [0.06981317007977318, 0.0, -0.06981317007977318], "scale": [0.10640000000000001, 0.4229400000000001, 0.10640000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thigh-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "blue-cloth-material", "materialLayers": ["blue-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(54, 52, 111, 1)", "secondaryAlbedo": "rgba(23, 21, 58, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_thigh_l_55.add(mesh_thigh_l_55);
  meshes["thigh-l"] = mesh_thigh_l_55;
  colliders["thigh-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["thigh-l"] ??= [];
  destructionGroups["thigh-l"].push(node_thigh_l_55);

  const attachment_shin_l_56 = {"parentSocket": "thigh-knee-l", "localStart": [0.0, -0.42294, 0.0], "localEnd": [0.0, -0.798, -0.0056], "contactType": "hinge-joint", "baseRadius": 0.0392, "endRadius": 0.028, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_shin_l_56 = makeAttachmentEndpoint(attachment_shin_l_56);
  const node_shin_l_56 = new THREE.Group();
  node_shin_l_56.name = "Shin L__pivot";
  node_shin_l_56.scale.set(1, 1, 1);
  if (endpoint_shin_l_56) {
    node_shin_l_56.position.copy(endpoint_shin_l_56.start);
    node_shin_l_56.rotation.set(0.06981317007977318, 0.0, 0.0);
  } else {
    node_shin_l_56.position.set(0.0, -0.4229400000000001, 0.0);
    node_shin_l_56.rotation.set(0.06981317007977318, 0.0, 0.0);
  }
  node_shin_l_56.userData.sculptComponent = {"id": "shin-l", "name": "Shin L", "level": "meso", "role": "leg", "importance": 0.7, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Shin L is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "thigh-l", "attachment": {"parentSocket": "thigh-knee-l", "localStart": [0.0, -0.42294, 0.0], "localEnd": [0.0, -0.798, -0.0056], "contactType": "hinge-joint", "baseRadius": 0.0392, "endRadius": 0.028, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.07840000000000001, "height": 0.37506000000000006, "depth": 0.07840000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.4229400000000001, 0.0], "rotation": [0.06981317007977318, 0.0, 0.0], "scale": [0.07840000000000001, 0.37506000000000006, 0.07840000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shin-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "blue-cloth-material", "materialLayers": ["blue-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(54, 52, 111, 1)", "secondaryAlbedo": "rgba(23, 21, 58, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_shin_l_56.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shin-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["thigh-l"] ?? root).add(node_shin_l_56);
  nodes["shin-l"] = node_shin_l_56;
  const mesh_shin_l_56Geometry = endpoint_shin_l_56
    ? new THREE.CylinderGeometry(endpoint_shin_l_56.endRadius, endpoint_shin_l_56.baseRadius, endpoint_shin_l_56.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_shin_l_56) {
    mesh_shin_l_56Geometry.scale(0.07840000000000001, 0.37506000000000006, 0.07840000000000001);
  }
  const mesh_shin_l_56 = new THREE.Mesh(
    mesh_shin_l_56Geometry,
    materialMap["blue-cloth-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shin_l_56.name = "Shin L";
  if (endpoint_shin_l_56) {
    mesh_shin_l_56.position.copy(endpoint_shin_l_56.midpoint);
    mesh_shin_l_56.quaternion.copy(endpoint_shin_l_56.quaternion);
  }
  mesh_shin_l_56.castShadow = options.castShadow ?? true;
  mesh_shin_l_56.receiveShadow = options.receiveShadow ?? true;
  mesh_shin_l_56.userData.sculptComponent = {"id": "shin-l", "name": "Shin L", "level": "meso", "role": "leg", "importance": 0.7, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Shin L is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "thigh-l", "attachment": {"parentSocket": "thigh-knee-l", "localStart": [0.0, -0.42294, 0.0], "localEnd": [0.0, -0.798, -0.0056], "contactType": "hinge-joint", "baseRadius": 0.0392, "endRadius": 0.028, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.07840000000000001, "height": 0.37506000000000006, "depth": 0.07840000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.4229400000000001, 0.0], "rotation": [0.06981317007977318, 0.0, 0.0], "scale": [0.07840000000000001, 0.37506000000000006, 0.07840000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shin-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "blue-cloth-material", "materialLayers": ["blue-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(54, 52, 111, 1)", "secondaryAlbedo": "rgba(23, 21, 58, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_shin_l_56.add(mesh_shin_l_56);
  meshes["shin-l"] = mesh_shin_l_56;
  colliders["shin-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["shin-l"] ??= [];
  destructionGroups["shin-l"].push(node_shin_l_56);

  const endpoint_foot_l_57 = makeAttachmentEndpoint(null);
  const node_foot_l_57 = new THREE.Group();
  node_foot_l_57.name = "Foot L__pivot";
  node_foot_l_57.scale.set(1, 1, 1);
  if (endpoint_foot_l_57) {
    node_foot_l_57.position.copy(endpoint_foot_l_57.start);
    node_foot_l_57.rotation.set(-0.05235987755982989, 0.0, -0.08726646259971647);
  } else {
    node_foot_l_57.position.set(0.0, -0.3890600000000001, 0.039200000000000006);
    node_foot_l_57.rotation.set(-0.05235987755982989, 0.0, -0.08726646259971647);
  }
  node_foot_l_57.userData.sculptComponent = {"id": "foot-l", "name": "Foot L", "level": "meso", "role": "foot", "importance": 0.5, "confidence": 0.64, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Foot L is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "shin-l", "attachment": null, "dimensions": {"width": 0.06720000000000001, "height": 0.044800000000000006, "depth": 0.12320000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.3890600000000001, 0.039200000000000006], "rotation": [-0.05235987755982989, 0.0, -0.08726646259971647], "scale": [0.06720000000000001, 0.044800000000000006, 0.12320000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "foot-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shoes"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_foot_l_57.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "foot-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shoes"}};
  (nodes["shin-l"] ?? root).add(node_foot_l_57);
  nodes["foot-l"] = node_foot_l_57;
  const mesh_foot_l_57Geometry = endpoint_foot_l_57
    ? new THREE.CylinderGeometry(endpoint_foot_l_57.endRadius, endpoint_foot_l_57.baseRadius, endpoint_foot_l_57.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_foot_l_57) {
    mesh_foot_l_57Geometry.scale(0.06720000000000001, 0.044800000000000006, 0.12320000000000002);
  }
  const mesh_foot_l_57 = new THREE.Mesh(
    mesh_foot_l_57Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_foot_l_57.name = "Foot L";
  if (endpoint_foot_l_57) {
    mesh_foot_l_57.position.copy(endpoint_foot_l_57.midpoint);
    mesh_foot_l_57.quaternion.copy(endpoint_foot_l_57.quaternion);
  }
  mesh_foot_l_57.castShadow = options.castShadow ?? true;
  mesh_foot_l_57.receiveShadow = options.receiveShadow ?? true;
  mesh_foot_l_57.userData.sculptComponent = {"id": "foot-l", "name": "Foot L", "level": "meso", "role": "foot", "importance": 0.5, "confidence": 0.64, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Foot L is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "shin-l", "attachment": null, "dimensions": {"width": 0.06720000000000001, "height": 0.044800000000000006, "depth": 0.12320000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.3890600000000001, 0.039200000000000006], "rotation": [-0.05235987755982989, 0.0, -0.08726646259971647], "scale": [0.06720000000000001, 0.044800000000000006, 0.12320000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "foot-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shoes"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_foot_l_57.add(mesh_foot_l_57);
  meshes["foot-l"] = mesh_foot_l_57;
  colliders["foot-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["foot-l"] ??= [];
  destructionGroups["foot-l"].push(node_foot_l_57);

  const attachment_thigh_r_58 = {"parentSocket": "pelvis-hip-r", "localStart": [-0.12012, -0.10612, 0.0056], "localEnd": [-0.12012, -0.52906, 0.0056], "contactType": "socket-joint", "baseRadius": 0.056, "endRadius": 0.0448, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_thigh_r_58 = makeAttachmentEndpoint(attachment_thigh_r_58);
  const node_thigh_r_58 = new THREE.Group();
  node_thigh_r_58.name = "Thigh R__pivot";
  node_thigh_r_58.scale.set(1, 1, 1);
  if (endpoint_thigh_r_58) {
    node_thigh_r_58.position.copy(endpoint_thigh_r_58.start);
    node_thigh_r_58.rotation.set(-0.12217304763960307, 0.0, 0.08726646259971647);
  } else {
    node_thigh_r_58.position.set(-0.12012, -0.10611999999999996, 0.005600000000000001);
    node_thigh_r_58.rotation.set(-0.12217304763960307, 0.0, 0.08726646259971647);
  }
  node_thigh_r_58.userData.sculptComponent = {"id": "thigh-r", "name": "Thigh R", "level": "meso", "role": "leg", "importance": 0.75, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Thigh R is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "pelvis", "attachment": {"parentSocket": "pelvis-hip-r", "localStart": [-0.12012, -0.10612, 0.0056], "localEnd": [-0.12012, -0.52906, 0.0056], "contactType": "socket-joint", "baseRadius": 0.056, "endRadius": 0.0448, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.10640000000000001, "height": 0.4229400000000001, "depth": 0.10640000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.12012, -0.10611999999999996, 0.005600000000000001], "rotation": [-0.12217304763960307, 0.0, 0.08726646259971647], "scale": [0.10640000000000001, 0.4229400000000001, 0.10640000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thigh-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "blue-cloth-material", "materialLayers": ["blue-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(54, 52, 111, 1)", "secondaryAlbedo": "rgba(23, 21, 58, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_thigh_r_58.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thigh-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["pelvis"] ?? root).add(node_thigh_r_58);
  nodes["thigh-r"] = node_thigh_r_58;
  const mesh_thigh_r_58Geometry = endpoint_thigh_r_58
    ? new THREE.CylinderGeometry(endpoint_thigh_r_58.endRadius, endpoint_thigh_r_58.baseRadius, endpoint_thigh_r_58.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_thigh_r_58) {
    mesh_thigh_r_58Geometry.scale(0.10640000000000001, 0.4229400000000001, 0.10640000000000001);
  }
  const mesh_thigh_r_58 = new THREE.Mesh(
    mesh_thigh_r_58Geometry,
    materialMap["blue-cloth-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_thigh_r_58.name = "Thigh R";
  if (endpoint_thigh_r_58) {
    mesh_thigh_r_58.position.copy(endpoint_thigh_r_58.midpoint);
    mesh_thigh_r_58.quaternion.copy(endpoint_thigh_r_58.quaternion);
  }
  mesh_thigh_r_58.castShadow = options.castShadow ?? true;
  mesh_thigh_r_58.receiveShadow = options.receiveShadow ?? true;
  mesh_thigh_r_58.userData.sculptComponent = {"id": "thigh-r", "name": "Thigh R", "level": "meso", "role": "leg", "importance": 0.75, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Thigh R is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "pelvis", "attachment": {"parentSocket": "pelvis-hip-r", "localStart": [-0.12012, -0.10612, 0.0056], "localEnd": [-0.12012, -0.52906, 0.0056], "contactType": "socket-joint", "baseRadius": 0.056, "endRadius": 0.0448, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.10640000000000001, "height": 0.4229400000000001, "depth": 0.10640000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [-0.12012, -0.10611999999999996, 0.005600000000000001], "rotation": [-0.12217304763960307, 0.0, 0.08726646259971647], "scale": [0.10640000000000001, 0.4229400000000001, 0.10640000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "thigh-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "blue-cloth-material", "materialLayers": ["blue-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(54, 52, 111, 1)", "secondaryAlbedo": "rgba(23, 21, 58, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_thigh_r_58.add(mesh_thigh_r_58);
  meshes["thigh-r"] = mesh_thigh_r_58;
  colliders["thigh-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["thigh-r"] ??= [];
  destructionGroups["thigh-r"].push(node_thigh_r_58);

  const attachment_shin_r_59 = {"parentSocket": "thigh-knee-r", "localStart": [0.0, -0.42294, 0.0], "localEnd": [0.0, -0.798, -0.0056], "contactType": "hinge-joint", "baseRadius": 0.0392, "endRadius": 0.028, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_shin_r_59 = makeAttachmentEndpoint(attachment_shin_r_59);
  const node_shin_r_59 = new THREE.Group();
  node_shin_r_59.name = "Shin R__pivot";
  node_shin_r_59.scale.set(1, 1, 1);
  if (endpoint_shin_r_59) {
    node_shin_r_59.position.copy(endpoint_shin_r_59.start);
    node_shin_r_59.rotation.set(0.12217304763960307, 0.0, 0.0);
  } else {
    node_shin_r_59.position.set(0.0, -0.4229400000000001, 0.0);
    node_shin_r_59.rotation.set(0.12217304763960307, 0.0, 0.0);
  }
  node_shin_r_59.userData.sculptComponent = {"id": "shin-r", "name": "Shin R", "level": "meso", "role": "leg", "importance": 0.7, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Shin R is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "thigh-r", "attachment": {"parentSocket": "thigh-knee-r", "localStart": [0.0, -0.42294, 0.0], "localEnd": [0.0, -0.798, -0.0056], "contactType": "hinge-joint", "baseRadius": 0.0392, "endRadius": 0.028, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.07840000000000001, "height": 0.37506000000000006, "depth": 0.07840000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.4229400000000001, 0.0], "rotation": [0.12217304763960307, 0.0, 0.0], "scale": [0.07840000000000001, 0.37506000000000006, 0.07840000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shin-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "blue-cloth-material", "materialLayers": ["blue-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(54, 52, 111, 1)", "secondaryAlbedo": "rgba(23, 21, 58, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_shin_r_59.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shin-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["thigh-r"] ?? root).add(node_shin_r_59);
  nodes["shin-r"] = node_shin_r_59;
  const mesh_shin_r_59Geometry = endpoint_shin_r_59
    ? new THREE.CylinderGeometry(endpoint_shin_r_59.endRadius, endpoint_shin_r_59.baseRadius, endpoint_shin_r_59.length, 32, 12)
    : buildWatertightCapsule(0.35, 0.7, 16, 32, 1);
  if (!endpoint_shin_r_59) {
    mesh_shin_r_59Geometry.scale(0.07840000000000001, 0.37506000000000006, 0.07840000000000001);
  }
  const mesh_shin_r_59 = new THREE.Mesh(
    mesh_shin_r_59Geometry,
    materialMap["blue-cloth-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shin_r_59.name = "Shin R";
  if (endpoint_shin_r_59) {
    mesh_shin_r_59.position.copy(endpoint_shin_r_59.midpoint);
    mesh_shin_r_59.quaternion.copy(endpoint_shin_r_59.quaternion);
  }
  mesh_shin_r_59.castShadow = options.castShadow ?? true;
  mesh_shin_r_59.receiveShadow = options.receiveShadow ?? true;
  mesh_shin_r_59.userData.sculptComponent = {"id": "shin-r", "name": "Shin R", "level": "meso", "role": "leg", "importance": 0.7, "confidence": 0.64, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Shin R is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "thigh-r", "attachment": {"parentSocket": "thigh-knee-r", "localStart": [0.0, -0.42294, 0.0], "localEnd": [0.0, -0.798, -0.0056], "contactType": "hinge-joint", "baseRadius": 0.0392, "endRadius": 0.028, "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.07840000000000001, "height": 0.37506000000000006, "depth": 0.07840000000000001, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.4229400000000001, 0.0], "rotation": [0.12217304763960307, 0.0, 0.0], "scale": [0.07840000000000001, 0.37506000000000006, 0.07840000000000001]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shin-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "blue-cloth-material", "materialLayers": ["blue-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(54, 52, 111, 1)", "secondaryAlbedo": "rgba(23, 21, 58, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_shin_r_59.add(mesh_shin_r_59);
  meshes["shin-r"] = mesh_shin_r_59;
  colliders["shin-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["shin-r"] ??= [];
  destructionGroups["shin-r"].push(node_shin_r_59);

  const endpoint_foot_r_60 = makeAttachmentEndpoint(null);
  const node_foot_r_60 = new THREE.Group();
  node_foot_r_60.name = "Foot R__pivot";
  node_foot_r_60.scale.set(1, 1, 1);
  if (endpoint_foot_r_60) {
    node_foot_r_60.position.copy(endpoint_foot_r_60.start);
    node_foot_r_60.rotation.set(0.03490658503988659, 0.0, 0.10471975511965978);
  } else {
    node_foot_r_60.position.set(0.0, -0.3890600000000001, 0.039200000000000006);
    node_foot_r_60.rotation.set(0.03490658503988659, 0.0, 0.10471975511965978);
  }
  node_foot_r_60.userData.sculptComponent = {"id": "foot-r", "name": "Foot R", "level": "meso", "role": "foot", "importance": 0.5, "confidence": 0.64, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Foot R is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "shin-r", "attachment": null, "dimensions": {"width": 0.06720000000000001, "height": 0.044800000000000006, "depth": 0.12320000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.3890600000000001, 0.039200000000000006], "rotation": [0.03490658503988659, 0.0, 0.10471975511965978], "scale": [0.06720000000000001, 0.044800000000000006, 0.12320000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "foot-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shoes"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_foot_r_60.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "foot-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shoes"}};
  (nodes["shin-r"] ?? root).add(node_foot_r_60);
  nodes["foot-r"] = node_foot_r_60;
  const mesh_foot_r_60Geometry = endpoint_foot_r_60
    ? new THREE.CylinderGeometry(endpoint_foot_r_60.endRadius, endpoint_foot_r_60.baseRadius, endpoint_foot_r_60.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_foot_r_60) {
    mesh_foot_r_60Geometry.scale(0.06720000000000001, 0.044800000000000006, 0.12320000000000002);
  }
  const mesh_foot_r_60 = new THREE.Mesh(
    mesh_foot_r_60Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_foot_r_60.name = "Foot R";
  if (endpoint_foot_r_60) {
    mesh_foot_r_60.position.copy(endpoint_foot_r_60.midpoint);
    mesh_foot_r_60.quaternion.copy(endpoint_foot_r_60.quaternion);
  }
  mesh_foot_r_60.castShadow = options.castShadow ?? true;
  mesh_foot_r_60.receiveShadow = options.receiveShadow ?? true;
  mesh_foot_r_60.userData.sculptComponent = {"id": "foot-r", "name": "Foot R", "level": "meso", "role": "foot", "importance": 0.5, "confidence": 0.64, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Foot R is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "shin-r", "attachment": null, "dimensions": {"width": 0.06720000000000001, "height": 0.044800000000000006, "depth": 0.12320000000000002, "units": "relative", "confidence": 0.8}, "transform": {"position": [0.0, -0.3890600000000001, 0.039200000000000006], "rotation": [0.03490658503988659, 0.0, 0.10471975511965978], "scale": [0.06720000000000001, 0.044800000000000006, 0.12320000000000002]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "foot-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shoes"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_foot_r_60.add(mesh_foot_r_60);
  meshes["foot-r"] = mesh_foot_r_60;
  colliders["foot-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["foot-r"] ??= [];
  destructionGroups["foot-r"].push(node_foot_r_60);

  const endpoint_scarf_61 = makeAttachmentEndpoint(null);
  const node_scarf_61 = new THREE.Group();
  node_scarf_61.name = "Red scarf__pivot";
  node_scarf_61.scale.set(1, 1, 1);
  if (endpoint_scarf_61) {
    node_scarf_61.position.copy(endpoint_scarf_61.start);
    node_scarf_61.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_scarf_61.position.set(0.0, -0.16099999999999995, 0.0);
    node_scarf_61.rotation.set(0.0, 0.0, 0.0);
  }
  node_scarf_61.userData.sculptComponent = {"id": "scarf", "name": "Red scarf", "level": "meso", "role": "cloth", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chest", "attachment": {"parentSocket": "chest-scarf", "localStart": [0, 0, 0], "localEnd": [0, 0.1, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.34, "height": 0.1, "depth": 0.24, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "red-cloth-material", "materialLayers": ["red-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "scarf.fold-ridges", "name": "scarf-fold-ridges", "kind": "ridge", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c1.png", "status": "specified-pending-render-confirmation"}, {"id": "scarf.tail-ribbons", "name": "scarf-tail-ribbons", "kind": "contour", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c2.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(146, 28, 36, 1)", "secondaryAlbedo": "rgba(68, 12, 19, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_scarf_61.userData.actionProfile = {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["chest"] ?? root).add(node_scarf_61);
  nodes["scarf"] = node_scarf_61;
  const mesh_scarf_61Geometry = endpoint_scarf_61
    ? new THREE.CylinderGeometry(endpoint_scarf_61.endRadius, endpoint_scarf_61.baseRadius, endpoint_scarf_61.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_scarf_61) {
    mesh_scarf_61Geometry.scale(0.38038, 0.24024, 0.3003);
  }
  const mesh_scarf_61 = new THREE.Mesh(
    mesh_scarf_61Geometry,
    materialMap["red-cloth-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_scarf_61.name = "Red scarf";
  if (endpoint_scarf_61) {
    mesh_scarf_61.position.copy(endpoint_scarf_61.midpoint);
    mesh_scarf_61.quaternion.copy(endpoint_scarf_61.quaternion);
  }
  mesh_scarf_61.castShadow = options.castShadow ?? true;
  mesh_scarf_61.receiveShadow = options.receiveShadow ?? true;
  mesh_scarf_61.userData.sculptComponent = {"id": "scarf", "name": "Red scarf", "level": "meso", "role": "cloth", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chest", "attachment": {"parentSocket": "chest-scarf", "localStart": [0, 0, 0], "localEnd": [0, 0.1, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.34, "height": 0.1, "depth": 0.24, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "red-cloth-material", "materialLayers": ["red-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "scarf.fold-ridges", "name": "scarf-fold-ridges", "kind": "ridge", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c1.png", "status": "specified-pending-render-confirmation"}, {"id": "scarf.tail-ribbons", "name": "scarf-tail-ribbons", "kind": "contour", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c2.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(146, 28, 36, 1)", "secondaryAlbedo": "rgba(68, 12, 19, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_scarf_61.add(mesh_scarf_61);
  meshes["scarf"] = mesh_scarf_61;
  colliders["scarf"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pelvis"] ??= [];
  destructionGroups["pelvis"].push(node_scarf_61);

  const endpoint_scarf_tail_l_62 = makeAttachmentEndpoint(null);
  const node_scarf_tail_l_62 = new THREE.Group();
  node_scarf_tail_l_62.name = "Left scarf tail__pivot";
  node_scarf_tail_l_62.scale.set(1, 1, 1);
  if (endpoint_scarf_tail_l_62) {
    node_scarf_tail_l_62.position.copy(endpoint_scarf_tail_l_62.start);
    node_scarf_tail_l_62.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_scarf_tail_l_62.position.set(0.0, -0.16099999999999995, 0.0);
    node_scarf_tail_l_62.rotation.set(0.0, 0.0, 0.0);
  }
  node_scarf_tail_l_62.userData.sculptComponent = {"id": "scarf-tail-l", "name": "Left scarf tail", "level": "meso", "role": "cloth", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "scarf", "attachment": {"parentSocket": "scarf-scarf-tail-l", "localStart": [0, 0, 0], "localEnd": [0, 0.31, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.09, "height": 0.31, "depth": 0.035, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "red-cloth-material", "materialLayers": ["red-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(146, 28, 36, 1)", "secondaryAlbedo": "rgba(68, 12, 19, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_scarf_tail_l_62.userData.actionProfile = {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["scarf"] ?? root).add(node_scarf_tail_l_62);
  nodes["scarf-tail-l"] = node_scarf_tail_l_62;
  const mesh_scarf_tail_l_62Geometry = endpoint_scarf_tail_l_62
    ? new THREE.CylinderGeometry(endpoint_scarf_tail_l_62.endRadius, endpoint_scarf_tail_l_62.baseRadius, endpoint_scarf_tail_l_62.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_scarf_tail_l_62) {
    mesh_scarf_tail_l_62Geometry.scale(0.38038, 0.24024, 0.3003);
  }
  const mesh_scarf_tail_l_62 = new THREE.Mesh(
    mesh_scarf_tail_l_62Geometry,
    materialMap["red-cloth-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_scarf_tail_l_62.name = "Left scarf tail";
  if (endpoint_scarf_tail_l_62) {
    mesh_scarf_tail_l_62.position.copy(endpoint_scarf_tail_l_62.midpoint);
    mesh_scarf_tail_l_62.quaternion.copy(endpoint_scarf_tail_l_62.quaternion);
  }
  mesh_scarf_tail_l_62.castShadow = options.castShadow ?? true;
  mesh_scarf_tail_l_62.receiveShadow = options.receiveShadow ?? true;
  mesh_scarf_tail_l_62.userData.sculptComponent = {"id": "scarf-tail-l", "name": "Left scarf tail", "level": "meso", "role": "cloth", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "scarf", "attachment": {"parentSocket": "scarf-scarf-tail-l", "localStart": [0, 0, 0], "localEnd": [0, 0.31, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.09, "height": 0.31, "depth": 0.035, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "red-cloth-material", "materialLayers": ["red-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(146, 28, 36, 1)", "secondaryAlbedo": "rgba(68, 12, 19, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_scarf_tail_l_62.add(mesh_scarf_tail_l_62);
  meshes["scarf-tail-l"] = mesh_scarf_tail_l_62;
  colliders["scarf-tail-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pelvis"] ??= [];
  destructionGroups["pelvis"].push(node_scarf_tail_l_62);

  const endpoint_scarf_tail_r_63 = makeAttachmentEndpoint(null);
  const node_scarf_tail_r_63 = new THREE.Group();
  node_scarf_tail_r_63.name = "Right scarf tail__pivot";
  node_scarf_tail_r_63.scale.set(1, 1, 1);
  if (endpoint_scarf_tail_r_63) {
    node_scarf_tail_r_63.position.copy(endpoint_scarf_tail_r_63.start);
    node_scarf_tail_r_63.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_scarf_tail_r_63.position.set(0.0, -0.16099999999999995, 0.0);
    node_scarf_tail_r_63.rotation.set(0.0, 0.0, 0.0);
  }
  node_scarf_tail_r_63.userData.sculptComponent = {"id": "scarf-tail-r", "name": "Right scarf tail", "level": "meso", "role": "cloth", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "scarf", "attachment": {"parentSocket": "scarf-scarf-tail-r", "localStart": [0, 0, 0], "localEnd": [0, 0.28, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.09, "height": 0.28, "depth": 0.035, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "red-cloth-material", "materialLayers": ["red-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(146, 28, 36, 1)", "secondaryAlbedo": "rgba(68, 12, 19, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_scarf_tail_r_63.userData.actionProfile = {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["scarf"] ?? root).add(node_scarf_tail_r_63);
  nodes["scarf-tail-r"] = node_scarf_tail_r_63;
  const mesh_scarf_tail_r_63Geometry = endpoint_scarf_tail_r_63
    ? new THREE.CylinderGeometry(endpoint_scarf_tail_r_63.endRadius, endpoint_scarf_tail_r_63.baseRadius, endpoint_scarf_tail_r_63.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_scarf_tail_r_63) {
    mesh_scarf_tail_r_63Geometry.scale(0.38038, 0.24024, 0.3003);
  }
  const mesh_scarf_tail_r_63 = new THREE.Mesh(
    mesh_scarf_tail_r_63Geometry,
    materialMap["red-cloth-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_scarf_tail_r_63.name = "Right scarf tail";
  if (endpoint_scarf_tail_r_63) {
    mesh_scarf_tail_r_63.position.copy(endpoint_scarf_tail_r_63.midpoint);
    mesh_scarf_tail_r_63.quaternion.copy(endpoint_scarf_tail_r_63.quaternion);
  }
  mesh_scarf_tail_r_63.castShadow = options.castShadow ?? true;
  mesh_scarf_tail_r_63.receiveShadow = options.receiveShadow ?? true;
  mesh_scarf_tail_r_63.userData.sculptComponent = {"id": "scarf-tail-r", "name": "Right scarf tail", "level": "meso", "role": "cloth", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "scarf", "attachment": {"parentSocket": "scarf-scarf-tail-r", "localStart": [0, 0, 0], "localEnd": [0, 0.28, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.09, "height": 0.28, "depth": 0.035, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "red-cloth-material", "materialLayers": ["red-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(146, 28, 36, 1)", "secondaryAlbedo": "rgba(68, 12, 19, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_scarf_tail_r_63.add(mesh_scarf_tail_r_63);
  meshes["scarf-tail-r"] = mesh_scarf_tail_r_63;
  colliders["scarf-tail-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pelvis"] ??= [];
  destructionGroups["pelvis"].push(node_scarf_tail_r_63);

  const endpoint_shoulder_trim_64 = makeAttachmentEndpoint(null);
  const node_shoulder_trim_64 = new THREE.Group();
  node_shoulder_trim_64.name = "White shoulder trim__pivot";
  node_shoulder_trim_64.scale.set(1, 1, 1);
  if (endpoint_shoulder_trim_64) {
    node_shoulder_trim_64.position.copy(endpoint_shoulder_trim_64.start);
    node_shoulder_trim_64.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shoulder_trim_64.position.set(0.0, -0.16099999999999995, 0.0);
    node_shoulder_trim_64.rotation.set(0.0, 0.0, 0.0);
  }
  node_shoulder_trim_64.userData.sculptComponent = {"id": "shoulder-trim", "name": "White shoulder trim", "level": "meso", "role": "cloth", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chest", "attachment": {"parentSocket": "chest-shoulder-trim", "localStart": [0, 0, 0], "localEnd": [0, 0.1, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.57, "height": 0.1, "depth": 0.25, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "white-trim-material", "materialLayers": ["white-trim-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "shoulder-trim.layered-tufts", "name": "shoulder-white-trim", "kind": "ridge", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c1.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(222, 220, 204, 1)", "secondaryAlbedo": "rgba(139, 135, 125, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_shoulder_trim_64.userData.actionProfile = {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["chest"] ?? root).add(node_shoulder_trim_64);
  nodes["shoulder-trim"] = node_shoulder_trim_64;
  const mesh_shoulder_trim_64Geometry = endpoint_shoulder_trim_64
    ? new THREE.CylinderGeometry(endpoint_shoulder_trim_64.endRadius, endpoint_shoulder_trim_64.baseRadius, endpoint_shoulder_trim_64.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_shoulder_trim_64) {
    mesh_shoulder_trim_64Geometry.scale(0.38038, 0.24024, 0.3003);
  }
  const mesh_shoulder_trim_64 = new THREE.Mesh(
    mesh_shoulder_trim_64Geometry,
    materialMap["white-trim-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shoulder_trim_64.name = "White shoulder trim";
  if (endpoint_shoulder_trim_64) {
    mesh_shoulder_trim_64.position.copy(endpoint_shoulder_trim_64.midpoint);
    mesh_shoulder_trim_64.quaternion.copy(endpoint_shoulder_trim_64.quaternion);
  }
  mesh_shoulder_trim_64.castShadow = options.castShadow ?? true;
  mesh_shoulder_trim_64.receiveShadow = options.receiveShadow ?? true;
  mesh_shoulder_trim_64.userData.sculptComponent = {"id": "shoulder-trim", "name": "White shoulder trim", "level": "meso", "role": "cloth", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "chest", "attachment": {"parentSocket": "chest-shoulder-trim", "localStart": [0, 0, 0], "localEnd": [0, 0.1, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.57, "height": 0.1, "depth": 0.25, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "white-trim-material", "materialLayers": ["white-trim-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "shoulder-trim.layered-tufts", "name": "shoulder-white-trim", "kind": "ridge", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c1.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(222, 220, 204, 1)", "secondaryAlbedo": "rgba(139, 135, 125, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_shoulder_trim_64.add(mesh_shoulder_trim_64);
  meshes["shoulder-trim"] = mesh_shoulder_trim_64;
  colliders["shoulder-trim"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pelvis"] ??= [];
  destructionGroups["pelvis"].push(node_shoulder_trim_64);

  const endpoint_pauldron_l_65 = makeAttachmentEndpoint(null);
  const node_pauldron_l_65 = new THREE.Group();
  node_pauldron_l_65.name = "Left pauldron__pivot";
  node_pauldron_l_65.scale.set(1, 1, 1);
  if (endpoint_pauldron_l_65) {
    node_pauldron_l_65.position.copy(endpoint_pauldron_l_65.start);
    node_pauldron_l_65.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pauldron_l_65.position.set(0.0, -0.16099999999999995, 0.0);
    node_pauldron_l_65.rotation.set(0.0, 0.0, 0.0);
  }
  node_pauldron_l_65.userData.sculptComponent = {"id": "pauldron-l", "name": "Left pauldron", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "clavicle-l", "attachment": {"parentSocket": "clavicle-l-pauldron-l", "localStart": [0, 0, 0], "localEnd": [0, 0.18, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.2, "height": 0.18, "depth": 0.2, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_pauldron_l_65.userData.actionProfile = {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["clavicle-l"] ?? root).add(node_pauldron_l_65);
  nodes["pauldron-l"] = node_pauldron_l_65;
  const mesh_pauldron_l_65Geometry = endpoint_pauldron_l_65
    ? new THREE.CylinderGeometry(endpoint_pauldron_l_65.endRadius, endpoint_pauldron_l_65.baseRadius, endpoint_pauldron_l_65.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_pauldron_l_65) {
    mesh_pauldron_l_65Geometry.scale(0.38038, 0.24024, 0.3003);
  }
  const mesh_pauldron_l_65 = new THREE.Mesh(
    mesh_pauldron_l_65Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pauldron_l_65.name = "Left pauldron";
  if (endpoint_pauldron_l_65) {
    mesh_pauldron_l_65.position.copy(endpoint_pauldron_l_65.midpoint);
    mesh_pauldron_l_65.quaternion.copy(endpoint_pauldron_l_65.quaternion);
  }
  mesh_pauldron_l_65.castShadow = options.castShadow ?? true;
  mesh_pauldron_l_65.receiveShadow = options.receiveShadow ?? true;
  mesh_pauldron_l_65.userData.sculptComponent = {"id": "pauldron-l", "name": "Left pauldron", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "clavicle-l", "attachment": {"parentSocket": "clavicle-l-pauldron-l", "localStart": [0, 0, 0], "localEnd": [0, 0.18, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.2, "height": 0.18, "depth": 0.2, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_pauldron_l_65.add(mesh_pauldron_l_65);
  meshes["pauldron-l"] = mesh_pauldron_l_65;
  colliders["pauldron-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pelvis"] ??= [];
  destructionGroups["pelvis"].push(node_pauldron_l_65);

  const endpoint_pauldron_r_66 = makeAttachmentEndpoint(null);
  const node_pauldron_r_66 = new THREE.Group();
  node_pauldron_r_66.name = "Right pauldron__pivot";
  node_pauldron_r_66.scale.set(1, 1, 1);
  if (endpoint_pauldron_r_66) {
    node_pauldron_r_66.position.copy(endpoint_pauldron_r_66.start);
    node_pauldron_r_66.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pauldron_r_66.position.set(0.0, -0.16099999999999995, 0.0);
    node_pauldron_r_66.rotation.set(0.0, 0.0, 0.0);
  }
  node_pauldron_r_66.userData.sculptComponent = {"id": "pauldron-r", "name": "Right pauldron", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "clavicle-r", "attachment": {"parentSocket": "clavicle-r-pauldron-r", "localStart": [0, 0, 0], "localEnd": [0, 0.18, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.2, "height": 0.18, "depth": 0.2, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_pauldron_r_66.userData.actionProfile = {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["clavicle-r"] ?? root).add(node_pauldron_r_66);
  nodes["pauldron-r"] = node_pauldron_r_66;
  const mesh_pauldron_r_66Geometry = endpoint_pauldron_r_66
    ? new THREE.CylinderGeometry(endpoint_pauldron_r_66.endRadius, endpoint_pauldron_r_66.baseRadius, endpoint_pauldron_r_66.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_pauldron_r_66) {
    mesh_pauldron_r_66Geometry.scale(0.38038, 0.24024, 0.3003);
  }
  const mesh_pauldron_r_66 = new THREE.Mesh(
    mesh_pauldron_r_66Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pauldron_r_66.name = "Right pauldron";
  if (endpoint_pauldron_r_66) {
    mesh_pauldron_r_66.position.copy(endpoint_pauldron_r_66.midpoint);
    mesh_pauldron_r_66.quaternion.copy(endpoint_pauldron_r_66.quaternion);
  }
  mesh_pauldron_r_66.castShadow = options.castShadow ?? true;
  mesh_pauldron_r_66.receiveShadow = options.receiveShadow ?? true;
  mesh_pauldron_r_66.userData.sculptComponent = {"id": "pauldron-r", "name": "Right pauldron", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "clavicle-r", "attachment": {"parentSocket": "clavicle-r-pauldron-r", "localStart": [0, 0, 0], "localEnd": [0, 0.18, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.2, "height": 0.18, "depth": 0.2, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_pauldron_r_66.add(mesh_pauldron_r_66);
  meshes["pauldron-r"] = mesh_pauldron_r_66;
  colliders["pauldron-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pelvis"] ??= [];
  destructionGroups["pelvis"].push(node_pauldron_r_66);

  const endpoint_upper_arm_armor_l_67 = makeAttachmentEndpoint(null);
  const node_upper_arm_armor_l_67 = new THREE.Group();
  node_upper_arm_armor_l_67.name = "Left upper-arm armor__pivot";
  node_upper_arm_armor_l_67.scale.set(1, 1, 1);
  if (endpoint_upper_arm_armor_l_67) {
    node_upper_arm_armor_l_67.position.copy(endpoint_upper_arm_armor_l_67.start);
    node_upper_arm_armor_l_67.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_upper_arm_armor_l_67.position.set(0.0, -0.16099999999999995, 0.0);
    node_upper_arm_armor_l_67.rotation.set(0.0, 0.0, 0.0);
  }
  node_upper_arm_armor_l_67.userData.sculptComponent = {"id": "upper-arm-armor-l", "name": "Left upper-arm armor", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "upper-arm-l", "attachment": {"parentSocket": "upper-arm-l-upper-arm-armor-l", "localStart": [0, 0, 0], "localEnd": [0, 0.28, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.14, "height": 0.28, "depth": 0.15, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "arm-armor.fastener-rows", "name": "upper-arm-fastener-rows", "kind": "fastener", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c1.png", "status": "specified-pending-render-confirmation"}, {"id": "arm-armor.buckle-ladders", "name": "upper-arm-buckle-ladders", "kind": "fastener", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c1.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_upper_arm_armor_l_67.userData.actionProfile = {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["upper-arm-l"] ?? root).add(node_upper_arm_armor_l_67);
  nodes["upper-arm-armor-l"] = node_upper_arm_armor_l_67;
  const mesh_upper_arm_armor_l_67Geometry = endpoint_upper_arm_armor_l_67
    ? new THREE.CylinderGeometry(endpoint_upper_arm_armor_l_67.endRadius, endpoint_upper_arm_armor_l_67.baseRadius, endpoint_upper_arm_armor_l_67.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_upper_arm_armor_l_67) {
    mesh_upper_arm_armor_l_67Geometry.scale(0.38038, 0.24024, 0.3003);
  }
  const mesh_upper_arm_armor_l_67 = new THREE.Mesh(
    mesh_upper_arm_armor_l_67Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_upper_arm_armor_l_67.name = "Left upper-arm armor";
  if (endpoint_upper_arm_armor_l_67) {
    mesh_upper_arm_armor_l_67.position.copy(endpoint_upper_arm_armor_l_67.midpoint);
    mesh_upper_arm_armor_l_67.quaternion.copy(endpoint_upper_arm_armor_l_67.quaternion);
  }
  mesh_upper_arm_armor_l_67.castShadow = options.castShadow ?? true;
  mesh_upper_arm_armor_l_67.receiveShadow = options.receiveShadow ?? true;
  mesh_upper_arm_armor_l_67.userData.sculptComponent = {"id": "upper-arm-armor-l", "name": "Left upper-arm armor", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "upper-arm-l", "attachment": {"parentSocket": "upper-arm-l-upper-arm-armor-l", "localStart": [0, 0, 0], "localEnd": [0, 0.28, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.14, "height": 0.28, "depth": 0.15, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "arm-armor.fastener-rows", "name": "upper-arm-fastener-rows", "kind": "fastener", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c1.png", "status": "specified-pending-render-confirmation"}, {"id": "arm-armor.buckle-ladders", "name": "upper-arm-buckle-ladders", "kind": "fastener", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c1.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_upper_arm_armor_l_67.add(mesh_upper_arm_armor_l_67);
  meshes["upper-arm-armor-l"] = mesh_upper_arm_armor_l_67;
  colliders["upper-arm-armor-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pelvis"] ??= [];
  destructionGroups["pelvis"].push(node_upper_arm_armor_l_67);

  const endpoint_upper_arm_armor_r_68 = makeAttachmentEndpoint(null);
  const node_upper_arm_armor_r_68 = new THREE.Group();
  node_upper_arm_armor_r_68.name = "Right upper-arm armor__pivot";
  node_upper_arm_armor_r_68.scale.set(1, 1, 1);
  if (endpoint_upper_arm_armor_r_68) {
    node_upper_arm_armor_r_68.position.copy(endpoint_upper_arm_armor_r_68.start);
    node_upper_arm_armor_r_68.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_upper_arm_armor_r_68.position.set(0.0, -0.16099999999999995, 0.0);
    node_upper_arm_armor_r_68.rotation.set(0.0, 0.0, 0.0);
  }
  node_upper_arm_armor_r_68.userData.sculptComponent = {"id": "upper-arm-armor-r", "name": "Right upper-arm armor", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "upper-arm-r", "attachment": {"parentSocket": "upper-arm-r-upper-arm-armor-r", "localStart": [0, 0, 0], "localEnd": [0, 0.28, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.14, "height": 0.28, "depth": 0.15, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_upper_arm_armor_r_68.userData.actionProfile = {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["upper-arm-r"] ?? root).add(node_upper_arm_armor_r_68);
  nodes["upper-arm-armor-r"] = node_upper_arm_armor_r_68;
  const mesh_upper_arm_armor_r_68Geometry = endpoint_upper_arm_armor_r_68
    ? new THREE.CylinderGeometry(endpoint_upper_arm_armor_r_68.endRadius, endpoint_upper_arm_armor_r_68.baseRadius, endpoint_upper_arm_armor_r_68.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_upper_arm_armor_r_68) {
    mesh_upper_arm_armor_r_68Geometry.scale(0.38038, 0.24024, 0.3003);
  }
  const mesh_upper_arm_armor_r_68 = new THREE.Mesh(
    mesh_upper_arm_armor_r_68Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_upper_arm_armor_r_68.name = "Right upper-arm armor";
  if (endpoint_upper_arm_armor_r_68) {
    mesh_upper_arm_armor_r_68.position.copy(endpoint_upper_arm_armor_r_68.midpoint);
    mesh_upper_arm_armor_r_68.quaternion.copy(endpoint_upper_arm_armor_r_68.quaternion);
  }
  mesh_upper_arm_armor_r_68.castShadow = options.castShadow ?? true;
  mesh_upper_arm_armor_r_68.receiveShadow = options.receiveShadow ?? true;
  mesh_upper_arm_armor_r_68.userData.sculptComponent = {"id": "upper-arm-armor-r", "name": "Right upper-arm armor", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "upper-arm-r", "attachment": {"parentSocket": "upper-arm-r-upper-arm-armor-r", "localStart": [0, 0, 0], "localEnd": [0, 0.28, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.14, "height": 0.28, "depth": 0.15, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_upper_arm_armor_r_68.add(mesh_upper_arm_armor_r_68);
  meshes["upper-arm-armor-r"] = mesh_upper_arm_armor_r_68;
  colliders["upper-arm-armor-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pelvis"] ??= [];
  destructionGroups["pelvis"].push(node_upper_arm_armor_r_68);

  const endpoint_forearm_armor_l_69 = makeAttachmentEndpoint(null);
  const node_forearm_armor_l_69 = new THREE.Group();
  node_forearm_armor_l_69.name = "Left forearm armor__pivot";
  node_forearm_armor_l_69.scale.set(1, 1, 1);
  if (endpoint_forearm_armor_l_69) {
    node_forearm_armor_l_69.position.copy(endpoint_forearm_armor_l_69.start);
    node_forearm_armor_l_69.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_forearm_armor_l_69.position.set(0.0, -0.16099999999999995, 0.0);
    node_forearm_armor_l_69.rotation.set(0.0, 0.0, 0.0);
  }
  node_forearm_armor_l_69.userData.sculptComponent = {"id": "forearm-armor-l", "name": "Left forearm armor", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "forearm-l", "attachment": {"parentSocket": "forearm-l-forearm-armor-l", "localStart": [0, 0, 0], "localEnd": [0, 0.26, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.15, "height": 0.26, "depth": 0.16, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "forearm-armor.overlap-seams", "name": "forearm-plate-seams", "kind": "seam", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c0.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_forearm_armor_l_69.userData.actionProfile = {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["forearm-l"] ?? root).add(node_forearm_armor_l_69);
  nodes["forearm-armor-l"] = node_forearm_armor_l_69;
  const mesh_forearm_armor_l_69Geometry = endpoint_forearm_armor_l_69
    ? new THREE.CylinderGeometry(endpoint_forearm_armor_l_69.endRadius, endpoint_forearm_armor_l_69.baseRadius, endpoint_forearm_armor_l_69.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_forearm_armor_l_69) {
    mesh_forearm_armor_l_69Geometry.scale(0.38038, 0.24024, 0.3003);
  }
  const mesh_forearm_armor_l_69 = new THREE.Mesh(
    mesh_forearm_armor_l_69Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_forearm_armor_l_69.name = "Left forearm armor";
  if (endpoint_forearm_armor_l_69) {
    mesh_forearm_armor_l_69.position.copy(endpoint_forearm_armor_l_69.midpoint);
    mesh_forearm_armor_l_69.quaternion.copy(endpoint_forearm_armor_l_69.quaternion);
  }
  mesh_forearm_armor_l_69.castShadow = options.castShadow ?? true;
  mesh_forearm_armor_l_69.receiveShadow = options.receiveShadow ?? true;
  mesh_forearm_armor_l_69.userData.sculptComponent = {"id": "forearm-armor-l", "name": "Left forearm armor", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "forearm-l", "attachment": {"parentSocket": "forearm-l-forearm-armor-l", "localStart": [0, 0, 0], "localEnd": [0, 0.26, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.15, "height": 0.26, "depth": 0.16, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "forearm-armor.overlap-seams", "name": "forearm-plate-seams", "kind": "seam", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c0.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_forearm_armor_l_69.add(mesh_forearm_armor_l_69);
  meshes["forearm-armor-l"] = mesh_forearm_armor_l_69;
  colliders["forearm-armor-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pelvis"] ??= [];
  destructionGroups["pelvis"].push(node_forearm_armor_l_69);

  const endpoint_forearm_armor_r_70 = makeAttachmentEndpoint(null);
  const node_forearm_armor_r_70 = new THREE.Group();
  node_forearm_armor_r_70.name = "Right forearm armor__pivot";
  node_forearm_armor_r_70.scale.set(1, 1, 1);
  if (endpoint_forearm_armor_r_70) {
    node_forearm_armor_r_70.position.copy(endpoint_forearm_armor_r_70.start);
    node_forearm_armor_r_70.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_forearm_armor_r_70.position.set(0.0, -0.16099999999999995, 0.0);
    node_forearm_armor_r_70.rotation.set(0.0, 0.0, 0.0);
  }
  node_forearm_armor_r_70.userData.sculptComponent = {"id": "forearm-armor-r", "name": "Right forearm armor", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "forearm-r", "attachment": {"parentSocket": "forearm-r-forearm-armor-r", "localStart": [0, 0, 0], "localEnd": [0, 0.26, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.15, "height": 0.26, "depth": 0.16, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_forearm_armor_r_70.userData.actionProfile = {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["forearm-r"] ?? root).add(node_forearm_armor_r_70);
  nodes["forearm-armor-r"] = node_forearm_armor_r_70;
  const mesh_forearm_armor_r_70Geometry = endpoint_forearm_armor_r_70
    ? new THREE.CylinderGeometry(endpoint_forearm_armor_r_70.endRadius, endpoint_forearm_armor_r_70.baseRadius, endpoint_forearm_armor_r_70.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_forearm_armor_r_70) {
    mesh_forearm_armor_r_70Geometry.scale(0.38038, 0.24024, 0.3003);
  }
  const mesh_forearm_armor_r_70 = new THREE.Mesh(
    mesh_forearm_armor_r_70Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_forearm_armor_r_70.name = "Right forearm armor";
  if (endpoint_forearm_armor_r_70) {
    mesh_forearm_armor_r_70.position.copy(endpoint_forearm_armor_r_70.midpoint);
    mesh_forearm_armor_r_70.quaternion.copy(endpoint_forearm_armor_r_70.quaternion);
  }
  mesh_forearm_armor_r_70.castShadow = options.castShadow ?? true;
  mesh_forearm_armor_r_70.receiveShadow = options.receiveShadow ?? true;
  mesh_forearm_armor_r_70.userData.sculptComponent = {"id": "forearm-armor-r", "name": "Right forearm armor", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "forearm-r", "attachment": {"parentSocket": "forearm-r-forearm-armor-r", "localStart": [0, 0, 0], "localEnd": [0, 0.26, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.15, "height": 0.26, "depth": 0.16, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_forearm_armor_r_70.add(mesh_forearm_armor_r_70);
  meshes["forearm-armor-r"] = mesh_forearm_armor_r_70;
  colliders["forearm-armor-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pelvis"] ??= [];
  destructionGroups["pelvis"].push(node_forearm_armor_r_70);

  const endpoint_gauntlet_l_71 = makeAttachmentEndpoint(null);
  const node_gauntlet_l_71 = new THREE.Group();
  node_gauntlet_l_71.name = "Left gauntlet__pivot";
  node_gauntlet_l_71.scale.set(1, 1, 1);
  if (endpoint_gauntlet_l_71) {
    node_gauntlet_l_71.position.copy(endpoint_gauntlet_l_71.start);
    node_gauntlet_l_71.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_gauntlet_l_71.position.set(0.0, -0.16099999999999995, 0.0);
    node_gauntlet_l_71.rotation.set(0.0, 0.0, 0.0);
  }
  node_gauntlet_l_71.userData.sculptComponent = {"id": "gauntlet-l", "name": "Left gauntlet", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-l", "attachment": {"parentSocket": "hand-l-gauntlet-l", "localStart": [0, 0, 0], "localEnd": [0, 0.16, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.13, "height": 0.16, "depth": 0.13, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "gauntlets.finger-plates", "name": "gauntlet-finger-plates", "kind": "seam", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c0.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_gauntlet_l_71.userData.actionProfile = {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["hand-l"] ?? root).add(node_gauntlet_l_71);
  nodes["gauntlet-l"] = node_gauntlet_l_71;
  const mesh_gauntlet_l_71Geometry = endpoint_gauntlet_l_71
    ? new THREE.CylinderGeometry(endpoint_gauntlet_l_71.endRadius, endpoint_gauntlet_l_71.baseRadius, endpoint_gauntlet_l_71.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_gauntlet_l_71) {
    mesh_gauntlet_l_71Geometry.scale(0.38038, 0.24024, 0.3003);
  }
  const mesh_gauntlet_l_71 = new THREE.Mesh(
    mesh_gauntlet_l_71Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gauntlet_l_71.name = "Left gauntlet";
  if (endpoint_gauntlet_l_71) {
    mesh_gauntlet_l_71.position.copy(endpoint_gauntlet_l_71.midpoint);
    mesh_gauntlet_l_71.quaternion.copy(endpoint_gauntlet_l_71.quaternion);
  }
  mesh_gauntlet_l_71.castShadow = options.castShadow ?? true;
  mesh_gauntlet_l_71.receiveShadow = options.receiveShadow ?? true;
  mesh_gauntlet_l_71.userData.sculptComponent = {"id": "gauntlet-l", "name": "Left gauntlet", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-l", "attachment": {"parentSocket": "hand-l-gauntlet-l", "localStart": [0, 0, 0], "localEnd": [0, 0.16, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.13, "height": 0.16, "depth": 0.13, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "gauntlets.finger-plates", "name": "gauntlet-finger-plates", "kind": "seam", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c0.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_gauntlet_l_71.add(mesh_gauntlet_l_71);
  meshes["gauntlet-l"] = mesh_gauntlet_l_71;
  colliders["gauntlet-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pelvis"] ??= [];
  destructionGroups["pelvis"].push(node_gauntlet_l_71);

  const endpoint_gauntlet_r_72 = makeAttachmentEndpoint(null);
  const node_gauntlet_r_72 = new THREE.Group();
  node_gauntlet_r_72.name = "Right gauntlet__pivot";
  node_gauntlet_r_72.scale.set(1, 1, 1);
  if (endpoint_gauntlet_r_72) {
    node_gauntlet_r_72.position.copy(endpoint_gauntlet_r_72.start);
    node_gauntlet_r_72.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_gauntlet_r_72.position.set(0.0, -0.16099999999999995, 0.0);
    node_gauntlet_r_72.rotation.set(0.0, 0.0, 0.0);
  }
  node_gauntlet_r_72.userData.sculptComponent = {"id": "gauntlet-r", "name": "Right gauntlet", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-r", "attachment": {"parentSocket": "hand-r-gauntlet-r", "localStart": [0, 0, 0], "localEnd": [0, 0.16, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.13, "height": 0.16, "depth": 0.13, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_gauntlet_r_72.userData.actionProfile = {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["hand-r"] ?? root).add(node_gauntlet_r_72);
  nodes["gauntlet-r"] = node_gauntlet_r_72;
  const mesh_gauntlet_r_72Geometry = endpoint_gauntlet_r_72
    ? new THREE.CylinderGeometry(endpoint_gauntlet_r_72.endRadius, endpoint_gauntlet_r_72.baseRadius, endpoint_gauntlet_r_72.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_gauntlet_r_72) {
    mesh_gauntlet_r_72Geometry.scale(0.38038, 0.24024, 0.3003);
  }
  const mesh_gauntlet_r_72 = new THREE.Mesh(
    mesh_gauntlet_r_72Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gauntlet_r_72.name = "Right gauntlet";
  if (endpoint_gauntlet_r_72) {
    mesh_gauntlet_r_72.position.copy(endpoint_gauntlet_r_72.midpoint);
    mesh_gauntlet_r_72.quaternion.copy(endpoint_gauntlet_r_72.quaternion);
  }
  mesh_gauntlet_r_72.castShadow = options.castShadow ?? true;
  mesh_gauntlet_r_72.receiveShadow = options.receiveShadow ?? true;
  mesh_gauntlet_r_72.userData.sculptComponent = {"id": "gauntlet-r", "name": "Right gauntlet", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-r", "attachment": {"parentSocket": "hand-r-gauntlet-r", "localStart": [0, 0, 0], "localEnd": [0, 0.16, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.13, "height": 0.16, "depth": 0.13, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_gauntlet_r_72.add(mesh_gauntlet_r_72);
  meshes["gauntlet-r"] = mesh_gauntlet_r_72;
  colliders["gauntlet-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pelvis"] ??= [];
  destructionGroups["pelvis"].push(node_gauntlet_r_72);

  const endpoint_belt_73 = makeAttachmentEndpoint(null);
  const node_belt_73 = new THREE.Group();
  node_belt_73.name = "Armor belt__pivot";
  node_belt_73.scale.set(1, 1, 1);
  if (endpoint_belt_73) {
    node_belt_73.position.copy(endpoint_belt_73.start);
    node_belt_73.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_belt_73.position.set(0.0, -0.16099999999999995, 0.0);
    node_belt_73.rotation.set(0.0, 0.0, 0.0);
  }
  node_belt_73.userData.sculptComponent = {"id": "belt", "name": "Armor belt", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "pelvis", "attachment": {"parentSocket": "pelvis-belt", "localStart": [0, 0, 0], "localEnd": [0, 0.11, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.37, "height": 0.11, "depth": 0.24, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "gold-metal-material", "materialLayers": ["gold-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "belt.skull-buckle", "name": "belt-skull-buckle", "kind": "contour", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c1.png", "status": "specified-pending-render-confirmation"}, {"id": "belt.hanging-fittings", "name": "belt-hanging-fittings", "kind": "fastener", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c1.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 124, 39, 1)", "secondaryAlbedo": "rgba(63, 37, 14, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_belt_73.userData.actionProfile = {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["pelvis"] ?? root).add(node_belt_73);
  nodes["belt"] = node_belt_73;
  const mesh_belt_73Geometry = endpoint_belt_73
    ? new THREE.CylinderGeometry(endpoint_belt_73.endRadius, endpoint_belt_73.baseRadius, endpoint_belt_73.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_belt_73) {
    mesh_belt_73Geometry.scale(0.38038, 0.24024, 0.3003);
  }
  const mesh_belt_73 = new THREE.Mesh(
    mesh_belt_73Geometry,
    materialMap["gold-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_belt_73.name = "Armor belt";
  if (endpoint_belt_73) {
    mesh_belt_73.position.copy(endpoint_belt_73.midpoint);
    mesh_belt_73.quaternion.copy(endpoint_belt_73.quaternion);
  }
  mesh_belt_73.castShadow = options.castShadow ?? true;
  mesh_belt_73.receiveShadow = options.receiveShadow ?? true;
  mesh_belt_73.userData.sculptComponent = {"id": "belt", "name": "Armor belt", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "pelvis", "attachment": {"parentSocket": "pelvis-belt", "localStart": [0, 0, 0], "localEnd": [0, 0.11, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.37, "height": 0.11, "depth": 0.24, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "gold-metal-material", "materialLayers": ["gold-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "belt.skull-buckle", "name": "belt-skull-buckle", "kind": "contour", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c1.png", "status": "specified-pending-render-confirmation"}, {"id": "belt.hanging-fittings", "name": "belt-hanging-fittings", "kind": "fastener", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c1.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 124, 39, 1)", "secondaryAlbedo": "rgba(63, 37, 14, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_belt_73.add(mesh_belt_73);
  meshes["belt"] = mesh_belt_73;
  colliders["belt"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pelvis"] ??= [];
  destructionGroups["pelvis"].push(node_belt_73);

  const endpoint_skull_buckle_74 = makeAttachmentEndpoint(null);
  const node_skull_buckle_74 = new THREE.Group();
  node_skull_buckle_74.name = "Skull belt buckle__pivot";
  node_skull_buckle_74.scale.set(1, 1, 1);
  if (endpoint_skull_buckle_74) {
    node_skull_buckle_74.position.copy(endpoint_skull_buckle_74.start);
    node_skull_buckle_74.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_skull_buckle_74.position.set(0.0, -0.16099999999999995, 0.0);
    node_skull_buckle_74.rotation.set(0.0, 0.0, 0.0);
  }
  node_skull_buckle_74.userData.sculptComponent = {"id": "skull-buckle", "name": "Skull belt buckle", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "belt", "attachment": {"parentSocket": "belt-skull-buckle", "localStart": [0, 0, 0], "localEnd": [0, 0.16, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.14, "height": 0.16, "depth": 0.07, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "skull-material", "materialLayers": ["skull-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "skull-material.eye-emission", "name": "skull-eye-emission", "kind": "emissive", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c1.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(193, 181, 141, 1)", "secondaryAlbedo": "rgba(72, 59, 43, 1)", "materialClass": "ceramic", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_skull_buckle_74.userData.actionProfile = {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["belt"] ?? root).add(node_skull_buckle_74);
  nodes["skull-buckle"] = node_skull_buckle_74;
  const mesh_skull_buckle_74Geometry = endpoint_skull_buckle_74
    ? new THREE.CylinderGeometry(endpoint_skull_buckle_74.endRadius, endpoint_skull_buckle_74.baseRadius, endpoint_skull_buckle_74.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_skull_buckle_74) {
    mesh_skull_buckle_74Geometry.scale(0.38038, 0.24024, 0.3003);
  }
  const mesh_skull_buckle_74 = new THREE.Mesh(
    mesh_skull_buckle_74Geometry,
    materialMap["skull-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_skull_buckle_74.name = "Skull belt buckle";
  if (endpoint_skull_buckle_74) {
    mesh_skull_buckle_74.position.copy(endpoint_skull_buckle_74.midpoint);
    mesh_skull_buckle_74.quaternion.copy(endpoint_skull_buckle_74.quaternion);
  }
  mesh_skull_buckle_74.castShadow = options.castShadow ?? true;
  mesh_skull_buckle_74.receiveShadow = options.receiveShadow ?? true;
  mesh_skull_buckle_74.userData.sculptComponent = {"id": "skull-buckle", "name": "Skull belt buckle", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "belt", "attachment": {"parentSocket": "belt-skull-buckle", "localStart": [0, 0, 0], "localEnd": [0, 0.16, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.14, "height": 0.16, "depth": 0.07, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "skull-material", "materialLayers": ["skull-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "skull-material.eye-emission", "name": "skull-eye-emission", "kind": "emissive", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c1.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(193, 181, 141, 1)", "secondaryAlbedo": "rgba(72, 59, 43, 1)", "materialClass": "ceramic", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_skull_buckle_74.add(mesh_skull_buckle_74);
  meshes["skull-buckle"] = mesh_skull_buckle_74;
  colliders["skull-buckle"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pelvis"] ??= [];
  destructionGroups["pelvis"].push(node_skull_buckle_74);

  const endpoint_trousers_75 = makeAttachmentEndpoint(null);
  const node_trousers_75 = new THREE.Group();
  node_trousers_75.name = "Faceted blue trousers__pivot";
  node_trousers_75.scale.set(1, 1, 1);
  if (endpoint_trousers_75) {
    node_trousers_75.position.copy(endpoint_trousers_75.start);
    node_trousers_75.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_trousers_75.position.set(0.0, -0.16099999999999995, 0.0);
    node_trousers_75.rotation.set(0.0, 0.0, 0.0);
  }
  node_trousers_75.userData.sculptComponent = {"id": "trousers", "name": "Faceted blue trousers", "level": "macro", "role": "cloth", "importance": 0.92, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "pelvis", "attachment": {"parentSocket": "pelvis-trousers", "localStart": [0, 0, 0], "localEnd": [0, 0.48, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.45, "height": 0.48, "depth": 0.31, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "blue-cloth-material", "materialLayers": ["blue-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "trousers.faceted-folds", "name": "trouser-faceted-folds", "kind": "ridge", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c1.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(54, 52, 111, 1)", "secondaryAlbedo": "rgba(23, 21, 58, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_trousers_75.userData.actionProfile = {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["pelvis"] ?? root).add(node_trousers_75);
  nodes["trousers"] = node_trousers_75;
  const mesh_trousers_75Geometry = endpoint_trousers_75
    ? new THREE.CylinderGeometry(endpoint_trousers_75.endRadius, endpoint_trousers_75.baseRadius, endpoint_trousers_75.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_trousers_75) {
    mesh_trousers_75Geometry.scale(0.38038, 0.24024, 0.3003);
  }
  const mesh_trousers_75 = new THREE.Mesh(
    mesh_trousers_75Geometry,
    materialMap["blue-cloth-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_trousers_75.name = "Faceted blue trousers";
  if (endpoint_trousers_75) {
    mesh_trousers_75.position.copy(endpoint_trousers_75.midpoint);
    mesh_trousers_75.quaternion.copy(endpoint_trousers_75.quaternion);
  }
  mesh_trousers_75.castShadow = options.castShadow ?? true;
  mesh_trousers_75.receiveShadow = options.receiveShadow ?? true;
  mesh_trousers_75.userData.sculptComponent = {"id": "trousers", "name": "Faceted blue trousers", "level": "macro", "role": "cloth", "importance": 0.92, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "pelvis", "attachment": {"parentSocket": "pelvis-trousers", "localStart": [0, 0, 0], "localEnd": [0, 0.48, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.45, "height": 0.48, "depth": 0.31, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "blue-cloth-material", "materialLayers": ["blue-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "trousers.faceted-folds", "name": "trouser-faceted-folds", "kind": "ridge", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c1.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(54, 52, 111, 1)", "secondaryAlbedo": "rgba(23, 21, 58, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_trousers_75.add(mesh_trousers_75);
  meshes["trousers"] = mesh_trousers_75;
  colliders["trousers"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pelvis"] ??= [];
  destructionGroups["pelvis"].push(node_trousers_75);

  const endpoint_greave_l_76 = makeAttachmentEndpoint(null);
  const node_greave_l_76 = new THREE.Group();
  node_greave_l_76.name = "Left greave__pivot";
  node_greave_l_76.scale.set(1, 1, 1);
  if (endpoint_greave_l_76) {
    node_greave_l_76.position.copy(endpoint_greave_l_76.start);
    node_greave_l_76.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_greave_l_76.position.set(0.0, -0.16099999999999995, 0.0);
    node_greave_l_76.rotation.set(0.0, 0.0, 0.0);
  }
  node_greave_l_76.userData.sculptComponent = {"id": "greave-l", "name": "Left greave", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "shin-l", "attachment": {"parentSocket": "shin-l-greave-l", "localStart": [0, 0, 0], "localEnd": [0, 0.31, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.17, "height": 0.31, "depth": 0.18, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "greaves.panel-seams", "name": "greave-panel-seams", "kind": "seam", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r2c1.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_greave_l_76.userData.actionProfile = {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["shin-l"] ?? root).add(node_greave_l_76);
  nodes["greave-l"] = node_greave_l_76;
  const mesh_greave_l_76Geometry = endpoint_greave_l_76
    ? new THREE.CylinderGeometry(endpoint_greave_l_76.endRadius, endpoint_greave_l_76.baseRadius, endpoint_greave_l_76.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_greave_l_76) {
    mesh_greave_l_76Geometry.scale(0.38038, 0.24024, 0.3003);
  }
  const mesh_greave_l_76 = new THREE.Mesh(
    mesh_greave_l_76Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_greave_l_76.name = "Left greave";
  if (endpoint_greave_l_76) {
    mesh_greave_l_76.position.copy(endpoint_greave_l_76.midpoint);
    mesh_greave_l_76.quaternion.copy(endpoint_greave_l_76.quaternion);
  }
  mesh_greave_l_76.castShadow = options.castShadow ?? true;
  mesh_greave_l_76.receiveShadow = options.receiveShadow ?? true;
  mesh_greave_l_76.userData.sculptComponent = {"id": "greave-l", "name": "Left greave", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "shin-l", "attachment": {"parentSocket": "shin-l-greave-l", "localStart": [0, 0, 0], "localEnd": [0, 0.31, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.17, "height": 0.31, "depth": 0.18, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "greaves.panel-seams", "name": "greave-panel-seams", "kind": "seam", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r2c1.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_greave_l_76.add(mesh_greave_l_76);
  meshes["greave-l"] = mesh_greave_l_76;
  colliders["greave-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pelvis"] ??= [];
  destructionGroups["pelvis"].push(node_greave_l_76);

  const endpoint_greave_r_77 = makeAttachmentEndpoint(null);
  const node_greave_r_77 = new THREE.Group();
  node_greave_r_77.name = "Right greave__pivot";
  node_greave_r_77.scale.set(1, 1, 1);
  if (endpoint_greave_r_77) {
    node_greave_r_77.position.copy(endpoint_greave_r_77.start);
    node_greave_r_77.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_greave_r_77.position.set(0.0, -0.16099999999999995, 0.0);
    node_greave_r_77.rotation.set(0.0, 0.0, 0.0);
  }
  node_greave_r_77.userData.sculptComponent = {"id": "greave-r", "name": "Right greave", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "shin-r", "attachment": {"parentSocket": "shin-r-greave-r", "localStart": [0, 0, 0], "localEnd": [0, 0.31, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.17, "height": 0.31, "depth": 0.18, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_greave_r_77.userData.actionProfile = {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["shin-r"] ?? root).add(node_greave_r_77);
  nodes["greave-r"] = node_greave_r_77;
  const mesh_greave_r_77Geometry = endpoint_greave_r_77
    ? new THREE.CylinderGeometry(endpoint_greave_r_77.endRadius, endpoint_greave_r_77.baseRadius, endpoint_greave_r_77.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_greave_r_77) {
    mesh_greave_r_77Geometry.scale(0.38038, 0.24024, 0.3003);
  }
  const mesh_greave_r_77 = new THREE.Mesh(
    mesh_greave_r_77Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_greave_r_77.name = "Right greave";
  if (endpoint_greave_r_77) {
    mesh_greave_r_77.position.copy(endpoint_greave_r_77.midpoint);
    mesh_greave_r_77.quaternion.copy(endpoint_greave_r_77.quaternion);
  }
  mesh_greave_r_77.castShadow = options.castShadow ?? true;
  mesh_greave_r_77.receiveShadow = options.receiveShadow ?? true;
  mesh_greave_r_77.userData.sculptComponent = {"id": "greave-r", "name": "Right greave", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "shin-r", "attachment": {"parentSocket": "shin-r-greave-r", "localStart": [0, 0, 0], "localEnd": [0, 0.31, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.17, "height": 0.31, "depth": 0.18, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_greave_r_77.add(mesh_greave_r_77);
  meshes["greave-r"] = mesh_greave_r_77;
  colliders["greave-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pelvis"] ??= [];
  destructionGroups["pelvis"].push(node_greave_r_77);

  const endpoint_sabaton_l_78 = makeAttachmentEndpoint(null);
  const node_sabaton_l_78 = new THREE.Group();
  node_sabaton_l_78.name = "Left pointed sabaton__pivot";
  node_sabaton_l_78.scale.set(1, 1, 1);
  if (endpoint_sabaton_l_78) {
    node_sabaton_l_78.position.copy(endpoint_sabaton_l_78.start);
    node_sabaton_l_78.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_sabaton_l_78.position.set(0.0, -0.16099999999999995, 0.0);
    node_sabaton_l_78.rotation.set(0.0, 0.0, 0.0);
  }
  node_sabaton_l_78.userData.sculptComponent = {"id": "sabaton-l", "name": "Left pointed sabaton", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "foot-l", "attachment": {"parentSocket": "foot-l-sabaton-l", "localStart": [0, 0, 0], "localEnd": [0, 0.12, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.18, "height": 0.12, "depth": 0.3, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "sabatons.heel-fins", "name": "heel-gold-fins", "kind": "contour", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r2c1.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_sabaton_l_78.userData.actionProfile = {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["foot-l"] ?? root).add(node_sabaton_l_78);
  nodes["sabaton-l"] = node_sabaton_l_78;
  const mesh_sabaton_l_78Geometry = endpoint_sabaton_l_78
    ? new THREE.CylinderGeometry(endpoint_sabaton_l_78.endRadius, endpoint_sabaton_l_78.baseRadius, endpoint_sabaton_l_78.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_sabaton_l_78) {
    mesh_sabaton_l_78Geometry.scale(0.38038, 0.24024, 0.3003);
  }
  const mesh_sabaton_l_78 = new THREE.Mesh(
    mesh_sabaton_l_78Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sabaton_l_78.name = "Left pointed sabaton";
  if (endpoint_sabaton_l_78) {
    mesh_sabaton_l_78.position.copy(endpoint_sabaton_l_78.midpoint);
    mesh_sabaton_l_78.quaternion.copy(endpoint_sabaton_l_78.quaternion);
  }
  mesh_sabaton_l_78.castShadow = options.castShadow ?? true;
  mesh_sabaton_l_78.receiveShadow = options.receiveShadow ?? true;
  mesh_sabaton_l_78.userData.sculptComponent = {"id": "sabaton-l", "name": "Left pointed sabaton", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "foot-l", "attachment": {"parentSocket": "foot-l-sabaton-l", "localStart": [0, 0, 0], "localEnd": [0, 0.12, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.18, "height": 0.12, "depth": 0.3, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "sabatons.heel-fins", "name": "heel-gold-fins", "kind": "contour", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r2c1.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_sabaton_l_78.add(mesh_sabaton_l_78);
  meshes["sabaton-l"] = mesh_sabaton_l_78;
  colliders["sabaton-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pelvis"] ??= [];
  destructionGroups["pelvis"].push(node_sabaton_l_78);

  const endpoint_sabaton_r_79 = makeAttachmentEndpoint(null);
  const node_sabaton_r_79 = new THREE.Group();
  node_sabaton_r_79.name = "Right pointed sabaton__pivot";
  node_sabaton_r_79.scale.set(1, 1, 1);
  if (endpoint_sabaton_r_79) {
    node_sabaton_r_79.position.copy(endpoint_sabaton_r_79.start);
    node_sabaton_r_79.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_sabaton_r_79.position.set(0.0, -0.16099999999999995, 0.0);
    node_sabaton_r_79.rotation.set(0.0, 0.0, 0.0);
  }
  node_sabaton_r_79.userData.sculptComponent = {"id": "sabaton-r", "name": "Right pointed sabaton", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "foot-r", "attachment": {"parentSocket": "foot-r-sabaton-r", "localStart": [0, 0, 0], "localEnd": [0, 0.12, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.18, "height": 0.12, "depth": 0.3, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_sabaton_r_79.userData.actionProfile = {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["foot-r"] ?? root).add(node_sabaton_r_79);
  nodes["sabaton-r"] = node_sabaton_r_79;
  const mesh_sabaton_r_79Geometry = endpoint_sabaton_r_79
    ? new THREE.CylinderGeometry(endpoint_sabaton_r_79.endRadius, endpoint_sabaton_r_79.baseRadius, endpoint_sabaton_r_79.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_sabaton_r_79) {
    mesh_sabaton_r_79Geometry.scale(0.38038, 0.24024, 0.3003);
  }
  const mesh_sabaton_r_79 = new THREE.Mesh(
    mesh_sabaton_r_79Geometry,
    materialMap["silver-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sabaton_r_79.name = "Right pointed sabaton";
  if (endpoint_sabaton_r_79) {
    mesh_sabaton_r_79.position.copy(endpoint_sabaton_r_79.midpoint);
    mesh_sabaton_r_79.quaternion.copy(endpoint_sabaton_r_79.quaternion);
  }
  mesh_sabaton_r_79.castShadow = options.castShadow ?? true;
  mesh_sabaton_r_79.receiveShadow = options.receiveShadow ?? true;
  mesh_sabaton_r_79.userData.sculptComponent = {"id": "sabaton-r", "name": "Right pointed sabaton", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "foot-r", "attachment": {"parentSocket": "foot-r-sabaton-r", "localStart": [0, 0, 0], "localEnd": [0, 0.12, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.18, "height": 0.12, "depth": 0.3, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "silver-metal-material", "materialLayers": ["silver-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118, 124, 136, 1)", "secondaryAlbedo": "rgba(38, 42, 50, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_sabaton_r_79.add(mesh_sabaton_r_79);
  meshes["sabaton-r"] = mesh_sabaton_r_79;
  colliders["sabaton-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pelvis"] ??= [];
  destructionGroups["pelvis"].push(node_sabaton_r_79);

  const endpoint_sword_80 = makeAttachmentEndpoint(null);
  const node_sword_80 = new THREE.Group();
  node_sword_80.name = "Black and gold sword__pivot";
  node_sword_80.scale.set(1, 1, 1);
  if (endpoint_sword_80) {
    node_sword_80.position.copy(endpoint_sword_80.start);
    node_sword_80.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_sword_80.position.set(0.0, -0.16099999999999995, 0.0);
    node_sword_80.rotation.set(0.0, 0.0, 0.0);
  }
  node_sword_80.userData.sculptComponent = {"id": "sword", "name": "Black and gold sword", "level": "macro", "role": "attachment", "importance": 0.92, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-r", "attachment": {"parentSocket": "hand-r-sword", "localStart": [0, 0, 0], "localEnd": [0, 0.91, 0], "contactType": "rigid-weld", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"], "anchor": "hand-r", "anchorKind": "component", "maxOffset": 0.12, "semanticStatus": "hypothesis-requires-render-confirmation"}, "dimensions": {"width": 0.18, "height": 0.91, "depth": 0.09, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "attachment", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "sword-blade-material", "materialLayers": ["sword-blade-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "sword.guard-engraving", "name": "sword-guard-engraving", "kind": "linework", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c0.png", "status": "specified-pending-render-confirmation"}, {"id": "sword-blade-material.inscription", "name": "sword-orange-inscription", "kind": "decal", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c0.png", "status": "specified-pending-render-confirmation"}, {"id": "sword.grip-wrap", "name": "sword-grip-wrap", "kind": "ridge", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c0.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(43, 42, 48, 1)", "secondaryAlbedo": "rgba(222, 111, 34, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_sword_80.userData.actionProfile = {"animationRole": "attachment", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["hand-r"] ?? root).add(node_sword_80);
  nodes["sword"] = node_sword_80;
  const mesh_sword_80Geometry = endpoint_sword_80
    ? new THREE.CylinderGeometry(endpoint_sword_80.endRadius, endpoint_sword_80.baseRadius, endpoint_sword_80.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_sword_80) {
    mesh_sword_80Geometry.scale(0.38038, 0.24024, 0.3003);
  }
  const mesh_sword_80 = new THREE.Mesh(
    mesh_sword_80Geometry,
    materialMap["sword-blade-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sword_80.name = "Black and gold sword";
  if (endpoint_sword_80) {
    mesh_sword_80.position.copy(endpoint_sword_80.midpoint);
    mesh_sword_80.quaternion.copy(endpoint_sword_80.quaternion);
  }
  mesh_sword_80.castShadow = options.castShadow ?? true;
  mesh_sword_80.receiveShadow = options.receiveShadow ?? true;
  mesh_sword_80.userData.sculptComponent = {"id": "sword", "name": "Black and gold sword", "level": "macro", "role": "attachment", "importance": 0.92, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "hand-r", "attachment": {"parentSocket": "hand-r-sword", "localStart": [0, 0, 0], "localEnd": [0, 0.91, 0], "contactType": "rigid-weld", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"], "anchor": "hand-r", "anchorKind": "component", "maxOffset": 0.12, "semanticStatus": "hypothesis-requires-render-confirmation"}, "dimensions": {"width": 0.18, "height": 0.91, "depth": 0.09, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "attachment", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "sword-blade-material", "materialLayers": ["sword-blade-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "sword.guard-engraving", "name": "sword-guard-engraving", "kind": "linework", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c0.png", "status": "specified-pending-render-confirmation"}, {"id": "sword-blade-material.inscription", "name": "sword-orange-inscription", "kind": "decal", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c0.png", "status": "specified-pending-render-confirmation"}, {"id": "sword.grip-wrap", "name": "sword-grip-wrap", "kind": "ridge", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c0.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(43, 42, 48, 1)", "secondaryAlbedo": "rgba(222, 111, 34, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_sword_80.add(mesh_sword_80);
  meshes["sword"] = mesh_sword_80;
  colliders["sword"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pelvis"] ??= [];
  destructionGroups["pelvis"].push(node_sword_80);

  const endpoint_sword_guard_81 = makeAttachmentEndpoint(null);
  const node_sword_guard_81 = new THREE.Group();
  node_sword_guard_81.name = "Sword guard__pivot";
  node_sword_guard_81.scale.set(1, 1, 1);
  if (endpoint_sword_guard_81) {
    node_sword_guard_81.position.copy(endpoint_sword_guard_81.start);
    node_sword_guard_81.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_sword_guard_81.position.set(0.0, -0.16099999999999995, 0.0);
    node_sword_guard_81.rotation.set(0.0, 0.0, 0.0);
  }
  node_sword_guard_81.userData.sculptComponent = {"id": "sword-guard", "name": "Sword guard", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "sword", "attachment": {"parentSocket": "sword-sword-guard", "localStart": [0, 0, 0], "localEnd": [0, 0.11, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.28, "height": 0.11, "depth": 0.08, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "gold-metal-material", "materialLayers": ["gold-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 124, 39, 1)", "secondaryAlbedo": "rgba(63, 37, 14, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_sword_guard_81.userData.actionProfile = {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["sword"] ?? root).add(node_sword_guard_81);
  nodes["sword-guard"] = node_sword_guard_81;
  const mesh_sword_guard_81Geometry = endpoint_sword_guard_81
    ? new THREE.CylinderGeometry(endpoint_sword_guard_81.endRadius, endpoint_sword_guard_81.baseRadius, endpoint_sword_guard_81.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_sword_guard_81) {
    mesh_sword_guard_81Geometry.scale(0.38038, 0.24024, 0.3003);
  }
  const mesh_sword_guard_81 = new THREE.Mesh(
    mesh_sword_guard_81Geometry,
    materialMap["gold-metal-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sword_guard_81.name = "Sword guard";
  if (endpoint_sword_guard_81) {
    mesh_sword_guard_81.position.copy(endpoint_sword_guard_81.midpoint);
    mesh_sword_guard_81.quaternion.copy(endpoint_sword_guard_81.quaternion);
  }
  mesh_sword_guard_81.castShadow = options.castShadow ?? true;
  mesh_sword_guard_81.receiveShadow = options.receiveShadow ?? true;
  mesh_sword_guard_81.userData.sculptComponent = {"id": "sword-guard", "name": "Sword guard", "level": "meso", "role": "shell", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "conforming-shell", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "sword", "attachment": {"parentSocket": "sword-sword-guard", "localStart": [0, 0, 0], "localEnd": [0, 0.11, 0], "contactType": "skinned-overlap", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.28, "height": 0.11, "depth": 0.08, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "deformable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "gold-metal-material", "materialLayers": ["gold-metal-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(184, 124, 39, 1)", "secondaryAlbedo": "rgba(63, 37, 14, 1)", "materialClass": "metal", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_sword_guard_81.add(mesh_sword_guard_81);
  meshes["sword-guard"] = mesh_sword_guard_81;
  colliders["sword-guard"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pelvis"] ??= [];
  destructionGroups["pelvis"].push(node_sword_guard_81);

  const endpoint_sword_grip_82 = makeAttachmentEndpoint(null);
  const node_sword_grip_82 = new THREE.Group();
  node_sword_grip_82.name = "Wrapped sword grip__pivot";
  node_sword_grip_82.scale.set(1, 1, 1);
  if (endpoint_sword_grip_82) {
    node_sword_grip_82.position.copy(endpoint_sword_grip_82.start);
    node_sword_grip_82.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_sword_grip_82.position.set(0.0, -0.16099999999999995, 0.0);
    node_sword_grip_82.rotation.set(0.0, 0.0, 0.0);
  }
  node_sword_grip_82.userData.sculptComponent = {"id": "sword-grip", "name": "Wrapped sword grip", "level": "meso", "role": "attachment", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "sword", "attachment": {"parentSocket": "sword-sword-grip", "localStart": [0, 0, 0], "localEnd": [0, 0.24, 0], "contactType": "rigid-weld", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"], "anchor": "sword", "anchorKind": "component", "maxOffset": 0.04, "semanticStatus": "hypothesis-requires-render-confirmation"}, "dimensions": {"width": 0.055, "height": 0.24, "depth": 0.055, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "attachment", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "dark-cloth-material", "materialLayers": ["dark-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 30, 38, 1)", "secondaryAlbedo": "rgba(10, 9, 13, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_sword_grip_82.userData.actionProfile = {"animationRole": "attachment", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["sword"] ?? root).add(node_sword_grip_82);
  nodes["sword-grip"] = node_sword_grip_82;
  const mesh_sword_grip_82Geometry = endpoint_sword_grip_82
    ? new THREE.CylinderGeometry(endpoint_sword_grip_82.endRadius, endpoint_sword_grip_82.baseRadius, endpoint_sword_grip_82.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_sword_grip_82) {
    mesh_sword_grip_82Geometry.scale(0.38038, 0.24024, 0.3003);
  }
  const mesh_sword_grip_82 = new THREE.Mesh(
    mesh_sword_grip_82Geometry,
    materialMap["dark-cloth-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sword_grip_82.name = "Wrapped sword grip";
  if (endpoint_sword_grip_82) {
    mesh_sword_grip_82.position.copy(endpoint_sword_grip_82.midpoint);
    mesh_sword_grip_82.quaternion.copy(endpoint_sword_grip_82.quaternion);
  }
  mesh_sword_grip_82.castShadow = options.castShadow ?? true;
  mesh_sword_grip_82.receiveShadow = options.receiveShadow ?? true;
  mesh_sword_grip_82.userData.sculptComponent = {"id": "sword-grip", "name": "Wrapped sword grip", "level": "meso", "role": "attachment", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "sword", "attachment": {"parentSocket": "sword-sword-grip", "localStart": [0, 0, 0], "localEnd": [0, 0.24, 0], "contactType": "rigid-weld", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"], "anchor": "sword", "anchorKind": "component", "maxOffset": 0.04, "semanticStatus": "hypothesis-requires-render-confirmation"}, "dimensions": {"width": 0.055, "height": 0.24, "depth": 0.055, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "attachment", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "dark-cloth-material", "materialLayers": ["dark-cloth-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(32, 30, 38, 1)", "secondaryAlbedo": "rgba(10, 9, 13, 1)", "materialClass": "fabric", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_sword_grip_82.add(mesh_sword_grip_82);
  meshes["sword-grip"] = mesh_sword_grip_82;
  colliders["sword-grip"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pelvis"] ??= [];
  destructionGroups["pelvis"].push(node_sword_grip_82);

  const endpoint_sword_gem_83 = makeAttachmentEndpoint(null);
  const node_sword_gem_83 = new THREE.Group();
  node_sword_gem_83.name = "Sword pommel gem__pivot";
  node_sword_gem_83.scale.set(1, 1, 1);
  if (endpoint_sword_gem_83) {
    node_sword_gem_83.position.copy(endpoint_sword_gem_83.start);
    node_sword_gem_83.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_sword_gem_83.position.set(0.0, -0.16099999999999995, 0.0);
    node_sword_gem_83.rotation.set(0.0, 0.0, 0.0);
  }
  node_sword_gem_83.userData.sculptComponent = {"id": "sword-gem", "name": "Sword pommel gem", "level": "micro", "role": "attachment", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "sword-grip", "attachment": {"parentSocket": "sword-grip-sword-gem", "localStart": [0, 0, 0], "localEnd": [0, 0.07, 0], "contactType": "rigid-weld", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"], "anchor": "sword-grip", "anchorKind": "component", "maxOffset": 0.04, "semanticStatus": "hypothesis-requires-render-confirmation"}, "dimensions": {"width": 0.07, "height": 0.07, "depth": 0.05, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "attachment", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "sword-gem-material", "materialLayers": ["sword-gem-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "sword-gem-material.green-emission", "name": "pommel-green-gem", "kind": "emissive", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c0.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(55, 181, 102, 1)", "secondaryAlbedo": "rgba(11, 55, 30, 1)", "materialClass": "glass", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_sword_gem_83.userData.actionProfile = {"animationRole": "attachment", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}};
  (nodes["sword-grip"] ?? root).add(node_sword_gem_83);
  nodes["sword-gem"] = node_sword_gem_83;
  const mesh_sword_gem_83Geometry = endpoint_sword_gem_83
    ? new THREE.CylinderGeometry(endpoint_sword_gem_83.endRadius, endpoint_sword_gem_83.baseRadius, endpoint_sword_gem_83.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_sword_gem_83) {
    mesh_sword_gem_83Geometry.scale(0.38038, 0.24024, 0.3003);
  }
  const mesh_sword_gem_83 = new THREE.Mesh(
    mesh_sword_gem_83Geometry,
    materialMap["sword-gem-material"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sword_gem_83.name = "Sword pommel gem";
  if (endpoint_sword_gem_83) {
    mesh_sword_gem_83.position.copy(endpoint_sword_gem_83.midpoint);
    mesh_sword_gem_83.quaternion.copy(endpoint_sword_gem_83.quaternion);
  }
  mesh_sword_gem_83.castShadow = options.castShadow ?? true;
  mesh_sword_gem_83.receiveShadow = options.receiveShadow ?? true;
  mesh_sword_gem_83.userData.sculptComponent = {"id": "sword-gem", "name": "Sword pommel gem", "level": "micro", "role": "attachment", "importance": 0.78, "confidence": 0.62, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Physical-ID hypothesis; realization is selected from measured node loft/implicit decisions.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "sword-grip", "attachment": {"parentSocket": "sword-grip-sword-gem", "localStart": [0, 0, 0], "localEnd": [0, 0.07, 0], "contactType": "rigid-weld", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"], "anchor": "sword-grip", "anchorKind": "component", "maxOffset": 0.04, "semanticStatus": "hypothesis-requires-render-confirmation"}, "dimensions": {"width": 0.07, "height": 0.07, "depth": 0.05, "units": "GLB normalized", "confidence": 0.55}, "transform": {"position": [0.0, -0.16099999999999995, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [0.38038, 0.24024, 0.3003]}, "actionProfile": {"animationRole": "attachment", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pants"}}, "material": "sword-gem-material", "materialLayers": ["sword-gem-material"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "sword-gem-material.green-emission", "name": "pommel-green-gem", "kind": "emissive", "evidenceRef": "/Users/nhonh/Documents/personal/img2threejs-showcase/.img2threejs/runs/regret-warrior-reconstruction-05a01688e89d-20260822T081126Z/evidence/detail-inventory/zone-r1c0.png", "status": "specified-pending-render-confirmation"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(55, 181, 102, 1)", "secondaryAlbedo": "rgba(11, 55, 30, 1)", "materialClass": "glass", "materialClassConfidence": 0.78, "evidence": ["glb-spec-inventory.json", "evidence/reference-admission.json"], "samplingNotes": "Class and palette are a render-confirmation hypothesis linked to embedded GLB texture hashes; the non-admitted promotional JPEG supplies qualitative identity only."}};
  node_sword_gem_83.add(mesh_sword_gem_83);
  meshes["sword-gem"] = mesh_sword_gem_83;
  colliders["sword-gem"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pelvis"] ??= [];
  destructionGroups["pelvis"].push(node_sword_gem_83);

  // repetition system: hair-lock-array (InstancedMesh, radial, count=18, level=meso)
  {
    const parent = nodes["root"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
    const mat = materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.1, 0.1, 0.1];
    const axis = new THREE.Vector3(0.0, 0.0, 1.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 18);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 18; i++) {
      const ang = ((0.0) + (i * 360) / 18) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "hair-lock-array";
    parent.add(cluster);
  }

  // repetition system: upper-arm-fasteners (InstancedMesh, radial, count=8, level=meso)
  {
    const parent = nodes["root"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
    const mat = materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.1, 0.1, 0.1];
    const axis = new THREE.Vector3(0.0, 0.0, 1.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 8);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 8; i++) {
      const ang = ((0.0) + (i * 360) / 8) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "upper-arm-fasteners";
    parent.add(cluster);
  }

  // repetition system: buckle-ladders (InstancedMesh, radial, count=4, level=meso)
  {
    const parent = nodes["root"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
    const mat = materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.1, 0.1, 0.1];
    const axis = new THREE.Vector3(0.0, 0.0, 1.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 4);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 4; i++) {
      const ang = ((0.0) + (i * 360) / 4) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "buckle-ladders";
    parent.add(cluster);
  }

  // repetition system: finger-plate-array (InstancedMesh, radial, count=3, level=meso)
  {
    const parent = nodes["root"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
    const mat = materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.1, 0.1, 0.1];
    const axis = new THREE.Vector3(0.0, 0.0, 1.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 3);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 3; i++) {
      const ang = ((0.0) + (i * 360) / 3) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "finger-plate-array";
    parent.add(cluster);
  }

  // repetition system: sword-grip-wrap (InstancedMesh, radial, count=14, level=meso)
  {
    const parent = nodes["root"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
    const mat = materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.1, 0.1, 0.1];
    const axis = new THREE.Vector3(0.0, 0.0, 1.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 14);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 14; i++) {
      const ang = ((0.0) + (i * 360) / 14) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "sword-grip-wrap";
    parent.add(cluster);
  }

  // repetition system: trouser-fold-bands (InstancedMesh, radial, count=7, level=meso)
  {
    const parent = nodes["root"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
    const mat = materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.1, 0.1, 0.1];
    const axis = new THREE.Vector3(0.0, 0.0, 1.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 7);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 7; i++) {
      const ang = ((0.0) + (i * 360) / 7) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "trouser-fold-bands";
    parent.add(cluster);
  }

  // standProud: hold these components outside the surfaces they cover.
  if (meshes["hair"] && nodes["head"]) {
    applyStandProud(
      meshes["hair"].geometry,
      meshes["hair"],
      nodes["head"],
      {"rings": [[-0.15680000000000002, 2.5760000000000007e-05, 2.7440000000000005e-05, 0.0], [-0.13066677120000003, 0.07119677600000002, 0.07584004400000001, 0.0], [-0.10453322880000002, 0.09600185280000002, 0.10226284320000001, 0.0], [-0.07840000000000001, 0.11154414880000002, 0.11881876720000001, 0.0], [-0.05226677120000001, 0.12143392800000002, 0.12935353200000002, 0.0], [-0.026133228800000005, 0.12699860320000003, 0.13528112080000002, 0.0], [0.0, 0.12880000000000003, 0.13720000000000002, 0.0], [0.026133228800000005, 0.12699860320000003, 0.13528112080000002, 0.0], [0.05226677120000001, 0.12143392800000002, 0.12935353200000002, 0.0], [0.07840000000000001, 0.11154414880000002, 0.11881876720000001, 0.0], [0.10453322880000002, 0.09600185280000002, 0.10226284320000001, 0.0], [0.13066677120000003, 0.07119677600000002, 0.07584004400000001, 0.0], [0.15680000000000002, 2.5760000000000007e-05, 2.7440000000000005e-05, 0.0]]},
      0.004,
      0.012,
    );
  }

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createRegretWarriorLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Regret Warrior look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = ["key DirectionalLight direction [4,6,5] intensity 3.2", "fill HemisphereLight intensity 1.4", "rim DirectionalLight direction [-4,3,-5] intensity 2.0", "neutral procedural environment with ACES filmic tone mapping and exposure 1.0", "ground contact shadow receiver opacity 0.24"];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createRegretWarriorEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameRegretWarriorCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createRegretWarriorPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureRegretWarriorRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createRegretWarriorInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
