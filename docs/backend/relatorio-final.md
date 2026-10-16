# Relatório técnico final — Etapa 2 (backend Firebase)

Situação em 16/10/2026. Tudo o que está descrito como **testado** foi executado
com o **Firebase Emulator Suite** (projeto `demo-yawara`) e dados fictícios.
**Nenhum projeto Firebase real foi criado, configurado ou publicado.** Os
passos que dependem do responsável pela Atlética estão na seção 9.

## 1. O que foi entregue

- O front-end da Etapa 1 continua igual na aparência e passa a ter dois modos
  (`NEXT_PUBLIC_DATA_SOURCE`): `demo` (dados fictícios no navegador) e
  `firebase` (dados reais). Os modos nunca se misturam e os dados fictícios
  nunca são copiados para um projeto real.
- Backend completo em Firebase: Authentication, Cloud Firestore, Cloud
  Storage, Cloud Functions (2ª geração, `southamerica-east1`), App Check
  (opcional/configurável), regras de segurança, índices e TTL.
- Documentação: [arquitetura](arquitetura.md), [modelo de dados](modelo-de-dados.md),
  [segurança e LGPD](seguranca.md), [implantação](implantacao.md) e
  [custos](custos.md).

## 2. Arquitetura (resumo)

- **Leituras** pelo navegador, sempre sob as regras do Firestore/Storage.
  Cada registro com público configurável guarda `readers` (marcadores
  calculados pelo servidor); cada pessoa tem `userAccess/{uid}` com permissões
  e marcadores, também calculado só pelo servidor.
- **Gravações** só pelas Cloud Functions chamáveis (`authApi`,
  `organizationApi`, `systemApi`, `campaignsApi`, `eventsApi`, `documentsApi`,
  `meetingsApi`, `financeApi`, `marketingApi`, `extensionApi`) e pela rotina
  diária `cleanupUploads`. Cada operação: autor e permissões conferidos dentro
  da transação, validação com mensagens em português, transação, auditoria na
  mesma transação, idempotência por `requestId` (com conferência dos dados) e
  efeitos posteriores (notificações) só depois da confirmação.
- **Arquivos:** tíquete de envio → envio para área temporária → conferência do
  tipo real pela assinatura binária, SHA-256, cópia definitiva sem link
  público e com extensão do tipo real → anexo na transação; compensação em
  caso de falha e limpeza diária.

## 3. Módulos implementados

| Área | O que funciona no modo Firebase |
|---|---|
| Autenticação | Login e-mail/senha, "manter conectado", recuperação de senha, sessão expirada, conta desativada encerrada em tempo real, proteção de rotas, mensagens em português |
| Convites | Cadastro só por convite de uso único (hash do token), validade, renovação, revogação, aceite com reserva atômica |
| Organização | Integrantes, cargos e departamentos configuráveis, permissões explícitas, anti-elevação de privilégio (permissões e alcance), último administrador protegido |
| Rifas | Campanhas com público de visualização, vendas e dados dos compradores; venda de vários números em transação sem duplicidade; valores em centavos; confirmação/desfazer pagamento; cancelamento e liberação; estatísticas; exportações com e sem dados pessoais |
| Eventos | Tarefas, programação, fornecedores, duplicação só da estrutura, aba financeira restrita, vínculos com outros módulos |
| Documentos | Envio com progresso e cancelamento, versões, compartilhamento e revogação (Firestore e Storage), arquivar/restaurar, download autenticado |
| Reuniões | Registro, convidados, fluxo da ata (rascunho → aprovação → aprovada → arquivada), PDF |
| Financeiro | Lançamentos, situações, comprovantes com histórico, relatórios e exportação, sem dupla contagem com as rifas |
| Marketing | Conteúdos com etapas e aprovação obrigatória antes de publicar, arquivos, calendário |
| Extensão | Projetos, palestrantes, inscritos e presença (dados pessoais restritos), certificados |
| Transversais | Busca com resultados filtrados por acesso, notificações em tempo real, auditoria com filtros e paginação, módulos ativáveis, exportações registradas na auditoria |

## 4. Testes executados (resultados reais)

| Suíte | Comando | Resultado |
|---|---|---|
| Unitários (políticas, readers ≡ políticas sobre toda a demonstração, regras de tela) | `npm test` | **113/113** (19 arquivos) |
| Regras do Firestore e do Storage | `npm run test:rules` | **32/32** (2 arquivos) |
| Cloud Functions de ponta a ponta no emulador | `npm run test:functions` | **254/254** (15 arquivos) |
| TypeScript (app e funções) e ESLint | `npm run typecheck`, `npm run functions:typecheck`, `npm run lint` | sem erros |
| Build de produção | `npm run build` (modo demo e modo Firebase) | ok |

**Testes no navegador (Playwright, app em modo Firebase contra os
emuladores):** rifas (venda real, confirmação, assessor sem dados do
comprador, duas pessoas vendendo o mesmo número → uma venda e um conflito);
convite e criação de conta; desativação em tempo real; envio e download real
de PDF; arquivo falso recusado; auditoria; busca respeitando o acesso;
eventos, reuniões e aprovação de ata com notificação em tempo real; financeiro
e marketing; extensão e documentos (revogação de acesso também no arquivo);
diretoria, convites, configurações, auditoria e telas de celular (390 px).

## 5. Revisão de segurança

Foram feitas três revisões adversariais independentes (autorização,
privacidade/LGPD e integridade) e testes no navegador por módulo. Todos os
problemas confirmados foram corrigidos com teste de regressão (que falha no
código antigo e passa no novo), e cada correção passou por um verificador que
tentou quebrá-la. Principais correções:

- Rifas: quem só edita vendas não consegue mais se colocar como responsável
  para ver o comprador; o responsável precisa poder vender na campanha;
  motivos de cancelamento ficam nos dados restritos; compradores e
  comprovantes exigem ver a campanha.
- Convites: aceite nunca reaproveita conta criada antes com o mesmo e-mail
  (com reserva atômica); quem convida não atribui cargo de alcance maior; o
  e-mail sai dos convites depois do aceite.
- Arquivos: extensão do tipo real, tíquete reservado em transação,
  compensação também na preparação, limpeza sem corrida.
- Aprovações: material de Marketing aprovado não muda sem nova aprovação;
  documento "Vigente" com nova versão de quem não valida volta para "Em
  elaboração".
- Repetição de requisição: só com os mesmos dados, e a resposta confere de
  novo o acesso.

## 6. Riscos e limitações conhecidos

- **Storage e módulo desativado:** as regras do Storage não conferem se o
  módulo está desativado (limite de consultas por regra). Os arquivos seguem
  acessíveis só a quem já vê o registro e conhece o caminho exato.
- **Listagens:** até 500 registros visíveis por módulo, sem paginação na
  interface (suficiente para o porte atual).
- **Convites:** quem pode convidar descobre se um e-mail já pertence a um
  integrante (mensagem de duplicidade) — inerente a evitar cadastros
  repetidos.
- **Aprovação de Marketing:** quem aprova aprova o conteúdo como está naquele
  momento; não há bloqueio de versão entre abrir e aprovar.
- **Primeira chamada lenta** depois de inatividade (funções sem instância
  mínima, para não gerar custo ocioso).
- PDFs, CSVs e PNGs são gerados no navegador e não têm valor oficial; não há
  pagamento real, integração bancária nem publicação automática em redes.

## 7. Custos

Cloud Functions, o Storage e o agendador exigem o plano **Blaze** (pagamento
por uso). Para dezenas de integrantes, o uso esperado fica perto das
franquias gratuitas; o Storage em `southamerica-east1` cobra desde o primeiro
GB (valores baixos). Detalhes e controles em [custos.md](custos.md). Configure
alertas de orçamento antes de ativar.

## 8. Como rodar e implantar

- Local com emuladores: README, seção "Modo Firebase com emuladores".
- Implantação: [implantacao.md](implantacao.md) (passo a passo).
- Observação deste ambiente de desenvolvimento: os emuladores precisaram rodar
  sem o proxy de rede da máquina (`env -u HTTPS_PROXY …`) para as regras do
  Storage consultarem o Firestore. Isso não afeta um projeto real.

## 9. O que depende do responsável pela Atlética

1. Criar os projetos Firebase (desenvolvimento e produção) e o app web.
2. Ativar o plano Blaze e os alertas de orçamento.
3. Authentication: e-mail/senha, **desativar a criação de contas pelo
   cliente**, domínio autorizado, modelo de e-mail em português.
4. Criar Firestore e Storage em `southamerica-east1`; publicar regras,
   índices e funções; ativar TTL e CORS do bucket.
5. App Check (reCAPTCHA Enterprise) e, depois de validar,
   `ENFORCE_APP_CHECK=true`.
6. Hospedagem (App Hosting ou outra) com as variáveis de `.env.example`.
7. Rodar `npm run bootstrap` uma vez para criar a estrutura inicial e o
   convite do primeiro administrador.
8. Enviar os arquivos de marca definitivos (escudo em SVG, mascote em PNG
   transparente, cores e fontes oficiais).
