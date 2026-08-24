import * as THREE from "three";
export function compileSemanticCurve(curve) {
    if (curve.points.length < 2)
        throw new Error(`curve ${curve.id} needs at least two points`);
    const result = new THREE.CatmullRomCurve3(curve.points.map(([x, y, z]) => new THREE.Vector3(x, y, z)), curve.closed ?? false, "centripetal", curve.tension ?? 0.5);
    return result;
}
export function sampleSemanticCurve(curve, divisions = 16) {
    return compileSemanticCurve(curve).getSpacedPoints(Math.max(2, divisions)).map((point) => [point.x, point.y, point.z]);
}
export function tangentAt(curve, t) {
    const tangent = compileSemanticCurve(curve).getTangentAt(Math.min(1, Math.max(0, t)));
    return [tangent.x, tangent.y, tangent.z];
}
//# sourceMappingURL=index.js.map