import { copyFileSync, mkdirSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node20",
  onSuccess: async () => {
    // Bundle a copy of the pricing file next to the built output so the
    // package is self-contained at runtime.
    mkdirSync("dist/data", { recursive: true });
    copyFileSync(
      "src/data/pricing-v2026.06.yaml",
      "dist/data/pricing-v2026.06.yaml",
    );
  },
});
