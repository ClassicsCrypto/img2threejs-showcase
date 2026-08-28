import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

// Not capture mode: `prewarm` is only invoked on the interactive path, so a capture run leaves a
// lazily built demo with an empty group and nothing to measure.
const url = process.argv[2] ?? 'http://127.0.0.1:5173/#/demo/leesin';
const output = process.argv[3] ?? 'work/leesin/source-animation-validation.json';
const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await (await browser.newContext({ viewport: { width: 931, height: 1200 } })).newPage();
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

const result = await page.evaluate(async () => {
  // Derived, not hardcoded: the deploy base moved from '/img2threejs-showcase/' to '/', and a fixed
  // prefix silently turned this gate into a fetch failure rather than a result.
  const base = new URL(document.baseURI).pathname.replace(/\/$/, '');
  const source = await import(`${base}/src/demos/leesin/sourceRigAnimationData.ts`);
  const root = window.__IMG2THREEJS_VIEWER__.scene.getObjectByName('leesin-procedural');
  const runtime = root.userData.sculptRuntime;
  const controller = runtime.animationController;
  const clips = root.animations;
  const decode = (encoded) => {
    const raw = atob(encoded);
    return Uint8Array.from(raw, (character) => character.charCodeAt(0));
  };
  const bytes = (array) => new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  const equal = (left, right) => left.byteLength === right.byteLength
    && left.every((value, index) => value === right[index]);

  // Establish the initial condition instead of assuming it. A demo may start a default clip on load,
  // and the reference pose sampled below would then be an animated one -- which showed up as a
  // `bindPoseRestore` failure that had nothing to do with the restore path.
  controller.stop();
  root.updateMatrixWorld(true);
  const bind = new Map();
  for (let index = 0; index <= 41; index += 1) {
    const node = runtime.nodes[`source-node-${index}`];
    bind.set(index, [...node.position.toArray(), ...node.quaternion.toArray(), ...node.scale.toArray()]);
  }
  let exactPayloadBytes = true;
  let exactDurations = true;
  let exactTrackNames = true;
  let exactInterpolation = true;
  let checkedTrackCount = 0;
  let checkedKeyCount = 0;
  const interpolationValues = { STEP: new Set(), LINEAR: new Set() };
  const clipPayloads = clips.map((clip, clipIndex) => {
    const expectedClip = source.SOURCE_ANIMATION_CLIPS[clipIndex];
    exactDurations &&= clip.duration === expectedClip.duration;
    const failedTracks = [];
    clip.tracks.forEach((track, trackIndex) => {
      const expected = expectedClip.tracks[trackIndex];
      const property = expected.path === 'rotation'
        ? 'quaternion'
        : expected.path === 'translation' ? 'position' : 'scale';
      const checks = {
        name: track.name === `${expected.nodeName}.${property}`,
        times: equal(bytes(track.times), decode(expected.timesBase64)),
        values: equal(bytes(track.values), decode(expected.valuesBase64)),
      };
      interpolationValues[expected.interpolation].add(track.getInterpolation());
      exactPayloadBytes &&= checks.times && checks.values;
      exactTrackNames &&= checks.name;
      checkedTrackCount += 1;
      checkedKeyCount += track.times.length;
      if (!Object.values(checks).every(Boolean)) failedTracks.push({ trackIndex, ...checks });
    });
    return {
      index: clipIndex,
      name: clip.name,
      duration: clip.duration,
      trackCount: clip.tracks.length,
      failedTracks,
    };
  });
  exactInterpolation = interpolationValues.STEP.size === 1
    && interpolationValues.LINEAR.size === 1
    && [...interpolationValues.STEP][0] !== [...interpolationValues.LINEAR][0];

  let sampledFrameCount = 0;
  let maxSampledBindingDelta = 0;
  let allSampledDeformationFinite = true;
  for (const clip of clips) {
    for (const time of [0, clip.duration * 0.25, clip.duration * 0.5, clip.duration * 0.75, clip.duration]) {
      if (!controller.seek(clip.name, time)) throw new Error(`Cannot seek ${clip.name}`);
      root.updateMatrixWorld(true);
      for (const track of clip.tracks) {
        const match = /^source-node-(\d+)\.(position|quaternion|scale)$/.exec(track.name);
        if (!match) throw new Error(`Unexpected binding ${track.name}`);
        const node = runtime.nodes[`source-node-${match[1]}`];
        const actual = match[2] === 'position'
          ? node.position.toArray()
          : match[2] === 'quaternion' ? node.quaternion.toArray() : node.scale.toArray();
        const expected = track.createInterpolant().evaluate(time);
        for (let lane = 0; lane < actual.length; lane += 1) {
          maxSampledBindingDelta = Math.max(maxSampledBindingDelta, Math.abs(actual[lane] - expected[lane]));
        }
      }
      root.traverse((object) => {
        if (!object.isSkinnedMesh || !object.visible) return;
        const position = object.geometry.getAttribute('position');
        const step = Math.max(1, Math.floor(position.count / 64));
        for (let index = 0; index < position.count; index += step) {
          const point = object.position.clone().set(position.getX(index), position.getY(index), position.getZ(index));
          object.applyBoneTransform(index, point);
          allSampledDeformationFinite &&= point.toArray().every(Number.isFinite);
        }
      });
      sampledFrameCount += 1;
    }
  }

  controller.stop();
  root.updateMatrixWorld(true);
  let maxBindRestoreDelta = 0;
  for (let index = 0; index <= 41; index += 1) {
    const node = runtime.nodes[`source-node-${index}`];
    const actual = [...node.position.toArray(), ...node.quaternion.toArray(), ...node.scale.toArray()];
    const expected = bind.get(index);
    actual.forEach((value, lane) => {
      maxBindRestoreDelta = Math.max(maxBindRestoreDelta, Math.abs(value - expected[lane]));
    });
  }

  let visibleMeshCount = 0;
  let visibleSkinnedMeshCount = 0;
  let maxSkinWeightSumDelta = 0;
  let maxSkinIndex = 0;
  root.traverse((object) => {
    if (!object.isMesh || !object.visible) return;
    visibleMeshCount += 1;
    if (!object.isSkinnedMesh) return;
    visibleSkinnedMeshCount += 1;
    const indices = object.geometry.getAttribute('skinIndex');
    const weights = object.geometry.getAttribute('skinWeight');
    for (let vertex = 0; vertex < weights.count; vertex += 1) {
      const sum = weights.getX(vertex) + weights.getY(vertex) + weights.getZ(vertex) + weights.getW(vertex);
      maxSkinWeightSumDelta = Math.max(maxSkinWeightSumDelta, Math.abs(1 - sum));
      maxSkinIndex = Math.max(
        maxSkinIndex,
        indices.getX(vertex), indices.getY(vertex), indices.getZ(vertex), indices.getW(vertex),
      );
    }
  });
  const leftSocketX = runtime.sockets['weapon-grip-l'].getWorldPosition(root.position.clone()).x;
  const rightSocketX = runtime.sockets['weapon-grip-r'].getWorldPosition(root.position.clone()).x;
  const float32Epsilon = 2 ** -23;
  const checks = {
    sourceSha256Present: source.SOURCE_GLB_SHA256.length === 64,
    // 11 clips are still CONSTRUCTED and still byte-compared against the source accessors. One
    // (`idle-still`) is deliberately not offered as an action -- 13.7 s of measured near-stillness --
    // so the exposed count is 10 while every parity number below stays at its full value.
    clipCount: clips.length === 11,
    actionCount: controller.actions.length === 10,
    hiddenClipStillTransferred: clips.some((clip) => clip.name === 'idle-still')
      && !controller.actions.some((action) => action.id === 'idle-still'),
    exactPayloadBytes,
    exactDurations,
    exactTrackNames,
    exactInterpolation,
    trackCount: checkedTrackCount === 1353,
    keyCount: checkedKeyCount === 20466,
    sampledBindings: sampledFrameCount === 55 && maxSampledBindingDelta <= float32Epsilon,
    finiteDeformation: allSampledDeformationFinite,
    bindPoseRestore: maxBindRestoreDelta <= 1e-12,
    everyVisibleMeshRigBound: visibleMeshCount === 69 && visibleSkinnedMeshCount === 69,
    validSkinIndices: maxSkinIndex <= 41,
    normalizedSkinWeights: maxSkinWeightSumDelta <= 2e-7,
    medialLateralConvention: leftSocketX > 0 && rightSocketX < 0,
  };
  return {
    schemaVersion: 1,
    command: 'node scripts/validate-leesin-source-animation.mjs',
    sourceGlbSha256: source.SOURCE_GLB_SHA256,
    clipPayloads,
    checkedTrackCount,
    checkedKeyCount,
    sampledFrameCount,
    maxSampledBindingDelta,
    float32Epsilon,
    maxBindRestoreDelta,
    visibleMeshCount,
    visibleSkinnedMeshCount,
    maxSkinWeightSumDelta,
    maxSkinIndex,
    sockets: { leftSocketX, rightSocketX },
    checks,
    passed: Object.values(checks).every(Boolean),
  };
});

fs.mkdirSync(path.dirname(output), { recursive: true });

fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
await browser.close();
if (!result.passed) process.exitCode = 1;
