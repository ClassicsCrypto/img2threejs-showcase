#!/usr/bin/env node
/**
 * Renders the repo's star history as two self-contained SVGs (light + dark) under
 * .github/readme-assets/, so the README never depends on star-history.com — whose
 * anonymous stargazer API GitHub restricted in 2026, leaving the embed showing
 * "GitHub restricted access to star data" instead of a chart.
 *
 * The data comes straight from GitHub's own stargazers API, which still serves
 * `starred_at` to any *authenticated* caller. In CI that caller is the workflow's
 * built-in GITHUB_TOKEN, so nothing secret ever lands in the README.
 *
 *   GITHUB_TOKEN=$(gh auth token) node scripts/generate-star-history.mjs
 *
 * Env:
 *   GITHUB_TOKEN / GH_TOKEN  required — any token with public repo read access
 *   GITHUB_REPOSITORY        owner/repo (default: hoainho/img2threejs-showcase)
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, '.github/readme-assets');

const REPO = process.env.GITHUB_REPOSITORY || 'hoainho/img2threejs-showcase';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

/** Hard stop so a runaway repo can't spin forever; 100 stars per page. */
const MAX_PAGES = 400;

const W = 840;
const H = 420;
const PAD = { top: 28, right: 28, bottom: 46, left: 64 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const THEMES = {
  light: {
    bg: '#ffffff',
    grid: '#e6e8eb',
    axis: '#c9ced6',
    text: '#57606a',
    title: '#1f2328',
    line: '#e2803c',
    areaTop: 'rgba(226,128,60,0.28)',
    areaBottom: 'rgba(226,128,60,0.02)',
    dot: '#e2803c',
  },
  dark: {
    bg: '#0d1117',
    grid: '#20262d',
    axis: '#30363d',
    text: '#8b949e',
    title: '#e6edf3',
    line: '#f0883e',
    areaTop: 'rgba(240,136,62,0.32)',
    areaBottom: 'rgba(240,136,62,0.02)',
    dot: '#f0883e',
  },
};

async function fetchStargazers() {
  if (!TOKEN) {
    throw new Error(
      'No GITHUB_TOKEN/GH_TOKEN in the environment. GitHub no longer serves star\n' +
        'timestamps to anonymous callers. Locally: GITHUB_TOKEN=$(gh auth token) node scripts/generate-star-history.mjs',
    );
  }

  const stars = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `https://api.github.com/repos/${REPO}/stargazers?per_page=100&page=${page}`;
    const res = await fetch(url, {
      headers: {
        // This media type is what makes GitHub return `starred_at` at all.
        Accept: 'application/vnd.github.star+json',
        Authorization: `Bearer ${TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'img2threejs-showcase-star-history',
      },
    });

    if (!res.ok) {
      throw new Error(`GitHub API ${res.status} ${res.statusText} on page ${page}: ${await res.text()}`);
    }

    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const entry of batch) {
      if (entry?.starred_at) stars.push(new Date(entry.starred_at));
    }
    if (batch.length < 100) break;
  }

  stars.sort((a, b) => a - b);
  return stars;
}

/**
 * Cumulative series, thinned to at most `max` points so the path stays small.
 *
 * The line deliberately ends at the most recent star rather than being extended
 * to "today": that keeps the SVG a pure function of the star data, so the daily
 * workflow only produces a commit when a star actually arrived.
 */
function toSeries(stars, max = 220) {
  if (stars.length === 0) return [];

  const points = stars.map((date, i) => ({ t: date.getTime(), count: i + 1 }));

  if (points.length <= max) return points;

  const step = (points.length - 1) / (max - 1);
  const thinned = [];
  for (let i = 0; i < max; i += 1) thinned.push(points[Math.round(i * step)]);
  thinned[thinned.length - 1] = points[points.length - 1];
  return thinned;
}

/** Gridline values from 0 up to at least `maxValue` — the top tick must cover the
 *  real total, or the curve draws above the plot area and over the header. */
function niceTicks(maxValue, target = 5) {
  const raw = Math.max(maxValue, 1) / target;
  const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const norm = raw / mag;
  const stepNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  const step = Math.max(stepNorm * mag, 1);

  const ticks = [];
  for (let v = 0; v < maxValue; v += step) ticks.push(Math.round(v));
  ticks.push(Math.round(Math.ceil(maxValue / step) * step));
  return ticks;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DAY = 86_400_000;

/**
 * Picks label granularity from the range being plotted: a six-week-old repo
 * labelled by month reads as "Jul 2026, Jul 2026, Aug 2026, Aug 2026".
 */
function dateFormatter(spanMs) {
  if (spanMs <= 120 * DAY) {
    return (ms) => {
      const d = new Date(ms);
      return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
    };
  }
  if (spanMs <= 900 * DAY) {
    return (ms) => {
      const d = new Date(ms);
      return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    };
  }
  return (ms) => String(new Date(ms).getUTCFullYear());
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderSvg(series, { theme, total, repo }) {
  const c = THEMES[theme];
  const id = `sh-${theme}`;

  if (series.length === 0) {
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Star history for ${esc(repo)}: no stars yet">`,
      `<rect width="${W}" height="${H}" fill="${c.bg}"/>`,
      `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="15" fill="${c.text}">No stars yet — be the first.</text>`,
      '</svg>',
    ].join('\n');
  }

  const t0 = series[0].t;
  const t1 = series[series.length - 1].t;
  const span = Math.max(t1 - t0, 1);

  const yTicks = niceTicks(total);
  const yMax = Math.max(yTicks[yTicks.length - 1], 1);

  const x = (t) => PAD.left + ((t - t0) / span) * PLOT_W;
  const y = (v) => PAD.top + PLOT_H - (v / yMax) * PLOT_H;

  const line = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)} ${y(p.count).toFixed(1)}`).join(' ');
  const area = `${line} L${x(t1).toFixed(1)} ${(PAD.top + PLOT_H).toFixed(1)} L${x(t0).toFixed(1)} ${(PAD.top + PLOT_H).toFixed(1)} Z`;

  const gridLines = yTicks
    .map((v) => {
      const yy = y(v).toFixed(1);
      return (
        `<line x1="${PAD.left}" y1="${yy}" x2="${PAD.left + PLOT_W}" y2="${yy}" stroke="${c.grid}" stroke-width="1"/>` +
        `<text x="${PAD.left - 12}" y="${yy}" dy="0.32em" text-anchor="end" font-size="12" fill="${c.text}">${v}</text>`
      );
    })
    .join('\n  ');

  const xTickCount = 5;
  const fmt = dateFormatter(span);
  let previousLabel = null;
  const xLabels = Array.from({ length: xTickCount }, (_, i) => {
    const t = t0 + (span * i) / (xTickCount - 1);
    const label = fmt(t);
    // Two ticks landing in the same month/day would print the same string twice.
    if (label === previousLabel) return '';
    previousLabel = label;
    // Keep the first and last labels inside the canvas instead of centred on the axis end.
    const anchor = i === 0 ? 'start' : i === xTickCount - 1 ? 'end' : 'middle';
    return `<text x="${x(t).toFixed(1)}" y="${PAD.top + PLOT_H + 24}" text-anchor="${anchor}" font-size="12" fill="${c.text}">${label}</text>`;
  })
    .filter(Boolean)
    .join('\n  ');

  const lastX = x(t1).toFixed(1);
  const lastY = y(total).toFixed(1);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Star history for ${esc(repo)}: ${total} stars">
  <title>${esc(repo)} — ${total} stars</title>
  <defs>
    <linearGradient id="${id}-fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${c.areaTop}"/>
      <stop offset="100%" stop-color="${c.areaBottom}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${c.bg}"/>
  <g font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif">
  <text x="${PAD.left}" y="18" font-size="13" font-weight="600" fill="${c.title}">${esc(repo)}</text>
  <text x="${PAD.left + PLOT_W}" y="18" text-anchor="end" font-size="13" fill="${c.text}">${total} stars</text>
  ${gridLines}
  <path d="${area}" fill="url(#${id}-fill)"/>
  <path d="${line}" fill="none" stroke="${c.line}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${lastX}" cy="${lastY}" r="4" fill="${c.dot}" stroke="${c.bg}" stroke-width="2"/>
  <line x1="${PAD.left}" y1="${PAD.top + PLOT_H}" x2="${PAD.left + PLOT_W}" y2="${PAD.top + PLOT_H}" stroke="${c.axis}" stroke-width="1"/>
  ${xLabels}
  </g>
</svg>
`;
}

async function main() {
  const stars = await fetchStargazers();
  const series = toSeries(stars);
  const total = stars.length;

  await mkdir(OUT_DIR, { recursive: true });
  for (const theme of ['light', 'dark']) {
    const svg = renderSvg(series, { theme, total, repo: REPO });
    await writeFile(resolve(OUT_DIR, `star-history-${theme}.svg`), svg, 'utf8');
  }

  console.log(`star history: ${total} stars → .github/readme-assets/star-history-{light,dark}.svg`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
