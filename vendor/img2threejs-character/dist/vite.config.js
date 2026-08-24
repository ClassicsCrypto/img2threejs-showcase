import { defineConfig } from "vite";
export default defineConfig({ root: "demo", resolve: { alias: { "@character": "/plugin.ts" } }, build: { outDir: "../dist-demo", emptyOutDir: true } });
//# sourceMappingURL=vite.config.js.map