import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { DemoEntry } from './demos/registry';
import { fitScale, subjectExtent, type SubjectExtent } from './framing';

const CYCLE_MS = 5200; // time each demo stays on the turntable
const MATERIALIZE_S = 1.05; // entry animation length
/** Aspect of the hero stage in the desktop two-column layout — the framing to reproduce. */
const STAGE_REFERENCE_ASPECT = 1.11;

/**
 * Cinematic hero turntable: builds each demo in turn, orbits a camera around it
 * with bloom + a drifting particle field, and materializes the model on entry.
 * Calls `onDemo` whenever the active demo changes so the page can crossfade the
 * matching source photo (the image -> 3D story).
 */
export class HeroStage {
  private readonly mount: HTMLElement;
  private readonly demos: DemoEntry[];
  private readonly onDemo: (demo: DemoEntry, index: number) => void;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly composer: EffectComposer;
  private readonly clock = new THREE.Clock();
  private readonly ro: ResizeObserver;

  private readonly target = new THREE.Vector3();
  private orbitRadius = 3;
  private orbitAngle = 0;
  private orbitHeight = 1;
  /** Authored orbit geometry of the active demo, before any responsive pull-back. */
  private authoredRadius = 3;
  private authoredHeight = 1;
  private authoredDistance = 3;
  private fitExtent: SubjectExtent | null = null;
  private fogBase: { near: number; far: number } | null = null;

  private activeObjects: THREE.Object3D[] = [];
  /**
   * Every demo this stage has built, kept alive and merely hidden when it is not on the turntable.
   *
   * The turntable used to dispose the active model and call `build` again on every swap, so the
   * cost of a demo was paid once per 5.2s cycle AND once per card hover, forever. Most demos build
   * in ~10ms and that was invisible; the procedural humanoid builds a 2.1M-sample signed-distance
   * field, so the same code path froze the page every time it came round. Caching turns a swap into
   * a `visible` toggle, which is what the turntable always looked like it was doing.
   */
  private readonly built = new Map<number, {
    objects: THREE.Object3D[];
    fog: THREE.Fog | null;
    fogBase: { near: number; far: number } | null;
    fitExtent: SubjectExtent | null;
  }>();
  private started = false;
  /** Demo indices the turntable may show — everything without a `prewarm`, plus each one as it lands. */
  private readonly ready = new Set<number>();
  /** Late arrivals awaiting their first turn, so a pre-warmed demo is not held back a full lap. */
  private readonly pendingDebut: number[] = [];
  private index = -1;
  private elapsed = 0;
  private entryStart = 0;
  private sinceSwap = 0;
  private rafHandle = 0;
  private disposed = false;
  private readonly reduceMotion: boolean;

  constructor(
    mount: HTMLElement,
    demos: DemoEntry[],
    onDemo: (demo: DemoEntry, index: number) => void,
  ) {
    this.mount = mount;
    this.demos = demos;
    this.onDemo = onDemo;
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);

    this.scene.add(this.buildParticles());

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(
      new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.82),
    );
    this.composer.addPass(new OutputPass());

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(mount);
    this.resize();
  }

  private buildParticles(): THREE.Points {
    const count = 340;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 12;
      positions[i * 3 + 1] = Math.random() * 8 - 1.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 12;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(150,200,255,0.55)');
    g.addColorStop(1, 'rgba(150,200,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const sprite = new THREE.CanvasTexture(canvas);
    sprite.colorSpace = THREE.SRGBColorSpace;

    const mat = new THREE.PointsMaterial({
      size: 0.09,
      map: sprite,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.7,
    });
    const points = new THREE.Points(geo, mat);
    points.name = '__particles';
    points.renderOrder = -1;
    return points;
  }

  private resize(): void {
    const w = this.mount.clientWidth || 1;
    const h = this.mount.clientHeight || 1;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.applyFit();
  }

  /**
   * Scales the turntable orbit out until the subject fits the stage on both axes. The stage is
   * near-square on desktop but tall and narrow on a phone, where the authored radius would clip
   * wide subjects (a bike, a shotgun) off both edges.
   */
  private applyFit(): void {
    if (!this.fitExtent || this.authoredDistance <= 0) return;
    const scale = fitScale(
      this.fitExtent,
      this.camera.fov,
      this.camera.aspect,
      this.authoredDistance,
      STAGE_REFERENCE_ASPECT,
    );
    // On a phone the authored crop reads as an accident rather than a composition, and the subject
    // collides with the source-photo inset — buy a little extra room back. Keyed to the viewport
    // (not the stage width) so the desktop stage, which is only ~510px wide, is left alone.
    const room = window.innerWidth <= 640 ? 1.12 : 1;
    this.orbitRadius = this.authoredRadius * scale * room;
    this.orbitHeight = this.authoredHeight * scale * room;
    const reach = Math.max(this.fitExtent.horizontal, this.fitExtent.vertical);
    this.camera.far = Math.max(100, this.authoredDistance * scale * room + reach * 6);
    this.camera.updateProjectionMatrix();
    // A pulled-back camera would otherwise sit outside a demo's fog range and fade the subject
    // to nothing; scale the range with the pull-back so the look is preserved.
    if (this.fogBase && this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = this.fogBase.near * scale * room;
      this.scene.fog.far = this.fogBase.far * scale * room;
    }
  }

  private static disposeObject(obj: THREE.Object3D): void {
    obj.traverse((node) => {
      const mesh = node as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (!material) return;
      for (const mat of Array.isArray(material) ? material : [material]) mat.dispose();
    });
  }

  private showDemo(index: number): void {
    for (const obj of this.activeObjects) obj.visible = false;

    const demo = this.demos[index];
    let entry = this.built.get(index);
    if (!entry) {
      const before = new Set(this.scene.children);
      // Reset fog so a previous demo's atmosphere doesn't leak onto this one.
      this.scene.fog = null;
      demo.build(this.scene);
      // Some demos set an opaque scene.background; keep the hero canvas transparent
      // so the CSS aurora shows through.
      this.scene.background = null;
      const objects = this.scene.children.filter((c) => !before.has(c));
      // Cast because TS narrows `scene.fog` to `null` from the reset above — it cannot see that
      // `demo.build` is what puts a fog back.
      const built = this.scene.fog as THREE.Fog | null;
      const fog = built instanceof THREE.Fog ? built : null;
      // `fogBase` and `fitExtent` are captured HERE, before `applyFit` runs, because `applyFit`
      // mutates `fog.near`/`fog.far` in place and the entry animation mutates the model's scale.
      // Re-deriving either of them on a later show would read a value this class had already
      // scaled, and the demo would drift a little further every time it came round.
      entry = {
        objects,
        fog,
        fogBase: fog ? { near: fog.near, far: fog.far } : null,
        fitExtent: null,
      };
      this.built.set(index, entry);
    } else {
      for (const obj of entry.objects) obj.visible = true;
    }
    this.scene.fog = entry.fog;
    this.activeObjects = entry.objects;

    const [tx, ty, tz] = demo.cameraTarget;
    const [px, py, pz] = demo.cameraPosition;
    this.target.set(tx, ty, tz);
    const dx = px - tx;
    const dz = pz - tz;
    this.authoredRadius = Math.hypot(dx, dz);
    this.authoredHeight = py - ty;
    this.authoredDistance = Math.hypot(this.authoredRadius, this.authoredHeight);
    this.orbitAngle = Math.atan2(dz, dx);
    this.camera.fov = demo.cameraFov;
    this.camera.updateProjectionMatrix();

    if (!entry.fitExtent) entry.fitExtent = subjectExtent(this.activeObjects, this.target);
    this.fitExtent = entry.fitExtent;
    this.fogBase = entry.fogBase;
    this.applyFit();

    this.entryStart = this.elapsed;
    this.index = index;
    this.onDemo(demo, index);
  }

  /**
   * The next demo whose `prewarm` has finished, searching forward and wrapping.
   *
   * A demo that declares `prewarm` is one whose `build` would block long enough to be felt, so it
   * is not eligible for the turntable until that work is done. Returns the current index when
   * nothing else is ready yet, which simply holds the current demo on screen a little longer.
   */
  private nextReady(from: number): number {
    const n = this.demos.length;
    for (let step = 1; step <= n; step += 1) {
      const i = (from + step) % n;
      if (this.ready.has(i)) return i;
    }
    return from;
  }

  private next(): void {
    // A demo that finished pre-warming after the turntable had already passed its slot would
    // otherwise wait out a whole lap. The humanoid is demo 0 and the reason this page exists, so
    // giving a late arrival the next slot rather than a 70-second wait is the point of the queue.
    const debut = this.pendingDebut.shift();
    if (debut !== undefined && debut !== this.index) {
      this.showDemo(debut);
      return;
    }
    const i = this.nextReady(this.index);
    if (i !== this.index) this.showDemo(i);
  }

  /**
   * Walks the demos that need pre-warming, one at a time, and admits each to the turntable when it
   * lands. Sequential rather than concurrent: these are main-thread time slices, so running two at
   * once would halve the frame budget without finishing either any sooner.
   */
  private async prewarmAll(): Promise<void> {
    for (let i = 0; i < this.demos.length; i += 1) {
      const prewarm = this.demos[i].prewarm;
      if (!prewarm || this.ready.has(i)) continue;
      try {
        await prewarm();
      } catch {
        // A demo that cannot pre-warm stays out of the rotation rather than taking the page down.
        continue;
      }
      if (this.disposed) return;
      this.ready.add(i);
      this.pendingDebut.push(i);
    }
  }

  start(): void {
    if (this.demos.length === 0) return;
    const loop = (): void => {
      if (this.disposed) return;
      this.rafHandle = requestAnimationFrame(loop);
      const dt = Math.min(0.05, this.clock.getDelta());
      this.elapsed += dt;
      const elapsed = this.elapsed;

      // turntable orbit
      if (!this.reduceMotion) this.orbitAngle += dt * 0.32;
      this.camera.position.set(
        this.target.x + this.orbitRadius * Math.cos(this.orbitAngle),
        this.target.y + this.orbitHeight,
        this.target.z + this.orbitRadius * Math.sin(this.orbitAngle),
      );
      this.camera.lookAt(this.target);

      // materialize entry: scale-up + settle
      const t = Math.min(1, (elapsed - this.entryStart) / MATERIALIZE_S);
      const eased = 1 - Math.pow(1 - t, 3);
      const scale = 0.82 + 0.18 * eased;
      const model = this.activeObjects[0];
      if (model) {
        model.scale.setScalar(scale);
        model.position.y = (1 - eased) * 0.25;
      }

      // drift particles upward, wrap around
      const particles = this.scene.getObjectByName('__particles') as THREE.Points | null;
      if (particles && !this.reduceMotion) {
        const pos = particles.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          let y = pos.getY(i) + dt * 0.35;
          if (y > 6.5) y = -1.5;
          pos.setY(i, y);
        }
        pos.needsUpdate = true;
        particles.rotation.y = elapsed * 0.02;
      }

      // advance to the next demo
      this.sinceSwap += dt * 1000;
      if (this.sinceSwap >= CYCLE_MS) {
        this.sinceSwap = 0;
        this.next();
      }

      this.composer.render();
    };

    // THE FIRST BUILD MUST NOT BLOCK THE FIRST PAINT. `renderHome` sets the page's markup and
    // constructs this stage in one synchronous task, so a `showDemo(0)` called inline runs before
    // the browser has painted anything: the nav, hero copy and the whole card grid stay invisible
    // for as long as the heaviest demo takes to build. Two nested frames is the cheap guarantee
    // that a paint has actually happened — one rAF fires BEFORE the paint it is scheduled against,
    // not after. The turntable then starts a beat late, which nobody can see, instead of the page
    // arriving late, which everybody can.
    for (let i = 0; i < this.demos.length; i += 1) {
      if (!this.demos[i].prewarm) this.ready.add(i);
    }

    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (this.disposed) return;
      // Open on the first demo that needs no pre-warming, rather than always on demo 0. Demo 0 may
      // be the expensive one, and waiting for it would leave the stage empty for several seconds
      // while thirteen other demos were ready to orbit. It joins the rotation when it lands.
      this.showDemo(this.nextReady(this.demos.length - 1));
      this.started = true;
      // Discard the build time so the entry animation starts from zero rather than mid-flight.
      this.clock.getDelta();
      loop();
      void this.prewarmAll();
    }));
  }

  /** Jump to a specific demo (e.g. when the user hovers a card). */
  focus(index: number): void {
    // Hovering a card before the stage has shown its first demo would build a second model ahead of
    // demo 0 and leave `index` pointing at something the turntable never introduced.
    if (!this.started) return;
    // A demo still pre-warming would have to build synchronously to be shown, which is exactly the
    // multi-second freeze the pre-warm exists to avoid. Hovering it early is a no-op.
    if (!this.ready.has(index)) return;
    if (index < 0 || index >= this.demos.length || index === this.index) return;
    this.sinceSwap = 0;
    this.showDemo(index);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafHandle);
    this.ro.disconnect();
    // Every demo ever shown is still in the scene, hidden — dispose all of them, not just the
    // visible one, or the cache leaks a GPU buffer per demo the user hovered.
    for (const entry of this.built.values()) {
      for (const obj of entry.objects) {
        this.scene.remove(obj);
        HeroStage.disposeObject(obj);
      }
    }
    this.built.clear();
    this.activeObjects = [];
    this.scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (material) for (const mat of Array.isArray(material) ? material : [material]) mat.dispose();
    });
    this.composer.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.mount) {
      this.mount.removeChild(this.renderer.domElement);
    }
  }
}
