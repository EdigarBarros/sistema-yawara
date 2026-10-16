# Implantação e operação

Passos para colocar a Central no ar com o Firebase. Nada aqui foi executado
num projeto real durante o desenvolvimento: tudo foi testado com o **Firebase
Emulator Suite**. As ações abaixo exigem acesso de proprietário ao projeto.

> Antes de começar, leia [`custos.md`](./custos.md): Cloud Functions, o
> Cloud Storage e o agendador exigem o plano **Blaze** (pagamento por uso).

## 0. Ambientes

Recomendado: dois projetos Firebase separados — `central-yawara-dev`
(desenvolvimento/homologação) e `central-yawara-prod` (produção). Cada um tem
seus próprios dados, contas, regras e funções. Nunca use o projeto de produção
para testes.

```bash
cp .firebaserc.example .firebaserc   # preencha os ids reais (arquivo não versionado)
firebase use dev                      # ou: firebase use prod
```

## 1. Criar o projeto e o app web

1. Console do Firebase → Adicionar projeto (desative o Google Analytics se não
   for usar).
2. Ative o plano Blaze e crie um **alerta de orçamento** (Google Cloud →
   Faturamento → Orçamentos e alertas).
3. Configurações do projeto → Seus apps → **App da Web** → copie a
   configuração para `.env.local` (desenvolvimento) ou para o ambiente de
   hospedagem (variáveis `NEXT_PUBLIC_FIREBASE_*` de `.env.example`).

## 2. Authentication

1. Authentication → Método de login → **E-mail/senha**: ativar.
2. Authentication → Configurações → Ações do usuário: **desmarque "Ativar
   criação (inscrição)"** — contas só nascem por convite (feito pelo servidor).
3. Confirme que a **proteção contra enumeração de e-mails** está ativa.
4. Domínios autorizados: adicione o domínio de produção.
5. Modelos de e-mail → Redefinição de senha: idioma português; ajuste o nome
   do remetente ("Central Yawara").
6. (Opcional) Política de senha mais forte, se o plano permitir.

## 3. Firestore e Storage

1. Firestore Database → Criar banco **no modo de produção**, local
   `southamerica-east1` (São Paulo). O local não pode ser trocado depois.
2. Storage → Criar o bucket padrão. Escolha o local considerando custo e
   latência (ver `custos.md`).
3. Publique regras e índices:
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes,storage
   ```
   Na primeira publicação das regras do Storage, a CLI pede permissão para
   as regras consultarem o Firestore (papel de agente de serviço) — aceite.
4. Políticas de TTL (exclusão automática) para o campo `expireAt` nas
   coleções `idempotency`, `uploads`, `notifications` e `auditLogs`. O TTL
   exige o Blaze, por isso **não** fica em `firestore.indexes.json` (assim o
   mesmo arquivo publica no plano gratuito). Ative com:
   ```bash
   PROJECT=<id-do-projeto> sh scripts/enable-ttl.sh
   ```
   Rode de novo depois de cada `firebase deploy --only firestore:indexes`,
   caso a CLI desligue as políticas ao reaplicar as configurações de campo.
   Confira no console (Firestore → TTL).
5. CORS do bucket (necessário para o download autenticado no navegador):
   edite os domínios em `storage.cors.json` e rode
   ```bash
   gcloud storage buckets update gs://SEU-BUCKET --cors-file=storage.cors.json
   ```

## 4. Cloud Functions

1. Parâmetros: copie `functions/.env.example` para
   `functions/.env.<id-do-projeto>` e preencha `APP_BASE_URL` (endereço
   público do app, usado nos links de convite).
2. Publique:
   ```bash
   npm ci && npm --prefix functions ci
   firebase deploy --only functions
   ```
   O build (`functions/build.mjs`) roda automaticamente antes do deploy.
3. Região: `southamerica-east1` (igual a `NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION`).

## 5. App Check (recomendado em produção)

1. Google Cloud → reCAPTCHA Enterprise → criar chave do tipo site para o
   domínio do app.
2. Firebase → App Check → registrar o app web com o provedor reCAPTCHA
   Enterprise e a chave.
3. Defina `NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY` na hospedagem.
4. Acompanhe as métricas por alguns dias; depois ative a **imposição** para
   Firestore e Storage no console e defina `ENFORCE_APP_CHECK=true` nas
   funções (novo deploy).

## 6. Hospedagem do aplicativo

Opção recomendada: **Firebase App Hosting** (Next.js com SSR, mesmo projeto).

1. Console → App Hosting → conectar o repositório GitHub e a branch.
2. Preencha as variáveis em `apphosting.yaml` (ou no console). Todas as
   `NEXT_PUBLIC_*` precisam estar disponíveis no build.
3. Cada push na branch configurada gera um novo rollout.

Alternativa: qualquer plataforma compatível com Next.js 16 (ex.: Vercel),
com as mesmas variáveis de ambiente.

## 7. Primeiro administrador

Com credenciais do projeto no terminal (`gcloud auth application-default login`):

```bash
npm run bootstrap -- --project central-yawara-prod \
  --admin-email presidencia@exemplo.org --admin-name "Nome da Presidência" \
  --app-url https://central.exemplo.org
```

O script cria a estrutura institucional (departamentos, cargos, categorias e
configurações — **sem** dados fictícios), nunca sobrescreve nada existente e
mostra **uma vez** o link de convite do primeiro administrador (cargo
Presidente). A partir daí, novos integrantes são convidados pela própria
Central (Diretoria → Convidar integrante).

## 8. Testes antes de publicar

```bash
npm run typecheck && npm run lint && npm test   # aplicativo
npm run test:rules                               # regras (emuladores)
npm run test:functions                           # funções (emuladores)
```

Requer Java 11+ para os emuladores. Se você estiver atrás de um proxy que
intercepta conexões locais, rode os emuladores com `HTTPS_PROXY`/`HTTP_PROXY`
desativados.

## 9. Desenvolvimento local com emuladores

```bash
npm run functions:build
npm run emulators                       # Auth, Firestore, Storage e Functions
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  GCLOUD_PROJECT=demo-yawara npm run seed:emulator   # dados fictícios só no emulador
```

`.env.local` para usar os emuladores:

```
NEXT_PUBLIC_DATA_SOURCE=firebase
NEXT_PUBLIC_USE_EMULATORS=true
NEXT_PUBLIC_FIREBASE_API_KEY=demo-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=demo-yawara.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-yawara
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=demo-yawara.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=000000000000
NEXT_PUBLIC_FIREBASE_APP_ID=1:000000000000:web:demo
```

Contas de teste do seed: e-mails dos perfis da demonstração (ex.:
`rebeca@example.org`), senha `Yawara-demo-2026` — **somente no emulador**.

## 10. Logs, erros e recuperação

- Logs das funções: `firebase functions:log` ou Google Cloud → Logging
  (filtro por função). Os logs registram ação, usuário, `requestId` e código
  do erro — nunca o conteúdo enviado.
- Erros inesperados: Google Cloud → Error Reporting.
- Uso e custos: Firebase → Uso e faturamento; alertas de orçamento.
- **Reverter funções:** publique de novo a versão anterior
  (`git checkout <tag-anterior> && firebase deploy --only functions`).
- **Reverter regras:** Firebase → Firestore/Storage → Regras → histórico →
  restaurar a versão anterior (ou publicar o arquivo da versão anterior).
- **Reverter o app:** App Hosting → Rollouts → reverter para o anterior.
- **Backup do Firestore:** ative backups agendados ou exportações
  (`gcloud firestore export gs://BUCKET-DE-BACKUP`) antes de mudanças grandes.
- Nunca use regras permissivas "temporárias" em produção para contornar um
  problema.
