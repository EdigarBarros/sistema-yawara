import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Não gerar AGENTS.md/CLAUDE.md automaticamente no repositório.
  agentRules: false,
  // SDKs do servidor (rota de API da implantação gratuita): carregados do node_modules em tempo de execução.
  serverExternalPackages: ["firebase-admin", "firebase-functions"],
  env: {
    // Versão publicada: as abas abertas comparam com /api/version para oferecer "Atualizar".
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || `local-${Date.now()}`,
  },
};

export default nextConfig;
