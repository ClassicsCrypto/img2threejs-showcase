import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
export function exportCharacter(root, options = {}) {
    return new Promise((resolve, reject) => {
        const exporter = new GLTFExporter();
        const restoreRuntimeUserData = detachRuntimeUserData(root);
        const restoreFileReader = installFileReaderFallback();
        const cleanup = () => { restoreRuntimeUserData(); restoreFileReader(); };
        exporter.parse(root, (result) => { cleanup(); resolve(result); }, (error) => { cleanup(); reject(error); }, { binary: options.binary ?? true, onlyVisible: options.onlyVisible ?? true, trs: options.trs ?? false, animations: options.animations ?? [] });
    });
}
function detachRuntimeUserData(root) {
    const detached = [];
    root.traverse((object) => {
        if (object.userData && object.userData.sculptRuntime && typeof object.userData.sculptRuntime === "object") {
            detached.push({ userData: object.userData, value: object.userData.sculptRuntime });
            object.userData.sculptRuntime = "CharacterRuntime";
        }
    });
    return () => { for (const item of detached)
        item.userData.sculptRuntime = item.value; };
}
/** GLTFExporter 0.169 uses FileReader for binary blobs; Node has Blob but not FileReader. */
function installFileReaderFallback() {
    const scope = globalThis;
    if (typeof scope.FileReader === "function")
        return () => undefined;
    class NodeFileReader {
        result = null;
        onloadend = null;
        readAsArrayBuffer(blob) {
            void blob.arrayBuffer().then((value) => { this.result = value; this.onloadend?.(); });
        }
    }
    scope.FileReader = NodeFileReader;
    return () => { delete scope.FileReader; };
}
//# sourceMappingURL=export.js.map