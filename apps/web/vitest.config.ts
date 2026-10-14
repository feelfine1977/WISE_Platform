import { createRequire } from "node:module";
import { dirname } from "node:path";
import { searchForWorkspaceRoot } from "vite";
import { defineConfig } from "vitest/config";

// The style checks read the map library's token stylesheet; allow its folder wherever npm placed it.
const mapLibrary = dirname(createRequire(import.meta.url).resolve("wise-flow/package.json"));

export default defineConfig({
  esbuild: { jsx: "automatic" },
  server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), mapLibrary] } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    // The hosted Windows runners are several times slower than a desk computer; a test that renders the map or the
    // whole investigation can take more than the default five seconds there without being wrong.
    testTimeout: 30_000,
    // Stylesheets are read as text by the style checks; no test applies them.
    css: { include: [/\.css\?raw$/] },
  },
});
