import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type AWPV2Options = {
  shadows?: boolean;
  wireframe?: boolean;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

type MaterialSet = {
  shell: THREE.MeshPhysicalMaterial;
  metal: THREE.MeshPhysicalMaterial;
  steel: THREE.MeshPhysicalMaterial;
  glass: THREE.MeshPhysicalMaterial;
  rubber: THREE.MeshPhysicalMaterial;
  foil: THREE.MeshPhysicalMaterial;
  black: THREE.MeshPhysicalMaterial;
};

type Runtime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Array<{ id: string; type: 'box'; min: THREE.Vector3; max: THREE.Vector3 }>;
  colliderById: Record<string, THREE.Box3>;
  adjacency: Array<Record<string, unknown>>;
  attachmentGate: Record<string, unknown>;
  attachmentAudit: Record<string, unknown>;
  destructionGroups: Record<string, string[]>;
  logicalComponents: Record<string, { kind: string; binding: string; boundMeshes: string[] }>;
};

const X_REAR = -5.2;
const Z_SHELL = 0.34;

function material(color: number, roughness: number, metalness: number, options: AWPV2Options, extra: Partial<THREE.MeshPhysicalMaterialParameters> = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness,
    metalness,
    clearcoat: metalness > 0.5 ? 0.18 : 0.3,
    clearcoatRoughness: 0.18,
    wireframe: options.wireframe ?? false,
    ...extra,
  });
}

function makeMaterials(options: AWPV2Options): MaterialSet {
  return {
    shell: material(0x07152b, 0.29, 0.04, options, { sheen: 0.08, sheenColor: new THREE.Color(0x123a62) }),
    metal: material(0x1c222b, 0.31, 0.91, options),
    steel: material(0x7d8790, 0.25, 0.96, options),
    glass: material(0x07131d, 0.07, 0.02, options, {
      clearcoat: 1,
      clearcoatRoughness: 0.035,
      transmission: 0.12,
      ior: 1.5,
      envMapIntensity: 1.8,
    }),
    rubber: material(0x0b0d12, 0.78, 0.0, options),
    foil: material(0xc18b22, 0.12, 0.92, options, { clearcoat: 0.9, clearcoatRoughness: 0.08 }),
    black: material(0x020305, 0.46, 0.15, options),
  };
}

function profileGeometry(points: Array<[number, number]>, depth: number, holes: Array<Array<[number, number]>> = [], bevel = 0.025): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  for (const loop of holes) {
    const hole = new THREE.Path();
    hole.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i += 1) hole.lineTo(loop[i][0], loop[i][1]);
    hole.closePath();
    shape.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 2,
    bevelEnabled: bevel > 0,
    bevelSegments: 3,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 8,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function stockProfileGeometry(depth: number, hole: Array<[number, number]>, bevel = 0.055): THREE.ExtrudeGeometry {
  // The stock lower edge is a molded composite contour, not a faceted wedge.
  // Use real 2D quadratic segments before extrusion so the resulting shell
  // stays editable and the curvature survives three-quarter inspection.
  const shape = new THREE.Shape();
  // The shell top sits below the optic's mount line in the admitted plates;
  // keep the cheek/stock shoulder lower instead of letting it merge into the
  // scope silhouette at the top of the fixed broadside frame.
  // Loop-104 hypothesis: alpha-column measurements place the visible stock
  // crown about 0.10–0.17 world units above the retained pass-103 shell from
  // the butt/cheek shoulder through the thumbhole approach. Refit only this
  // upper ownership boundary; the lower contour, hole, buttpad, and all
  // receiver/action stations remain fixed.
  shape.moveTo(X_REAR, 0.52);
  shape.lineTo(-4.82, 0.64);
  shape.lineTo(-4.05, 0.68);
  shape.lineTo(-3.60, 0.63);
  shape.lineTo(-2.72, 0.59);
  shape.lineTo(-2.55, 0.60);
  shape.lineTo(-2.47, 0.46);
  shape.lineTo(-2.52, 0.20);
  shape.quadraticCurveTo(-2.62, 0.06, -2.76, -0.10);
  shape.quadraticCurveTo(-2.88, -0.30, -3.06, -0.39);
  shape.quadraticCurveTo(-3.21, -0.43, -3.37, -0.36);
  shape.quadraticCurveTo(-3.54, -0.25, -3.70, -0.20);
  shape.quadraticCurveTo(-3.88, -0.21, -4.08, -0.30);
  // The butt transitions upward shortly after the pad; a long flat-low tail
  // overfills the source silhouette in the rear lower quadrant.
  shape.lineTo(-4.20, -0.18);
  shape.lineTo(-4.88, -0.42);
  shape.lineTo(X_REAR, -0.45);
  shape.closePath();
  const holePath = new THREE.Path();
  holePath.moveTo(hole[0][0], hole[0][1]);
  for (let i = 1; i < hole.length; i += 1) holePath.lineTo(hole[i][0], hole[i][1]);
  holePath.closePath();
  shape.holes.push(holePath);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 2,
    bevelEnabled: bevel > 0,
    bevelSegments: 3,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 12,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function stockPistolGripFilletGeometry(depth: number, bevel = 0.035): THREE.ExtrudeGeometry {
  // A separate shell-side receiving fillet closes the transition from the
  // action underside into the trigger guard/pistol-grip area. It is kept as
  // real curved volume so the guard cannot appear to float against a flat
  // receiver slab in orbit views.
  const shape = new THREE.Shape();
  // The source crop shows the trigger guard framed by the molded stock shell,
  // not by a large circular cheek/bulb behind it. Keep a narrow receiving
  // fillet around the guard bridge and let the stock profile own the lower
  // silhouette. This is a profile correction only; the guard station/pivot
  // and its physical overlap remain unchanged.
  // Loop-112 construction hypothesis: the supplied close-up shows a narrow
  // molded receiving fillet around the guard, not a broad secondary grip
  // volume. Shrink the X envelope and seat the thinner shell toward the
  // near-side guard without changing the stock outer silhouette.
  shape.moveTo(-2.40, 0.25);
  shape.lineTo(-2.16, 0.25);
  shape.quadraticCurveTo(-2.10, 0.23, -2.10, 0.17);
  shape.quadraticCurveTo(-2.11, 0.11, -2.17, 0.085);
  shape.quadraticCurveTo(-2.25, 0.06, -2.33, 0.10);
  shape.quadraticCurveTo(-2.40, 0.15, -2.40, 0.25);
  shape.closePath();
  // Loop-120 topology correction: leave a real center opening for the
  // trigger blade and guard. Without this hole the narrowed fillet still
  // occludes the centerline mechanism in three-quarter views.
  const triggerClearance = new THREE.Path();
  triggerClearance.moveTo(-2.36, 0.22);
  triggerClearance.lineTo(-2.20, 0.22);
  triggerClearance.quadraticCurveTo(-2.17, 0.22, -2.17, 0.19);
  triggerClearance.lineTo(-2.17, 0.14);
  triggerClearance.quadraticCurveTo(-2.17, 0.11, -2.20, 0.11);
  triggerClearance.lineTo(-2.36, 0.11);
  triggerClearance.quadraticCurveTo(-2.39, 0.11, -2.39, 0.14);
  triggerClearance.lineTo(-2.39, 0.19);
  triggerClearance.quadraticCurveTo(-2.39, 0.22, -2.36, 0.22);
  triggerClearance.closePath();
  shape.holes.push(triggerClearance);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 2,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 12,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function ellipseLoop(cx: number, cy: number, width: number, height: number, segments = 24): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    points.push([
      cx + Math.cos(angle) * width * 0.5,
      cy + Math.sin(angle) * height * 0.5,
    ]);
  }
  return points;
}

function roundedBox(width: number, height: number, depth: number, radius: number, materialValue: THREE.Material, segments = 4): THREE.Mesh {
  const shape = new THREE.Shape();
  const x = width / 2;
  const y = height / 2;
  const r = Math.min(radius, x, y);
  shape.moveTo(-x + r, -y);
  shape.lineTo(x - r, -y);
  shape.quadraticCurveTo(x, -y, x, -y + r);
  shape.lineTo(x, y - r);
  shape.quadraticCurveTo(x, y, x - r, y);
  shape.lineTo(-x + r, y);
  shape.quadraticCurveTo(-x, y, -x, y - r);
  shape.lineTo(-x, -y + r);
  shape.quadraticCurveTo(-x, -y, -x + r, -y);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: segments,
    bevelSize: Math.min(radius * 0.32, depth * 0.18),
    bevelThickness: Math.min(radius * 0.32, depth * 0.18),
    curveSegments: segments,
  });
  geometry.translate(0, 0, -depth / 2);
  const mesh = new THREE.Mesh(geometry, materialValue);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function tubeBetween(a: THREE.Vector3, b: THREE.Vector3, radius: number, materialValue: THREE.Material, radialSegments = 16): THREE.Mesh {
  const direction = b.clone().sub(a);
  const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), radialSegments, 2);
  const mesh = new THREE.Mesh(geometry, materialValue);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cylinderX(x: number, length: number, radius: number, materialValue: THREE.Material, radiusRight = radius): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(radius, radiusRight, length, 32, 2);
  const mesh = new THREE.Mesh(geometry, materialValue);
  mesh.rotation.z = -Math.PI / 2;
  mesh.position.x = x;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cylinderY(x: number, y: number, z: number, length: number, radius: number, materialValue: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 32, 2), materialValue);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cylinderZ(x: number, y: number, z: number, length: number, radius: number, materialValue: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 24, 2), materialValue);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function conformObjectiveDecalGeometry(
  geometry: THREE.BufferGeometry,
  child: THREE.Object3D,
  stickerX = 1.10,
  stickerY = 0.015,
  verticalScale = 0.82,
): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const taperMinX = stickerX - 0.36;
  const taperMaxX = stickerX + 0.36;
  const taperRadiusAt = (x: number): number => {
    const t = THREE.MathUtils.clamp((x - taperMinX) / (taperMaxX - taperMinX), 0, 1);
    return THREE.MathUtils.lerp(0.30, 0.235, t);
  };
  for (let index = 0; index < position.count; index += 1) {
    const localX = position.getX(index);
    const scaledLocalY = position.getY(index) * verticalScale;
    const surfaceX = stickerX - (child.position.x + localX);
    const surfaceRadius = taperRadiusAt(surfaceX);
    const requestedSurfaceY = stickerY + child.position.y + scaledLocalY;
    const surfaceY = THREE.MathUtils.clamp(requestedSurfaceY, -surfaceRadius + 0.002, surfaceRadius - 0.002);
    const adjustedLocalY = surfaceY - stickerY - child.position.y;
    const depth = Math.sqrt(Math.max(0, surfaceRadius * surfaceRadius - surfaceY * surfaceY));
    const surfaceZ = -depth - 0.003;
    // The sticker Group reverses its normal with rotation.y = PI, so negate
    // the scope-local surface z when authoring the child geometry.
    position.setY(index, adjustedLocalY);
    position.setZ(index, -surfaceZ - child.position.z);
  }
  const normal = geometry.getAttribute('normal');
  const radiusSlope = (0.235 - 0.30) / 0.72;
  for (let index = 0; index < position.count; index += 1) {
    const surfaceX = stickerX - (child.position.x + position.getX(index));
    const radius = taperRadiusAt(surfaceX);
    const surfaceY = stickerY + child.position.y + position.getY(index);
    const surfaceZ = -(Math.sqrt(Math.max(0, radius * radius - surfaceY * surfaceY)));
    // The sticker group rotates by PI around Y. Author the inverse normal in
    // child-local space so the world normal points along the actual negative-Z
    // frustum surface rather than the original planar primitive normal.
    const normalX = -radius * radiusSlope;
    const normalY = surfaceY;
    const normalZ = surfaceZ;
    const length = Math.hypot(normalX, normalY, normalZ) || 1;
    normal.setXYZ(index, -normalX / length, normalY / length, -normalZ / length);
  }
  normal.needsUpdate = true;
  position.needsUpdate = true;
  geometry.computeBoundingBox();
  return geometry;
}

function addPart(parent: THREE.Object3D, id: string, mesh: THREE.Mesh, runtime: Runtime): THREE.Group {
  const group = new THREE.Group();
  group.name = id;
  // The viewer's part manifest enumerates selectable meshes, not empty parent
  // Groups, so the mesh carries the semantic component id.
  mesh.name = id;
  group.add(mesh);
  parent.add(group);
  runtime.nodes[id] = group;
  runtime.meshes[id] = mesh;
  return group;
}

function addSocket(parent: THREE.Object3D, id: string, position: THREE.Vector3, axis: THREE.Vector3, runtime: Runtime): THREE.Object3D {
  const socket = new THREE.Object3D();
  socket.name = id;
  socket.position.copy(position);
  socket.userData.socket = { id, axis: axis.toArray() };
  parent.add(socket);
  runtime.sockets[id] = socket;
  return socket;
}

function addFastener(parent: THREE.Object3D, name: string, x: number, y: number, z: number, radius: number, mats: MaterialSet, runtime: Runtime): void {
  const fastener = cylinderZ(x, y, z, 0.075, radius, mats.steel);
  fastener.name = name;
  parent.add(fastener);
  runtime.meshes[name] = fastener;
}

function addScopeHexFastener(parent: THREE.Object3D, name: string, x: number, y: number, z: number, radius: number, mats: MaterialSet, runtime: Runtime): void {
  const fastener = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.075, 6, 1), mats.steel);
  fastener.name = name;
  fastener.rotation.x = Math.PI / 2;
  fastener.position.set(x, y, z);
  fastener.castShadow = true;
  fastener.receiveShadow = true;
  parent.add(fastener);
  runtime.meshes[name] = fastener;
}

function addRail(parent: THREE.Object3D, mats: MaterialSet, runtime: Runtime): void {
  // Pass-155 scope-mount hypothesis: the retained rail was shifted toward the
  // muzzle and overlong. Its rear edge stopped before the rear scope saddle,
  // while the large teeth overfilled the source mount envelope. Register a
  // shorter rail beneath both measured ring stations; do not move the optic
  // tube or alter the receiver shell in this family.
  const rail = roundedBox(2.20, 0.10, 0.34, 0.018, mats.metal, 3);
  rail.name = 'receiver-top-rail';
  rail.position.set(-1.25, 0.65, 0);
  parent.add(rail);
  // Diagnostic registration only: preserve the retained pass-128 geometry and
  // transforms while allowing the measurement probe to isolate the rail owner.
  runtime.meshes[rail.name] = rail;
  for (let i = 0; i < 12; i += 1) {
    const tooth = roundedBox(0.10, 0.06, 0.36, 0.012, mats.steel, 2);
    tooth.name = `rail-tooth-${i + 1}`;
    tooth.position.set(-2.23 + i * 0.18, 0.73, 0);
    parent.add(tooth);
    runtime.meshes[tooth.name] = tooth;
  }
}

function addScope(parent: THREE.Object3D, mats: MaterialSet, runtime: Runtime): THREE.Group {
  const group = new THREE.Group();
  group.name = 'scope';
  // The source optic sits low against the rail; the previous 1.14 station made
  // the objective and rings visibly float above the receiver in broadside view.
  // The source optic sits low against the rail; the previous 1.14 station made
  // the objective and rings visibly float above the receiver in broadside view.
  // Calibrated source fit: the prior vertical raise caused a large broadside
  // framing regression, so the optic remains at the measured station.
  group.position.set(-1.58, 1.03, 0);
  parent.add(group);
  runtime.nodes.scope = group;

  // Loop-101 construction hypothesis: the ocular housing and rear lip are
  // slimmer than the current broad cylinder in the source crop. Keep its
  // axial station, collar and recessed real glass fixed; reduce only the
  // ocular radial profile, leaving the reflective material locked until the
  // macro silhouette gate permits look-dev work.
  addPart(group, 'scope-eyepiece', cylinderX(-1.12, 0.56, 0.19, mats.metal, 0.215), runtime);
  const ocularRim = new THREE.Mesh(new THREE.TorusGeometry(0.195, 0.028, 12, 36), mats.steel);
  ocularRim.rotation.y = Math.PI / 2;
  ocularRim.position.x = -1.28;
  group.add(ocularRim);
  const ocularGlass = addPart(group, 'scope-glass-eyepiece', cylinderX(-1.26, 0.018, 0.155, mats.glass), runtime);
  ocularGlass.position.z = 0;

  // The front station correction is only valid when the optic remains one
  // continuous tube. Preserve the ocular-side endpoint and extend the main
  // tube forward to overlap the moved taper by a small physical margin.
  addPart(group, 'scope-main-tube', cylinderX(0.12, 1.45, 0.235, mats.metal), runtime);
  // Bridge the ocular and main tube with a real sleeve. The two broadside
  // references show one continuous optic body; leaving this as two touching
  // silhouettes creates a visible floating component in orbit views.
  addPart(group, 'scope-ocular-collar', cylinderX(-0.62, 0.52, 0.244, mats.metal), runtime);
  // Pass-96 construction hypothesis: the source objective bell is slimmer
  // than the former over-sized frustum. Keep the axial station and all ring
  // hardware fixed; reduce only the bell/rim/recessed-glass profile together.
  addPart(group, 'scope-objective-taper', cylinderX(1.10, 0.72, 0.235, mats.metal, 0.30), runtime);
  const objectiveRim = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.045, 12, 48), mats.steel);
  objectiveRim.rotation.y = Math.PI / 2;
  objectiveRim.position.x = 1.48;
  group.add(objectiveRim);
  // Keep each lens as one recessed physical surface. The old duplicate
  // eyepiece mesh occupied the same station and could z-fight in orbit views.
  addPart(group, 'scope-objective-glass', cylinderX(1.43, 0.018, 0.255, mats.glass), runtime);

  const turretHousing = addPart(group, 'scope-turret-housing', cylinderX(-0.18, 0.46, 0.30, mats.metal), runtime);
  turretHousing.userData.role = 'central-machined-turret-housing';
  const turretShoulder = cylinderY(-0.18, 0.14, 0, 0.16, 0.21, mats.metal);
  turretShoulder.name = 'scope-turret-shoulder';
  group.add(turretShoulder);
  runtime.meshes['scope-turret-shoulder'] = turretShoulder;

  // Pass-155 station registration: the admitted landmarks place the rings
  // farther apart than the retained blockout. These X stations keep the
  // optic tube fixed while seating both saddles over the corrected rail.
  for (const [id, x] of [['scope-ring-rear', -0.72], ['scope-ring-front', 0.45]] as const) {
    // Real scope rings are split clamps, not a single uninterrupted decorative
    // torus. Two opposed half-rings leave a controlled clamp seam while the
    // saddle and cap remain separate hardware at the same station.
    // Pass-91 construction hypothesis: the source ring is a thin split clamp
    // carried by a chamfered U-saddle, not a stack of rectangular blocks. Keep
    // the tube/ring station fixed and change only the support profile.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.225, 0.014, 16, 32, Math.PI - 0.16), mats.steel);
    ring.rotation.y = Math.PI / 2;
    const ringGroup = addPart(group, id, ring, runtime);
    const lowerRing = new THREE.Mesh(new THREE.TorusGeometry(0.225, 0.014, 16, 32, Math.PI - 0.16), mats.steel);
    lowerRing.name = `${id}-lower-half`;
    lowerRing.rotation.set(Math.PI, Math.PI / 2, 0);
    ringGroup.add(lowerRing);
    runtime.meshes[`${id}-lower-half`] = lowerRing;
    // Keep the ring's authored station on the component group so its saddle
    // and real fasteners inherit the same transform. Previously only the torus
    // carried x, leaving the mount blocks at the scope group's origin.
    ringGroup.position.x = x;
    ring.position.x = 0;
    // The source shows a narrow U-shaped saddle under each split ring. A
    // single solid block made the mount read as a floating LEGO cube in orbit;
    // keep the ring station unchanged and build the support from two real
    // cheek posts plus the cap that seats on the rail.
    for (const [suffix, z] of [['near', -0.14], ['far', 0.14]] as const) {
      const saddlePostGeometry = profileGeometry([
        [-0.0425, -0.12],
        [0.0425, -0.12],
        [0.036, -0.075],
        [0.028, -0.035],
        [0.028, 0.075],
        [0.022, 0.12],
        [-0.022, 0.12],
        [-0.028, 0.075],
        [-0.028, -0.035],
        [-0.036, -0.075],
      ], 0.05, [], 0.012);
      const saddlePost = new THREE.Mesh(saddlePostGeometry, mats.metal);
      saddlePost.castShadow = true;
      saddlePost.receiveShadow = true;
      saddlePost.name = `${id}-${suffix}-saddle-post`;
      saddlePost.position.set(0, -0.27, z);
      ringGroup.add(saddlePost);
      runtime.meshes[saddlePost.name] = saddlePost;
    }
    const clampCap = roundedBox(0.085, 0.045, 0.32, 0.012, mats.metal, 3);
    clampCap.name = `${id}-clamp-cap`;
    clampCap.position.set(0, 0.20, 0);
    ringGroup.add(clampCap);
    const clampPlateGeometry = profileGeometry([
      [-0.0375, -0.13],
      [0.0375, -0.13],
      [0.045, -0.085],
      [0.029, -0.035],
      [0.029, 0.075],
      [0.041, 0.13],
      [-0.041, 0.13],
      [-0.029, 0.075],
      [-0.029, -0.035],
      [-0.045, -0.085],
    ], 0.035, [], 0.012);
    const clampPlate = new THREE.Mesh(clampPlateGeometry, mats.steel);
    clampPlate.castShadow = true;
    clampPlate.receiveShadow = true;
    clampPlate.name = `${id}-clamp-plate`;
    clampPlate.position.set(0, -0.015, 0.25);
    ringGroup.add(clampPlate);
    runtime.meshes[`${id}-clamp-plate`] = clampPlate;
    addScopeHexFastener(ringGroup, `${id}-front-fastener`, 0, -0.28, 0.195, 0.022, mats, runtime);
    addScopeHexFastener(ringGroup, `${id}-back-fastener`, 0, -0.28, -0.195, 0.022, mats, runtime);
    addScopeHexFastener(ringGroup, `${id}-upper-fastener`, 0, 0.10, 0.275, 0.020, mats, runtime);
    addScopeHexFastener(ringGroup, `${id}-lower-fastener`, 0, -0.10, 0.275, 0.020, mats, runtime);
  }

  const turret = cylinderY(-0.18, 0.32, 0, 0.28, 0.15, mats.metal);
  turret.name = 'scope-turret-main';
  group.add(turret);
  for (let i = 0; i < 16; i += 1) {
    const notch = roundedBox(0.025, 0.16, 0.025, 0.004, mats.steel, 1);
    const angle = (i / 16) * Math.PI * 2;
    notch.position.set(-0.18 + Math.cos(angle) * 0.15, 0.32, Math.sin(angle) * 0.15);
    group.add(notch);
  }
  const sideTurret = cylinderZ(-0.18, 0.08, 0.29, 0.22, 0.12, mats.metal);
  sideTurret.name = 'scope-turret-side';
  group.add(sideTurret);

  // The foil is a thin, attached side decal. It is geometry on the taper surface,
  // not a floating badge and not used to establish the optic silhouette.
  const sticker = new THREE.Group();
  sticker.name = 'crown-skull-sticker';
  // The crown/skull is visible on the opposing broadside. Keep it on the
  // negative-Z shell and reverse the decal normal so the crown remains above
  // the skull when viewed from that side.
  // Pass-150 correction: the sticker is a thin surface conforming to the
  // negative-Z objective frustum, not a planar badge translated through it.
  sticker.position.set(1.10, 0.015, 0);
  sticker.rotation.y = Math.PI;
  const crownShape = new THREE.Shape();
  crownShape.moveTo(-0.18, -0.03);
  crownShape.lineTo(-0.13, 0.12);
  crownShape.lineTo(-0.05, 0.06);
  crownShape.lineTo(0.02, 0.16);
  crownShape.lineTo(0.09, 0.06);
  crownShape.lineTo(0.18, 0.13);
  crownShape.lineTo(0.15, -0.05);
  crownShape.closePath();
  const crown = new THREE.Mesh(new THREE.ShapeGeometry(crownShape), mats.foil);
  crown.position.y = 0.10;
  conformObjectiveDecalGeometry(crown.geometry, crown, sticker.position.x, sticker.position.y);
  sticker.add(crown);
  const skull = new THREE.Mesh(new THREE.CircleGeometry(0.11, 24), mats.foil);
  skull.position.y = -0.07;
  conformObjectiveDecalGeometry(skull.geometry, skull, sticker.position.x, sticker.position.y);
  sticker.add(skull);
  for (const x of [-0.04, 0.04]) {
    const eye = new THREE.Mesh(new THREE.CircleGeometry(0.018, 12), mats.black);
    eye.position.set(x, -0.05, 0.002);
    conformObjectiveDecalGeometry(eye.geometry, eye, sticker.position.x, sticker.position.y);
    sticker.add(eye);
  }
  group.add(sticker);
  runtime.nodes['crown-skull-sticker'] = sticker;
  return group;
}

function addBolt(parent: THREE.Object3D, mats: MaterialSet, runtime: Runtime): void {
  // Loop-118 construction contract: this is a receiver-parented bolt-action
  // assembly, not a loose lever. The raceway stays with the receiver; the
  // sliding bolt sleeve owns the handle-root socket; body, handle and knob
  // share one cycle transform while the handle root owns its own lift hinge.
  // The source crop places the handle immediately behind the rear scope
  // saddle, with a long down-and-rearward lever below the optic. The lever
  // is a near-side mechanism; do not mirror it onto the far side just to make
  // a top camera reveal it.
  const raceway = addPart(parent, 'bolt-raceway', new THREE.Mesh(
    roundedBox(1.42, 0.10, 0.30, 0.018, mats.black, 3).geometry,
    mats.black,
  ), runtime);
  // The bolt axis shares the barrel/rail centerline. The earlier z=0.28
  // placement put the entire sleeve on the near side of the receiver, so the
  // action read as a silver floating block instead of a seated mechanism.
  raceway.position.set(-1.52, 0.54, 0);
  raceway.userData.role = 'receiver-integrated-bolt-raceway-guide';

  const pivot = new THREE.Group();
  pivot.name = 'bolt';
  const basePosition = new THREE.Vector3(-2.24, 0.57, 0);
  pivot.position.copy(basePosition);
  pivot.userData.role = 'receiver-parented-functional-bolt-action';
  pivot.userData.control = {
    type: 'bolt-action',
    travelAxis: 'x',
    travelRange: 0.12,
    lockRotationAxis: 'z',
    lockRotationRange: 0.16,
    receiverInterface: 'bolt-raceway',
    handleRootSocket: 'bolt-handle-root',
    handleSide: 'near-side-positive-z',
  };
  parent.add(pivot);
  runtime.nodes.bolt = pivot;

  // The sleeve begins at the handle root and runs forward inside the static
  // raceway. In the source crop the moving bolt is a compact coaxial machined
  // cylinder; the earlier long rectangular slab made the action read as a
  // floating box and hid the actual receiver-side relief. Keep the moving
  // part concentric with the barrel/rail axis and let the small upper shroud
  // provide the visible flat machining edge.
  const body = addPart(pivot, 'bolt-body', cylinderX(0, 0.86, 0.145, mats.steel, 0.155), runtime);
  body.position.set(0.58, 0, 0);
  body.userData.role = 'coaxial-sliding-bolt-sleeve-inside-receiver-raceway';

  // Loop-125 visibility/form correction: the source shows a bright machined
  // bolt head/action block immediately below the rear scope saddle. A dark
  // low shroud made the previous pass read as only a floating side boss from
  // the top stress view. Keep the moving pieces body-owned and overlapping;
  // make the visible metal station read as one seated action assembly.
  const shroud = addPart(body, 'bolt-shroud', new THREE.Mesh(
    roundedBox(0.62, 0.22, 0.28, 0.024, mats.steel, 4).geometry,
    mats.steel,
  ), runtime);
  // Source-crop station: the visible action block terminates at the same rear
  // face as the handle-root socket. Keep the height small enough to remain a
  // machined receiver detail, but expose its upper edge above the receiver so
  // the component is observable in the top/three-quarter stress views.
  shroud.position.set(-0.31, 0.17, 0);
  shroud.userData.role = 'rear-face-sliding-bolt-shroud-seated-at-handle-station';
  shroud.userData.contact = 'overlaps bolt-body and receiver raceway while cycling';

  // The rear face is a short squared bolt-head/cocking block, not empty space
  // behind the round sleeve. It is deliberately a child of the moving body:
  // it seats into the receiver relief, remains attached while cycling, and
  // provides the real upper/side silhouette visible around the scope mount.
  const headBlock = addPart(body, 'bolt-head-block', new THREE.Mesh(
    roundedBox(0.24, 0.30, 0.34, 0.026, mats.steel, 4).geometry,
    mats.steel,
  ), runtime);
  // The block straddles the receiver wall: its rear half is embedded, while
  // its near face reaches the same z station as the hinge boss. Pass-128
  // observability correction: the prior z=.16 placement was physically
  // seated but disappeared behind the receiver in the top stress view. Move
  // only the block's near-side station to z=.23; it still overlaps the body,
  // sleeve and receiver relief, but its machined face is now readable.
  headBlock.position.set(-0.53, 0.08, 0.23);
  headBlock.userData.role = 'machined-rear-bolt-head-cocking-block';
  headBlock.userData.contact = 'overlaps bolt-shroud, bolt-body and receiver handle relief';
  headBlock.userData.attachment = {
    parent: 'bolt-body',
    parentSocket: 'bolt-handle-root',
    contactType: 'embedded-overlap',
    embedDepth: 0.16,
    overlap: 0.02,
    gapTolerance: 0.015,
  };

  // Loop-123 source-crop correction: the side opening contains a short round
  // machined boss for the handle hinge, not a second rectangular receiver
  // slab. Keep it as a child of the coaxial sleeve so it remains attached
  // during the cycle and overlaps both the embedded receiver pocket and the
  // hinge root. It is not a second free-floating bolt.
  const sideSleeve = addPart(body, 'bolt-side-sleeve', new THREE.Mesh(
    new THREE.CylinderGeometry(0.105, 0.105, 0.28, 24, 2),
    mats.steel,
  ), runtime);
  sideSleeve.rotation.x = Math.PI / 2;
  // The receiver-side relief is on the near face at about z=.34. The boss
  // runs from the cylindrical bolt surface into that relief and shares the
  // rear station with the hinge socket; its circular profile remains visible
  // without turning the action into a side-mounted box.
  sideSleeve.position.set(-0.52, 0.02, 0.30);
  sideSleeve.userData.role = 'near-side-round-bolt-hinge-boss-seated-in-receiver-relief';
  sideSleeve.userData.contact = 'child of coaxial bolt-body; circular boss overlaps receiver relief and hinge root';

  const rearCollar = roundedBox(0.12, 0.23, 0.32, 0.018, mats.metal, 3);
  rearCollar.name = 'bolt-rear-collar';
  rearCollar.position.set(0.08, 0, 0);
  body.add(rearCollar);
  runtime.meshes[rearCollar.name] = rearCollar;
  const lockingLug = roundedBox(0.14, 0.25, 0.34, 0.018, mats.steel, 3);
  lockingLug.name = 'bolt-locking-lug';
  lockingLug.position.set(1.00, 0, 0);
  body.add(lockingLug);
  runtime.meshes[lockingLug.name] = lockingLug;

  // The handle root is a real transverse pin/socket on the REAR face of the
  // bolt body. The body group's local rear face is x=-.58; the previous x=0
  // station put the root in the middle of the receiver and behind the shell.
  // Everything below this socket inherits the bolt cycle transform, while the
  // root itself can lift about its transverse hinge before the sleeve pulls.
  // The sleeve/body stay coaxial with the action, while the hinge pin bridges
  // the sleeve to the receiver's near-side wall. Keeping the lever at the
  // positive-Z surface is important: at z=.20 it was buried inside the
  // receiver shell and read as a perpendicular block fused into the body.
  const handleRoot = addSocket(body, 'bolt-handle-root', new THREE.Vector3(-0.58, 0, 0.42), new THREE.Vector3(0, 0, 1), runtime);
  handleRoot.userData.role = 'transverse-bolt-handle-hinge';
  handleRoot.userData.control = {
    type: 'grip-and-cycle',
    degreesOfFreedom: ['lift-about-z', 'pull-along-x'],
    implementedDegreesOfFreedom: ['lift-about-z', 'pull-along-x'],
    parentControl: 'bolt-action',
    gripMesh: 'bolt-knob',
    pullAxis: 'x',
    liftAxis: 'z',
    hingeRange: 0.45,
  };
  const hingePin = cylinderZ(0, 0, 0, 0.24, 0.048, mats.steel);
  hingePin.name = 'bolt-handle-pivot-pin';
  handleRoot.add(hingePin);
  runtime.meshes[hingePin.name] = hingePin;
  runtime.nodes['bolt-handle'] = handleRoot;

  // Loop-121/125 source-crop correction: the root-to-knob vector travels down
  // and toward the stock/rear (negative X), not toward the muzzle. The longer
  // rearward arc restores the hand clearance visible in the source crop while
  // remaining a single near-side lever; do not mirror it for the top camera.
  const handlePath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.00, 0.00, 0),
    new THREE.Vector3(-0.08, -0.04, 0),
    new THREE.Vector3(-0.17, -0.14, 0),
    new THREE.Vector3(-0.34, -0.29, 0),
    new THREE.Vector3(-0.45, -0.36, 0),
  ]);
  const handle = new THREE.Mesh(new THREE.TubeGeometry(handlePath, 24, 0.040, 12, false), mats.steel);
  handle.name = 'bolt-handle';
  handle.userData.role = 'long-downward-rearward-bolt-lever';
  handle.userData.function = 'transmit-grip-force-to-bolt-sleeve';
  handleRoot.add(handle);
  runtime.meshes['bolt-handle'] = handle;
  // Loop-117 hardware correction: the grip ball transitions through a short
  // tapered neck instead of terminating directly on the constant-radius tube.
  const neckStart = new THREE.Vector3(-0.39, -0.32, 0);
  const neckEnd = new THREE.Vector3(-0.50, -0.42, 0);
  const neckDirection = neckEnd.clone().sub(neckStart);
  const knobNeck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.074, 0.041, neckDirection.length(), 16, 2),
    mats.steel,
  );
  knobNeck.name = 'bolt-knob-neck';
  knobNeck.position.copy(neckStart).add(neckEnd).multiplyScalar(0.5);
  knobNeck.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), neckDirection.normalize());
  knobNeck.userData.role = 'tapered-grip-ball-transition';
  handleRoot.add(knobNeck);
  runtime.meshes[knobNeck.name] = knobNeck;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.105, 20, 14), mats.steel);
  knob.name = 'bolt-knob';
  knob.position.set(-0.50, -0.42, 0);
  knob.userData.role = 'operable-grip-knob';
  handleRoot.add(knob);
  runtime.meshes['bolt-knob'] = knob;
  addSocket(pivot, 'bolt-pivot', new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), runtime);

  // Expose a deterministic cycle control for the viewer and keep the idle
  // tick meaningful. At progress 0 the bolt is closed; at 1 it has translated
  // rearward and lifted the handle around its real root. The mesh hierarchy
  // guarantees that the lever cannot animate independently of the sleeve,
  // while the hinge rotation remains a separate, inspectable DOF.
  const applyHinge = (progress: number): void => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    handleRoot.rotation.z = p * 0.45;
    handleRoot.userData.hingeProgress = p;
  };
  handleRoot.userData.applyHinge = applyHinge;
  const applyCycle = (progress: number): void => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    pivot.position.set(basePosition.x + p * 0.12, basePosition.y, basePosition.z);
    pivot.rotation.z = -p * 0.16;
    applyHinge(p);
    pivot.userData.cycleProgress = p;
  };
  pivot.userData.applyCycle = applyCycle;
  pivot.userData.restPose = { position: basePosition.toArray(), rotationZ: 0 };
  applyCycle(0);
}

function addTriggerAndMagazine(parent: THREE.Object3D, mats: MaterialSet, runtime: Runtime): void {
  // Loop-120 construction contract: the trigger group is a centerline
  // mechanism, not a near-side ornament. The broadside camera may still see
  // it through the shell opening, but its physical axis stays at z=0.
  const triggerCenterZ = 0;
  const guardPath = new THREE.CatmullRomCurve3([
    // Keep the source-aligned compact loop from pass111. Only the receiving
    // fillet and blade cross-section are reduced in this family; shrinking the
    // loop itself made the source opening visibly too small in the first
    // pass112 subtrial. The rejected pass107 enlargement remains forbidden.
    new THREE.Vector3(-2.49, 0.31, triggerCenterZ),
    new THREE.Vector3(-2.50, 0.25, triggerCenterZ),
    new THREE.Vector3(-2.50, 0.10, triggerCenterZ),
    new THREE.Vector3(-2.43, 0.035, triggerCenterZ),
    new THREE.Vector3(-2.15, 0.035, triggerCenterZ),
    new THREE.Vector3(-2.08, 0.10, triggerCenterZ),
    new THREE.Vector3(-2.08, 0.25, triggerCenterZ),
    new THREE.Vector3(-2.10, 0.31, triggerCenterZ),
  ]);
  // Keep a thin real stamped sweep. The trigger/guard clearance stays open
  // and the receiving-shell overlap remains bounded by the retained bridge.
  const guard = addPart(parent, 'trigger-guard', new THREE.Mesh(new THREE.TubeGeometry(guardPath, 32, 0.021, 12, false), mats.metal), runtime);
  guard.userData.role = 'stamped-trigger-guard-loop-with-open-blade-clearance';
  const guardBridge = roundedBox(0.38, 0.055, 0.12, 0.020, mats.metal, 3);
  guardBridge.name = 'trigger-guard-shell-bridge';
  guardBridge.position.set(-2.29, 0.275, triggerCenterZ);
  guard.add(guardBridge);
  runtime.meshes['trigger-guard-shell-bridge'] = guardBridge;
  for (const [name, x] of [['trigger-guard-front-pin', -2.12], ['trigger-guard-rear-pin', -2.46]] as const) {
    const pin = cylinderZ(x, 0.25, triggerCenterZ, 0.065, 0.028, mats.steel);
    pin.name = name;
    guard.add(pin);
    runtime.meshes[name] = pin;
  }
  const triggerPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-2.34, 0.27, triggerCenterZ),
    new THREE.Vector3(-2.30, 0.13, triggerCenterZ),
    new THREE.Vector3(-2.26, 0.07, triggerCenterZ),
  ]);
  const trigger = new THREE.Mesh(new THREE.TubeGeometry(triggerPath, 12, 0.022, 12, false), mats.steel);
  trigger.name = 'trigger';
  guard.add(trigger);
  runtime.meshes.trigger = trigger;
  addSocket(guard, 'trigger-pivot', new THREE.Vector3(-2.29, 0.27, triggerCenterZ), new THREE.Vector3(0, 0, 1), runtime);

  // Pass-95 construction hypothesis: the source magazine is a short stamped
  // box with a slight tapered shoulder, not a long hanging block. Keep the
  // group station and well fixed; shorten only the authored envelope and
  // retain real feed lip, base and side ribs.
  const magazine = new THREE.Mesh(profileGeometry([
    [-0.22, -0.16],
    [0.19, -0.16],
    [0.22, -0.11],
    [0.22, 0.12],
    [0.19, 0.16],
    [-0.20, 0.16],
    [-0.22, 0.11],
  ], 0.42, [], 0.025), mats.steel);
  magazine.castShadow = true;
  magazine.receiveShadow = true;
  const magazineGroup = addPart(parent, 'magazine', magazine, runtime);
  // The mesh and its base must share one physical magazine station. Keeping
  // the station on the group prevents the base from appearing as a detached
  // rectangle at the receiver origin.
  // The visible box sits low and flush under the shell cutout; the well is a
  // separate internal receiver component rather than a floating outer block.
  // Landmark-derived front station: the visible magazine sits closer to the
  // rear than the previous pass, aligned under the forward edge of the guard
  // rather than centered in the receiver slab.
  // The measured baseline station is retained. A later rearward seam
  // experiment regressed both broadside masks, so the visible magazine and
  // well remain at this source-fitted position.
  magazineGroup.position.set(-1.62, 0.02, 0);
  magazine.position.y = 0.10;
  const magWell = addPart(parent, 'magazine-well', roundedBox(0.62, 0.16, 0.52, 0.025, mats.metal, 3), runtime);
  magWell.position.set(-1.62, 0.16, 0);
  magWell.userData.role = 'receiver-mounted-magazine-well';
  const magBase = roundedBox(0.48, 0.06, 0.44, 0.018, mats.metal, 2);
  magBase.position.y = -0.13;
  magazineGroup.add(magBase);
  const feedLip = roundedBox(0.38, 0.04, 0.42, 0.012, mats.steel, 2);
  feedLip.name = 'magazine-feed-lip';
  feedLip.position.y = 0.205;
  magazineGroup.add(feedLip);
  for (let i = 0; i < 4; i += 1) {
    const rib = roundedBox(0.03, 0.22, 0.025, 0.008, mats.metal, 2);
    rib.name = `magazine-side-rib-${i + 1}`;
    rib.position.set(-0.16 + i * 0.105, 0.06, 0.225);
    magazineGroup.add(rib);
  }
}

function addBipod(parent: THREE.Object3D, mats: MaterialSet, runtime: Runtime): void {
  // Pass-94 construction hypothesis: the source hinge plate is slimmer in
  // vertical profile while the telescoping tubes carry slightly more visual
  // mass. Keep the spigot station, independent spring paths, hooks/collars,
  // and all receiving contacts fixed.
  const hinge = addPart(parent, 'bipod-hinge', roundedBox(0.42, 0.264, 0.60, 0.035, mats.steel, 3), runtime);
  // The hinge is seated against the receiver underside; the legs start below
  // the receiver rather than cutting through its side silhouette.
  hinge.position.set(0.78, 0.30, 0);
  addSocket(hinge, 'bipod-leg-left-socket', new THREE.Vector3(0.06, -0.15, -0.25), new THREE.Vector3(1, 0, 0), runtime);
  addSocket(hinge, 'bipod-leg-right-socket', new THREE.Vector3(0.06, -0.15, 0.25), new THREE.Vector3(1, 0, 0), runtime);
  const axle = cylinderZ(0.78, 0.30, 0, 0.72, 0.075, mats.steel);
  axle.name = 'bipod-hinge-axle';
  parent.add(axle);
  for (const [side, z] of [['left', -0.27], ['right', 0.27]] as const) {
    const leg = new THREE.Group();
    leg.name = `bipod-leg-${side}`;
    parent.add(leg);
    runtime.nodes[`bipod-leg-${side}`] = leg;
    // In the supplied broadside plates the folded bipod runs immediately
    // beneath the fore-end, not as a low hanging bar. Keep its rods near the
    // hinge centerline so the assembly remains attached in the fixed shot.
    const legStart = new THREE.Vector3(0.95, 0.22, z);
    const legEnd = new THREE.Vector3(2.48, 0.22, z);
    const outer = tubeBetween(legStart, legEnd, 0.056, mats.steel);
    outer.name = `bipod-leg-${side}-outer`;
    leg.add(outer);
    const inner = tubeBetween(new THREE.Vector3(1.45, 0.22, z), new THREE.Vector3(2.78, 0.22, z), 0.0345, mats.metal);
    inner.name = `bipod-leg-${side}-inner`;
    leg.add(inner);
    // The terminal support is a real rubber boot with a retaining collar and
    // metal end cap, not a placeholder box. The boot axis follows the
    // telescoping leg so the foot remains attached in folded/orbit views.
    // The real leg terminates in a broader tapered rubber boot, not a thin
    // capped pin. Keep the authored leg station but give the foot a readable
    // grip profile for orbit views.
    const foot = cylinderX(2.86, 0.28, 0.082, mats.rubber, 0.108);
    foot.name = `bipod-foot-${side}`;
    foot.position.y = 0.22;
    foot.position.z = z;
    leg.add(foot);
    runtime.meshes[`bipod-foot-${side}`] = foot;
    const footCollar = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.016, 10, 28), mats.steel);
    footCollar.name = `bipod-foot-${side}-collar`;
    footCollar.rotation.y = Math.PI / 2;
    footCollar.position.set(2.72, 0.22, z);
    leg.add(footCollar);
    runtime.meshes[`bipod-foot-${side}-collar`] = footCollar;
    const footCap = cylinderX(3.04, 0.08, 0.108, mats.rubber, 0.092);
    footCap.name = `bipod-foot-${side}-end-cap`;
    footCap.position.y = 0.22;
    footCap.position.z = z;
    leg.add(footCap);
    runtime.meshes[`bipod-foot-${side}-end-cap`] = footCap;

    // Explicit mechanical seats for the independent spring. The spring is
    // still one logical assembly, but each terminal now has a real collar
    // owned by the component it bears against instead of ending in free space.
    // The reference spring is a separate side-mounted compression coil, not a
    // coil wound around the telescoping leg. Give it its own lateral station
    // and bridge that station to the leg with real seats/connectors.
    const springZ = z + (z < 0 ? -0.13 : 0.13);
    const legSpringAnchor = new THREE.Mesh(new THREE.TorusGeometry(0.092, 0.021, 8, 24), mats.steel);
    legSpringAnchor.name = `bipod-leg-${side}-spring-anchor`;
    legSpringAnchor.rotation.y = Math.PI / 2;
    legSpringAnchor.position.set(2.30, 0.22, z);
    leg.add(legSpringAnchor);
    runtime.meshes[legSpringAnchor.name] = legSpringAnchor;
    const legSpringSeat = new THREE.Mesh(new THREE.TorusGeometry(0.086, 0.018, 8, 24), mats.steel);
    legSpringSeat.name = `bipod-leg-${side}-spring-side-seat`;
    legSpringSeat.rotation.y = Math.PI / 2;
    legSpringSeat.position.set(2.30, 0.22, springZ);
    leg.add(legSpringSeat);
    runtime.meshes[legSpringSeat.name] = legSpringSeat;
    const legSpringConnector = tubeBetween(
      new THREE.Vector3(2.30, 0.22, z),
      new THREE.Vector3(2.30, 0.22, springZ),
      0.018,
      mats.steel,
    );
    legSpringConnector.name = `bipod-leg-${side}-spring-side-connector`;
    leg.add(legSpringConnector);
    runtime.meshes[legSpringConnector.name] = legSpringConnector;

    // One logical spring assembly per side. The coil, two collars, and curved
    // end hooks travel together when the bipod is exploded or animated.
    const springGroup = new THREE.Group();
    springGroup.name = `bipod-spring-${side}`;
    parent.add(springGroup);
    runtime.nodes[`bipod-spring-${side}`] = springGroup;
    const springPath = new THREE.CatmullRomCurve3(Array.from({ length: 33 }, (_, index) => {
      const t = index / 32;
      const x = 1.02 + t * 1.22;
      // Loop-103 construction hypothesis: the supplied close-up has a denser
      // independent lateral coil than the previous ten-turn path. Preserve
      // the same endpoint span/radius and all hook/collar stations; change
      // only the real helix turn count so spring density can be judged alone.
      const angle = t * Math.PI * 2 * 16;
      return new THREE.Vector3(x, 0.13 + Math.cos(angle) * 0.060, springZ + Math.sin(angle) * 0.045);
    }));
    const spring = new THREE.Mesh(new THREE.TubeGeometry(springPath, 192, 0.019, 8, false), mats.steel);
    spring.name = `bipod-spring-${side}-coil`;
    springGroup.add(spring);
    runtime.meshes[`bipod-spring-${side}`] = spring;
    const makeSpringHook = (name: string, points: THREE.Vector3[]): void => {
      const hook = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 16, 0.018, 8, false), mats.steel);
      hook.name = name;
      springGroup.add(hook);
    };
    // Each hook wraps around the receiving anchor instead of terminating in
    // open space. The spring remains a separate side-mounted compression coil;
    // only its terminal hardware is owned by the hinge and telescoping leg.
    makeSpringHook(`bipod-spring-${side}-top-hook`, [
      new THREE.Vector3(1.02, 0.13, springZ),
      new THREE.Vector3(0.98, 0.13, springZ),
      new THREE.Vector3(0.93, 0.17, springZ),
      new THREE.Vector3(0.91, 0.23, springZ),
      new THREE.Vector3(0.94, 0.29, springZ),
      new THREE.Vector3(1.00, 0.30, springZ),
      new THREE.Vector3(1.02, 0.25, springZ),
    ]);
    makeSpringHook(`bipod-spring-${side}-bottom-hook`, [
      new THREE.Vector3(2.24, 0.13, springZ),
      new THREE.Vector3(2.29, 0.12, springZ),
      new THREE.Vector3(2.35, 0.16, springZ),
      new THREE.Vector3(2.36, 0.22, springZ),
      new THREE.Vector3(2.32, 0.28, springZ),
      new THREE.Vector3(2.26, 0.27, springZ),
      new THREE.Vector3(2.29, 0.21, springZ),
    ]);
    const hingeSpringAnchor = new THREE.Mesh(new THREE.TorusGeometry(0.092, 0.021, 8, 24), mats.steel);
    hingeSpringAnchor.name = `bipod-hinge-${side}-spring-anchor`;
    hingeSpringAnchor.rotation.y = Math.PI / 2;
    // Hinge is already stationed at (0.78, 0.30); use local coordinates so
    // the anchor lands at the global hook station (0.96, 0.25).
    hingeSpringAnchor.position.set(0.18, -0.05, springZ);
    hinge.add(hingeSpringAnchor);
    runtime.meshes[hingeSpringAnchor.name] = hingeSpringAnchor;
    const hingeSpringConnector = tubeBetween(
      new THREE.Vector3(0.18, -0.05, z),
      new THREE.Vector3(0.18, -0.05, springZ),
      0.018,
      mats.steel,
    );
    hingeSpringConnector.name = `bipod-hinge-${side}-spring-side-connector`;
    hinge.add(hingeSpringConnector);
    runtime.meshes[hingeSpringConnector.name] = hingeSpringConnector;
    // Keep the logical spring manifest names while binding both collars to
    // the actual receiving components. This avoids duplicate floating collars
    // inside the independent spring group.
    runtime.meshes[`bipod-spring-${side}-top-collar`] = hingeSpringAnchor;
    runtime.meshes[`bipod-spring-${side}-bottom-collar`] = legSpringAnchor;
  }
}

function addStock(parent: THREE.Object3D, mats: MaterialSet, runtime: Runtime): void {
  // The source thumbhole is taller than it is wide. Keeping that negative
  // space vertical is important: a wide oval makes the rear chassis read as
  // a generic stock instead of the AWP thumbhole shell.
  // The admitted stock crop shows a near-round thumbhole that is slightly
  // wider than the vertical opening used in the earlier pass. Keep the
  // negative space generous and heavily filleted so the shell reads as a
  // molded ergonomic chassis rather than a narrow rectangular cutout.
  // Pass-127 thumbhole station move was rejected by the full-frame gate
  // (front/back IoU regressed to 0.7697/0.7659). Retain the prior source-fit
  // station until a different stock hypothesis is measured; do not repeat
  // that crop-only retarget here.
  const thumbhole = ellipseLoop(-3.22, 0.07, 0.74, 0.56, 24);
  const stock = addPart(parent, 'stock', new THREE.Mesh(stockProfileGeometry(Z_SHELL, thumbhole), mats.shell), runtime);
  runtime.nodes.stock = stock;
  stock.userData.profileEvidence = 'front/back broadside stock profile with rounded thumbhole cut';
  // Loop-120 clearance correction: the receiving throat is a narrow center
  // shell around the trigger, not a half-depth side slab. Keep the outer
  // stock profile unchanged; reduce only this local fillet so a hand can
  // reach the centerline trigger guard from either side.
  const gripFillet = addPart(parent, 'stock-pistol-grip-fillet', new THREE.Mesh(stockPistolGripFilletGeometry(0.28), mats.shell), runtime);
  gripFillet.position.z = 0;
  gripFillet.userData.role = 'narrow-centerline-receiving-fillet-for-trigger-guard';
  gripFillet.userData.clearance = { triggerAxis: 'z=0 centerline', depth: 0.28, stockShellDepth: Z_SHELL };
  const cheek = roundedBox(1.62, 0.15, 0.56, 0.05, mats.rubber, 4);
  cheek.position.set(-3.88, 0.56, 0);
  stock.add(cheek);
  // Pass-92 construction hypothesis: the source buttpad is a separate sloped
  // terminal plate with softened corners, not a perfectly rectangular rubber
  // block. Keep its station, height, depth, and stock contact fixed; change
  // only the visible terminal profile.
  const buttpad = new THREE.Mesh(profileGeometry([
    [-0.15, -0.50],
    [0.11, -0.50],
    [0.15, -0.43],
    [0.15, 0.39],
    [0.10, 0.50],
    [-0.12, 0.50],
    [-0.15, 0.41],
  ], 0.74, [], 0.04), mats.rubber);
  buttpad.castShadow = true;
  buttpad.receiveShadow = true;
  buttpad.position.set(-5.09, 0.12, 0);
  const buttGroup = addPart(parent, 'stock-buttpad', buttpad, runtime);
  buttGroup.userData.contact = 'overlap into rear stock end';
  [0.38, -0.12].forEach((y, index) => addFastener(stock, `stock-fastener-${index}`, -4.66, y, 0.365, 0.045, mats, runtime));
}

function addReceiver(parent: THREE.Object3D, mats: MaterialSet, runtime: Runtime): THREE.Group {
  // Keep the retained pass-128 receiver crown. The pass-129 bare-top span and
  // pass-130 uniform envelope-scale hypotheses both regressed the full-frame
  // broadside masks, and pass-132's non-uniform contour improved full-frame IoU
  // but worsened the critical receiver-action occupancy. The next correction
  // must use a new measured foundation; this code remains at pass-128.
  const points: Array<[number, number]> = [
    // Keep the retained pass85 crown; the pass87 receiver-only crown shrink
    // did not improve either aligned broadside and read unchanged in orbit.
    // Pass-129 tested a stepped bare-top span (x=-2.52..-1.90 lowered to 0.52
    // before rejoining the rail at 0.70) and it regressed front/back IoU to
    // 0.7798/0.7764 versus the retained pass-128 0.7823/0.7796. Rolled back;
    // do not repeat this exact bare-span step without new source evidence.
    [-2.62, 0.42], [-2.52, 0.70], [0.83, 0.70],
    [1.00, 0.60], [1.00, 0.20], [0.60, 0.34],
    [0.02, 0.28], [-0.48, 0.27], [-1.08, 0.25],
    [-1.48, 0.29], [-2.62, 0.30],
  ];
  // Pass-134 tested one rounded receiver clearance opening around the existing
  // centered trigger/guard. It was real geometry, but the paired region audit
  // showed receiver-action still overfilled and trigger occupancy worsening;
  // reject and keep the retained pass-128 shell until a new measured opening
  // packet exists. This is the rollback target, not a camera-facing trick.
  const receiver = addPart(parent, 'receiver', new THREE.Mesh(profileGeometry(points, 0.54, [], 0.035), mats.shell), runtime);
  addRail(receiver, mats, runtime);
  [-2.08, -1.48, -0.32, 0.46].forEach((x, index) => addFastener(receiver, `receiver-fastener-${index}`, x, 0.21, 0.355, 0.042, mats, runtime));

  // The real AWP is a shell/chassis assembly: the painted side shell does not
  // replace the separate machined action. Keep this action block inside the
  // existing receiver envelope so the macro silhouette stays controlled while
  // the broadside view gains a real component boundary and its own hardware.
  // Loop-105 construction hypothesis from the loop-90 audit: the source
  // shows a shorter machined action nested into the painted shell, not one
  // uninterrupted receiver slab. Shrink only the longitudinal action profile
  // around its existing center (~12%) and bring it forward by a controlled
  // overlap so the seam is a real nested component in orbit. Do not translate
  // the receiver, stock, rail, bolt, barrel or any contact station.
  // Loop-109 depth hypothesis: expose only a small real shell/action boundary;
  // preserve the action profile, parent, station, fasteners, and contact graph.
  const action = addPart(receiver, 'receiver-action-block', new THREE.Mesh(profileGeometry([
    [-2.28, 0.44], [-2.22, 0.66], [0.62, 0.66], [0.70, 0.57], [0.70, 0.44],
  ], 0.38, [], 0.022), mats.metal), runtime);
  action.position.z = 0.14;
  action.userData.role = 'machined-steel-action-nested-into-composite-shell';
  const actionSeam = roundedBox(3.08, 0.026, 0.05, 0.008, mats.steel, 2);
  actionSeam.name = 'receiver-action-seam';
  actionSeam.position.set(-0.80, 0.425, 0.285);
  receiver.add(actionSeam);
  runtime.meshes['receiver-action-seam'] = actionSeam;
  [-2.12, -1.42, -0.12, 0.52].forEach((x, index) => {
    addFastener(action, `receiver-action-fastener-${index}`, x, 0.51, 0.255, 0.034, mats, runtime);
  });
  // Loop-118 bounded correction: the handle relief is registered at the
  // measured rear action station. It is a shallow receiver-owned machining
  // pocket, not a free-floating plate or a camera-facing projection.
  // This is embedded geometry, not a camera-facing decal or texture trick.
  const boltPocket = addPart(receiver, 'receiver-bolt-side-pocket', new THREE.Mesh(
    roundedBox(0.34, 0.15, 0.034, 0.026, mats.black, 3).geometry,
    mats.black,
  ), runtime);
  boltPocket.position.set(-2.24, 0.55, 0.342);
  boltPocket.userData.role = 'machined-receiver-handle-relief-pocket';
  boltPocket.userData.contact = 'embedded into receiver-action near-side face';
  return receiver;
}

function addBarrelAndMuzzle(parent: THREE.Object3D, mats: MaterialSet, runtime: Runtime): void {
  // Loop-110 source-crop hypothesis: the visible barrel continues rearward
  // beneath the scope-mount region. Extend only the real coaxial tube toward
  // the rear saddle neighborhood while holding its muzzle/front station and
  // every scope, rail, bolt, bipod, and contact station fixed.
  const barrel = addPart(parent, 'barrel', cylinderX(2.15, 6.10, 0.115, mats.metal, 0.105), runtime);
  barrel.position.y = 0.67;
  const shoulder = cylinderX(0.68, 0.22, 0.15, mats.steel, 0.135);
  shoulder.name = 'barrel-shoulder';
  shoulder.position.y = 0.67;
  parent.add(shoulder);
  // Keep the source-like compact solid outer profile, but leave the sleeve
  // open and author the double-chamber structure inside it. This preserves the
  // side silhouette while making the bore and internal baffles real geometry.
  // Loop-100 construction hypothesis: the source muzzle is a compact brake
  // close to the barrel diameter, not a large decorative ring. Keep the
  // muzzle station, open sleeve and real recessed bore; reduce only the outer
  // radial envelope and matching annular hardware.
  const muzzleShell = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.135, 0.34, 32, 1, true), mats.metal);
  muzzleShell.rotation.z = -Math.PI / 2;
  muzzleShell.position.x = 5.16;
  const muzzle = addPart(parent, 'muzzle', muzzleShell, runtime);
  muzzle.position.y = 0.67;
  const rearRim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 10, 32), mats.steel);
  rearRim.name = 'muzzle-brake-rear-rim';
  rearRim.rotation.y = Math.PI / 2;
  rearRim.position.set(4.995, 0, 0);
  muzzle.add(rearRim);
  runtime.meshes[rearRim.name] = rearRim;
  const brakeFrontRim = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.022, 10, 32), mats.steel);
  brakeFrontRim.name = 'muzzle-brake-front-rim';
  brakeFrontRim.rotation.y = Math.PI / 2;
  brakeFrontRim.position.set(5.325, 0, 0);
  muzzle.add(brakeFrontRim);
  runtime.meshes[brakeFrontRim.name] = brakeFrontRim;
  for (const [name, x] of [['rear', 5.10], ['front', 5.23]] as const) {
    const baffle = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.018, 10, 32), mats.steel);
    baffle.name = `muzzle-brake-${name}-baffle`;
    baffle.rotation.y = Math.PI / 2;
    baffle.position.set(x, 0, 0);
    muzzle.add(baffle);
    runtime.meshes[baffle.name] = baffle;
  }
  // The bore is a recessed dark tube behind a real annular muzzle face. A
  // capped cylinder at the front reads as a painted dot in orbit, so the
  // visible opening and the inner wall are authored as separate geometry.
  const boreTube = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.22, 32, 1, true), mats.black);
  boreTube.rotation.z = -Math.PI / 2;
  boreTube.position.x = 5.16;
  const bore = addPart(muzzle, 'muzzle-bore', boreTube, runtime);
  bore.position.y = 0;
  const boreFace = new THREE.Mesh(new THREE.RingGeometry(0.075, 0.135, 36), mats.steel);
  boreFace.name = 'muzzle-bore-face';
  boreFace.rotation.y = Math.PI / 2;
  boreFace.position.set(5.38, 0, 0);
  muzzle.add(boreFace);
  runtime.meshes['muzzle-bore-face'] = boreFace;
  const boreRim = new THREE.Mesh(new THREE.TorusGeometry(0.082, 0.018, 10, 32), mats.steel);
  boreRim.rotation.y = Math.PI / 2;
  boreRim.position.set(5.385, 0, 0);
  muzzle.add(boreRim);
  const port = roundedBox(0.07, 0.065, 0.10, 0.010, mats.black, 2);
  port.position.set(5.16, 0.09, 0.13);
  muzzle.add(port);
}

function addPaintPanels(parent: THREE.Object3D, mats: MaterialSet, runtime: Runtime): void {
  // Loop-115 ownership correction: a paint/projection surface must ride the
  // real stock object, not sit as a root-level plate at the old shell depth.
  // Keep the geometry shallow and use the exact stock profile/hole for both
  // visible broadside faces. Textures remain a later look-dev step; this pass
  // proves that the future projection owner cannot float when the stock moves
  // or is exploded.
  const stock = runtime.nodes.stock ?? parent;
  const panelDepth = 0.018;
  const panelOffset = Z_SHELL / 2 + panelDepth / 2 + 0.001;
  for (const [side, z] of [['front', panelOffset], ['back', -panelOffset]] as const) {
    const panel = new THREE.Mesh(
      stockProfileGeometry(panelDepth, ellipseLoop(-3.22, 0.07, 0.74, 0.56, 24), 0),
      mats.shell,
    );
    panel.userData.role = 'conforming-stock-shell-visible-surface';
    panel.userData.boundTo = 'stock';
    panel.userData.projectionBinding = 'stock-owned-surface-contact';
    panel.userData.attachment = {
      parent: 'stock',
      parentSocket: `stock.painted-surface-${side}`,
      contactType: 'surface-contact',
      embedDepth: 0.001,
      overlap: 0.001,
      gapTolerance: 0.015,
    };
    panel.name = side === 'front' ? 'painted-shell-visible-surface' : 'painted-shell-visible-surface-back';
    panel.position.z = z;
    stock.add(panel);
    runtime.meshes[panel.name] = panel;
  }
}

export function createAWPMedusaMinimalWearModel(options: AWPV2Options = {}): THREE.Group {
  const mats = makeMaterials(options);
  const root = new THREE.Group();
  root.name = 'AWP_Medusa_V2';
  const runtime: Runtime = {
    nodes: { root }, meshes: {}, sockets: {}, colliders: [], colliderById: {},
    adjacency: [], attachmentGate: {}, attachmentAudit: {}, destructionGroups: {}, logicalComponents: {},
  };
  root.userData.reconstructionEvidence = {
    version: 'awp-medusa-v2',
    itemName: 'AWP | Medusa (Minimal Wear)',
    sourceReferences: {
      front: 'public/front-medusa.webp',
      back: 'public/back-medusa.webp',
    },
    sourceAbsoluteReferences: {
      front: '/Users/tamlh/workspaces/self/AI/img2threejs-org/img2threejs-showcase/public/front-medusa.webp',
      back: '/Users/tamlh/workspaces/self/AI/img2threejs-org/img2threejs-showcase/public/back-medusa.webp',
    },
    pass: 'macro-blockout',
    projection: 'pending-macro-silhouette-gate',
    referenceCamera: 'orthographic-first broadside hypothesis',
    evidenceConfidence: { stock: 0.94, receiver: 0.91, barrel: 0.93, scope: 0.88, bipod: 0.72, hiddenThickness: 0.45 },
  };
  addSocket(root, 'receiver-root', new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), runtime);
  addStock(root, mats, runtime);
  const receiver = addReceiver(root, mats, runtime);
  addBarrelAndMuzzle(root, mats, runtime);
  addScope(root, mats, runtime);
  addBolt(receiver, mats, runtime);
  addTriggerAndMagazine(root, mats, runtime);
  addBipod(root, mats, runtime);
  addPaintPanels(root, mats, runtime);
  root.userData.sculptRuntime = runtime;
  root.userData.pivots = {
    root: root,
    bolt: runtime.nodes.bolt,
    trigger: runtime.sockets['trigger-pivot'],
    bipod: runtime.nodes['bipod-hinge'],
    scope: runtime.nodes.scope,
  };
  root.userData.sockets = runtime.sockets;
  root.userData.contactEvidence = {
    stockReceiver: 'profile overlap at x=-1.72..-1.45',
    receiverBarrel: 'barrel shoulder embedded at x=1.58..1.86',
    scopeMount: 'ring saddles overlap rail and tube',
    boltReceiver: 'receiver-parented bolt sleeve slides inside a real raceway; handle root is socketed to the sleeve',
    triggerReceiver: 'guard overlaps receiver underside',
    magazineReceiver: 'magazine intersects receiver well envelope',
    bipodReceiver: 'hinge plate overlaps receiver underside',
    springs: 'independent spring assemblies run beside, not around, telescoping legs; hooks and collars are grouped with each spring',
  };
  let elapsed = 0;
  root.userData.tick = (dt: number): void => {
    elapsed += dt;
    const bolt = runtime.nodes.bolt;
    if (bolt) {
      const applyCycle = bolt.userData.applyCycle as ((progress: number) => void) | undefined;
      if (applyCycle) applyCycle(0.04 + (Math.sin(elapsed * 0.65) * 0.5 + 0.5) * 0.08);
    }
    const scope = runtime.nodes.scope;
    if (scope) scope.rotation.z = Math.sin(elapsed * 0.25) * 0.002;
  };
  root.traverse((object) => {
    object.userData.v2 = true;
    object.castShadow = options.shadows ?? true;
    object.receiveShadow = options.shadows ?? true;
    if (object.name.includes('painted-shell') || object.name.includes('crown-skull') || object.name.includes('cheek')) {
      object.userData.explodeWithParent = true;
    }
  });
  // Keep the receiver visible in the runtime map even though its side shell also owns paint.
  runtime.nodes.receiver = receiver;
  // Contact evidence is derived from the authored scene after transforms are
  // resolved. These boxes are diagnostic envelopes, not attachment metadata.
  root.updateWorldMatrix(true, true);
  for (const id of [
    'stock', 'receiver', 'barrel', 'scope', 'bolt', 'trigger-guard', 'magazine',
    'bipod-hinge', 'bipod-leg-left', 'bipod-leg-right', 'bipod-spring-left',
    'bipod-spring-right', 'bipod-foot-left', 'bipod-foot-right', 'stock-pistol-grip-fillet', 'magazine-well',
    'bolt-handle',
  ]) {
    const object = runtime.nodes[id] ?? runtime.meshes[id];
    if (object) {
      const box = new THREE.Box3().setFromObject(object);
      runtime.colliderById[id] = box;
      runtime.colliders.push({ id, type: 'box', min: box.min.clone(), max: box.max.clone() });
    }
  }
  const contact = (id: string, a: string, b: string, note: string): Record<string, unknown> => {
    const boxA = runtime.colliderById[a];
    const boxB = runtime.colliderById[b];
    if (!boxA || !boxB) return { id, a, b, status: 'missing-collider', note };
    const overlap = [
      Math.min(boxA.max.x, boxB.max.x) - Math.max(boxA.min.x, boxB.min.x),
      Math.min(boxA.max.y, boxB.max.y) - Math.max(boxA.min.y, boxB.min.y),
      Math.min(boxA.max.z, boxB.max.z) - Math.max(boxA.min.z, boxB.min.z),
    ];
    const gap = [
      Math.max(boxA.min.x - boxB.max.x, boxB.min.x - boxA.max.x, 0),
      Math.max(boxA.min.y - boxB.max.y, boxB.min.y - boxA.max.y, 0),
      Math.max(boxA.min.z - boxB.max.z, boxB.min.z - boxA.max.z, 0),
    ];
    return {
      id, a, b, status: overlap.every((value) => value >= 0) ? 'intersects-or-touches' : 'gap',
      overlap, closestGap: Math.hypot(...gap), note,
    };
  };
  const contacts = [
    contact('stock-to-receiver', 'stock', 'receiver', 'profile seam'),
    contact('receiver-to-barrel', 'receiver', 'barrel', 'barrel shoulder seats into receiver front'),
    contact('receiver-to-scope-rail', 'receiver', 'scope', 'scope group envelope is checked; ring saddles are the authored seam'),
    contact('receiver-to-bolt', 'receiver', 'bolt', 'receiver-parented bolt sleeve slides inside authored raceway'),
    contact('bolt-to-bolt-handle', 'bolt', 'bolt-handle', 'handle hinge root seats on the rear bolt-body face and cycles with the sleeve'),
    contact('receiver-to-trigger-guard', 'receiver', 'trigger-guard', 'guard enters underside opening'),
    contact('stock-grip-fillet-to-trigger-guard', 'stock-pistol-grip-fillet', 'trigger-guard', 'molded shell fillet receives the forward guard bridge'),
    contact('receiver-to-magazine', 'receiver', 'magazine', 'magazine enters receiver well'),
    contact('magazine-well-to-magazine', 'magazine-well', 'magazine', 'stamped magazine seats inside the real well envelope'),
    contact('receiver-to-bipod-hinge', 'receiver', 'bipod-hinge', 'hinge plate meets underside'),
    contact('bipod-hinge-to-spring-left', 'bipod-hinge', 'bipod-spring-left', 'top hook seats into hinge-side collar; coil remains external to leg'),
    contact('bipod-hinge-to-spring-right', 'bipod-hinge', 'bipod-spring-right', 'top hook seats into hinge-side collar; coil remains external to leg'),
    contact('bipod-spring-left-to-leg', 'bipod-spring-left', 'bipod-leg-left', 'bottom hook wraps the leg-side spring anchor; coil remains separate from telescoping tube'),
    contact('bipod-spring-right-to-leg', 'bipod-spring-right', 'bipod-leg-right', 'bottom hook wraps the leg-side spring anchor; coil remains separate from telescoping tube'),
  ];
  runtime.attachmentGate = {
    contractVersion: 'world-contact-v2',
    maxVisibleGap: 0.015,
    contacts,
    renderedContactEvidence: '.img2threejs/v2/renders/pass-5/orbit-left.png;.img2threejs/v2/renders/pass-5/orbit-right.png',
    note: 'AABB envelopes are diagnostic evidence paired with rendered orbit inspection; they do not replace mesh-level contact review.',
  };
  runtime.attachmentAudit = {
    contractVersion: 'joint-attachment-v2',
    physicalContactPairs: contacts.map((entry) => entry.id),
    metadataOnly: false,
    note: 'Each pair is derived after world transforms from authored component groups.',
  };
  runtime.adjacency = contacts.map((entry) => ({
    a: entry.a, b: entry.b, contactType: entry.status, closestGap: entry.closestGap ?? null,
  }));
  runtime.destructionGroups = {
    stock: ['stock', 'stock-pistol-grip-fillet', 'stock-buttpad'],
    receiver: ['receiver', 'receiver-action-block', 'receiver-action-seam', 'receiver-bolt-side-pocket', 'receiver-top-rail-mesh'],
    optic: ['scope', 'scope-eyepiece', 'scope-main-tube', 'scope-objective-taper', 'scope-ring-rear', 'scope-ring-front', 'scope-ring-rear-clamp-plate', 'scope-ring-front-clamp-plate', 'crown-skull-sticker'],
    boltAction: ['bolt', 'bolt-raceway', 'bolt-body', 'bolt-shroud', 'bolt-head-block', 'bolt-side-sleeve', 'bolt-locking-lug', 'bolt-handle', 'bolt-knob-neck', 'bolt-knob', 'trigger-guard', 'trigger', 'magazine', 'magazine-well'],
    barrelAssembly: ['barrel', 'muzzle', 'muzzle-bore', 'bipod-hinge', 'bipod-leg-left', 'bipod-leg-right'],
    finish: ['painted-shell-visible-surface', 'painted-shell-visible-surface-back'],
  };
  runtime.logicalComponents = {
    root: { kind: 'assembly', binding: 'AWP_Medusa_V2', boundMeshes: [] },
    stock: { kind: 'profile-shell', binding: 'stock', boundMeshes: ['stock'] },
    'stock-pistol-grip-fillet': { kind: 'molded-receiving-fillet', binding: 'stock', boundMeshes: ['stock-pistol-grip-fillet'] },
    'stock-buttpad': { kind: 'cap', binding: 'stock', boundMeshes: ['stock-buttpad'] },
    finish: { kind: 'stock-owned-surface', binding: 'stock', boundMeshes: ['painted-shell-visible-surface', 'painted-shell-visible-surface-back'] },
    receiver: { kind: 'profile-shell', binding: 'receiver', boundMeshes: ['receiver', 'receiver-action-block', 'receiver-action-seam', 'receiver-bolt-side-pocket'] },
    'receiver-action-block': { kind: 'machined-action-block', binding: 'receiver', boundMeshes: ['receiver-action-block', 'receiver-action-seam'] },
    'receiver-top-rail': { kind: 'rail', binding: 'receiver-top-rail', boundMeshes: ['receiver-top-rail'] },
    barrel: { kind: 'coaxial-cylinder', binding: 'barrel', boundMeshes: ['barrel'] },
    muzzle: { kind: 'muzzle-assembly', binding: 'muzzle', boundMeshes: ['muzzle'] },
    'muzzle-bore': { kind: 'open-bore', binding: 'muzzle-bore', boundMeshes: ['muzzle-bore'] },
    scope: { kind: 'optic-assembly', binding: 'scope', boundMeshes: ['scope-main-tube', 'scope-eyepiece', 'scope-objective-taper'] },
    'scope-objective-taper': { kind: 'tapered-optic', binding: 'scope', boundMeshes: ['scope-objective-taper'] },
    'scope-eyepiece': { kind: 'ocular', binding: 'scope', boundMeshes: ['scope-eyepiece'] },
    'scope-glass': { kind: 'reflective-glass', binding: 'scope', boundMeshes: ['scope-glass-eyepiece', 'scope-objective-glass'] },
    'scope-mount': { kind: 'two-point-mount', binding: 'scope-mount', boundMeshes: ['scope-ring-front', 'scope-ring-rear'] },
    'scope-ring-front': { kind: 'clamp-ring', binding: 'scope-mount', boundMeshes: ['scope-ring-front', 'scope-ring-front-clamp-cap', 'scope-ring-front-clamp-plate', 'scope-ring-front-upper-fastener', 'scope-ring-front-lower-fastener'] },
    'scope-ring-rear': { kind: 'clamp-ring', binding: 'scope-mount', boundMeshes: ['scope-ring-rear', 'scope-ring-rear-clamp-cap', 'scope-ring-rear-clamp-plate', 'scope-ring-rear-upper-fastener', 'scope-ring-rear-lower-fastener'] },
    'scope-turret': { kind: 'knurled-turret', binding: 'scope', boundMeshes: ['scope-turret-main', 'scope-turret-side'] },
    bolt: { kind: 'receiver-action', binding: 'bolt', boundMeshes: ['bolt-raceway', 'bolt-body', 'bolt-shroud', 'bolt-head-block', 'bolt-side-sleeve', 'bolt-rear-collar', 'bolt-locking-lug', 'bolt-handle-pivot-pin'] },
    'bolt-handle': { kind: 'curved-lever', binding: 'bolt', boundMeshes: ['bolt-handle', 'bolt-knob-neck', 'bolt-knob'] },
    'trigger-guard': { kind: 'guard-loop', binding: 'trigger-guard', boundMeshes: ['trigger-guard'] },
    trigger: { kind: 'trigger-blade', binding: 'trigger-guard', boundMeshes: ['trigger'] },
    magazine: { kind: 'magazine', binding: 'magazine', boundMeshes: ['magazine', 'magazine-feed-lip', 'magazine-side-rib-1', 'magazine-side-rib-2', 'magazine-side-rib-3', 'magazine-side-rib-4'] },
    'magazine-well': { kind: 'receiver-magazine-well', binding: 'magazine', boundMeshes: ['magazine-well'] },
    'bipod-hinge': { kind: 'hinge', binding: 'bipod-hinge', boundMeshes: ['bipod-hinge'] },
    'bipod-leg-left': { kind: 'telescoping-leg', binding: 'bipod-leg-left', boundMeshes: ['bipod-leg-left-outer', 'bipod-leg-left-inner'] },
    'bipod-leg-right': { kind: 'telescoping-leg', binding: 'bipod-leg-right', boundMeshes: ['bipod-leg-right-outer', 'bipod-leg-right-inner'] },
    'bipod-spring-left': { kind: 'separate-coil-spring', binding: 'bipod-spring-left', boundMeshes: ['bipod-spring-left-coil', 'bipod-spring-left-top-hook', 'bipod-spring-left-bottom-hook', 'bipod-spring-left-top-collar', 'bipod-spring-left-bottom-collar'] },
    'bipod-spring-right': { kind: 'separate-coil-spring', binding: 'bipod-spring-right', boundMeshes: ['bipod-spring-right-coil', 'bipod-spring-right-top-hook', 'bipod-spring-right-bottom-hook', 'bipod-spring-right-top-collar', 'bipod-spring-right-bottom-collar'] },
    'bipod-foot-left': { kind: 'support-foot', binding: 'bipod-leg-left', boundMeshes: ['bipod-foot-left'] },
    'bipod-foot-right': { kind: 'support-foot', binding: 'bipod-leg-right', boundMeshes: ['bipod-foot-right'] },
  };
  return root;
}

export function createAWPMedusaMinimalWearLookDevLights(): THREE.Group {
  const lights = new THREE.Group();
  lights.name = 'AWP_Medusa_V2_Lights';
  const key = new THREE.DirectionalLight(0xdbe8ff, 3.1);
  key.position.set(-3, 6, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  lights.add(key);
  const fill = new THREE.DirectionalLight(0x4b73a6, 1.4);
  fill.position.set(4, 1, -5);
  lights.add(fill);
  const rim = new THREE.PointLight(0x64b9ff, 5, 14);
  rim.position.set(1, 3, -3);
  lights.add(rim);
  lights.add(new THREE.HemisphereLight(0x9ab4c4, 0x05070b, 0.72));
  return lights;
}

export function createAWPMedusaMinimalWearEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return environment;
}

export function makeAWPMedusaMinimalWearBackground(): THREE.Color {
  return new THREE.Color(0x05070b);
}
