import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  dts: false,
  banner: { js: "#!/usr/bin/env node" },
  external: ["playwright", "playwright-core"],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
