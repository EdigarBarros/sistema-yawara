import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Não gerar AGENTS.md/CLAUDE.md automaticamente no repositório.
  agentRules: false,
  // SDKs do servidor (rota de API da implantação gratuita): carregados do node_modules em tempo de execução.
  serverExternalPackages: ["firebase-admin", "firebase-functions"],
};

export default nextConfig;
