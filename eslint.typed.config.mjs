// Lint com informação de tipos (lento: ~40 s e ~2 GB): roda separado, em `npm run lint:typed`.
// Perfil focado do Vibe Coding Toolkit — só as duas regras de promessas. Contagens em docs/quality.md.
import defaultConfig from "./eslint.config.mjs";

const typed = {
  parserOptions: {
    projectService: true,
    tsconfigRootDir: import.meta.dirname,
  },
};

const config = [
  ...defaultConfig,
  {
    // Servidor e scripts: sem violações na adoção, então já entram como erro.
    files: ["functions/src/**/*.ts", "scripts/**/*.ts"],
    languageOptions: typed,
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  {
    // Aplicativo: legado medido em 18/10/2026 (118 misused + 17 floating). "warn" até zerar.
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: typed,
    rules: {
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
    },
  },
];

export default config;
