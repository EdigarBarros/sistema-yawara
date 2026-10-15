# Segurança, permissões e privacidade

## Princípios

1. **Esconder um botão não é segurança.** Toda regra exibida na interface é
   aplicada também no servidor (Cloud Functions) e nas regras do
   Firestore/Storage.
2. **Fechado por padrão.** As regras negam tudo o que não está explicitamente
   liberado. O navegador não grava dados de negócio: só lê o que pode e marca
   as próprias notificações como lidas.
3. **Fonte confiável de autorização.** Permissões efetivas vêm do cargo
   gravado no Firestore, lidas **dentro da transação** de cada operação.
   Mudanças de cargo/permissão valem na hora, sem depender de tokens antigos.

## Autenticação

- Firebase Authentication com e-mail e senha. O cadastro não é aberto ao
  público: contas nascem de **convites** de uso único (token aleatório de 256
  bits; no banco fica só o hash SHA-256), com validade (padrão 7 dias) e
  revogação/renovação.
- A senha é definida pela própria pessoa na página do convite e é gerenciada
  pelo Firebase (nunca é gravada, exibida ou registrada em log pela Central).
  Regra mínima: 8 a 128 caracteres, com letra e número.
- Recuperação de senha pelo e-mail oficial do Firebase, com resposta neutra
  (não revela se o e-mail existe).
- Sessão: "manter conectado" (persistência local) ou só na aba atual.
- Conta desativada: o servidor bloqueia o usuário no Auth, revoga as sessões e
  zera o retrato de acesso — as regras passam a negar tudo imediatamente.
  O navegador percebe em tempo real e encerra a sessão.
- Troca de cargo também revoga as sessões abertas (força nova autenticação).
- Contas criadas por fora (ex.: alguém que conseguisse criar um usuário no
  Auth) não têm `userAccess` e, portanto, não leem nada.

## Modelo de permissões

Permissões explícitas no formato `<módulo>.<ação>` (catálogo em
`src/lib/modules.ts`). Cada cargo guarda a sua lista; nomes de cargo nunca são
usados para autorizar.

| Exemplo pedido | Permissão na Central |
|---|---|
| raffles.view / create / edit | `campaigns.view` / `campaigns.create` / `campaigns.edit` |
| raffles.registerSale | `campaigns.register` |
| raffles.confirmPayment | `campaigns.approve` |
| raffles.cancelSale | `campaigns.edit` (pendentes/reservas) ou `campaigns.approve` (pagas) |
| raffles.export | `campaigns.export` |
| events.view / create / edit | `events.view` / `events.create` / `events.edit` |
| documents.view / upload / manageAccess | `documents.view` / `documents.create` + `documents.edit` / `documents.edit` (+ `documents.admin`) |
| meetings.create / approve | `meetings.create` / `meetings.approve` |
| finance.view / createEntry / editEntry | `finance.view` / `finance.register` / `finance.edit` |
| marketing.manage | `marketing.create`, `marketing.edit`, `marketing.approve`, `marketing.archive` |
| extension.manage | `extension.create`, `extension.edit`, `extension.approve`, `extension.archive` |
| users.manage | `organization.create` (convidar) e `organization.edit` (editar/desativar) |
| roles.manage | `organization.admin` |
| departments.manage | `organization.create` / `organization.edit` (desativar exige `organization.admin`) |
| audit.view | `audit.view` (e `audit.export`) |

`<módulo>.admin` permite ver todos os registros do módulo, independentemente
do público configurado.

### Proteções contra elevação de privilégios (servidor)

- Ninguém concede ou retira permissões que o próprio cargo não tem.
- Permissões administrativas (`organization.*`, `settings.edit/admin`,
  `audit.*`) e mudanças que alteram o alcance de um cargo (nível, diretoria,
  departamento, situação) exigem `organization.admin`.
- Ninguém altera o próprio cargo, os próprios departamentos ou desativa a
  própria conta; ninguém altera integrantes com permissões que não possui.
- Atribuir ou convidar para um cargo exige possuir todas as permissões dele.
- Sempre resta pelo menos um integrante ativo com `organization.admin`.

Todas cobertas por testes em `functions/test/organization.test.ts`.

## Visibilidade por registro (compartilhamento)

Cada registro com público configurável guarda `readers`: marcadores derivados
do público escolhido (todos, diretoria, diretores, diretores e assessores,
departamento, cargos específicos, pessoas específicas) mais as pessoas que
sempre veem o registro (criador, responsáveis, participantes, vendedor). Cada
integrante tem os seus marcadores em `userAccess.tokens` (conta, cargo,
departamentos, nível). As regras liberam a leitura quando há interseção.

- O cálculo é único e compartilhado (`src/lib/access-tokens.ts`,
  `record-readers.ts`) e é testado contra as políticas da interface para todos
  os registros e perfis da demonstração.
- Mudar o público de um registro atualiza `readers` na mesma operação; a
  revogação vale para o Firestore **e** para os arquivos no Storage (as regras
  do Storage leem o `readers` do registro).
- Mudanças de cargo/departamento atualizam os marcadores da pessoa; os
  registros não precisam ser regravados.
- Não existem links públicos permanentes: downloads são autenticados.

## Regras do Firestore e do Storage

Arquivos: `firestore.rules` e `storage.rules`. Testes em `tests/rules/`
(acesso sem login, conta desativada, consultas amplas, marcadores alheios,
gravação das próprias permissões, notificações, auditoria, presença,
tíquetes de envio, arquivos de cada módulo).

Operações do Admin SDK **não** passam pelas regras — por isso cada função
verifica identidade, permissões, validação e integridade por conta própria.

## Integridade

- **Concorrência das rifas:** trava por número lida na transação; duas vendas
  do mesmo número nunca são concluídas (teste com vendas simultâneas).
- **Idempotência:** toda escrita tem `requestId`; a repetição da mesma
  requisição devolve o resultado já registrado (sem duplicar venda,
  lançamento, convite ou notificação).
- **Transições de estado** validadas no servidor (vendas, atas, conteúdos,
  lançamentos, projetos). Etapas de aprovação não podem ser puladas: a ata só
  é aprovada por quem tem `meetings.approve`, e um conteúdo de Marketing só
  chega a "Publicado" depois de "Aprovado" (por quem tem `marketing.approve`).
- **Arquivos:** tamanho exato, tipo real conferido pela assinatura binária,
  cópia definitiva sem token público, compensação se a operação falhar e
  limpeza diária de envios abandonados.

## Auditoria

`auditLogs` é gravada só pelo servidor, na mesma transação da operação, com
autor verificado, horário do servidor, ação, módulo, recurso, resumo e
resultado (`success`/`denied`). Tentativas recusadas por permissão também são
registradas. Inícios de sessão são registrados (sem IP ou dados do
dispositivo). Exportações com dados pessoais são registradas.

Nunca entram na auditoria: senhas, tokens, conteúdo de arquivos, nome/contato
de compradores ou nomes de participantes. Leitura exige `audit.view` (página
"Auditoria"). Retenção: `AUDIT_RETENTION_DAYS` (padrão 5 anos) via TTL.

Limitação: tentativas de login com senha errada são tratadas pelo próprio
Firebase Auth (bloqueio por excesso de tentativas) e não aparecem na
auditoria da Central.

## App Check

O cliente ativa o App Check com reCAPTCHA Enterprise quando
`NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY` está definida. As funções exigem
App Check quando `ENFORCE_APP_CHECK=true`. A imposição no Firestore e no
Storage é ligada no console depois de conferir as métricas (ver implantação).

## Privacidade e LGPD

O que a Central faz:

- **Minimização:** só os campos necessários (comprador: nome e contato;
  presença: nome e situação). Sem CPF, endereço ou dados sensíveis.
- **Separação:** dados pessoais ficam em documentos próprios com público
  restrito (`campaigns/{id}/buyers`, `projects/{id}/private/attendance`);
  exportações públicas nunca os incluem.
- **Controle de acesso** por permissão e por público; comprovantes e
  documentos financeiros restritos.
- **Sem exposição em URLs ou logs:** ids técnicos nas URLs; logs sem payload.
- **Retenção técnica** com TTL (notificações 180 dias, controles técnicos
  2–7 dias, auditoria configurável). Arquivar não é excluir.

O que depende da Atlética (a conformidade não vem automaticamente do uso do
Firebase):

- Definir a base legal e informar compradores/participantes (aviso de
  privacidade) sobre o uso dos dados.
- Nomear responsável pelo atendimento aos titulares e definir o procedimento
  para pedidos de acesso, correção e exclusão. Hoje a correção é feita pela
  própria Central (edição da venda/participante); a exclusão definitiva de
  dados pessoais exige procedimento administrativo (registro no console do
  Firebase por quem administra o projeto) — não há tela para isso.
- Decidir prazos de guarda de vendas, listas de presença e documentos
  financeiros (obrigações administrativas e de prestação de contas).
- Plano de resposta a incidentes e revisão periódica de quem tem acesso.
