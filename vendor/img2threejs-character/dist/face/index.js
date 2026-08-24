import * as THREE from "three";
export function buildFace(ir, materials) {
    const group = new THREE.Group();
    group.name = "face";
    const skin = materials.get("skin") ?? new THREE.MeshPhysicalMaterial({ color: 0x9b5539, roughness: 0.58 });
    const skull = ir.shapeGraph.face?.skull;
    const headGeometry = new THREE.SphereGeometry(1, skull ? 12 : 24, skull ? 8 : 16);
    if (skull)
        shapeSkullGeometry(headGeometry, skull.radius, skull.jawWidth, skull.jawDepth);
    const head = new THREE.Mesh(headGeometry, skin);
    head.name = "skull";
    head.position.set(...(skull?.center ?? [0, 1.085, 0.01]));
    head.scale.set(...(skull?.radius ?? [0.085, 0.085, 0.085]));
    group.add(head);
    const eyeMaterial = materials.get("eye-sclera") ?? new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.18, transmission: 0.05 });
    const irisMaterial = materials.get("eye-iris") ?? new THREE.MeshPhysicalMaterial({ color: 0x174a36, roughness: 0.2, clearcoat: 0.5 });
    const pupilMaterial = materials.get("eye-pupil") ?? new THREE.MeshPhysicalMaterial({ color: 0x050202, roughness: 0.12 });
    const left = createEye("left-eye", 0.031, eyeMaterial, irisMaterial, pupilMaterial);
    const right = createEye("right-eye", -0.031, eyeMaterial, irisMaterial, pupilMaterial);
    if (ir.archetype.traits.includes("blindfolded")) {
        left.visible = false;
        right.visible = false;
        left.userData.occludedBy = "blindfold";
        right.userData.occludedBy = "blindfold";
    }
    group.add(left, right);
    const eyes = {
        left, right,
        setBlink(value) { const scale = Math.max(0.08, 1 - Math.min(1, Math.max(0, value))); left.scale.y = scale; right.scale.y = scale; },
        setPupil(value) { const scale = Math.max(0.5, Math.min(1.5, value)); left.children[1].scale.setScalar(scale); right.children[1].scale.setScalar(scale); },
        lookAt(target) { left.lookAt(target); right.lookAt(target); },
    };
    ir.landmarkGraph.landmarks.push({ id: "left-eye-center", role: "left-eye", position: [0.031, 1.09, 0.077], confidence: 0.8 }, { id: "right-eye-center", role: "right-eye", position: [-0.031, 1.09, 0.077], confidence: 0.8 });
    return { group, eyes };
}
function shapeSkullGeometry(geometry, radius, jawWidth, jawDepth) {
    const position = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    const jawWidthRatio = THREE.MathUtils.clamp(jawWidth / radius[0], 0.35, 1.2);
    const jawDepthRatio = THREE.MathUtils.clamp(jawDepth / radius[2], 0.35, 1.2);
    for (let index = 0; index < position.count; index += 1) {
        const y = position.getY(index);
        const lower = THREE.MathUtils.smoothstep(-y, -0.1, 0.9);
        const chin = THREE.MathUtils.smoothstep(-y, 0.55, 1);
        let x = position.getX(index);
        let z = position.getZ(index);
        let shapedY = y;
        if (y < -0.95 && uv) {
            const angle = uv.getX(index) * Math.PI * 2;
            x = Math.cos(angle) * 0.28;
            z = Math.sin(angle) * 0.22;
            shapedY = -0.82;
        }
        const xScale = THREE.MathUtils.lerp(1, jawWidthRatio, lower) * THREE.MathUtils.lerp(1, 0.78, chin);
        const zScale = THREE.MathUtils.lerp(1, jawDepthRatio, lower);
        position.setXYZ(index, x * xScale, shapedY, z * zScale);
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
}
function createEye(name, x, sclera, iris, pupil) {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(x, 1.09, 0.073);
    const eyeball = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), sclera);
    eyeball.name = `${name}-sclera`;
    const irisMesh = new THREE.Mesh(new THREE.CircleGeometry(0.009, 16), iris);
    irisMesh.name = `${name}-iris`;
    irisMesh.position.z = 0.021;
    const pupilMesh = new THREE.Mesh(new THREE.CircleGeometry(0.004, 12), pupil);
    pupilMesh.name = `${name}-pupil`;
    pupilMesh.position.z = 0.022;
    group.add(eyeball, irisMesh, pupilMesh);
    return group;
}
//# sourceMappingURL=index.js.map