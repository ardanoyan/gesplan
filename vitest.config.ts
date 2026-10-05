import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // e2e/ holds Playwright specs; Vitest must not pick them up.
  test: { include: ["src/**/*.test.ts", "scripts/**/*.test.ts"], exclude: ["node_modules", "e2e"] },
});
