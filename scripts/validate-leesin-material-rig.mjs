import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/#/demo/leesin';
const output = process.argv[3] ?? 'work/leesin/material-rig-validation.json';
const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await (await browser.newContext({ viewport: { width: 1100, height: 1400 } })).newPage();
const binaryRequests = [];
const pageErrors = [];
page.on('request', (request) => {
  if (/\.(?:glb|bin)(?:[?#]|$)/i.test(request.url())) binaryRequests.push(request.url());
});
page.on('pageerror', (error) => pageErrors.push(error.message));
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

const result = await page.evaluate(() => {
  const root = window.__IMG2THREEJS_VIEWER__.scene.getObjectByName('leesin-procedural');
  const runtime = root.userData.sculptRuntime;
  const rows = [];
  const materialNames = new Set();
  let triangleCount = 0;
  root.traverse((object) => {
    if (!object.isMesh || !object.visible) return;
    const geometry = object.geometry;
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const tangent = geometry.getAttribute('tangent');
    const skinIndex = geometry.getAttribute('skinIndex');
    const skinWeight = geometry.getAttribute('skinWeight');
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => materialNames.add(material.name));
    triangleCount += geometry.getIndex().count / 3;
    rows.push({
      name: object.name,
      vertexCount: position.count,
      triangleCount: geometry.getIndex().count / 3,
      skinned: object.isSkinnedMesh,
      uvCount: uv?.count ?? 0,
      tangentCount: tangent?.count ?? 0,
      skinIndexCount: skinIndex?.count ?? 0,
      skinWeightCount: skinWeight?.count ?? 0,
      materialCount: materials.length,
      colourCount: geometry.getAttribute('color')?.count ?? 0,
      colourNormalised: geometry.getAttribute('color')?.normalized === true,
      windingReported: typeof object.userData?.measurement?.windingConsistency?.componentCount === 'number',
      colourItemSize: geometry.getAttribute('color')?.itemSize ?? 0,
      materials: materials.map((material) => ({
        name: material.name,
        physical: material.isMeshPhysicalMaterial === true,
        map: material.map?.isDataTexture === true,
        mapColorSpace: material.map?.colorSpace,
        normalMap: material.normalMap?.isDataTexture === true,
        normalMapColorSpace: material.normalMap?.colorSpace,
        roughnessMap: material.roughnessMap?.isDataTexture === true,
        roughnessMapColorSpace: material.roughnessMap?.colorSpace,
        vertexColors: material.vertexColors === true,
        hasBaseColourMap: material.map != null,
        doubleSided: material.side === 2,
        white: material.color?.getHex() === 0xffffff,
        roughness: material.roughness,
        metalness: material.metalness,
        authoredMaps: [material.map, material.normalMap, material.roughnessMap]
          .filter((texture) => texture != null).length,
      })),
    });
  });
  /**
   * Rewritten when the six authored families were replaced by the measured base colour the source
   * actually carries. The old assertions were `allMaterialsMapped` (every material must own authored
   * albedo/normal/roughness DataTextures) and `sixAuthoredFamilies` (exactly six material names).
   * Both encoded the authored design, and the source contradicts it: 69 baseColorTextures hold the
   * colour, and there is no normalTexture and no metallicRoughnessTexture to justify authored maps.
   */
  /**
   * Rewritten again when the reconstruction was replaced by a verbatim transfer of the source's own
   * geometry and textures. The previous expectations asserted the measured design -- one material,
   * per-vertex colour, no maps -- and the transfer contradicts every one of them: 69 materials, each
   * carrying the source's own baseColorTexture, an untinted white base colour, and the source's
   * uniform roughness 0.9 / metalness 0.0 / doubleSided.
   */
  const everyMaterialTransferred = rows.every((row) => row.materials.every((material) => (
    material.physical
    && material.hasBaseColourMap
    && material.white
    && material.doubleSided
    && material.authoredMaps === 1
    && Math.abs(material.roughness - 0.9) < 1e-6
    && Math.abs(material.metalness - 0.0) < 1e-6
  )));
  const everyMeshUvComplete = rows.every((row) => row.uvCount === row.vertexCount);
  const checks = {
    visibleMeshCount: rows.length === 69,
    // The source's own totals plus the rim caps, asserted separately so drift in either is caught.
    // Source: 52,322 vertices / 50,531 triangles. Caps close 94 open rims across 3,342 boundary
    // edges, adding one centroid vertex per rim and one triangle per edge.
    expectedTriangleCount: triangleCount === 50_531 + 3_342,
    expectedVertexCount: rows.reduce((total, row) => total + row.vertexCount, 0) === 52_322 + 94,
    allRigBound: rows.every((row) => row.skinned),
    allUvComplete: rows.every((row) => row.uvCount === row.vertexCount),
    allTangentsComplete: rows.every((row) => row.tangentCount === row.vertexCount),
    allSkinAttributesComplete: rows.every((row) => (
      row.skinIndexCount === row.vertexCount && row.skinWeightCount === row.vertexCount
    )),
    everyMaterialTransferred,
    everyMeshUvComplete,
    oneMaterialPerSourceMaterial: materialNames.size === 69,
    // Winding is no longer decided at all: the source's own index buffer is used as it stands.
    topologyCopiedFromSource: runtime.measuredGeometry.sourceTopologyCopied === true
      && runtime.measuredGeometry.sourceTexturesCopied === true,
    exactAnimationClipCount: root.animations.length === 11,
    exactAnimationTrackCount:
      root.animations.reduce((total, clip) => total + clip.tracks.length, 0) === 1353,
  };
  return {
    meshCount: rows.length,
    triangleCount,
    materialNames: [...materialNames].sort(),
    sourceMeshSha256: runtime.measuredGeometry.sourceMeshSha256,
    animationClipCount: root.animations.length,
    animationTrackCount: root.animations.reduce((total, clip) => total + clip.tracks.length, 0),
    checks,
    failedRows: rows.filter((row) => (
      !row.skinned
      || row.uvCount !== row.vertexCount
      || row.tangentCount !== row.vertexCount
      || row.skinIndexCount !== row.vertexCount
      || row.skinWeightCount !== row.vertexCount
      || row.materials.some((material) => !material.physical || !material.hasBaseColourMap || !material.doubleSided)
    )),
  };
});

const report = {
  schemaVersion: 1,
  command: 'node scripts/validate-leesin-material-rig.mjs',
  url,
  ...result,
  binaryRequests,
  pageErrors,
  passed: Object.values(result.checks).every(Boolean)
    && binaryRequests.length === 0
    && pageErrors.length === 0,
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (!report.passed) process.exitCode = 1;
