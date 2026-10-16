# Modelo de dados (Cloud Firestore + Cloud Storage)

Formato definido em `src/lib/firestore-model.ts`. Datas de negócio são texto
ISO 8601 (UTC) gerado pelo servidor; datas sem horário seguem `yyyy-mm-dd`;
valores monetários são **centavos inteiros**.

Todas as gravações são feitas pelas Cloud Functions. O navegador lê o que as
regras permitem e grava apenas `notifications/{id}.readAt`.

## Coleções

| Caminho | Conteúdo | Leitura (regras) |
|---|---|---|
| `settings/system` | Dados institucionais e módulos ativos | conta ativa |
| `departments/{id}` | Departamento | conta ativa |
| `roles/{id}` | Cargo + permissões explícitas | conta ativa |
| `members/{uid}` | Nome, cargo, departamentos adicionais, situação | conta ativa |
| `memberPrivate/{uid}` | E-mail de acesso, origem do cadastro, desativação | o próprio ou `organization.edit` |
| `userAccess/{uid}` | Retrato de autorização (permissões e marcadores) | o próprio ou `organization.admin` |
| `invitations/{id}` | Convite (hash do token, validade, situação; e-mail só até o aceite; reserva transitória `accepting` com `claimId`/`claimedAt`) | `organization.create`/`edit` |
| `campaigns/{id}` | Campanha + `readers` + `stats` (+ `buyersSyncPending`/`buyersSyncToken`, internos do servidor) | `campaigns.view` + público |
| `campaigns/{id}/sales/{saleId}` | Parte pública da venda (números, situação, pagamento; histórico com texto neutro) | quem vê a campanha |
| `campaigns/{id}/buyers/{saleId}` | Nome, contato, observações, comprovante, motivos de cancelamento/pagamento desfeito + `readers` + `viewReaders` (cópia de quem vê a campanha) | quem vê a campanha **e** está no público "dados dos compradores" (ou é criador/vendedor) |
| `campaigns/{id}/numbers/{00042}` | Trava do número (venda ativa dona do número) | ninguém (servidor) |
| `events/{id}` | Evento com tarefas, programação e fornecedores + `readers` | `events.view` + público |
| `documents/{id}` | Metadados e versões + `readers` | `documents.view` + público |
| `meetings/{id}` | Reunião/ata + `readers` (público + criador + participantes) | `meetings.view` + público |
| `financeEntries/{id}` | Lançamento (+ `receiptHistory`) | `finance.view` |
| `contents/{id}` | Conteúdo de Marketing + `readers` | `marketing.view` + público |
| `projects/{id}` | Projeto (sem lista de presença) + `attendeeCount` + `readers` | `extension.view` + público |
| `projects/{id}/private/attendance` | Lista de presença + `editors` | quem pode editar o projeto |
| `documentCategories/{id}`, `financeCategories/{id}` | Categorias | conta ativa |
| `notifications/{eventKey}__{uid}` | Notificação de um destinatário | o destinatário |
| `auditLogs/{id}` | Auditoria (servidor) | `audit.view` |
| `searchIndex/{kind}__{id}` | Termos de busca + `readers` | ninguém (busca via função) |
| `uploads/{id}` | Tíquete de envio de arquivo (`pending` → `finalizing` → `finalized` → `attached`; ou `rejected`/`discarded`) | ninguém (lido pelas regras do Storage) |
| `idempotency/{uid}__{requestId}` | Resultado de requisição concluída + resumo (`payloadHash`) dos dados enviados | ninguém |
| `counters/{PREFIXO-ANO}` | Sequência dos códigos legíveis | ninguém |

### Rifas: números e concorrência

- A grade é derivada das vendas (`sales`). Uma venda tem um ou mais números.
- Cada número de uma venda **ativa** tem uma trava `numbers/{00042}` com o id
  da venda. Registrar uma venda lê as travas dos números pedidos **dentro da
  transação**; se alguma existir, a venda inteira é recusada (conflito) —
  duas pessoas nunca vendem o mesmo número.
- Uma operação aceita no máximo 100 números (limite de transação); conjuntos
  maiores devem ser divididos em vendas separadas — nunca há venda parcial.
- Situações: `reserved` → `pending` → `paid`; `cancelled` mantém a trava até a
  liberação (`releasedAt`), que apaga as travas e devolve os números.
- `stats` na campanha (reservados, pendentes, pagos, cancelados) é atualizado
  na mesma transação. Valores: potencial = quantidade × valor; vendido =
  (pendentes + pagos) × valor; pago = pagos × valor; pendente = pendentes ×
  valor; cancelado = cancelados × valor. Reserva não é venda; venda pendente
  não é dinheiro recebido.

### Documentos e arquivos (Cloud Storage)

| Caminho no Storage | Leitura |
|---|---|
| `staging/{uid}/{uploadId}/{nome}` | ninguém (só o envio pelo dono, com tíquete) |
| `documents/{docId}/v{n}/{uploadId}-{nome}` | quem vê o documento |
| `campaigns/{id}/receipts/{saleId}/{uploadId}-{nome}` | quem vê os dados do comprador **e** a campanha |
| `finance/{entryId}/{uploadId}-{nome}` | `finance.view` |
| `marketing/{contentId}/{uploadId}-{nome}` | quem vê o conteúdo |

Limites e formatos (conferidos pela assinatura binária, não pela extensão):
documentos 25 MB (PDF, imagens, Office/ODF, TXT/CSV); comprovantes de venda
10 MB e financeiros 15 MB (PDF e imagens); marketing 50 MB (PDF, imagens,
vídeos MP4/MOV, Office). SVG e HTML não são aceitos. O nome salvo recebe a
extensão do tipo **real** detectado (um texto enviado como `ata.html` vira
`ata.txt`), e o arquivo definitivo tem `Content-Disposition: attachment`.

Ciclo do tíquete: a operação reserva o tíquete numa transação (`finalizing`,
com o `requestId` que reservou), confere e copia o arquivo (`finalized`) e o
anexa na transação da operação (`attached`). A cópia temporária em `staging/`
só é apagada depois da confirmação: se a operação falhar, a cópia definitiva
é apagada e o tíquete volta a `pending` (o mesmo envio pode ser repetido).
Tíquetes vencidos (validade + 30 min) são recusados.

Versões de documentos nunca são apagadas; um comprovante substituído vai para
`receiptHistory`. Arquivamento não é exclusão.

## Índices

Definidos em `firestore.indexes.json` (consultas por `readers` + `updatedAt`,
notificações por destinatário, auditoria por módulo/autor/recurso/resultado,
busca por termos, convites por situação, lançamentos por evento). Campos
grandes (históricos, textos longos) são excluídos da indexação.

## Retenção (TTL)

Campos `expireAt` com política de TTL: `idempotency` (2 dias), `uploads`
(7 dias), `notifications` (180 dias) e `auditLogs`
(`AUDIT_RETENTION_DAYS`, padrão 5 anos). As políticas precisam ser ativadas no
projeto (ver implantação).

## Listagens e paginação

Listas carregam até 500 registros por módulo, mais recentes primeiro
(`updatedAt`), filtrados pelo público do usuário. Para o volume esperado de
uma Atlética isso cobre vários anos; a auditoria usa paginação por cursor.
