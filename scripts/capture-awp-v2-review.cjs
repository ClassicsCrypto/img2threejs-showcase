const { chromium } = require('/Users/tamlh/.npm/_npx/420ff84f11983ee5/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const base = 'http://127.0.0.1:5173/img2threejs-showcase/';
const out = process.env.AWP_V2_REVIEW_DIR || path.join(process.cwd(), '.img2threejs', 'v2', 'renders', 'pass-0');
const executablePath = '/Users/tamlh/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
fs.mkdirSync(out, { recursive: true });

async function quiet(page) {
  await page.evaluate(() => {
    document.querySelector('.demo-panel')?.setAttribute('style', 'display:none');
    document.querySelector('.hint')?.setAttribute('style', 'display:none');
  });
}

async function open(page, query = '', freeze = true) {
  const params = [];
  if (freeze) params.push('capture=1');
  if (query) params.push(query.replace(/^&/, ''));
  await page.goto(`${base}?${params.join('&')}#/demo/awp-medusa-v2`, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas');
  await page.waitForTimeout(900);
  await quiet(page);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--use-angle=metal'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page.on('console', (message) => { if (message.type() === 'error') console.error('[browser]', message.text()); });
  await open(page);
  const runtime = await page.evaluate(() => ({ runtime: window.__IMG2THREEJS_RUNTIME__, parts: window.__IMG2THREEJS_PARTS__ }));
  // The model carries a human-readable contact-evidence field, but the capture
  // directory changes every correction loop. Bind the manifest to this pass so
  // later audits never cite stale orbit screenshots from an older loop.
  if (runtime?.runtime?.attachmentGate) {
    runtime.runtime.attachmentGate.renderedContactEvidence = [
      'orbit-left.png',
      'orbit-right.png',
      'orbit-top.png',
    ].map((name) => path.join(out, name)).join(';');
  }
  fs.writeFileSync(path.join(out, 'runtime-manifest.json'), JSON.stringify(runtime, null, 2));
  fs.writeFileSync(path.join(out, 'parts-manifest.json'), JSON.stringify(runtime.parts, null, 2));
  await page.locator('canvas').first().screenshot({ path: path.join(out, 'broadside-front.png') });

  await open(page, '&back=1');
  await page.locator('canvas').first().screenshot({ path: path.join(out, 'broadside-back.png') });

  async function orbit(name, dx, dy) {
    await open(page, 'reviewWhite=1', false);
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error(`canvas bounds missing for ${name}`);
    const cx = box.x + box.width * 0.52;
    const cy = box.y + box.height * 0.52;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx, cy + dy, { steps: 24 });
    await page.mouse.up();
    await page.waitForTimeout(350);
    await canvas.screenshot({ path: path.join(out, `${name}.png`) });
  }

  await orbit('orbit-left', -280, 0);
  await orbit('orbit-right', 360, 30);
  await orbit('orbit-top', 0, 180);
  await orbit('orbit-muzzle', -520, 20);
  await browser.close();
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
