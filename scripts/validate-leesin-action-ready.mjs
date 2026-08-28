import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/#/demo/leesin';
const output = process.argv[3] ?? 'work/leesin/action-ready.json';
const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const context = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
const page = await context.newPage();
const binaryRequests = [];
page.on('request', (request) => {
  if (/\.(?:glb|bin)(?:[?#]|$)/i.test(request.url())) binaryRequests.push(request.url());
});
await page.goto(url, { waitUntil: 'networkidle', timeout: 120_000 });
// Waits for the RUNTIME, not for a generic ready flag. The flag is raised once the page has a
// viewer, which on a lazily built demo is well before the rig exists, and the gate then read
// `undefined` and reported a crash instead of a verdict.
await page.waitForFunction(() => {
  const viewer = window.__IMG2THREEJS_VIEWER__;
  const root = viewer && viewer.scene.getObjectByName('leesin-procedural');
  const runtime = root && root.userData.sculptRuntime;
  return !!(runtime && runtime.nodes && runtime.animationController && runtime.measuredGeometry);
}, { timeout: 180_000 });
await page.waitForFunction(() => window.__IMG2THREEJS_VIEWER__?.parts?.length === 69, { timeout: 120_000 });

const before = await page.evaluate(() => {
  const viewer = window.__IMG2THREEJS_VIEWER__;
  const root = viewer.scene.getObjectByName('leesin-procedural');
  const runtime = root.userData.sculptRuntime;
  const visible = [];
  root.traverse((object) => {
    if (object.isMesh && object.visible) visible.push(object);
  });
  const selectable = viewer.parts.map((part) => {
    viewer.selectByName(part.name);
    return viewer.selected?.name === part.name;
  });
  viewer.selectByName(null);
  return {
    partNames: viewer.parts.map((part) => part.name),
    selectable,
    positions: Object.fromEntries(visible.map((mesh) => [mesh.name, mesh.position.toArray()])),
    visibleMeshCount: visible.length,
    visibleSkinnedMeshCount: visible.filter((mesh) => mesh.isSkinnedMesh).length,
    pivotCount: Object.keys(runtime.pivots ?? {}).length,
    socketNames: Object.keys(runtime.sockets ?? {}).sort(),
    actionAnchorNames: Object.keys(runtime.actionAnchors ?? {}).sort(),
    animationActionCount: runtime.animationController?.actions?.length ?? 0,
    runtimePresent: Boolean(runtime),
  };
});

const explodeButton = page.locator('#demo-explode');
await explodeButton.click();
await page.waitForTimeout(1600);
const exploded = await page.evaluate((positions) => {
  const root = window.__IMG2THREEJS_VIEWER__.scene.getObjectByName('leesin-procedural');
  let moved = 0;
  root.traverse((object) => {
    if (!object.isMesh || !object.visible || !positions[object.name]) return;
    if (object.position.distanceTo(object.position.clone().fromArray(positions[object.name])) > 1e-5) moved += 1;
  });
  return moved;
}, before.positions);
await explodeButton.click();
await page.waitForTimeout(1600);
const maxRestoreDelta = await page.evaluate((positions) => {
  const root = window.__IMG2THREEJS_VIEWER__.scene.getObjectByName('leesin-procedural');
  let maximum = 0;
  root.traverse((object) => {
    if (!object.isMesh || !object.visible || !positions[object.name]) return;
    maximum = Math.max(maximum, object.position.distanceTo(object.position.clone().fromArray(positions[object.name])));
  });
  return maximum;
}, before.positions);

const checks = {
  partCount: before.partNames.length === 69,
  physicalPartNames: before.partNames.every((name) => /^measured-node-(?:[4-9][0-9]|10[0-9]|110)$/.test(name)),
  everyPartSelectable: before.selectable.every(Boolean),
  explodeMovesEveryPart: exploded === 69,
  assembleRestoresEveryPart: maxRestoreDelta <= 1e-9,
  everyVisibleMeshRigBound: before.visibleMeshCount === 69 && before.visibleSkinnedMeshCount === 69,
  technicalPivotsPresent: before.pivotCount === 44,
  socketsPresent: JSON.stringify(before.socketNames) === JSON.stringify(['head-attachment', 'weapon-grip-l', 'weapon-grip-r']),
  actionAnchorsPresent: JSON.stringify(before.actionAnchorNames) === JSON.stringify(['headAttachment', 'weaponGripLeft', 'weaponGripRight']),
  animationsPresent: before.animationActionCount === 10,
  runtimePresent: before.runtimePresent,
  noRuntimeBinaryRequests: binaryRequests.length === 0,
};
const report = {
  schemaVersion: 1,
  command: 'node scripts/validate-leesin-action-ready.mjs',
  url,
  partCount: before.partNames.length,
  explodedPartCount: exploded,
  maxRestoreDelta,
  pivotCount: before.pivotCount,
  socketNames: before.socketNames,
  actionAnchorNames: before.actionAnchorNames,
  animationActionCount: before.animationActionCount,
  visibleMeshCount: before.visibleMeshCount,
  visibleSkinnedMeshCount: before.visibleSkinnedMeshCount,
  binaryRequests,
  checks,
  passed: Object.values(checks).every(Boolean),
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (!report.passed) process.exitCode = 1;
