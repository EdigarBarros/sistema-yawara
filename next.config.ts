import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Não gerar AGENTS.md/CLAUDE.md automaticamente no repositório.
  agentRules: false,
};

export default nextConfig;
