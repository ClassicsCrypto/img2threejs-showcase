import * as THREE from "three";
import { createHumanoidCharacterIR } from "../archetypes/humanoid/index.js";
import { createLeeSinV2CharacterIR } from "../archetypes/lee-sin-v2/index.js";
import { CharacterSession } from "../core/character-session.js";
import { exportCharacter } from "../compiler/export.js";
const query = new URLSearchParams(window.location.search);
const subject = query.get("subject") ?? "lee-sin-v2";
const ir = subject === "benchmark"
    ? createHumanoidCharacterIR({ name: "Character Plugin Benchmark", profile: "standard", addTail: true, addWings: true })
    : createLeeSinV2CharacterIR({ profile: "standard" });
const session = new CharacterSession(ir);
const compiled = session.compile({ backend: "webgl" });
const report = session.conformance();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe7e5e1);
const camera = new THREE.OrthographicCamera(-1, 1, 0.72, -0.72, 0.01, 20);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.96;
renderer.domElement.dataset.subject = ir.meta.id;
document.body.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff, 0x6d625b, 1.1));
const key = new THREE.DirectionalLight(0xfff0dc, 2);
key.position.set(2.5, 3.5, 3.5);
scene.add(key);
const fill = new THREE.DirectionalLight(0xaec7e8, 0.65);
fill.position.set(-3, 1.8, 2);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 1);
rim.position.set(-2.5, 2.5, -3.5);
scene.add(rim);
const floor = new THREE.Mesh(new THREE.CircleGeometry(1.8, 64), new THREE.MeshStandardMaterial({ color: 0xd8d5d0, roughness: 0.94, metalness: 0 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.005;
scene.add(floor);
scene.add(compiled.root);
const views = {
    front: new THREE.Vector3(0, 0.62, 2.6),
    "three-quarter": new THREE.Vector3(1.85, 0.7, 1.85),
    side: new THREE.Vector3(2.6, 0.62, 0),
    rear: new THREE.Vector3(0, 0.62, -2.6),
};
const target = new THREE.Vector3(0, 0.62, 0);
function fitCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    const halfHeight = 0.7;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
}
function setView(name) {
    camera.position.copy(views[name] ?? views.front);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
}
fitCamera();
setView(query.get("view") ?? "front");
const status = document.querySelector("#status");
status.innerHTML = `subject: <strong>${ir.meta.name}</strong><br>profile: <strong>${report.profile}</strong> · conformance: <strong>${report.status}</strong><br>body meshes: ${compiled.bodyMeshes.size} · bones: ${compiled.skeleton.skeleton.bones.length} · accessories: ${compiled.accessories.items.size}<br>failed: ${report.failedGateIds.length ? report.failedGateIds.join(", ") : "none"}`;
const controls = document.querySelector("#controls");
for (const view of Object.keys(views)) {
    const button = document.createElement("button");
    button.textContent = view;
    button.onclick = () => setView(view);
    controls.appendChild(button);
}
const poseButton = document.createElement("button");
poseButton.textContent = "pose / reset";
poseButton.onclick = () => {
    const elbow = compiled.runtime.joints.get("left-elbow");
    if (elbow)
        elbow.rotation.x = elbow.rotation.x > 0.1 ? 0 : Math.PI / 2;
    compiled.runtime.update(0);
};
controls.appendChild(poseButton);
const exportButton = document.createElement("button");
exportButton.textContent = "export GLB";
exportButton.onclick = async () => {
    const result = await exportCharacter(compiled.root, { binary: true });
    status.innerHTML += `<br>GLB bytes: <strong>${result instanceof ArrayBuffer ? result.byteLength : "JSON"}</strong>`;
};
controls.appendChild(exportButton);
if (query.get("capture") === "1")
    document.querySelector("#hud").style.display = "none";
window.addEventListener("resize", () => {
    fitCamera();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
const captureApi = {
    setCamera(spec) {
        if (spec.view)
            setView(spec.view);
        if (spec.position)
            camera.position.set(...spec.position);
        if (spec.target)
            camera.lookAt(new THREE.Vector3(...spec.target));
        if (spec.exposure !== undefined)
            renderer.toneMappingExposure = spec.exposure;
        camera.updateMatrixWorld(true);
    },
    setReferenceMode() { },
    async capturePass() { renderer.render(scene, camera); return { ok: true, selector: "canvas" }; },
};
const runtimeWindow = window;
runtimeWindow.__IMG2THREEJS_CHARACTER__ = { session, compiled, report, camera, scene, renderer, setView, exportCharacter: () => exportCharacter(compiled.root, { binary: true }) };
runtimeWindow.__IMG2THREEJS_CAPTURE__ = captureApi;
runtimeWindow.__IMG2THREEJS_READY__ = true;
renderer.setAnimationLoop((delta) => {
    compiled.runtime.update(delta / 1000);
    renderer.render(scene, camera);
});
//# sourceMappingURL=main.js.map