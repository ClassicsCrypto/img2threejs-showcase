import { DecalGeometry } from "three/addons/geometries/DecalGeometry.js";
export function projectDecal(request) {
    return new DecalGeometry(request.mesh, request.position, request.orientation, request.size);
}
//# sourceMappingURL=index.js.map