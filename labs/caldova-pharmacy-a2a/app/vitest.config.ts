import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@caldova/contracts": path.join(root, "packages/contracts/src/index.ts"),
      "@caldova/platform": path.join(root, "packages/platform/src/index.ts"),
    },
  },
  test: {
    coverage: {
      reporter: ["text", "json-summary"],
    },
    environment: "node",
    include: ["apps/**/*.test.{ts,tsx}", "packages/**/*.test.ts"],
    mockReset: true,
  },
});
