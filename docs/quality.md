# Qualidade

## Comandos

| Comando | O que prova | Precisa de |
|---|---|---|
| `npm run lint:rules` | As regras locais em `eslint-rules/` chegaram intactas (RuleTester do próprio ESLint) | — |
| `npm run lint` | Presets oficiais do Next (core-web-vitals + TypeScript), limite de linhas e fronteira interface → Firebase | — |
| `npm run lint:typed` | Promessas esquecidas ou passadas onde se espera retorno `void` (lint com tipos) | ~40 s e ~2 GB de memória |
| `npm run typecheck` / `npm run functions:typecheck` | TypeScript estrito do aplicativo e do servidor | — |
| `npm test` | Regras puras: rifa, serviço local, equivalência `readers` ≡ políticas, validações | — |
| `npm run build` | Build de produção no modo definido no `.env` (padrão: demo) | — |
| `npm run check` | Todos os itens acima, em sequência; para no primeiro erro | — |
| `npm run test:rules` | Regras do Firestore e do Storage | Java 21 (emuladores) |
| `npm run test:functions` | Servidor de ponta a ponta (Auth, Firestore, Storage) | Java 21 (emuladores) |
| `npm run test:all` | Unitários + regras + servidor | Java 21 |

Rode o teste afetado durante o trabalho e `npm run check` antes de entregar. Mudança em regras, permissões ou servidor também exige `test:rules`/`test:functions`. Nenhum desses comandos publica nada nem acessa projeto real.

## Regras de lint

| Regra | Onde | Severidade | Linha de base (18/10/2026) |
|---|---|---|---|
| Presets `eslint-config-next` | tudo | do preset | 0 problemas |
| `quality/max-lines` (350 linhas, sem contar testes) | tudo | `warn` | 24 arquivos acima |
| `no-restricted-imports` (SDK do Firebase fora de `src/services`) | `src/app`, `src/features`, `src/components` (exceto `src/app/api` e a ponte `components/auth/firebase-session.tsx`) | `error` | 0 |
| `@typescript-eslint/no-floating-promises` | `functions/src`, `scripts` | `error` | 0 |
| | `src` | `warn` | 17 |
| `@typescript-eslint/no-misused-promises` | `functions/src`, `scripts` | `error` | 0 |
| | `src` | `warn` | 118 (a maioria é handler `async` em `onClick`/`onSubmit`) |

Regras locais: `eslint-rules/*.cjs` são cópias byte a byte do Vibe Coding Toolkit (revisão em [setup.md](setup.md)). Não edite à mão; para atualizar, copie de novo da mesma revisão e rode `npm run lint:rules`. As regras `no-direct-console` e `no-direct-data-access` do toolkit **não** foram ativadas: o projeto não tem um módulo de log (os `console.*` existentes são avisos intencionais no navegador) nem um cliente de banco único; a fronteira de dados usa a regra nativa acima.

**Teto (catraca)**: `npm run check` falha se os avisos passarem da linha de base — `lint` com `--max-warnings 24` e `lint:typed` com `--max-warnings 159` (24 de tamanho + 135 de promessas). Ao reduzir avisos, baixe o teto no `package.json` junto; nunca suba o teto para acomodar código novo.

Quando uma contagem chegar a zero, promova a regra para `error`. Não aumente o limite, não adicione `eslint-disable` genérico nem ignore pastas para "zerar" uma contagem. Os 24 arquivos grandes (maior: `functions/src/modules/campaigns.ts`, 1193 linhas) são dívida para refatorar por responsabilidade, um arquivo por vez, com testes entre cada passo — trabalho separado deste setup.

## Estratégia de testes

- Lógica pura e regras de negócio: Vitest em `src/**/*.test.ts`.
- Regras de segurança: `tests/rules/` contra os emuladores, cobrindo casos permitidos **e** negados.
- Servidor: `functions/test/` contra os emuladores, com dados criados no próprio teste e o projeto `demo-yawara`.
- Correção de bug: reproduza com um teste que falha e mantenha-o como regressão.
- Não há teste automatizado de interface (E2E de navegador). Para conferir uma tela, use o modo demo e a skill `next-dev-loop` quando o `agent-browser` estiver disponível.

## Revisão depois de implementar

Escolha o escopo pelo risco e pelo diff real: requisitos e comportamento; regressões e testes; segurança e dados pessoais (permissões, regras, LGPD); integrações e configuração; acessibilidade; desempenho medido; clareza. Mudança não trivial recebe revisão independente quando disponível, sobre a revisão exata (commits + mudanças não commitadas), incluindo chamadores, contratos e testes afetados.

Cada achado precisa de severidade, local, cenário concreto de falha e evidência. Termine quando os achados relevantes estiverem resolvidos ou decididos, as checagens afetadas passarem e os riscos restantes estiverem registrados. Nova rodada só com evidência nova, risco aberto ou pedido explícito; respeite a quantidade de rodadas pedida sem reiniciar a contagem após correções.

## Revisão de segurança

- **Prompt reutilizável**: bloco "Prompt" de [`docs/prompts/13-security-review.md`](https://github.com/soumatheusgomes/vibe-coding-toolkit/blob/de66fe371a49f5a4d3b521759e5c401f390b6424/docs/prompts/13-security-review.md#prompt) do Vibe Coding Toolkit, na revisão `de66fe3`. Para usar, peça ao agente:
  - repositório inteiro: "Leia esse arquivo e execute o bloco Prompt neste repositório em modo repositório; salve o relatório redigido fora do repositório";
  - mudança: o mesmo pedido em modo diff, com `base=<ref> head=<ref> comparison=merge-base dirty=exclude` reais.
- Em modo diff, use a skill `differential-review` (`.claude/skills/`); sem ela, rastreamento manual do código.
- Só leitura por padrão: não corrige, não instala, não acessa projeto Firebase real nem endpoints publicados. Testes só com emuladores e dados sintéticos.
- O relatório fica **fora do repositório**, em pasta privada, sem segredos nem dados pessoais. Aqui só se registra data, escopo e situação (sem achados sensíveis).
- Pontos de atenção deste projeto: regras do Firestore/Storage, permissões lidas na transação, convites, retrato de acesso `userAccess`, dados pessoais separados, rota `src/app/api/[api]`.
- Para atualizar: troque a revisão no link acima por uma mais nova do toolkit e releia o bloco.

## Dependências

Auditoria de 18/10/2026 (`npm audit` e `npm audit --omit=dev`):

| Pacote | Escopo | Situação |
|---|---|---|
| raiz, produção | 4 high, todas pelo mesmo caminho: `firebase@13.0.0` → `@firebase/firestore@4.18.0` → `@grpc/grpc-js@1.9.16` (GHSA-m9gg-hp2v-232j, GHSA-f596-whhp-79r4) | `firebase@13.0.0` é a versão mais recente e fixa `grpc-js ~1.9`. O `npm audit fix` sugere voltar para `firebase@9` (rejeitado). O gRPC só é usado pelo SDK do Firestore no Node (testes/scripts); no navegador o SDK usa outro transporte, e o problema descrito é de verificação de certificado no lado servidor do gRPC. Risco baixo; reavaliar quando sair uma versão do `firebase` com `grpc-js ≥ 1.13.6` |
| raiz, desenvolvimento | +17 (5 moderate, 12 high) em `firebase-tools`, `@firebase/rules-unit-testing`, `eslint-config-next` e dependências | Só ferramentas locais. As "correções" propostas são *downgrades* de versão maior; não aplicar. Reavaliar a cada atualização dessas ferramentas |
| `functions/` | 0 | — |

Passar lint e build não significa auditoria limpa. Atualize dependências em grupos compatíveis (changelog, peers, `engines`), nunca com `--force` nem `audit fix --force`.

## Problemas conhecidos

- **`test:rules` atrás de proxy (verificado em 18/10/2026)**: com `HTTPS_PROXY`/`HTTP_PROXY` definidos (ex.: container de nuvem do Claude Code), 6 testes de `tests/rules/storage.test.ts` falham porque o `firestore.get()` das regras do Storage volta nulo (`storage.rules` linha 26, `Null value error`). Sem as variáveis de proxy, os 38 passam: `env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy -u JAVA_TOOL_OPTIONS npm run test:rules`. É o mesmo aviso de [implantacao.md §8](backend/implantacao.md#8-testes-antes-de-publicar); não mude `storage.rules` por causa disso.
- **`next dev` aberto por `127.0.0.1`**: o Next 16 bloqueia recursos de desenvolvimento de outra origem (`allowedDevOrigins`) e a página não hidrata. Abra por `http://localhost:<porta>`.

## Entrega

Verificações são comandos explícitos. O repositório não usa hooks de Git, bloqueio de push nem CI. Atualize este documento junto com scripts e regras que mudarem.
