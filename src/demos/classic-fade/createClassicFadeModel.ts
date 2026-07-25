/**
 * Classic Knife | Fade (Minimal Wear) — procedural CS2 reconstruction.
 *
 * Route: reference-projection.  Exactness tier: image-only.
 *
 * Geometry is the alpha trace of the two supplied broadside references (`geo.json`,
 * produced by the img2threejs intake stage): the 6-notch spine jimping, the deep
 * semicircular choil, the hammer-head guard, the 5-step staircase butt and the
 * drop-point tip are all real silhouette samples, not hand-drawn curves.
 *
 * The Fade finish is NOT a procedural gradient. Each broad face carries the de-lit
 * reference crop for that side, projected through one shared planar UV map so every
 * painted detail — gradient stops, the wavy lower-zone boundary, the grind tonal
 * break, the screws, the gold ferrule — lands exactly where the reference has it.
 * Roughness / metalness / AO / normal are separate authored channels; none of them
 * is derived from albedo.
 *
 * Frame: +X = tip, +Y = spine, Z = thickness.
 *   -Z face = FRONT reference (a camera on -Z reproduces the FRONT framing)
 *   +Z face = BACK  reference
 *
 * Z thickness is INFERRED (confidence 0.45): both supplied views are broadside and
 * neither resolves depth. See geo.thickness.basis.
 */
import * as THREE from 'three';
import geo from './geo.json';
// Imported as Vite assets rather than served from public/, so the whole demo — geometry,
// projection textures and factory — lives in this one folder and the URLs are bundler-resolved.
import frontAlbedoUrl from './front-albedo.png';
import backAlbedoUrl from './back-albedo.png';
import roughnessUrl from './roughness.png';
import metalnessUrl from './metalness.png';
import aoUrl from './ao.png';
import normalUrl from './normal.png';

export interface ClassicFadeOptions {
  shadows?: boolean;
}

type Outline = [number, number, number][]; // [worldX, yTop, yBot]

/** Texture crop bounds in world units — the shared planar UV frame for every part. */
const UV = (() => {
  const { scale, xc, yc, textureCrop: c } = geo.meta;
  return {
    x0: (c.x0 - xc) * scale,
    x1: (c.x1 - xc) * scale,
    y1: (yc - c.y0) * scale, // image top row -> larger world Y
    y0: (yc - c.y1) * scale,
  };
})();

function planarUV(x: number, y: number): [number, number] {
  return [(x - UV.x0) / (UV.x1 - UV.x0), (y - UV.y0) / (UV.y1 - UV.y0)];
}

// ---------------------------------------------------------------- z cross-sections
/**
 * Half-thickness at cross-section parameter t (0 = spine/top edge, 1 = cutting edge/bottom),
 * for a wedge-ground blade. `xf` is 0 at the ricasso and 1 at the tip: the grind terminus
 * climbs toward the tip, matching the straight tonal break visible across the blade face.
 */
function bladeZ(t: number, xf: number, ht: number): number {
  const gs = geo.features.grind.startFracAtRicasso +
    (geo.features.grind.startFracAtTip - geo.features.grind.startFracAtRicasso) * xf;
  const eb = geo.features.grind.edgeBevelFrac;
  if (t < 0.1) return ht;
  if (t < gs) return ht * (1 - 0.12 * (t - 0.1) / Math.max(gs - 0.1, 1e-4));
  if (t < eb) return ht * (0.88 - 0.74 * (t - gs) / Math.max(eb - gs, 1e-4));
  return ht * (0.14 - 0.115 * (t - eb) / Math.max(1 - eb, 1e-4));
}

/** Superellipse slab: flat broad faces with rounded long edges. Higher `n` = flatter. */
function slabZ(t: number, ht: number, n: number, crown: number): number {
  const s = Math.abs(2 * t - 1);
  const edge = Math.pow(Math.max(0, 1 - Math.pow(s, n)), 0.32);
  return ht * edge * (1 - crown * s * s);
}

// ---------------------------------------------------------------- lofted part
/**
 * Loft an outline into a solid: +Z face (group 0), -Z face (group 1), rim (group 2).
 * Both broad faces share the global planar UV map, so the projected reference pixels
 * register with the traced geometry automatically.
 */
function loft(outline: Outline, zAt: (t: number, xf: number) => number, rows = 14): THREE.BufferGeometry {
  const cols = outline.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const groups: { start: number; count: number; mat: number }[] = [];

  const x0 = outline[0][0];
  const x1 = outline[cols - 1][0];
  const span = Math.max(x1 - x0, 1e-6);

  // ---- broad faces: two grids (+Z then -Z) ----
  const faceVerts = cols * (rows + 1);
  for (let side = 0; side < 2; side++) {
    const sign = side === 0 ? 1 : -1;
    for (let c = 0; c < cols; c++) {
      const [x, yT, yB] = outline[c];
      const xf = (x - x0) / span;
      for (let r = 0; r <= rows; r++) {
        const t = r / rows;
        const y = yT + (yB - yT) * t;
        pos.push(x, y, sign * zAt(t, xf));
        const [u, v] = planarUV(x, y);
        uv.push(u, v);
      }
    }
  }
  for (let side = 0; side < 2; side++) {
    const start = idx.length;
    const off = side * faceVerts;
    for (let c = 0; c < cols - 1; c++) {
      for (let r = 0; r < rows; r++) {
        const a = off + c * (rows + 1) + r;
        const b = a + rows + 1;
        // Wind so each face points away from the slab. Grid runs +x across columns and
        // -y down rows, so (a, a+1, b) yields +Z and the reverse order yields -Z.
        if (side === 0) idx.push(a, a + 1, b, b, a + 1, b + 1);
        else idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    groups.push({ start, count: idx.length - start, mat: side });
  }

  // ---- rim: a closed ring around the outline (top edge out, bottom edge back) ----
  const rimStartVert = pos.length / 3;
  const ring: [number, number][] = [];
  for (let c = 0; c < cols; c++) ring.push([outline[c][0], outline[c][1]]);
  for (let c = cols - 1; c >= 0; c--) ring.push([outline[c][0], outline[c][2]]);
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = ring[i];
    const xf = (x - x0) / span;
    const t = i < cols ? 0 : 1;
    const z = zAt(t, xf);
    const [u, v] = planarUV(x, y);
    pos.push(x, y, z, x, y, -z);
    uv.push(u, v, u, v);
  }
  const rimStart = idx.length;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    const a = rimStartVert + i * 2;
    const b = rimStartVert + j * 2;
    idx.push(a, b, a + 1, b, b + 1, a + 1); // outward-facing around the ring
  }
  groups.push({ start: rimStart, count: idx.length - rimStart, mat: 2 });

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  for (const gr of groups) g.addGroup(gr.start, gr.count, gr.mat);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- textures
function projected(url: string, srgb: boolean): THREE.Texture {
  const t = new THREE.TextureLoader().load(url);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 16;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Fine axial brush/grain, used as the rim's own normal so rims are not mirror-flat. */
function brushedNormal(): THREE.CanvasTexture {
  const w = 512;
  const h = 128;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  const img = c.createImageData(w, h);
  let seed = 20260725;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const lanes = new Float32Array(h);
  for (let y = 0; y < h; y++) lanes[y] = rnd();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = (lanes[y] - 0.5) * 0.6 + (rnd() - 0.5) * 0.12;
      const i = (y * w + x) * 4;
      img.data[i] = 128 + n * 40;
      img.data[i + 1] = 128;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 1);
  return t;
}

interface Maps {
  front: THREE.Texture;
  back: THREE.Texture;
  rough: THREE.Texture;
  metal: THREE.Texture;
  ao: THREE.Texture;
  normal: THREE.Texture;
  rimNormal: THREE.CanvasTexture;
}

function loadMaps(): Maps {
  return {
    front: projected(frontAlbedoUrl, true),
    back: projected(backAlbedoUrl, true),
    rough: projected(roughnessUrl, false),
    metal: projected(metalnessUrl, false),
    ao: projected(aoUrl, false),
    normal: projected(normalUrl, false),
    rimNormal: brushedNormal(),
  };
}

/**
 * Broad-face material. `map` is the de-lit projection for that side; every other
 * channel comes from its own authored texture — albedo is never reused.
 *
 * `metalness` and `roughness` are scalars that MULTIPLY the zone maps, so the maps keep
 * owning the relative structure while each part sets its own level. They are deliberately
 * well below 1: the projection already carries the reference's own shading, so driving the
 * blade as a full mirror double-counts the specular and washes the Fade out to white.
 */
function faceMaterial(m: Maps, side: 'front' | 'back', p: PartSpec): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map: side === 'front' ? m.front : m.back,
    roughnessMap: m.rough,
    metalnessMap: m.metal,
    aoMap: m.ao,
    aoMapIntensity: 0.6,
    normalMap: m.normal,
    normalScale: new THREE.Vector2(p.normalScale, p.normalScale),
    metalness: p.metalness,
    roughness: p.roughness,
    envMapIntensity: p.env,
    clearcoat: p.clearcoat,
    clearcoatRoughness: 0.3,
    // No alphaTest: the mesh IS the traced silhouette and the albedo's colour is dilated
    // past the mask, so there is nothing to cut out and nothing to fringe.
  });
}

/**
 * Extrusion-wall material. Neither reference shows these walls, so they are authored, not
 * projected — and kept deliberately dark and rough. A bright rim reads as a hard white
 * outline tracing the whole silhouette, which the references do not have.
 */
function rimMaterial(rim: RimFinish, m: Maps): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: rim.color,
    roughness: rim.roughness,
    metalness: rim.metalness,
    normalMap: m.rimNormal,
    normalScale: new THREE.Vector2(0.25, 0.25),
    envMapIntensity: rim.env,
  });
}

// ---------------------------------------------------------------- part table
/** Finish for the extrusion walls, which neither reference shows. */
interface RimFinish {
  color: number;
  roughness: number;
  metalness: number;
  env: number;
}

interface PartSpec {
  id: string;
  ht: number;
  rim: RimFinish;
  z: (t: number, xf: number, ht: number) => number;
  normalScale: number;
  /** scalars multiplying the zone maps — see faceMaterial */
  metalness: number;
  roughness: number;
  env: number;
  /** anodized lacquer only; the polymer grip gets none */
  clearcoat: number;
}

const PARTS: PartSpec[] = [
  {
    id: 'blade', ht: geo.thickness.blade, rim: { color: 0x8a8f96, roughness: 0.34, metalness: 0.55, env: 0.45 },
    z: bladeZ, normalScale: 0.35,
    metalness: 0.14, roughness: 1.45, env: 0.7, clearcoat: 0.26,
  },
  {
    id: 'guard', ht: geo.thickness.guard, rim: { color: 0x22252a, roughness: 0.52, metalness: 0.4, env: 0.3 },
    z: (t, _x, ht) => slabZ(t, ht, 10, 0.1), normalScale: 0.5,
    metalness: 0.26, roughness: 1.35, env: 0.42, clearcoat: 0.06,
  },
  {
    id: 'ferrule', ht: geo.thickness.ferrule, rim: { color: 0x6b5626, roughness: 0.42, metalness: 0.6, env: 0.4 },
    z: (t, _x, ht) => slabZ(t, ht, 8, 0.14), normalScale: 1.15,
    metalness: 0.72, roughness: 1.2, env: 0.68, clearcoat: 0.05,
  },
  {
    id: 'foreBolster', ht: geo.thickness.foreBolster, rim: { color: 0x212429, roughness: 0.5, metalness: 0.4, env: 0.3 },
    z: (t, _x, ht) => slabZ(t, ht, 10, 0.1), normalScale: 0.8,
    metalness: 0.5, roughness: 1.35, env: 0.42, clearcoat: 0.06,
  },
  {
    id: 'grip', ht: geo.thickness.grip, rim: { color: 0x121315, roughness: 0.88, metalness: 0.02, env: 0.18 },
    z: (t, _x, ht) => slabZ(t, ht, 6, 0.2), normalScale: 0.95,
    metalness: 0.2, roughness: 1.3, env: 0.14, clearcoat: 0.0,
  },
  {
    id: 'rearBolster', ht: geo.thickness.rearBolster, rim: { color: 0x212429, roughness: 0.5, metalness: 0.4, env: 0.3 },
    z: (t, _x, ht) => slabZ(t, ht, 10, 0.1), normalScale: 0.8,
    metalness: 0.5, roughness: 1.35, env: 0.42, clearcoat: 0.06,
  },
  {
    id: 'buttPlate', ht: geo.thickness.buttPlate, rim: { color: 0x2b2f34, roughness: 0.5, metalness: 0.4, env: 0.3 },
    z: (t, _x, ht) => slabZ(t, ht, 12, 0.06), normalScale: 0.7,
    metalness: 0.5, roughness: 1.3, env: 0.38, clearcoat: 0.06,
  },
];

// ---------------------------------------------------------------- lanyard bore
/**
 * Countersunk chamfer rings around the lanyard hole, one per face.
 *
 * APPROXIMATION — the hole is not a real perforation. The butt plate is a solid loft of
 * the traced outer silhouette, and the trace only carries the outer boundary, so there is
 * nothing to punch through. What reads as a bore is the projected albedo (which carries
 * the reference's own dark bore pixels) sitting inside these rings. An actual through-hole
 * would need the butt plate rebuilt as an ExtrudeGeometry with a hole path.
 */
function lanyardChamferRings(m: Maps, ht: number): THREE.Group {
  const { cx, cy, r } = geo.features.lanyardHole;
  const g = new THREE.Group();

  for (const s of [1, -1]) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r, r * 1.34, 40),
      new THREE.MeshPhysicalMaterial({
        color: 0x9aa0a8, roughness: 0.26, metalness: 1, side: THREE.DoubleSide,
        normalMap: m.rimNormal, normalScale: new THREE.Vector2(0.2, 0.2),
      }),
    );
    ring.position.set(cx, cy, s * ht * 1.002);
    g.add(ring);
  }
  return g;
}

// ---------------------------------------------------------------- factory
export function createClassicFadeModel(options: ClassicFadeOptions = {}): THREE.Group {
  const shadows = options.shadows ?? true;
  const maps = loadMaps();
  const root = new THREE.Group();
  root.name = 'ClassicKnifeFade';

  const nodes: Record<string, THREE.Object3D> = {};
  const parts = geo.parts as Record<string, { outline: number[][]; xRangeWorld: number[] }>;

  for (const p of PARTS) {
    const src = parts[p.id];
    if (!src) continue;
    const outline = src.outline as Outline;
    const g = loft(outline, (t, xf) => p.z(t, xf, p.ht), p.id === 'blade' ? 18 : 12);
    // aoMap needs a second UV set; the projection UVs double as uv1.
    g.setAttribute('uv1', g.getAttribute('uv'));

    const mesh = new THREE.Mesh(g, [
      faceMaterial(maps, 'back', p),   // group 0 -> +Z face = BACK reference
      faceMaterial(maps, 'front', p),  // group 1 -> -Z face = FRONT reference
      rimMaterial(p.rim, maps),
    ]);
    mesh.name = p.id;
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    mesh.userData.attachment = {
      parentSocket: 'tang',
      localStart: src.xRangeWorld[0],
      localEnd: src.xRangeWorld[1],
      contactType: 'butt-joint-on-tang',
      overlap: 0.004,
    };
    root.add(mesh);
    nodes[p.id] = mesh;
  }

  const rings = lanyardChamferRings(maps, geo.thickness.buttPlate);
  rings.name = 'lanyardChamferRings';
  root.add(rings);
  nodes.lanyardChamferRings = rings;

  // ---- action-ready runtime ----
  const bbox = new THREE.Box3().setFromObject(root);
  root.userData.sculptRuntime = {
    nodes,
    sockets: {
      grip: new THREE.Vector3((geo.parts.grip.xRangeWorld[0] + geo.parts.grip.xRangeWorld[1]) / 2, -0.05, 0),
      tip: new THREE.Vector3(geo.parts.blade.xRangeWorld[1], -0.01, 0),
      lanyard: new THREE.Vector3(geo.features.lanyardHole.cx, geo.features.lanyardHole.cy, 0),
      guard: new THREE.Vector3((geo.parts.guard.xRangeWorld[0] + geo.parts.guard.xRangeWorld[1]) / 2, 0, 0),
    },
    colliders: [{ type: 'box', min: bbox.min.clone(), max: bbox.max.clone() }],
    destructionGroups: {
      blade: ['blade'],
      furniture: ['guard', 'ferrule', 'foreBolster', 'grip', 'rearBolster', 'buttPlate',
                  'lanyardChamferRings'],
    },
    provenance: {
      route: 'reference-projection',
      exactnessTier: 'image-only',
      thicknessConfidence: geo.thickness.confidence,
    },
  };
  return root;
}

// ---------------------------------------------------------------- look-dev
/**
 * Three-point rig sized for a broadside hero framing. Routed through
 * DemoEntry.installLights so the Viewer skips its default studio rig.
 */
export function createClassicFadeLookDevLights(): THREE.Group {
  const g = new THREE.Group();

  const key = new THREE.DirectionalLight(0xfff2e2, 3.56);
  key.position.set(-1.6, 3.4, -3.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 22;
  key.shadow.camera.left = -3.2;
  key.shadow.camera.right = 3.2;
  key.shadow.camera.top = 2.2;
  key.shadow.camera.bottom = -2.2;
  key.shadow.bias = -0.0004;

  const fill = new THREE.DirectionalLight(0xc4d6ff, 1.06);
  fill.position.set(2.6, 0.8, -2.8);

  // grazing rim along the spine so the wedge grind and the jimping read in silhouette
  const rim = new THREE.DirectionalLight(0xaec6ff, 2.13);
  rim.position.set(0.6, -1.8, 3.6);

  g.add(key, fill, rim, new THREE.AmbientLight(0x2a3040, 0.18));

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 24),
    new THREE.ShadowMaterial({ opacity: 0.38 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.55;
  ground.receiveShadow = true;
  g.add(ground);

  return g;
}

/** Near-black radial studio backdrop; the warm centre lift makes the Fade's amber band pop. */
export function makeClassicFadeBackground(): THREE.CanvasTexture {
  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d')!;
  const grad = c.createRadialGradient(
    size * 0.5, size * 0.48, size * 0.03,
    size * 0.5, size * 0.5, size * 0.74,
  );
  grad.addColorStop(0, '#191218');
  grad.addColorStop(0.55, '#0b0a0e');
  grad.addColorStop(1, '#030304');
  c.fillStyle = grad;
  c.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
