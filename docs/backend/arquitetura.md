# Arquitetura do backend — Central Yawara

Este documento descreve como o aplicativo (Next.js) se conecta ao Firebase e as
convenções que todo módulo segue. Complementos:

- [`modelo-de-dados.md`](./modelo-de-dados.md) — coleções, documentos, índices e retenção.
- [`seguranca.md`](./seguranca.md) — autenticação, permissões, regras e auditoria.
- [`implantacao.md`](./implantacao.md) — como criar o projeto, configurar e publicar.
- [`custos.md`](./custos.md) — recursos que geram custo.

## Visão geral

```
Navegador (Next.js)
 ├─ telas → hooks (React Query) → services.*  (src/services/contracts.ts)
 │      ├─ modo "demo": src/services/local/*   (dados fictícios no navegador)
 │      └─ modo "firebase": src/services/firebase/*
 │            ├─ LEITURAS: Firestore SDK com regras de segurança
 │            │   (consultas filtradas por `readers` ou pela permissão do módulo)
 │            ├─ ESCRITAS: Cloud Functions chamáveis (`<modulo>Api`)
 │            └─ ARQUIVOS: tíquete no servidor → envio para staging/ → servidor
 │                confere e move → download autenticado (sem links públicos)
 └─ sessão: Firebase Authentication + retrato de acesso `userAccess/{uid}` em tempo real

Cloud Functions (functions/, região southamerica-east1)
 ├─ core/dispatch.ts   transação + idempotência + autor + auditoria de recusas
 ├─ core/actor.ts      identidade e permissões lidas DENTRO da transação
 ├─ core/audit.ts      auditLogs (somente servidor)
 ├─ core/notify.ts     notificações internas por destinatário (sem e-mail/push)
 ├─ core/files.ts      tíquetes, conferência de conteúdo, cópia definitiva
 ├─ core/search-index.ts / src/lib/search-entries.ts   índice de busca
 └─ modules/<modulo>.ts  regras de negócio de cada módulo
```

O modo é escolhido em tempo de build por `NEXT_PUBLIC_DATA_SOURCE` (`demo` ou
`firebase`). Os modos nunca se misturam: a demonstração não acessa o Firebase,
e dados fictícios nunca são gravados num projeto real (o seed só roda em
emuladores `demo-*`).

## Código compartilhado (src/lib)

Funções puras usadas pela interface **e** pelo servidor (o pacote das
Functions incorpora esse código no build):

| Arquivo | Papel |
|---|---|
| `access-tokens.ts` | Marcadores de público; retrato de acesso (`computeAccess`) |
| `permissions.ts` | `hasPermission`, `matchesAudience`, permissões privilegiadas |
| `policies.ts` | Políticas por registro (ver, editar, aprovar...) |
| `record-readers.ts` | Campo `readers` de cada tipo de registro (≡ políticas de visualização, testado) |
| `firestore-model.ts` | Formato dos documentos no Firestore (e montagem de volta) |
| `search-entries.ts` / `search-terms.ts` | Entradas e termos do índice de busca |
| `raffle.ts` | Regras da grade de números |

## Convenções do servidor (Cloud Functions)

Cada módulo exporta um objeto de ações em `functions/src/modules/<modulo>.ts`,
registrado em `functions/src/index.ts` como `<modulo>Api`.

```ts
export const campaignsActions = {
  registerSale: mutation({
    module: "campaigns",
    schema: z.object({ ... }),             // validação (mensagens em português)
    async prepare(actor, input, ctx) {...}, // opcional: antes da transação (ex.: finalizeUpload)
    async run(tx, actor, input, ctx, prepared) {
      // 1) LEITURAS (tx.get, nextCode, requireModuleEnabled...) — todas antes de qualquer escrita
      // 2) regras de permissão e de negócio (fail("forbidden" | "conflict" | "invalid", msg))
      // 3) ESCRITAS (tx.create/set/update/delete) + auditInTx + indexRecord
      // 4) ctx.after(() => notify(...)) para efeitos depois da confirmação
      return { id };                        // referência pequena, sem dados pessoais
    },
    async present(result, actor) { ... },   // monta a resposta aplicando o que o autor pode ver
  }),
  // consultas especiais: query({ module, schema, async run(actor, input) {...} })
};
```

Regras obrigatórias:

1. **Autor e permissões dentro da transação.** O despachante carrega o autor
   (conta e cargo ativos) com `tx.get`; a ação confere permissões com
   `requirePermission`/políticas de `src/lib/policies.ts`. O UID vem do token
   verificado — nunca do corpo da requisição.
2. **Leituras antes das escritas** (exigência das transações do Firestore).
3. **Horário do servidor**: use `ctx.now` (texto ISO) para `createdAt`,
   `updatedAt`, histórico e auditoria.
4. **Auditoria** na mesma transação: `auditInTx(tx, {uid, name}, {action:
   "<modulo>.<acao>", module, resourceType, resourceId, summary, details},
   ctx.requestId, ctx.now)`. Sem dados pessoais (ex.: não registre o nome do
   comprador; registre o id da venda e os números).
5. **Histórico do registro**: `appendHistory(lista, historyEntry(uid, ação,
   resumo, ctx.now))` (limitado às últimas entradas; a trilha completa é a
   auditoria).
6. **Público (`readers`)** sempre recalculado pelo servidor com as funções de
   `src/lib/record-readers.ts` / `src/lib/firestore-model.ts`. Nunca aceite
   `readers` vindo do cliente.
7. **Índice de busca**: `indexRecord(tx, searchEntryFor.<tipo>(registro))` em
   toda criação/edição de registro pesquisável.
8. **Notificações**: `ctx.after(() => notify({ eventKey, kind, title, body,
   href, module, readers, actorId }))`. `eventKey` determinístico (ex.:
   `campaign_closed__<id>`) para não duplicar. Sem dados pessoais no texto.
9. **Códigos legíveis**: `await nextCode(tx, ctx, "RIFA")` no início da `run`.
10. **Arquivos**: o cliente envia `uploadId`; na `prepare`, chame
    `finalizeUpload(actor, uploadId, purpose, destDir, ctx)` (confere o
    conteúdo real e move para `destDir`); na `run`, grave o `FileRef` e chame
    `markAttached(tx, uploadId, recurso)`. Se a transação falhar, o arquivo
    definitivo é apagado automaticamente.
11. **Erros**: `fail(code, mensagem)` com texto em português, sem detalhes
    internos. Erros inesperados viram mensagem genérica (o log não inclui o
    payload).
12. **Idempotência**: automática por `requestId` (o despachante grava
    `idempotency/{uid}__{requestId}`). A `run` deve retornar só referências.

## Convenções do cliente (src/services/firebase)

```ts
export const firebaseX: XService = {
  async list() { return listVisible<X>("colecao", "modulo"); },           // leitura com regras
  async get(id) { return getVisible<X>(`colecao/${id}`, "Registro"); },
  async create(input) {
    const rid = takeRequestId();                                            // PRIMEIRA linha
    return callApi<X>("modulo", "create", input, rid);
  },
};
```

- `takeRequestId()` na primeira linha de toda escrita (antes de qualquer
  `await`) — garante o reenvio seguro feito por `useAction`.
- Uploads: `const uploadId = await uploadFile("document", file)` e envie o
  `uploadId` para a ação (progresso e cancelamento aparecem no indicador de envios).
- Downloads e pré-visualização: componentes `FileActions` e
  `useFileObjectUrl` (src/components/shared/file-actions.tsx).
- Dados pessoais separados (comprador, presença) são lidos à parte e
  juntados com `saleFromDocs` / `projectFromDocs`; quando o perfil não pode
  vê-los, vêm `null`/vazios — nunca "mascarados" no cliente.
- Tempo real só onde ajuda (grade da rifa, notificações), com cancelamento da
  assinatura ao sair da tela.

## Interface

- Textos dependentes do modo: `isDemoMode` / `isFirebaseMode` (`src/lib/mode.ts`).
  No modo Firebase não aparecem "fictício", "demonstração", "neste navegador".
- Estados reais: carregando, vazio, **erro** (nunca mostrar "vazio" quando a
  consulta falhou), sem permissão, não encontrado, conflito.
- Nada de sucesso simulado: a mensagem de sucesso só aparece depois da
  resposta do servidor.

## Testes

| Comando | O que testa |
|---|---|
| `npm test` | Regras puras (rifa, serviço local, equivalência readers ≡ políticas) |
| `npm run test:rules` | Regras do Firestore e do Storage (emuladores) |
| `npm run test:functions` | Cloud Functions contra os emuladores (Auth, Firestore, Storage) |

Os testes usam o projeto `demo-yawara` (emuladores) e dados criados no
próprio teste — nunca dados reais.
