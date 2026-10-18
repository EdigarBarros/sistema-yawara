@AGENTS.md

## Claude Code

- Plugins do projeto em `.claude/settings.json` (Superpowers, Ponytail, Caveman): ao abrir o repositório, aceite a confiança nos marketplaces para instalá-los. O webhook opcional do Ponytail fica desligado.
- Skills locais em `.claude/skills/`, controladas por `skills-lock.json` (atualizar com `npx --yes skills@latest update --project --yes`).
- Context7 em `.mcp.json` (servidor HTTP do projeto): aprove o servidor quando o Claude Code pedir.
