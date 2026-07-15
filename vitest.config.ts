import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Tests import core lib modules that use `server-only` and the `@/*` alias.
// Alias `server-only` to a no-op so the guardrail/analyst modules import
// cleanly under vitest (there is no Next.js server boundary in a unit test).
export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./tests/shims/server-only.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  // Unit tests never touch CSS; override PostCSS so vitest doesn't try to load
  // the Tailwind v4 postcss config (its plugin is not a valid vite PostCSS plugin).
  css: { postcss: { plugins: [] } },
  test: {
    environment: "node",
    include: ["tests/**/*.spec.ts"],
    testTimeout: 60_000,
  },
});
