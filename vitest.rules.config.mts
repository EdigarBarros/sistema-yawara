import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Testes das regras de segurança (rode com `npm run test:rules`, que sobe os emuladores). */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/rules/**/*.test.ts"],
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
