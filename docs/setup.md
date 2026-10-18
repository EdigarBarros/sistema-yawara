# Setup de ferramentas de IA e evidências

## Fonte e contexto

- **Data**: 18/10/2026.
- **Toolkit**: [Vibe Coding Toolkit](https://github.com/soumatheusgomes/vibe-coding-toolkit), revisão `de66fe371a49f5a4d3b521759e5c401f390b6424` (17/10/2026). Todos os guias, modelos e regras vieram dessa mesma revisão.
- **Cliente**: Claude Code 2.1.302, numa sessão de nuvem (container descartável, sem IPv6, com proxy de saída). Modelo principal e autenticação mantidos.
- **Runtime**: Node 22.22.0, npm 10.9.4, Java 21 (emuladores).
- **Projeto**: Next.js 16.3.8, React 19, Firebase 13 (cliente), firebase-admin 14, firebase-tools 15.33. Nenhuma dependência foi atualizada neste setup.
- **Backup**: todo o estado anterior está no Git (commit `908913b`). As mudanças são aditivas, exceto `eslint.config.mjs`, `package.json` (scripts), `.gitignore` e `README.md`, todos recuperáveis pelo histórico.

## Decisões

| Decisão | Motivo | Rever quando |
|---|---|---|
| Stack mantida (Firebase, sem Drizzle/PostgreSQL, sem Pino) | É o produto existente, testado; o toolkit não autoriza migração | Nunca por causa do toolkit |
| Documentos já canônicos preservados: arquitetura → [README § Arquitetura](../README.md#arquitetura-resumo) + [docs/backend/arquitetura.md](backend/arquitetura.md); preparação local → [README § Como rodar](../README.md#como-rodar-localmente) + [implantacao.md §9](backend/implantacao.md#9-desenvolvimento-local-com-emuladores) | Evitar fontes concorrentes; por isso não há `docs/architecture.md` nem `docs/onboarding.md` | Se o README ficar grande demais |
| Criados: `AGENTS.md`, `CLAUDE.md`, `PRODUCT.md`, `docs/design.md`, `docs/quality.md`, este arquivo | Não havia equivalente | — |
| Só o cliente Claude Code | É o cliente usado; nada de Codex foi configurado | Se outro cliente for adotado |
| Instalações globais (RTK, agent-browser, Graphify) **não** feitas | Decisão do Edigar: o container é descartável. `uvx`/`npx` temporários só para validar | Ao preparar a máquina local (comandos abaixo) |
| Sem CI, sem hooks de Git, sem bloqueio de push | O projeto não tinha CI; o toolkit não impõe isso | Se o Edigar pedir CI |
| `next.config.ts` mantém `agentRules: false` | Escolha anterior do projeto (não gerar AGENTS/CLAUDE automáticos); o AGENTS.md aponta para os docs do Next em `node_modules/next/dist/docs/` | — |
| Memória = documentação versionada | A memória nativa do Claude fica no container e some; o índice é a tabela "Onde está cada coisa" do AGENTS.md | Se houver uso local frequente com memória nativa |

**Delegação**: subagentes escolhem o modelo mais leve que cumpra o critério (Haiku para inventário/leitura, Sonnet para implementação limitada e revisão de fixture, modelo maior para segurança real), sem trocar provedor nem autenticação. Regras completas no [AGENTS.md](../AGENTS.md#delegação-e-revisão).

## Matriz de cobertura

Legenda: **validado** (executado com resultado observado) · **configurado** (no projeto, sem execução observada) · **reutilizado** · **não se aplica** · **bloqueado**.

| Componente | Ação | Escopo | Estado e evidência |
|---|---|---|---|
| Superpowers 7.0.0 | Instalado (`claude plugin install --scope project`) | projeto (`.claude/settings.json`) | **Configurado**. O carregamento só é visível numa sessão nova; nesta sessão a skill de brainstorming não estava disponível e o protocolo foi seguido manualmente (desenho aprovado pelo Edigar) |
| Ponytail 5.3.2 (`full`) | Instalado | projeto | **Configurado**. Webhook/ledger opcionais deixados vazios (nenhum serviço externo) |
| Caveman 4.0.1 | Instalado | projeto | **Configurado**. Tem hooks do próprio plugin (SessionStart/UserPromptSubmit); ~2k tokens fixos por sessão |
| Context7 | `.mcp.json` com o servidor HTTP oficial | projeto | **Bloqueado aqui**: o proxy do container recusa `mcp.context7.com` (403). Próximo passo: numa sessão local, aprovar o servidor e fazer uma consulta real (resolver `next.js` → um conceito) |
| RTK | Não instalado | máquina | **Bloqueado (pré-requisito de máquina)**. Instalar: `brew install rtk-ai/tap/rtk` (ou release oficial) e `rtk init --global`; validar com `rtk gain --history` |
| Graphify 0.9.92 | `.graphifyignore`; grafo só de código via `uvx --from graphifyy` | projeto (saída fora do Git) | **Validado**: 294 arquivos, 2617 nós, 11542 arestas, sem LLM, sem `node_modules`/`.claude`; consulta `affected "functions/src/core/dispatch.ts"` devolveu os módulos do servidor. Grafo de 18/10/2026: regenere após mudanças (comando abaixo). Integração como skill do cliente: pendente (instalação de máquina) |
| Skills Vercel: `vercel-react-best-practices`, `vercel-composition-patterns`, `web-design-guidelines`, `writing-guidelines`, `vercel-react-view-transitions`, `vercel-optimize`, `deploy-to-vercel`, `vercel-cli-with-tokens` | `npx skills@1.7.2 add vercel-labs/agent-skills … --agent claude-code` | projeto (`.claude/skills/`, `skills-lock.json`) | **Configurado**. Nomes do frontmatter conferidos; catálogo atual igual ao do guia. Descoberta pelo cliente: verificar em sessão nova. Deploy/Vercel só com pedido explícito |
| `vercel-react-native-skills` | Não instalado | — | **Não se aplica**: não há app React Native/Expo |
| `find-skills` | Instalado | projeto | **Configurado** |
| `next-dev-loop` | Instalado (fonte `vercel/next.js@canary`) | projeto | Lado Next **validado**: `/_next/mcp` respondeu 9 ferramentas, `get_compilation_issues` vazio, `get_routes` com as rotas. Lado navegador **bloqueado**: exige `agent-browser ≥ 0.31.1` no PATH (`npm i -g agent-browser@latest`) |
| `next-bundle-optimizer` | Instalado | projeto | **Bloqueado por versão**: a skill usa `next analyze`/`next analyze export`, que não existem no Next 16.3.8 (só `experimental-analyze`). Não atualizar o Next só por isso; rever ao atualizar o Next |
| `supabase-postgres-best-practices` | Não instalado | — | **Não se aplica**: o banco é Firestore, não PostgreSQL |
| `gh-fix-ci` | Não instalado | — | **Não se aplica**: não há GitHub Actions; a skill é para Codex |
| `differential-review` (Trail of Bits) | Instalado | projeto | **Configurado**; uso descrito em [quality.md](quality.md#revisão-de-segurança) |
| Prompt de revisão de segurança | Fonte fixada na revisão `de66fe3` | documentação | **Configurado** em [quality.md](quality.md#revisão-de-segurança); caso de revisão só leitura validado no fixture (abaixo) |
| shadcn | Não instalado | — | **Não se aplica**: componentes próprios sobre Radix, sem `components.json` |
| Sentry MCP | Não configurado | — | **Não se aplica**: Sentry não foi escolhido; o app não tem SDK |
| agent-browser | Não instalado | máquina | **Bloqueado (pré-requisito de máquina)**. Fluxo crítico validado com o Chromium do container via `playwright-core` temporário (fora do projeto) |
| Chrome DevTools MCP | Não instalado | — | Sem necessidade atual (não há investigação de rede/desempenho em curso). Adotar quando houver: `claude mcp add chrome-devtools --scope project npx chrome-devtools-mcp@latest` |
| Memória em camadas | Documentação versionada (AGENTS.md como índice) | projeto | **Validado**: um subagente com contexto limpo (Haiku) achou comandos, linhas de base, skills e regras de segurança citando as fontes |
| Obsidian / MCP de memória | Não adotado | — | Sem necessidade concreta nem destino autorizado |
| Anthropic Skills / skill-creator | Não instalado no projeto | — | Já disponíveis na conta (skills sincronizadas); nenhuma tarefa do projeto precisa delas |
| aia-harness | Não instalado | — | Duplicaria o harness feito à mão |
| Plugins oficiais extras (code-review, hookify…) | Não instalados | — | O Claude Code já traz `/code-review` e `/security-review` |
| Hooks do cliente | Nenhum hook próprio | — | Sem necessidade; RTK/Caveman usam os mecanismos oficiais |
| Regra de ondas paralelas (`templates/rules/`) | Não copiada | — | Princípios resumidos no AGENTS.md; copiar se ondas paralelas virarem rotina |
| `task-handoff.md.template` | Não copiado | — | Handoff vai no plano/PR (AGENTS.md § Continuidade) |
| Quality gates ESLint (`eslint-rules/*.cjs`, autoverificação) | Copiados byte a byte; `max-lines` ativa | projeto | **Validado**: `npm run lint:rules` → 3× `ok`; contagens em [quality.md](quality.md#regras-de-lint) |
| Lint tipado focado | `eslint.typed.config.mjs` + `npm run lint:typed` | projeto | **Validado**: 0 erros; 135 avisos medidos em `src`; 42 s e ~2 GB vs 16 s e ~0,85 GB do lint rápido; sonda confirmou `error` no servidor |
| Fronteira interface → Firebase | `no-restricted-imports` nativo | projeto | **Validado**: 0 violações; sonda em `src/features` foi barrada |
| `templates/next/` (env, logger, Drizzle) | Não copiado | — | **Não se aplica**: contratos inexistentes no projeto |

## Verificações (antes → depois)

| Item | Antes | Depois |
|---|---|---|
| `npm run lint` | 0 problemas | 0 erros, 24 avisos (`max-lines`, regra nova) |
| `npm run typecheck` / `functions:typecheck` | ok / ok | ok / ok |
| `npm test` | 126 testes ok | 126 testes ok |
| `npm run build` | ok | ok |
| `npm run test:functions` (emuladores) | 272 ok | sem alteração de código do servidor |
| `npm run test:rules` (emuladores) | 6 falhas no Storage (proxy) | 38 ok com proxy desligado (causa em [quality.md](quality.md#problemas-conhecidos)) |
| `npm run lint:typed` / `lint:rules` / `check` | não existiam | ok / ok / ok |
| `npm audit` | — | produção: 4 high via `firebase@13` (sem correção compatível); detalhes em [quality.md](quality.md#dependências) |
| Fluxo no navegador (390×844, modo demo) | — | `/login` → aba Demonstração → perfil Rebeca → `/inicio` ("Bom dia, Rebeca") → `/campanhas`; 0 erros de console. Servidor de teste na porta 3100, encerrado |
| Reaplicação | — | Rodar de novo marketplace/plugin/skill não alterou `.claude/settings.json` nem `skills-lock.json`; 12 skills, sem duplicatas |

## Avaliação do harness (toolkit `docs/07`, avaliador sha256 `14220a75…`)

| Caso | Cliente/modelo | Resultado |
|---|---|---|
| Correção de fronteira | Claude Code, subagente Sonnet | **Passou**: baseline 5/7 (falhas esperadas); depois 7/7, conferido de novo pelo coordenador; `AGENTS.md` e `local-notes.txt` intactos (hash) |
| Revisão de segurança só leitura | subagente Sonnet | **Passou**: fixture inalterado (hash), relatório privado fora do repositório com acesso entre tenants e identidade ausente, exemplos concretos, severidade e confiança |
| Descoberta de instruções (contexto limpo) | subagente Haiku | **Passou** nas 8 perguntas, com fontes; apontou a falta deste arquivo, criado em seguida |
| Handoff velho, conflito de recursos, pausa/retomada, reaplicação completa | — | **Não executados**: exigem interação observável entre sessões. A reaplicação foi feita parcialmente (tabela acima) |

Contexto limpo de subagente não é um cliente reiniciado: o carregamento de plugins, skills e `.mcp.json` numa sessão nova continua **não observado**.

## Manutenção

```bash
npx --yes skills@latest list                              # skills do projeto
npx --yes skills@latest update --project --yes            # atualizar skills (revise o diff e o skills-lock.json)
claude plugin list                                        # plugins do projeto
GRAPHIFY_NO_AUTO_REFRESH=1 uvx --from graphifyy graphify extract . --code-only --no-cluster   # regenerar o grafo
GRAPHIFY_NO_AUTO_REFRESH=1 uvx --from graphifyy graphify query "pergunta"                     # consultar
npm run lint:rules && npm run check                       # quality gates
```

Para repetir este setup preservando o que existe: reexecute o prompt 12 do toolkit; ele descobre o estado atual. Para atualizar as regras locais, copie `templates/eslint/eslint-rules/*.cjs` de uma revisão nova, rode `npm run lint:rules` e meça de novo.

**Pré-requisitos para a máquina local do Edigar** (não instalados aqui): RTK (`brew install rtk-ai/tap/rtk && rtk init --global`), agent-browser (`npm i -g agent-browser@latest && agent-browser install`), Graphify (`uv tool install graphifyy`), e login do Context7 (`npx ctx7 setup --claude` ou aprovar o `.mcp.json`).

## Pendências e próximos passos

- Abrir uma sessão nova do Claude Code e confirmar que carregam: plugins (`/plugin list`), skills (pedir uma revisão de tela → `web-design-guidelines`), Context7 (consulta real). Gatilho: primeira sessão local.
- Reduzir a dívida medida: 135 avisos de promessas em `src` (a maioria são handlers `async` em eventos) e 24 arquivos acima de 350 linhas, começando por `functions/src/modules/campaigns.ts`. Cada um como tarefa própria, com testes.
- Reavaliar a auditoria quando sair uma versão do `firebase` com `@grpc/grpc-js ≥ 1.13.6`.
- `next-bundle-optimizer`: rever compatibilidade ao atualizar o Next.
- Decisões que dependem da Atlética: ver [PRODUCT.md](../PRODUCT.md#decisões-pendentes-dependem-da-atlética).
