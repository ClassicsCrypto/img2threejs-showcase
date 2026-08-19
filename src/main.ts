import './styles.css';
import { currentRoute, onRouteChange } from './router';
import { renderWorkbench } from './pages/workbench';
import { renderDemo } from './pages/demo';
import { hasSeenIntro, runIntro } from './intro';

const app = document.getElementById('app')!;

let cleanupCurrentRoute: (() => void) | null = null;
let firstRender = true;
let pendingTransition: number | null = null;
/** The route the mounted view belongs to, so an in-place exhibit swap does not remount. */
let mountedKind: 'workbench' | 'demo' | null = null;

/**
 * The headless review harness loads `#/demo/<id>` with flags like `capture=1` / `back=1` / `mask=`
 * and screenshots as soon as the model reports ready, so nothing decorative may be on screen for
 * those runs — no intro overlay, no route cross-fade.
 */
function isCaptureRun(): boolean {
  const hash = window.location.hash;
  if (/[?&](capture|mask|back|bg|reviewWhite)=/.test(hash)) return true;
  const search = new URLSearchParams(window.location.search);
  return ['capture', 'mask', 'back', 'bg', 'reviewWhite'].some((key) => search.has(key));
}

function mountRoute(): void {
  const route = currentRoute();

  // `#/x/:id` is the workbench pointed at one exhibit. If the workbench is already mounted, the
  // hash changed because IT changed the hash (or the user hit back), and the workbench swaps
  // models in place — remounting would dispose a live viewer and rebuild it identically.
  if (route.name !== 'demo' && mountedKind === 'workbench') return;

  cleanupCurrentRoute?.();
  cleanupCurrentRoute = null;

  if (route.name === 'demo') {
    mountedKind = 'demo';
    cleanupCurrentRoute = renderDemo(app, route.id);
  } else {
    mountedKind = 'workbench';
    cleanupCurrentRoute = renderWorkbench(app, route.name === 'workbench' ? route.id : undefined);
  }
}

const ROUTE_TRANSITION_MS = 200;

function render(): void {
  if (firstRender) {
    firstRender = false;
    mountRoute();
    // Home only, and never during a capture run: a deep link to an exhibit or the full viewer
    // wants the model, not a splash.
    if (currentRoute().name === 'home' && !isCaptureRun() && !hasSeenIntro()) {
      document.body.classList.add('intro-active');
      runIntro(() => document.body.classList.remove('intro-active'));
    }
    return;
  }

  // An in-place exhibit swap must not fade the page.
  const route = currentRoute();
  if (route.name !== 'demo' && mountedKind === 'workbench') return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || isCaptureRun()) {
    mountRoute();
    return;
  }

  if (pendingTransition !== null) window.clearTimeout(pendingTransition);
  app.classList.add('route-leaving');
  pendingTransition = window.setTimeout(() => {
    pendingTransition = null;
    mountRoute();
    app.classList.remove('route-leaving');
    app.classList.add('route-entering');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => app.classList.remove('route-entering'));
    });
  }, ROUTE_TRANSITION_MS);
}

onRouteChange(render);
render();
