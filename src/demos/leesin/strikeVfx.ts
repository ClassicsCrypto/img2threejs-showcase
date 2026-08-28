import * as THREE from 'three';
import {
  CLIP_TRAIL_REFERENCE,
  HAND_TIP_FOREARM_FRACTION,
  STRIKE_HIP_NODE,
  STRIKE_LIMBS,
  TRAIL_GATE,
  strikesForClip,
  type StrikeEvent,
  type StrikeKind,
  type StrikeLimb,
} from './strikeEvents';

/**
 * Strike effects for the Lee Sin rig -- limb trails, impact flare, ember sparks and an air ring.
 *
 * PURE THREE.JS AND NO ASSET. The one texture is a radial gradient drawn into a 64 px canvas at
 * construction; nothing is fetched, and no image, sprite sheet or shader file is added to the
 * repository. Everything else is `RingGeometry`, `BufferGeometry` and two small inline shaders.
 *
 * THIS GROUP LIVES BESIDE THE MODEL, NOT INSIDE IT, and that is deliberate rather than incidental.
 * The parts inspector, the explode layout and the rig gate all walk `leesin-procedural` and assert
 * 69 visible meshes bound to the skeleton. An effect mesh parented under the model would be counted
 * as a body part: it would appear in the parts list, fly apart on explode, and fail
 * `everyVisibleMeshRigBound`. So the effects attach to the model's PARENT and read limb positions in
 * world space, which already carry the model's display offset.
 *
 * Effects are driven by measurement, in two layers:
 *
 *   - a continuous trail whose strength follows limb speed, normalised against the clip's own
 *     measured 95th-percentile speed, so it reads the same in a 5.1 H/s dash and a 2.4 H/s strike
 *     and stays completely absent through idle;
 *   - discrete bursts at the strike instants in `strikeEvents.ts`, which came from a sweep rather
 *     than from picking timestamps by eye.
 *
 * The viewer skips every `userData.tick` in capture mode, so none of this runs during headless
 * screenshot capture and the turntable frames stay byte-comparable.
 */

/**
 * The four elements, and what actually separates them.
 *
 * Recolouring one simulation four times does not work: water that drifts upward reads as coloured
 * smoke, and lightning that lingers for half a second reads as a ribbon. Each element therefore
 * changes the MOTION as well as the palette --
 *
 *   wind     neutral drift, lateral diffusion, no vertical bias. The reference behaviour.
 *   fire     short drag time and strong buoyancy, so it leaves fast and climbs; broad, flickering.
 *   water    no buoyancy and real gravity, so droplets arc over and fall; tight, slow to diffuse.
 *   thunder  very short drag and lifetime, violent swirl and a hard strobe: a kinked line that is
 *            gone in a sixth of a second.
 *
 * `id` is what the shader branches on.
 */
export const VFX_ELEMENTS = [
  { id: 0, key: 'wind', label: 'Wind' },
  { id: 1, key: 'fire', label: 'Fire' },
  { id: 2, key: 'water', label: 'Water' },
  { id: 3, key: 'thunder', label: 'Thunder' },
] as const;

export type VfxElementKey = typeof VFX_ELEMENTS[number]['key'];

/** CPU-side per-element spawn parameters; the shader holds the per-element motion. */
const ELEMENT_SPAWN: Record<VfxElementKey, {
  spanBase: number; spanJitter: number; size: number; tube: number;
  tangential: number; outward: number; count: number;
  ember: THREE.Color; glow: THREE.Color; glowPeak: number; trail: THREE.Color;
  /** Transient light thrown into the scene: this is what makes the strike touch its surroundings. */
  lightColour: THREE.Color; lightPeak: number; lightSpan: number; lightFlicker: number;
}> = {
  wind: {
    spanBase: 0.50, spanJitter: 0.40, size: 0.040, tube: 0.038,
    tangential: 0.38, outward: 0.22, count: 1.0,
    ember: new THREE.Color(0xd8ecff), glow: new THREE.Color(0xf4fbff), glowPeak: 0.34,
    trail: new THREE.Color(0xcfe2f5),
    lightColour: new THREE.Color(0xdfefff), lightPeak: 2.0, lightSpan: 0.26, lightFlicker: 0,
  },
  fire: {
    spanBase: 0.62, spanJitter: 0.45, size: 0.052, tube: 0.044,
    tangential: 0.30, outward: 0.30, count: 1.15,
    ember: new THREE.Color(0xffb14a), glow: new THREE.Color(0xfff0c8), glowPeak: 0.52,
    trail: new THREE.Color(0xffb45e),
    lightColour: new THREE.Color(0xff8f3c), lightPeak: 11.0, lightSpan: 0.52, lightFlicker: 0.42,
  },
  water: {
    spanBase: 0.52, spanJitter: 0.36, size: 0.034, tube: 0.030,
    tangential: 0.42, outward: 0.16, count: 0.9,
    ember: new THREE.Color(0x8fd8ff), glow: new THREE.Color(0xdff4ff), glowPeak: 0.30,
    trail: new THREE.Color(0x7cc8f0),
    lightColour: new THREE.Color(0x8ad0ff), lightPeak: 3.4, lightSpan: 0.30, lightFlicker: 0.08,
  },
  thunder: {
    spanBase: 0.14, spanJitter: 0.12, size: 0.030, tube: 0.026,
    tangential: 0.62, outward: 0.34, count: 1.25,
    ember: new THREE.Color(0xd9c4ff), glow: new THREE.Color(0xffffff), glowPeak: 0.66,
    trail: new THREE.Color(0xc9b6ff),
    lightColour: new THREE.Color(0xeceaff), lightPeak: 34.0, lightSpan: 0.14, lightFlicker: 0.9,
  },
};

const ELEMENT_ID: Record<VfxElementKey, number> = Object.fromEntries(
  VFX_ELEMENTS.map((entry) => [entry.key, entry.id]),
) as Record<VfxElementKey, number>;

/**
 * The travelling orb, one flavour per element.
 *
 * `speed` is launch speed in figure heights per second, `drag` the exponential decay time in seconds
 * (small = brakes hard), `gravity` the vertical acceleration, `life` how long it survives before it
 * bursts, `radius` its screen size in figure heights, and `shed` how many trail wisps it leaves per
 * second. Water arcs and drops; thunder crosses the frame before it decays; wind is fast and thin;
 * fire is slow, fat and bright enough to light the character as it goes.
 */
const ELEMENT_PROJECTILE: Record<VfxElementKey, {
  speed: number; drag: number; gravity: number; life: number; radius: number;
  shed: number; alpha: number; strobe: number; stretch: number; residue: number;
  /** Share of the life spent fading. Near zero means it holds full brightness and then bursts. */
  fadeTail: number;
  core: THREE.Color; halo: THREE.Color; lightPeak: number;
}> = {
  wind: {
    speed: 9.2, drag: 0.72, gravity: -0.05, life: 0.85, radius: 0.100,
    shed: 130, alpha: 0.62, strobe: 0, stretch: 1.05, residue: 48, fadeTail: 0.28,
    core: new THREE.Color(0xf3f7ff), halo: new THREE.Color(0xc3d4e6), lightPeak: 2.2,
  },
  fire: {
    speed: 5.4, drag: 0.95, gravity: -0.20, life: 1.15, radius: 0.165,
    shed: 170, alpha: 0.95, strobe: 0.22, stretch: 1.05, residue: 48, fadeTail: 0.30,
    core: new THREE.Color(0xfff3d2), halo: new THREE.Color(0xff5410), lightPeak: 10.0,
  },
  water: {
    speed: 6.6, drag: 2.20, gravity: 0.0, life: 0.85, radius: 0.108,
    shed: 100, alpha: 0.98, strobe: 0.04, stretch: 0.0, residue: 42, fadeTail: 0.06,
    core: new THREE.Color(0xeafaff), halo: new THREE.Color(0x3ba7ff), lightPeak: 3.6,
  },
  thunder: {
    speed: 14.5, drag: 0.60, gravity: 0, life: 0.5, radius: 0.074,
    shed: 230, alpha: 1.0, strobe: 1.0, stretch: 0.85, residue: 46, fadeTail: 0.30,
    core: new THREE.Color(0xffffff), halo: new THREE.Color(0x8c6bff), lightPeak: 26.0,
  },
};

const PROJECTILE_POOL = 3;

const TRAIL_SAMPLES = 18;
const EMBER_COUNT = 180;
const RING_POOL = 8;

/** Subtle by request: additive peaks well under 1 so the effect reads as light, not as paint. */
const TRAIL_PEAK_ALPHA = 0.26;
const FLARE_PEAK_ALPHA = 0.42;

interface Palette {
  readonly hot: THREE.Color;
  readonly cool: THREE.Color;
  readonly trail: THREE.Color;
}

/** Hands read as heat, feet as displaced dust. Neither is saturated enough to fight the model. */
const PALETTES: Record<StrikeKind, Palette> = {
  impact: {
    hot: new THREE.Color(0xfff1cd),
    cool: new THREE.Color(0xff6a1e),
    trail: new THREE.Color(0xffb45e),
  },
  footfall: {
    hot: new THREE.Color(0xe8e0cf),
    cool: new THREE.Color(0x9b8f78),
    trail: new THREE.Color(0xcfc4ad),
  },
  // A punch reads as cut air first and heat second: a near-white leading edge over a warm spark.
  punch: {
    hot: new THREE.Color(0xf4fbff),
    cool: new THREE.Color(0xff8a34),
    trail: new THREE.Color(0xffc07a),
  },
};

const LIMB_KIND: Record<StrikeLimb, StrikeKind> = {
  'hand.l': 'impact',
  'hand.r': 'impact',
  'foot.l': 'footfall',
  'foot.r': 'footfall',
};

function makeSparkTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A thin bright annulus with soft inner and outer falloff, drawn once into a 128 px canvas. */
function makeRingTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.62, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.80, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.92, 'rgba(255,255,255,0.35)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

interface Ribbon {
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.BufferGeometry;
  readonly position: THREE.BufferAttribute;
  readonly strength: THREE.BufferAttribute;
  readonly history: THREE.Vector3[];
  filled: number;
  /** Trail strength at the head, eased so it does not flicker between frames. */
  level: number;
}

export interface StrikeVfx {
  readonly group: THREE.Group;
  /**
   * @param delta   seconds since the previous frame
   * @param clip    the clip currently playing, or null when the rig is idle
   * @param time    seconds into that clip
   * @param looped  true on the frame the clip wrapped, so bursts can re-arm
   */
  update(delta: number, clip: string | null, time: number, looped: boolean): void;
  /** Element for subsequent bursts: 'wind' | 'fire' | 'water' | 'thunder'. */
  setElement(key: VfxElementKey): void;
  readonly element: VfxElementKey;
  dispose(): void;
}

export function createStrikeVfx(nodes: Map<number, THREE.Object3D>): StrikeVfx {
  const group = new THREE.Group();
  group.name = 'leesin-strike-vfx';
  // Belt and braces: any walker that does reach this subtree can be told to ignore it.
  group.userData.excludeFromParts = true;

  /**
   * A transient point light, and the reason it is created HERE rather than at the strike.
   *
   * Adding a light to a scene changes the shader permutation of every lit material, so creating one
   * on the first punch would recompile all 69 of the character's materials mid-frame -- a visible
   * hitch exactly when the effect is supposed to look good. It is therefore added at construction
   * with `intensity = 0`, so the permutation is compiled during the same warm-up that uploads the
   * geometry, and a strike only animates a number.
   *
   * This is what makes the effect reach beyond itself: the flash lights the character's own skin and
   * wraps, so a fire strike warms the torso and a thunder strike blows the whole figure out for two
   * frames. `distance` keeps it local instead of relighting the entire scene.
   */
  const flash = new THREE.PointLight(0xffffff, 0, 1.9, 2);
  flash.castShadow = false;
  group.add(flash);
  let flashLife = 1;
  let flashSpan = 1;
  let flashPeak = 0;
  let flashFlicker = 0;
  let flashClock = 0;

  /**
   * The orb carries its own light. Created here, not on launch, for the same reason as `flash`: a
   * light added mid-frame recompiles every lit material in the scene. Two lights are pre-warmed at
   * intensity 0, so a launch only animates numbers.
   */
  const orbLight = new THREE.PointLight(0xffffff, 0, 2.4, 2);
  orbLight.castShadow = false;
  group.add(orbLight);

  const spark = makeSparkTexture();
  const scratch = new THREE.Vector3();
  const previous = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const side = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const axisU = new THREE.Vector3();
  const axisV = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const seat = new THREE.Vector3();
  const tearDir = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  // ------------------------------------------------------------------ limb trails
  const trailMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(0xffffff) }, uAlpha: { value: TRAIL_PEAK_ALPHA } },
    vertexShader: `
      attribute float aStrength;
      varying float vStrength;
      void main() {
        vStrength = aStrength;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uAlpha;
      varying float vStrength;
      void main() {
        gl_FragColor = vec4(uColor, uAlpha * vStrength);
      }`,
  });

  const ribbons = new Map<StrikeLimb, Ribbon>();
  for (const limb of Object.keys(STRIKE_LIMBS) as StrikeLimb[]) {
    const geometry = new THREE.BufferGeometry();
    const position = new THREE.BufferAttribute(new Float32Array(TRAIL_SAMPLES * 2 * 3), 3);
    const strength = new THREE.BufferAttribute(new Float32Array(TRAIL_SAMPLES * 2), 1);
    position.setUsage(THREE.DynamicDrawUsage);
    strength.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', position);
    geometry.setAttribute('aStrength', strength);
    const indices: number[] = [];
    for (let i = 0; i < TRAIL_SAMPLES - 1; i += 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geometry.setIndex(indices);
    const material = trailMaterial.clone();
    material.uniforms.uColor.value = PALETTES[LIMB_KIND[limb]].trail.clone();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.visible = false;
    group.add(mesh);
    ribbons.set(limb, {
      mesh,
      geometry,
      position,
      strength,
      history: Array.from({ length: TRAIL_SAMPLES }, () => new THREE.Vector3()),
      filled: 0,
      level: 0,
    });
  }

  // ------------------------------------------------------------------ ember sparks
  const emberPos = new Float32Array(EMBER_COUNT * 3);
  const emberVel = new Float32Array(EMBER_COUNT * 3);
  const emberLife = new Float32Array(EMBER_COUNT);
  const emberSpan = new Float32Array(EMBER_COUNT);
  const emberSize = new Float32Array(EMBER_COUNT);
  const emberTint = new Float32Array(EMBER_COUNT);
  emberLife.fill(1);

  const emberGeometry = new THREE.BufferGeometry();
  const emberPosAttr = new THREE.BufferAttribute(emberPos, 3).setUsage(THREE.DynamicDrawUsage);
  const emberLifeAttr = new THREE.BufferAttribute(emberLife, 1).setUsage(THREE.DynamicDrawUsage);
  const emberSizeAttr = new THREE.BufferAttribute(emberSize, 1).setUsage(THREE.DynamicDrawUsage);
  const emberTintAttr = new THREE.BufferAttribute(emberTint, 1).setUsage(THREE.DynamicDrawUsage);
  emberGeometry.setAttribute('position', emberPosAttr);
  emberGeometry.setAttribute('aLife', emberLifeAttr);
  emberGeometry.setAttribute('aSize', emberSizeAttr);
  emberGeometry.setAttribute('aTint', emberTintAttr);

  const emberMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uMap: { value: spark },
      uHotImpact: { value: PALETTES.impact.hot },
      uCoolImpact: { value: PALETTES.impact.cool },
      uHotFoot: { value: PALETTES.footfall.hot },
      uCoolFoot: { value: PALETTES.footfall.cool },
      uScale: { value: 320 },
    },
    vertexShader: `
      attribute float aLife;
      attribute float aSize;
      attribute float aTint;
      varying float vLife;
      varying float vTint;
      uniform float uScale;
      void main() {
        vLife = aLife;
        vTint = aTint;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale * (1.0 - aLife * 0.65) / max(0.001, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform vec3 uHotImpact; uniform vec3 uCoolImpact;
      uniform vec3 uHotFoot;   uniform vec3 uCoolFoot;
      varying float vLife;
      varying float vTint;
      void main() {
        if (vLife >= 1.0) discard;
        vec4 tex = texture2D(uMap, gl_PointCoord);
        vec3 hot  = mix(uHotFoot,  uHotImpact,  vTint);
        vec3 cool = mix(uCoolFoot, uCoolImpact, vTint);
        vec3 tone = mix(hot, cool, vLife);
        gl_FragColor = vec4(tone, tex.a * (1.0 - vLife) * 0.9);
      }`,
  });

  const embers = new THREE.Points(emberGeometry, emberMaterial);
  embers.frustumCulled = false;
  embers.renderOrder = 4;
  group.add(embers);
  let emberCursor = 0;

  // ------------------------------------------------------------------ wind jet
  /**
   * The displaced air, as a turbulent vortex jet rather than a geometric ring.
   *
   * The first version of this was an expanding torus arc. It was legible but it read as a hoop: one
   * rigid curve, growing at a constant rate, with a hard edge. Air does not do that. What a fist
   * actually leaves behind is a vortex ring around a forward jet, and three things make that read as
   * wind instead of as geometry:
   *
   *   - EXPONENTIAL DRAG. Each wisp's displacement is `v · tau · (1 - e^(-t/tau))`, so it leaves fast
   *     and settles asymptotically instead of travelling at a fixed speed. That single curve is most
   *     of the difference between "blown" and "animated".
   *   - SQRT-IN-TIME SPREAD. Lateral scatter grows as sqrt(t), which is how turbulent diffusion
   *     actually widens a plume. Linear spread looks like an explosion; sqrt looks like air.
   *   - PER-WISP SWIRL PHASE. Every wisp gets its own phase and frequency around the punch axis, so
   *     nothing moves in lockstep. Lockstep is what made the single arc look mechanical.
   *
   * Each wisp also GROWS as it fades -- that is the "spread" -- so the jet dissolves into a soft
   * volume rather than shrinking to a point. Individual alpha is deliberately tiny; the body of the
   * effect comes from many overlapping wisps, not from any one being bright.
   *
   * Motion is evaluated ANALYTICALLY IN THE VERTEX SHADER from a birth time and a seed. Nothing is
   * integrated on the CPU and no attribute is rewritten per frame -- buffers are touched only when a
   * punch spawns -- so several hundred wisps cost one draw call and no per-frame work.
   */
  const WISP_COUNT = 900;
  const wispOrigin = new Float32Array(WISP_COUNT * 3);
  const wispVel = new Float32Array(WISP_COUNT * 3);
  const wispAxisU = new Float32Array(WISP_COUNT * 3);
  const wispAxisV = new Float32Array(WISP_COUNT * 3);
  const wispSeed = new Float32Array(WISP_COUNT);
  const wispStart = new Float32Array(WISP_COUNT);
  const wispSpan = new Float32Array(WISP_COUNT);
  const wispSize = new Float32Array(WISP_COUNT);
  const wispElem = new Float32Array(WISP_COUNT);
  wispStart.fill(-1e3);

  /**
   * STREAKS, NOT POINTS, and that is the whole difference between wind and snow.
   *
   * Two earlier attempts failed for the same underlying reason. A rigid torus arc read as a hoop. A
   * `THREE.Points` cloud read as separated round dots -- bokeh, or falling snow -- because
   * `gl_PointSize` can only produce an isotropic sprite, and nothing isotropic reads as moving air.
   *
   * Each wisp is now an instanced quad stretched along its own velocity IN VIEW SPACE, so the streak
   * always lies along the direction the eye sees it travelling, from any camera angle, with no
   * billboarding maths in the caller. Length is tied to remaining speed and width to age, so a wisp
   * is born long and thin and dies short and broad -- which is what a gust does as it gives up its
   * momentum to the surrounding air.
   */
  const wispGeometry = new THREE.InstancedBufferGeometry();
  wispGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ]), 3));
  wispGeometry.setIndex([0, 1, 2, 0, 2, 3]);
  const wispAttrs = {
    aOrigin: new THREE.InstancedBufferAttribute(wispOrigin, 3).setUsage(THREE.DynamicDrawUsage),
    aVel: new THREE.InstancedBufferAttribute(wispVel, 3).setUsage(THREE.DynamicDrawUsage),
    aAxisU: new THREE.InstancedBufferAttribute(wispAxisU, 3).setUsage(THREE.DynamicDrawUsage),
    aAxisV: new THREE.InstancedBufferAttribute(wispAxisV, 3).setUsage(THREE.DynamicDrawUsage),
    aSeed: new THREE.InstancedBufferAttribute(wispSeed, 1).setUsage(THREE.DynamicDrawUsage),
    aStart: new THREE.InstancedBufferAttribute(wispStart, 1).setUsage(THREE.DynamicDrawUsage),
    aSpan: new THREE.InstancedBufferAttribute(wispSpan, 1).setUsage(THREE.DynamicDrawUsage),
    aSize: new THREE.InstancedBufferAttribute(wispSize, 1).setUsage(THREE.DynamicDrawUsage),
    aElem: new THREE.InstancedBufferAttribute(wispElem, 1).setUsage(THREE.DynamicDrawUsage),
  };
  for (const [name, attr] of Object.entries(wispAttrs)) wispGeometry.setAttribute(name, attr);
  wispGeometry.instanceCount = WISP_COUNT;

  const wispMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute vec3 aOrigin;
      attribute vec3 aVel;
      attribute vec3 aAxisU;
      attribute vec3 aAxisV;
      attribute float aSeed;
      attribute float aStart;
      attribute float aSpan;
      attribute float aSize;
      attribute float aElem;
      uniform float uTime;
      varying vec2 vQuad;
      varying float vAge;
      varying float vSeed;
      varying float vElem;
      varying float vLife;

      void main() {
        float t = uTime - aStart;
        vQuad = position.xy;
        vSeed = aSeed;
        vElem = aElem;
        vLife = t;
        if (t < 0.0 || t > aSpan) {
          vAge = 1.0;
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // off-clip, never rasterised
          return;
        }
        float u = t / aSpan;
        vAge = u;

        // Per-element motion. These four lines are the difference between the elements; the palette
        // below only follows them.
        float tau     = aElem < 0.5 ? 0.30 : aElem < 1.5 ? 0.22 : aElem < 2.5 ? 0.34 : 0.11;
        float buoy    = aElem < 0.5 ? 0.05 : aElem < 1.5 ? 0.34 : aElem < 2.5 ? -0.95 : 0.02;
        float swirlAmp= aElem < 0.5 ? 0.05 : aElem < 1.5 ? 0.135 : aElem < 2.5 ? 0.028 : 0.20;
        float diffuse = aElem < 0.5 ? 0.17 : aElem < 1.5 ? 0.13 : aElem < 2.5 ? 0.09 : 0.24;

        float decay = exp(-t / tau);
        vec3 disp = aVel * tau * (1.0 - decay);

        // Per-wisp swirl phase and rate, so nothing moves in lockstep. Thunder swirls hard and fast,
        // which is what kinks its line.
        float phase = aSeed * 6.2831853;
        float rate = (3.0 + fract(aSeed * 13.17) * 5.0) * (aElem > 2.5 ? 6.0 : 1.0);
        float swirl = swirlAmp * (1.0 - exp(-t / 0.16));
        disp += (aAxisU * cos(phase + t * rate) + aAxisV * sin(phase + t * rate)) * swirl;

        // Turbulent spread, widening as sqrt(t).
        vec2 jitter = vec2(fract(aSeed * 7.13) - 0.5, fract(aSeed * 3.71) - 0.5);
        disp += (aAxisU * jitter.x + aAxisV * jitter.y) * diffuse * sqrt(t);
        // Fire and wind rise; water falls under real gravity.
        disp.y += buoy * t * t;

        vec4 mv = modelViewMatrix * vec4(aOrigin + disp, 1.0);
        // Stretch along the view-space velocity: the streak lies along the motion the eye sees.
        vec3 vv = (modelViewMatrix * vec4(aVel, 0.0)).xyz;
        vec2 dir = normalize(vv.xy + vec2(1e-5));
        vec2 perp = vec2(-dir.y, dir.x);
        // Fire is broad and stubby, thunder is a long thin filament, water is a droplet.
        float lenK = aElem < 0.5 ? 9.0 : aElem < 1.5 ? 3.0 : aElem < 2.5 ? 4.2 : 11.0;
        float widK = aElem < 0.5 ? 1.5 : aElem < 1.5 ? 4.6 : aElem < 2.5 ? 1.5 : 0.9;
        float len = aSize * (0.7 + lenK * decay);
        float wid = aSize * (0.30 + widK * u);
        mv.xy += dir * (position.x * len) + perp * (position.y * wid);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec2 vQuad;
      varying float vAge;
      varying float vSeed;
      varying float vElem;
      varying float vLife;
      void main() {
        if (vAge >= 1.0) discard;
        // Soft elliptical falloff, computed rather than sampled -- no texture, no asset.
        float r = length(vQuad) * 2.0;
        float a = smoothstep(1.0, 0.0, r);
        a *= a;
        // Quick rise, then a per-element tail. Fire's is long because it becomes smoke; thunder's is
        // almost immediate.
        float tail = vElem < 0.5 ? 1.9 : vElem < 1.5 ? 1.5 : vElem < 2.5 ? 1.9 : 2.7;
        float env = min(1.0, vAge / 0.09) * pow(1.0 - vAge, tail);
        float mixer = fract(vSeed * 5.31);

        vec3 tone;
        float gain;
        if (vElem < 0.5) {
          // WIND. Moving air is invisible; what an eye actually sees is the dust it carries. So this
          // is a dusty neutral at low contrast, not a bright blue-white, which read as energy rather
          // than as air.
          tone = mix(vec3(0.74,0.78,0.84), vec3(0.87,0.81,0.71), mixer);
          gain = 0.17;
        } else if (vElem < 1.5) {
          // FIRE, through the whole cooling sequence: white-hot core, yellow, orange, ember red, then
          // SMOKE. Fading a flame straight to nothing is what made the old version read as a glow --
          // real fire leaves something behind, and that something keeps rising.
          // A diffusion flame is not one colour cooling to black. It has a BLUE base where combustion
          // is complete, a luminous yellow-white body where soot incandesces, then orange, then dull
          // red at the tips. The blue base is the cue most stylised fire leaves out, and its absence
          // is most of why the previous ramp read as a warm glow rather than as burning.
          vec3 base = vec3(0.40, 0.60, 1.00);
          vec3 hot  = vec3(1.00, 0.96, 0.80);
          vec3 mid  = vec3(1.00, 0.52, 0.10);
          vec3 coal = vec3(0.60, 0.09, 0.02);
          // Per-wisp temperature variance: real flames do not cool in lockstep.
          float k = clamp(pow(vAge, 0.72) * (0.80 + 0.38 * fract(vSeed * 2.71)), 0.0, 1.0);
          tone = k < 0.11
            ? mix(base, hot, k / 0.11)
            : (k < 0.46 ? mix(hot, mid, (k - 0.11) / 0.35) : mix(mid, coal, (k - 0.46) / 0.54));
          // Combustion is not steady.
          env *= 0.68 + 0.32 * sin(vLife * 46.0 + vSeed * 31.0);
          gain = 0.34;
        } else if (vElem < 2.5) {                // water: cyan surface, deep blue body
          tone = mix(vec3(0.62,0.90,1.0), vec3(0.10,0.36,0.78), mixer);
          gain = 0.30;
        } else {                                 // thunder: violet-white with a hard strobe
          tone = mix(vec3(1.0,1.0,1.0), vec3(0.66,0.52,1.0), mixer);
          float strobe = step(0.32, fract(vLife * 34.0 + vSeed * 17.0));
          env *= 0.30 + 0.70 * strobe;
          gain = 0.52;
        }
        gl_FragColor = vec4(tone, a * env * gain);
      }`,
  });

  const wisps = new THREE.Mesh(wispGeometry, wispMaterial);
  wisps.frustumCulled = false;
  wisps.renderOrder = 5;
  group.add(wisps);
  let wispCursor = 0;
  let clock = 0;
  /** Switched from the UI; affects bursts from the next strike on, never wisps already in flight. */
  let element: VfxElementKey = 'wind';

  /**
   * A vortex ring around a forward jet -- the structure a fist actually leaves in air.
   *
   * `ring` wisps start on a circle perpendicular to the punch and carry outward AND forward, so the
   * ring expands while it drifts, as a real vortex ring does. `core` wisps fill the middle with a
   * narrow fast cone so the centre is not hollow.
   */
  /**
   * Wind laid ALONG THE PATH THE LIMB ACTUALLY SWEPT, which is what "xe gio" means and what the
   * point-source jet could never produce.
   *
   * The trail already stores the limb's last 18 world positions, one per frame -- the real swept arc,
   * 0.43 to 1.12 figure heights long depending on the clip. Wisps are seeded at stations along that
   * arc, offset radially around it, and given a velocity that is mostly the LOCAL TANGENT of the
   * path. The result is a tube of streaks wrapped around the swing, so the wind lines curve with the
   * hand instead of exploding out of the fist.
   *
   * Stations near the tail are born already partly aged, because that air was displaced earlier in
   * the swing. The sweep therefore reads as something shed continuously along the arc rather than
   * spawned all at once at the end of it.
   */
  function spawnWindSweep(history: readonly THREE.Vector3[], filled: number, force: number): void {
    const usable = Math.min(filled, TRAIL_SAMPLES) - 1;
    if (usable < 4) return;
    const count = Math.round(120 * force) + 44;
    for (let i = 0; i < count; i += 1) {
      // Biased toward the leading end, where the limb was fastest.
      const station = Math.random() ** 0.7 * (usable - 2);
      const i0 = Math.floor(station) + 1;
      const frac = station - Math.floor(station);
      // history[0] is the newest sample, so forward in time is history[i0] -> history[i0 - 1].
      tangent.copy(history[i0 - 1]).sub(history[i0]);
      const speed = tangent.length() * 60;
      if (speed < 1e-4) continue;
      tangent.normalize();

      axisU.set(0, 1, 0);
      if (Math.abs(tangent.dot(axisU)) > 0.9) axisU.set(1, 0, 0);
      axisU.crossVectors(tangent, axisU).normalize();
      axisV.crossVectors(tangent, axisU).normalize();

      const spawn = ELEMENT_SPAWN[element];
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.008 + Math.random() * spawn.tube;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      seat.copy(history[i0]).lerp(history[i0 - 1], frac)
        .addScaledVector(axisU, cos * radius)
        .addScaledVector(axisV, sin * radius);

      const index = wispCursor;
      wispCursor = (wispCursor + 1) % WISP_COUNT;
      wispOrigin[index * 3] = seat.x;
      wispOrigin[index * 3 + 1] = seat.y;
      wispOrigin[index * 3 + 2] = seat.z;

      // Mostly along the arc, a little outward: the streak lies with the swing, not across it.
      const vt = speed * (spawn.tangential + Math.random() * 0.44) * force;
      const vr = (spawn.outward * 0.4 + Math.random() * spawn.outward) * force;
      wispVel[index * 3] = tangent.x * vt + (axisU.x * cos + axisV.x * sin) * vr;
      wispVel[index * 3 + 1] = tangent.y * vt + (axisU.y * cos + axisV.y * sin) * vr;
      wispVel[index * 3 + 2] = tangent.z * vt + (axisU.z * cos + axisV.z * sin) * vr;

      for (let k = 0; k < 3; k += 1) {
        wispAxisU[index * 3 + k] = axisU.getComponent(k);
        wispAxisV[index * 3 + k] = axisV.getComponent(k);
      }
      wispSeed[index] = Math.random();
      // Tail air is older air.
      wispStart[index] = clock - (station / usable) * 0.13 + Math.random() * 0.03;
      wispSpan[index] = spawn.spanBase + Math.random() * spawn.spanJitter;
      wispSize[index] = spawn.size * (0.7 + Math.random() * 0.7);
      wispElem[index] = ELEMENT_ID[element];
    }
    for (const attr of Object.values(wispAttrs)) attr.needsUpdate = true;
  }

  function spawnWindJet(at: THREE.Vector3, along: THREE.Vector3, force: number): void {
    axisU.set(0, 1, 0);
    if (Math.abs(along.dot(axisU)) > 0.9) axisU.set(1, 0, 0);
    axisU.crossVectors(along, axisU).normalize();
    axisV.crossVectors(along, axisU).normalize();

    const ring = Math.round(64 * force) + 22;
    const core = Math.round(48 * force) + 16;
    for (let i = 0; i < ring + core; i += 1) {
      const index = wispCursor;
      wispCursor = (wispCursor + 1) % WISP_COUNT;
      const isRing = i < ring;
      const angle = isRing ? (i / ring) * Math.PI * 2 + Math.random() * 0.3 : Math.random() * Math.PI * 2;
      // Forward dominates radial, deliberately. With radial at 0.9-1.7 against forward 0.8-1.5 the
      // plume left in every direction at once and read as a firework rather than as a gust following
      // the fist. A punch pushes air AHEAD of it; the ring is the smaller, secondary part.
      const radial = isRing ? 0.42 + Math.random() * 0.5 : Math.random() * 0.22;
      const forward = isRing ? 1.05 + Math.random() * 0.75 : 1.55 + Math.random() * 1.25;
      // Spread the birth points ALONG the punch, not all at the fist. Additive blending piles
      // co-located wisps into a saturated white blob; staggering where and when they appear turns
      // that blob back into a plume with a leading edge.
      const seedStart = (isRing ? 0.02 : 0.0) + Math.random() * 0.10;

      const r0 = isRing ? 0.03 + Math.random() * 0.035 : Math.random() * 0.02;
      const ox = Math.cos(angle) * r0;
      const oy = Math.sin(angle) * r0;
      wispOrigin[index * 3] = at.x + axisU.x * ox + axisV.x * oy + along.x * seedStart;
      wispOrigin[index * 3 + 1] = at.y + axisU.y * ox + axisV.y * oy + along.y * seedStart;
      wispOrigin[index * 3 + 2] = at.z + axisU.z * ox + axisV.z * oy + along.z * seedStart;

      const vr = radial * force * 1.45;
      const vf = forward * force * 1.6;
      wispVel[index * 3] = (axisU.x * Math.cos(angle) + axisV.x * Math.sin(angle)) * vr + along.x * vf;
      wispVel[index * 3 + 1] = (axisU.y * Math.cos(angle) + axisV.y * Math.sin(angle)) * vr + along.y * vf;
      wispVel[index * 3 + 2] = (axisU.z * Math.cos(angle) + axisV.z * Math.sin(angle)) * vr + along.z * vf;

      for (let k = 0; k < 3; k += 1) {
        wispAxisU[index * 3 + k] = axisU.getComponent(k);
        wispAxisV[index * 3 + k] = axisV.getComponent(k);
      }
      wispSeed[index] = Math.random();
      wispStart[index] = clock + Math.random() * 0.095;  // stagger, so the front is not a wall
      const spawn = ELEMENT_SPAWN[element];
      wispSpan[index] = (isRing ? spawn.spanBase + 0.1 : spawn.spanBase) + Math.random() * spawn.spanJitter;
      wispSize[index] = (isRing ? spawn.size * 1.1 : spawn.size * 0.85) * (0.7 + Math.random() * 0.7);
      wispElem[index] = ELEMENT_ID[element];
    }
    for (const attr of Object.values(wispAttrs)) attr.needsUpdate = true;
  }

  // ------------------------------------------------------------------ smoke
  /**
   * Smoke, and why it needs a pass of its own.
   *
   * The previous attempt put a dark "smoke" stop at the end of the flame's colour ramp. That could
   * never work: the whole effect draws with `AdditiveBlending`, where a dark colour adds almost
   * nothing, so the smoke phase was mathematically invisible. SMOKE OBSCURES LIGHT; it does not emit
   * it. Rendering it therefore needs `NormalBlending`, which is why this is a separate mesh with a
   * separate material rather than four more lines in the flame shader.
   *
   * Second trap, specific to this showcase: the backdrop is near-black (#0d0e10). Physically accurate
   * dark-grey smoke on that ground is also invisible. Real smoke over a fire is LIT BY THE FIRE -- it
   * scatters that light and reads brighter than the night behind it -- so it is born a warm lit grey
   * and cools toward a dim neutral as it climbs away from the flame and the flame dies.
   *
   * Motion is slower than the flame in every respect: a long drag time, a steady rather than
   * accelerating rise, wide slow swirl, and a lot of growth. It is also born LATE, staggered past the
   * flame's own lifetime, so it appears as the fire goes out rather than alongside it.
   */
  const SMOKE_COUNT = 320;
  const smokeOrigin = new Float32Array(SMOKE_COUNT * 3);
  const smokeVel = new Float32Array(SMOKE_COUNT * 3);
  const smokeAxisU = new Float32Array(SMOKE_COUNT * 3);
  const smokeAxisV = new Float32Array(SMOKE_COUNT * 3);
  const smokeSeed = new Float32Array(SMOKE_COUNT);
  const smokeStart = new Float32Array(SMOKE_COUNT);
  const smokeSpan = new Float32Array(SMOKE_COUNT);
  const smokeSize = new Float32Array(SMOKE_COUNT);
  const smokeElem = new Float32Array(SMOKE_COUNT);
  smokeStart.fill(-1e3);

  const smokeGeometry = new THREE.InstancedBufferGeometry();
  smokeGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ]), 3));
  smokeGeometry.setIndex([0, 1, 2, 0, 2, 3]);
  const smokeAttrs = {
    aOrigin: new THREE.InstancedBufferAttribute(smokeOrigin, 3).setUsage(THREE.DynamicDrawUsage),
    aVel: new THREE.InstancedBufferAttribute(smokeVel, 3).setUsage(THREE.DynamicDrawUsage),
    aAxisU: new THREE.InstancedBufferAttribute(smokeAxisU, 3).setUsage(THREE.DynamicDrawUsage),
    aAxisV: new THREE.InstancedBufferAttribute(smokeAxisV, 3).setUsage(THREE.DynamicDrawUsage),
    aSeed: new THREE.InstancedBufferAttribute(smokeSeed, 1).setUsage(THREE.DynamicDrawUsage),
    aStart: new THREE.InstancedBufferAttribute(smokeStart, 1).setUsage(THREE.DynamicDrawUsage),
    aSpan: new THREE.InstancedBufferAttribute(smokeSpan, 1).setUsage(THREE.DynamicDrawUsage),
    aSize: new THREE.InstancedBufferAttribute(smokeSize, 1).setUsage(THREE.DynamicDrawUsage),
    aElem: new THREE.InstancedBufferAttribute(smokeElem, 1).setUsage(THREE.DynamicDrawUsage),
  };
  for (const [name, attr] of Object.entries(smokeAttrs)) smokeGeometry.setAttribute(name, attr);
  smokeGeometry.instanceCount = SMOKE_COUNT;

  const smokeMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute vec3 aOrigin;
      attribute vec3 aVel;
      attribute vec3 aAxisU;
      attribute vec3 aAxisV;
      attribute float aSeed;
      attribute float aStart;
      attribute float aSpan;
      attribute float aSize;
      attribute float aElem;
      uniform float uTime;
      varying vec2 vQuad;
      varying float vAge;
      varying float vSeed;
      varying float vElem;
      void main() {
        vElem = aElem;
        float t = uTime - aStart;
        vQuad = position.xy;
        vSeed = aSeed;
        if (t < 0.0 || t > aSpan) { vAge = 1.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        float u = t / aSpan;
        vAge = u;

        float tau = 0.95;
        vec3 disp = aVel * tau * (1.0 - exp(-t / tau));
        // A steady climb that eases off, not the flame's accelerating buoyancy.
        disp.y += 0.20 * t - 0.02 * t * t;
        // Wide, slow curl.
        float phase = aSeed * 6.2831853;
        float rate = 0.7 + fract(aSeed * 11.3) * 1.1;
        disp += (aAxisU * cos(phase + t * rate) + aAxisV * sin(phase + t * rate)) * 0.075 * t;
        vec2 jitter = vec2(fract(aSeed * 7.13) - 0.5, fract(aSeed * 3.71) - 0.5);
        disp += (aAxisU * jitter.x + aAxisV * jitter.y) * 0.24 * sqrt(t);

        vec4 mv = modelViewMatrix * vec4(aOrigin + disp, 1.0);
        // Billows: a lot of growth, and roughly round rather than streaked.
        float scale = aSize * (0.55 + 3.8 * u);
        float spin = phase + t * 0.5;
        vec2 q = vec2(
          position.x * cos(spin) - position.y * sin(spin),
          position.x * sin(spin) + position.y * cos(spin)
        );
        mv.xy += q * scale;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec2 vQuad;
      varying float vAge;
      varying float vSeed;
      varying float vElem;
      void main() {
        if (vAge >= 1.0) discard;
        float r = length(vQuad) * 2.0;
        // Squared, not cubed. Cubing a soft falloff left an effective alpha near 0.12 across most of
        // the quad, and 172 live puffs still added up to a barely visible haze.
        float a = smoothstep(1.0, 0.0, r);
        a = a * a;
        // Each element leaves its own residue. All four are lit at birth and cool to a dim neutral,
        // because physically accurate soot on a near-black backdrop is simply invisible.
        vec3 lit; vec3 cold; float gain;
        if (vElem < 0.5) {          // wind: kicked-up dust
          lit = vec3(0.44, 0.43, 0.40); cold = vec3(0.17, 0.17, 0.18); gain = 0.30;
        } else if (vElem < 1.5) {   // fire: warm smoke, lit by the flame while it lasts
          lit = vec3(0.58, 0.46, 0.37); cold = vec3(0.16, 0.15, 0.15); gain = 0.44;
        } else if (vElem < 2.5) {   // water: white steam
          lit = vec3(0.76, 0.84, 0.90); cold = vec3(0.27, 0.32, 0.37); gain = 0.40;
        } else {                    // thunder: a thin violet haze
          lit = vec3(0.54, 0.47, 0.70); cold = vec3(0.18, 0.17, 0.25); gain = 0.34;
        }
        vec3 tone = mix(lit, cold, smoothstep(0.0, 0.55, vAge));
        float env = smoothstep(0.0, 0.20, vAge) * (1.0 - smoothstep(0.42, 1.0, vAge));
        gl_FragColor = vec4(tone, a * env * (gain + 0.16 * fract(vSeed * 9.7)));
      }`,
  });

  const smoke = new THREE.Mesh(smokeGeometry, smokeMaterial);
  smoke.frustumCulled = false;
  smoke.renderOrder = 4;
  group.add(smoke);
  let smokeCursor = 0;

  /** Seeded along the same swept arc as the flame, but born after it and rising much more slowly. */
  function spawnSmoke(history: readonly THREE.Vector3[], filled: number, force: number): void {
    const usable = Math.min(filled, TRAIL_SAMPLES) - 1;
    if (usable < 4) return;
    const count = Math.round(96 * force) + 34;
    for (let i = 0; i < count; i += 1) {
      const station = Math.random() ** 0.8 * (usable - 2);
      const i0 = Math.floor(station) + 1;
      tangent.copy(history[i0 - 1]).sub(history[i0]);
      const speed = tangent.length() * 60;
      if (speed < 1e-4) continue;
      tangent.normalize();

      axisU.set(0, 1, 0);
      if (Math.abs(tangent.dot(axisU)) > 0.9) axisU.set(1, 0, 0);
      axisU.crossVectors(tangent, axisU).normalize();
      axisV.crossVectors(tangent, axisU).normalize();

      const angle = Math.random() * Math.PI * 2;
      const radius = 0.02 + Math.random() * 0.06;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      seat.copy(history[i0])
        .addScaledVector(axisU, cos * radius)
        .addScaledVector(axisV, sin * radius);

      const index = smokeCursor;
      smokeCursor = (smokeCursor + 1) % SMOKE_COUNT;
      smokeOrigin[index * 3] = seat.x;
      smokeOrigin[index * 3 + 1] = seat.y;
      smokeOrigin[index * 3 + 2] = seat.z;

      const vt = speed * (0.10 + Math.random() * 0.16) * force;
      const vr = (0.05 + Math.random() * 0.12) * force;
      smokeVel[index * 3] = tangent.x * vt + (axisU.x * cos + axisV.x * sin) * vr;
      smokeVel[index * 3 + 1] = tangent.y * vt + (axisU.y * cos + axisV.y * sin) * vr;
      smokeVel[index * 3 + 2] = tangent.z * vt + (axisU.z * cos + axisV.z * sin) * vr;

      for (let k = 0; k < 3; k += 1) {
        smokeAxisU[index * 3 + k] = axisU.getComponent(k);
        smokeAxisV[index * 3 + k] = axisV.getComponent(k);
      }
      smokeSeed[index] = Math.random();
      // Born as the fire goes out: the flame's own span is 0.62-1.07 s.
      smokeStart[index] = clock + 0.22 + Math.random() * 0.45;
      smokeSpan[index] = 1.5 + Math.random() * 1.1;
      smokeSize[index] = 0.088 * (0.7 + Math.random() * 0.9);
      smokeElem[index] = ELEMENT_ID[element];
    }
    for (const attr of Object.values(smokeAttrs)) attr.needsUpdate = true;
  }

  // ------------------------------------------------------------------ projectile
  /**
   * Billboarded in the VERTEX SHADER, not by copying a camera quaternion.
   *
   * The orb has to face the viewer from any angle, and this module still has no camera reference. The
   * centre is taken into view space with `modelViewMatrix`, then the quad corners are added there, so
   * the plane is always square to the eye without anyone passing a camera in.
   */
  const orbGeometry = new THREE.PlaneGeometry(1, 1);
  interface Projectile {
    mesh: THREE.Mesh;
    material: THREE.ShaderMaterial;
    velocity: THREE.Vector3;
    life: number;
    span: number;
    key: VfxElementKey;
    force: number;
    shedDebt: number;
    residueDebt: number;
  }
  const projectiles: Projectile[] = [];
  for (let i = 0; i < PROJECTILE_POOL; i += 1) {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uRadius: { value: 0.1 },
        uCore: { value: new THREE.Color(0xffffff) },
        uHalo: { value: new THREE.Color(0xffffff) },
        uAlpha: { value: 0 },
        uTime: { value: 0 },
        uSeed: { value: Math.random() },
        uStrobe: { value: 0 },
        uElem: { value: 0 },
        uVel: { value: new THREE.Vector3(1, 0, 0) },
        uStretch: { value: 0 },
      },
      vertexShader: `
        uniform float uRadius;
        uniform vec3 uVel;
        uniform float uStretch;
        varying vec2 vQuad;
        varying vec2 vUp;
        void main() {
          // Billboard built in VIEW SPACE, with its local x axis along the direction of travel. That
          // gives the fragment shader a frame where "forward" is always +x and "across" is +y, so a
          // slash or a flame tongue can be aimed without the shader knowing where the camera is.
          vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          vec3 vv = (modelViewMatrix * vec4(uVel, 0.0)).xyz;
          vec2 dir = length(vv.xy) > 1e-5 ? normalize(vv.xy) : vec2(1.0, 0.0);
          vec2 perp = vec2(-dir.y, dir.x);
          // Screen-up expressed in that frame, so fire can lick upward on any camera.
          vUp = normalize(vec2(dot(vec2(0.0, 1.0), dir), dot(vec2(0.0, 1.0), perp)) + vec2(1e-5));
          vQuad = position.xy;
          vec2 q = dir * (position.x * (1.0 + uStretch)) + perp * position.y;
          mv.xy += q * uRadius * 2.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uCore;
        uniform vec3 uHalo;
        uniform float uAlpha;
        uniform float uTime;
        uniform float uSeed;
        uniform float uStrobe;
        uniform float uElem;
        uniform float uStretch;
        varying vec2 vQuad;
        varying vec2 vUp;

        // Value noise, hashed rather than sampled: the flame needs turbulence and this module ships
        // no textures.
        float hash21(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float vnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
                     mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
        }

        float fbm(vec2 p) {
          float v = 0.0;
          float amp = 0.5;
          for (int i = 0; i < 3; i++) {
            v += amp * vnoise(p);
            p *= 2.07;
            amp *= 0.5;
          }
          return v;
        }

        void main() {
          float len = length(vQuad);
          float r = len * 2.0;
          vec2 n = len > 1e-4 ? vQuad / len : vec2(0.0, 1.0);
          float angle = atan(vQuad.y, vQuad.x);
          float phase = uSeed * 6.2831853;
          vec3 tone;
          float a;

          if (uElem < 0.5) {
            // ---- WIND: nearly transparent, cut into slashes across the direction of travel ----
            if (r > 1.0) discard;
            float across = vQuad.y * 2.0;
            float slash = pow(abs(sin(across * 8.0 + uTime * 5.0 + phase)), 5.0);
            float edge = clamp(1.0 - r, 0.0, 1.0);
            a = pow(edge, 1.5) * 0.22 + slash * pow(edge, 1.8) * 0.62;
            tone = mix(uHalo, uCore, slash);
          } else if (uElem < 1.5) {
            // ---- FIRE: a comet, not a bonfire ----
            // The previous version licked toward SCREEN-UP, which is right for a flame sitting on
            // something and wrong for one in flight. A fireball's tail streams BACKWARD ALONG ITS
            // TRAVEL: a bright round head at the leading edge, then a tapering tail that splits into
            // pointed tongues. The quad's local x already is the direction of travel, so that frame
            // needs no extra work here.
            float fwd = vQuad.x * 2.0;      // +1 leading edge, -1 trailing
            float side = vQuad.y * 2.0;

            float headX = 0.42;
            float headR = 0.40;

            // Tail parameter, 0 at the head and 1 at the tip, with a slow lateral wave so the tail
            // whips instead of pointing dead straight.
            float u = clamp((headX - fwd) / 1.42, 0.0, 1.0);
            float sc = side - 0.17 * sin(u * 4.2 + uTime * 3.6 + phase) * u;

            // Head, kept circular ON SCREEN by undoing the along-travel stretch.
            float headD = length(vec2((fwd - headX) * (1.0 + uStretch) / headR, sc / headR));

            // Tongues. Subtracting a threshold from the noise is what opens gaps between the
            // fingers, and raising the remainder to a power sharpens them to points.
            // ANISOTROPIC on purpose: high frequency ACROSS the tail, low frequency ALONG it, so the
            // noise forms long thin strands instead of round blobs. A higher threshold opens real
            // gaps between them and the power sharpens each one to a point -- at 3.3 across and a
            // 0.26 threshold the fingers merged back into a single smooth band.
            // Balanced: 8.5 across with a 0.40 threshold and a 1.7 power starved the tail down to a
            // wire. Wider strands, a lower gate and a gentler taper keep the fan the reference has
            // while still separating the tongues.
            float turb = fbm(vec2(sc * 5.6, u * 1.4 + uTime * 2.4));
            float fingers = pow(max(0.0, turb - 0.30) / 0.70, 1.15);
            float halfW = headR * pow(1.0 - u, 0.42) * (0.30 + 1.85 * fingers);
            float tailD = fwd < headX ? abs(sc) / max(0.02, halfW) : 999.0;

            float inHead = 1.0 - smoothstep(0.84, 1.0, headD);
            float inTail = 1.0 - smoothstep(0.78, 1.0, tailD);
            float m = max(inHead, inTail);
            if (m <= 0.001) discard;

            // Hottest in the head, cooling down the length of the tail.
            float temp = clamp(pow(1.0 - min(headD, 1.0), 1.5) * 1.45
                             + inTail * (0.80 - 0.62 * u) * (1.0 - min(1.0, tailD)), 0.0, 1.0);

            vec3 soot = vec3(0.34, 0.03, 0.01);
            vec3 red = vec3(0.94, 0.14, 0.02);
            vec3 orange = vec3(1.00, 0.46, 0.04);
            vec3 yellow = vec3(1.00, 0.85, 0.24);
            vec3 white = vec3(1.00, 0.99, 0.92);
            tone = soot;
            tone = mix(tone, red, smoothstep(0.10, 0.20, temp));
            tone = mix(tone, orange, smoothstep(0.32, 0.44, temp));
            tone = mix(tone, yellow, smoothstep(0.58, 0.70, temp));
            tone = mix(tone, white, smoothstep(0.84, 0.94, temp));
            a = m * (0.38 + 0.80 * pow(temp, 1.6));
          } else if (uElem < 2.5) {
            // ---- WATER ----
            // Same lesson as fire: a smoothly lit sphere is correct and dull. Water gets its
            // crispness from a THIN HARD RIM and from CAUSTIC FILAMENTS -- curved bright strands of
            // refracted light turning inside the body -- plus a silhouette that bulges rather than
            // staying a clean ellipse, because a falling blob of water is never a sphere.
            vec2 rightW = vec2(-vUp.y, vUp.x);
            vec2 e = vec2(dot(vQuad, rightW), dot(vQuad, vUp)) * 2.0;
            float bump = 0.075 * sin(angle * 3.0 + uTime * 2.3 + phase)
                       + 0.042 * sin(angle * 5.0 - uTime * 1.8);
            // Divided by 0.86 as well: the bulge peaks at 1.117, and without that headroom a positive
            // bulge would push the silhouette past the inscribed disc and be cut flat by the quad.
            float rr = length(e) / (0.86 * (1.0 + bump));
            if (rr > 1.0) discard;

            float nz = sqrt(max(0.0, 1.0 - rr * rr));
            vec3 N = vec3(length(e) > 1e-4 ? e / length(e) * rr : vec2(0.0), nz);

            // A thin, hard rim rather than a soft fresnel ramp.
            float rim = smoothstep(0.74, 0.99, rr) * pow(rr, 2.6);
            // Caustics: strands that curve with depth and rotate, so the interior has motion.
            float swirl = angle + 1.75 * rr - uTime * 1.15 + phase;
            float fil = pow(abs(sin(swirl * 3.0)), 9.0) * (1.0 - rr) * 1.35;
            float fil2 = pow(abs(sin(swirl * 5.0 + 1.7)), 12.0) * (1.0 - rr) * 0.85;
            float spec = pow(max(0.0, dot(N, normalize(vec3(-0.42, 0.72, 0.80)))), 58.0);
            float body = pow(nz, 1.7);

            vec3 deep = vec3(0.015, 0.11, 0.34);
            vec3 midBlue = vec3(0.09, 0.47, 0.86);
            vec3 crest = vec3(0.66, 0.95, 1.00);
            tone = mix(deep, midBlue, clamp(body * 0.75 + rim * 0.45, 0.0, 1.0));
            tone = mix(tone, crest, clamp(rim * 0.95 + fil + fil2, 0.0, 1.0));
            tone = mix(tone, vec3(1.0), clamp(spec, 0.0, 1.0));
            // Coverage, not emission: water occludes, so it draws with normal blending.
            a = clamp(body * 0.52 + rim * 0.95 + (fil + fil2) * 0.75 + spec, 0.0, 1.0);
          } else {
            // ---- THUNDER: a hard little core throwing radial arcs, strobing fast ----
            float arcs = pow(abs(sin(angle * 5.0 + uTime * 34.0 + phase)), 7.0);
            float reach = 0.40 + 0.60 * arcs;
            float edge = clamp(1.0 - r / reach, 0.0, 1.0);
            float core = pow(clamp(1.0 - r / 0.46, 0.0, 1.0), 1.9);
            if (edge <= 0.0 && core <= 0.0) discard;
            tone = mix(uHalo, uCore, clamp(core * 1.4, 0.0, 1.0));
            a = core * 1.25 + pow(edge, 1.3) * 0.62;
          }

          float flick = 1.0 - uStrobe * 0.5 * (1.0 - sin(uTime * (uStrobe > 0.6 ? 95.0 : 24.0)));
          gl_FragColor = vec4(tone, a * uAlpha * flick);
        }`,
    });
    const mesh = new THREE.Mesh(orbGeometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    mesh.visible = false;
    group.add(mesh);
    projectiles.push({ mesh, material, velocity: new THREE.Vector3(), life: 1, span: 1,
      key: 'wind', force: 1, shedDebt: 0, residueDebt: 0 });
  }

  /** A short backward puff, so the orb leaves a wake without paying for a full jet each frame. */
  function shedWisps(at: THREE.Vector3, back: THREE.Vector3, key: VfxElementKey, count: number): void {
    if (count <= 0) return;
    const spawn = ELEMENT_SPAWN[key];
    axisU.set(0, 1, 0);
    if (Math.abs(back.dot(axisU)) > 0.9) axisU.set(1, 0, 0);
    axisU.crossVectors(back, axisU).normalize();
    axisV.crossVectors(back, axisU).normalize();
    for (let i = 0; i < count; i += 1) {
      const index = wispCursor;
      wispCursor = (wispCursor + 1) % WISP_COUNT;
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 0.03;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      wispOrigin[index * 3] = at.x + (axisU.x * cos + axisV.x * sin) * radius;
      wispOrigin[index * 3 + 1] = at.y + (axisU.y * cos + axisV.y * sin) * radius;
      wispOrigin[index * 3 + 2] = at.z + (axisU.z * cos + axisV.z * sin) * radius;
      const vb = 0.35 + Math.random() * 0.7;
      const vs = 0.12 + Math.random() * 0.22;
      wispVel[index * 3] = back.x * vb + (axisU.x * cos + axisV.x * sin) * vs;
      wispVel[index * 3 + 1] = back.y * vb + (axisU.y * cos + axisV.y * sin) * vs;
      wispVel[index * 3 + 2] = back.z * vb + (axisU.z * cos + axisV.z * sin) * vs;
      for (let k = 0; k < 3; k += 1) {
        wispAxisU[index * 3 + k] = axisU.getComponent(k);
        wispAxisV[index * 3 + k] = axisV.getComponent(k);
      }
      wispSeed[index] = Math.random();
      wispStart[index] = clock;
      wispSpan[index] = spawn.spanBase * 0.7 + Math.random() * spawn.spanJitter;
      wispSize[index] = spawn.size * (0.5 + Math.random() * 0.6);
      wispElem[index] = ELEMENT_ID[key];
    }
    for (const attr of Object.values(wispAttrs)) attr.needsUpdate = true;
  }

  /**
   * Smoke, steam, dust or haze left along the orb's path -- whichever the element leaves behind.
   *
   * Point spawned rather than path spawned, because the orb's route is only known one frame at a
   * time. Slower and much larger than the wisps: residue lingers where the wake has already gone.
   */
  function spawnResidueAt(at: THREE.Vector3, back: THREE.Vector3, key: VfxElementKey, count: number): void {
    if (count <= 0) return;
    axisU.set(0, 1, 0);
    if (Math.abs(back.dot(axisU)) > 0.9) axisU.set(1, 0, 0);
    axisU.crossVectors(back, axisU).normalize();
    axisV.crossVectors(back, axisU).normalize();
    const steam = key === 'water';
    for (let i = 0; i < count; i += 1) {
      const index = smokeCursor;
      smokeCursor = (smokeCursor + 1) % SMOKE_COUNT;
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 0.045;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      smokeOrigin[index * 3] = at.x + (axisU.x * cos + axisV.x * sin) * radius;
      smokeOrigin[index * 3 + 1] = at.y + (axisU.y * cos + axisV.y * sin) * radius;
      smokeOrigin[index * 3 + 2] = at.z + (axisU.z * cos + axisV.z * sin) * radius;
      const vb = 0.12 + Math.random() * 0.3;
      const vs = 0.05 + Math.random() * 0.12;
      smokeVel[index * 3] = back.x * vb + (axisU.x * cos + axisV.x * sin) * vs;
      smokeVel[index * 3 + 1] = back.y * vb + (axisU.y * cos + axisV.y * sin) * vs;
      smokeVel[index * 3 + 2] = back.z * vb + (axisU.z * cos + axisV.z * sin) * vs;
      for (let k = 0; k < 3; k += 1) {
        smokeAxisU[index * 3 + k] = axisU.getComponent(k);
        smokeAxisV[index * 3 + k] = axisV.getComponent(k);
      }
      smokeSeed[index] = Math.random();
      smokeStart[index] = clock + Math.random() * 0.05;
      // Steam boils away faster than smoke does.
      smokeSpan[index] = (steam ? 0.85 : 1.35) + Math.random() * (steam ? 0.5 : 0.9);
      smokeSize[index] = (steam ? 0.062 : 0.078) * (0.7 + Math.random() * 0.8);
      smokeElem[index] = ELEMENT_ID[key];
    }
    for (const attr of Object.values(smokeAttrs)) attr.needsUpdate = true;
  }

  function launchProjectile(at: THREE.Vector3, along: THREE.Vector3, force: number): void {
    const spawn = ELEMENT_PROJECTILE[element];
    const slot = projectiles.find((candidate) => candidate.life >= 1) ?? projectiles[0];
    slot.mesh.position.copy(at).addScaledVector(along, spawn.radius * 0.8);
    slot.velocity.copy(along).multiplyScalar(spawn.speed * force);
    slot.life = 0;
    slot.span = spawn.life;
    slot.key = element;
    slot.force = force;
    slot.shedDebt = 0;
    slot.residueDebt = 0;
    slot.material.uniforms.uRadius.value = spawn.radius * force;
    (slot.material.uniforms.uCore.value as THREE.Color).copy(spawn.core);
    (slot.material.uniforms.uHalo.value as THREE.Color).copy(spawn.halo);
    slot.material.uniforms.uStrobe.value = spawn.strobe;
    slot.material.uniforms.uSeed.value = Math.random();
    slot.material.uniforms.uElem.value = ELEMENT_ID[element];
    slot.material.uniforms.uStretch.value = spawn.stretch;
    /**
     * Water is the one element that must OBSCURE rather than add. Additive blending can only
     * brighten, so an additive water sphere is a blue glow you can read the character's belt through;
     * a real body of water refracts and is darker than what is behind it in places. Normal blending
     * is what lets it have a surface. The other three are emissive and stay additive.
     */
    slot.material.blending = element === 'water' ? THREE.NormalBlending : THREE.AdditiveBlending;
    slot.material.needsUpdate = true;
    (slot.material.uniforms.uVel.value as THREE.Vector3).copy(slot.velocity);
    slot.mesh.visible = true;
    // Thunder cracks as it leaves the hand rather than simply appearing.
    if (element === 'thunder') {
      spawnRing(slot.mesh.position, along, spawn.core, 0.02, 0.16 * force, 0.16, 0.7 * force, spark);
      spawnEmbers(slot.mesh.position, along, 'punch', Math.round(14 * force) + 6, 1.6 * force);
    }
  }

  // ------------------------------------------------------------------ flare and air rings
  /**
   * A soft gradient plane, not a hard `RingGeometry` annulus. The annulus scaled its own line weight
   * with the burst, so a wide air ring became a thick grey donut that read as page furniture rather
   * than as light.
   */
  const ringTexture = makeRingTexture();
  const ringGeometry = new THREE.PlaneGeometry(1, 1);
  interface Ring { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; life: number; span: number; from: number; to: number; peak: number; }
  const rings: Ring[] = [];
  for (let i = 0; i < RING_POOL; i += 1) {
    const material = new THREE.MeshBasicMaterial({
      map: ringTexture,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(ringGeometry, material);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    group.add(mesh);
    rings.push({ mesh, material, life: 1, span: 1, from: 0, to: 1, peak: 0 });
  }

  /**
   * `aim` is separate from `scratch` on purpose. This used to compute the look-at target as
   * `scratch.copy(at).add(face)`, and every caller passes `scratch` AS `at` -- so the copy was a
   * no-op and the add mutated the caller's own position vector. The first ring landed correctly, then
   * every later ring and ember in the same burst was displaced by one unit direction vector, which on
   * a 1.0-tall figure is a full body height. It showed up as an air ring floating past the shoulder.
   */
  function spawnRing(at: THREE.Vector3, face: THREE.Vector3, colour: THREE.Color, from: number, to: number, span: number, peak: number, map: THREE.Texture = ringTexture): void {
    const ring = rings.find((candidate) => candidate.life >= 1) ?? rings[0];
    ring.material.map = map;
    ring.material.needsUpdate = true;
    ring.mesh.position.copy(at);
    if (face.lengthSq() > 1e-8) ring.mesh.lookAt(aim.copy(at).add(face));
    ring.material.color.copy(colour);
    ring.life = 0;
    ring.span = span;
    ring.from = from;
    ring.to = to;
    ring.peak = peak;
    ring.mesh.visible = true;
  }

  function spawnEmbers(at: THREE.Vector3, along: THREE.Vector3, kind: StrikeKind, count: number, speed: number): void {
    const tint = kind === 'footfall' ? 0 : 1;
    for (let i = 0; i < count; i += 1) {
      const index = emberCursor;
      emberCursor = (emberCursor + 1) % EMBER_COUNT;
      emberPos[index * 3] = at.x;
      emberPos[index * 3 + 1] = at.y;
      emberPos[index * 3 + 2] = at.z;
      // A cone about the strike direction, plus buoyancy for heat and a flat spray for dust.
      const spread = kind === 'footfall' ? 1.5 : 0.9;
      const lift = kind === 'footfall' ? 0.18 : 0.55;
      emberVel[index * 3] = along.x * speed + (Math.random() - 0.5) * spread;
      emberVel[index * 3 + 1] = along.y * speed + Math.random() * lift + 0.1;
      emberVel[index * 3 + 2] = along.z * speed + (Math.random() - 0.5) * spread;
      emberLife[index] = 0;
      emberSpan[index] = kind === 'footfall' ? 0.5 + Math.random() * 0.35 : 0.42 + Math.random() * 0.3;
      emberSize[index] = (kind === 'footfall' ? 0.009 : 0.012) * (0.6 + Math.random() * 0.9);
      emberTint[index] = tint;
    }
  }

  function spawnFlash(at: THREE.Vector3, force: number): void {
    const spawn = ELEMENT_SPAWN[element];
    flash.position.copy(at);
    flash.color.copy(spawn.lightColour);
    flashPeak = spawn.lightPeak * force;
    flashSpan = spawn.lightSpan;
    flashFlicker = spawn.lightFlicker;
    flashLife = 0;
    flashClock = 0;
  }

  function burst(event: StrikeEvent, at: THREE.Vector3, along: THREE.Vector3, ribbon: Ribbon): void {
    const kind = event.kind;
    const palette = PALETTES[kind];
    // Scale with the measured hit: a 3.10 H/s strike should not look like a 1.16 H/s footfall.
    const force = THREE.MathUtils.clamp(event.speed / 3.1, 0.35, 1);
    spawnFlash(at, force);
    if (event.projectile) {
      /**
       * The orb leaves along the NET direction of the swept arc, not along the instantaneous swing.
       *
       * The wind tear is laid station by station down that arc, so its overall direction is the arc's
       * start-to-end vector. Launching the orb on a separately computed swing direction let the two
       * disagree, and a fireball flying off at an angle to its own slash reads as two unrelated
       * effects. Both now follow the same line.
       */
      const lead = Math.min(11, Math.max(1, ribbon.filled - 1));
      tearDir.copy(ribbon.history[0]).sub(ribbon.history[lead]);
      if (tearDir.lengthSq() < 1e-8) tearDir.copy(along);
      tearDir.normalize();
      launchProjectile(at, tearDir, force);
    }
    if (kind === 'punch') {
      // Wind first, heat second. The tear outruns the flare, which is what makes it read as the air
      // being cut open ahead of the fist rather than as a second explosion.
      spawnWindSweep(ribbon.history, ribbon.filled, force);
      if (element === 'fire') spawnSmoke(ribbon.history, ribbon.filled, force);
      // A soft glow, not a ring. The annulus texture has a hole in the middle, which is exactly what
      // made it read as drawn geometry sitting on the fist; the spark gradient is solid and reads as
      // light instead.
      spawnRing(at, along, ELEMENT_SPAWN[element].glow, 0.02, 0.17 * force, 0.22, ELEMENT_SPAWN[element].glowPeak * force, spark);
      spawnEmbers(at, along, kind, Math.round(20 * force) + 8, 1.15 * force);
    } else if (kind === 'impact') {
      // Hand strikes get the same swept wind; only the heat differs.
      spawnWindSweep(ribbon.history, ribbon.filled, force * 0.8);
      if (element === 'fire') spawnSmoke(ribbon.history, ribbon.filled, force * 0.8);
      spawnRing(at, along, ELEMENT_SPAWN[element].glow, 0.02, 0.18 * force, 0.26, ELEMENT_SPAWN[element].glowPeak * 0.9 * force, spark);
      spawnEmbers(at, along, kind, Math.round(16 * force) + 6, 0.9 * force);
    } else {
      // A stomp displaces air from the point of contact outward and upward -- a point source, not a
      // swept arc -- so the footfall keeps the radial jet.
      spawnWindJet(at, up, force * 0.7);
      spawnRing(at, up, palette.hot, 0.03, 0.26 * force, 0.46, FLARE_PEAK_ALPHA * 0.5 * force);
      spawnEmbers(at, up, kind, Math.round(10 * force) + 4, 0.28 * force);
    }
  }

  // ------------------------------------------------------------------ per-frame
  let activeClip: string | null = null;
  let armed: boolean[] = [];
  let lastTime = 0;

  function resetArming(clip: string | null): void {
    activeClip = clip;
    armed = clip ? strikesForClip(clip).map(() => false) : [];
    lastTime = 0;
    for (const ribbon of ribbons.values()) {
      ribbon.filled = 0;
      ribbon.level = 0;
      ribbon.mesh.visible = false;
    }
  }

  /**
   * Where a limb's effects belong: the FIST, not the wrist.
   *
   * The hand joints sit at the wrist, so reading their world position alone put every trail, sweep and
   * burst a fist's width behind the strike. The tip is the joint carried on along the forearm axis by
   * `HAND_TIP_FOREARM_FRACTION` of that forearm's current length, so it follows the pose and needs no
   * per-frame vertex work. Feet are read at the joint, which is already at the contact end.
   */
  function limbWorld(limb: StrikeLimb, out: THREE.Vector3): boolean {
    const node = nodes.get(STRIKE_LIMBS[limb]);
    if (!node) return false;
    node.getWorldPosition(out);
    if (!limb.startsWith('hand')) return true;
    const parent = node.parent;
    if (!parent) return true;
    parent.getWorldPosition(previous);
    tangent.copy(out).sub(previous);
    const forearm = tangent.length();
    if (forearm < 1e-6) return true;
    out.addScaledVector(tangent.divideScalar(forearm), forearm * HAND_TIP_FOREARM_FRACTION);
    return true;
  }

  return {
    group,

    update(delta, clip, time, looped): void {
      if (delta <= 0) delta = 1 / 60;
      clock += delta;
      wispMaterial.uniforms.uTime.value = clock;
      smokeMaterial.uniforms.uTime.value = clock;
      if (clip !== activeClip || looped) resetArming(clip);

      // ---- trails ----
      const reference = clip ? (CLIP_TRAIL_REFERENCE[clip] ?? 2.5) : 0;
      for (const [limb, ribbon] of ribbons) {
        if (!clip || !limbWorld(limb, scratch)) {
          ribbon.level = Math.max(0, ribbon.level - delta * 4);
          if (ribbon.level <= 0.001) ribbon.mesh.visible = false;
          continue;
        }
        const head = ribbon.history[0];
        let speed = 0;
        if (ribbon.filled > 0) speed = scratch.distanceTo(head) / delta;
        // Shift the ring buffer by one and write the new head.
        for (let i = ribbon.history.length - 1; i > 0; i -= 1) ribbon.history[i].copy(ribbon.history[i - 1]);
        head.copy(scratch);
        ribbon.filled = Math.min(ribbon.filled + 1, TRAIL_SAMPLES);

        const normalised = reference > 0 ? speed / reference : 0;
        const target = normalised <= TRAIL_GATE
          ? 0
          : THREE.MathUtils.clamp((normalised - TRAIL_GATE) / (1 - TRAIL_GATE), 0, 1);
        // Ease so a single fast frame cannot flash the ribbon on and off.
        ribbon.level += (target - ribbon.level) * Math.min(1, delta * 12);
        if (ribbon.level <= 0.004 || ribbon.filled < 4) {
          ribbon.mesh.visible = false;
          continue;
        }
        ribbon.mesh.visible = true;

        const width = 0.008 + 0.03 * ribbon.level;
        for (let i = 0; i < TRAIL_SAMPLES; i += 1) {
          const clamped = Math.min(i, ribbon.filled - 1);
          const point = ribbon.history[clamped];
          const ahead = ribbon.history[Math.max(0, clamped - 1)];
          direction.copy(point).sub(ahead);
          if (direction.lengthSq() < 1e-10) direction.set(0, 0, 1);
          side.crossVectors(direction, up);
          if (side.lengthSq() < 1e-10) side.set(1, 0, 0);
          side.normalize().multiplyScalar(width * (1 - i / TRAIL_SAMPLES));
          const taper = (1 - i / TRAIL_SAMPLES) ** 1.6 * ribbon.level;
          ribbon.position.setXYZ(i * 2, point.x + side.x, point.y + side.y, point.z + side.z);
          ribbon.position.setXYZ(i * 2 + 1, point.x - side.x, point.y - side.y, point.z - side.z);
          ribbon.strength.setX(i * 2, taper);
          ribbon.strength.setX(i * 2 + 1, taper);
        }
        ribbon.position.needsUpdate = true;
        ribbon.strength.needsUpdate = true;
      }

      // ---- discrete bursts ----
      if (clip) {
        const events = strikesForClip(clip);
        for (let i = 0; i < events.length; i += 1) {
          if (armed[i]) continue;
          const event = events[i];
          if (time < event.time || lastTime > event.time + 0.25) continue;
          if (!limbWorld(event.limb, scratch)) continue;
          const ribbon = ribbons.get(event.limb)!;
          /**
           * The direction of the SWING, taken from before the halt.
           *
           * This used to be `current - 3 frames ago`, which is the velocity AT the impact -- and a
           * strike is detected precisely because the limb stops there, so that vector is the
           * rebound, not the blow. Measured against the swing that led in, it pointed 136.8 deg and
           * 135.6 deg away on the two punches, 71.7 deg on `strike-short`: the wind was being blown
           * backwards out of the fist. Sampling frames 4 to 11 back reads the travel instead.
           */
          const near = Math.min(4, Math.max(1, ribbon.filled - 2));
          const far = Math.min(11, Math.max(near + 1, ribbon.filled - 1));
          direction.copy(ribbon.history[near]).sub(ribbon.history[far]);
          if (direction.lengthSq() < 1e-8) {
            const hip = nodes.get(STRIKE_HIP_NODE);
            if (hip) direction.copy(scratch).sub(hip.getWorldPosition(previous));
          }
          if (direction.lengthSq() < 1e-8) direction.set(0, 0, 1);
          direction.normalize();
          burst(event, scratch, direction, ribbon);
          armed[i] = true;
        }
        lastTime = time;
      }

      // ---- integrate embers ----
      let anyEmber = false;
      for (let i = 0; i < EMBER_COUNT; i += 1) {
        if (emberLife[i] >= 1) continue;
        anyEmber = true;
        emberLife[i] = Math.min(1, emberLife[i] + delta / emberSpan[i]);
        emberVel[i * 3 + 1] -= delta * 1.6;             // gravity
        const drag = 1 - Math.min(0.6, delta * 2.2);
        emberVel[i * 3] *= drag;
        emberVel[i * 3 + 1] *= drag;
        emberVel[i * 3 + 2] *= drag;
        emberPos[i * 3] += emberVel[i * 3] * delta;
        emberPos[i * 3 + 1] += emberVel[i * 3 + 1] * delta;
        emberPos[i * 3 + 2] += emberVel[i * 3 + 2] * delta;
      }
      embers.visible = anyEmber;
      if (anyEmber) {
        emberPosAttr.needsUpdate = true;
        emberLifeAttr.needsUpdate = true;
        emberSizeAttr.needsUpdate = true;
        emberTintAttr.needsUpdate = true;
      }

      // ---- integrate projectiles ----
      let orbLit = 0;
      for (const shot of projectiles) {
        if (shot.life >= 1) { if (shot.mesh.visible) shot.mesh.visible = false; continue; }
        const cfg = ELEMENT_PROJECTILE[shot.key];
        shot.life = Math.min(1, shot.life + delta / shot.span);

        // Exponential drag and gravity, integrated on the CPU because the orb has to be somewhere
        // the trail and its light can be attached to; a shader-only position could not be read back.
        shot.velocity.multiplyScalar(Math.exp(-delta / cfg.drag));
        shot.velocity.y += cfg.gravity * delta;
        shot.mesh.position.addScaledVector(shot.velocity, delta);

        const u = shot.life;
        shot.material.uniforms.uTime.value = clock;
        shot.material.uniforms.uRadius.value = cfg.radius * shot.force * (1 + 0.4 * u);
        // The billboard's frame follows the CURRENT velocity, so slashes and flame tongues keep
        // pointing the right way as drag and gravity bend the path.
        (shot.material.uniforms.uVel.value as THREE.Vector3).copy(shot.velocity);
        // Elongation tracks remaining speed: a slash that has slowed down should round out.
        const speedNow = shot.velocity.length();
        shot.material.uniforms.uStretch.value = cfg.stretch
          * THREE.MathUtils.clamp(speedNow / (cfg.speed * shot.force), 0, 1);
        // Holds its brightness, then collapses over the last quarter.
        // Water holds full brightness and then bursts; the others taper off.
        const fade = Math.max(0.01, cfg.fadeTail);
        shot.material.uniforms.uAlpha.value = cfg.alpha
          * (1 - Math.max(0, (u - (1 - fade)) / fade) ** 1.4);

        // Wake, paid for in whole wisps so the rate is frame-rate independent.
        shot.shedDebt += cfg.shed * delta * shot.force;
        const shedNow = Math.floor(shot.shedDebt);
        if (shedNow > 0) {
          shot.shedDebt -= shedNow;
          aim.copy(shot.velocity);
          if (aim.lengthSq() > 1e-8) aim.normalize().negate();
          else aim.set(0, -1, 0);
          shedWisps(shot.mesh.position, aim, shot.key, Math.min(shedNow, 10));

          shot.residueDebt += cfg.residue * delta * shot.force * 12;
          const residueNow = Math.floor(shot.residueDebt / 12);
          if (residueNow > 0) {
            shot.residueDebt -= residueNow * 12;
            spawnResidueAt(shot.mesh.position, aim, shot.key, Math.min(residueNow, 5));
          }

          if (shot.key === 'fire') {
            // Rising vapour. A fireball does not only leave a wake behind it, it boils upward, and
            // the fire element's own buoyancy carries these wisps up once they are released.
            up.set(0, 1, 0);
            shedWisps(shot.mesh.position, up, 'fire', Math.max(1, Math.round(shedNow * 0.45)));
          } else if (shot.key === 'wind') {
            // Torn air AHEAD of the orb, not just a wake: wisps launched along the travel direction
            // stretch into slashes in front of it, because a wisp is drawn along its own velocity.
            aim.negate();
            shedWisps(shot.mesh.position, aim, 'wind', Math.max(1, Math.round(shedNow * 0.5)));
          }
        }

        const lit = cfg.lightPeak * shot.force * (1 - u) ** 1.3;
        if (lit > orbLit) {
          orbLit = lit;
          orbLight.position.copy(shot.mesh.position);
          orbLight.color.copy(cfg.core);
        }

        if (shot.life >= 1) {
          aim.copy(shot.velocity);
          if (aim.lengthSq() > 1e-8) aim.normalize(); else aim.set(0, 0, 1);
          const spawn = ELEMENT_SPAWN[shot.key];
          if (shot.key === 'water') {
            /**
             * Water bursts; it does not fade.
             *
             * `spawnWindJet` is reused here rather than the small backward puff: it seeds a ring of
             * wisps perpendicular to the travel plus a forward cone, which is exactly the shape of a
             * splash, and because the wisps carry the water element they inherit its gravity and
             * ARC BACK DOWN as droplets instead of drifting away. Two rings give the spray a
             * leading front and a slower shell behind it, and the steam is thrown upward.
             */
            spawnRing(shot.mesh.position, aim, cfg.core, 0.03, 0.66 * shot.force, 0.40,
              spawn.glowPeak * 1.35 * shot.force, spark);
            spawnRing(shot.mesh.position, aim, cfg.halo, 0.02, 0.38 * shot.force, 0.30,
              spawn.glowPeak * 0.9 * shot.force, ringTexture);
            spawnWindJet(shot.mesh.position, aim, shot.force * 1.7);
            spawnResidueAt(shot.mesh.position, up.set(0, 1, 0), 'water', 24);
            spawnEmbers(shot.mesh.position, aim, 'footfall', Math.round(34 * shot.force) + 14,
              1.5 * shot.force);
            spawnFlash(shot.mesh.position, shot.force * 1.25);
          } else {
            spawnRing(shot.mesh.position, aim, cfg.core, 0.02, 0.30 * shot.force, 0.34,
              spawn.glowPeak * 0.9 * shot.force, spark);
            spawnEmbers(shot.mesh.position, aim, 'punch', Math.round(22 * shot.force) + 8,
              1.1 * shot.force);
            shedWisps(shot.mesh.position, aim, shot.key, 14);
          }
          shot.mesh.visible = false;
        }
      }
      orbLight.intensity = orbLit;

      // ---- integrate the flash ----
      if (flashLife < 1) {
        flashLife = Math.min(1, flashLife + delta / flashSpan);
        flashClock += delta;
        // Firelight is never steady, and lightning strobes. A flat ramp reads as a lamp.
        const wobble = flashFlicker > 0
          ? 1 - flashFlicker * 0.5 * (1 - Math.sin(flashClock * (flashFlicker > 0.6 ? 120 : 34)))
          : 1;
        flash.intensity = flashPeak * (1 - flashLife) ** 2.2 * wobble;
      } else if (flash.intensity !== 0) {
        flash.intensity = 0;
      }

      // ---- integrate rings ----
      for (const ring of rings) {
        if (ring.life >= 1) { ring.mesh.visible = false; continue; }
        ring.life = Math.min(1, ring.life + delta / ring.span);
        const eased = 1 - (1 - ring.life) ** 2;
        const radius = THREE.MathUtils.lerp(ring.from, ring.to, eased);
        ring.mesh.scale.setScalar(Math.max(0.001, radius * 2));
        ring.material.opacity = ring.peak * (1 - ring.life) ** 1.4;
        ring.mesh.visible = ring.material.opacity > 0.002;
      }
    },

    setElement(key: VfxElementKey): void {
      element = key;
      // Embers follow the element too, or a water strike throws orange sparks.
      const spawn = ELEMENT_SPAWN[key];
      emberMaterial.uniforms.uHotImpact.value = spawn.glow;
      emberMaterial.uniforms.uCoolImpact.value = spawn.ember;
      // Hands only. Feet keep the dust palette, because a footfall is not the element.
      for (const [limb, ribbon] of ribbons) {
        if (!limb.startsWith('hand')) continue;
        const material = ribbon.mesh.material as THREE.ShaderMaterial;
        (material.uniforms.uColor.value as THREE.Color).copy(spawn.trail);
      }
    },

    get element(): VfxElementKey { return element; },

    dispose(): void {
      for (const ribbon of ribbons.values()) {
        ribbon.geometry.dispose();
        (ribbon.mesh.material as THREE.Material).dispose();
      }
      emberGeometry.dispose();
      emberMaterial.dispose();
      ringGeometry.dispose();
      wispGeometry.dispose();
      wispMaterial.dispose();
      smokeGeometry.dispose();
      smokeMaterial.dispose();
      ringTexture.dispose();
      for (const ring of rings) ring.material.dispose();
      trailMaterial.dispose();
      spark.dispose();
      flash.dispose();
      orbLight.dispose();
      orbGeometry.dispose();
      for (const shot of projectiles) shot.material.dispose();
      group.removeFromParent();
    },
  };
}
