import { demos, getDemo, type DemoEntry } from '../demos/registry';
import { Viewer, type PartInfo } from '../scene';
import { parseRoute, replaceHashSilently } from '../router';
import { createLoader, whenViewerReady, type Loader } from '../loader';
import { DRAWERS } from '../content';
import { brand, CURRENT_VERSION, GITHUB_CORE } from '../site-data';

const VERSION_TAG = /v\d+(?:\.\d+){0,2}(?:-[a-z0-9.]+)?/i;

function extractVersion(generatedWith: string): string | null {
  return generatedWith.match(VERSION_TAG)?.[0] ?? null;
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

type AnimationController = {
  actions: ReadonlyArray<{ id: string; label: string; loop: boolean }>;
  readonly active: string;
  play: (name: string) => void;
  stop: () => void;
  subscribe: (listener: (active: string) => void) => () => void;
};

/**
 * The exhibit the workbench opens on. Derived, not hardcoded: the two character demos declare
 * `prewarm` because their fields are expensive enough to be felt as a frozen page (one is a
 * 2.12M-sample SDF), and making a visitor wait through that before seeing anything is the wrong
 * first impression. The first exhibit without one is the landing hero, so adding or reordering
 * demos keeps working without touching this.
 */
function defaultExhibit(): DemoEntry {
  return demos.find((demo) => !demo.prewarm) ?? demos[0];
}

/* ------------------------------------------------------------------- render */

/**
 * The workbench: one persistent full-bleed canvas with the information laid over it, and an
 * exhibit rail that swaps the model in place instead of navigating. Everything it shows about a
 * model — triangle counts, part names, animation actions — is read back off the live scene through
 * the existing `Viewer` API rather than restated in this file, so a number on screen cannot drift
 * from the geometry that is actually running.
 */
export function renderWorkbench(
  mount: HTMLElement,
  opts: { focusId?: string; drawer?: string } = {},
): () => void {
  const { focusId, drawer: initialDrawer } = opts;
  const initial = (focusId && getDemo(focusId)) || defaultExhibit();
  let index = Math.max(0, demos.indexOf(initial));

  const railThumbs = demos
    .map(
      (demo, i) => `
      <button type="button" class="rail-item" data-index="${i}" role="tab"
              aria-selected="${i === index}" title="${escapeAttr(demo.title)}">
        <img src="${demo.referenceImage}" alt="" loading="lazy"
             onerror="this.classList.add('missing')" />
        <span class="rail-num mono">${String(i + 1).padStart(2, '0')}</span>
      </button>`,
    )
    .join('');

  mount.innerHTML = `
    <div class="wb">
      <header class="wb-top">
        <a class="wb-brand" href="#/">
          <img src="${import.meta.env.BASE_URL}favicon.svg" alt="" width="22" height="22" />
          <span>img<span class="wb-brand-2">2</span>threejs</span>
          <span class="wb-ver mono">${CURRENT_VERSION}</span>
        </a>
        <nav class="wb-nav" aria-label="Sections">
          <button type="button" class="wb-navlink" data-drawer="how-it-works">How it works</button>
          <button type="button" class="wb-navlink" data-drawer="roadmap">Roadmap</button>
          <button type="button" class="wb-navlink" data-drawer="faq">FAQ</button>
          <button type="button" class="wb-navlink" data-drawer="sponsor">Sponsors</button>
          <button type="button" class="wb-navlink" data-drawer="about">About</button>
        </nav>
        <div class="wb-top-right">
          <button type="button" class="wb-search" id="wb-open-palette">
            <span>Exhibits</span><kbd class="mono">⌘K</kbd>
          </button>
          <a class="wb-star" href="${GITHUB_CORE}" target="_blank" rel="noopener noreferrer">Star</a>
          <button type="button" class="wb-sponsor" data-drawer="sponsor">Sponsor</button>
          <!-- Phone/tablet only: the link row above is hidden for width, and without this the
               content pages have no tappable route in at all. -->
          <button type="button" class="wb-menu" data-drawer="menu" aria-label="Open menu">
            <span aria-hidden="true"></span>
          </button>
        </div>
      </header>

      <main class="wb-stage">
        <div class="wb-canvas" id="wb-canvas"></div>


        <!-- top-left: what the model was rebuilt from -->
        <figure class="wb-ref" id="wb-ref">
          <img id="wb-ref-img" alt="reference photograph" onerror="this.classList.add('missing')" />
          <figcaption class="label">Reference</figcaption>
        </figure>

        <!-- bottom-left: the pitch, then the exhibit's own copy -->
        <section class="wb-caption">
          <p class="wb-pitch">
            One photo in.<br />A <em>procedural</em> model out.
          </p>
          <h1 class="wb-title" id="wb-title"></h1>
          <p class="wb-blurb" id="wb-blurb"></p>
          <div class="wb-caption-actions">
            <a class="btn btn-accent" id="wb-open-full" href="#/demo/${initial.id}">Open full viewer</a>
            <a class="btn" id="wb-open-source" href="${initial.sourceUrl}" target="_blank" rel="noopener noreferrer">Read the source</a>
          </div>
        </section>

        <!-- right rail: measured readout, then live controls -->
        <aside class="wb-side">
          <section class="wb-panel wb-readout">
            <h2 class="label">Readout</h2>
            <dl id="wb-specs"></dl>
          </section>

          <section class="wb-panel wb-controls" id="wb-controls" hidden>
            <h2 class="label">Controls</h2>
            <div class="wb-explode">
              <label class="wb-slider-label" for="wb-explode-range">
                <span>Explode</span><output class="mono" id="wb-explode-out">0.00</output>
              </label>
              <input type="range" id="wb-explode-range" min="0" max="1" step="0.01" value="0" />
            </div>
            <div class="wb-actions" id="wb-anim-actions"></div>
          </section>

          <section class="wb-panel wb-parts" id="wb-parts" hidden>
            <h2 class="label">Parts <span class="wb-parts-count mono" id="wb-parts-count"></span></h2>
            <div class="wb-part-selected" id="wb-part-selected" hidden></div>
            <ul class="wb-part-list" id="wb-part-list"></ul>
          </section>
        </aside>
      </main>

      <footer class="wb-rail">
        <button type="button" class="rail-arrow" id="rail-prev" aria-label="Previous exhibit">&#8249;</button>
        <div class="rail-track" id="rail-track" role="tablist" aria-label="Exhibits">${railThumbs}</div>
        <button type="button" class="rail-arrow" id="rail-next" aria-label="Next exhibit">&#8250;</button>
        <span class="rail-count mono" id="rail-count"></span>
      </footer>

      <!-- drawers -->
      <div class="wb-scrim" id="wb-scrim" hidden></div>
      <aside class="wb-drawer" id="wb-drawer" hidden aria-modal="true" role="dialog">
        <button type="button" class="wb-drawer-close" id="wb-drawer-close" aria-label="Close">&#215;</button>
        <div class="wb-drawer-body" id="wb-drawer-body"></div>
      </aside>

      <!-- command palette -->
      <div class="wb-palette" id="wb-palette" hidden role="dialog" aria-modal="true" aria-label="Jump to exhibit">
        <div class="pal-box">
          <input type="text" id="pal-input" class="pal-input" placeholder="Jump to an exhibit…" autocomplete="off" spellcheck="false" />
          <ul class="pal-list" id="pal-list"></ul>
        </div>
      </div>
    </div>
  `;

  /* ------------------------------------------------------------ element refs */
  const canvasMount = mount.querySelector<HTMLElement>('#wb-canvas')!;
  const refImg = mount.querySelector<HTMLImageElement>('#wb-ref-img')!;
  const titleEl = mount.querySelector<HTMLElement>('#wb-title')!;
  const blurbEl = mount.querySelector<HTMLElement>('#wb-blurb')!;
  const specsEl = mount.querySelector<HTMLElement>('#wb-specs')!;
  const openFull = mount.querySelector<HTMLAnchorElement>('#wb-open-full')!;
  const openSource = mount.querySelector<HTMLAnchorElement>('#wb-open-source')!;
  const controlsEl = mount.querySelector<HTMLElement>('#wb-controls')!;
  const explodeRange = mount.querySelector<HTMLInputElement>('#wb-explode-range')!;
  const explodeOut = mount.querySelector<HTMLOutputElement>('#wb-explode-out')!;
  const animActions = mount.querySelector<HTMLElement>('#wb-anim-actions')!;
  const partsEl = mount.querySelector<HTMLElement>('#wb-parts')!;
  const partsCount = mount.querySelector<HTMLElement>('#wb-parts-count')!;
  const partList = mount.querySelector<HTMLElement>('#wb-part-list')!;
  const partSelected = mount.querySelector<HTMLElement>('#wb-part-selected')!;
  const railTrack = mount.querySelector<HTMLElement>('#rail-track')!;
  const railCount = mount.querySelector<HTMLElement>('#rail-count')!;
  const scrim = mount.querySelector<HTMLElement>('#wb-scrim')!;
  const drawer = mount.querySelector<HTMLElement>('#wb-drawer')!;
  const drawerBody = mount.querySelector<HTMLElement>('#wb-drawer-body')!;
  const palette = mount.querySelector<HTMLElement>('#wb-palette')!;
  const palInput = mount.querySelector<HTMLInputElement>('#pal-input')!;
  const palList = mount.querySelector<HTMLElement>('#pal-list')!;

  /* ------------------------------------------------------------ viewer state */
  let viewer: Viewer | null = null;
  let loader: Loader | null = null;
  let unsubscribeAnimation: (() => void) | null = null;
  /** Bumped on every load; an async prewarm that resolves after a newer load started is discarded. */
  let loadToken = 0;
  let disposed = false;

  const teardownViewer = (): void => {
    unsubscribeAnimation?.();
    unsubscribeAnimation = null;
    viewer?.dispose();
    viewer = null;
  };

  const setSpecs = (rows: Array<[string, string]>): void => {
    specsEl.innerHTML = rows
      .map(([k, v]) => `<div><dt class="label">${k}</dt><dd class="mono">${v}</dd></div>`)
      .join('');
  };

  const renderParts = (): void => {
    const manifest = viewer?.partManifest();
    if (!manifest || manifest.parts.length === 0) {
      partsEl.hidden = true;
      return;
    }
    partsEl.hidden = false;
    partsCount.textContent = String(manifest.parts.length);
    partList.innerHTML = manifest.parts
      .map(
        (p) => `
        <li>
          <button type="button" class="wb-part" data-part="${escapeAttr(p.name)}">
            <span class="wb-part-name">${p.name}</span>
            <span class="wb-part-tri mono">${formatCount(p.triangles)}</span>
          </button>
        </li>`,
      )
      .join('');
  };

  const showSelectedPart = (sel: PartInfo | null): void => {
    for (const b of partList.querySelectorAll<HTMLButtonElement>('.wb-part')) {
      b.classList.toggle('is-active', !!sel && b.dataset.part === sel.name);
    }
    if (!sel) {
      partSelected.hidden = true;
      partSelected.innerHTML = '';
      return;
    }
    partSelected.hidden = false;
    partSelected.innerHTML = `
      <div class="wb-sel-head">
        <span class="wb-sel-name mono">${sel.name}</span>
        <span class="wb-sel-kind label">${sel.kind}</span>
      </div>
      <dl class="wb-sel-facts">
        <div><dt class="label">Triangles</dt><dd class="mono">${sel.triangles.toLocaleString()}</dd></div>
        ${sel.module ? `<div><dt class="label">Module</dt><dd class="mono">${sel.module}</dd></div>` : ''}
        ${sel.materials.length ? `<div><dt class="label">Material</dt><dd class="mono">${escapeAttr(sel.materials[0])}</dd></div>` : ''}
      </dl>`;
  };

  /* ------------------------------------------------------------------- load */

  async function loadExhibit(nextIndex: number): Promise<void> {
    const demo = demos[nextIndex];
    if (!demo || disposed) return;
    const token = ++loadToken;
    index = nextIndex;

    // Rail + copy update immediately, so the UI answers the click before geometry exists.
    for (const b of railTrack.querySelectorAll<HTMLButtonElement>('.rail-item')) {
      const active = Number(b.dataset.index) === index;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', String(active));
      if (active) b.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
    railCount.textContent = `${String(index + 1).padStart(2, '0')} / ${demos.length}`;
    titleEl.textContent = demo.title;
    blurbEl.innerHTML = brand(demo.blurb);
    refImg.classList.remove('missing');
    refImg.src = demo.referenceImage;
    openFull.href = `#/demo/${demo.id}`;
    openSource.href = demo.sourceUrl;
    replaceHashSilently(`#/x/${demo.id}`);

    setSpecs([
      ['Generated with', demo.generatedWith],
      ['Subject', demo.subjectClass],
      ['Status', demo.status],
      ['Author', demo.author],
    ]);
    partsEl.hidden = true;
    controlsEl.hidden = true;
    animActions.innerHTML = '';
    showSelectedPart(null);

    // One loader per load, torn down with the exhibit it belongs to, so a fast click-through of
    // the rail cannot leave a stack of overlays behind.
    loader?.done();
    loader = createLoader(canvasMount, demo.prewarm ? 'Precomputing field' : 'Building geometry');

    teardownViewer();

    // Yield one frame for EVERY exhibit, not just the heavy ones. Without it a demo with no
    // `prewarm` created the loader and tore it down inside a single task, so the browser never
    // painted it and a texture-heavy exhibit (the AWP decodes two 1.2MB plates) showed a bare
    // canvas with no indication anything was happening.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    if (token !== loadToken || disposed) return;

    // Heavy demos precompute off the critical path; `prewarm` yields to the browser as it goes.
    if (demo.prewarm) {
      try {
        await demo.prewarm();
      } catch {
        /* a failed prewarm still lets build() run, just slower */
      }
      if (token !== loadToken || disposed) return;
      loader?.phase('Building geometry');
      // Another frame so the new phase paints before a synchronous multi-second build blocks the
      // thread — after that point nothing on screen can update until build() returns.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      if (token !== loadToken || disposed) return;
    }

    const v = new Viewer(canvasMount, {
      cameraPosition: demo.cameraPosition,
      cameraTarget: demo.cameraTarget,
      cameraFov: demo.cameraFov,
      backgroundGradient: demo.backgroundGradient,
      exposure: demo.exposure,
      environmentIntensity: demo.environmentIntensity,
      installLights: demo.installLights,
      toneMapping: demo.toneMapping,
    });
    viewer = v;

    const model = demo.build(v.scene);
    v.setExplodeRoot(model);
    // Each demo's authored camera was framed against a full-viewport canvas. The workbench has the
    // same canvas but a different aspect (a top bar and a rail eat height), which cropped wide
    // subjects — the AWP ran off the left edge. This keeps the authored ANGLE and only corrects
    // distance to fit, and it no-ops under capture so the review framing stays deterministic.
    v.fitToViewport(model);
    v.enableInspect({ onSelect: showSelectedPart });
    v.start();

    if (token !== loadToken || disposed) {
      // A newer exhibit was requested while this one was building — drop this one on the floor.
      v.dispose();
      if (viewer === v) viewer = null;
      return;
    }

    // Held until the viewer reports a real frame, so the overlay does not lift onto a blank canvas
    // while textures are still decoding and shaders compiling. Guarded by the token: a rail
    // click-through must not let a stale load dismiss the loader the current one just raised.
    const ownLoader = loader;
    ownLoader?.phase('Framing');
    void whenViewerReady().then(() => {
      if (token === loadToken && !disposed) ownLoader?.done();
    });

    const manifest = v.partManifest();
    const triangles = manifest
      ? manifest.parts.reduce((sum, p) => sum + p.triangles, 0)
      : 0;
    const version = extractVersion(demo.generatedWith);
    setSpecs([
      ['Version', version ?? '—'],
      ['Triangles', triangles ? formatCount(triangles) : '—'],
      ['Parts', manifest ? String(manifest.parts.length) : '—'],
      ['Subject', demo.subjectClass],
      ['Status', demo.status],
      ['Author', demo.author],
    ]);

    renderParts();

    // Controls appear only for what this exhibit actually supports.
    const controller = (model.userData.sculptRuntime as { animationController?: AnimationController } | undefined)
      ?.animationController;
    const hasParts = !!manifest && manifest.parts.length > 1;
    if (hasParts || controller) {
      controlsEl.hidden = false;
      explodeRange.value = '0';
      explodeOut.value = '0.00';
      explodeRange.disabled = !hasParts;
    }

    if (controller) {
      const buttons = new Map<string, HTMLButtonElement>();
      for (const action of controller.actions) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-sm';
        b.textContent = action.label;
        b.title = action.loop ? `${action.label} (loops)` : `${action.label} (plays once)`;
        b.addEventListener('click', () => {
          if (controller.active === action.id) controller.stop();
          else controller.play(action.id);
        });
        buttons.set(action.id, b);
        animActions.appendChild(b);
      }
      const sync = (active: string): void => {
        for (const [id, b] of buttons) b.classList.toggle('is-active', id === active);
      };
      sync(controller.active);
      unsubscribeAnimation = controller.subscribe(sync);
    }
  }

  /* --------------------------------------------------------------- listeners */
  const cleanups: Array<() => void> = [];
  const on = <K extends keyof HTMLElementEventMap>(
    el: HTMLElement | Document | Window,
    type: K | string,
    handler: (e: never) => void,
    opts?: AddEventListenerOptions,
  ): void => {
    el.addEventListener(type, handler as EventListener, opts);
    cleanups.push(() => el.removeEventListener(type, handler as EventListener, opts));
  };

  on(railTrack, 'click', (e: Event) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.rail-item');
    if (!btn?.dataset.index) return;
    void loadExhibit(Number(btn.dataset.index));
  });

  const step = (delta: number): void => {
    void loadExhibit((index + delta + demos.length) % demos.length);
  };
  on(mount.querySelector<HTMLElement>('#rail-prev')!, 'click', () => step(-1));
  on(mount.querySelector<HTMLElement>('#rail-next')!, 'click', () => step(1));

  on(explodeRange, 'input', () => {
    const t = Number(explodeRange.value);
    explodeOut.value = t.toFixed(2);
    viewer?.setExplode(t);
  });

  on(partList, 'click', (e: Event) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.wb-part');
    if (!btn?.dataset.part) return;
    const already = btn.classList.contains('is-active');
    viewer?.selectByName(already ? null : btn.dataset.part);
  });

  /* ---- drawers ---- */
  let openDrawer: string | null = null;

  const closeOverlays = (): void => {
    const wasDrawer = openDrawer !== null;
    openDrawer = null;
    drawer.hidden = true;
    palette.hidden = true;
    scrim.hidden = true;
    document.body.classList.remove('wb-overlay-open');
    // Hand the URL back to the exhibit, so closing the privacy page does not leave the address bar
    // claiming you are still on it.
    if (wasDrawer) replaceHashSilently(`#/x/${demos[index].id}`);
  };

  /**
   * `syncUrl` is false only when the caller IS the URL — i.e. this open came from a deep link or a
   * back/forward step, so writing the hash again would be circular.
   */
  const showDrawer = (key: string, syncUrl = true): void => {
    const entry = DRAWERS[key];
    if (!entry) return;
    if (openDrawer === key) {
      closeOverlays();
      return;
    }
    openDrawer = key;
    drawerBody.innerHTML = entry.build();
    drawer.hidden = false;
    palette.hidden = true;
    scrim.hidden = false;
    document.body.classList.add('wb-overlay-open');
    drawer.scrollTop = 0;
    mount.querySelector<HTMLElement>('#wb-drawer-close')?.focus();
    // Content pages are linkable: /#/privacy has to survive being copied out of the address bar.
    if (syncUrl) replaceHashSilently(`#/${key}`);
  };

  /**
   * Delegated at the root rather than bound per button: the menu drawer's own entries are
   * `[data-drawer]` buttons that do not exist until that drawer is built, so a one-time query over
   * the initial markup would have wired the top bar and left every menu item dead.
   */
  on(mount, 'click', (e: Event) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-drawer]');
    if (btn?.dataset.drawer) showDrawer(btn.dataset.drawer);
  });
  on(mount.querySelector<HTMLElement>('#wb-drawer-close')!, 'click', closeOverlays);
  on(scrim, 'click', closeOverlays);

  /* ---- command palette ---- */
  let palIndex = 0;

  const palMatches = (): DemoEntry[] => {
    const q = palInput.value.trim().toLowerCase();
    if (!q) return demos;
    return demos.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.id.includes(q) ||
        d.subjectClass.includes(q) ||
        d.generatedWith.toLowerCase().includes(q),
    );
  };

  const drawPalette = (): void => {
    const matches = palMatches();
    palIndex = Math.min(palIndex, Math.max(0, matches.length - 1));
    palList.innerHTML = matches.length
      ? matches
          .map(
            (d, i) => `
          <li>
            <button type="button" class="pal-item${i === palIndex ? ' is-active' : ''}" data-id="${d.id}">
              <span class="pal-title">${escapeAttr(d.title)}</span>
              <span class="pal-meta mono">${escapeAttr(d.subjectClass)} · ${escapeAttr(extractVersion(d.generatedWith) ?? '')}</span>
            </button>
          </li>`,
          )
          .join('')
      : `<li class="pal-empty">No exhibit matches that.</li>`;
  };

  const openPalette = (): void => {
    palette.hidden = false;
    drawer.hidden = true;
    openDrawer = null;
    scrim.hidden = false;
    document.body.classList.add('wb-overlay-open');
    palInput.value = '';
    palIndex = 0;
    drawPalette();
    palInput.focus();
  };

  const commitPalette = (id?: string): void => {
    const matches = palMatches();
    const target = id ?? matches[palIndex]?.id;
    if (!target) return;
    const i = demos.findIndex((d) => d.id === target);
    if (i >= 0) void loadExhibit(i);
    closeOverlays();
  };

  on(mount.querySelector<HTMLElement>('#wb-open-palette')!, 'click', openPalette);
  on(palInput, 'input', () => {
    palIndex = 0;
    drawPalette();
  });
  on(palList, 'click', (e: Event) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.pal-item');
    if (btn?.dataset.id) commitPalette(btn.dataset.id);
  });

  on(document, 'keydown', (e: KeyboardEvent) => {
    const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (palette.hidden) openPalette();
      else closeOverlays();
      return;
    }
    if (e.key === 'Escape') {
      closeOverlays();
      return;
    }
    if (!palette.hidden) {
      const matches = palMatches();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        palIndex = Math.min(palIndex + 1, matches.length - 1);
        drawPalette();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        palIndex = Math.max(palIndex - 1, 0);
        drawPalette();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        commitPalette();
      }
      return;
    }
    // Arrow keys walk the rail, but never while typing or with a drawer in front.
    if (inField || openDrawer) return;
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  });

  /**
   * The workbench owns the hash while it is mounted (main.ts deliberately does not remount it on a
   * hash change, because remounting would dispose a live viewer to rebuild it identically). That
   * leaves one gap: a hash the workbench did NOT write — a pasted `#/x/<id>`, or a back/forward
   * step — would otherwise change the URL and nothing else. Its own writes go through
   * `replaceHashSilently`, which uses replaceState and fires no event, so this cannot loop.
   */
  on(window, 'hashchange', () => {
    const route = parseRoute(window.location.hash);
    if (route.name === 'drawer') {
      // `false`: the URL is already what it should be — this open came FROM it.
      showDrawer(route.key, false);
      return;
    }
    if (route.name === 'workbench') {
      if (openDrawer) closeOverlays();
      const target = demos.findIndex((d) => d.id === route.id);
      if (target >= 0 && target !== index) void loadExhibit(target);
      return;
    }
    if (route.name === 'home' && openDrawer) closeOverlays();
  });

  /* ------------------------------------------------------------------ start */
  railCount.textContent = `${String(index + 1).padStart(2, '0')} / ${demos.length}`;
  void loadExhibit(index);
  // A deep link straight to a content page opens it over the workbench, which keeps loading behind
  // it — the reader gets the page immediately and the exhibit is already there when they close it.
  //
  // Writes the URL (rather than trusting the one that got us here) because `loadExhibit` above
  // already replaced the hash with its exhibit synchronously. Skipping the write left a visitor who
  // opened /#/how-it-works looking at /#/x/awp-medusa-v2, so the link they were about to share no
  // longer pointed at the page they were reading.
  if (initialDrawer) showDrawer(initialDrawer);

  return () => {
    disposed = true;
    loadToken++;
    for (const off of cleanups) off();
    teardownViewer();
    // The loader lives in the canvas mount, which innerHTML would take with it anyway — removing it
    // explicitly keeps its pending timer from firing against a detached node.
    loader?.done();
    loader = null;
    document.body.classList.remove('wb-overlay-open');
  };
}
