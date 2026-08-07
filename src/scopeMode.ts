import * as THREE from 'three';
import type { Viewer } from './scene';

/**
 * "Look through the optic" mode.
 *
 * Entirely socket-driven: a model opts in by publishing a `scope-sight-line` socket carrying an
 * `optic` userData block. Nothing here knows it is looking at a rifle, so any future demo with a
 * sighting device gets the same behaviour for free.
 *
 * The clear field of view is not painted or faked. Seen from the eye station the tube's own wall
 * faces away from the camera and is removed by normal backface culling, so once the two lens discs
 * are hidden the bore is genuinely see-through. That is why this needs no cutaway geometry and no
 * second render target.
 *
 * The reticle is built with DOM/SVG element factories rather than markup strings: the two labels are
 * caller-supplied, so they go in as text nodes and can never be parsed as markup.
 */

export interface OpticSocket extends THREE.Object3D {
  userData: {
    socket?: { id: string; axis: number[] };
    optic?: { fovDegrees?: number; eyeReliefFromOcular?: number };
    [key: string]: unknown;
  };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

const EASE = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Meshes hidden while scoped: lens discs would otherwise fill the entire narrow field. */
const LENS_HINT = /glass|lens/i;

/** Reticle strokes, in the 0-100 viewBox: [x1, y1, x2, y2]. */
const CROSSHAIR: Array<[number, number, number, number]> = [
  [50, 4, 50, 40], [50, 60, 50, 96], [4, 50, 40, 50], [60, 50, 96, 50],
];
const HASHES: Array<[number, number, number, number]> = [
  [46.5, 58, 53.5, 58], [47.5, 66, 52.5, 66], [46.5, 74, 53.5, 74], [47.5, 82, 52.5, 82],
  [42, 46.5, 42, 53.5], [34, 47.5, 34, 52.5], [26, 46.5, 26, 53.5],
  [58, 46.5, 58, 53.5], [66, 47.5, 66, 52.5], [74, 46.5, 74, 53.5],
];

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function buildOverlay(starLabel: string, repoLabel: string): HTMLDivElement {
  const el = document.createElement('div');
  el.dataset.scopeOverlay = 'true';
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = [
    'position:absolute', 'inset:0', 'pointer-events:none',
    'opacity:0', 'transition:opacity 220ms ease', 'z-index:2',
  ].join(';');

  // The eyepiece surround is a radial gradient rather than an SVG mask so it stays crisp at any DPR
  // and costs nothing to composite.
  const surround = document.createElement('div');
  surround.style.cssText = 'position:absolute;inset:0;background:radial-gradient(circle at 50% 50%,'
    + 'rgba(0,0,0,0) 0,rgba(0,0,0,0) min(37vh,37vw),'
    + 'rgba(0,0,0,0.55) calc(min(37vh,37vw) + 1px),'
    + 'rgba(0,0,0,0.97) calc(min(37vh,37vw) + 3.2vh),'
    + 'rgba(0,0,0,0.99) 100%)';
  el.appendChild(surround);

  const root = svg('svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'xMidYMid meet' });
  root.setAttribute('style', 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);'
    + 'width:min(74vh,74vw);height:min(74vh,74vw);overflow:visible');

  const ink = svg('g', {
    stroke: 'rgba(12,16,20,0.92)', fill: 'none', 'stroke-width': '0.45', 'stroke-linecap': 'round',
  });
  for (const [x1, y1, x2, y2] of CROSSHAIR) {
    ink.appendChild(svg('line', { x1: `${x1}`, y1: `${y1}`, x2: `${x2}`, y2: `${y2}` }));
  }
  ink.appendChild(svg('circle', { cx: '50', cy: '50', r: '1.5', 'stroke-width': '0.4' }));
  const hashGroup = svg('g', { 'stroke-width': '0.34' });
  for (const [x1, y1, x2, y2] of HASHES) {
    hashGroup.appendChild(svg('line', { x1: `${x1}`, y1: `${y1}`, x2: `${x2}`, y2: `${y2}` }));
  }
  ink.appendChild(hashGroup);
  root.appendChild(ink);

  const mono = 'ui-monospace,SFMono-Regular,Menlo,monospace';
  const headline = svg('text', { x: '50', y: '27', 'text-anchor': 'middle' });
  headline.setAttribute('style', `font:600 4.4px ${mono};fill:rgba(12,16,20,0.9);letter-spacing:0.35px`);
  headline.textContent = starLabel;
  const sub = svg('text', { x: '50', y: '33.2', 'text-anchor': 'middle' });
  sub.setAttribute('style', `font:500 2.5px ${mono};fill:rgba(12,16,20,0.62);letter-spacing:1.1px`);
  sub.textContent = repoLabel;
  root.appendChild(headline);
  root.appendChild(sub);

  el.appendChild(root);
  return el;
}

export interface ScopeModeOptions {
  /** Headline drawn inside the reticle. */
  starLabel?: string;
  /** Second line under the headline. */
  repoLabel?: string;
  /** Transition duration in ms. */
  durationMs?: number;
}

export interface ScopeMode {
  readonly active: boolean;
  toggle(): void;
  dispose(): void;
}

/**
 * Wires scope mode to a viewer. Returns null when the model publishes no sight-line socket, which is
 * the caller's signal to leave its button hidden.
 */
export function createScopeMode(
  viewer: Viewer,
  mount: HTMLElement,
  model: THREE.Object3D,
  socket: OpticSocket | undefined,
  options: ScopeModeOptions = {},
): ScopeMode | null {
  if (!socket) return null;

  const duration = options.durationMs ?? 620;
  const overlay = buildOverlay(
    options.starLabel ?? '20K ★ GitHub stars',
    options.repoLabel ?? 'img2threejs',
  );
  if (getComputedStyle(mount).position === 'static') mount.style.position = 'relative';
  mount.appendChild(overlay);

  const hiddenLenses: THREE.Object3D[] = [];
  const saved = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 0 };
  let active = false;
  let raf = 0;

  function opticPose(): { eye: THREE.Vector3; aim: THREE.Vector3; fov: number } {
    model.updateWorldMatrix(true, true);
    const eye = socket!.getWorldPosition(new THREE.Vector3());
    const axisArray = socket!.userData.socket?.axis ?? [1, 0, 0];
    const axis = new THREE.Vector3(axisArray[0], axisArray[1], axisArray[2])
      .transformDirection(socket!.matrixWorld)
      .normalize();
    // Aim far enough down the axis that the orbit target never lands inside the model.
    const aim = eye.clone().add(axis.multiplyScalar(24));
    return { eye, aim, fov: socket!.userData.optic?.fovDegrees ?? 6.2 };
  }

  function animate(
    toPosition: THREE.Vector3,
    toTarget: THREE.Vector3,
    toFov: number,
    onDone?: () => void,
  ): void {
    cancelAnimationFrame(raf);
    const fromPosition = viewer.camera.position.clone();
    const fromTarget = viewer.controls.target.clone();
    const fromFov = viewer.camera.fov;
    const start = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      const k = EASE(t);
      viewer.camera.position.lerpVectors(fromPosition, toPosition, k);
      viewer.controls.target.lerpVectors(fromTarget, toTarget, k);
      viewer.camera.fov = fromFov + (toFov - fromFov) * k;
      viewer.camera.updateProjectionMatrix();
      viewer.controls.update();
      if (t < 1) raf = requestAnimationFrame(step);
      else onDone?.();
    };
    raf = requestAnimationFrame(step);
  }

  return {
    get active() { return active; },

    toggle(): void {
      active = !active;
      if (active) {
        saved.position.copy(viewer.camera.position);
        saved.target.copy(viewer.controls.target);
        saved.fov = viewer.camera.fov;
        // Hide the lens discs: at a ~6 degree field they would fill the frame entirely, and with them
        // gone the tube reads through by backface culling alone.
        model.traverse((o) => {
          if ((o as THREE.Mesh).isMesh && LENS_HINT.test(o.name) && o.visible) {
            o.visible = false;
            hiddenLenses.push(o);
          }
        });
        viewer.controls.enabled = false;
        const { eye, aim, fov } = opticPose();
        animate(eye, aim, fov, () => { overlay.style.opacity = '1'; });
      } else {
        overlay.style.opacity = '0';
        animate(saved.position, saved.target, saved.fov, () => {
          viewer.controls.enabled = true;
          for (const o of hiddenLenses) o.visible = true;
          hiddenLenses.length = 0;
        });
      }
    },

    dispose(): void {
      cancelAnimationFrame(raf);
      for (const o of hiddenLenses) o.visible = true;
      hiddenLenses.length = 0;
      overlay.remove();
    },
  };
}
