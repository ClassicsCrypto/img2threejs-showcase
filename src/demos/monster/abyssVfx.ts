import * as THREE from 'three';
import type { StrikeKind } from './strikeEvents';

/**
 * The abyss layer: what this thing does to the air around it, and what the air does when a claw
 * tears through it.
 *
 * THE BRIEF, and how each layer answers it. Two things were asked for — air being torn on an
 * attack, and matter drifting around the body so the figure reads as haunted rather than as a mesh
 * standing in a room. Everything here is one of those two, or the light that makes them land:
 *
 *   aura wisps     the continuous layer, and the one that does the haunting. 260 motes orbiting
 *                  eleven bone anchors, each on its own radius, phase and rate — but SMOOTHED
 *                  toward its anchor rather than pinned to it, so when the monster lunges the
 *                  cloud arrives late and strings out behind it. That lag is the whole trick: a
 *                  cloud that tracks the body exactly reads as a parented particle system, and a
 *                  cloud that lags reads as something the body is dragging with it.
 *   ash shed       dark, NON-additive puffs off the shoulders and hands. Additive smoke is fire;
 *                  smoke has to OCCLUDE to be smoke, so this is the one layer that darkens what is
 *                  behind it, and it is what keeps the violet from turning the whole figure into a
 *                  neon sign.
 *   wind tear      the attack. A crescent swept along the arc the claw ACTUALLY travelled — the
 *                  swing axis is taken from the pivot-to-contact radius crossed with the measured
 *                  travel, so the arc is the limb's own arc and not a decal thrown at the camera —
 *                  plus a shear cone behind the contact for the air being dragged along.
 *   void rings     the stop itself, expanding ALONG the strike axis. A ring that expands in the
 *                  screen plane reads as a magic circle; one that expands down the axis reads as
 *                  displaced air. Each ring carries a dark disc behind it, so the tear reads as a
 *                  hole opened in the air rather than as a glowing hoop.
 *   shards         quantised violet-to-crimson streaks thrown off the contact, stretched along
 *                  their own velocity in the shader so they read as motion and not as dots.
 *   ground miasma  a slow swirl on the floor under the figure, pulsing outward on every contact.
 *                  Without it the monster floats; with it the floor belongs to the monster.
 *   eyes           two ember points, flickering on a noise that has no period a viewer can learn,
 *                  flaring during a windup. The cheapest malice in the file.
 *   impact light   a real PointLight spiking for ~130 ms, which is what stops the effects looking
 *                  stuck ON the figure: the flare has to land on the shoulders and the ground.
 *
 * COLOUR. Bone-white core, amethyst body, crimson outer edge, near-black smoke — one hue plus one
 * accent, which is what keeps it eerie instead of festive. The crimson is reserved: eyes, the
 * dying edge of an impact, and nothing else.
 *
 * COST. Three pooled Points systems (320 shards, 200 ash, 260 aura) integrated on the CPU, 2 trail
 * ribbons, and 29 pooled meshes/sprites plus 3 pooled lights. Nothing is allocated after
 * construction, and every object starts invisible so the viewer's one-shot framing pass never
 * measures an effect instead of the monster.
 */

const SHARD_CAPACITY = 320;
const ASH_CAPACITY = 200;
const AURA_CAPACITY = 260;
const TRAIL_SAMPLES = 16;
const TRAIL_LANES = 3;

/** One hue and one accent. The crimson is an accent, not a second theme. */
const COLOURS = {
  bone: new THREE.Color(0xf4e9ff),
  amethyst: new THREE.Color(0x9a54ff),
  abyss: new THREE.Color(0x3a0c78),
  ember: new THREE.Color(0xff2f5e),
  ash: new THREE.Color(0x14101c),
};

/**
 * Per-strike shaping. The kinds differ in MOTION first: a rend is not a brighter swipe, it is two
 * crossed arcs and a wider cone, and a kick is blunt because a leg displaces air rather than
 * cutting it.
 */
const STRIKE_SHAPE: Record<StrikeKind, {
  /** Arc the crescent sweeps, in radians, and its band thickness as a fraction of the radius. */
  arcSpan: number; arcBand: number;
  /** A second crescent rolled across the first — the double-claw signature. */
  crossed: boolean;
  /** Shear cone behind the contact, in world units. */
  tearLength: number; tearRadius: number;
  ringCount: number; ringSpan: number;
  shards: number; ash: number;
  flash: number; light: number;
  /** Ground pulse radius in world units; 0 for strikes that put nothing through the floor. */
  ground: number;
  /** Seconds of hitstop. The single largest contributor to how hard a strike reads. */
  hitstop: number;
}> = {
  swipe: {
    arcSpan: 1.15, arcBand: 0.055, crossed: false,
    tearLength: 0.34, tearRadius: 0.075,
    ringCount: 1, ringSpan: 0.20,
    shards: 16, ash: 6, flash: 0.22, light: 6.0, ground: 0, hitstop: 0.050,
  },
  rip: {
    arcSpan: 1.45, arcBand: 0.070, crossed: false,
    tearLength: 0.52, tearRadius: 0.100,
    ringCount: 2, ringSpan: 0.28,
    shards: 26, ash: 9, flash: 0.30, light: 10.0, ground: 0.42, hitstop: 0.075,
  },
  rend: {
    arcSpan: 1.75, arcBand: 0.085, crossed: true,
    tearLength: 0.64, tearRadius: 0.135,
    ringCount: 2, ringSpan: 0.36,
    shards: 36, ash: 13, flash: 0.40, light: 16.0, ground: 0.72, hitstop: 0.095,
  },
  slam: {
    arcSpan: 1.30, arcBand: 0.080, crossed: false,
    tearLength: 0.40, tearRadius: 0.120,
    ringCount: 1, ringSpan: 0.26,
    shards: 22, ash: 15, flash: 0.30, light: 11.0, ground: 1.00, hitstop: 0.085,
  },
  kick: {
    arcSpan: 1.05, arcBand: 0.100, crossed: false,
    tearLength: 0.46, tearRadius: 0.150,
    ringCount: 1, ringSpan: 0.24,
    shards: 10, ash: 11, flash: 0.24, light: 8.0, ground: 0.62, hitstop: 0.070,
  },
};

type ShardKind = 'shard' | 'gather';
type AshKind = 'ash' | 'breath';

/** Shards fly out and die fast; gathered motes fly IN and stop. Both are the same pool. */
const SHARD_PHYSICS: Record<ShardKind, {
  gravity: number; drag: number; life: [number, number]; size: [number, number];
  stretch: number; tint: number;
}> = {
  shard: { gravity: 1.9, drag: 5.2, life: [0.18, 0.44], size: [0.010, 0.026], stretch: 0.85, tint: 1 },
  gather: { gravity: -0.4, drag: 3.6, life: [0.26, 0.46], size: [0.008, 0.017], stretch: 0.45, tint: 0 },
};

const ASH_PHYSICS: Record<AshKind, {
  gravity: number; drag: number; life: [number, number]; size: [number, number];
  growth: number; alpha: number; tint: number;
}> = {
  // Buoyant and slow. Negative gravity because this is smoke coming off a hot body.
  ash: { gravity: -0.34, drag: 2.6, life: [0.90, 1.80], size: [0.040, 0.100], growth: 2.6, alpha: 0.42, tint: 0 },
  breath: { gravity: -0.20, drag: 1.7, life: [1.20, 2.10], size: [0.035, 0.085], growth: 3.2, alpha: 0.30, tint: 1 },
};

const bufferSize = new THREE.Vector2();
/** Local axes the pooled meshes are built along; aimed with `setFromUnitVectors`, never allocated. */
const FORWARD = new THREE.Vector3(0, 0, 1);
const BACKWARD = new THREE.Vector3(0, 0, -1);

/** World-units-to-pixels for a point sprite one unit from the camera. */
function pixelScale(renderer: THREE.WebGLRenderer, camera: THREE.Camera): number {
  renderer.getDrawingBufferSize(bufferSize);
  const perspective = camera as THREE.PerspectiveCamera;
  if (!perspective.isPerspectiveCamera) return bufferSize.y;
  return bufferSize.y / (2 * Math.tan((perspective.fov * Math.PI) / 360));
}

function softTexture(coreBias: number): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(coreBias, 'rgba(255,255,255,0.70)');
  gradient.addColorStop(0.64, 'rgba(255,255,255,0.18)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A white core inside an amethyst skirt that dies crimson — the flash and the eyes ride this. */
function flareTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.13, 'rgba(244,233,255,0.92)');
  g.addColorStop(0.34, 'rgba(154,84,255,0.50)');
  g.addColorStop(0.62, 'rgba(255,47,94,0.16)');
  g.addColorStop(1, 'rgba(58,12,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

interface Pool<T> { items: T[]; cursor: number }

function nextFrom<T>(pool: Pool<T>): T {
  const item = pool.items[pool.cursor];
  pool.cursor = (pool.cursor + 1) % pool.items.length;
  return item;
}

/**
 * A unit-radius arc band whose span, radius and thickness are all UNIFORMS rather than baked
 * vertices: one geometry serves five strike kinds and can widen over its own life without a
 * buffer write. `aU` runs 0 at the trailing tip to 1 at the leading tip — the claw's contact — so
 * the shader knows which end is the edge and which end is the smear.
 */
function arcBandGeometry(segments: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const count = (segments + 1) * 2;
  const position = new Float32Array(count * 3);
  const u = new Float32Array(count);
  const v = new Float32Array(count);
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    u[i * 2] = t; v[i * 2] = 0;
    u[i * 2 + 1] = t; v[i * 2 + 1] = 1;
  }
  const index: number[] = [];
  for (let i = 0; i < segments; i += 1) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aU', new THREE.BufferAttribute(u, 1));
  geometry.setAttribute('aV', new THREE.BufferAttribute(v, 1));
  geometry.setIndex(index);
  // The vertex shader places every vertex, so the bounds a zeroed position buffer implies are wrong.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
  return geometry;
}

interface CrescentSlot {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  age: number;
  span: number;
  radius: number;
  /** Extra rotation about the swing axis over the crescent's life: the follow-through. */
  overshoot: number;
  axis: THREE.Vector3;
  pivot: THREE.Vector3;
  radial: THREE.Vector3;
}

interface TearSlot {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  age: number;
  span: number;
  length: number;
  radius: number;
  origin: THREE.Vector3;
  dir: THREE.Vector3;
}

interface RingSlot {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  age: number;
  span: number;
  from: number;
  to: number;
  along: number;
  dir: THREE.Vector3;
  origin: THREE.Vector3;
}

interface VoidSlot {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  age: number;
  span: number;
  radius: number;
}

interface SliverSlot {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  age: number;
  span: number;
  length: number;
  width: number;
  /** Roll about the travel axis, and how far out from it the sliver starts. */
  roll: number;
  radius: number;
  spread: number;
  origin: THREE.Vector3;
  dir: THREE.Vector3;
}

interface FlashSlot {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  age: number;
  span: number;
  scale: number;
}

interface PulseSlot {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  age: number;
  span: number;
  radius: number;
}

interface LightSlot {
  light: THREE.PointLight;
  age: number;
  span: number;
  peak: number;
}

interface Ribbon {
  mesh: THREE.Mesh;
  position: THREE.BufferAttribute;
  fade: THREE.BufferAttribute;
  history: THREE.Vector3[];
  filled: number;
  level: number;
}

export type Claw = 'clawL' | 'clawR';

export interface AbyssVfx {
  /** Add this under the model root; every child starts invisible. */
  readonly group: THREE.Group;
  /**
   * The drifting cloud. Called every frame with the CURRENT world position of each body anchor —
   * the same array object each time — and an intensity the caller raises when the monster is
   * winding up or attacking.
   */
  aura(anchors: readonly THREE.Vector3[], intensity: number, dt: number): void;
  /** Continuous claw rake. `strength` is 0-1, already gated against the clip's measured p95. */
  claw(claw: Claw, at: THREE.Vector3, strength: number): void;
  /** Windup: matter falling INTO a claw. Called every frame in the lead before a strike lands. */
  gather(claw: Claw, at: THREE.Vector3, amount: number): void;
  /**
   * A strike landing. `dir` is the measured travel, `pivot` the shoulder or hip the limb swung
   * about — the crescent is built from the pivot-to-contact radius, so it traces the arc the limb
   * actually travelled. Returns the hitstop in seconds.
   */
  strike(kind: StrikeKind, at: THREE.Vector3, dir: THREE.Vector3, pivot: THREE.Vector3, power: number): number;
  /** Weight arriving on the ground. `drop` is the measured descent in figure heights per second. */
  footfall(at: THREE.Vector3, drop: number): void;
  /** A blow the monster TAKES: ash thrown back off the body, no crescent, no tear. */
  stagger(at: THREE.Vector3, dir: THREE.Vector3, power: number): void;
  /** Where the floor swirl sits, and how hard. */
  miasma(centre: THREE.Vector3, intensity: number): void;
  /** The two ember points, and how hot they are burning this frame. */
  eyes(left: THREE.Vector3, right: THREE.Vector3, glow: number): void;
  /** One puff of the smoke the body sheds. Called at a rate the caller sets off its own motion. */
  shed(at: THREE.Vector3, drift: THREE.Vector3): void;
  /** One slow exhale from the head. */
  breathe(at: THREE.Vector3, forward: THREE.Vector3): void;
  /**
   * Live pool occupancy. Published because "is the effect actually on screen" is otherwise
   * unanswerable from outside: an unfired impact and a sub-pixel one look identical in a capture.
   */
  counts(): { shards: number; ash: number; aura: number; crescents: number; tears: number; rings: number };
  update(dt: number): void;
  dispose(): void;
}

export function createAbyssVfx(): AbyssVfx {
  const group = new THREE.Group();
  group.name = 'monster-abyss-vfx';
  // Keeps the effects out of the parts list, out of the explode layout and out of the framing pass.
  group.userData.isHighlight = true;

  const spark = softTexture(0.16);
  const puff = softTexture(0.46);
  const flare = flareTexture();

  const scratchA = new THREE.Vector3();
  const scratchB = new THREE.Vector3();
  const scratchC = new THREE.Vector3();
  const scratchD = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);
  const sideways = new THREE.Vector3(1, 0, 0);

  let clock = 0;

  // ------------------------------------------------------------------- shards: strike debris + windup
  const shard = {
    px: new Float32Array(SHARD_CAPACITY), py: new Float32Array(SHARD_CAPACITY), pz: new Float32Array(SHARD_CAPACITY),
    vx: new Float32Array(SHARD_CAPACITY), vy: new Float32Array(SHARD_CAPACITY), vz: new Float32Array(SHARD_CAPACITY),
    age: new Float32Array(SHARD_CAPACITY), span: new Float32Array(SHARD_CAPACITY),
    gravity: new Float32Array(SHARD_CAPACITY), drag: new Float32Array(SHARD_CAPACITY),
    cursor: 0,
  };
  shard.age.fill(1);
  shard.span.fill(1);

  const shardPosition = new Float32Array(SHARD_CAPACITY * 3);
  const shardLife = new Float32Array(SHARD_CAPACITY).fill(1);
  const shardSize = new Float32Array(SHARD_CAPACITY);
  const shardTint = new Float32Array(SHARD_CAPACITY);
  const shardVel = new Float32Array(SHARD_CAPACITY * 3);
  const shardStretch = new Float32Array(SHARD_CAPACITY);

  const shardGeometry = new THREE.BufferGeometry();
  const shardAttr = {
    position: new THREE.BufferAttribute(shardPosition, 3).setUsage(THREE.DynamicDrawUsage),
    life: new THREE.BufferAttribute(shardLife, 1).setUsage(THREE.DynamicDrawUsage),
    size: new THREE.BufferAttribute(shardSize, 1).setUsage(THREE.DynamicDrawUsage),
    tint: new THREE.BufferAttribute(shardTint, 1).setUsage(THREE.DynamicDrawUsage),
    vel: new THREE.BufferAttribute(shardVel, 3).setUsage(THREE.DynamicDrawUsage),
    stretch: new THREE.BufferAttribute(shardStretch, 1).setUsage(THREE.DynamicDrawUsage),
  };
  shardGeometry.setAttribute('position', shardAttr.position);
  shardGeometry.setAttribute('aLife', shardAttr.life);
  shardGeometry.setAttribute('aSize', shardAttr.size);
  shardGeometry.setAttribute('aTint', shardAttr.tint);
  shardGeometry.setAttribute('aVel', shardAttr.vel);
  shardGeometry.setAttribute('aStretch', shardAttr.stretch);

  /**
   * A point sprite cannot be rotated, so the velocity is projected into view space in the vertex
   * shader and handed down as a 2D direction; the fragment squashes `gl_PointCoord` across it and
   * stretches along it. That is what turns a round sprite into a streak pointing where the shard
   * is going, which is the difference between debris and confetti.
   */
  const shardMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uMap: { value: spark },
      uBone: { value: COLOURS.bone },
      uAmethyst: { value: COLOURS.amethyst },
      uEmber: { value: COLOURS.ember },
      uScale: { value: 340 },
    },
    vertexShader: `
      attribute float aLife;
      attribute float aSize;
      attribute float aTint;
      attribute vec3 aVel;
      attribute float aStretch;
      uniform float uScale;
      varying float vLife;
      varying float vTint;
      varying vec2 vDir;
      varying float vStretch;
      void main() {
        vLife = aLife;
        vTint = aTint;
        vStretch = aStretch;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 velView = (modelViewMatrix * vec4(aVel, 0.0)).xyz;
        float len = length(velView.xy);
        vDir = len > 1e-4 ? velView.xy / len : vec2(1.0, 0.0);
        gl_PointSize = aSize * uScale * (1.0 - aLife * 0.45) / max(0.001, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform vec3 uBone;
      uniform vec3 uAmethyst;
      uniform vec3 uEmber;
      varying float vLife;
      varying float vTint;
      varying vec2 vDir;
      varying float vStretch;
      void main() {
        if (vLife >= 1.0) discard;
        vec2 uv = gl_PointCoord - 0.5;
        vec2 axis = vec2(dot(uv, vDir), dot(uv, vec2(-vDir.y, vDir.x)));
        float k = 1.0 + vStretch * 2.4;
        uv = vec2(axis.x / k, axis.y * (1.0 + vStretch * 0.7));
        float mask = texture2D(uMap, uv + 0.5).a;
        // Debris starts bone-white, passes through amethyst and dies crimson; gathered matter
        // never goes crimson at all — it is being pulled in, not thrown off.
        vec3 hot = mix(mix(uBone, uAmethyst, smoothstep(0.0, 0.45, vLife)), uEmber, smoothstep(0.5, 1.0, vLife));
        vec3 cool = mix(uBone, uAmethyst, vLife);
        vec3 tone = mix(cool, hot, vTint);
        gl_FragColor = vec4(tone, mask * (1.0 - vLife) * (1.0 - vLife));
      }`,
  });

  const shardPoints = new THREE.Points(shardGeometry, shardMaterial);
  /**
   * gl_PointSize is in FRAMEBUFFER PIXELS, so the world-to-pixel factor has to come from the
   * projection: half the drawing-buffer height over tan(fov/2). Read per draw, so it survives a
   * resize, a device-pixel-ratio change and a change of lens.
   */
  shardPoints.onBeforeRender = (renderer, _scene, camera) => {
    shardMaterial.uniforms.uScale.value = pixelScale(renderer, camera);
  };
  shardPoints.frustumCulled = false;
  shardPoints.renderOrder = 6;
  shardPoints.userData.isHighlight = true;
  group.add(shardPoints);

  // ------------------------------------------------------------------------------ ash: shed + breath
  const ash = {
    px: new Float32Array(ASH_CAPACITY), py: new Float32Array(ASH_CAPACITY), pz: new Float32Array(ASH_CAPACITY),
    vx: new Float32Array(ASH_CAPACITY), vy: new Float32Array(ASH_CAPACITY), vz: new Float32Array(ASH_CAPACITY),
    age: new Float32Array(ASH_CAPACITY), span: new Float32Array(ASH_CAPACITY),
    gravity: new Float32Array(ASH_CAPACITY), drag: new Float32Array(ASH_CAPACITY),
    base: new Float32Array(ASH_CAPACITY), growth: new Float32Array(ASH_CAPACITY),
    cursor: 0,
  };
  ash.age.fill(1);
  ash.span.fill(1);

  const ashPosition = new Float32Array(ASH_CAPACITY * 3);
  const ashLife = new Float32Array(ASH_CAPACITY).fill(1);
  const ashSize = new Float32Array(ASH_CAPACITY);
  const ashAlpha = new Float32Array(ASH_CAPACITY);
  const ashTint = new Float32Array(ASH_CAPACITY);

  const ashGeometry = new THREE.BufferGeometry();
  const ashAttr = {
    position: new THREE.BufferAttribute(ashPosition, 3).setUsage(THREE.DynamicDrawUsage),
    life: new THREE.BufferAttribute(ashLife, 1).setUsage(THREE.DynamicDrawUsage),
    size: new THREE.BufferAttribute(ashSize, 1).setUsage(THREE.DynamicDrawUsage),
    alpha: new THREE.BufferAttribute(ashAlpha, 1).setUsage(THREE.DynamicDrawUsage),
    tint: new THREE.BufferAttribute(ashTint, 1).setUsage(THREE.DynamicDrawUsage),
  };
  ashGeometry.setAttribute('position', ashAttr.position);
  ashGeometry.setAttribute('aLife', ashAttr.life);
  ashGeometry.setAttribute('aSize', ashAttr.size);
  ashGeometry.setAttribute('aAlpha', ashAttr.alpha);
  ashGeometry.setAttribute('aTint', ashAttr.tint);

  /** NOT additive. This is the only layer that darkens, and it is the reason the violet reads. */
  const ashMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: {
      uMap: { value: puff },
      uAsh: { value: COLOURS.ash },
      uAbyss: { value: COLOURS.abyss },
      uScale: { value: 340 },
    },
    vertexShader: `
      attribute float aLife;
      attribute float aSize;
      attribute float aAlpha;
      attribute float aTint;
      uniform float uScale;
      varying float vLife;
      varying float vAlpha;
      varying float vTint;
      void main() {
        vLife = aLife;
        vAlpha = aAlpha;
        vTint = aTint;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale / max(0.001, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform vec3 uAsh;
      uniform vec3 uAbyss;
      varying float vLife;
      varying float vAlpha;
      varying float vTint;
      void main() {
        if (vLife >= 1.0) discard;
        float mask = texture2D(uMap, gl_PointCoord).a;
        // Smoke lit from inside by the aura: near-black, going very slightly violet as it thins.
        vec3 tone = mix(uAsh, uAbyss, vTint * 0.6 + vLife * 0.35);
        float fade = smoothstep(0.0, 0.22, 1.0 - vLife) * (1.0 - vLife);
        gl_FragColor = vec4(tone, mask * fade * vAlpha);
      }`,
  });

  const ashPoints = new THREE.Points(ashGeometry, ashMaterial);
  ashPoints.onBeforeRender = (renderer, _scene, camera) => {
    ashMaterial.uniforms.uScale.value = pixelScale(renderer, camera);
  };
  ashPoints.frustumCulled = false;
  ashPoints.renderOrder = 3;
  ashPoints.userData.isHighlight = true;
  group.add(ashPoints);

  // ------------------------------------------------------------------------ aura: the drifting cloud
  const aura = {
    anchor: new Int32Array(AURA_CAPACITY),
    /** Where this mote thinks its anchor is — chases the real one, which is what makes it lag. */
    sx: new Float32Array(AURA_CAPACITY), sy: new Float32Array(AURA_CAPACITY), sz: new Float32Array(AURA_CAPACITY),
    radius: new Float32Array(AURA_CAPACITY),
    angle: new Float32Array(AURA_CAPACITY),
    rate: new Float32Array(AURA_CAPACITY),
    lift: new Float32Array(AURA_CAPACITY),
    bob: new Float32Array(AURA_CAPACITY),
    lag: new Float32Array(AURA_CAPACITY),
    seed: new Float32Array(AURA_CAPACITY),
    primed: false,
  };
  const auraPosition = new Float32Array(AURA_CAPACITY * 3);
  const auraSize = new Float32Array(AURA_CAPACITY);
  const auraAlpha = new Float32Array(AURA_CAPACITY);
  const auraTint = new Float32Array(AURA_CAPACITY);
  for (let i = 0; i < AURA_CAPACITY; i += 1) {
    aura.radius[i] = 0.06 + Math.random() * 0.34;
    aura.angle[i] = Math.random() * Math.PI * 2;
    // Signed: half the cloud turns the other way, so it never reads as a single rotating ring.
    aura.rate[i] = (0.25 + Math.random() * 1.15) * (Math.random() < 0.5 ? -1 : 1);
    aura.lift[i] = (Math.random() - 0.35) * 0.30;
    aura.bob[i] = 0.02 + Math.random() * 0.09;
    // The spread of lag is the point: a tight mote hugs the bone, a loose one arrives half a second late.
    aura.lag[i] = 1.4 + Math.random() * 6.5;
    aura.seed[i] = Math.random() * 100;
    auraSize[i] = 0.013 + Math.random() * 0.038;
    auraTint[i] = Math.random() < 0.14 ? 1 : 0;
  }

  const auraGeometry = new THREE.BufferGeometry();
  const auraAttr = {
    position: new THREE.BufferAttribute(auraPosition, 3).setUsage(THREE.DynamicDrawUsage),
    size: new THREE.BufferAttribute(auraSize, 1),
    alpha: new THREE.BufferAttribute(auraAlpha, 1).setUsage(THREE.DynamicDrawUsage),
    tint: new THREE.BufferAttribute(auraTint, 1),
  };
  auraGeometry.setAttribute('position', auraAttr.position);
  auraGeometry.setAttribute('aSize', auraAttr.size);
  auraGeometry.setAttribute('aAlpha', auraAttr.alpha);
  auraGeometry.setAttribute('aTint', auraAttr.tint);

  const auraMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uMap: { value: spark },
      uAmethyst: { value: COLOURS.amethyst },
      uBone: { value: COLOURS.bone },
      uEmber: { value: COLOURS.ember },
      uScale: { value: 340 },
    },
    vertexShader: `
      attribute float aSize;
      attribute float aAlpha;
      attribute float aTint;
      uniform float uScale;
      varying float vAlpha;
      varying float vTint;
      void main() {
        vAlpha = aAlpha;
        vTint = aTint;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale / max(0.001, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform vec3 uAmethyst;
      uniform vec3 uBone;
      uniform vec3 uEmber;
      varying float vAlpha;
      varying float vTint;
      void main() {
        if (vAlpha <= 0.001) discard;
        float mask = texture2D(uMap, gl_PointCoord).a;
        // One mote in seven burns ember instead of amethyst: the cloud needs a few embers in it or
        // it reads as one flat colour at any distance.
        vec3 tone = mix(mix(uAmethyst, uBone, 0.25), uEmber, vTint);
        gl_FragColor = vec4(tone, mask * vAlpha);
      }`,
  });

  const auraPoints = new THREE.Points(auraGeometry, auraMaterial);
  auraPoints.onBeforeRender = (renderer, _scene, camera) => {
    auraMaterial.uniforms.uScale.value = pixelScale(renderer, camera);
  };
  auraPoints.frustumCulled = false;
  auraPoints.renderOrder = 4;
  auraPoints.userData.isHighlight = true;
  group.add(auraPoints);

  // ------------------------------------------------------------------------------- claw rake ribbons
  function makeRibbon(): Ribbon {
    const count = TRAIL_SAMPLES * TRAIL_LANES * 2;
    const position = new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const fade = new THREE.BufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage);
    const index: number[] = [];
    for (let lane = 0; lane < TRAIL_LANES; lane += 1) {
      for (let i = 0; i < TRAIL_SAMPLES - 1; i += 1) {
        const a = (lane * TRAIL_SAMPLES + i) * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', position);
    geometry.setAttribute('aFade', fade);
    geometry.setIndex(index);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uBone: { value: COLOURS.bone }, uAmethyst: { value: COLOURS.amethyst } },
      vertexShader: `
        attribute float aFade;
        varying float vFade;
        void main() {
          vFade = aFade;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uBone;
        uniform vec3 uAmethyst;
        varying float vFade;
        void main() {
          if (vFade <= 0.002) discard;
          gl_FragColor = vec4(mix(uAmethyst, uBone, vFade * vFade), vFade * 0.85);
        }`,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    mesh.visible = false;
    mesh.userData.isHighlight = true;
    group.add(mesh);
    return {
      mesh, position, fade,
      history: Array.from({ length: TRAIL_SAMPLES }, () => new THREE.Vector3()),
      filled: 0,
      level: 0,
    };
  }

  const ribbons: Record<Claw, Ribbon> = { clawL: makeRibbon(), clawR: makeRibbon() };

  // --------------------------------------------------------------------------------- windup glow
  function makeCharge(): THREE.Sprite {
    const material = new THREE.SpriteMaterial({
      map: flare, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
    });
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    sprite.renderOrder = 6;
    sprite.userData.isHighlight = true;
    group.add(sprite);
    return sprite;
  }
  const charges: Record<Claw, { sprite: THREE.Sprite; level: number }> = {
    clawL: { sprite: makeCharge(), level: 0 },
    clawR: { sprite: makeCharge(), level: 0 },
  };

  // ------------------------------------------------------------------------------------- eyes
  function makeEye(): THREE.Sprite {
    const material = new THREE.SpriteMaterial({
      map: flare, color: COLOURS.ember, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0,
    });
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    sprite.renderOrder = 7;
    sprite.userData.isHighlight = true;
    group.add(sprite);
    return sprite;
  }
  const eyeSprites = [makeEye(), makeEye()];
  let eyeGlow = 0;

  // --------------------------------------------------------------------------------- crescents
  const arcGeometry = arcBandGeometry(56);
  const crescents: Pool<CrescentSlot> = { items: [], cursor: 0 };
  for (let i = 0; i < 6; i += 1) {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uSpan: { value: 1.6 },
        uRadius: { value: 0.5 },
        uInner: { value: 0.84 },
        uFade: { value: 0 },
        uBone: { value: COLOURS.bone },
        uAmethyst: { value: COLOURS.amethyst },
        uEmber: { value: COLOURS.ember },
      },
      vertexShader: `
        attribute float aU;
        attribute float aV;
        uniform float uSpan;
        uniform float uRadius;
        uniform float uInner;
        varying float vU;
        varying float vV;
        void main() {
          vU = aU;
          vV = aV;
          float theta = (aU - 1.0) * uSpan;
          float r = mix(uInner, 1.0, aV) * uRadius;
          vec3 local = vec3(cos(theta) * r, sin(theta) * r, 0.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 1.0);
        }`,
      fragmentShader: `
        uniform float uFade;
        uniform vec3 uBone;
        uniform vec3 uAmethyst;
        uniform vec3 uEmber;
        varying float vU;
        varying float vV;
        void main() {
          // Along the arc: nothing at the trailing tip, everything at the claw. Across the band:
          // a hard bright edge on the outside, smeared away on the inside — that asymmetry is
          // what makes it read as a cut rather than as a ribbon.
          // Along the arc: a hard bright leading edge that smears to nothing at the trailing tip.
          float along = pow(smoothstep(0.0, 0.55, vU), 2.2) * (1.0 - smoothstep(0.94, 1.0, vU));
          // Across the band: a hairline riding the outer radius, with only a thin wash inside it.
          float edge = pow(smoothstep(0.55, 1.0, vV), 3.0);
          float wash = smoothstep(0.0, 0.55, vV) * 0.22;
          float across = clamp(edge + wash, 0.0, 1.0) * (1.0 - smoothstep(0.985, 1.0, vV));
          vec3 tone = mix(mix(uEmber, uAmethyst, smoothstep(0.0, 0.45, vU)), uBone, edge);
          float alpha = along * across * uFade;
          if (alpha <= 0.002) discard;
          gl_FragColor = vec4(tone, alpha);
        }`,
    });
    const mesh = new THREE.Mesh(arcGeometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    mesh.visible = false;
    mesh.userData.isHighlight = true;
    group.add(mesh);
    crescents.items.push({
      mesh, material, age: 1, span: 1, radius: 0.5, overshoot: 0,
      axis: new THREE.Vector3(0, 1, 0), pivot: new THREE.Vector3(), radial: new THREE.Vector3(1, 0, 0),
    });
  }

  // -------------------------------------------------------------------------------- shear cones
  const coneGeometry = new THREE.ConeGeometry(1, 1, 26, 1, true);
  // Apex at the origin, opening down -Z: the cone is pinned at the contact and grows backwards.
  coneGeometry.translate(0, -0.5, 0);
  coneGeometry.rotateX(Math.PI / 2);
  const tears: Pool<TearSlot> = { items: [], cursor: 0 };
  for (let i = 0; i < 5; i += 1) {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uFade: { value: 0 }, uAmethyst: { value: COLOURS.amethyst }, uBone: { value: COLOURS.bone } },
      vertexShader: `
        varying vec3 vNormalView;
        varying vec3 vViewDir;
        varying float vAlong;
        void main() {
          // The cone was built along -Z with its apex at the origin, so -position.z is 0 at the
          // contact and 1 at the open mouth.
          vAlong = clamp(-position.z, 0.0, 1.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vNormalView = normalize(normalMatrix * normal);
          vViewDir = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uFade;
        uniform vec3 uAmethyst;
        uniform vec3 uBone;
        varying vec3 vNormalView;
        varying vec3 vViewDir;
        varying float vAlong;
        void main() {
          // Rim-lit: the cone is only visible where its surface turns away from the eye, which is
          // what makes it read as displaced air instead of as a cone.
          float rim = 1.0 - abs(dot(normalize(vNormalView), normalize(vViewDir)));
          float body = pow(rim, 3.2) * (1.0 - vAlong) * smoothstep(0.0, 0.18, vAlong);
          float alpha = body * uFade * 0.45;
          if (alpha <= 0.002) discard;
          gl_FragColor = vec4(mix(uBone, uAmethyst, vAlong), alpha);
        }`,
    });
    const mesh = new THREE.Mesh(coneGeometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    mesh.visible = false;
    mesh.userData.isHighlight = true;
    group.add(mesh);
    tears.items.push({
      mesh, material, age: 1, span: 1, length: 0.4, radius: 0.1,
      origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1),
    });
  }

  // ------------------------------------------------------------------- void rings and their holes
  const ringGeometry = new THREE.RingGeometry(0.90, 1, 64);
  const rings: Pool<RingSlot> = { items: [], cursor: 0 };
  for (let i = 0; i < 6; i += 1) {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uFade: { value: 0 }, uBone: { value: COLOURS.bone }, uAmethyst: { value: COLOURS.amethyst } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uFade;
        uniform vec3 uBone;
        uniform vec3 uAmethyst;
        varying vec2 vUv;
        void main() {
          float r = length(vUv - 0.5) * 2.0;
          float band = smoothstep(0.90, 0.985, r) * (1.0 - smoothstep(0.994, 1.0, r));
          float alpha = band * uFade * 0.8;
          if (alpha <= 0.002) discard;
          gl_FragColor = vec4(mix(uAmethyst, uBone, band * 0.6), alpha);
        }`,
    });
    const mesh = new THREE.Mesh(ringGeometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    mesh.visible = false;
    mesh.userData.isHighlight = true;
    group.add(mesh);
    rings.items.push({
      mesh, material, age: 1, span: 1, from: 0.1, to: 0.4, along: 0.2,
      dir: new THREE.Vector3(0, 0, 1), origin: new THREE.Vector3(),
    });
  }

  /**
   * The hole behind the ring. Normal-blended near-black: a tear in the air has to take light AWAY
   * from what is behind it for one or two frames, and every additive layer in this file can only
   * add. This is four meshes and it is the difference between "glowing hoop" and "torn air".
   */
  const discGeometry = new THREE.CircleGeometry(1, 40);
  const voids: Pool<VoidSlot> = { items: [], cursor: 0 };
  for (let i = 0; i < 4; i += 1) {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      uniforms: { uFade: { value: 0 }, uVoid: { value: COLOURS.ash } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uFade;
        uniform vec3 uVoid;
        varying vec2 vUv;
        void main() {
          float r = length(vUv - 0.5) * 2.0;
          float alpha = (1.0 - smoothstep(0.05, 0.85, r)) * uFade;
          if (alpha <= 0.002) discard;
          gl_FragColor = vec4(uVoid, alpha);
        }`,
    });
    const mesh = new THREE.Mesh(discGeometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.visible = false;
    mesh.userData.isHighlight = true;
    group.add(mesh);
    voids.items.push({ mesh, material, age: 1, span: 1, radius: 0.2 });
  }

  /**
   * Shear slivers: eight hairlines lying ALONG the travel, thrown outward from the axis as they
   * fade. Not a physical layer — this is the comic-book convention for air being torn, and the eye
   * reads it faster than anything physical would. Each carries its own roll about the axis, so a
   * few always face the camera however the orbit is standing.
   */
  const sliverGeometry = new THREE.PlaneGeometry(1, 1);
  sliverGeometry.rotateX(-Math.PI / 2);
  const slivers: Pool<SliverSlot> = { items: [], cursor: 0 };
  for (let i = 0; i < 8; i += 1) {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uFade: { value: 0 }, uBone: { value: COLOURS.bone }, uAmethyst: { value: COLOURS.amethyst } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uFade;
        uniform vec3 uBone;
        uniform vec3 uAmethyst;
        varying vec2 vUv;
        void main() {
          // Pointed at both ends and thinnest in the middle of its width: a scratch, not a bar.
          float along = sin(vUv.y * 3.14159);
          float across = pow(1.0 - abs(vUv.x - 0.5) * 2.0, 1.6);
          float alpha = pow(along, 1.8) * across * uFade;
          if (alpha <= 0.002) discard;
          gl_FragColor = vec4(mix(uAmethyst, uBone, across), alpha);
        }`,
    });
    const mesh = new THREE.Mesh(sliverGeometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    mesh.visible = false;
    mesh.userData.isHighlight = true;
    group.add(mesh);
    slivers.items.push({
      mesh, material, age: 1, span: 1, length: 0.4, width: 0.02, roll: 0, radius: 0.05, spread: 0.1,
      origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1),
    });
  }

  // --------------------------------------------------------------------------------- flashes
  const flashes: Pool<FlashSlot> = { items: [], cursor: 0 };
  for (let i = 0; i < 6; i += 1) {
    const material = new THREE.SpriteMaterial({
      map: flare, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
    });
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    sprite.renderOrder = 7;
    sprite.userData.isHighlight = true;
    group.add(sprite);
    flashes.items.push({ sprite, material, age: 1, span: 1, scale: 0.3 });
  }

  // ----------------------------------------------------------------------- ground: swirl and pulses
  const miasmaGeometry = new THREE.CircleGeometry(1, 64);
  const miasmaMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uAmethyst: { value: COLOURS.amethyst },
      uAbyss: { value: COLOURS.abyss },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform float uIntensity;
      uniform vec3 uAmethyst;
      uniform vec3 uAbyss;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        if (r > 1.0) discard;
        float a = atan(p.y, p.x);
        // Three layers of sheared sine, each turning at its own rate: cheap swirling fog with no
        // texture fetch and no period a viewer can catch.
        float swirl = sin(a * 3.0 + uTime * 0.55 - r * 7.0)
                    + sin(a * 5.0 - uTime * 0.38 + r * 4.0) * 0.6
                    + sin(a * 2.0 + uTime * 0.22 - r * 11.0) * 0.4;
        float body = smoothstep(-0.4, 1.6, swirl);
        // Hollow in the middle (the figure stands there) and gone by the rim.
        float shape = smoothstep(0.06, 0.36, r) * (1.0 - smoothstep(0.55, 1.0, r));
        float alpha = body * shape * uIntensity * 0.62;
        if (alpha <= 0.002) discard;
        gl_FragColor = vec4(mix(uAbyss, uAmethyst, body), alpha);
      }`,
  });
  const miasmaMesh = new THREE.Mesh(miasmaGeometry, miasmaMaterial);
  miasmaMesh.rotation.x = -Math.PI / 2;
  miasmaMesh.position.y = 0.012;
  miasmaMesh.frustumCulled = false;
  miasmaMesh.renderOrder = 1;
  miasmaMesh.visible = false;
  miasmaMesh.userData.isHighlight = true;
  group.add(miasmaMesh);

  const pulseGeometry = new THREE.RingGeometry(0.55, 1, 64);
  const pulses: Pool<PulseSlot> = { items: [], cursor: 0 };
  for (let i = 0; i < 4; i += 1) {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uFade: { value: 0 }, uAmethyst: { value: COLOURS.amethyst }, uBone: { value: COLOURS.bone } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uFade;
        uniform vec3 uAmethyst;
        uniform vec3 uBone;
        varying vec2 vUv;
        void main() {
          float r = length(vUv - 0.5) * 2.0;
          float band = smoothstep(0.55, 0.95, r) * (1.0 - smoothstep(0.98, 1.0, r));
          float alpha = band * uFade;
          if (alpha <= 0.002) discard;
          gl_FragColor = vec4(mix(uAmethyst, uBone, band * 0.7), alpha);
        }`,
    });
    const mesh = new THREE.Mesh(pulseGeometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.visible = false;
    mesh.userData.isHighlight = true;
    group.add(mesh);
    pulses.items.push({ mesh, material, age: 1, span: 1, radius: 0.4 });
  }

  // ---------------------------------------------------------------------------------- lights
  const lights: Pool<LightSlot> = { items: [], cursor: 0 };
  for (let i = 0; i < 3; i += 1) {
    const light = new THREE.PointLight(COLOURS.amethyst.getHex(), 0, 5.5, 2);
    light.visible = false;
    light.userData.isHighlight = true;
    group.add(light);
    lights.items.push({ light, age: 1, span: 1, peak: 0 });
  }

  // ------------------------------------------------------------------------------- spawn helpers
  function spawnShard(
    kind: ShardKind, at: THREE.Vector3, velocity: THREE.Vector3, scale: number,
  ): void {
    const physics = SHARD_PHYSICS[kind];
    const i = shard.cursor;
    shard.cursor = (shard.cursor + 1) % SHARD_CAPACITY;
    shard.px[i] = at.x; shard.py[i] = at.y; shard.pz[i] = at.z;
    shard.vx[i] = velocity.x; shard.vy[i] = velocity.y; shard.vz[i] = velocity.z;
    shard.age[i] = 0;
    shard.span[i] = physics.life[0] + Math.random() * (physics.life[1] - physics.life[0]);
    shard.gravity[i] = physics.gravity;
    shard.drag[i] = physics.drag;
    shardSize[i] = (physics.size[0] + Math.random() * (physics.size[1] - physics.size[0])) * scale;
    shardTint[i] = physics.tint;
    shardStretch[i] = physics.stretch;
  }

  function spawnAsh(kind: AshKind, at: THREE.Vector3, velocity: THREE.Vector3, scale: number): void {
    const physics = ASH_PHYSICS[kind];
    const i = ash.cursor;
    ash.cursor = (ash.cursor + 1) % ASH_CAPACITY;
    ash.px[i] = at.x; ash.py[i] = at.y; ash.pz[i] = at.z;
    ash.vx[i] = velocity.x; ash.vy[i] = velocity.y; ash.vz[i] = velocity.z;
    ash.age[i] = 0;
    ash.span[i] = physics.life[0] + Math.random() * (physics.life[1] - physics.life[0]);
    ash.gravity[i] = physics.gravity;
    ash.drag[i] = physics.drag;
    ash.base[i] = (physics.size[0] + Math.random() * (physics.size[1] - physics.size[0])) * scale;
    ash.growth[i] = physics.growth;
    ashAlpha[i] = physics.alpha;
    ashTint[i] = physics.tint;
  }

  /** A unit vector inside a cone of half-angle `spread` about `axis`. */
  function scatter(axis: THREE.Vector3, spread: number, out: THREE.Vector3): THREE.Vector3 {
    out.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    if (out.lengthSq() < 1e-8) out.set(0, 1, 0);
    out.normalize().multiplyScalar(spread);
    return out.add(axis).normalize();
  }

  function spawnLight(at: THREE.Vector3, peak: number, span: number, colour: THREE.Color): void {
    const slot = nextFrom(lights);
    slot.light.position.copy(at);
    slot.light.color.copy(colour);
    slot.light.visible = true;
    slot.age = 0;
    slot.span = span;
    slot.peak = peak;
  }

  function spawnFlash(at: THREE.Vector3, scale: number, span: number): void {
    const slot = nextFrom(flashes);
    slot.sprite.position.copy(at);
    slot.sprite.visible = true;
    slot.age = 0;
    slot.span = span;
    slot.scale = scale;
  }

  function spawnPulse(at: THREE.Vector3, radius: number, span: number): void {
    const slot = nextFrom(pulses);
    slot.mesh.position.set(at.x, 0.02, at.z);
    slot.mesh.visible = true;
    slot.age = 0;
    slot.span = span;
    slot.radius = radius;
  }

  // ------------------------------------------------------------------------------ the public API
  function auraUpdate(anchors: readonly THREE.Vector3[], intensity: number, dt: number): void {
    if (anchors.length === 0) return;
    if (!aura.primed) {
      for (let i = 0; i < AURA_CAPACITY; i += 1) {
        aura.anchor[i] = i % anchors.length;
        const anchor = anchors[aura.anchor[i]];
        aura.sx[i] = anchor.x; aura.sy[i] = anchor.y; aura.sz[i] = anchor.z;
      }
      aura.primed = true;
    }
    auraPoints.visible = intensity > 0.01;
    if (!auraPoints.visible) return;
    for (let i = 0; i < AURA_CAPACITY; i += 1) {
      const anchor = anchors[aura.anchor[i] % anchors.length];
      // Exponential chase, framerate-independent. This is the lag, and the lag is the effect.
      const k = 1 - Math.exp(-aura.lag[i] * dt);
      aura.sx[i] += (anchor.x - aura.sx[i]) * k;
      aura.sy[i] += (anchor.y - aura.sy[i]) * k;
      aura.sz[i] += (anchor.z - aura.sz[i]) * k;
      aura.angle[i] += aura.rate[i] * dt * (0.6 + intensity * 1.4);
      const radius = aura.radius[i] * (0.75 + intensity * 0.6);
      const wobble = Math.sin(clock * 0.8 + aura.seed[i]) * aura.bob[i];
      auraPosition[i * 3] = aura.sx[i] + Math.cos(aura.angle[i]) * radius;
      auraPosition[i * 3 + 1] = aura.sy[i] + aura.lift[i] + wobble;
      auraPosition[i * 3 + 2] = aura.sz[i] + Math.sin(aura.angle[i]) * radius;
      // Every mote breathes on its own period, so the cloud never pulses as one body.
      const twinkle = 0.35 + 0.65 * Math.abs(Math.sin(clock * (0.5 + aura.seed[i] * 0.013) + aura.seed[i]));
      auraAlpha[i] = twinkle * intensity;
    }
    auraAttr.position.needsUpdate = true;
    auraAttr.alpha.needsUpdate = true;
  }

  function clawTrail(claw: Claw, at: THREE.Vector3, strength: number): void {
    const ribbon = ribbons[claw];
    ribbon.level += (strength - ribbon.level) * (strength > ribbon.level ? 0.55 : 0.16);
    // Shift the history back one and write the newest sample at the head.
    for (let i = ribbon.history.length - 1; i > 0; i -= 1) ribbon.history[i].copy(ribbon.history[i - 1]);
    ribbon.history[0].copy(at);
    ribbon.filled = Math.min(ribbon.filled + 1, ribbon.history.length);
    if (ribbon.level < 0.02 || ribbon.filled < 3) {
      ribbon.mesh.visible = false;
      return;
    }
    ribbon.mesh.visible = true;
    const positions = ribbon.position.array as Float32Array;
    const fades = ribbon.fade.array as Float32Array;
    for (let i = 0; i < TRAIL_SAMPLES; i += 1) {
      const point = ribbon.history[Math.min(i, ribbon.filled - 1)];
      const ahead = ribbon.history[Math.max(0, Math.min(i - 1, ribbon.filled - 1))];
      const behind = ribbon.history[Math.min(i + 1, ribbon.filled - 1)];
      scratchA.copy(ahead).sub(behind);
      if (scratchA.lengthSq() < 1e-9) scratchA.copy(sideways);
      scratchA.normalize();
      scratchB.copy(scratchA).cross(up);
      if (scratchB.lengthSq() < 1e-8) scratchB.copy(sideways);
      scratchB.normalize();
      scratchC.copy(scratchA).cross(scratchB).normalize();
      const taper = (1 - i / TRAIL_SAMPLES) * ribbon.level;
      const half = 0.014 + 0.030 * taper;
      for (let lane = 0; lane < TRAIL_LANES; lane += 1) {
        // Three lanes across the sweep: this is a claw, and one ribbon reads as a sword.
        const offset = (lane - 1) * 0.045 * (0.5 + ribbon.level * 0.5);
        for (let side = 0; side < 2; side += 1) {
          const v = (lane * TRAIL_SAMPLES + i) * 2 + side;
          const sign = side === 0 ? 1 : -1;
          positions[v * 3] = point.x + scratchC.x * offset + scratchB.x * half * sign;
          positions[v * 3 + 1] = point.y + scratchC.y * offset + scratchB.y * half * sign;
          positions[v * 3 + 2] = point.z + scratchC.z * offset + scratchB.z * half * sign;
          // The middle lane is the bright one; the outer two are the claws either side of it.
          fades[v] = taper * (lane === 1 ? 1 : 0.62);
        }
      }
    }
    ribbon.position.needsUpdate = true;
    ribbon.fade.needsUpdate = true;
  }

  function gather(claw: Claw, at: THREE.Vector3, amount: number): void {
    const state = charges[claw];
    state.level = Math.max(state.level, amount);
    state.sprite.position.copy(at);
    // Matter falling in from a shell around the claw, braked hard so it stalls at the centre
    // instead of shooting through it.
    if (Math.random() < amount * 0.85) {
      scatter(up, 1.6, scratchA);
      scratchB.copy(at).addScaledVector(scratchA, 0.20 + Math.random() * 0.22);
      scratchC.copy(at).sub(scratchB).multiplyScalar(2.6 + Math.random() * 2.4);
      spawnShard('gather', scratchB, scratchC, 0.8 + amount * 0.6);
    }
  }

  function strike(
    kind: StrikeKind, at: THREE.Vector3, dir: THREE.Vector3, pivot: THREE.Vector3, power: number,
  ): number {
    const shape = STRIKE_SHAPE[kind];
    const gain = 0.65 + power * 0.5;

    // ---- the crescent, on the arc the limb actually swung through
    scratchA.copy(at).sub(pivot);
    let radius = scratchA.length();
    if (radius < 0.08) {
      // Degenerate pivot (a contact essentially on top of its own joint): fall back to a fixed
      // reach so the crescent still draws, rather than collapsing to a point.
      scratchA.copy(dir).multiplyScalar(-1).addScaledVector(up, 0.2);
      radius = 0.35;
    }
    scratchA.normalize();
    scratchB.copy(scratchA).cross(dir);
    if (scratchB.lengthSq() < 1e-8) scratchB.copy(up).cross(dir);
    if (scratchB.lengthSq() < 1e-8) scratchB.copy(up);
    // The swing axis: radius x travel. The crescent is drawn in the plane perpendicular to it.
    scratchB.normalize();
    const crescentCount = shape.crossed ? 2 : 1;
    for (let n = 0; n < crescentCount; n += 1) {
      const slot = nextFrom(crescents);
      slot.pivot.copy(pivot);
      slot.radial.copy(scratchA);
      slot.axis.copy(scratchB);
      if (n === 1) {
        // The second blade of a rend, rolled about the travel so the two arcs cross rather than
        // sitting on top of each other.
        slot.axis.applyAxisAngle(dir, 1.05).normalize();
        slot.radial.copy(slot.axis).cross(dir).normalize().negate();
      }
      slot.radius = radius * (n === 1 ? 0.86 : 1);
      slot.age = 0;
      slot.span = 0.26 + power * 0.08;
      slot.overshoot = 0.22 + power * 0.24;
      slot.material.uniforms.uSpan.value = shape.arcSpan * (0.85 + power * 0.3);
      slot.material.uniforms.uInner.value = 1 - shape.arcBand * (0.8 + power * 0.5);
      slot.mesh.visible = true;
    }

    // ---- the shear cone behind the contact
    {
      const slot = nextFrom(tears);
      slot.origin.copy(at);
      slot.dir.copy(dir);
      slot.length = shape.tearLength * gain;
      slot.radius = shape.tearRadius * gain;
      slot.age = 0;
      slot.span = 0.19 + power * 0.06;
      slot.mesh.visible = true;
    }

    // ---- shear slivers along the travel
    const sliverCount = 4 + Math.round(power * 4);
    for (let n = 0; n < sliverCount; n += 1) {
      const slot = nextFrom(slivers);
      slot.origin.copy(at);
      slot.dir.copy(dir);
      slot.length = shape.tearLength * gain * (0.9 + Math.random() * 0.8);
      slot.width = 0.006 + Math.random() * 0.012 * gain;
      slot.roll = Math.random() * Math.PI * 2;
      slot.radius = shape.tearRadius * (0.4 + Math.random() * 1.1);
      slot.spread = shape.tearRadius * (0.8 + Math.random() * 1.6);
      slot.age = 0;
      slot.span = 0.13 + Math.random() * 0.07;
      slot.mesh.visible = true;
    }

    // ---- rings down the axis, each with its hole
    for (let n = 0; n < shape.ringCount; n += 1) {
      const slot = nextFrom(rings);
      slot.origin.copy(at);
      slot.dir.copy(dir);
      slot.from = 0.06 + n * 0.04;
      slot.to = shape.ringSpan * gain * (1 + n * 0.55);
      slot.along = 0.05 + n * 0.09;
      slot.age = 0;
      slot.span = 0.24 + n * 0.08;
      slot.mesh.visible = true;
    }
    if (power > 0.35) {
      const slot = nextFrom(voids);
      slot.mesh.position.copy(at);
      slot.mesh.quaternion.setFromUnitVectors(FORWARD, dir);
      slot.radius = shape.ringSpan * gain * 0.55;
      slot.age = 0;
      slot.span = 0.14;
      slot.mesh.visible = true;
    }

    // ---- debris, thrown forward along the travel
    const shards = Math.round(shape.shards * (0.55 + power * 0.65));
    for (let n = 0; n < shards; n += 1) {
      scatter(dir, 0.62, scratchC);
      scratchD.copy(scratchC).multiplyScalar((1.4 + Math.random() * 3.6) * gain);
      scratchC.copy(at).addScaledVector(scratchC, 0.03);
      spawnShard('shard', scratchC, scratchD, 0.8 + power * 0.7);
    }
    for (let n = 0; n < shape.ash; n += 1) {
      scatter(dir, 1.1, scratchC);
      scratchD.copy(scratchC).multiplyScalar(0.5 + Math.random() * 1.1);
      scratchC.copy(at).addScaledVector(scratchC, 0.05);
      spawnAsh('ash', scratchC, scratchD, 0.9 + power * 0.5);
    }

    spawnFlash(at, shape.flash * gain, 0.13);
    spawnLight(at, shape.light * (0.6 + power * 0.7), 0.13, COLOURS.amethyst);
    // Only when the contact is low enough for the floor to be part of it: a claw stopping at head
    // height has nothing to do with the ground, and a ring under it reads as a decal that missed.
    if (shape.ground > 0 && at.y < 0.75) spawnPulse(at, shape.ground * gain, 0.42);

    return shape.hitstop * (0.7 + power * 0.45);
  }

  function footfall(at: THREE.Vector3, drop: number): void {
    const heavy = Math.min(1, drop / 2.4);
    const count = 4 + Math.round(heavy * 14);
    for (let n = 0; n < count; n += 1) {
      scatter(up, 2.4, scratchA);
      scratchA.y = Math.abs(scratchA.y) * 0.5;
      scratchB.copy(at).addScaledVector(scratchA, 0.05);
      scratchB.y = Math.max(0.01, scratchB.y);
      scratchC.copy(scratchA).multiplyScalar(0.35 + Math.random() * (0.5 + heavy * 1.4));
      spawnAsh('ash', scratchB, scratchC, 0.8 + heavy * 0.9);
    }
    spawnPulse(at, 0.28 + heavy * 0.95, 0.34 + heavy * 0.2);
    if (drop > 1.0) {
      // A stomp, not a step: shards off the floor and a light under the figure.
      for (let n = 0; n < 14; n += 1) {
        scatter(up, 1.9, scratchA);
        scratchA.y = Math.abs(scratchA.y);
        scratchB.copy(at).addScaledVector(scratchA, 0.04);
        scratchC.copy(scratchA).multiplyScalar(1.2 + Math.random() * 2.6);
        spawnShard('shard', scratchB, scratchC, 1);
      }
      scratchA.copy(at);
      scratchA.y += 0.12;
      spawnLight(scratchA, 7 * heavy, 0.18, COLOURS.amethyst);
    }
  }

  function stagger(at: THREE.Vector3, dir: THREE.Vector3, power: number): void {
    for (let n = 0; n < 8 + Math.round(power * 10); n += 1) {
      scatter(dir, 0.9, scratchA);
      scratchB.copy(at).addScaledVector(scratchA, 0.04);
      scratchC.copy(scratchA).multiplyScalar(0.6 + Math.random() * (0.8 + power * 1.6));
      spawnAsh('ash', scratchB, scratchC, 1 + power * 0.4);
    }
    for (let n = 0; n < 6; n += 1) {
      scatter(dir, 0.7, scratchA);
      scratchB.copy(at).addScaledVector(scratchA, 0.03);
      scratchC.copy(scratchA).multiplyScalar(1.2 + Math.random() * 2.2);
      spawnShard('shard', scratchB, scratchC, 0.7);
    }
    // Rings that come IN rather than out: something arrived here, it did not leave.
    const slot = nextFrom(rings);
    slot.origin.copy(at);
    slot.dir.copy(dir);
    slot.from = 0.34 * (0.6 + power);
    slot.to = 0.05;
    slot.along = -0.05;
    slot.age = 0;
    slot.span = 0.26;
    slot.mesh.visible = true;
    spawnLight(at, 4 + power * 4, 0.15, COLOURS.ember);
  }

  function miasma(centre: THREE.Vector3, intensity: number): void {
    miasmaMesh.position.x = centre.x;
    miasmaMesh.position.z = centre.z;
    miasmaMaterial.uniforms.uIntensity.value = intensity;
    miasmaMesh.visible = intensity > 0.01;
  }

  function eyes(left: THREE.Vector3, right: THREE.Vector3, glow: number): void {
    eyeGlow = glow;
    eyeSprites[0].position.copy(left);
    eyeSprites[1].position.copy(right);
  }

  function shed(at: THREE.Vector3, drift: THREE.Vector3): void {
    scatter(up, 1.5, scratchA);
    scratchB.copy(at).addScaledVector(scratchA, 0.03 + Math.random() * 0.05);
    scratchC.copy(scratchA).multiplyScalar(0.10 + Math.random() * 0.16).add(drift);
    spawnAsh('ash', scratchB, scratchC, 0.7 + Math.random() * 0.5);
  }

  function breathe(at: THREE.Vector3, forward: THREE.Vector3): void {
    for (let n = 0; n < 9; n += 1) {
      scatter(forward, 0.42, scratchA);
      scratchB.copy(at).addScaledVector(scratchA, 0.05 + Math.random() * 0.05);
      scratchC.copy(scratchA).multiplyScalar(0.30 + Math.random() * 0.45);
      scratchC.y -= 0.05;
      spawnAsh('breath', scratchB, scratchC, 1);
    }
  }

  // ---------------------------------------------------------------------------------- per frame
  const counts = { shards: 0, ash: 0, aura: 0, crescents: 0, tears: 0, rings: 0 };

  function update(dt: number): void {
    clock += dt;
    miasmaMaterial.uniforms.uTime.value = clock;

    // --- shards
    let shardsAlive = 0;
    for (let i = 0; i < SHARD_CAPACITY; i += 1) {
      if (shard.age[i] >= 1) { shardLife[i] = 1; continue; }
      const step = dt / shard.span[i];
      shard.age[i] = Math.min(1, shard.age[i] + step);
      const damp = Math.max(0, 1 - shard.drag[i] * dt);
      shard.vx[i] *= damp;
      shard.vy[i] = shard.vy[i] * damp - shard.gravity[i] * dt;
      shard.vz[i] *= damp;
      shard.px[i] += shard.vx[i] * dt;
      shard.py[i] += shard.vy[i] * dt;
      shard.pz[i] += shard.vz[i] * dt;
      shardPosition[i * 3] = shard.px[i];
      shardPosition[i * 3 + 1] = shard.py[i];
      shardPosition[i * 3 + 2] = shard.pz[i];
      shardVel[i * 3] = shard.vx[i];
      shardVel[i * 3 + 1] = shard.vy[i];
      shardVel[i * 3 + 2] = shard.vz[i];
      shardLife[i] = shard.age[i];
      shardsAlive += 1;
    }
    shardAttr.position.needsUpdate = true;
    shardAttr.life.needsUpdate = true;
    shardAttr.size.needsUpdate = true;
    shardAttr.tint.needsUpdate = true;
    shardAttr.vel.needsUpdate = true;
    shardAttr.stretch.needsUpdate = true;
    shardPoints.visible = shardsAlive > 0;

    // --- ash
    let ashAlive = 0;
    for (let i = 0; i < ASH_CAPACITY; i += 1) {
      if (ash.age[i] >= 1) { ashLife[i] = 1; continue; }
      const step = dt / ash.span[i];
      ash.age[i] = Math.min(1, ash.age[i] + step);
      const damp = Math.max(0, 1 - ash.drag[i] * dt);
      ash.vx[i] *= damp;
      ash.vy[i] = ash.vy[i] * damp - ash.gravity[i] * dt;
      ash.vz[i] *= damp;
      ash.px[i] += ash.vx[i] * dt;
      ash.py[i] += ash.vy[i] * dt;
      ash.pz[i] += ash.vz[i] * dt;
      ashPosition[i * 3] = ash.px[i];
      ashPosition[i * 3 + 1] = ash.py[i];
      ashPosition[i * 3 + 2] = ash.pz[i];
      ashSize[i] = ash.base[i] * (1 + ash.age[i] * ash.growth[i]);
      ashLife[i] = ash.age[i];
      ashAlive += 1;
    }
    ashAttr.position.needsUpdate = true;
    ashAttr.life.needsUpdate = true;
    ashAttr.size.needsUpdate = true;
    ashAttr.alpha.needsUpdate = true;
    ashAttr.tint.needsUpdate = true;
    ashPoints.visible = ashAlive > 0;

    // --- crescents: they widen, sweep a little further than the claw did, and go
    let crescentsAlive = 0;
    for (const slot of crescents.items) {
      if (slot.age >= 1) continue;
      slot.age = Math.min(1, slot.age + dt / slot.span);
      if (slot.age >= 1) { slot.mesh.visible = false; continue; }
      const t = slot.age;
      // Follow-through: the arc keeps travelling after the claw has stopped, which is what a
      // real trail does and what makes the crescent feel thrown rather than stamped.
      scratchA.copy(slot.radial).applyAxisAngle(slot.axis, slot.overshoot * t * t);
      scratchB.copy(slot.axis).cross(scratchA).normalize();
      basis.makeBasis(scratchA, scratchB, slot.axis);
      slot.mesh.quaternion.setFromRotationMatrix(basis);
      slot.mesh.position.copy(slot.pivot);
      slot.material.uniforms.uRadius.value = slot.radius * (1 + t * 0.16);
      slot.material.uniforms.uFade.value = Math.pow(1 - t, 1.7) * (0.35 + Math.min(1, t * 6) * 0.65);
      crescentsAlive += 1;
    }

    // --- shear cones
    let tearsAlive = 0;
    for (const slot of tears.items) {
      if (slot.age >= 1) continue;
      slot.age = Math.min(1, slot.age + dt / slot.span);
      if (slot.age >= 1) { slot.mesh.visible = false; continue; }
      const t = slot.age;
      slot.mesh.position.copy(slot.origin);
      slot.mesh.quaternion.setFromUnitVectors(BACKWARD, slot.dir);
      const grow = 0.35 + t * 0.9;
      slot.mesh.scale.set(slot.radius * grow, slot.radius * grow, slot.length * (0.5 + t * 0.9));
      slot.material.uniforms.uFade.value = Math.pow(1 - t, 1.4);
      tearsAlive += 1;
    }

    // --- shear slivers: they slide back along the travel and drift off the axis as they go
    for (const slot of slivers.items) {
      if (slot.age >= 1) continue;
      slot.age = Math.min(1, slot.age + dt / slot.span);
      if (slot.age >= 1) { slot.mesh.visible = false; continue; }
      const t = slot.age;
      slot.mesh.quaternion.setFromUnitVectors(FORWARD, slot.dir);
      scratchA.set(Math.cos(slot.roll), Math.sin(slot.roll), 0).applyQuaternion(slot.mesh.quaternion);
      const out = slot.radius + slot.spread * t;
      scratchB.copy(slot.origin)
        .addScaledVector(slot.dir, -slot.length * (0.15 + t * 0.55))
        .addScaledVector(scratchA, out);
      slot.mesh.position.copy(scratchB);
      slot.mesh.scale.set(slot.width, 1, slot.length * (0.7 + t * 0.6));
      slot.material.uniforms.uFade.value = Math.pow(1 - t, 1.5);
    }

    // --- rings
    let ringsAlive = 0;
    for (const slot of rings.items) {
      if (slot.age >= 1) continue;
      slot.age = Math.min(1, slot.age + dt / slot.span);
      if (slot.age >= 1) { slot.mesh.visible = false; continue; }
      const t = slot.age;
      const radius = slot.from + (slot.to - slot.from) * (1 - Math.pow(1 - t, 2.2));
      scratchA.copy(slot.origin).addScaledVector(slot.dir, slot.along * t);
      slot.mesh.position.copy(scratchA);
      slot.mesh.quaternion.setFromUnitVectors(FORWARD, slot.dir);
      slot.mesh.scale.setScalar(Math.max(0.01, radius));
      slot.material.uniforms.uFade.value = Math.pow(1 - t, 1.5);
      ringsAlive += 1;
    }
    for (const slot of voids.items) {
      if (slot.age >= 1) continue;
      slot.age = Math.min(1, slot.age + dt / slot.span);
      if (slot.age >= 1) { slot.mesh.visible = false; continue; }
      slot.mesh.scale.setScalar(Math.max(0.01, slot.radius * (0.5 + slot.age * 0.9)));
      slot.material.uniforms.uFade.value = Math.pow(1 - slot.age, 1.6) * 0.34;
    }

    // --- flashes
    for (const slot of flashes.items) {
      if (slot.age >= 1) continue;
      slot.age = Math.min(1, slot.age + dt / slot.span);
      if (slot.age >= 1) { slot.sprite.visible = false; continue; }
      const t = slot.age;
      slot.sprite.scale.setScalar(slot.scale * (0.6 + t * 1.6));
      slot.material.opacity = Math.pow(1 - t, 2.0);
    }

    // --- ground pulses
    for (const slot of pulses.items) {
      if (slot.age >= 1) continue;
      slot.age = Math.min(1, slot.age + dt / slot.span);
      if (slot.age >= 1) { slot.mesh.visible = false; continue; }
      const t = slot.age;
      slot.mesh.scale.setScalar(Math.max(0.01, slot.radius * (0.25 + t * 1.1)));
      slot.material.uniforms.uFade.value = Math.pow(1 - t, 1.6) * 0.9;
    }

    // --- lights
    for (const slot of lights.items) {
      if (slot.age >= 1) continue;
      slot.age = Math.min(1, slot.age + dt / slot.span);
      if (slot.age >= 1) { slot.light.visible = false; slot.light.intensity = 0; continue; }
      // Spike and decay, not a fade in: an impact light that ramps up reads as a torch.
      slot.light.intensity = slot.peak * Math.pow(1 - slot.age, 2.4);
    }

    // --- windup glow, which lives on the claw rather than in a pool
    for (const claw of ['clawL', 'clawR'] as Claw[]) {
      const state = charges[claw];
      state.level = Math.max(0, state.level - dt * 3.4);
      const material = state.sprite.material as THREE.SpriteMaterial;
      material.opacity = Math.min(1, state.level * 1.15);
      state.sprite.scale.setScalar(0.10 + state.level * 0.30);
      state.sprite.visible = state.level > 0.01;
    }

    // --- eyes: two flickers with no shared period, so they never blink together
    for (let i = 0; i < eyeSprites.length; i += 1) {
      const flicker = 0.72
        + 0.18 * Math.sin(clock * (7.3 + i * 1.7) + i * 2.1)
        + 0.10 * Math.sin(clock * (19.1 - i * 2.3));
      const material = eyeSprites[i].material as THREE.SpriteMaterial;
      material.opacity = Math.max(0, eyeGlow * flicker);
      eyeSprites[i].scale.setScalar(0.055 + eyeGlow * 0.085);
      eyeSprites[i].visible = material.opacity > 0.01;
    }

    counts.shards = shardsAlive;
    counts.ash = ashAlive;
    counts.aura = auraPoints.visible ? AURA_CAPACITY : 0;
    counts.crescents = crescentsAlive;
    counts.tears = tearsAlive;
    counts.rings = ringsAlive;
  }

  function dispose(): void {
    shardGeometry.dispose();
    shardMaterial.dispose();
    ashGeometry.dispose();
    ashMaterial.dispose();
    auraGeometry.dispose();
    auraMaterial.dispose();
    arcGeometry.dispose();
    coneGeometry.dispose();
    ringGeometry.dispose();
    sliverGeometry.dispose();
    discGeometry.dispose();
    pulseGeometry.dispose();
    miasmaGeometry.dispose();
    miasmaMaterial.dispose();
    for (const slot of crescents.items) slot.material.dispose();
    for (const slot of tears.items) slot.material.dispose();
    for (const slot of slivers.items) slot.material.dispose();
    for (const slot of rings.items) slot.material.dispose();
    for (const slot of voids.items) slot.material.dispose();
    for (const slot of pulses.items) slot.material.dispose();
    for (const slot of flashes.items) slot.material.dispose();
    for (const claw of ['clawL', 'clawR'] as Claw[]) {
      const ribbon = ribbons[claw];
      ribbon.mesh.geometry.dispose();
      (ribbon.mesh.material as THREE.Material).dispose();
      (charges[claw].sprite.material as THREE.Material).dispose();
    }
    for (const sprite of eyeSprites) (sprite.material as THREE.Material).dispose();
    spark.dispose();
    puff.dispose();
    flare.dispose();
  }

  return {
    group,
    aura: auraUpdate,
    claw: clawTrail,
    gather,
    strike,
    footfall,
    stagger,
    miasma,
    eyes,
    shed,
    breathe,
    counts: () => ({ ...counts }),
    update,
    dispose,
  };
}
