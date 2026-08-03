const { chromium } = require('/Users/tamlh/.npm/_npx/420ff84f11983ee5/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const base = 'http://127.0.0.1:5173/img2threejs-showcase/';
const out = process.env.AWP_REVIEW_DIR
  || path.join(process.cwd(), '.img2threejs', 'renders', 'epoch-current');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Users/tamlh/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    args: ['--use-angle=metal'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('[browser]', message.text());
  });
  page.on('response', (response) => {
    if (response.url().includes('front-paint') || response.url().includes('back-paint')) {
      console.log('paint-response', response.status(), response.url());
    }
  });
  // The fixed review shot must use capture mode: it freezes OrbitControls, uses the
  // reference-compatible white studio background, and skips responsive re-framing.
  await page.goto(`${base}?capture=1#/demo/awp-medusa`, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas');
  await page.waitForTimeout(2600);
  const runtimeEvidence = await page.evaluate(() => ({
    runtime: window.__IMG2THREEJS_RUNTIME__,
    parts: window.__IMG2THREEJS_PARTS__,
  }));
  fs.writeFileSync(`${out}/runtime-manifest-final.json`, JSON.stringify({
    model: 'awp-medusa',
    ...runtimeEvidence.parts,
    runtime: runtimeEvidence.runtime,
  }, null, 2));
  await page.evaluate(() => {
    const panel = document.querySelector('.demo-panel');
    if (panel) panel.style.display = 'none';
    const hint = document.querySelector('.hint');
    if (hint) hint.style.display = 'none';
  });
  const canvas = page.locator('canvas').first();
  console.log('canvas', await canvas.boundingBox());
  await canvas.screenshot({ path: `${out}/blockout-front.png` });
  await page.screenshot({ path: `${out}/scope-front-crop.png`, clip: { x: 280, y: 270, width: 560, height: 270 } });
  await page.screenshot({ path: `${out}/scope-ring-contact-crop.png`, clip: { x: 320, y: 345, width: 380, height: 190 } });
  await page.screenshot({ path: `${out}/page-front.png`, fullPage: false });

  await page.goto(`${base}?capture=1&mapStripped=1#/demo/awp-medusa`, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas');
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const panel = document.querySelector('.demo-panel');
    if (panel) panel.style.display = 'none';
    const hint = document.querySelector('.hint');
    if (hint) hint.style.display = 'none';
  });
  await page.locator('canvas').first().screenshot({ path: `${out}/tier1-mapstripped-front.png` });

  // The supplied back broadside is a second identity view, not an orbit proxy. Capture it
  // through the same frozen camera path so the saved evidence checks the -Z projection face.
  await page.goto(`${base}?capture=1&back=1#/demo/awp-medusa`, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas');
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const panel = document.querySelector('.demo-panel');
    if (panel) panel.style.display = 'none';
    const hint = document.querySelector('.hint');
    if (hint) hint.style.display = 'none';
  });
  await page.locator('canvas').first().screenshot({ path: `${out}/blockout-back.png` });
  await page.screenshot({ path: `${out}/scope-back-crop.png`, clip: { x: 760, y: 270, width: 560, height: 270 } });

  await page.goto(`${base}?capture=1&back=1&mapStripped=1#/demo/awp-medusa`, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas');
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const panel = document.querySelector('.demo-panel');
    if (panel) panel.style.display = 'none';
    const hint = document.querySelector('.hint');
    if (hint) hint.style.display = 'none';
  });
  await page.locator('canvas').first().screenshot({ path: `${out}/tier1-mapstripped-back.png` });

  // Orbit captures intentionally use the normal interactive route so the same runtime
  // assembly is tested from meaningful non-reference angles.
  await page.goto(`${base}?reviewWhite=1#/demo/awp-medusa`, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas');
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const panel = document.querySelector('.demo-panel');
    if (panel) panel.style.display = 'none';
    const hint = document.querySelector('.hint');
    if (hint) hint.style.display = 'none';
  });

  const orbitCanvas = page.locator('canvas').first();
  const box = await orbitCanvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const cx = box.x + box.width * 0.52;
  const cy = box.y + box.height * 0.52;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - box.width * 0.18, cy - box.height * 0.03, { steps: 18 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await orbitCanvas.screenshot({ path: `${out}/orbit-left-white.png` });

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + box.width * 0.36, cy + box.height * 0.02, { steps: 24 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await orbitCanvas.screenshot({ path: `${out}/orbit-right-white.png` });

  // Add two orthographic stress views requested by the reconstruction review:
  // a high three-quarter view exposes mount/receiver seams and a muzzle-side
  // view exposes the barrel, bolt, bipod, and crown depth relationships.
  const captureOrbit = async (dragX, dragY, filename) => {
    await page.goto(`${base}?reviewWhite=1#/demo/awp-medusa`, { waitUntil: 'networkidle' });
    await page.waitForSelector('canvas');
    await page.waitForTimeout(900);
    await page.evaluate(() => {
      const panel = document.querySelector('.demo-panel');
      if (panel) panel.style.display = 'none';
      const hint = document.querySelector('.hint');
      if (hint) hint.style.display = 'none';
    });
    const viewCanvas = page.locator('canvas').first();
    const viewBox = await viewCanvas.boundingBox();
    if (!viewBox) throw new Error(`canvas has no bounding box for ${filename}`);
    const viewCx = viewBox.x + viewBox.width * 0.52;
    const viewCy = viewBox.y + viewBox.height * 0.52;
    await page.mouse.move(viewCx, viewCy);
    await page.mouse.down();
    await page.mouse.move(viewCx + dragX, viewCy + dragY, { steps: 24 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    await viewCanvas.screenshot({ path: `${out}/${filename}` });
  };
  await captureOrbit(0, box.height * 0.20, 'orbit-top-white.png');
  await captureOrbit(-box.width * 0.42, box.height * 0.04, 'orbit-muzzle-white.png');
  await captureOrbit(-box.width * 0.86, 0, 'muzzle-face-stress.png');
  await page.goto(`${base}?reviewWhite=1#/demo/awp-medusa`, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas');
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const viewer = window.__IMG2THREEJS_VIEWER__;
    if (!viewer) throw new Error('viewer QA handle is unavailable');
    const target = { x: 4.76, y: 0.17, z: 0 };
    viewer.camera.fov = 22;
    viewer.camera.position.set(6.05, 0.21, 0.16);
    viewer.camera.lookAt(target.x, target.y, target.z);
    viewer.camera.updateProjectionMatrix();
    viewer.controls.target.set(target.x, target.y, target.z);
    viewer.controls.update();
    viewer.renderer.render(viewer.scene, viewer.camera);
  });
  await page.evaluate(() => {
    const panel = document.querySelector('.demo-panel');
    if (panel) panel.style.display = 'none';
    const hint = document.querySelector('.hint');
    if (hint) hint.style.display = 'none';
  });
  await page.locator('canvas').first().screenshot({ path: `${out}/muzzle-face-close.png` });
  // Edge-on stress views specifically test that the two projected Medusa
  // surfaces are seated on the stock/receiver shell instead of floating as
  // an offset billboard. These are intentionally harsher than the normal
  // presentation orbits.
  await captureOrbit(box.width * 0.52, 0, 'orbit-edge-right-white.png');
  await captureOrbit(-box.width * 0.52, 0, 'orbit-edge-left-white.png');

  // The forensic intake requires separate files, not a montage. Capture a
  // dense 24-view turntable so NotebookLM can inspect component continuity,
  // mirror-side finish, muzzle aperture, bolt clearance, and bipod seams from
  // more than the two supplied broadside cameras.
  const forensicAngles = [
    [-box.width * 0.12, -box.height * 0.24],
    [box.width * 0.12, -box.height * 0.24],
    [-box.width * 0.24, -box.height * 0.24],
    [box.width * 0.24, -box.height * 0.24],
    [-box.width * 0.36, -box.height * 0.24],
    [box.width * 0.36, -box.height * 0.24],
    [-box.width * 0.48, -box.height * 0.24],
    [box.width * 0.48, -box.height * 0.24],
    [-box.width * 0.12, box.height * 0.12],
    [box.width * 0.12, box.height * 0.12],
    [-box.width * 0.24, box.height * 0.12],
    [box.width * 0.24, box.height * 0.12],
    [-box.width * 0.36, box.height * 0.12],
    [box.width * 0.36, box.height * 0.12],
    [-box.width * 0.48, box.height * 0.12],
    [box.width * 0.48, box.height * 0.12],
    [-box.width * 0.12, box.height * 0.30],
    [box.width * 0.12, box.height * 0.30],
    [-box.width * 0.24, box.height * 0.42],
    [box.width * 0.24, box.height * 0.42],
    [-box.width * 0.36, box.height * 0.42],
    [box.width * 0.36, box.height * 0.42],
    [-box.width * 0.48, box.height * 0.42],
    [box.width * 0.48, box.height * 0.42],
  ];
  for (let index = 0; index < forensicAngles.length; index += 1) {
    const [dragX, dragY] = forensicAngles[index];
    await captureOrbit(dragX, dragY, `angle-${String(index + 1).padStart(2, '0')}-white.png`);
  }

  await browser.close();
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
