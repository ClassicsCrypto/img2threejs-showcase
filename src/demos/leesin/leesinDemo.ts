import * as THREE from 'three';
import type { LeesinModelOptions } from './createLeesinModel';

/**
 * The showcase entry point for Lee Sin, and deliberately the only module the registry imports.
 *
 * NO CHARACTERIR. This demo used to compile a `lee-sin-v2` CharacterIR through `CharacterSession`
 * and use its root as the model. That was already vestigial: the demo copies the source GLB's own 69
 * meshes verbatim, and `installMeasuredGeometry` deleted every CharacterIR mesh before adding them
 * (`mesh.parent?.remove(mesh)`), so the only things left of it were an empty Object3D and a
 * conformance report nothing read. Everything the viewer actually uses -- `sculptRuntime` with its
 * pivots, sockets, action anchors, animation controller and per-frame tick -- is built by this demo's
 * own code from the source rig.
 *
 * Dropping it is also what keeps this demo importable in a clean checkout: the CharacterIR compiler
 * lived in a separate package declared as a `file:` path pointing OUTSIDE the repository, so it
 * resolved only on a machine that happened to have the sibling checkout and failed every clean CI
 * install with TS2307. Every module under `src/demos/leesin` now imports nothing but `three`.
 *
 * `build()` in the demo page is synchronous and runs BEFORE `prewarm()`, so this returns an empty root
 * immediately and the copied meshes land on it when the payload has been decoded.
 */

type MeasuredModule = typeof import('./createLeesinModel');

let pending: { root: THREE.Group; options: LeesinModelOptions } | null = null;
let prepared: MeasuredModule | null = null;
let preparing: Promise<void> | null = null;

/**
 * Build and prewarm may arrive in EITHER order, and both have to work.
 *
 * The demo page builds first and prewarms after, so the payload lands on a root that is already in
 * the scene. The workbench does the opposite: it awaits `prewarm` and only then calls `build`. The
 * first version assumed the demo page's order and installed into `pending ?? a throwaway root` -- so
 * on the workbench the geometry went into a root nobody kept, `build` handed back an empty group, and
 * the exhibit read "PARTS 0" with no error anywhere. Ordering is now explicit in both directions:
 * whichever runs second performs the install.
 */
export function createLeesinModel(options: LeesinModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = 'leesin-procedural';
  // The viewer, the demo page and the audit scripts all read this object. It is created here rather
  // than by a character compiler so the demo owns its own runtime contract.
  root.userData.sculptRuntime = {};
  pending = { root, options };
  // Prewarm already finished: the payload is decoded and this root is the one that needs it.
  if (prepared) prepared.installMeasuredGeometry(root, options);
  return root;
}

export function prewarmLeesin(): Promise<void> {
  preparing ??= (async () => {
    const measured = await import('./createLeesinModel');
    await measured.prepareLeesinMeasured();
    prepared = measured;
    // Built already, or built while this was in flight: install into the live root. If nothing has
    // been built yet, `createLeesinModel` installs as soon as it is.
    if (pending) measured.installMeasuredGeometry(pending.root, pending.options);
  })();
  return preparing;
}
