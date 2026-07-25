/**
 * Glock-18 | Ghost Protocol (Well-Worn) — procedural CS2 reconstruction.
 *
 * Route: reference-projection.  Exactness tier: image-only.
 * Family adapter: pistol / glock-18 (authored for this build — the img2threejs CS2 adapter
 * table shipped knife-only, and a knife tree must never stand in for a pistol).
 *
 * GEOMETRY is the alpha trace of the two supplied broadside references (`geo.json`):
 * the slide silhouette with its rear-sight block and front-sight blade, the slide/frame
 * parting line, the dust cover, the trigger-guard loop and its hole, the beavertail, the
 * grip rake and the magazine extension are all real silhouette samples, not drawn curves.
 * Front and back traces agree to 1.6 px mean on both the top and the bottom edge.
 *
 * FINISH is not a procedural circuit pattern. Each broad face carries the de-lit reference
 * crop for that side, projected through one shared planar UV frame, so every painted
 * detail — the magenta and orange trace bundles, "G18", "GLOCK(18)", "GHOST", "(*)",
 * "PROTOCOL", the ">_" prompt, the bar-graph glyphs and the worn magwell streak — lands
 * exactly where the reference has it. Roughness / metalness / AO / normal are separate
 * authored channels built from the traced geometry; none is derived from the albedo.
 *
 * Frame: +X = muzzle, +Y = sights, Z = across the gun.
 *   +Z face = FRONT reference (muzzle RIGHT; a camera on +Z reproduces it)
 *   -Z face = BACK reference, mirrored into the same UV frame
 *
 * Z thickness is INFERRED (confidence 0.45): both supplied views are broadside and neither
 * resolves depth. Widths are the published Glock-18 cross-sections scaled by the traced
 * height. See geo.thickness.basis.
 *
 * The shell is translucent polymer, so the internals are real geometry rather than paint:
 * the barrel, the recoil rod, the steel breech block behind the ejection port, the
 * magazine body and the ribbon-cable module all sit inside the shell at the coordinates
 * the references show them through it.
 */
import * as THREE from 'three';
import geo from './geo.json';
import frontAlbedoUrl from './front-albedo.png';
import backAlbedoUrl from './back-albedo.png';
import roughnessUrl from './roughness.png';
import metalnessUrl from './metalness.png';
import aoUrl from './ao.png';
import normalUrl from './normal.png';

export interface GlockGhostProtocolOptions {
  shadows?: boolean;
  /** 0 disables the see-through polymer (cheaper); default 0.3, solved against the reference. */
  transmission?: number;
}

type P2 = [number, number];

/** The one planar UV frame every projected part shares, in world units. */
const UV = (() => {
  const { scale, xc, yc, textureCrop: c } = geo.meta;
  return {
    x0: (c.x0 - xc) * scale,
    x1: (c.x1 - xc) * scale,
    y0: (yc - c.y1) * scale,
    y1: (yc - c.y0) * scale,
  };
})();

const px = (v: number) => v * geo.meta.scale; // pixel length -> world length
const wx = (v: number) => (v - geo.meta.xc) * geo.meta.scale;
const wy = (v: number) => (geo.meta.yc - v) * geo.meta.scale;

// ---------------------------------------------------------------- geometry helpers

function shapeFrom(outline: number[][], holes: number[][][] = []): THREE.Shape {
  const s = new THREE.Shape();
  outline.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  for (const h of holes) {
    const p = new THREE.Path();
    h.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
    p.closePath();
    s.holes.push(p);
  }
  return s;
}

/**
 * Extrude a traced outline into a solid whose rim ROLLS instead of meeting the faces at a
 * hard 90°: the references show a broad specular band all the way round the silhouette,
 * which a square extrusion cannot produce. Returns three material groups — +Z face,
 * -Z face, rim — so each broad face can carry its own reference projection.
 */
function solid(shape: THREE.Shape, depth: number, rollFrac = geo.chamfer.shellRollFrac): THREE.BufferGeometry {
  const roll = (depth / 2) * rollFrac;
  const src = new THREE.ExtrudeGeometry(shape, {
    depth: depth - 2 * roll,
    bevelEnabled: true,
    bevelSegments: 4,
    bevelThickness: roll,
    // bevelOffset cancels bevelSize's outward push, so the widest ring of the roll lands ON
    // the traced outline instead of 16 px outside it (that bloat cost ~7 points of IoU).
    bevelSize: roll,
    bevelOffset: -roll,
    curveSegments: 6,
  });
  src.translate(0, 0, roll - depth / 2);

  // ExtrudeGeometry emits non-indexed caps+walls; re-bin every triangle by its facing so
  // the +Z face, the -Z face and the rim become separate material groups.
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  const tris = pos.count / 3;
  const bins: number[][] = [[], [], []];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const ba = new THREE.Vector3();
  for (let t = 0; t < tris; t++) {
    a.fromBufferAttribute(pos, t * 3);
    b.fromBufferAttribute(pos, t * 3 + 1);
    c.fromBufferAttribute(pos, t * 3 + 2);
    ba.copy(a).sub(b);
    n.copy(c).sub(b).cross(ba).normalize();
    // 0.9, not 0.6: at 0.6 the outer ring of the bevel still counted as "face", so it wore the
    // face material's normal map. Those tilted triangles turned the serration grooves into a row
    // of blown-out dashes along the slide's top and bottom edge. Only the flat cap is a face.
    bins[n.z > 0.9 ? 0 : n.z < -0.9 ? 1 : 2].push(t);
  }

  const out = new THREE.BufferGeometry();
  const np = new Float32Array(pos.count * 3);
  let w = 0;
  const groups: [number, number, number][] = [];
  bins.forEach((bin, mat) => {
    const start = w;
    for (const t of bin)
      for (let k = 0; k < 3; k++) {
        np[w * 3] = pos.getX(t * 3 + k);
        np[w * 3 + 1] = pos.getY(t * 3 + k);
        np[w * 3 + 2] = pos.getZ(t * 3 + k);
        w++;
      }
    if (w > start) groups.push([start, w - start, mat]);
  });
  out.setAttribute('position', new THREE.BufferAttribute(np, 3));
  for (const [s, cnt, m] of groups) out.addGroup(s, cnt, m);
  out.computeVertexNormals();
  planarUV(out);
  src.dispose();
  return out;
}

/** One shared planar projection for every vertex, so the rim continues the face image. */
function planarUV(g: THREE.BufferGeometry): void {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = (p.getX(i) - UV.x0) / (UV.x1 - UV.x0);
    uv[i * 2 + 1] = (p.getY(i) - UV.y0) / (UV.y1 - UV.y0);
  }
  const attr = new THREE.BufferAttribute(uv, 2);
  g.setAttribute('uv', attr);
  g.setAttribute('uv1', attr); // aoMap reads uv1; same projection, so share the buffer
}

function roundedRect(x0: number, y0: number, x1: number, y1: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0);
  s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - r);
  s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1);
  s.quadraticCurveTo(x0, y1, x0, y1 - r);
  s.lineTo(x0, y0 + r);
  s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

/**
 * Axis-aligned block placed by world extents — used for every opaque hardware part.
 * `depth` is the TOTAL z extent including the chamfer, and the result is centred on `zc`,
 * so a part told to sit inside the shell actually stays inside it.
 */
function block(x: P2, y: P2, depth: number, zc = 0, r = 0): THREE.BufferGeometry {
  if (r <= 0) {
    return new THREE.BoxGeometry(x[1] - x[0], y[1] - y[0], depth).translate(
      (x[0] + x[1]) / 2, (y[0] + y[1]) / 2, zc);
  }
  const bev = depth * 0.14;
  const g = new THREE.ExtrudeGeometry(roundedRect(x[0], y[0], x[1], y[1], r), {
    depth: depth - 2 * bev,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelThickness: bev,
    bevelSize: bev,
    bevelOffset: -bev,
    curveSegments: 6,
  });
  g.translate(0, 0, zc - depth / 2 + bev);
  return g;
}

function cyl(x: P2, cy: number, r: number, radial = 28): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, x[1] - x[0], radial, 1, false);
  g.rotateZ(Math.PI / 2);
  g.translate((x[0] + x[1]) / 2, cy, 0);
  return g;
}

// ---------------------------------------------------------------- textures & materials

const loader = new THREE.TextureLoader();

function tex(url: string, srgb: boolean): THREE.Texture {
  const t = loader.load(url);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 16;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

interface Maps {
  front: THREE.Texture;
  back: THREE.Texture;
  rough: THREE.Texture;
  metal: THREE.Texture;
  ao: THREE.Texture;
  normal: THREE.Texture;
}

function loadMaps(): Maps {
  return {
    front: tex(frontAlbedoUrl, true),
    back: tex(backAlbedoUrl, true),
    rough: tex(roughnessUrl, false),
    metal: tex(metalnessUrl, false),
    ao: tex(aoUrl, false),
    normal: tex(normalUrl, false),
  };
}

/**
 * Translucent-polymer face material. `transmission` is deliberately partial: the reference
 * shows the internals as a tinted ghost under the paint, not clear glass, and the projected
 * decals must survive. The albedo tints the transmitted lobe too, so the trace bundles keep
 * their colour where the shell goes see-through.
 */
function polymerFace(m: Maps, side: 'front' | 'back', o: { transmission: number; thickness: number }) {
  return new THREE.MeshPhysicalMaterial({
    map: side === 'front' ? m.front : m.back,
    roughnessMap: m.rough,
    metalnessMap: m.metal,
    aoMap: m.ao,
    aoMapIntensity: 0.65,
    normalMap: m.normal,
    // 0.42, not 0.85: the broadside review view barely shows the normal map, but as soon as the
    // demo rocks off-axis the micro-stipple and the grip stria read at a grazing angle and the
    // polymer turned into coarse leather. Solved at the rocked extreme, not at the flat view.
    normalScale: new THREE.Vector2(0.42, 0.42),
    roughness: 1.0, // scalar x map; both maps carry the authored per-pixel values
    metalness: 1.0,
    // clearcoat solved against the FRONT reference at the fixed review view: 0.62 washed a
    // specular veil over every zone (+13..+19 counts of red above the reference). At 0.40 the
    // FRONT mean lands at [69.8, 26.0, 32.1] against the reference's [74.6, 24.8, 30.7].
    clearcoat: 0.4,
    clearcoatRoughness: 0.22,
    transmission: o.transmission,
    thickness: o.thickness,
    ior: 1.52, // injection-moulded polymer
    attenuationColor: new THREE.Color(0x4a0710),
    attenuationDistance: 0.55,
    specularIntensity: 1.0,
  });
}

/**
 * Rolled rim. Neither view resolves the edge band, so it is authored, not projected — and
 * it is authored DARK: in both references the silhouette edge falls away to near-black, so
 * a bright rim would draw a glowing outline round the whole gun that the references do not have.
 */
function polymerRim(o: { transmission: number; thickness: number }) {
  return new THREE.MeshPhysicalMaterial({
    color: 0x3a0710,
    roughness: 0.52,
    metalness: 0.0,
    // Duller than the faces on purpose: at clearcoat 0.4 the rolled rim blew out to a white
    // outline round the whole silhouette, where the references show a thin dark-red edge.
    clearcoat: 0.2,
    clearcoatRoughness: 0.5,
    transmission: o.transmission * 0.45,
    thickness: o.thickness,
    ior: 1.52,
    attenuationColor: new THREE.Color(0x330509),
    attenuationDistance: 0.28,
  });
}

const blackPolymer = () =>
  new THREE.MeshPhysicalMaterial({ color: 0x0a0a0d, roughness: 0.44, metalness: 0.05, clearcoat: 0.4, clearcoatRoughness: 0.22 });

/**
 * Surface hardware (extractor, slide stop, magazine catch) sits at the same XY as the
 * reference's own pixels, so it takes the FRONT projection through the shared planar UV
 * and is merely darkened. Painting these as flat black slabs instead reads as stickers
 * pasted over the reference art — it hides the knurling and the cast shadow the photo has.
 */
function hardwareFace(m: Maps, tint: number) {
  return new THREE.MeshPhysicalMaterial({
    map: m.front,
    color: new THREE.Color(tint),
    roughnessMap: m.rough,
    normalMap: m.normal,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughness: 1.0,
    metalness: 0.08,
    clearcoat: 0.4,
    clearcoatRoughness: 0.26,
  });
}

const steel = () =>
  new THREE.MeshPhysicalMaterial({ color: 0xd2d7df, roughness: 0.3, metalness: 1.0 });
const gunmetal = () =>
  new THREE.MeshPhysicalMaterial({ color: 0x3c4046, roughness: 0.5, metalness: 1.0 });

// ---------------------------------------------------------------- build

export function createGlockGhostProtocolModel(o: GlockGhostProtocolOptions = {}): THREE.Group {
  const shadows = o.shadows ?? true;
  const transmission = o.transmission ?? 0.3;
  const m = loadMaps();
  const root = new THREE.Group();
  root.name = 'glock18-ghost-protocol';
  const nodes: Record<string, THREE.Object3D> = {};
  const F = geo.features;
  const I = geo.internals;
  const T = geo.thickness;

  const add = (parent: THREE.Object3D, name: string, g: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[]) => {
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = name;
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    parent.add(mesh);
    nodes[name] = mesh;
    return mesh;
  };

  /** A projected shell part: front face, back face and rim as three material slots. */
  const shell = (parent: THREE.Object3D, name: string, shape: THREE.Shape, depth: number) => {
    const opt = { transmission, thickness: depth };
    return add(parent, name, solid(shape, depth), [
      polymerFace(m, 'front', opt),
      polymerFace(m, 'back', opt),
      polymerRim(opt),
    ]);
  };

  // ---- slide assembly (its own group: it is the moving part) ----
  const slideGrp = new THREE.Group();
  slideGrp.name = 'slideAssembly';
  root.add(slideGrp);
  shell(slideGrp, 'slide', shapeFrom(geo.parts.slide.outline), T.slide);

  // Steel breech face behind the ejection port. The port is a RIGHT-side cut only, so the
  // plate is offset toward +Z and never breaks the -Z face the BACK reference shows intact.
  // It sits ~55 px in from the slide's +Z face, i.e. behind the port image the projection
  // already paints, so it reads as depth under the port rather than a slab on top of it.
  add(slideGrp, 'breechBlock',
    block([F.ejectionPort.x[0] + px(6), F.ejectionPort.x[1] - px(6)],
          [F.ejectionPort.y[0] + px(6), F.ejectionPort.y[1] - px(6)],
          px(70), T.slide / 2 - px(55), px(20)),
    steel());
  // Deeper breech body carrying the chamber, so the port has something solid behind it.
  add(slideGrp, 'breechBody',
    block(I.breechFace.x as P2, [I.breechFace.y[0], I.breechFace.y[1] - px(20)],
          T.slide * 0.55, 0),
    gunmetal());
  const projectedHardware = (parent: THREE.Object3D, name: string, g: THREE.BufferGeometry, tint: number) => {
    planarUV(g);
    return add(parent, name, g, hardwareFace(m, tint));
  };
  projectedHardware(slideGrp, 'extractor',
    block(F.extractor.x as P2, F.extractor.y as P2, px(16), T.slide / 2 - px(14), px(8)), 0xb4b4bc);

  const rs = F.rearSight;
  add(slideGrp, 'rearSight',
    block([wx(rs.xPx[0]), wx(rs.xPx[1])], [rs.base, rs.top], T.slide * 0.62, 0, px(4)),
    blackPolymer());
  const fs = F.frontSight;
  add(slideGrp, 'frontSight',
    block([wx(fs.xPx[0]), wx(fs.xPx[1])], [fs.base, fs.top], T.slide * 0.34, 0, px(3)),
    blackPolymer());

  // Internals seen THROUGH the shell: barrel, recoil rod. Depth is inferred (see geo).
  add(slideGrp, 'barrel', cyl(I.barrel.x as P2, I.barrel.cy, I.barrel.r), gunmetal());
  // Muzzle: a narrow gunmetal crown ring around a RECESSED dark bore. Without the bore the
  // crown read as a solid chrome donut from every muzzle-side orbit — a bright disc where
  // the reference item has a hole.
  const crown = add(slideGrp, 'muzzleCrown',
    new THREE.TorusGeometry(I.barrel.r * 0.66, I.barrel.r * 0.1, 8, 28), gunmetal());
  crown.rotation.y = Math.PI / 2;
  crown.position.set(I.barrel.x[1] - px(4), I.barrel.cy, 0);
  add(slideGrp, 'bore',
    cyl([I.barrel.x[1] - px(120), I.barrel.x[1] - px(2)] as P2, I.barrel.cy, I.barrel.r * 0.56, 24),
    new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.62, metalness: 0.9, side: THREE.DoubleSide }));
  add(slideGrp, 'recoilRod', cyl(I.recoilRod.x as P2, I.recoilRod.cy, I.recoilRod.r, 18), gunmetal());

  // ---- frame ----
  shell(root, 'frame', shapeFrom(geo.parts.frame.outline, geo.parts.frame.holes), T.frame);

  // The grip's side panels stand proud of the frame web — visible as a raised rounded
  // border in both references, and the reason a Glock grip is wider than its dust cover.
  const gp = F.gripPanel;
  for (const s of [1, -1]) {
    const panel = roundedRect(wx(gp.xPx[0]), wy(gp.yPx[1]), wx(gp.xPx[1]), wy(gp.yPx[0]), gp.cornerR);
    const g = solid(panel, T.gripPanelProud, 0.5);
    g.translate(0, 0, s * (T.frame / 2 + T.gripPanelProud / 2 - px(3)));
    // The panel is OPAQUE even though the shell around it is not. It sits directly on the
    // frame web, so nothing is behind it to see; leaving transmission on made it a floating
    // haze plate that double-imaged "GHOST"/"PROTOCOL" against the frame underneath.
    // Same transmission as the shell it sits on. Opaque made it a pale patch: the frame behind
    // is darkened ~30% by its own transmission and the panel was not, so "GHOST"/"PROTOCOL"
    // read washed out against the surrounding frame. At 14 px proud there is no double image.
    const opt = { transmission, thickness: T.frame + T.gripPanelProud };
    add(root, s > 0 ? 'gripPanelFront' : 'gripPanelBack', g, [
      polymerFace(m, s > 0 ? 'front' : 'back', opt),
      polymerFace(m, s > 0 ? 'front' : 'back', opt),
      polymerRim(opt),
    ]);
  }

  // ---- magazine ----
  const magGrp = new THREE.Group();
  magGrp.name = 'magazineAssembly';
  root.add(magGrp);
  shell(magGrp, 'magazine', shapeFrom(geo.parts.magazine.outline), T.magazine);
  // y is [min, max]: passing [top, bottom] here built a negative-height box, i.e. an
  // inside-out magazine body with flipped normals.
  add(magGrp, 'magBody',
    block([wx(470), wx(650)], [wy(980), I.magBody.top], T.magazine * 0.62, 0),
    gunmetal());

  // ---- trigger group (its own pivot: the shoe swings about the trigger pin) ----
  const trigGrp = new THREE.Group();
  trigGrp.name = 'triggerPivot';
  trigGrp.position.set(F.triggerPin.cx, F.triggerPin.cy, 0);
  root.add(trigGrp);
  const trigGeo = solid(shapeFrom(geo.parts.trigger.outline), T.trigger, 0.4);
  trigGeo.translate(-F.triggerPin.cx, -F.triggerPin.cy, 0);
  add(trigGrp, 'trigger', trigGeo, blackPolymer());
  const ts = F.triggerSafety;
  const safety = block([wx(ts.xPx[0]), wx(ts.xPx[1])], [wy(ts.yPx[1]), wy(ts.yPx[0])], T.triggerSafety, 0, px(6));
  safety.translate(-F.triggerPin.cx, -F.triggerPin.cy, 0);
  add(trigGrp, 'triggerSafety', safety, blackPolymer());

  // ---- frame hardware ----
  for (const id of ['triggerPin', 'lockingBlockPin'] as const) {
    const p = F[id];
    const g = new THREE.CylinderGeometry(p.r, p.r, T.frame + px(6), 20);
    g.rotateX(Math.PI / 2);
    g.translate(p.cx, p.cy, 0);
    add(root, id, g, gunmetal());
  }
  // Both levers stand slightly PROUD of the frame's +Z face — they are external controls, and the
  // FRONT reference shows their cast shadow on the frame.
  projectedHardware(root, 'slideStop',
    block(F.slideStop.x as P2, F.slideStop.y as P2, px(14), T.frame / 2 + px(3), px(12)), 0xb0b4bc);
  // The catch is a shallow relief, not a tab: at px(5) proud its side walls caught the key and
  // read as a pale slab sticking out of the frame's front edge.
  projectedHardware(root, 'magRelease',
    block([F.magRelease.x[0] + px(16), F.magRelease.x[1] - px(2)],
          [F.magRelease.y[0] + px(6), F.magRelease.y[1] - px(6)],
          px(9), T.frame / 2 + px(1), px(8)), 0x9096a0);

  // ---- the cybernetic module the references show through the translucent frame ----
  const cm = F.cyberModule;
  add(root, 'cyberModule', block(cm.barX as P2, cm.barY as P2, px(34), 0, px(5)), blackPolymer());
  const ribbon = new THREE.MeshPhysicalMaterial({
    color: 0x1a1a20, roughness: 0.5, metalness: 0.2,
    emissive: new THREE.Color(0xff6a1e), emissiveIntensity: 0.55,
  });
  const rGrp = new THREE.Group();
  rGrp.name = 'ribbonCables';
  const rows = 7;
  for (let i = 0; i < rows; i++) {
    const y = cm.y[0] + ((i + 0.5) / rows) * (cm.y[1] - cm.y[0]);
    const g = new THREE.BoxGeometry(cm.x[1] - cm.x[0], px(4), px(20));
    g.translate((cm.x[0] + cm.x[1]) / 2, y, 0);
    rGrp.add(new THREE.Mesh(g, i % 2 ? ribbon : blackPolymer()));
  }
  root.add(rGrp);
  nodes.ribbonCables = rGrp;

  // ---- action-ready runtime ----
  const bbox = new THREE.Box3().setFromObject(root);
  root.userData.sculptRuntime = {
    nodes,
    pivots: { trigger: trigGrp, slide: slideGrp, magazine: magGrp },
    sockets: {
      muzzle: new THREE.Vector3(wx(1856), I.barrel.cy, 0),
      grip: new THREE.Vector3(wx(450), wy(620), 0),
      accessoryRail: new THREE.Vector3(wx(1676), wy(372), 0),
      magWell: new THREE.Vector3(wx(430), wy(930), 0),
      ejectionPort: new THREE.Vector3(wx(1012), wy(86), T.slide / 2),
    },
    colliders: [{ type: 'box', min: bbox.min.clone(), max: bbox.max.clone() }],
    destructionGroups: {
      slide: ['slide', 'breechBlock', 'breechBody', 'extractor', 'rearSight', 'frontSight',
              'barrel', 'muzzleCrown', 'bore', 'recoilRod'],
      frame: ['frame', 'gripPanelFront', 'gripPanelBack', 'slideStop', 'magRelease', 'triggerPin', 'lockingBlockPin'],
      magazine: ['magazine', 'magBody'],
      fireControl: ['trigger', 'triggerSafety', 'cyberModule', 'ribbonCables'],
    },
    provenance: {
      route: 'reference-projection',
      exactnessTier: 'image-only',
      familyAdapter: 'pistol/glock-18',
      thicknessConfidence: T.confidence,
      inferred: ['z-thickness', 'barrel & recoil-rod depth', 'magazine body', 'trigger left face', 'rim colour'],
    },
  };
  return root;
}

// ---------------------------------------------------------------- look-dev

/**
 * Three-point rig for a broadside hero framing, cool-biased so the crimson polymer keeps
 * its hue instead of going orange. Routed through DemoEntry.installLights so the Viewer
 * skips its default studio rig (two rigs stacked blow the clearcoat out to white).
 */
export function createGlockGhostProtocolLookDevLights(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'glockGhostProtocolLights';

  const key = new THREE.DirectionalLight(0xfff2ee, 2.35);
  key.position.set(1.9, 3.4, 4.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 14;
  key.shadow.bias = -0.0006;
  g.add(key);

  const fill = new THREE.DirectionalLight(0x7aa8ff, 0.58);
  fill.position.set(-3.4, 0.8, 3.0);
  g.add(fill);

  // The item is a two-sided broadside object and BOTH faces carry a reference projection,
  // so the -Z side gets its own mirrored key/fill. With only a warm back-kick the BACK view
  // measured 19..33 counts of luma below its reference and lost half its green.
  // A light behind the object contributes nothing to the +Z faces, so this pair does not
  // disturb the FRONT match that the key/fill were solved against.
  const backKey = new THREE.DirectionalLight(0xfff4f0, 3.05);
  backKey.position.set(-1.9, 3.4, -4.6);
  g.add(backKey);

  const backFill = new THREE.DirectionalLight(0x7aa8ff, 0.78);
  backFill.position.set(3.4, 0.8, -3.0);
  g.add(backFill);

  // Low warm kicker that grazes the rolled rim; kept weak so it does not red-shift the
  // -Z face away from the BACK reference's cooler magenta-grey slide.
  const kick = new THREE.DirectionalLight(0xff5f6d, 0.62);
  kick.position.set(-1.2, -1.9, -3.2);
  g.add(kick);

  g.add(new THREE.AmbientLight(0x24202a, 0.26));
  return g;
}

/** Dark radial stage; matches the references' near-black backdrop. */
export function makeGhostProtocolBackground(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 512;
  const ctx = cv.getContext('2d')!;
  const grd = ctx.createRadialGradient(256, 232, 24, 256, 256, 340);
  grd.addColorStop(0, '#241017');
  grd.addColorStop(0.55, '#12080c');
  grd.addColorStop(1, '#070507');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}
