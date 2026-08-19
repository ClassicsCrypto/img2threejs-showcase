import './styles.css';
import { currentRoute, onRouteChange } from './router';
import { renderHome } from './pages/home';
import { renderDemo } from './pages/demo';
import { hasSeenIntro, runIntro } from './intro';

const app = document.getElementById('app')!;

let cleanupCurrentRoute: (() => void) | null = null;
let firstRender = true;
let pendingTransition: number | null = null;

function mountRoute(): void {
  if (cleanupCurrentRoute) {
    cleanupCurrentRoute();
    cleanupCurrentRoute = null;
  }

  const route = currentRoute();
  if (route.name === 'demo') {
    cleanupCurrentRoute = renderDemo(app, route.id);
  } else {
    cleanupCurrentRoute = renderHome(app);
  }
}

const ROUTE_TRANSITION_MS = 220;

/**
 * The headless review harness loads `#/demo/<id>?capture=1` (and some capture scripts drop the
 * flag and rely on `?back=`/`?mask=`), then screenshots as soon as the model reports ready. A
 * full-viewport intro overlay would be *in* that screenshot, so every capture path has to be able
 * to opt out. Checked against both the hash and the query string because the flags appear in both.
 */
function isCaptureRun(): boolean {
  const hash = window.location.hash;
  if (/[?&](capture|mask|back|bg|reviewWhite)=/.test(hash)) return true;
  const search = new URLSearchParams(window.location.search);
  return ['capture', 'mask', 'back', 'bg', 'reviewWhite'].some((key) => search.has(key));
}

/**
 * Every navigation — including the very first one — mounts through here. On first load the
 * page renders immediately and the one-time brand intro plays as an overlay on top of it (so
 * there is never a blank frame under the intro). On every later hash change, #app cross-fades
 * out and back in around the swap, so a route change always reads as a deliberate transition
 * rather than a jump-cut.
 */
function render(): void {
  if (firstRender) {
    firstRender = false;
    mountRoute();
    // Home only: a deep link straight to a demo wants the model, not a splash — and the review
    // harness deep-links exactly that way, so this keeps the intro out of every capture.
    const introWanted = currentRoute().name === 'home' && !isCaptureRun() && !hasSeenIntro();
    if (introWanted) {
      document.body.classList.add('intro-active');
      runIntro(() => document.body.classList.remove('intro-active'));
    }
    return;
  }

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    mountRoute();
    return;
  }

  // A second navigation while one is mid-fade replaces it rather than stacking: two pending
  // timers would each mount a route and fight over the transition classes, which can strand
  // #app at opacity 0.
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
