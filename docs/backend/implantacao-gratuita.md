# Implantação gratuita (Firebase Spark + hospedagem gratuita)

Este é o caminho **sem custo**: o Firebase fica no plano gratuito (**Spark**)
e o aplicativo, junto com as operações do servidor, roda numa hospedagem
gratuita de Next.js (recomendado: **Vercel**, plano Hobby).

| Peça | Onde roda | Custo |
|---|---|---|
| Login (Authentication, e-mail e senha) | Firebase Spark | gratuito |
| Banco de dados (Cloud Firestore) e regras de segurança | Firebase Spark | gratuito dentro da cota diária |
| Telas e operações do servidor (rota `/api/...`) | Vercel (Hobby) | gratuito |
| Arquivos | **No próprio banco** (até 8 MB cada) ou **links** (Google Drive, OneDrive…) | gratuito |

O que muda em relação ao plano Blaze (ver [implantacao.md](implantacao.md)):

- **Não há Cloud Functions.** As mesmas operações do servidor (as mesmas
  regras, transações, auditoria e testes) rodam na rota
  `src/app/api/[api]/route.ts` do aplicativo, na hospedagem.
- **Não há Cloud Storage** (exige o Blaze). Duas opções gratuitas, escolhidas
  por `FILE_STORAGE` (ver a seção 3.1):
  - `database` (**recomendado**): o arquivo é enviado pela Central e guardado
    em pedaços no próprio Firestore. Até 8 MB por documento e 4 MB por
    comprovante; vídeo não é aceito. Quem pode abrir é decidido pelas regras
    da Central, igual aos registros. Links continuam aceitos para arquivos
    grandes.
  - `links`: documentos, comprovantes e artes são informados como **links**
    de compartilhamento. Quem controla o acesso a cada arquivo é o serviço
    onde ele está: compartilhe só com quem deve ver.
- Não há a rotina diária de limpeza (ela só existe para envios de arquivos).

> Nada aqui foi feito num projeto real durante o desenvolvimento: tudo foi
> testado com os emuladores do Firebase. Os passos abaixo exigem acesso de
> proprietário ao projeto Firebase e à conta da hospedagem.

## 1. Firebase (plano Spark)

1. Console do Firebase → seu projeto. Confirme que o plano é **Spark**
   (gratuito). Não é preciso cadastrar cartão.
2. **Authentication** → Começar → Método de login → **E-mail/senha**: ativar.
   - Configurações → Domínios autorizados: adicione o domínio da hospedagem
     (ex.: `central-yawara.vercel.app`).
   - Modelos de e-mail → Redefinição de senha: idioma português.
   - Se a opção existir no seu projeto, desative a criação de contas pelo
     cliente ("inscrição"). Se não existir, não há problema: uma conta criada
     por fora não tem cadastro na Central e não lê nada; o aceite de convite
     nunca reaproveita essas contas.
3. **Firestore Database** → Criar banco → modo de **produção** → local
   `southamerica-east1` (São Paulo). O local não pode ser trocado depois.
4. Configurações do projeto → Seus apps → **App da Web** (ícone `</>`) →
   registre o app e copie a configuração (`apiKey`, `authDomain`,
   `projectId`, `messagingSenderId`, `appId`). Esses valores são públicos por
   natureza (vão para o navegador).
5. Configurações do projeto → **Contas de serviço** → "Gerar nova chave
   privada". Baixa um arquivo JSON com a chave **administrativa**.
   - **Nunca** coloque esse arquivo no repositório, num e-mail ou em grupo de
     mensagens. Guarde-o fora da pasta do projeto.
   - Ele será usado em dois lugares: nas variáveis de ambiente do servidor na
     hospedagem (passo 3) e no script de configuração inicial (passo 4).

## 2. Regras e índices do Firestore

Publicar regras e índices não tem custo. No computador, dentro da pasta do
projeto:

```bash
npx firebase login
cp .firebaserc.example .firebaserc        # edite com o id real do projeto
npx firebase use default
npx firebase deploy --only firestore:rules,firestore:indexes
```

Não publique `storage` nem `functions` neste modo (exigem o Blaze).

A exclusão automática (TTL) de registros técnicos antigos exige o Blaze e por
isso não faz parte do arquivo de índices. No plano gratuito esses registros
(controle de requisições repetidas, notificações, auditoria) só deixam de ser
apagados sozinhos: o sistema funciona igual, as listas de notificações já são
limitadas, e o espaço ocupado é pequeno perto de 1 GiB. Se migrar para o
Blaze, ative com `scripts/enable-ttl.sh`.

## 3. Hospedagem (Vercel, plano Hobby)

1. Crie uma conta em vercel.com (pode entrar com o GitHub) e importe o
   repositório `sistema-yawara`. O framework é detectado como Next.js.
2. Settings → **Functions** → Function Region: **São Paulo (gru1)**, perto do
   Firestore (deixa as operações mais rápidas). A versão do Node.js vem do
   `package.json` (`engines.node: 22.x`); não a troque para 20.x: o servidor
   precisa do Node 22.12 ou superior.
3. Settings → **Environment Variables** (Production):

   | Variável | Valor |
   |---|---|
   | `NEXT_PUBLIC_DATA_SOURCE` | `firebase` |
   | `NEXT_PUBLIC_API_TRANSPORT` | `route` |
   | `NEXT_PUBLIC_FILE_STORAGE` | `database` (ou `links`) |
   | `NEXT_PUBLIC_FIREBASE_API_KEY` | do app da Web |
   | `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | do app da Web |
   | `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | do app da Web |
   | `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | do app da Web |
   | `NEXT_PUBLIC_FIREBASE_APP_ID` | do app da Web |
   | `FIREBASE_PROJECT_ID` | `project_id` do JSON da conta de serviço |
   | `FIREBASE_CLIENT_EMAIL` | `client_email` do JSON |
   | `FIREBASE_PRIVATE_KEY` | `private_key` do JSON (o texto inteiro, de `-----BEGIN` a `END PRIVATE KEY-----`) |
   | `FILE_STORAGE` | o mesmo valor de `NEXT_PUBLIC_FILE_STORAGE` |
   | `APP_BASE_URL` | endereço público do site (ex.: `https://central-yawara.vercel.app`) — usado nos links de convite |

   As variáveis **sem** `NEXT_PUBLIC_` ficam só no servidor e nunca chegam ao
   navegador. Nunca dê o prefixo `NEXT_PUBLIC_` à chave privada.
4. Deploy. Depois de publicado, abra `/login` para conferir.

> Outras hospedagens com suporte a Next.js (ex.: Netlify) também servem: as
> variáveis são as mesmas. O plano Hobby da Vercel é para uso não comercial;
> confira os limites atuais do plano escolhido.

## 3.1 Arquivos no próprio banco (sem link e sem custo)

Para enviar arquivos direto pela Central, sem depender de link:

1. Publique as regras atualizadas do Firestore (passo 2): elas liberam a
   leitura de cada arquivo só para quem pode ver o registro dono dele.
   ```bash
   npx firebase deploy --only firestore:rules
   ```
2. Na Vercel, Settings → Environment Variables: troque
   `NEXT_PUBLIC_FILE_STORAGE` **e** `FILE_STORAGE` para `database` (os dois
   precisam ser iguais) e faça um novo deploy (Deployments → ⋯ → Redeploy).

Como funciona e limites:

- O arquivo vai em pedaços de 512 KB pela rota do servidor, que confere dono,
  tamanho e validade do envio; o conteúdo real é conferido (um "PDF" que é
  texto é recusado) e ganha um resumo SHA-256, como no Cloud Storage.
- Tudo conta na cota gratuita do Firestore: **1 GiB no total**, somando
  registros e arquivos. Um PDF de 2 MB usa 4 gravações para enviar e cerca de
  16 leituras para abrir: centenas de documentos cabem com folga, mas não é
  lugar para fotos em alta ou vídeos (use link para esses).
- Limites por arquivo: documentos e arquivos de Marketing até 8 MB,
  comprovantes até 4 MB.
- Arquivos já informados como link continuam funcionando.
- Envios abandonados (a pessoa desistiu no meio) são apagados quando a mesma
  pessoa faz um novo envio.

## 4. Estrutura inicial e primeiro administrador

Uma única vez, no computador, com o JSON da conta de serviço:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/caminho/fora/do/projeto/chave.json \
  npm run bootstrap -- --project <id-do-projeto> \
  --admin-email <email-do-primeiro-admin> --admin-name "<Nome>" \
  --app-url https://central-yawara.vercel.app
```

O script só cria o que não existe (nunca apaga ou substitui), não grava dados
fictícios e mostra **uma vez** o link do convite do primeiro administrador.
Essa pessoa abre o link, cria a senha e, pela própria Central, convida os
demais integrantes.

**Mais simples, sem link:** acrescente `--senha` ao comando. O script pede a
senha no próprio terminal (ela não aparece na tela), cria a conta na hora e
basta entrar em `/login`. Se houver um convite pendente perdido para o mesmo
e-mail, ele é cancelado automaticamente.

## 4.1 Recomeçar do zero (reset)

Apaga **tudo** o que foi registrado e mantém só a conta e o cadastro do
administrador indicado, além da estrutura (configurações, departamentos, cargos
e categorias). Some: as outras contas de acesso e cadastros, convites,
auditoria, notificações, rifas (com vendas e compradores), eventos e tarefas
(a agenda), documentos, reuniões e atas, financeiro, marketing e extensão. Não
pode ser desfeito.

No Cloud Shell, dentro da pasta do projeto (com o código atualizado):

```bash
export GOOGLE_CLOUD_QUOTA_PROJECT=<id-do-projeto>
# 1) Ensaio: só mostra o que seria apagado
npm run reset -- --project <id-do-projeto> --manter <email-do-admin>
# 2) De verdade: pede para digitar "APAGAR <id-do-projeto>"
npm run reset -- --project <id-do-projeto> --manter <email-do-admin> --apagar
```

O script recusa rodar se o e-mail de `--manter` não tiver conta e cadastro
ativos, não mexe em coleções que não conhece e deixa um registro na auditoria
nova dizendo que o reset foi feito. Arquivos guardados no banco
(`FILE_STORAGE=database`) também são apagados. Com `FILE_STORAGE=links`, os
arquivos ficam nas pastas compartilhadas e não são afetados.

## 4.2 Conta de suporte (acima da Presidência)

O cargo **Suporte do sistema** tem todas as permissões e só pode ser alterado
ou atribuído por quem já está nele: a Presidência não consegue desativar,
trocar o cargo nem editar essa conta. Para criar o cargo, mover uma conta para
ele e (opcionalmente) apagar outra conta:

```bash
export GOOGLE_CLOUD_QUOTA_PROJECT=<id-do-projeto>
npm run suporte -- --project <id-do-projeto> --email <email-do-suporte> --remover <email-a-apagar>            # ensaio
npm run suporte -- --project <id-do-projeto> --email <email-do-suporte> --remover <email-a-apagar> --aplicar  # de verdade
```

## 5. Cotas gratuitas e cuidados

- **Firestore (Spark):** 50 mil leituras, 20 mil gravações e 20 mil exclusões
  por dia, e 1 GiB armazenado. Para dezenas de integrantes, o uso esperado
  fica bem abaixo disso. Se a cota do dia acabar, o banco recusa novas
  operações até a virada do dia (não há cobrança).
- **Authentication:** login por e-mail e senha é gratuito.
- **Hospedagem:** confira no painel da Vercel o uso do mês.
- **Arquivos por link:** use pastas compartilhadas da Atlética (não pessoais),
  para que os arquivos não se percam quando alguém sair da gestão.
- **Chave da conta de serviço:** se vazar, gere outra (Contas de serviço →
  excluir a chave antiga) e atualize a variável na hospedagem.

## 6. Se um dia quiser o plano Blaze

O código das Cloud Functions e o envio de arquivos pelo Storage continuam no
projeto. Basta seguir [implantacao.md](implantacao.md) e trocar as variáveis
`NEXT_PUBLIC_API_TRANSPORT=functions` e `NEXT_PUBLIC_FILE_STORAGE=storage`
(e `FILE_STORAGE`, que deixa de ser `links`).
