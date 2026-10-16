# Central Yawara

Plataforma interna de gestão da **Associação Atlética Acadêmica de Psicologia Yawara**.

O aplicativo tem dois modos, escolhidos pela variável `NEXT_PUBLIC_DATA_SOURCE`:

| Modo | Para quê | Onde ficam os dados |
|---|---|---|
| `demo` (padrão) | Apresentação e testes de interface | Dados **fictícios**, só no navegador (localStorage). Perfis simulados, sem senha |
| `firebase` | Uso real | Firebase Authentication e Cloud Firestore; operações do servidor na rota de API do aplicativo (ou em Cloud Functions). Login com e-mail e senha, contas só por convite |

Os dois modos **nunca se misturam**: no modo `firebase` não há perfis de demonstração, seletor "Demo" nem dados fictícios, e os dados de demonstração nunca são copiados para um projeto real.

Há dois jeitos de colocar o modo `firebase` no ar:

| Implantação | Firebase | Servidor | Arquivos | Custo |
|---|---|---|---|---|
| **Gratuita (recomendada)** — [guia](docs/backend/implantacao-gratuita.md) | plano Spark | rota `src/app/api/[api]/route.ts` na hospedagem (ex.: Vercel Hobby) | links (Google Drive, OneDrive…) | R$ 0 |
| Plano Blaze — [guia](docs/backend/implantacao.md) | plano Blaze | Cloud Functions | envio para o Cloud Storage | por uso |

As duas usam **o mesmo código de servidor** (`functions/src`), as mesmas regras e os mesmos testes. A escolha é feita por variáveis (`NEXT_PUBLIC_API_TRANSPORT`, `NEXT_PUBLIC_FILE_STORAGE` — ver `.env.example`).

> **Situação atual.** O backend foi implementado e testado **somente com o Firebase Emulator Suite**. Nada foi publicado num projeto real: isso depende do responsável pela Atlética.

---

## Como rodar localmente

Requisitos: **Node.js 22.12 ou superior** (o servidor carrega pacotes ESM via `require`) e npm. Para os emuladores do Firebase: **Java 21** e a CLI do Firebase (instalada como dependência de desenvolvimento).

### Modo demonstração

```bash
npm install
npm run dev          # http://localhost:3000
```

A tela de login oferece **perfis de demonstração**. Para recomeçar do zero: *menu da conta → Restaurar dados de demonstração*.

| Perfil | Integrante fictício | O que mostra |
|---|---|---|
| Presidência | Rebeca Laís | Visão institucional, cargos, permissões e configurações |
| Secretaria | Helena Prado | Reuniões, atas em PDF e documentos |
| Direção Financeira | Caio Menezes | Receitas, despesas, comprovantes e relatórios |
| Direção de Marketing | Lívia Moraes | Briefings, artes, vídeos e calendário |
| Direção de Eventos | Bruno Teles | Eventos, tarefas, programação e fornecedores |
| Ensino e Extensão | Marina Saraiva | Projetos, palestrantes, presença e certificados |
| Assessor | Pedro Lins | Acesso restrito: tarefas de eventos e registro de vendas |

No modo demonstração as permissões são **simuladas**: servem para mostrar a interface e não protegem dados.

### Modo Firebase com emuladores (sem projeto real)

```bash
npm install && npm --prefix functions install
npm run functions:build
npm run emulators                       # Auth, Firestore, Storage e Functions (projeto demo-yawara)

# em outro terminal: dados fictícios SOMENTE no emulador
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 GCLOUD_PROJECT=demo-yawara npm run seed:emulator
```

Crie um `.env.local` com a configuração de emulador mostrada em [implantacao.md §9](docs/backend/implantacao.md#9-desenvolvimento-local-com-emuladores) e rode `npm run dev`. As contas criadas pelo seed usam os e-mails fictícios dos perfis (ex.: `rebeca@example.org`) e a senha `Yawara-demo-2026`, que **só existe no emulador**.

O seed se recusa a rodar sem as variáveis dos emuladores ou com um projeto cujo id não comece com `demo-`.

### Verificações

```bash
npm run typecheck            # TypeScript do aplicativo
npm run functions:typecheck  # TypeScript das Cloud Functions
npm run lint                 # ESLint
npm test                     # testes unitários (Vitest)
npm run test:rules           # regras do Firestore e do Storage, no emulador
npm run test:functions       # Cloud Functions de ponta a ponta, no emulador
npm run test:all             # tudo acima, exceto typecheck e lint
npm run build                # build de produção (modo definido no .env)
```

Os testes automatizados usam apenas dados fictícios gerados no próprio teste.

---

## Módulos

| Módulo | Rota | Principais interações |
|---|---|---|
| Login | `/login` | Modo demo: escolha de perfil. Modo Firebase: e-mail e senha, "manter conectado", recuperação de senha, avisos de sessão encerrada ou conta desativada |
| Convite | `/convite` | Aceite de convite e criação da senha (cadastro somente por convite) |
| Início | `/inicio` | Painel personalizado por perfil, atalhos, pendências |
| Campanhas e vendas (rifas) | `/campanhas` | Criação em etapas com **Acesso e permissões**; grade de números; venda/reserva de vários números de uma vez, sem venda duplicada; confirmar/desfazer pagamento; comprovantes; exportar **PDF / CSV / PNG** (divulgação sem dados pessoais e versão interna); encerrar campanha |
| Eventos e projetos | `/eventos` | Página com abas (visão geral, programação e tarefas, financeiro, divulgação, documentos, histórico), tarefas por departamento, fornecedores, duplicar estrutura sem dados financeiros ou pessoais |
| Documentos | `/documentos` | Biblioteca com filtros, envio de arquivo com progresso e cancelamento, versões, compartilhamento e revogação por público, arquivar/restaurar |
| Secretaria e reuniões | `/secretaria` | Registro em etapas, convidados, fluxo da ata (rascunho → aguardando aprovação → aprovada → arquivada), PDF da ata |
| Financeiro | `/financeiro` | Indicadores, lançamentos (receitas/despesas, situação, comprovante), relatórios com filtros e exportação |
| Marketing | `/marketing` | Quadro por etapa, lista e calendário de conteúdos, arquivos |
| Ensino e Extensão | `/extensao` | Projetos, palestrantes, inscritos, presença (dados pessoais restritos), certificados em PDF |
| Diretoria e organização | `/diretoria` | Integrantes, convites, cargos, departamentos e matriz de permissões |
| Auditoria | `/auditoria` | Registro das operações, com filtros (somente quem tem `audit.view`) |
| Configurações | `/configuracoes` | Dados institucionais, cargos e permissões, categorias, módulos, preferências da interface |

Componentes transversais: histórico de alterações, estados de carregamento/vazio/erro/sucesso, busca global (`Ctrl K`), notificações internas, fila de envios de arquivos, menu lateral recolhível e menu móvel.

---

## Arquitetura (resumo)

```
src/
  app/                   rotas (Next.js App Router)
  components/ features/  interface por módulo
  services/
    contracts.ts         interfaces usadas pelas telas
    local/               modo demonstração (navegador)
    firebase/            modo Firebase (leituras com regras + chamadas ao servidor)
    index.ts             escolhe a implementação pelo modo
  lib/                   permissões, políticas, marcadores de acesso, modelo do Firestore (compartilhado com o servidor)
  data/demo/             dados fictícios (só para o modo demo e o seed do emulador)
  app/api/[api]/         rota de API do servidor (implantação gratuita)
functions/               código do servidor: todas as gravações, validação, auditoria, arquivos
                         (roda na rota acima ou como Cloud Functions)
firestore.rules          regras do Firestore (fechado por padrão)
storage.rules            regras do Storage
firestore.indexes.json   índices (TTL: scripts/enable-ttl.sh, só Blaze)
scripts/                 seed do emulador e implantação inicial (bootstrap)
tests/rules/             testes das regras
docs/backend/            documentação técnica do backend
```

- **As telas nunca acessam os dados diretamente**: chamam `services.*` (via React Query).
- **Toda gravação de dados de negócio passa pelo servidor** (rota de API ou Cloud Functions), que confere identidade, conta ativa, permissões e regras de negócio, gravam em transação, registram auditoria e aplicam idempotência. O navegador só lê (com as regras de segurança) e marca as próprias notificações como lidas.
- A visibilidade de cada registro (pessoas, cargos, departamentos ou todos) é calculada no servidor e aplicada pelas regras.

Documentação completa:

- [Arquitetura do backend](docs/backend/arquitetura.md)
- [Modelo de dados](docs/backend/modelo-de-dados.md)
- [Segurança, permissões e privacidade (LGPD)](docs/backend/seguranca.md)
- [Implantação gratuita (Spark + Vercel)](docs/backend/implantacao-gratuita.md)
- [Implantação com o plano Blaze](docs/backend/implantacao.md)
- [Custos e faturamento](docs/backend/custos.md)
- [Relatório técnico final da Etapa 2](docs/backend/relatorio-final.md)

---

## O que depende do responsável pela Atlética

Nada disso pode ser feito pelo código sozinho. No caminho **gratuito** ([passo a passo](docs/backend/implantacao-gratuita.md)):

1. No projeto Firebase (plano Spark): ativar login por e-mail/senha, criar o Firestore em `southamerica-east1` e registrar o app da Web.
2. Gerar a chave da conta de serviço (guardada fora do repositório).
3. Publicar regras e índices do Firestore (`firebase deploy --only firestore:rules,firestore:indexes`).
4. Criar a conta gratuita na hospedagem (ex.: Vercel), importar o repositório e preencher as variáveis de ambiente.
5. Rodar `npm run bootstrap` **uma vez** para criar a estrutura inicial e o convite do primeiro administrador.

No plano Blaze, ver [implantacao.md](docs/backend/implantacao.md).

## Fora do escopo

- Pagamentos reais, integração bancária ou conciliação automática.
- Publicação automática em redes sociais.
- Envio de e-mails transacionais além do e-mail de redefinição de senha do Firebase (o link de convite é copiado e entregue por quem convidou).
- Sorteio oficial de rifas e certificados com validação externa.
- Monitoramento ou avaliação de desempenho de integrantes.

## Limitações conhecidas

- **Modo demo:** dados só no navegador atual; arquivos enviados somem ao recarregar; perfis trocáveis por qualquer pessoa.
- **Implantação gratuita:** arquivos são links (o acesso a eles é controlado pelo serviço onde estão); não há envio de arquivos para a Central.
- **Modo Firebase:** as listagens carregam até 500 registros visíveis por módulo (suficiente para o porte da Atlética; acima disso será preciso paginar na interface). Mudanças de cargo ou permissão chegam à sessão aberta em segundos, mas uma consulta já carregada só é refeita ao navegar.
- O bingo está apenas preparado na estrutura de dados.
- PDFs, CSVs e PNGs são gerados no navegador e não têm valor oficial.

## Identidade visual — arquivos ainda necessários

Os arquivos em `public/brand/` foram extraídos das imagens enviadas. Para a versão final:

- **Escudo/logomarca em SVG** (ou PNG transparente, mínimo 1024 px) — menu, login, ícone do app e cabeçalho dos PDFs.
- **Mascote em PNG transparente** (ou SVG) em alta resolução.
- **Fontes oficiais**, se houver. Hoje: Barlow Semi Condensed (títulos), Inter (texto) e JetBrains Mono (números), todas de licença aberta.
- **Códigos de cor oficiais** (hex) do dourado e do azul, se existirem no manual de marca.
- Versão monocromática do escudo para impressão.
