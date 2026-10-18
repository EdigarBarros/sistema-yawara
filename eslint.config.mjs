import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import quality from "./eslint-rules/index.cjs";

// Regras locais copiadas do Vibe Coding Toolkit (ver docs/quality.md); não editar
// eslint-rules/*.cjs à mão — a autoverificação é `npm run lint:rules`.
const config = [
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}"],
    plugins: { quality },
    rules: {
      // Regra nova com legado: "warn" até a contagem chegar a zero (linha de base em docs/quality.md).
      "quality/max-lines": ["warn", { max: 350 }],
    },
  },
  {
    // Telas falam com o Firebase só pelos serviços (src/services). O componente de sessão é a ponte autorizada.
    files: ["src/app/**/*.{ts,tsx}", "src/features/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    ignores: ["src/app/api/**", "src/components/auth/firebase-session.tsx", "**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["firebase/*", "firebase-admin", "firebase-admin/*", "firebase-functions", "firebase-functions/*"],
              message: "A interface acessa o Firebase pelos serviços (src/services), não pelo SDK.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["eslint-rules/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "functions/lib/**",
      "functions/node_modules/**",
      ".claude/**",
      ".agents/**",
      "graphify-out/**",
    ],
  },
];

export default config;
