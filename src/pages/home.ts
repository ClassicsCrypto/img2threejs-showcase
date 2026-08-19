import { demos, type DemoEntry } from '../demos/registry';
import { HeroStage } from '../hero-stage';
import {
  ARROW_OUT,
  BASE,
  brand,
  CHANGELOG_URL,
  COFFEE_URL,
  CONTACT_EMAIL,
  CONTACT_NAME,
  CURRENT_VERSION,
  DISCORD_URL,
  DONATE_URL,
  GITHUB_CORE,
  GITHUB_SHOWCASE,
  HEART,
  LICENSE_URL,
  ROADMAP,
  ROADMAP_URL,
  SITE_URL,
  SPONSORS,
} from '../site-data';

const VERSION_TAG = /v\d+(?:\.\d+){0,2}(?:-[a-z0-9.]+)?/i;

function extractVersion(generatedWith: string): string | null {
  const match = generatedWith.match(VERSION_TAG);
  return match ? match[0] : null;
}

/** Attribute-safe: these strings land in `title="…"`, so the quote characters have to go. */
function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}


const STATUS_LABEL: Record<string, string> = {
  shipped: 'Shipped',
  latest: 'Latest release',
  'in-progress': 'In progress',
  planned: 'Planned',
};

/**
 * Watches every `.reveal-io` element and flips it to `.in-view` the first time it crosses into
 * the viewport, so each section (roadmap stage, sponsor block, contact card) animates in on its
 * own as the page scrolls, instead of all firing at once on mount.
 */
function observeReveals(root: HTMLElement): () => void {
  const items = Array.from(root.querySelectorAll<HTMLElement>('.reveal-io'));
  if (items.length === 0) return () => {};
  if (!('IntersectionObserver' in window)) {
    for (const el of items) el.classList.add('in-view');
    return () => {};
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.16, rootMargin: '0px 0px -8% 0px' },
  );
  for (const el of items) io.observe(el);
  return () => io.disconnect();
}

/**
 * One exhibit card. Every text block is line-clamped rather than character-truncated, because the
 * registry's blurbs run from one sentence to a full paragraph and cutting by character count left
 * the cards at visibly different heights with words sliced mid-syllable.
 *
 * `generatedWith` is the other reason the old grid looked untidy: the longest entry is 113
 * characters, which wrapped a "chip" onto three lines. It stays in full — that is the version
 * detail this page exists to report — but on one ellipsised line, with the untruncated string on
 * the `title` tooltip and the version itself lifted out into its own chip over the image.
 */
function renderCard(demo: DemoEntry, index: number): string {
  const version = extractVersion(demo.generatedWith);
  return `
    <a class="card reveal-io" href="#/demo/${demo.id}" data-index="${index}" style="--i:${index}"
       data-class="${demo.subjectClass}">
      <div class="card-media">
        <img class="card-thumb" src="${demo.referenceImage}" alt="${demo.title} reference"
             loading="lazy" onerror="this.classList.add('missing')" />
        <span class="card-chips">
          ${version ? `<span class="card-version">${version}</span>` : ''}
          <span class="card-status status-${demo.status}">${demo.status}</span>
        </span>
      </div>
      <div class="card-body">
        <div class="card-meta">
          <span class="badge badge-${demo.subjectClass}">${demo.subjectClass}</span>
          <span class="card-author">${demo.author}</span>
        </div>
        <h3 class="card-title">${demo.title}</h3>
        <p class="card-blurb">${brand(demo.blurb)}</p>
        <div class="card-foot">
          <span class="card-pipeline" title="${escapeAttr(demo.generatedWith)}">${brand(demo.generatedWith)}</span>
          <span class="card-open" aria-hidden="true">Open &rarr;</span>
        </div>
      </div>
    </a>`;
}

function renderRoadmapItem(entry: (typeof ROADMAP)[number], index: number): string {
  const highlights = entry.highlights.map((h) => `<li>${brand(h)}</li>`).join('');
  const changelogLink = entry.status === 'planned' || entry.status === 'in-progress'
    ? ''
    : `<a class="road-link" href="${CHANGELOG_URL}" target="_blank" rel="noopener noreferrer">Changelog ${ARROW_OUT}</a>`;
  // Surfaced rather than buried: ROADMAP.md names what a release left out, and a roadmap that
  // lists only wins is the kind of claim this project's own docs refuse to make.
  const notShipped = entry.notShipped
    ? `<p class="road-not-shipped"><span class="road-not-shipped-label">Not shipped</span> ${entry.notShipped}</p>`
    : '';
  return `
    <li class="road-item road-${entry.status} reveal-io" style="--i:${index}">
      <span class="road-marker" aria-hidden="true"></span>
      <div class="road-card">
        <div class="road-head">
          <span class="road-version">${entry.version}</span>
          <span class="road-status road-status-${entry.status}">${STATUS_LABEL[entry.status]}</span>
          ${entry.date ? `<span class="road-date">${entry.date}</span>` : ''}
        </div>
        <h3 class="road-theme">${entry.theme}</h3>
        <ul class="road-highlights">${highlights}</ul>
        ${notShipped}
        ${changelogLink}
      </div>
    </li>`;
}

function renderSponsorLogo(sponsor: (typeof SPONSORS)[number]): string {
  return `
    <a class="sponsor-logo" href="${sponsor.url}" target="_blank" rel="noopener noreferrer" title="${sponsor.name}">
      <img src="${sponsor.logo}" alt="${sponsor.name}" loading="lazy" />
    </a>`;
}

/**
 * A marquee only reads as one when the whole strip translates together, so the loop lives on an
 * inner track that holds the list twice and slides exactly -50%: at that point copy two sits
 * where copy one started and the reset is invisible. Animating each logo instead would move every
 * mark by its own width, which is a different distance per logo and visibly tears the row apart.
 *
 * Below the threshold there is nothing to scroll — the logos are centered and left alone.
 */
const MARQUEE_MIN_SPONSORS = 5;

function renderSponsorTrack(): string {
  const logos = SPONSORS.map(renderSponsorLogo).join('');
  if (SPONSORS.length < MARQUEE_MIN_SPONSORS) {
    return `<div class="sponsor-track center reveal-io">${logos}</div>`;
  }
  return `
    <div class="sponsor-track marquee reveal-io">
      <div class="sponsor-marquee-inner">${logos}${logos}</div>
    </div>`;
}

/** Renders the home page and returns a cleanup function that tears down the hero stage. */
export function renderHome(mount: HTMLElement): () => void {
  const firstId = demos[0]?.id ?? '';

  const cards = demos.map(renderCard).join('');
  const sponsorTrack = renderSponsorTrack();
  const roadmapItems = ROADMAP.map(renderRoadmapItem).join('');

  // Counts come off the registry rather than being written down, so a new demo cannot leave the
  // filter labels lying about how many exhibits are behind them.
  const countOf = (subjectClass: DemoEntry['subjectClass']): number =>
    demos.filter((demo) => demo.subjectClass === subjectClass).length;
  const filters: Array<{ id: string; label: string; count: number }> = [
    { id: 'all', label: 'All', count: demos.length },
    { id: 'character', label: 'Characters', count: countOf('character') },
    { id: 'object', label: 'Objects', count: countOf('object') },
  ];
  const filterChips = filters
    .filter((filter) => filter.count > 0)
    .map(
      (filter) => `
        <button type="button" class="filter-chip${filter.id === 'all' ? ' is-active' : ''}"
                data-filter="${filter.id}" aria-pressed="${filter.id === 'all'}">
          ${filter.label}<span class="filter-count">${filter.count}</span>
        </button>`,
    )
    .join('');

  mount.innerHTML = `
    <div class="home">
      <div class="aurora" aria-hidden="true"></div>

      <header class="nav">
        <a class="brand" href="#/">
          <img class="brand-mark" src="${BASE}favicon.svg" alt="" width="30" height="30" />
          <span class="brand-name grad">img2threejs</span>
        </a>
        <nav class="nav-links" aria-label="Sections">
          <button type="button" class="nav-link" data-scroll="showcases">Showcases</button>
          <button type="button" class="nav-link" data-scroll="roadmap">Roadmap</button>
          <button type="button" class="nav-link" data-scroll="sponsors">Sponsors</button>
          <button type="button" class="nav-link" data-scroll="contact">Contact</button>
        </nav>
        <div class="nav-actions">
          <button type="button" class="nav-sponsor" data-scroll="sponsors">
            <span class="nav-sponsor-dot" aria-hidden="true"></span> Sponsor
          </button>
          <a class="nav-star" href="${GITHUB_CORE}" target="_blank" rel="noopener noreferrer">
            &#9733; Star <span class="nav-label-long">on GitHub</span>
          </a>
        </div>
      </header>

      <section class="hero">
        <div class="hero-copy">
          <span class="hero-eyebrow">live demo gallery &middot; <span class="grad">img2threejs</span> ${CURRENT_VERSION}</span>
          <h1 class="hero-title">
            One photo in.<br />
            A <span class="grad">procedural 3D</span> model out.
          </h1>
          <p class="hero-sub">
            <span class="grad">img2threejs</span> rebuilds the object or character in a single reference image as a
            quality-gated, animation-ready Three.js model &mdash; written entirely in code,
            no imported meshes. Everything below is running live in your browser.
          </p>
          <div class="cta-row">
            <a class="btn btn-primary" href="#/demo/${firstId}">Explore the demos</a>
            <a class="btn btn-star" href="${GITHUB_CORE}" target="_blank" rel="noopener noreferrer">
              &#9733; Star <span class="grad">img2threejs</span>
            </a>
          </div>
          <ol class="pipeline" aria-label="how it works">
            <li><span class="pip-num">01</span> Reference photo</li>
            <li class="pip-arrow" aria-hidden="true">&rarr;</li>
            <li><span class="pip-num">02</span> Analyze &amp; spec</li>
            <li class="pip-arrow" aria-hidden="true">&rarr;</li>
            <li><span class="pip-num">03</span> Procedural Three.js</li>
          </ol>
        </div>

        <div class="hero-stage">
          <figure class="stage-input" id="stage-input">
            <img class="stage-photo" id="stage-photo" alt="current demo source reference"
                 onerror="this.closest('.stage-input').classList.add('no-photo')" />
            <figcaption>source photo</figcaption>
          </figure>
          <div class="stage-beam" aria-hidden="true"></div>
          <div class="stage-canvas" id="hero-canvas">
            <span class="stage-badge" id="stage-badge"></span>
            <span class="stage-hint">rebuilt in code</span>
          </div>
        </div>
      </section>

      <section class="gallery" id="showcases">
        <div class="gallery-head reveal-io">
          <div class="section-head">
            <span class="section-kicker">Showcases</span>
            <h2>Live reconstructions</h2>
            <p>Each model is generated TypeScript &mdash; orbit it, and read the source it was built from.</p>
          </div>
          <div class="gallery-filters" role="group" aria-label="Filter showcases by subject">
            ${filterChips}
          </div>
        </div>
        <div class="grid" id="gallery-grid" data-filter="all">${cards}</div>
      </section>

      <section class="roadmap" id="roadmap">
        <div class="section-head reveal-io">
          <span class="section-kicker">Roadmap</span>
          <h2>Where <span class="grad">img2threejs</span> is going</h2>
          <p>
            One theme per release, from single-object reconstruction toward whole playable worlds.
            <a class="road-link" href="${ROADMAP_URL}" target="_blank" rel="noopener noreferrer">Full roadmap ${ARROW_OUT}</a>
          </p>
        </div>
        <ol class="road-list">${roadmapItems}</ol>
      </section>

      <section class="sponsors" id="sponsors">
        <div class="section-head reveal-io">
          <span class="section-kicker">Sponsors</span>
          <h2>Backing <span class="grad">img2threejs</span> development</h2>
          <p>${brand(SPONSORS[0]?.blurb ?? 'img2threejs is free and open source, sponsored by the community that uses it.')}</p>
        </div>
        ${sponsorTrack}
        <div class="sponsor-cta-row reveal-io">
          <a class="btn btn-sponsor-highlight" href="${COFFEE_URL}" target="_blank" rel="noopener noreferrer">
            ${HEART} Buy me a coffee
          </a>
          <a class="btn btn-star" href="${DONATE_URL}" target="_blank" rel="noopener noreferrer">
            VietQR &middot; MoMo &middot; PayPal
          </a>
          <a class="btn" href="${DISCORD_URL}" target="_blank" rel="noopener noreferrer">
            Join the Discord
          </a>
        </div>
      </section>

      <section class="authenticity" id="official">
        <div class="auth-card reveal-io">
          <span class="section-kicker">Official source</span>
          <h2>This is the one official <span class="grad">img2threejs</span> showcase</h2>
          <p>
            Every model on this page is generated code, published straight from the repositories below.
            ${brand('img2threejs')} does not sell reconstructions, and takes money only through the
            channels named at the end of this section. A site that claims to be ${brand('img2threejs')}
            without linking back to these repositories is not affiliated with this project.
          </p>
          <ul class="auth-list">
            <li><span class="auth-label">This site</span>
              <a href="${SITE_URL}">${SITE_URL.replace(/^https:\/\//, '').replace(/\/$/, '')}</a></li>
            <li><span class="auth-label">Core tool</span>
              <a href="${GITHUB_CORE}" target="_blank" rel="noopener noreferrer">${GITHUB_CORE.replace(/^https:\/\//, '')}</a></li>
            <li><span class="auth-label">This gallery</span>
              <a href="${GITHUB_SHOWCASE}" target="_blank" rel="noopener noreferrer">${GITHUB_SHOWCASE.replace(/^https:\/\//, '')}</a></li>
            <li><span class="auth-label">Community</span>
              <a href="${DISCORD_URL}" target="_blank" rel="noopener noreferrer">discord.gg/8DS8RTyuR</a></li>
          </ul>
          <p class="auth-pay">
            The only channels that ever take money for this project:
            <a href="${COFFEE_URL}" target="_blank" rel="noopener noreferrer">buymeacoffee.com/hoainhowors</a>,
            the <a href="${DONATE_URL}" target="_blank" rel="noopener noreferrer">donate page</a> on this
            domain (VietQR / MoMo / PayPal), and GitHub Sponsors. Anything else asking you to pay for
            ${brand('img2threejs')} is not us &mdash; report it to
            <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.
          </p>
        </div>
      </section>

      <section class="contact" id="contact">
        <div class="section-head reveal-io">
          <span class="section-kicker">Contact</span>
          <h2>Talk to the maintainer</h2>
        </div>
        <div class="contact-card reveal-io">
          <a class="contact-email" href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>
          <span class="contact-name">${CONTACT_NAME} (Hoài Nhớ) &middot; maintainer</span>
          <div class="contact-links">
            <a href="${GITHUB_CORE}" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href="${DISCORD_URL}" target="_blank" rel="noopener noreferrer">Discord</a>
          </div>
        </div>
      </section>

      <footer class="footer">
        <div class="footer-brand grad">img2threejs</div>
        <div class="footer-links">
          <a href="${GITHUB_CORE}" target="_blank" rel="noopener noreferrer">Core repository</a>
          <a href="${GITHUB_SHOWCASE}" target="_blank" rel="noopener noreferrer">Showcase source</a>
          <a href="${LICENSE_URL}" target="_blank" rel="noopener noreferrer">Apache License 2.0</a>
          <a href="${DONATE_URL}" target="_blank" rel="noopener noreferrer">Sponsor this project</a>
        </div>
        <div class="footer-copy">&copy; ${new Date().getFullYear()} Hoài Nhớ. Licensed under Apache-2.0 &mdash; free and open source.</div>
      </footer>
    </div>
  `;

  // Entrance animation: reveal on next frame.
  const home = mount.querySelector('.home') as HTMLElement;
  requestAnimationFrame(() => home.classList.add('ready'));

  // In-page navigation: plain scroll, never a hash route change (that would replay the
  // intro-to-content mount cycle and reset scroll position for no reason).
  for (const btn of mount.querySelectorAll<HTMLButtonElement>('[data-scroll]')) {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.scroll;
      if (!targetId) return;
      mount.querySelector(`#${targetId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // Subject filter. One delegated listener, and the hiding itself is a CSS attribute match on the
  // grid — no per-card style writes, so a filtered card keeps its own reveal/hover state intact
  // and switching filters cannot leave inline styles behind.
  const grid = mount.querySelector<HTMLElement>('#gallery-grid');
  const filterBar = mount.querySelector<HTMLElement>('.gallery-filters');
  filterBar?.addEventListener('click', (event) => {
    const chip = (event.target as HTMLElement).closest<HTMLButtonElement>('.filter-chip');
    if (!chip?.dataset.filter || !grid) return;
    grid.dataset.filter = chip.dataset.filter;
    for (const other of filterBar.querySelectorAll<HTMLButtonElement>('.filter-chip')) {
      const selected = other === chip;
      other.classList.toggle('is-active', selected);
      other.setAttribute('aria-pressed', String(selected));
    }
  });

  const disconnectReveals = observeReveals(mount);

  // Wire the hero 3D stage.
  const canvasMount = mount.querySelector('#hero-canvas') as HTMLElement;
  const photo = mount.querySelector('#stage-photo') as HTMLImageElement;
  const badge = mount.querySelector('#stage-badge') as HTMLElement;
  const cardEls = Array.from(mount.querySelectorAll<HTMLElement>('.card'));

  let stage: HeroStage | null = null;

  const onDemo = (demo: DemoEntry, index: number): void => {
    // Crossfade the source photo to match the demo currently materializing.
    const input = mount.querySelector('#stage-input') as HTMLElement;
    input.classList.remove('no-photo');
    input.classList.add('swapping');
    window.setTimeout(() => {
      photo.src = demo.referenceImage;
      input.classList.remove('swapping');
    }, 260);
    badge.textContent = demo.title;
    cardEls.forEach((el, i) => el.classList.toggle('active', i === index));
  };

  if (demos.length > 0) {
    stage = new HeroStage(canvasMount, demos, onDemo);
    stage.start();
    // Hovering a card jumps the turntable to that demo.
    cardEls.forEach((el) => {
      el.addEventListener('mouseenter', () => {
        const idx = Number(el.dataset.index);
        if (!Number.isNaN(idx)) stage?.focus(idx);
      });
    });
  }

  return () => {
    disconnectReveals();
    stage?.dispose();
    stage = null;
  };
}
