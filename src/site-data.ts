/**
 * Single source of truth for site-wide links, contact info, sponsors and the public roadmap
 * summary. Pulled from img2threejs's own README.md / ROADMAP.md / CHANGELOG.md so the marketing
 * shell never invents a claim the core project doesn't already make.
 */

export const BASE = import.meta.env.BASE_URL;

/**
 * Canonical identity is the `img2threejs` org, confirmed by the maintainer: it is what the core
 * tool's own README and its git origin use. `hoainho/…` (this showcase's README, and `registry.ts`
 * before it was aligned) is the personal fork, and `img2threejs-showcase.pages.dev` — cited in the
 * core ROADMAP — is a secondary deploy. The authenticity section states these verbatim, so they
 * must not drift: `registry.ts`'s `REPO` is aligned to the same org.
 *
 * Still stale and worth a follow-up commit outside this redesign: this repo's own README.md links
 * `hoainho.github.io/img2threejs-showcase/` in 8 places.
 */
export const GITHUB_CORE = 'https://github.com/img2threejs/img2threejs';
export const GITHUB_SHOWCASE = 'https://github.com/img2threejs/img2threejs-showcase';
export const SITE_URL = 'https://img2threejs.github.io/img2threejs-showcase/';
export const CHANGELOG_URL = `${GITHUB_CORE}/blob/main/CHANGELOG.md`;
export const ROADMAP_URL = `${GITHUB_CORE}/blob/main/ROADMAP.md`;
export const LICENSE_URL = `${GITHUB_CORE}/blob/main/LICENSE`;
export const DISCORD_URL = 'https://discord.gg/8DS8RTyuR';
export const COFFEE_URL = 'https://www.buymeacoffee.com/hoainhowors';
export const DONATE_URL = `${BASE}donate.html`;

export const CONTACT_EMAIL = 'hoainho.work@gmail.com';
export const CONTACT_NAME = 'Nick';
export const CURRENT_VERSION = 'v1.5.0';

/**
 * Wraps every occurrence of the product name in the animated gradient span, so the brand reads the
 * same everywhere it appears — including inside strings that come from the registry (blurbs and
 * `generatedWith` version chips) rather than from a page's own markup.
 *
 * Lives here rather than in one page because both the gallery and the demo viewer render registry
 * strings, and the demo viewer having its own un-branded copy is exactly how it ended up with zero
 * gradient nodes on the page.
 *
 * Emits markup, so it belongs in text positions only, never inside an attribute value.
 */
export function brand(text: string): string {
  return text.replace(/img2threejs/g, '<span class="grad">img2threejs</span>');
}

/**
 * U+FE0E, the text-presentation variation selector. `♥` (U+2665) and `↗` (U+2197) are both
 * `Emoji=Yes`, so iOS and Android swap in the colour emoji glyph by default — which would put
 * emoji on a page whose whole brief is "no emoji, coding style only". This pins them to the
 * monospace text glyph.
 */
export const TEXT_GLYPH = '︎';
export const HEART = `&#9829;${TEXT_GLYPH}`;
export const ARROW_OUT = `&#8599;${TEXT_GLYPH}`;

export interface SponsorEntry {
  name: string;
  url: string;
  /** The site renders dark-only (`color-scheme: dark`), so one light-on-dark mark is all it needs. */
  logo: string;
  blurb: string;
}

/**
 * Logo sponsors, in the order they should render. Kept centered rather than looped while the
 * list is short — a marquee of one logo just reads as a stuck slider.
 */
export const SPONSORS: SponsorEntry[] = [
  {
    name: 'Atlas Cloud',
    url: 'https://www.atlascloud.ai/console/coding-plan',
    logo: `${BASE}sponsors/atlas-cloud-logomark-white.svg`,
    blurb:
      'A full-modal AI inference platform: one API for video generation, image generation and ' +
      'LLM access across 300+ curated models, instead of managing a separate integration per vendor.',
  },
];

export type RoadmapStatus = 'shipped' | 'latest' | 'in-progress' | 'planned';

export interface RoadmapEntry {
  version: string;
  theme: string;
  status: RoadmapStatus;
  date?: string;
  highlights: string[];
  /** What a release deliberately did NOT deliver. ROADMAP.md tracks this; hiding it would oversell. */
  notShipped?: string;
}

/**
 * Condensed from img2threejs/ROADMAP.md's own table — version numbers, theme names, statuses and
 * dates are copied exactly; the highlight bullets are shortened from the table's cells, not quoted
 * verbatim, and no capability appears here that the table does not already claim.
 *
 * Two rows carry emphasis because the doc gives them two different kinds of "now": `v1.5` is the
 * latest shipped release (ROADMAP.md "Shipped", CHANGELOG `[1.5.0] — 2026-08-12`), while
 * `v1.2-gates` is the only row the table marks **In progress**. Labelling v1.5 "current" alone
 * would have contradicted its own source doc.
 */
export const ROADMAP: RoadmapEntry[] = [
  {
    version: 'v1.0', theme: 'Object pipeline', status: 'shipped', date: '2026-07-15',
    highlights: [
      'Staged sculpt pipeline, blockout through optimization',
      'Render-vs-reference review loop',
      'Action-ready runtime hierarchy',
    ],
  },
  {
    version: 'v1.1', theme: 'Detail-first analysis', status: 'shipped', date: '2026-07-15',
    highlights: [
      'Required detailInventory artifact (gloss, bevel, fasteners, linework, stains)',
      'Strict-quality gate blocking shallow specs before codegen',
    ],
  },
  {
    version: 'v1.2-gates', theme: 'Portable structural gates', status: 'in-progress',
    highlights: [
      'Portable ledger, geometry, evidence and report gates run in forge scripts',
      'Host-specific tool-call enforcement is deferred',
    ],
  },
  {
    version: 'v1.2', theme: 'Humanoid character generator', status: 'shipped', date: '2026-07-21',
    highlights: [
      'Character / hybrid domain detection',
      'Anatomy and facial landmarks',
      'Proportion-lock and feature-placement build passes, per-part character materials',
    ],
  },
  {
    version: 'v1.3', theme: 'Quality & efficiency (Divine Eye)', status: 'shipped', date: '2026-07-22',
    highlights: [
      'Deterministic review harness',
      'Input-integrity and geometry-truth gates',
      'Projection-first texture/material analysis, CIEDE2000 colour math',
    ],
  },
  {
    version: 'v1.4', theme: 'The Weapon Update', status: 'shipped', date: '2026-07-25–26',
    highlights: [
      'CS2 image-matched reconstruction, provenance-aware intake',
      'Projection-first finishes, family-specific adapters',
      'Structural and component-coverage gates',
    ],
  },
  {
    version: 'v1.5', theme: 'The Character Update', status: 'latest', date: '2026-08-12',
    highlights: [
      'Component-derived skeleton bound to SkinnedMesh geometry, geodesic skinning',
      'Hair subsystem across all five stages, chirality gates',
      'Interior-difference review, material pipeline, resumable workflow state',
    ],
    notShipped: 'hairProfile compiler, IK, pose-sweep gating, clothing',
  },
  {
    version: 'v1.6', theme: 'The Environment Update', status: 'planned',
    highlights: [
      'Buildings, rooms, streets, trees & vegetation',
      'Terrain-aware generation',
      'Multi-object reconstruction',
    ],
  },
  {
    version: 'v1.7', theme: 'The Game Pipeline Update', status: 'planned',
    highlights: [
      'Unity exporter, Unreal exporter, Blender bridge',
      'FBX / OBJ / glTF improvements',
      'LOD generation, collision mesh generation',
    ],
  },
  {
    version: 'v1.8', theme: 'The Animation Update', status: 'planned',
    highlights: [
      'Auto rigging, auto skin weights',
      'Mixamo compatibility, facial rig',
      'Lip-sync preparation, animation-ready exports',
    ],
  },
  {
    version: 'v1.9', theme: 'The AI Studio Update', status: 'planned',
    highlights: [
      'Web UI, drag & drop workflow',
      'Batch processing, visual prompt builder',
      'Cloud rendering, public showcase integration',
    ],
  },
  {
    version: 'v2.0', theme: 'The Procedural World Update', status: 'planned',
    highlights: [
      'Multi-view reconstruction, semantic world understanding',
      'Procedural city generation, interior reconstruction',
      'Plugin ecosystem & API',
    ],
  },
];

/**
 * The version tag inside a `generatedWith` string.
 *
 * Shared rather than copied: the workbench readout and the demo panel's version badge must never
 * disagree about which version built an exhibit. Case-insensitive because one entry records `V2`, and
 * the optional suffix catches `v1.5-beta`. Returns null for the entries that name no version at all --
 * the reference baseline is rendered as shipped, so there is nothing to claim.
 */
const VERSION_TAG = /v\d+(?:\.\d+){0,2}(?:-[a-z0-9.]+)?/i;

export function extractVersion(generatedWith: string): string | null {
  return generatedWith.match(VERSION_TAG)?.[0] ?? null;
}

/** Escape text destined for an HTML attribute. */
export function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
