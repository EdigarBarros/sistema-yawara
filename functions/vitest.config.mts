import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Testes das Cloud Functions contra o Firebase Emulator Suite.
 * Rode com `npm run test:functions` na raiz (sobe os emuladores automaticamente).
 */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    setupFiles: ["test/setup.ts"],
  },
});
