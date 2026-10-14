/**
 * Empacota as Cloud Functions em lib/index.js.
 * O código compartilhado com o aplicativo (src/lib e src/types, importado como
 * "@/...") é incorporado ao pacote; as dependências do Firebase e o Zod são
 * instalados pelo próprio deploy a partir de functions/package.json.
 */
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "lib/index.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  tsconfig: "tsconfig.json",
  external: ["firebase-admin", "firebase-admin/*", "firebase-functions", "firebase-functions/*", "zod", "zod/*"],
  logLevel: "info",
});
