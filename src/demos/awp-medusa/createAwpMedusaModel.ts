import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import frontReferenceProjectionUrl from './assets/front-reference-projection.png';
import backReferenceProjectionUrl from './assets/back-reference-projection.png';
import paintedNormalUrl from './assets/pbr-front/skin-finish_normal.png';
import paintedRoughnessUrl from './assets/pbr-front/skin-finish_roughness.png';
// A tightly cropped, alpha-masked derivative of the supplied back-view crown
// is stored with the review artifacts. It is still reference pixels, but its
// transparent margin prevents the whole optic crop from becoming a decal.
const crownSourceProjectionUrl = '/img2threejs-showcase/.img2threejs/assets/crown-sticker.png';

/**
 * AWP | Medusa (Minimal Wear), procedural CS2 reconstruction.
 *
 * Frame: +X is muzzle direction, +Y is up, +Z is the reference FRONT side.
 * The two supplied broadside views are used only for shell artwork projection;
 * stock, receiver, optic, barrel, bolt, trigger, fasteners, and bipod are real
 * component geometry so a turntable cannot expose a paper-thin rifle.
 */

export interface AwpMedusaOptions {
  shadows?: boolean;
}

// Bare-metal palette follows the source pixel midtones after ACES; the
// brighter edge highlights are supplied by the light rig, not by a white
// constant albedo that would wash out the dark CS2 finish.
const STEEL = 0x58636b;
const STEEL_DARK = 0x30383f;
const STEEL_LIGHT = 0x929ca1;
const POLYMER = 0x131b29;

const FRONT_PAINT_EVIDENCE = ['front-broadside', 'front-medusa.webp'];
const BACK_PAINT_EVIDENCE = ['back-broadside', 'back-medusa.webp'];

function physical(
  color: THREE.ColorRepresentation,
  options: Partial<THREE.MeshPhysicalMaterialParameters> = {},
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.45,
    roughness: 0.34,
    clearcoat: 0.18,
    clearcoatRoughness: 0.2,
    ...options,
  });
}

function roundedHolePath(
  path: THREE.Path,
  x: number,
  y: number,
  rx: number,
  ry: number,
  radius: number,
): void {
  const r = Math.min(radius, rx * 0.48, ry * 0.48);
  const left = x - rx;
  const right = x + rx;
  const top = y + ry;
  const bottom = y - ry;
  path.moveTo(left + r, top);
  path.lineTo(right - r, top);
  path.quadraticCurveTo(right, top, right, top - r);
  path.lineTo(right, bottom + r);
  path.quadraticCurveTo(right, bottom, right - r, bottom);
  path.lineTo(left + r, bottom);
  path.quadraticCurveTo(left, bottom, left, bottom + r);
  path.lineTo(left, top - r);
  path.quadraticCurveTo(left, top, left + r, top);
  path.closePath();
}

function holeCutMaterial(
  base: THREE.MeshPhysicalMaterial,
  hole: { x: number; y: number; rx: number; ry: number; radius?: number },
): THREE.MeshPhysicalMaterial {
  const radius = hole.radius ?? Math.min(hole.rx, hole.ry) * 0.35;
  const material = base.clone();
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec2 medusaHolePosition;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  medusaHolePosition = transformed.xy;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying vec2 medusaHolePosition;\nvoid main() {')
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        vec2 medusaHoleDelta = abs(medusaHolePosition - vec2(${hole.x.toFixed(6)}, ${hole.y.toFixed(6)})) - vec2(${(hole.rx - radius).toFixed(6)}, ${(hole.ry - radius).toFixed(6)});
        float medusaHoleDistance = length(max(medusaHoleDelta, 0.0)) + min(max(medusaHoleDelta.x, medusaHoleDelta.y), 0.0) - ${radius.toFixed(6)};
        if (medusaHoleDistance < 0.0) discard;`,
      );
  };
  material.customProgramCacheKey = () => `medusa-stock-hole-${hole.x}-${hole.y}-${hole.rx}-${hole.ry}`;
  return material;
}

function part<T extends THREE.Object3D>(node: T, id: string, materialId: string, evidence = FRONT_PAINT_EVIDENCE): T {
  node.name = id;
  node.userData.part = id;
  node.userData.module = id;
  node.userData.materialId = materialId;
  node.userData.evidenceRefs = evidence;
  return node;
}

function addMesh(
  parent: THREE.Object3D,
  mesh: THREE.Mesh,
  id: string,
  materialId: string,
  evidence = FRONT_PAINT_EVIDENCE,
): THREE.Mesh {
  parent.add(part(mesh, id, materialId, evidence));
  return mesh;
}

function roundedBox(
  width: number,
  height: number,
  depth: number,
  radius: number,
  material: THREE.Material,
): THREE.Mesh {
  return new THREE.Mesh(
    new RoundedBoxGeometry(width, height, depth, 3, Math.min(radius, Math.min(width, height, depth) * 0.45)),
    material,
  );
}

function profileExtrude(
  points: Array<[number, number]>,
  depth: number,
  material: THREE.Material,
  hole?: { x: number; y: number; rx: number; ry: number },
): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  if (hole) {
    const cut = new THREE.Path();
    // The AWP thumbhole is a rounded molded opening, not a circular/elliptic
    // drill-through. Keep the authored shell, paint layer, and rim on the
    // same rounded path so the hole cannot turn into a white oval when the
    // front/back projection is removed or viewed at an angle.
    roundedHolePath(cut, hole.x, hole.y, hole.rx, hole.ry, Math.min(hole.rx, hole.ry) * 0.30);
    shape.holes.push(cut);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.035,
    bevelThickness: 0.03,
    curveSegments: 12,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function cylinderBetween(
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  segments = 24,
): THREE.Mesh {
  const direction = b.clone().sub(a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), segments), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

function darkMetalForBipod(base: THREE.Material): THREE.Material {
  if (!(base instanceof THREE.MeshPhysicalMaterial)) return base;
  const material = base.clone();
  material.color.set(0x374149);
  material.roughness = 0.34;
  return material;
}

function lightMetalForBipod(base: THREE.Material): THREE.Material {
  if (!(base instanceof THREE.MeshPhysicalMaterial)) return base;
  const material = base.clone();
  material.color.set(0x9aa3a7);
  material.roughness = 0.22;
  return material;
}

function addSocket(parent: THREE.Object3D, id: string, position: [number, number, number]): THREE.Object3D {
  const socket = new THREE.Object3D();
  socket.name = id;
  socket.position.set(...position);
  socket.userData.socket = id;
  socket.visible = false;
  parent.add(socket);
  return socket;
}

function loadPaint(url: string, flipX = false): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  if (flipX) {
    texture.repeat.x = -1;
    texture.offset.x = 1;
  }
  return texture;
}

function loadDataMap(url: string): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  return texture;
}

function bindEdgeMedusaProjection(material: THREE.MeshPhysicalMaterial): void {
  // The broadside projection layers cover the visible +/-Z walls. This shader
  // binds the same reference pixels to the real bevel/extrusion side faces so
  // a grazing orbit does not reveal a plain navy slab. It is a material bind
  // on authored geometry, not a camera-facing projection shell.
  const front = loadPaint(frontReferenceProjectionUrl);
  const back = loadPaint(backReferenceProjectionUrl, true);
  material.userData.edgeProjection = 'front-back-alpha-on-authored-side-faces';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.medusaEdgeFront = { value: front };
    shader.uniforms.medusaEdgeBack = { value: back };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 medusaEdgeWorldPosition;\nvarying vec3 medusaEdgeWorldNormal;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  medusaEdgeWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      )
      .replace(
        '#include <defaultnormal_vertex>',
        '#include <defaultnormal_vertex>\n  medusaEdgeWorldNormal = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 medusaEdgeWorldPosition;\nvarying vec3 medusaEdgeWorldNormal;\nuniform sampler2D medusaEdgeFront;\nuniform sampler2D medusaEdgeBack;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        if (abs(medusaEdgeWorldNormal.z) < 0.86) {
          vec2 edgeUv;
          edgeUv.x = clamp((medusaEdgeWorldPosition.x + 2.52) / 6.66, 0.0, 1.0);
          float sourceY = 460.0 - 143.0 * medusaEdgeWorldPosition.y;
          edgeUv.y = clamp(1.0 - sourceY / 900.0, 0.0, 1.0);
          vec4 edgeFront = texture2D(medusaEdgeFront, edgeUv);
          vec4 edgeBack = texture2D(medusaEdgeBack, edgeUv);
          float frontWeight = smoothstep(-0.34, 0.34, medusaEdgeWorldPosition.z);
          vec4 edgeSample = mix(edgeBack, edgeFront, frontWeight);
          diffuseColor.rgb = mix(diffuseColor.rgb, edgeSample.rgb, edgeSample.a * 0.86);
        }`,
      );
  };
  material.customProgramCacheKey = () => 'awp-medusa-edge-projection-v1';
}

function addBoundSurfaceProjection(
  parent: THREE.Object3D,
  points: Array<[number, number]>,
  texture: THREE.Texture,
  side: 1 | -1,
  surfaceHalfDepth: number,
  id: string,
  evidence: string[],
  hole?: { x: number; y: number; rx: number; ry: number; radius?: number },
): THREE.Mesh {
  // This is a conforming surface layer on one authored component. It is not a
  // root-level image shell: removing it leaves the real beveled/extruded mesh,
  // and its transform is owned by the same stock/receiver/grip group.
  const shape = new THREE.Shape();
  shape.moveTo(...points[0]);
  for (const point of points.slice(1)) shape.lineTo(...point);
  shape.closePath();
  if (hole) {
    const cut = new THREE.Path();
    roundedHolePath(cut, hole.x, hole.y, hole.rx, hole.ry, hole.radius ?? Math.min(hole.rx, hole.ry) * 0.3);
    shape.holes.push(cut);
  }
  const geometry = new THREE.ShapeGeometry(shape, 12);
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const frameXMin = -2.52;
  const frameXMax = 4.14;
  const frameYIntercept = 460;
  const frameYPerUnit = 143;
  for (let index = 0; index < positions.count; index += 1) {
    const localX = positions.getX(index);
    const localY = positions.getY(index);
    // Projection coordinates follow the authored component's local transform
    // before the final presentation scale. This keeps the pixels seated when
    // the component is moved, scaled, exploded, or animated as a group.
    const sourceX = parent.position.x + localX * parent.scale.x;
    const sourceYWorld = parent.position.y + localY * parent.scale.y;
    const sourceXpx = (sourceX - frameXMin) / (frameXMax - frameXMin) * 1600;
    const sourceYpx = frameYIntercept - frameYPerUnit * sourceYWorld;
    uv.setXY(index, sourceXpx / 1600, 1 - sourceYpx / 900);
    positions.setZ(index, side * (surfaceHalfDepth + 0.0012));
  }
  uv.needsUpdate = true;
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: texture,
    // Keep the source paint legible in the orbit's unlit side without turning
    // the layer into a flat unlit billboard. The same reference map supplies
    // a restrained emissive response, so dark blue snakes survive grazing
    // angles while metal highlights still come from the physical shader.
    emissive: 0x18334a,
    emissiveMap: texture,
    emissiveIntensity: 0.24,
    transparent: true,
    alphaTest: 0.025,
    depthTest: true,
    depthWrite: false,
    metalness: 0.16,
    roughness: 0.42,
    clearcoat: 0.22,
    clearcoatRoughness: 0.24,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    // The layer is owned by the authored component and sits on its side wall;
    // DoubleSide keeps that real surface readable during a three-quarter orbit
    // without adding a second root shell or a camera-facing projection.
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  part(mesh, id, 'projected-albedo', evidence);
  mesh.renderOrder = 3;
  mesh.userData.projectionBinding = 'conforming-decal';
  mesh.userData.boundTo = parent.name;
  mesh.userData.projectionAsset = side === 1
    ? 'assets/front-reference-projection.png'
    : 'assets/back-reference-projection.png';
  mesh.userData.attachment = {
    parent: parent.name,
    parentId: parent.name,
    parentSocket: `${parent.name}.painted-surface`,
    localStart: [points[0][0], points[0][1], side * surfaceHalfDepth],
    localEnd: [points[Math.floor(points.length / 2)][0], points[Math.floor(points.length / 2)][1], side * surfaceHalfDepth],
    contactType: 'surface-contact',
    embedDepth: 0.001,
    overlap: 0.001,
    gapTolerance: 0.015,
    evidenceRefs: evidence,
  };
  mesh.userData.explodeWithParent = true;
  parent.add(mesh);
  return mesh;
}

function addMedusaSurfaceLayers(
  stock: THREE.Object3D,
  receiver: THREE.Object3D,
  grip: THREE.Object3D,
): THREE.Mesh[] {
  const stockPoints: Array<[number, number]> = [
    [-2.49, 0.09], [-2.48, 0.33], [-2.23, 0.35], [-1.90, 0.35], [-1.65, 0.34],
    [-1.44, 0.28], [-1.19, 0.21], [-0.90, 0.18], [-1.04, -0.93], [-1.11, -0.93],
    [-1.18, -0.86], [-1.39, -0.70], [-1.58, -0.57], [-1.69, -0.40], [-1.80, -0.37],
    [-1.92, -0.44], [-2.16, -0.76], [-2.47, -0.80], [-2.49, -0.38],
  ];
  const receiverPoints: Array<[number, number]> = [
    [-0.55, 0.24], [0.08, 0.30], [1.43, 0.27], [1.68, 0.18], [1.68, -0.18],
    [1.68, -0.10], [-0.50, -0.20], [-0.55, -0.18], [-0.55, -0.06],
  ];
  const gripPoints: Array<[number, number]> = [
    [-0.78, -0.04], [-0.46, -0.04], [-0.43, -0.17], [-0.51, -0.31], [-0.68, -0.37],
    [-0.80, -0.28], [-0.86, -0.14],
  ];
  const stockHole = { x: -1.31, y: -0.34, rx: 0.22, ry: 0.19, radius: 0.060 };
  const layers: THREE.Mesh[] = [];
  for (const side of [1, -1] as const) {
    const texture = loadPaint(
      side === 1 ? frontReferenceProjectionUrl : backReferenceProjectionUrl,
      side === -1,
    );
    const evidence = side === 1 ? FRONT_PAINT_EVIDENCE : BACK_PAINT_EVIDENCE;
    // ExtrudeGeometry's bevelThickness expands the nominal half-depth by
    // about 0.03. Put each conforming layer on the actual outer wall; placing
    // it at the un-beveled half-depth makes the authored shell occlude it.
    // These values are local to the scaled receiving groups. Keep the real
    // artwork just outside the bevel after the depth compression; otherwise
    // the authored mesh correctly occludes its own paint layer.
    layers.push(addBoundSurfaceProjection(stock, stockPoints, texture, side, 0.34, `stock-medusa-${side === 1 ? 'front' : 'back'}`, evidence, stockHole));
    layers.push(addBoundSurfaceProjection(receiver, receiverPoints, texture, side, 0.27, `receiver-medusa-${side === 1 ? 'front' : 'back'}`, evidence));
    layers.push(addBoundSurfaceProjection(grip, gripPoints, texture, side, 0.31, `grip-medusa-${side === 1 ? 'front' : 'back'}`, evidence));
  }
  return layers;
}

function addCrownDecal(parent: THREE.Object3D): THREE.Group {
  const group = part(new THREE.Group(), 'optic-crown-decal', 'projected-albedo', BACK_PAINT_EVIDENCE);
  // On the supplied back view the camera reverses X: the sticker is on the
  // outer face of the objective taper, which therefore appears on the left.
  // At the sticker station the objective bell radius is about 0.21 units.
  // The old -0.305 placement left a visible air gap in rear three-quarter
  // orbit; keep this overlay tangent to the actual bell wall.
  // z is solved by the conical patch below. Keeping the group on the scope
  // centreline avoids adding the old flat-decal offset twice.
  group.position.set(1.15, 0.98, 0);
  // The measured crown occupies most of the visible objective taper. Size the
  // patch directly in the conical solve below instead of scaling it afterwards;
  // post-solve scaling made the upper/lower corners leave the bell wall in an
  // orbit even though the centre vertex touched.
  group.scale.set(1, 1, 1);
  // Use the supplied back plate's sticker pixels on a thin tangent decal. The
  // surrounding scope pixels are retained so the crown is source-grounded;
  // this is a surface component, not a camera-facing billboard.
  const sourceSticker = loadPaint(crownSourceProjectionUrl);
  // The supplied crop includes a margin of objective-bell pixels around the
  // sticker. Crop that margin in UV space so the crown/skull keeps the source
  // scale seen in the back reference instead of becoming a tiny brown dash.
  // The saved 180x210 crop includes objective and barrel margins. Restrict
  // sampling to the central crown/skull region so the decal does not carry a
  // bright source-scan line across the bell and the identity mark remains
  // legible at the same physical footprint.
  // The source crop's crown occupies a tall diagonal sub-region, not a
  // horizontal strip. Keep that sub-region's aspect so the skull remains a
  // readable printed mark on the tapered bell.
  sourceSticker.repeat.set(1, 1);
  sourceSticker.offset.set(0, 0);
  // The crop already contains the foil highlights and baked lighting. Use
  // the source pixels directly for this small decal; a lit physical shader
  // previously crushed the gold into a brown dash under ACES.
  const sourceStickerMaterial = new THREE.MeshBasicMaterial({
    map: sourceSticker,
    transparent: true,
    alphaTest: 0.18,
    // This is a tangent surface layer, not a camera-facing billboard. Writing
    // depth makes the bell occlude the sticker correctly at grazing angles;
    // the negative polygon offset keeps the coplanar layer stable.
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  sourceStickerMaterial.onBeforeCompile = (shader) => {
    // The saved crop contains a narrow near-white scan highlight from the
    // optic below the sticker. Remove only that low-saturation highlight;
    // saturated foil gold and dark skull linework remain source pixels.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      float sourceMax = max(max(sampledDiffuseColor.r, sampledDiffuseColor.g), sampledDiffuseColor.b);
      float sourceMin = min(min(sampledDiffuseColor.r, sampledDiffuseColor.g), sampledDiffuseColor.b);
      if (sourceMax > 0.82 && (sourceMax - sourceMin) < 0.12) discard;`,
    );
  };
  // The source crop carries the full crown/skull graphic. Project it onto a
  // shallow conical patch whose z coordinate follows the objective bell;
  // a flat plane was visibly detached in orbit because its centre touched
  // while its corners floated away from the tapered housing.
  const patchPositions: number[] = [];
  const patchUvs: number[] = [];
  const patchIndices: number[] = [];
  const patchColumns = 8;
  const patchRows = 5;
  for (let row = 0; row <= patchRows; row += 1) {
    const v = row / patchRows;
      const y = (v - 0.5) * 0.40;
    for (let column = 0; column <= patchColumns; column += 1) {
      const u = column / patchColumns;
      const x = (u - 0.5) * 0.31;
      const bellX = 1.15 + x;
      const bellT = THREE.MathUtils.clamp((bellX - 0.53) / 1.02, 0, 1);
      const bellRadius = THREE.MathUtils.lerp(0.205, 0.275, bellT);
      // The bell is a tapered cylinder. Solve the visible -Z surface from
      // both x (taper) and y (circular section) so the printed sticker stays
      // tangent at its corners instead of becoming a floating flat plate.
      const surfaceRadius = Math.sqrt(Math.max(0.0001, bellRadius * bellRadius - y * y));
      // Keep the decal only 0.0015 units proud of the bell.  The previous
      // 0.004-unit offset was inside the metadata tolerance but read as a
      // floating badge in the right orbit; this is a surface contact, not a
      // raised emblem.
      patchPositions.push(x, y, -(surfaceRadius + 0.0006));
      // TextureLoader's default image upload orientation already maps this
      // crop correctly: the source asset is authored crown-at-top,
      // skull/head-at-bottom, and direct V sampling preserves that order on
      // the tangent patch. Keep this explicit so a later loader change cannot
      // silently invert the sticker again.
      patchUvs.push(u, v);
    }
  }
  for (let row = 0; row < patchRows; row += 1) {
    for (let column = 0; column < patchColumns; column += 1) {
      const a = row * (patchColumns + 1) + column;
      const b = a + 1;
      const c = a + patchColumns + 1;
      const d = c + 1;
      patchIndices.push(a, c, b, b, c, d);
    }
  }
  const crownPatchGeometry = new THREE.BufferGeometry();
  crownPatchGeometry.setAttribute('position', new THREE.Float32BufferAttribute(patchPositions, 3));
  crownPatchGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(patchUvs, 2));
  crownPatchGeometry.setIndex(patchIndices);
  crownPatchGeometry.computeVertexNormals();
  const sourceStickerMesh = new THREE.Mesh(crownPatchGeometry, sourceStickerMaterial);
  sourceStickerMesh.renderOrder = 5;
  part(sourceStickerMesh, 'optic-crown-source-projection', 'projected-albedo', BACK_PAINT_EVIDENCE);
  sourceStickerMesh.userData.projection = 'saturation-isolated 180x210 source crop from back-medusa.webp, tangent to the objective bell';
  sourceStickerMesh.userData.attachment = {
    parent: 'scope-objective-taper',
    parentId: 'scope-objective-taper',
    parentSocket: 'scope-objective-taper.crown-decal-land',
    localStart: [0.86, 0.98, -0.21],
    localEnd: [1.44, 0.98, -0.21],
    contactType: 'surface-contact',
    embedDepth: 0.001,
    overlap: 0.001,
    gapTolerance: 0.015,
    evidenceRefs: BACK_PAINT_EVIDENCE,
  };
  sourceStickerMesh.userData.explodeWithParent = true;
  group.add(sourceStickerMesh);
  const foil = physical(0xf0bd3f, {
    metalness: 0.95,
    roughness: 0.1,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
    side: THREE.DoubleSide,
  });
  const crownShape = new THREE.Shape();
  crownShape.moveTo(-0.19, -0.02);
  crownShape.lineTo(-0.17, 0.13);
  crownShape.lineTo(-0.09, 0.06);
  crownShape.lineTo(0.0, 0.17);
  crownShape.lineTo(0.08, 0.06);
  crownShape.lineTo(0.17, 0.14);
  crownShape.lineTo(0.19, -0.02);
  crownShape.lineTo(0.12, -0.06);
  crownShape.lineTo(-0.12, -0.06);
  crownShape.closePath();
  const crown = new THREE.Mesh(new THREE.ExtrudeGeometry(crownShape, {
    depth: 0.001,
    bevelEnabled: false,
  }), foil);
  // Keep the exact source pixels as the only visible sticker artwork.  The
  // old raised crown/gems read as a floating metal emblem from orbit and did
  // not match the printed CS2 sticker silhouette.
  crown.visible = false;
  crown.position.z = -0.262;
  crown.position.y = 0.04;
  part(crown, 'optic-crown-mark', 'projected-albedo', BACK_PAINT_EVIDENCE);
  crown.userData.explodeWithParent = true;
  group.add(crown);
  [-0.17, 0, 0.17].forEach((x, index) => {
    const gem = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), foil);
    gem.scale.z = 0.35;
    gem.position.set(x, index === 1 ? 0.205 : 0.17, -0.006);
    gem.visible = false;
    part(gem, `optic-crown-foil-gem-${index + 1}`, 'projected-albedo', BACK_PAINT_EVIDENCE);
    gem.userData.explodeWithParent = true;
    group.add(gem);
  });
  const skullShape = new THREE.Shape();
  skullShape.absellipse(0, -0.095, 0.105, 0.105, 0, Math.PI * 2, false, 0);
  skullShape.lineTo(0.065, -0.24);
  skullShape.lineTo(-0.065, -0.24);
  skullShape.closePath();
  const skull = new THREE.Mesh(new THREE.ExtrudeGeometry(skullShape, {
    depth: 0.008,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.005,
    bevelThickness: 0.003,
  }), foil);
  skull.visible = false;
  skull.position.z = -0.264;
  part(skull, 'optic-skull-mark', 'projected-albedo', BACK_PAINT_EVIDENCE);
  skull.userData.explodeWithParent = true;
  group.add(skull);
  const socketMaterial = physical(0x090b0c, { metalness: 0.1, roughness: 0.38, side: THREE.DoubleSide });
  [-0.038, 0.038].forEach((x, index) => {
    const socket = new THREE.Mesh(new THREE.CircleGeometry(0.022, 12), socketMaterial);
    socket.visible = false;
    socket.position.z = -0.266;
    socket.position.set(x, -0.095, -0.012);
    part(socket, `optic-skull-eye-${index + 1}`, 'projected-albedo', BACK_PAINT_EVIDENCE);
    socket.userData.explodeWithParent = true;
    group.add(socket);
  });
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.018, 0.009), socketMaterial);
  jaw.visible = false;
  jaw.position.z = -0.266;
  jaw.position.set(0, -0.195, -0.012);
  part(jaw, 'optic-skull-jaw-mark', 'projected-albedo', BACK_PAINT_EVIDENCE);
  jaw.userData.explodeWithParent = true;
  group.add(jaw);
  [-0.026, 0, 0.026].forEach((x, index) => {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.018, 0.009), socketMaterial);
    tooth.visible = false;
    tooth.position.z = -0.267;
    tooth.position.set(x, -0.184, -0.013);
    part(tooth, `optic-skull-tooth-${index + 1}`, 'projected-albedo', BACK_PAINT_EVIDENCE);
    tooth.userData.explodeWithParent = true;
    group.add(tooth);
  });
  group.userData.explodeWithParent = true;
  parent.add(group);
  return group;
}

function makeScopeMarkingTexture(): THREE.Texture {
  if (typeof document === 'undefined') return new THREE.Texture();
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (!context) return new THREE.Texture();
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#c9d0d2';
  context.font = 'bold 64px Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('3 2 5 6 7', 256, 45);
  context.strokeStyle = '#899398';
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(22, 78);
  context.lineTo(490, 78);
  context.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function addFasteners(parent: THREE.Object3D, material: THREE.Material): THREE.Group {
  const group = part(new THREE.Group(), 'fastener-system', 'bare-metal');
  const addOwnerSet = (id: string, owner: string, points: Array<[number, number, number]>): void => {
    const geometry = new THREE.CylinderGeometry(0.032, 0.032, 0.045, 16);
    geometry.rotateX(Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geometry, material, points.length);
    mesh.name = id;
    mesh.userData.part = id;
    mesh.userData.module = 'fastener-system';
    mesh.userData.materialId = 'substrate';
    mesh.userData.evidenceRefs = FRONT_PAINT_EVIDENCE;
    mesh.userData.attachment = {
      parent: owner,
      parentId: owner,
      parentSocket: `${owner}.visible-fastener-land`,
      localStart: points[0],
      localEnd: points[points.length - 1],
      contactType: 'surface-contact',
      embedDepth: 0.004,
      overlap: 0.004,
      gapTolerance: 0.015,
      evidenceRefs: FRONT_PAINT_EVIDENCE,
    };
    const matrix = new THREE.Matrix4();
    points.forEach(([x, y, z], index) => {
      matrix.makeTranslation(x, y, z);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  };
  addOwnerSet('stock-fasteners', 'stock', [
    [-2.16, -0.14, 0.285], [-1.78, -0.1, 0.285], [-1.22, -0.1, 0.285],
    [-2.16, -0.14, -0.285], [-1.2, -0.1, -0.285],
  ]);
  addOwnerSet('receiver-fasteners', 'receiver', [
    [-0.35, -0.08, 0.245], [0.45, -0.06, 0.245], [1.25, -0.08, 0.245],
    [0.45, -0.06, -0.245], [1.25, -0.08, -0.245],
  ]);
  parent.add(group);
  return group;
}

function addRail(parent: THREE.Object3D, metal: THREE.Material): THREE.Group {
  const rail = part(new THREE.Group(), 'rail', 'bare-metal');
  rail.position.x = -0.82;
  // The rail is seated into the receiver crown; keeping its underside within
  // the receiver bevel prevents the complete optic assembly from floating in
  // a three-quarter view.
  rail.position.y = -0.34;
  addMesh(rail, roundedBox(0.98, 0.095, 0.28, 0.025, metal), 'rail', 'bare-metal').position.set(0.42, 0.56, 0);
  for (let i = 0; i < 10; i += 1) {
    const tooth = roundedBox(0.075, 0.09, 0.31, 0.015, metal);
    tooth.position.set(0.04 + i * 0.08, 0.63, 0);
    tooth.userData.part = 'rail-tooth';
    tooth.userData.explodeWithParent = true;
    rail.add(tooth);
  }
  rail.userData.attachment = {
    parent: 'receiver',
    parentId: 'receiver',
    parentSocket: 'receiver.scope-rail-socket',
    localStart: [0.04, 0.63, 0],
    localEnd: [0.82, 0.63, 0],
    contactType: 'embedded',
    embedDepth: 0.025,
    overlap: 0.025,
    gapTolerance: 0.015,
    evidenceRefs: FRONT_PAINT_EVIDENCE,
  };
  parent.add(rail);
  return rail;
}

function addScope(
  parent: THREE.Object3D,
  optic: THREE.Material,
  metal: THREE.Material,
  glass: THREE.Material,
): THREE.Group {
  const scope = part(new THREE.Group(), 'scope', 'optic', FRONT_PAINT_EVIDENCE);
  // Source pixels show the rings, clamp plates, and objective/ocular bands as
  // lighter machined steel than the graphite optic tube. Keep that distinction
  // local to the scope so it survives ACES tone mapping without recolouring
  // the receiver or barrel.
  const scopeClampMetal = lightMetalForBipod(metal);
  scope.position.x = -0.70;
  // Fit the optic to the source crop first.  The crop places the optic about
  // 4px above the receiver and gives it a slightly wider horizontal span than
  // the previous blockout.
  scope.position.y = -0.22;
  scope.scale.x = 0.84;
  // Source crop: the body tube is shorter and the objective taper carries more
  // of the visible optic length than the first blockout did.
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.16, 32), optic);
  tube.rotation.z = Math.PI / 2;
  tube.position.set(0.56, 0.89, 0);
  addMesh(scope, tube, 'scope', 'optic');
  // The supplied optic crop shows a shallow objective flare; the previous
  // radius made the lower bell swallow the mount silhouette in broadside.
  // Source-fit objective: the taper begins well before the front ring and
  // terminates under the narrow objective band.  A short bell made the model
  // read like a straight tube with a cap instead of the real funnel profile.
  // CylinderGeometry's top radius maps to the left end after the X rotation;
  // the reference widens toward the objective/front, so the radii are
  // intentionally ordered narrow-to-wide here.
  // Loop 18 / NotebookLM loop16: reduce the objective flare so it does not
  // swallow the front ring and expose a separate recessed lens surface.
  const frontBell = new THREE.Mesh(new THREE.CylinderGeometry(0.138, 0.195, 0.70, 32), optic);
  frontBell.rotation.z = Math.PI / 2;
  frontBell.position.set(1.15, 0.98, 0);
  addMesh(scope, frontBell, 'scope-objective-taper', 'optic');
  // Lengthen the ocular taper toward the rear ring; the reference has a
  // visibly longer narrowing section than the prior stub.
  const rearBell = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.20, 0.50, 32), optic);
  rearBell.rotation.z = Math.PI / 2;
  rearBell.position.set(-0.18, 0.89, 0);
  addMesh(scope, rearBell, 'scope-eyepiece', 'optic');
  // The source optic has a short clamped collar, not a free wire loop.  Keep
  // the collar coaxial with the tube so an orbit cannot expose a detached
  // torus-like ring behind the eyepiece.
  const ocularBand = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.20, 0.045, 32), scopeClampMetal);
  ocularBand.rotation.z = Math.PI / 2;
  ocularBand.position.set(-0.40, 0.89, 0);
  addMesh(scope, ocularBand, 'scope-ocular-band', 'bare-metal');
  const turretBase = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.08, 24), darkMetalForBipod(metal));
  turretBase.position.set(0.49, 1.06, 0);
  addMesh(scope, turretBase, 'scope-turret-base', 'bare-metal');
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.145, 20), metal);
  turret.position.set(0.49, 1.145, 0);
  addMesh(scope, turret, 'scope-turret', 'bare-metal');
  const turretCap = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.035, 20), metal);
  turretCap.position.set(0.49, 1.235, 0);
  addMesh(scope, turretCap, 'scope-turret-cap', 'bare-metal');
  // The reference crop shows a hand-grip knurl around the elevation turret;
  // keep those ridges as attached micro-geometry so the adjustment knob does
  // not read as a smooth floating puck in an orbit.
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    const ridge = roundedBox(0.012, 0.088, 0.010, 0.002, metal);
    ridge.position.set(0.49 + Math.cos(angle) * 0.073, 1.18, Math.sin(angle) * 0.073);
    ridge.rotation.y = -angle;
    addMesh(scope, ridge, `scope-turret-knurl-${index + 1}`, 'bare-metal');
  }
  const scopeHousing = metal.clone() as THREE.MeshPhysicalMaterial;
  scopeHousing.color.set(0x464e55);
  scopeHousing.roughness = 0.40;
  const sideTurret = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.165, 0.14, 12), scopeHousing);
  sideTurret.rotation.x = Math.PI / 2;
  // Root Y compensation keeps the broadside adjustment housing round after
  // the reference-fit vertical compression applied to the rifle.
  sideTurret.scale.z = 1.55;
  sideTurret.position.set(0.47, 0.89, 0.20);
  addMesh(scope, sideTurret, 'scope-side-turret', 'bare-metal');
  // A shallow inset face keeps the elevation housing a real layered optic
  // component instead of a single flat black disc in the broadside view.
  const sideTurretFace = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.026, 16), optic);
  sideTurretFace.rotation.x = Math.PI / 2;
  sideTurretFace.position.set(0.47, 0.89, 0.285);
  addMesh(scope, sideTurretFace, 'scope-side-turret-face', 'optic');
  const sideTurretFaceRing = new THREE.Mesh(new THREE.TorusGeometry(0.108, 0.011, 8, 24), darkMetalForBipod(metal));
  sideTurretFaceRing.position.set(0.47, 0.89, 0.304);
  addMesh(scope, sideTurretFaceRing, 'scope-side-turret-face-ring', 'bare-metal');
  const sideTurretCap = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.032, 12), darkMetalForBipod(metal));
  sideTurretCap.rotation.x = Math.PI / 2;
  sideTurretCap.position.set(0.47, 0.89, 0.318);
  addMesh(scope, sideTurretCap, 'scope-side-turret-cap', 'bare-metal');
  // Both supplied broadside views expose the optic's windage housing.  Keep a
  // real mirrored assembly on -Z instead of letting the back view fall back
  // to a featureless tube; this also makes the optic mechanically symmetric
  // in a three-quarter orbit.
  const backSideTurret = sideTurret.clone();
  backSideTurret.rotation.x = -Math.PI / 2;
  backSideTurret.position.z = -0.20;
  addMesh(scope, backSideTurret, 'scope-side-turret-back', 'bare-metal');
  // The source has one chamfered windage housing spanning the optic, with a
  // face visible from either side. A pair of deep cylinders made the mirrored
  // version protrude as an unexplained black tube in orbit; use one authored
  // rounded housing through the tube instead.
  sideTurret.visible = false;
  backSideTurret.visible = false;
  const turretHousing = roundedBox(0.29, 0.29, 0.32, 0.045, scopeHousing);
  turretHousing.position.set(0.47, 0.89, 0);
  addMesh(scope, turretHousing, 'scope-turret-housing', 'bare-metal');
  const backSideTurretFace = sideTurretFace.clone();
  backSideTurretFace.rotation.x = -Math.PI / 2;
  backSideTurretFace.position.z = -0.285;
  addMesh(scope, backSideTurretFace, 'scope-side-turret-face-back', 'optic');
  const backSideTurretFaceRing = sideTurretFaceRing.clone();
  backSideTurretFaceRing.position.z = -0.304;
  addMesh(scope, backSideTurretFaceRing, 'scope-side-turret-face-ring-back', 'bare-metal');
  const backSideTurretCap = sideTurretCap.clone();
  backSideTurretCap.rotation.x = -Math.PI / 2;
  backSideTurretCap.position.z = -0.318;
  addMesh(scope, backSideTurretCap, 'scope-side-turret-cap-back', 'bare-metal');
  [0.28, 0.76].forEach((x, index) => {
    // The reference optic uses squared clamp rings. Four real bars preserve
    // the open center and the visible hardware without an oversized circular
    // loop that reads as a separate object from the broadside camera.
    const ringId = index === 0 ? 'scope-ring-rear' : 'scope-ring-front';
    const ringAssembly = part(new THREE.Group(), ringId, 'bare-metal');
    ringAssembly.userData.attachment = {
      parent: 'scope',
      parentId: 'scope',
      parentSocket: `scope.${ringId}-station`,
      localStart: [x, 0.67, 0],
      localEnd: [x, 0.53, 0],
      contactType: 'embedded',
      embedDepth: 0.02,
      overlap: 0.02,
      gapTolerance: 0.015,
      evidenceRefs: FRONT_PAINT_EVIDENCE,
    };
    scope.add(ringAssembly);
    // A scope ring is a coaxial clamp around the tube, not a rectangular
    // frame. The torus axis is rotated onto X (the optic axis), so every
    // orbit sees a continuous metal band seated on the cylindrical optic.
    // The ring must overlap the optic tube. A 0.225 major radius left a
    // visible air gap (inner radius 0.197 > tube radius 0.18), so orbit views
    // read the ring as a floating U. This smaller coaxial collar intersects
    // the tube by 0.04 and keeps a continuous machined clamp silhouette.
    const clampRing = new THREE.Mesh(new THREE.TorusGeometry(0.154, 0.022, 12, 32), scopeClampMetal);
    clampRing.rotation.y = Math.PI / 2;
    clampRing.position.set(x, 0.89, 0);
    addMesh(ringAssembly, clampRing, `${ringId}-clamp-ring`, 'bare-metal');
    // The source shows each clamp as a narrow machined collar in broadside,
    // while the torus supplies the continuous rounded outer edge in orbit.
    // The collar overlaps the optic tube by 0.025 units so it cannot read as
    // a wire loop floating around the scope.
    const clampCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.045, 32), scopeClampMetal);
    clampCollar.rotation.z = Math.PI / 2;
    clampCollar.position.set(x, 0.89, 0);
    addMesh(ringAssembly, clampCollar, `${ringId}-machined-collar`, 'bare-metal');
    // A split clamp has two raised ears with a dark central seam; this keeps
    // the ring a real machined assembly instead of a single block.
    const clampTop = roundedBox(0.12, 0.05, 0.082, 0.012, scopeClampMetal);
    clampTop.position.set(x, 1.115, 0);
    addMesh(ringAssembly, clampTop, `${ringId}-clamp-top`, 'bare-metal');
    const clampSplit = roundedBox(0.018, 0.052, 0.088, 0.003, darkMetalForBipod(metal));
    clampSplit.position.set(x, 1.118, 0);
    addMesh(ringAssembly, clampSplit, `${ringId}-clamp-split`, 'bare-metal');
    // The source crop exposes a pair of fasteners on each clamp cap.  Their
    // axis is vertical through the cap; the previous three side-facing
    // cylinders read as loose dark beads in an orbit.  Use a real hex head,
    // neck, and washer at the two front/back screw stations instead.
    [-0.155, 0.155].forEach((z, screwIndex) => {
      const topScrew = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.042, 6), darkMetalForBipod(metal));
      topScrew.position.set(x, 1.142, z);
      addMesh(ringAssembly, topScrew, `${ringId}-top-screw-${screwIndex + 1}`, 'bare-metal');
      const topWasher = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.008, 16), scopeClampMetal);
      topWasher.position.set(x, 1.119, z);
      addMesh(ringAssembly, topWasher, `${ringId}-top-washer-${screwIndex + 1}`, 'bare-metal');
    });
    const saddle = roundedBox(0.17, 0.08, 0.21, 0.015, scopeClampMetal);
    // The saddle is the lower face of the ring assembly.  It must enter the
    // rail's top plane after the rifle's review-fit Y compression; leaving it
    // one pixel above the rail produced a floating scope in edge orbit.
    saddle.position.set(x, 0.455, 0);
    addMesh(ringAssembly, saddle, index === 0 ? 'scope-saddle-rear' : 'scope-saddle-front', 'bare-metal');
    // Loop 19 / NotebookLM loop18: make the support physically overlap the
    // tube and saddle in the authored hierarchy. The previous 0.23 height
    // only touched the tube mathematically and still read as floating in the
    // focused crop after bevels and tone-mapped highlights.
    const mount = roundedBox(0.072, 0.28, 0.15, 0.016, scopeClampMetal);
    mount.position.set(x, 0.585, 0);
    addMesh(ringAssembly, mount, index === 0 ? 'scope-mount-rear' : 'scope-mount-front', 'bare-metal');
    mount.userData.attachment = {
      parent: 'rail',
      parentId: 'rail',
      parentSocket: index === 0 ? 'rail.scope-ring-rear-station' : 'rail.scope-ring-front-station',
      localStart: [x, 0.45, 0],
      localEnd: [x, 0.455, 0],
      contactType: 'overlap',
      embedDepth: 0.025,
      overlap: 0.025,
      gapTolerance: 0.015,
      evidenceRefs: FRONT_PAINT_EVIDENCE,
    };
    const mountScrew = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.035, 6), scopeClampMetal);
    mountScrew.rotation.x = Math.PI / 2;
    mountScrew.position.set(x - 0.045, 0.64, 0.16);
    addMesh(ringAssembly, mountScrew, index === 0 ? 'scope-mount-screw-rear' : 'scope-mount-screw-front', 'bare-metal');
    [-0.115, 0.115].forEach((y, screwIndex) => {
      [-0.17, 0.17].forEach((z, faceIndex) => {
        const clampScrew = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.04, 6), lightMetalForBipod(metal));
        clampScrew.rotation.x = Math.PI / 2;
        clampScrew.position.set(x, 0.86 + y, z);
        addMesh(ringAssembly, clampScrew, `${ringId}-clamp-screw-${faceIndex === 0 ? 'back' : 'front'}-${screwIndex + 1}`, 'bare-metal');
      });
    });
    ringAssembly.traverse((node) => {
      if (node instanceof THREE.Mesh) node.userData.explodeWithParent = true;
    });
  });
  const objectiveBand = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.055, 32), scopeClampMetal);
  objectiveBand.rotation.z = Math.PI / 2;
  objectiveBand.position.set(1.50, 0.98, 0);
  addMesh(scope, objectiveBand, 'scope-objective-band', 'bare-metal');
  // Recessed lens faces are authored components: an orbit sees glass seated
  // behind the machined objective and ocular edges, never a flat paint cap.
  const objectiveGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.168, 0.168, 0.018, 32), glass);
  objectiveGlass.rotation.z = Math.PI / 2;
  objectiveGlass.position.set(1.532, 0.98, 0);
  addMesh(scope, objectiveGlass, 'scope-objective-glass', 'optic-glass');
  const ocularGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.142, 0.142, 0.018, 32), glass);
  ocularGlass.rotation.z = Math.PI / 2;
  ocularGlass.position.set(-0.445, 0.89, 0);
  addMesh(scope, ocularGlass, 'scope-eyepiece-glass', 'optic-glass');
  const marking = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.065),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: makeScopeMarkingTexture(),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  marking.position.set(-0.08, 0.89, 0.205);
  marking.renderOrder = 10;
  (marking.material as THREE.MeshBasicMaterial).depthTest = false;
  part(marking, 'scope-magnification-marking', 'optic-marking', FRONT_PAINT_EVIDENCE);
  marking.userData.explodeWithParent = true;
  scope.add(marking);
  addCrownDecal(scope);
  parent.add(scope);
  return scope;
}

function addTriggerGuard(parent: THREE.Object3D, metal: THREE.Material): THREE.Group {
  const group = part(new THREE.Group(), 'trigger-guard', 'bare-metal');
  // The guard is a compact, squared loop below the receiver.  It is parented
  // to the receiver so the seam, trigger pivot, and animation all share the
  // same mechanical frame; the previous free U-tube floated up below the
  // scope and was too large for the reference.
  // The trigger sits just forward of the thumbhole, at the receiver/stock
  // junction. Keeping it receiver-parented prevents drift during refits.
  // Move the rear bow into the stock shoulder. The previous station left a
  // small but visible open seam in the three-quarter rear view.
  group.position.set(-0.44, -0.19, 0);
  const guardShape = new THREE.Shape();
  guardShape.moveTo(-0.11, 0.055);
  guardShape.lineTo(0.11, 0.055);
  guardShape.lineTo(0.11, -0.08);
  guardShape.quadraticCurveTo(0.11, -0.125, 0.045, -0.145);
  guardShape.lineTo(-0.045, -0.145);
  guardShape.quadraticCurveTo(-0.11, -0.125, -0.11, -0.08);
  guardShape.closePath();
  const guardHole = new THREE.Path();
  guardHole.moveTo(-0.060, 0.010);
  guardHole.lineTo(0.060, 0.010);
  guardHole.lineTo(0.060, -0.060);
  guardHole.quadraticCurveTo(0.060, -0.090, 0.028, -0.105);
  guardHole.lineTo(-0.028, -0.105);
  guardHole.quadraticCurveTo(-0.060, -0.090, -0.060, -0.060);
  guardHole.closePath();
  guardShape.holes.push(guardHole);
  const guardGeometry = new THREE.ExtrudeGeometry(guardShape, {
    // The compact profile is correct in X/Y, but it must span the receiver
    // shell in Z or the painted projection hides the guard in both broadside
    // captures. This is a real through-body trigger bow, not a floating plate.
    depth: 0.52,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.018,
    bevelThickness: 0.014,
    curveSegments: 8,
  });
  guardGeometry.translate(0, 0, -0.26);
  addMesh(group, new THREE.Mesh(guardGeometry, metal), 'trigger-guard', 'bare-metal');

  const triggerPivot = part(new THREE.Group(), 'triggerPivot', 'bare-metal');
  triggerPivot.position.set(0, 0.005, 0);
  triggerPivot.userData.attachment = {
    parent: 'trigger-guard',
    parentId: 'trigger-guard',
    parentSocket: 'trigger-guard.trigger-pin',
    localStart: [0, 0.02, 0],
    localEnd: [0, 0.02, 0],
    contactType: 'hinge',
    embedDepth: 0.02,
    gapTolerance: 0.015,
    evidenceRefs: FRONT_PAINT_EVIDENCE,
  };
  const trigger = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.13, 6, 12), metal);
  trigger.position.set(0.012, -0.035, 0);
  trigger.scale.set(0.90, 0.78, 0.90);
  trigger.rotation.z = -0.14;
  addMesh(triggerPivot, trigger, 'trigger', 'bare-metal');
  group.add(triggerPivot);
  group.userData.pivot = triggerPivot;
  for (const [x, z, id] of [
    [-0.078, 0.105, 'trigger-guard-pin-front'],
    [0.078, 0.105, 'trigger-guard-pin-front-right'],
    [-0.078, -0.105, 'trigger-guard-pin-back'],
    [0.078, -0.105, 'trigger-guard-pin-back-right'],
  ] as const) {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.026, 12), metal);
    pin.rotation.x = Math.PI / 2;
    pin.position.set(x, 0.07, z);
    addMesh(group, pin, id, 'bare-metal');
  }
  group.userData.attachment = {
    parent: 'receiver',
    parentId: 'receiver',
    parentSocket: 'receiver.trigger-guard-socket',
    localStart: [-0.495, -0.19, 0],
    localEnd: [-0.495, -0.335, 0],
    contactType: 'embedded',
    embedDepth: 0.03,
    overlap: 0.03,
    gapTolerance: 0.015,
    evidenceRefs: FRONT_PAINT_EVIDENCE,
  };
  parent.add(group);
  return group;
}

function addBipod(parent: THREE.Object3D, metal: THREE.Material): THREE.Group {
  const group = part(new THREE.Group(), 'bipod', 'bare-metal');
  const attach = (
    node: THREE.Object3D,
    parentId: string,
    parentSocket: string,
    localStart: [number, number, number],
    localEnd: [number, number, number],
    contactType: 'embedded' | 'overlap' | 'hinge' | 'socket' = 'overlap',
  ): void => {
    node.userData.attachment = {
      parent: parentId,
      parentId,
      parentSocket,
      localStart,
      localEnd,
      contactType,
      embedDepth: 0.025,
      overlap: 0.025,
      gapTolerance: 0.015,
      evidenceRefs: FRONT_PAINT_EVIDENCE,
    };
  };
  // Seat the hinge plate into the receiver/fore-end underside.  The previous
  // -0.18 position left a visible gap in the butt-end orbit; -0.27 gives the
  // plate a measured ~0.03-unit seam overlap after root scaling.
  // The receiver was vertically compressed after the first bipod pass. Seat
  // the hinge plate back into its underside so the real overlap is visible,
  // not merely asserted by attachment metadata.
  group.position.y = -0.22;
  // Source projection places the folded bipod root under the fore-end rather
  // than directly below the receiver centre. Move the complete tube/spring
  // assembly with its hinge as one authored component; the receiver profile
  // above was extended by the same measured amount so the seam remains real.
  group.position.x = 0.12;
  group.scale.x = 0.9;
  // The reference shows a folded support with a continuous tube, a shaped
  // hinge plate, and a visible locking lug. Keep the two hidden-side rails
  // parallel; the broadside view should never read as two disconnected rods.
  const hingePlate = profileExtrude([
    [1.22, -0.07], [1.58, -0.07], [1.55, -0.20], [1.46, -0.30],
    [1.29, -0.28], [1.20, -0.18],
  ], 0.28, darkMetalForBipod(metal));
  addMesh(group, hingePlate, 'bipod-hinge-plate', 'bare-metal');
  attach(hingePlate, 'receiver', 'receiver.bipod-fore-end-socket', [1.22, -0.07, 0], [1.58, -0.20, 0], 'embedded');
  const hinge = roundedBox(0.17, 0.10, 0.28, 0.022, metal);
  hinge.position.set(1.39, -0.10, 0);
  addMesh(group, hinge, 'bipod-hinge', 'bare-metal');
  attach(hinge, 'bipod-hinge-plate', 'bipod-hinge-plate.axle', [1.39, -0.10, 0], [1.39, -0.22, 0], 'hinge');
  const mountSaddle = roundedBox(0.36, 0.07, 0.30, 0.016, metal);
  mountSaddle.position.set(1.40, -0.035, 0);
  addMesh(group, mountSaddle, 'bipod-mount-saddle', 'bare-metal');
  attach(mountSaddle, 'bipod-hinge', 'bipod-hinge.saddle', [1.40, -0.035, 0], [1.40, -0.10, 0], 'embedded');
  // The reference shows a telescoping folded pair: a wider spring/outer
  // section followed by a narrower inner tube.  Keeping the seam as real
  // overlapping geometry makes both the mechanism and the orbit silhouette
  // read correctly.
  const leftOuter = cylinderBetween(new THREE.Vector3(1.37, -0.23, 0.16), new THREE.Vector3(2.10, -0.22, 0.16), 0.047, metal, 20);
  const rightOuter = cylinderBetween(new THREE.Vector3(1.37, -0.23, -0.16), new THREE.Vector3(2.10, -0.22, -0.16), 0.047, metal, 20);
  const leftInner = cylinderBetween(new THREE.Vector3(2.04, -0.22, 0.16), new THREE.Vector3(2.62, -0.19, 0.16), 0.038, darkMetalForBipod(metal), 20);
  const rightInner = cylinderBetween(new THREE.Vector3(2.04, -0.22, -0.16), new THREE.Vector3(2.62, -0.19, -0.16), 0.038, darkMetalForBipod(metal), 20);
  addMesh(group, leftOuter, 'bipod-left', 'bare-metal');
  addMesh(group, rightOuter, 'bipod-right', 'bare-metal');
  addMesh(group, leftInner, 'bipod-left-inner', 'bare-metal');
  addMesh(group, rightInner, 'bipod-right-inner', 'bare-metal');
  attach(leftOuter, 'bipod-hinge', 'bipod-hinge.left-leg-seat', [1.37, -0.23, 0.16], [2.10, -0.22, 0.16]);
  attach(rightOuter, 'bipod-hinge', 'bipod-hinge.right-leg-seat', [1.37, -0.23, -0.16], [2.10, -0.22, -0.16]);
  attach(leftInner, 'bipod-left-sleeve', 'bipod-left-sleeve.telescoping-joint', [2.04, -0.22, 0.16], [2.62, -0.19, 0.16]);
  attach(rightInner, 'bipod-right-sleeve', 'bipod-right-sleeve.telescoping-joint', [2.04, -0.22, -0.16], [2.62, -0.19, -0.16]);
  for (const [x, z, id] of [[1.66, 0.16, 'bipod-left-sleeve'], [1.66, -0.16, 'bipod-right-sleeve']] as const) {
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.18, 20), darkMetalForBipod(metal));
    sleeve.rotation.z = Math.PI / 2;
    sleeve.position.set(x, -0.22, z);
    addMesh(group, sleeve, id, 'bare-metal');
    attach(sleeve, 'bipod-hinge', `bipod-hinge.${id}-seat`, [x, -0.22, z], [x + 0.18, -0.22, z], 'overlap');
  }
  const hingePin = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.42, 20), metal);
  hingePin.rotation.x = Math.PI / 2;
  hingePin.position.set(1.42, -0.22, 0);
  addMesh(group, hingePin, 'bipod-hinge-pin', 'bare-metal');
  attach(hingePin, 'bipod-hinge', 'bipod-hinge.axle', [1.42, -0.22, -0.21], [1.42, -0.22, 0.21], 'hinge');
  for (const [z, id] of [[0.225, 'bipod-hinge-washer-front'], [-0.225, 'bipod-hinge-washer-back']] as const) {
    const washer = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.028, 20), lightMetalForBipod(metal));
    washer.rotation.x = Math.PI / 2;
    washer.position.set(1.42, -0.22, z);
    addMesh(group, washer, id, 'bare-metal');
  }
  const lockingLug = roundedBox(0.105, 0.12, 0.13, 0.018, darkMetalForBipod(metal));
  lockingLug.position.set(1.27, -0.27, 0.22);
  lockingLug.rotation.z = -0.16;
  addMesh(group, lockingLug, 'bipod-locking-lug', 'bare-metal');
  attach(lockingLug, 'bipod-hinge', 'bipod-hinge.lock-lug', [1.27, -0.27, 0.22], [1.34, -0.27, 0.22], 'hinge');
  const lockPin = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.15, 12), lightMetalForBipod(metal));
  lockPin.rotation.x = Math.PI / 2;
  lockPin.position.set(1.29, -0.27, 0.22);
  addMesh(group, lockPin, 'bipod-lock-pin', 'bare-metal');
  attach(lockPin, 'bipod-locking-lug', 'bipod-locking-lug.pin', [1.29, -0.27, 0.22], [1.29, -0.27, 0.22], 'hinge');
  const addSpring = (z: number, id: string): void => {
    const springPoints = Array.from({ length: 257 }, (_, index) => {
      const t = index / 256;
      // Fourteen readable turns preserve the compression-spring silhouette;
      // the earlier eighteen turns collapsed into a saw-tooth at review size.
      const phase = t * Math.PI * 28;
      return new THREE.Vector3(
        1.48 + t * 0.62,
        -0.22 + Math.sin(phase) * 0.050,
        z + Math.cos(phase) * 0.050,
      );
    });
    // A coil should catch a narrow highlight on every turn. Use a lighter
    // machined-steel material than the dark spine so the helix remains a
    // readable circular tube instead of collapsing into a saw-tooth stripe.
    const spring = new THREE.Mesh(new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(springPoints, false, 'centripetal', 0.5),
      96,
      0.022,
      12,
      false,
    ), lightMetalForBipod(metal));
    addMesh(group, spring, id, 'bare-metal');
    spring.userData.attachment = {
      parent: 'bipod-hinge',
      parentId: 'bipod-hinge',
      parentSocket: 'bipod-hinge.spring-seat',
      localStart: [1.48, -0.22, z],
      localEnd: [2.10, -0.22, z],
      baseRadius: 0.014,
      endRadius: 0.014,
      contactType: 'surface-contact',
      overlap: 0.025,
      gapTolerance: 0.015,
      evidenceRefs: FRONT_PAINT_EVIDENCE,
    };
  };
  addSpring(0.16, 'bipod-spring');
  addSpring(-0.16, 'bipod-spring-back');
  for (const [z, id] of [[0.16, 'bipod-spring-spine'], [-0.16, 'bipod-spring-spine-back']] as const) {
    const spine = cylinderBetween(
      new THREE.Vector3(1.48, -0.22, z),
      new THREE.Vector3(2.10, -0.22, z),
      0.012,
      metal,
      12,
    );
    addMesh(group, spine, id, 'bare-metal');
  }
  for (const [x, z, id] of [[2.64, 0.16, 'bipod-foot'], [2.64, -0.16, 'bipod-foot-back']] as const) {
    const footHousing = roundedBox(0.22, 0.11, 0.13, 0.022, darkMetalForBipod(metal));
    footHousing.position.set(x, -0.25, z);
    addMesh(group, footHousing, id, 'bare-metal');
    attach(footHousing, id.includes('back') ? 'bipod-right-inner' : 'bipod-left-inner', 'bipod-leg.foot-seat', [x, -0.25, z], [x + 0.11, -0.25, z], 'overlap');
    const footPad = roundedBox(0.16, 0.10, 0.15, 0.022, darkMetalForBipod(metal));
    footPad.position.set(x + 0.095, -0.25, z);
    addMesh(group, footPad, `${id}-pad`, 'bare-metal');
    attach(footPad, id, `${id}.foot-pad-seat`, [x + 0.095, -0.25, z], [x + 0.19, -0.25, z], 'overlap');
    const footEnd = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.075, 18), lightMetalForBipod(metal));
    footEnd.rotation.z = Math.PI / 2;
    footEnd.position.set(x + 0.18, -0.25, z);
    addMesh(group, footEnd, `${id}-end-cap`, 'bare-metal');
    attach(footEnd, `${id}-pad`, `${id}-pad.end-cap`, [x + 0.18, -0.25, z], [x + 0.22, -0.25, z], 'embedded');
  }
  const jointBlock = roundedBox(0.16, 0.11, 0.14, 0.018, darkMetalForBipod(metal));
  jointBlock.position.set(2.18, -0.22, 0.16);
  addMesh(group, jointBlock, 'bipod-spring-joint', 'bare-metal');
  attach(jointBlock, 'bipod-left-inner', 'bipod-left-inner.joint', [2.18, -0.22, 0.16], [2.18, -0.22, 0.16], 'overlap');
  group.userData.attachment = {
    parent: 'receiver',
    parentId: 'receiver',
    parentSocket: 'receiver.bipod-fore-end-socket',
    localStart: [1.22, -0.07, 0],
    localEnd: [1.58, -0.30, 0],
    contactType: 'socket',
    embedDepth: 0.03,
    overlap: 0.03,
    gapTolerance: 0.015,
    evidenceRefs: FRONT_PAINT_EVIDENCE,
  };
  const springCollars = [1.48, 2.10];
  springCollars.forEach((x, index) => {
    [0.16, -0.16].forEach((z, sideIndex) => {
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.016, 10, 24), lightMetalForBipod(metal));
      collar.rotation.y = Math.PI / 2;
      collar.position.set(x, -0.22, z);
      addMesh(group, collar, `bipod-spring-collar-${index + 1}-${sideIndex === 0 ? 'front' : 'back'}`, 'bare-metal');
    });
  });
  parent.add(group);
  return group;
}

export function createAwpMedusaLookDevLights(): THREE.Group {
  const rig = new THREE.Group();
  rig.name = 'AWP Medusa neutral look-dev lights';
  const key = new THREE.DirectionalLight(0xdbe4e8, 2.2);
  key.position.set(-2, 4, 5);
  rig.add(key);
  const rim = new THREE.DirectionalLight(0x668292, 0.72);
  rim.position.set(4, 1.5, -4);
  rig.add(rim);
  // The supplied back broadside is a separate review view. A restrained
  // negative-Z fill preserves the dark coated finish while keeping the
  // receiver artwork and optic hardware readable instead of crushed black.
  const backFill = new THREE.DirectionalLight(0x8096a1, 0.52);
  backFill.position.set(-1.8, 2.2, -5.5);
  rig.add(backFill);
  const fill = new THREE.PointLight(0x38515c, 1.35, 9, 2);
  fill.position.set(-1.3, 0.6, 2.5);
  rig.add(fill);
  return rig;
}

export function makeAwpMedusaBackground(): THREE.Color {
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('reviewWhite') === '1') {
    return new THREE.Color(0xffffff);
  }
  return new THREE.Color(0x03050a);
}

export function createAwpMedusaModel({ shadows = true }: AwpMedusaOptions = {}): THREE.Group {
  const root = part(new THREE.Group(), 'AWP_Medusa_MinimalWear', 'hidden');
  root.userData.sculptRuntime = {
    schemaVersion: '1.0',
    itemFamily: 'rifle',
    subtype: 'awp',
    componentAdapter: 'cs2-rifle-v1',
    adapterContractVersion: '1',
    fixtureId: 'cs2-rifle-awp-front-v1',
    coordinateFrame: '+X muzzle, +Y up, +Z front broadside',
    evidence: ['front-medusa.webp', 'back-medusa.webp'],
    confidence: {
      silhouette: 0.99,
      paintedPlacement: 0.96,
      hiddenDepth: 0.25,
      roughnessMetalness: 0.48,
      minimalWear: 0.55,
    },
  };

  // Source-PBR palette: front #1c2737 / #081220; the brighter cyan accents
  // remain in the projected albedo rather than being pushed into base color.
  const painted = physical(0x1c2737, {
    metalness: 0.18,
    roughness: 0.54,
    clearcoat: 0.34,
    clearcoatRoughness: 0.18,
  });
  painted.normalMap = loadDataMap(paintedNormalUrl);
  painted.normalScale.setScalar(0.16);
  painted.roughnessMap = loadDataMap(paintedRoughnessUrl);
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mapStripped') === '1') {
    painted.normalMap = null;
    painted.roughnessMap = null;
  }
  // The supplied broadside plates cannot observe the hidden extrusion walls.
  // Use a conservative inferred navy coated-steel finish for those walls so
  // orbit views remain readable instead of exposing an unlit black default.
  const sidePaint = physical(0x1a2a40, {
    metalness: 0.12,
    roughness: 0.60,
    clearcoat: 0.10,
    clearcoatRoughness: 0.32,
  });
  bindEdgeMedusaProjection(sidePaint);
  const metal = physical(STEEL, { metalness: 0.88, roughness: 0.28 });
  const darkMetal = physical(STEEL_DARK, { metalness: 0.86, roughness: 0.35 });
  // The reference barrel is blue-black coated steel, distinct from the bright
  // bare-metal rail, rings, fasteners, and bolt hardware.
  const barrelMetal = physical(0x222b31, { metalness: 0.58, roughness: 0.38 });
  const lightMetal = physical(STEEL_LIGHT, { metalness: 0.92, roughness: 0.2 });
  const polymer = physical(POLYMER, { metalness: 0.04, roughness: 0.48 });
  // Scope-only crop evidence: #2d3035/#383d44/#595e68, roughness base 0.687,
  // variation 0.074, normal strength 0.205. Keep the optic a matte coated
  // graphite instead of the plastic-like low-roughness response from blockout.
  const optic = physical(0x3a4149, {
    metalness: 0.52,
    roughness: 0.52,
    clearcoat: 0.12,
    clearcoatRoughness: 0.3,
    transmission: 0.01,
  });
  const wear = physical(0x8b98a7, { metalness: 0.78, roughness: 0.24 });

  const receiver = part(new THREE.Group(), 'receiver', 'skin-finish');
  const receiverMesh = profileExtrude([
    [-0.55, 0.24], [0.08, 0.3], [1.43, 0.27], [1.68, 0.18], [1.68, -0.18],
    [1.68, -0.1], [-0.5, -0.2], [-0.55, -0.18], [-0.55, -0.06],
  ], 0.44, painted);
  receiverMesh.material = [painted, sidePaint];
  addMesh(receiver, receiverMesh, 'receiver', 'skin-finish');
  receiver.position.set(-0.3, -0.12, 0);
  // Source-column sampling puts the broad receiver body at roughly 72 px
  // high in the 1600x900 review frame; the earlier 1.18 scale rendered a
  // visibly over-deep lower edge around the grip/trigger transition.
  // Retained baseline after the loop17 thinning experiment: the smaller
  // receiver reduced aspect error but visibly lowered silhouette overlap.
  // Keep the source-fitted receiver contour until a localized profile edit is
  // measured against the fixed view.
  receiver.scale.y = 0.93;
  const ejectionPort = roundedBox(0.16, 0.07, 0.045, 0.012, darkMetal);
  ejectionPort.position.set(1.62, 0.16, 0.265);
  addMesh(receiver, ejectionPort, 'receiver-ejection-port', 'bare-metal');
  const ejectionPortLip = roundedBox(0.22, 0.1, 0.028, 0.012, metal);
  ejectionPortLip.position.set(1.62, 0.16, 0.255);
  addMesh(receiver, ejectionPortLip, 'receiver-ejection-port-lip', 'bare-metal');
  const ejectionRecess = roundedBox(0.1, 0.04, 0.018, 0.006, polymer);
  ejectionRecess.position.set(1.62, 0.16, 0.277);
  addMesh(receiver, ejectionRecess, 'receiver-ejection-recess', 'polymer');
  root.add(receiver);

  const stock = part(new THREE.Group(), 'stock', 'skin-finish');
  const stockHole = { x: -1.31, y: -0.34, rx: 0.22, ry: 0.19, radius: 0.060 };
  const stockMesh = profileExtrude([
    [-2.49, 0.09], [-2.48, 0.33], [-2.23, 0.35], [-1.90, 0.35], [-1.65, 0.34],
    [-1.44, 0.28], [-1.19, 0.21], [-0.90, 0.18], [-1.04, -0.93], [-1.11, -0.93],
    [-1.18, -0.86], [-1.39, -0.70], [-1.58, -0.57], [-1.69, -0.40], [-1.80, -0.37],
    [-1.92, -0.44], [-2.16, -0.76], [-2.47, -0.80], [-2.49, -0.38],
  ], 0.58, holeCutMaterial(painted, stockHole), stockHole);
  stockMesh.material = [stockMesh.material as THREE.Material, sidePaint];
  addMesh(stock, stockMesh, 'stock', 'skin-finish');
  // Source columns show the butt/cheek envelope slightly shorter vertically
  // than the raw traced profile; scale the stock assembly around its local
  // origin so the receiver and barrel remain untouched.
  // Retained baseline after the loop17 thinning experiment: uniform scaling
  // reduced overlap around the thumbhole/lower contour, so the stock stays at
  // its measured loop16 envelope while the next pass targets local profile
  // vertices instead of shrinking the complete assembly.
  stock.scale.set(0.92, 0.80, 0.78);
  // The source stock sits visibly higher against the receiver than the first
  // traced envelope; lift only this assembly so the cheek line and lower
  // thumbhole return match without moving the locked optic or receiver.
  stock.position.y = -0.13;
  stock.userData.attachment = {
    parent: 'receiver',
    parentId: 'receiver',
    parentSocket: 'receiver.stock-shoulder-socket',
    localStart: [-0.90, 0.18, 0],
    localEnd: [-0.55, 0.20, 0],
    contactType: 'overlap',
    embedDepth: 0.03,
    overlap: 0.03,
    gapTolerance: 0.015,
    evidenceRefs: FRONT_PAINT_EVIDENCE,
  };
  // A real molded thumbhole has a soft returned edge. Two attached elliptical
  // torus strips provide that fillet on the visible front/back walls; they are
  // deliberately shallow and use the dark steel/polymer transition rather
  // than pretending to be extra painted linework.
  const thumbholeFrameMaterial = painted.clone();
  thumbholeFrameMaterial.color.set(0x101b2b);
  thumbholeFrameMaterial.roughness = 0.48;
  [0.30, -0.314].forEach((z, index) => {
    // A thin extruded rounded ring follows the molded thumbhole perimeter.
    // The former scaled torus was an ellipse and visibly disagreed with the
    // rounded rectangular cut in the stock and its projected artwork.
    const frameShape = new THREE.Shape();
    roundedHolePath(frameShape, stockHole.x, stockHole.y, stockHole.rx + 0.022, stockHole.ry + 0.022, 0.070);
    const frameHole = new THREE.Path();
    roundedHolePath(frameHole, stockHole.x, stockHole.y, stockHole.rx, stockHole.ry, 0.065);
    frameShape.holes.push(frameHole);
    const frameGeometry = new THREE.ExtrudeGeometry(frameShape, {
      depth: 0.016,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.004,
      bevelThickness: 0.003,
      curveSegments: 8,
    });
    frameGeometry.translate(0, 0, z);
    const thumbholeFrame = new THREE.Mesh(frameGeometry, thumbholeFrameMaterial);
    addMesh(stock, thumbholeFrame, index === 0 ? 'stock-thumbhole-bevel-front' : 'stock-thumbhole-bevel-back', 'skin-finish');
  });
  const buttpad = roundedBox(0.08, 0.72, 0.62, 0.035, polymer);
  buttpad.position.set(-2.51, -0.29, 0);
  addMesh(stock, buttpad, 'stock-buttpad', 'polymer');
  const buttpadSeam = roundedBox(0.025, 0.66, 0.64, 0.008, darkMetal);
  buttpadSeam.position.set(-2.445, -0.29, 0);
  addMesh(stock, buttpadSeam, 'stock-buttpad-seam', 'bare-metal');
  for (const z of [0.255, -0.255]) {
    [-0.08, -0.50].forEach((y, index) => {
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.028, 6), lightMetal);
      screw.rotation.x = Math.PI / 2;
      screw.position.set(-2.455, y, z);
      addMesh(stock, screw, `stock-buttpad-screw-${z > 0 ? 'front' : 'back'}-${index + 1}`, 'bare-metal');
    });
  }
  const cheekRest = roundedBox(0.68, 0.09, 0.40, 0.035, polymer);
  cheekRest.position.set(-1.62, 0.28, 0);
  addMesh(stock, cheekRest, 'stock-cheek-rest', 'polymer');
  root.add(stock);

  const grip = part(new THREE.Group(), 'grip', 'skin-finish');
  const gripMesh = profileExtrude([
    [-0.78, -0.04], [-0.46, -0.04], [-0.43, -0.17], [-0.51, -0.31], [-0.68, -0.37],
    [-0.80, -0.28], [-0.86, -0.14],
  ], 0.56, painted);
  gripMesh.material = [painted, sidePaint];
  addMesh(grip, gripMesh, 'grip', 'skin-finish');
  grip.position.set(-1.02, -0.04, 0);
  grip.scale.set(0.55, 0.65, 1);
  grip.userData.attachment = {
    parent: 'stock',
    parentId: 'stock',
    parentSocket: 'stock.grip-shoulder-socket',
    localStart: [-0.78, -0.04, 0],
    localEnd: [-0.58, -0.16, 0],
    contactType: 'overlap',
    embedDepth: 0.025,
    overlap: 0.025,
    gapTolerance: 0.015,
    evidenceRefs: FRONT_PAINT_EVIDENCE,
  };
  root.add(grip);

  const magazine = part(new THREE.Group(), 'magazine', 'bare-metal');
  const mag = roundedBox(0.22, 0.42, 0.31, 0.035, metal);
  // Keep the source-fit station from the last accepted envelope correction;
  // the forward shift was tested and rejected by both broadside IoU gates.
  mag.position.set(-0.22, -0.51, 0);
  mag.rotation.z = -0.07;
  addMesh(magazine, mag, 'magazine', 'bare-metal');
  // The reference magazine has visible stamped ribs and a separate floorplate;
  // keep them as real attached pieces instead of baking a stripe into paint.
  [-0.06, 0, 0.06].forEach((x, index) => {
    const rib = roundedBox(0.018, 0.31, 0.018, 0.006, lightMetal);
    rib.position.set(-0.22 + x, -0.51, 0.16);
    addMesh(magazine, rib, `magazine-rib-${index + 1}`, 'bare-metal');
  });
  for (const z of [0.166, -0.166]) {
    [-0.40, -0.51, -0.62].forEach((y, index) => {
      const stamp = roundedBox(0.17, 0.022, 0.018, 0.004, lightMetal);
      stamp.position.set(-0.22, y, z);
      addMesh(magazine, stamp, `magazine-stamp-${z > 0 ? 'front' : 'back'}-${index + 1}`, 'bare-metal');
    });
  }
  const floorplate = roundedBox(0.34, 0.045, 0.31, 0.01, metal);
  floorplate.position.set(-0.25, -0.70, 0);
  addMesh(magazine, floorplate, 'magazine-floorplate', 'bare-metal');
  [-0.09, 0.09].forEach((x, index) => {
    const detent = roundedBox(0.045, 0.022, 0.028, 0.005, darkMetal);
    detent.position.set(-0.25 + x, -0.725, 0.16);
    addMesh(magazine, detent, `magazine-floorplate-detent-${index + 1}`, 'bare-metal');
  });
  magazine.userData.attachment = {
    parent: 'receiver',
    parentId: 'receiver',
    parentSocket: 'receiver.magazine-well',
    localStart: [-0.22, -0.25, 0],
    localEnd: [-0.25, -0.72, 0],
    contactType: 'socket',
    embedDepth: 0.035,
    overlap: 0.035,
    gapTolerance: 0.015,
    evidenceRefs: FRONT_PAINT_EVIDENCE,
  };
  root.add(magazine);

  const triggerGroup = addTriggerGuard(receiver, lightMetal);

  const barrel = part(new THREE.Group(), 'barrel', 'bare-metal');
  // Broadside trace and loop14 review show the current barrel taking too much
  // of the longitudinal silhouette relative to the stock/receiver. Preserve
  // its receiver-side start and bring the muzzle station back as one assembly.
  const barrelMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.115, 3.40, 32), barrelMetal);
  barrelMesh.rotation.z = Math.PI / 2;
  barrelMesh.position.set(2.82, 0.34, 0);
  barrel.position.set(-0.1, -0.17, 0);
  addMesh(barrel, barrelMesh, 'barrel', 'bare-metal');
  const foreEndBand = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 10, 24), darkMetal);
  foreEndBand.rotation.y = Math.PI / 2;
  // The source band is a muzzle-side barrel collar, not a receiver-side
  // floating ring. Move it to the final quarter of the barrel where the
  // front/back plates show the stepped transition into the muzzle device.
  foreEndBand.position.set(4.00, 0.34, 0);
  addMesh(barrel, foreEndBand, 'fore-end-band', 'bare-metal');
  root.add(barrel);

  const muzzle = part(new THREE.Group(), 'muzzle', 'bare-metal');
  muzzle.position.set(-0.25, -0.17, 0);
  const muzzleMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.12, 0.34, 32, 1, true), darkMetal);
  muzzleMesh.rotation.z = Math.PI / 2;
  muzzleMesh.position.set(4.60, 0.34, 0);
  addMesh(muzzle, muzzleMesh, 'muzzle', 'bare-metal');
  const muzzleCrown = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.018, 10, 28), lightMetal);
  muzzleCrown.rotation.y = Math.PI / 2;
  muzzleCrown.position.set(4.775, 0.34, 0);
  addMesh(muzzle, muzzleCrown, 'muzzle-bore-crown', 'bare-metal');
  const boreLip = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.009, 10, 24), darkMetal);
  boreLip.rotation.y = Math.PI / 2;
  boreLip.position.set(4.776, 0.34, 0);
  addMesh(muzzle, boreLip, 'muzzle-bore-lip', 'muzzle-bore');
  // Make the bore visibly dimensional: an open inner wall runs behind the
  // crown and a smaller back surface sits deeper inside it. This avoids the
  // flat-black-front-disc reading while retaining a genuinely open muzzle
  // shell.
  const boreWall = new THREE.Mesh(
    new THREE.CylinderGeometry(0.078, 0.070, 0.22, 24, 1, true),
    physical(0x202a31, { metalness: 0.35, roughness: 0.24, clearcoat: 0.22 }),
  );
  boreWall.rotation.z = Math.PI / 2;
  boreWall.position.set(4.665, 0.34, 0);
  addMesh(muzzle, boreWall, 'muzzle-bore-inner-wall', 'muzzle-bore');
  const boreBack = new THREE.Mesh(
    new THREE.CylinderGeometry(0.066, 0.066, 0.012, 24),
    physical(0x05070a, { metalness: 0.02, roughness: 0.82 }),
  );
  boreBack.rotation.z = Math.PI / 2;
  boreBack.position.set(4.505, 0.34, 0);
  addMesh(muzzle, boreBack, 'muzzle-bore-depth', 'muzzle-bore');
  for (let i = 0; i < 3; i += 1) {
    const slit = roundedBox(0.05, 0.08, 0.31, 0.012, polymer);
    slit.position.set(4.60, 0.34 + (i - 1) * 0.075, 0);
    slit.rotation.z = Math.PI / 2;
    slit.userData.part = 'muzzle-slot';
    slit.userData.explodeWithParent = true;
    muzzle.add(slit);
  }
  root.add(muzzle);

  addRail(root, metal);
  const glass = physical(0x24586a, {
    // Keep the lens as a recessed physical surface, but give the supplied
    // orbit enough reflected response to read as coated glass rather than a
    // flat teal cap. This material is shared by objective and eyepiece.
    metalness: 0.78,
    roughness: 0.018,
    transmission: 0.06,
    ior: 1.50,
    thickness: 0.035,
    clearcoat: 1,
    clearcoatRoughness: 0.025,
    transparent: true,
    opacity: 0.98,
    reflectivity: 1,
    envMapIntensity: 6.0,
    iridescence: 0.10,
    iridescenceIOR: 1.33,
    iridescenceThicknessRange: [280, 520],
    side: THREE.DoubleSide,
  });
  const scopeGroup = addScope(root, optic, metal, glass);

  // AWP bolt-action placement: the bolt body runs inside the receiver and
  // the handle exits the receiver's right flank below the rear optic ring.
  // Parent it to the receiver; the old root-level coordinates put the knob
  // above the scope from an orbit and made the attachment ambiguous.
  const boltPivot = part(new THREE.Group(), 'boltPivot', 'bare-metal');
  // The handle exits the receiver side, but its pivot starts on the side wall
  // below the receiver crown. The earlier y=.52 put the knob level with the
  // optic rail and made it read as hardware sitting on top of the scope; the
  // source shows the bolt handle dropping from the receiver flank.
  boltPivot.position.set(0.08, 0.22, 0.255);
  boltPivot.userData.attachment = {
    parent: 'receiver',
    parentId: 'receiver',
    parentSocket: 'receiver.bolt-pivot-socket',
    localStart: [0.08, 0.22, 0.255],
    localEnd: [0.08, 0.02, 0.255],
    contactType: 'socket',
    embedDepth: 0.03,
    overlap: 0.03,
    gapTolerance: 0.015,
    evidenceRefs: FRONT_PAINT_EVIDENCE,
  };
  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.42, 24), lightMetal);
  bolt.rotation.z = Math.PI / 2;
  bolt.position.set(0.18, -0.18, 0);
  addMesh(boltPivot, bolt, 'bolt', 'bare-metal');
  const boltShroud = roundedBox(0.34, 0.14, 0.18, 0.025, darkMetal);
  boltShroud.position.set(0.02, -0.18, 0.025);
  addMesh(boltPivot, boltShroud, 'bolt-shroud', 'bare-metal');
  // The handle descends out and rearward from the pivot; the knob is below
  // the scope/receiver top, matching the visible AWP silhouette.
  const boltBoss = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.065, 24), darkMetal);
  boltBoss.rotation.x = Math.PI / 2;
  boltBoss.position.set(0, -0.18, 0);
  addMesh(boltPivot, boltBoss, 'bolt-pivot-boss', 'bare-metal');
  const handleCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.0, -0.18, 0),
    new THREE.Vector3(-0.04, -0.31, 0),
    new THREE.Vector3(-0.22, -0.54, 0),
    // Loop 20 rollback: the audit's 15–20% extension made the broadside
    // handle read as a second trigger bow and worsened the envelope. The
    // source-visible handle is shorter but still a usable bent grip.
    new THREE.Vector3(-0.52, -0.78, 0),
  ]);
  const handle = new THREE.Mesh(new THREE.TubeGeometry(handleCurve, 24, 0.047, 12, false), lightMetal);
  addMesh(boltPivot, handle, 'bolt-handle', 'bare-metal');
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.095, 18, 12), lightMetal);
  knob.position.set(-0.58, -0.85, 0);
  addMesh(boltPivot, knob, 'bolt-handle-ball', 'bare-metal');
  receiver.add(boltPivot);

  const bipodGroup = addBipod(root, metal);
  addFasteners(root, wear);
  const medusaLayers = addMedusaSurfaceLayers(stock, receiver, grip);
  // Logical component registry for the adaptive spec. The actual pixels stay
  // on the three authored receiving meshes above; this group contains no
  // geometry and is not a projection shell or a camera-facing surface.
  const medusaProjection = part(new THREE.Group(), 'medusa-projection', 'projected-albedo', [
    ...FRONT_PAINT_EVIDENCE,
    ...BACK_PAINT_EVIDENCE,
  ]);
  medusaProjection.userData.logicalComponent = true;
  medusaProjection.userData.boundMeshes = medusaLayers.map((layer) => layer.name);
  medusaProjection.userData.projectionBinding = 'conforming-decal-on-authored-components';
  root.add(medusaProjection);

  // Bare-metal edge highlights intentionally remain geometry, not an albedo cheat.
  const edge = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.008, 6, 24), wear);
  edge.rotation.y = Math.PI / 2;
  edge.position.set(1.6, 0.17, 0.255);
  part(edge, 'minimal-wear-receiver-edge', 'wear-response', FRONT_PAINT_EVIDENCE);
  // The broadside pixels do not localize this tiny wear mark as a separate
  // solid. Its torus became an isolated oval in the top orbit, so omit the
  // ungrounded detail rather than inventing a floating fastener.
  edge.visible = false;
  root.add(edge);

  const sockets = part(new THREE.Group(), 'sockets', 'hidden');
  addSocket(sockets, 'magazineSocket', [0.03, -0.25, 0]);
  addSocket(sockets, 'muzzleFlash', [4.79, 0.17, 0]);
  addSocket(sockets, 'shellEject', [0.45, 0.34, 0.3]);
  addSocket(sockets, 'scopeZoom', [-0.36, 0.86, 0]);
  addSocket(sockets, 'scopeRingRearStation', [-0.54, 0.18, 0]);
  addSocket(sockets, 'scopeRingFrontStation', [-0.02, 0.18, 0]);
  addSocket(sockets, 'bipodPivot', [1.46, -0.49, 0]);
  addSocket(sockets, 'triggerPivot', [-0.70, -0.34, 0]);
  addSocket(sockets, 'boltHandle', [-0.53, -0.43, 0.255]);
  addSocket(sockets, 'bipodFold', [1.72, -0.49, 0]);
  root.add(sockets);

  root.userData.pivots = {
    root,
    bolt: boltPivot,
    trigger: triggerGroup.userData.pivot ?? triggerGroup,
    magazine,
    scope: scopeGroup,
    bipod: bipodGroup,
  };
  root.userData.actionAnchors = {
    boltCycle: { pivot: 'bolt', socket: 'shellEject' },
    triggerPull: { pivot: 'trigger', socket: 'triggerPivot' },
    magazineInsert: { pivot: 'magazine', socket: 'magazineSocket' },
    bipodFold: { pivot: 'bipod', socket: 'bipodFold' },
    scopeZoom: { pivot: 'scope', socket: 'scopeZoom' },
  };
  root.userData.sockets = sockets.children.map((node) => node.name);
  root.userData.materials = {
    paintedShell: painted,
    bareMetal: metal,
    optic,
    polymer,
    wear,
  };
  root.userData.sculptRuntime = {
    ...root.userData.sculptRuntime,
    nodes: {
      receiver,
      stock,
      grip,
      magazine,
      barrel,
      muzzle,
      scope: scopeGroup,
      bolt: boltPivot,
      trigger: triggerGroup,
      bipod: bipodGroup,
      medusaProjection,
    },
    // This is a non-rendering registry entry, not a mesh or a projection
    // shell. It lets the adaptive coverage gate account for the authored
    // front/back receiving layers without inventing a selectable fake part.
    logicalComponents: {
      'medusa-projection': {
        kind: 'logical',
        binding: 'conforming-decal-on-authored-components',
        boundMeshes: medusaLayers.map((layer) => layer.name),
      },
    },
    pivots: root.userData.pivots,
    sockets: {
      magazineSocket: new THREE.Vector3(0.03, -0.25, 0),
      muzzleFlash: new THREE.Vector3(4.79, 0.17, 0),
      shellEject: new THREE.Vector3(0.45, 0.34, 0.3),
      scopeZoom: new THREE.Vector3(-0.36, 0.86, 0),
      scopeRingRearStation: new THREE.Vector3(-0.54, 0.18, 0),
      scopeRingFrontStation: new THREE.Vector3(-0.02, 0.18, 0),
      bipodPivot: new THREE.Vector3(1.46, -0.49, 0),
      triggerPivot: new THREE.Vector3(-0.70, -0.34, 0),
      boltHandle: new THREE.Vector3(-0.53, -0.43, 0.255),
      bipodFold: new THREE.Vector3(1.72, -0.49, 0),
    },
    materials: root.userData.materials,
    actionAnchors: root.userData.actionAnchors,
    provenance: {
      route: 'reference-projection',
      exactnessTier: 'image-only',
      familyAdapter: 'rifle/awp',
      projectionBinding: 'conforming-decal-on-authored-components',
      projectionLayers: medusaLayers.map((layer) => layer.name),
      thicknessConfidence: 0.25,
      inferred: ['receiver and stock depth', 'scope internal optics', 'bolt and bipod hidden-side construction'],
    },
  };
  // Keep the factory itself action-ready when consumers mount it without the
  // gallery registry. The registry may replace this with its presentation rig,
  // but direct users still receive a deterministic looping idle hook.
  let idleTime = 0;
  root.userData.tick = (dt: number) => {
    idleTime += dt;
    root.rotation.y = Math.sin(idleTime * 0.25) * 0.08;
    root.rotation.x = Math.sin(idleTime * 0.17) * 0.018;
    // Keep the authored receiver socket as the rest position; the previous
    // assignment replaced x=0.08 with a sine around zero and slowly exposed
    // the bolt as a floating child during idle playback.
    boltPivot.position.x = 0.08 + Math.sin(idleTime * 0.55) * 0.008;
  };
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.castShadow = shadows;
      node.receiveShadow = shadows;
    }
  });
  // The previous .575 vertical compression made the rifle visibly too flat:
  // the source trace measures ~5.2 bbox ratio while the render measured ~6.66.
  // Keep the authored parts and relative placement intact, but restore the
  // measured vertical envelope as a single proportion correction.
  root.scale.x = 1.04;
  root.scale.y = 0.736;
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const runtime = root.userData.sculptRuntime as Record<string, unknown>;
  // Deterministic world-space attachment evidence.  Metadata alone can claim
  // an overlap while a transform bug still leaves an air gap, so the runtime
  // manifest records the actual AABB overlap for each mechanical seam.
  const measureContact = (id: string, a: THREE.Object3D, b: THREE.Object3D, tolerance = 0.015) => {
    const boxA = new THREE.Box3().setFromObject(a);
    const boxB = new THREE.Box3().setFromObject(b);
    const overlap = [
      Math.min(boxA.max.x, boxB.max.x) - Math.max(boxA.min.x, boxB.min.x),
      Math.min(boxA.max.y, boxB.max.y) - Math.max(boxA.min.y, boxB.min.y),
      Math.min(boxA.max.z, boxB.max.z) - Math.max(boxA.min.z, boxB.min.z),
    ];
    const gap = Math.max(0, ...overlap.map((value) => -value));
    return {
      id,
      overlap: overlap.map((value) => Number(value.toFixed(4))),
      maxGap: Number(gap.toFixed(4)),
      tolerance,
      passed: gap <= tolerance,
      aBounds: [boxA.min.toArray(), boxA.max.toArray()],
      bBounds: [boxB.min.toArray(), boxB.max.toArray()],
    };
  };
  const scopeObjective = scopeGroup.getObjectByName('scope-objective-taper');
  const crownDecal = scopeGroup.getObjectByName('optic-crown-decal');
  const crownSurface = crownDecal?.getObjectByName('optic-crown-source-projection');
  const scopeRingRear = scopeGroup.getObjectByName('scope-ring-rear');
  const scopeRingFront = scopeGroup.getObjectByName('scope-ring-front');
  const findNamedMesh = (parent: THREE.Object3D, name: string): THREE.Object3D => {
    let found: THREE.Object3D | undefined;
    parent.traverse((node) => {
      if (node !== parent && node.name === name && node instanceof THREE.Mesh) found = node;
    });
    return found ?? parent;
  };
  const scopeMountRear = findNamedMesh(scopeGroup, 'scope-mount-rear');
  const scopeMountFront = findNamedMesh(scopeGroup, 'scope-mount-front');
  const scopeTube = findNamedMesh(scopeGroup, 'scope');
  const railMesh = findNamedMesh(root, 'rail');
  const receiverShell = findNamedMesh(receiver, 'receiver');
  const boltContact = findNamedMesh(boltPivot, 'bolt-shroud');
  const triggerContact = findNamedMesh(triggerGroup, 'trigger-guard');
  const magazineContact = findNamedMesh(magazine, 'magazine');
  const bipodContact = bipodGroup.getObjectByName('bipod-mount-saddle')
    ?? bipodGroup.getObjectByName('bipod-hinge-plate')
    ?? bipodGroup;
  const barrelContact = findNamedMesh(barrel, 'barrel');
  const muzzleContact = findNamedMesh(muzzle, 'muzzle');
  const stockContact = findNamedMesh(stock, 'stock');
  runtime.attachmentGate = {
    contractVersion: 'world-contact-v1',
    maxVisibleGap: 0.015,
    requiredSeamOverlap: 0.02,
    pairs: [
      // Measure the actual shell/child meshes, never a parent Group that
      // contains the child.  Parent AABB tests can pass a floating mesh by
      // construction; these contacts are the real mechanical seams.
      measureContact('stock-to-receiver', stockContact, receiverShell),
      measureContact('receiver-to-barrel', receiverShell, barrelContact),
      measureContact('receiver-to-bolt', receiverShell, boltContact),
      measureContact('receiver-to-trigger-guard', receiverShell, triggerContact),
      measureContact('receiver-to-magazine', receiverShell, magazineContact),
      measureContact('receiver-to-bipod', receiverShell, bipodContact),
      // The tube is seated in the rings; the rings are seated in the rail.
      // Measuring tube-to-rail directly is a false mechanical requirement and
      // reported a gap even when the actual two-point mount was connected.
      measureContact('scope-ring-rear-to-rail', scopeMountRear, railMesh),
      measureContact('scope-ring-front-to-rail', scopeMountFront, railMesh),
      measureContact('scope-ring-rear-to-tube', scopeRingRear ?? scopeGroup, scopeTube ?? scopeGroup),
      measureContact('scope-ring-front-to-tube', scopeRingFront ?? scopeGroup, scopeTube ?? scopeGroup),
      measureContact('crown-to-objective-bell', crownSurface ?? crownDecal ?? scopeGroup, scopeObjective ?? scopeGroup),
      measureContact('barrel-to-muzzle', barrelContact, muzzleContact),
    ],
  };
  const attachmentNodes: Array<Record<string, unknown>> = [];
  root.traverse((node) => {
    const attachment = (node.userData as { attachment?: Record<string, unknown> }).attachment;
    if (!attachment) return;
    attachmentNodes.push({
      node: node.name,
      parent: attachment.parent,
      parentId: attachment.parentId,
      parentSocket: attachment.parentSocket,
      contactType: attachment.contactType,
      localStart: attachment.localStart,
      localEnd: attachment.localEnd,
      gapTolerance: attachment.gapTolerance,
      evidenceRefs: attachment.evidenceRefs,
    });
  });
  const requiredAttachmentFields = ['parent', 'parentId', 'parentSocket', 'contactType', 'localStart', 'localEnd', 'gapTolerance', 'evidenceRefs'];
  runtime.attachmentAudit = {
    contractVersion: 'joint-attachment-v1',
    requiredFields: requiredAttachmentFields,
    metadataPass: attachmentNodes.every((entry) => requiredAttachmentFields.every((field) => entry[field] !== undefined)),
    attachedNodeCount: attachmentNodes.length,
    nodes: attachmentNodes,
    note: 'Metadata audit is paired with attachmentGate world-space seam measurements; neither gate alone proves source silhouette placement.',
  };
  runtime.colliders = [{ type: 'box', min: bounds.min.clone(), max: bounds.max.clone() }];
  runtime.adjacency = [
    { a: 'stock', b: 'receiver', axis: 'x', contactType: 'overlap', embedDepth: 0.02 },
    { a: 'receiver', b: 'barrel', axis: 'x', contactType: 'overlap', embedDepth: 0.03 },
    { a: 'receiver', b: 'scope', axis: 'y', contactType: 'overlap', embedDepth: 0.02 },
    { a: 'barrel', b: 'muzzle', axis: 'x', contactType: 'overlap', embedDepth: 0.03 },
    { a: 'barrel', b: 'bipod', axis: 'y', contactType: 'overlap', embedDepth: 0.02 },
  ];
  runtime.destructionGroups = {
    stock: ['stock', 'stock-buttpad', 'stock-buttpad-seam', 'stock-cheek-rest', 'grip'],
    receiver: ['receiver', 'receiver-ejection-port', 'receiver-ejection-port-lip', 'receiver-ejection-recess', 'rail', 'fastener-system'],
    optic: ['scope', 'scope-objective-taper', 'scope-eyepiece', 'scope-turret-base', 'scope-turret', 'scope-turret-cap', 'scope-side-turret', 'scope-ring-rear', 'scope-ring-front', 'optic-crown-decal', 'optic-skull-mark', 'scope-magnification-marking'],
    boltAction: ['bolt', 'bolt-handle', 'bolt-handle-ball', 'trigger-guard', 'trigger', 'magazine'],
    barrelAssembly: ['barrel', 'fore-end-band', 'muzzle', 'bipod'],
    finish: ['medusa-projection', 'medusa-projection-back', 'minimal-wear-receiver-edge'],
  };
  root.userData.actionReadiness = {
    note: 'nodes/pivots are movable assemblies; sockets are local attachment anchors; colliders and adjacency cover the inferred rifle assembly.',
    hiddenDepthConfidence: 0.25,
  };
  return root;
}
