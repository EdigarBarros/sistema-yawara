# Central Yawara — instruções para agentes

Plataforma interna da Atlética Yawara de Psicologia. Escopo em [PRODUCT.md](PRODUCT.md); visão geral e módulos no [README](README.md).

## Stack

Next.js 16.3 (App Router, Turbopack) + React 19 + TypeScript estrito + Tailwind 4; Firebase (Auth, Firestore, Storage, Cloud Functions em `functions/`); Zod, React Query, Zustand; Vitest. Node 22 (≥ 22.12) e npm com `package-lock.json` (há outro em `functions/`). Java 21 só para os emuladores.

## Comandos

- Instalar: `npm ci && npm --prefix functions ci`
- Desenvolver: `npm run dev` (modo demo, sem Firebase, em http://localhost:3000)
- Lint: `npm run lint` · tipado (lento, ~2 GB): `npm run lint:typed` · autoverificação das regras locais: `npm run lint:rules`
- Tipos: `npm run typecheck` e `npm run functions:typecheck`
- Testes: `npm test` (unitários) · `npm run test:rules` e `npm run test:functions` (emuladores, precisam de Java 21)
- Build: `npm run build`
- Verificação completa sem emuladores: `npm run check`

`npm run reset`, `npm run bootstrap` e `npm run suporte` agem num projeto Firebase real: nunca rode sem pedido explícito.

## Onde está cada coisa

| Assunto | Fonte |
|---|---|
| Escopo, público, critérios | [PRODUCT.md](PRODUCT.md) |
| Arquitetura | [README § Arquitetura](README.md#arquitetura-resumo) e [docs/backend/arquitetura.md](docs/backend/arquitetura.md) |
| Dados, segurança, LGPD | [modelo-de-dados.md](docs/backend/modelo-de-dados.md), [seguranca.md](docs/backend/seguranca.md) |
| Rodar localmente e emuladores | [README § Como rodar](README.md#como-rodar-localmente) |
| Interface e acessibilidade | [docs/design.md](docs/design.md) |
| Verificações, regras de lint, revisão | [docs/quality.md](docs/quality.md) |
| Ferramentas de agente, decisões do setup, pendências | [docs/setup.md](docs/setup.md) |

## Regras do projeto

- Telas não acessam dados diretamente: chamam `services.*` (`src/services/contracts.ts`). O lint bloqueia SDK do Firebase em `src/app`, `src/features` e `src/components`.
- Toda gravação de negócio passa pelo servidor (`functions/src`), em transação, com permissão lida dentro dela, auditoria e idempotência. Esconder botão não é segurança: regra de interface também vale no servidor e nas regras do Firestore/Storage.
- Os modos `demo` e `firebase` nunca se misturam. Testes usam só o projeto `demo-yawara` e dados criados no próprio teste.
- Mudou regra de segurança, permissão ou coleção? Atualize `firestore.rules`/`storage.rules`, os testes em `tests/rules` ou `functions/test` e o documento em `docs/backend/`.
- Textos de interface e documentação em português do Brasil.

## Como trabalhar

- Leia instruções e código relevantes antes de editar. Separe fato observado, suposição, decisão e evidência.
- Defina critério de aceite e o comando que o prova antes de implementar. Correção de bug: reproduza primeiro e deixe um teste de regressão quando possível.
- Faça a menor mudança completa; reuse padrões, componentes e dependências existentes. Não crie abstrações, opções ou recursos não pedidos.
- Preserve validação, tratamento de erro, segurança, acessibilidade e mudanças locais. Não enfraqueça teste, regra ou lint para passar.
- Atualize o documento responsável junto com mudanças de comportamento, comando, coleção, fronteira ou configuração. Lição recorrente vai para o documento certo (tabela acima), não para um arquivo novo.
- Publicar, fazer deploy, mexer em projeto Firebase real, mandar mensagem a terceiros ou gerar custo exige pedido explícito. Ferramenta instalada não é autorização.
- Não adicione hooks de Git, bloqueio de push ou exigência de branch.

## Continuidade

- Pergunta de status durante trabalho autorizado: responda curto e continue. Pausa, cancelamento ou mudança de objetivo valem na hora.
- Um bloqueio para só o que depende dele; termine o trabalho independente e seguro antes de parar.
- Não repita tentativa idêntica sem evidência nova. Respeite limites de tempo, custo e tentativas.
- Trabalho que atravessa sessões: registre um handoff curto no plano/PR (objetivo, estado verificado, checagens, pendências, bloqueios, próxima ação). Ao retomar, confira arquivos, Git, checagens e processos reais antes de confiar nele.
- Só diga que algo continua em segundo plano se houver processo ou agente verificável.

## Delegação e revisão

- Delegue só quando isolar contexto, especialização ou paralelismo independente compensarem; tarefa simples se resolve direto.
- Subagentes: o modelo mais leve que cumpra o critério de aceite (busca, inventário, mudança mecânica verificável); capacidade maior para segurança, permissões, dados pessoais, regras do Firestore, concorrência ou diagnóstico ambíguo. Mantenha o modelo principal e a autenticação; sem troca de provedor, proxy ou API paga.
- Cada tarefa delegada recebe objetivo, contexto mínimo, arquivos permitidos, critério de aceite, checagens e formato de retorno. Um escritor por arquivo; lockfiles, configuração compartilhada, portas dos emuladores e Git ficam com o coordenador. Revisores só leem.
- Confira o diff e rode as checagens antes de aceitar o resultado de um subagente.
- Mudança não trivial: revisão independente escolhida pelo risco (ver [docs/quality.md](docs/quality.md#revisão-depois-de-implementar)). Termine quando os achados relevantes estiverem resolvidos ou decididos e as checagens afetadas passarem.

## Ferramentas

Detalhes, escopo e estado de cada uma em [docs/setup.md](docs/setup.md). Confira se carregou antes de depender dela.

- **Superpowers** (processo), **Ponytail** `full` (menor solução completa; `stop ponytail` desliga), **Caveman** (conversa concisa em português; código, docs e commits em texto normal; `stop caveman` desliga). Instruções explícitas e execução já autorizada valem mais que aprovações repetidas.
- **Context7**: documentação atual de bibliotecas, um conceito por consulta, sem segredo nem código privado. Indisponível: use a documentação oficial (Next.js também traz docs em `node_modules/next/dist/docs/`) e registre a limitação.
- **Graphify**: grafo só de código em `graphify-out/` (fora do Git). Use para perguntas estruturais, confirme no código e regenere se estiver velho.
- **RTK**: se houver hook nativo ativo, comandos normais; sem hook, prefixe comandos suportados; `rtk proxy <cmd>` para saída completa.
- **Skills do projeto** (`.claude/skills/`): `vercel-react-best-practices` e `vercel-composition-patterns` ao escrever React/Next; `web-design-guidelines` ao revisar telas; `writing-guidelines` ao revisar docs; `next-dev-loop` para feedback em execução (precisa de `agent-browser` no PATH); `next-bundle-optimizer` para auditoria de bundle (hoje inutilizável: usa `next analyze`, que não existe no Next 16.3.8); `differential-review` para diffs sensíveis a segurança; `vercel-react-view-transitions` só quando pedirem transições; `find-skills` quando faltar uma capacidade concreta. `deploy-to-vercel`, `vercel-cli-with-tokens` e `vercel-optimize` só com pedido explícito de publicação/operação na Vercel.
- **Revisão de segurança**: prompt reutilizável descrito em [docs/quality.md](docs/quality.md#revisão-de-segurança); só leitura, relatório privado fora do repositório.
