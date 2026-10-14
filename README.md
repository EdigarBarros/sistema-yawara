# Central Yawara

Plataforma interna de gestão da **Associação Atlética Acadêmica de Psicologia Yawara**.

> **Etapa 1 — somente front-end.** Tudo o que aparece na interface é **fictício** e fica salvo **apenas no navegador** de quem está usando (localStorage). Não há back-end, banco de dados, autenticação real, integração bancária, envio de e-mails ou publicação em redes sociais. Nenhum nome, telefone ou valor representa registros reais da Atlética.

---

## Como rodar localmente

Requisitos: **Node.js 20.9 ou superior** e npm.

```bash
npm install          # instala as dependências
npm run dev          # ambiente de desenvolvimento em http://localhost:3000
```

Versão de produção:

```bash
npm run build
npm start            # http://localhost:3000
```

Verificações:

```bash
npm run typecheck    # TypeScript
npm run lint         # ESLint
npm test             # testes unitários (Vitest)
```

Ao abrir, a tela de login oferece **perfis de demonstração** (não há senha real). Para recomeçar do zero, use *menu da conta → Restaurar dados de demonstração* ou *Configurações → Dados da demonstração*.

### Perfis de demonstração

| Perfil | Integrante fictício | O que mostra |
|---|---|---|
| Presidência | Rebeca Laís | Visão institucional, cargos, permissões e configurações |
| Secretaria | Helena Prado | Reuniões, atas em PDF e documentos |
| Direção Financeira | Caio Menezes | Receitas, despesas, comprovantes e relatórios |
| Direção de Marketing | Lívia Moraes | Briefings, artes, vídeos e calendário |
| Direção de Eventos | Bruno Teles | Eventos, tarefas, programação e fornecedores |
| Ensino e Extensão | Marina Saraiva | Projetos, palestrantes, presença e certificados |
| Assessor | Pedro Lins | Acesso restrito: tarefas de eventos e registro de vendas |

Dá para trocar de perfil a qualquer momento pelo seletor **Demo** na barra superior. As permissões são **simuladas** para demonstrar a interface; elas não protegem dados de verdade.

---

## Módulos

| Módulo | Rota | Principais interações |
|---|---|---|
| Login demo | `/login` | Escolha de perfil, aviso de ambiente demonstrativo |
| Início | `/inicio` | Painel personalizado por perfil, atalhos, pendências |
| Campanhas e vendas (rifas) | `/campanhas` | Lista com filtros; criação em etapas com **Acesso e permissões**; grade de números; detalhe do número; venda/reserva de vários números; editar, cancelar (com motivo) e liberar; confirmar/desfazer pagamento; exportar **PDF / CSV / PNG** (versão de divulgação sem dados pessoais e versão interna); encerrar campanha. Estrutura de dados preparada para bingo |
| Eventos e projetos | `/eventos` | Lista, criação, página com 6 abas (visão geral, programação e tarefas, financeiro, divulgação, documentos, histórico), tarefas por departamento, fornecedores, duplicar estrutura |
| Documentos | `/documentos` | Biblioteca com filtros, envio local de arquivo, versões, compartilhamento por público, arquivar/restaurar |
| Secretaria e reuniões | `/secretaria` | Registro em 5 etapas, fluxo da ata (rascunho → aguardando aprovação → aprovada → arquivada), PDF da ata |
| Financeiro | `/financeiro` | Indicadores, lançamentos (receitas/despesas, comprovante), relatórios com filtros e exportação, gráfico mensal com tabela alternativa |
| Marketing | `/marketing` | Quadro por etapa, lista e calendário de conteúdos |
| Ensino e Extensão | `/extensao` | Projetos, palestrantes, inscritos, presença, certificados em PDF |
| Diretoria e organização | `/diretoria` | Integrantes, cargos, departamentos e matriz de permissões |
| Configurações | `/configuracoes` | Dados institucionais, identidade visual, cargos e permissões, categorias de documentos e financeiras, módulos, preferências da interface (tema claro/escuro/sistema), dados da demonstração |

Componentes transversais: histórico de alterações, estados de carregamento/vazio/erro/sucesso, busca global (`Ctrl K`), notificações internas, breadcrumbs, menu lateral recolhível e menu móvel.

---

## Arquitetura

```
src/
  app/                 rotas (Next.js App Router)
  components/          ui/ (botões, formulários, diálogos), shared/ (tabelas, filtros, estados), layout/
  features/<módulo>/   formulários, diálogos e exportações de cada módulo
  services/
    contracts.ts       interfaces que o back-end da Etapa 2 deve implementar
    local/             implementação atual: dados no navegador
    index.ts           escolhe qual implementação a interface usa
  data/demo/           dados fictícios (gerados em relação à data atual)
  lib/                 permissões, políticas de acesso, formatação, validação, rifa
  hooks/ stores/ types/
```

- **As telas nunca acessam os dados diretamente.** Elas chamam `services.*` (via React Query), definidos em `src/services/contracts.ts`.
- `src/services/local/*` simula latência, valida entradas, aplica as mesmas políticas de acesso da interface (`src/lib/policies.ts`) e grava tudo de forma transacional no localStorage (`central-yawara:demo-db`).
- Operações que o navegador não executa de verdade (e-mail, pagamentos, publicação, auditoria oficial) **não são simuladas como sucesso**: a interface informa que dependem da próxima etapa.

### Como trocar pelo back-end (Etapa 2)

1. Criar `src/services/firebase/*` (ou outro provedor) implementando as interfaces de `src/services/contracts.ts`.
2. Trocar as atribuições em `src/services/index.ts`.
3. Reescrever as regras de `src/lib/policies.ts` e `src/lib/permissions.ts` **no servidor** (regras de segurança / Cloud Functions). No front-end elas servem só para a interface.
4. Remover `src/data/demo` e os avisos de demonstração.

---

## O que depende do back-end

- Autenticação real e gestão de sessões.
- Banco de dados compartilhado entre integrantes e dispositivos (hoje cada navegador tem a sua cópia).
- Armazenamento de arquivos (hoje ficam só na memória da aba e somem ao recarregar; os metadados permanecem).
- Aplicação real das permissões e regras de acesso no servidor.
- Histórico/auditoria oficial e imutável.
- Numeração oficial de registros (RIFA-…, EVT-…, REU-…).
- Notificações por e-mail ou push, convites e lembretes.
- Conciliação financeira, comprovantes oficiais, integrações bancárias ou de pagamento.
- Sorteio oficial de rifas e emissão de certificados com validação.
- Publicação automática em redes sociais.

## Limitações conhecidas desta etapa

- Os dados existem apenas no navegador atual; outro navegador ou aba anônima começa do zero.
- Arquivos enviados (documentos, comprovantes, artes) não sobrevivem a um recarregamento da página.
- Perfis e permissões são simulados — qualquer pessoa com acesso ao navegador pode trocar de perfil.
- O bingo está apenas preparado na estrutura de dados; a criação está desabilitada na interface.
- PDFs, CSVs e PNGs são gerados no navegador e não têm valor oficial.
- Não há monitoramento ou avaliação de desempenho de integrantes (fora do escopo por decisão do projeto).

## Identidade visual — arquivos ainda necessários

Os arquivos em `public/brand/` foram extraídos das imagens enviadas e servem para a demonstração. Para a versão final:

- **Escudo/logomarca em SVG** (ou PNG transparente em alta resolução, mínimo 1024 px) — usado no menu, login, ícone do app e cabeçalho dos PDFs.
- **Mascote em PNG transparente** (ou SVG) em alta resolução.
- **Nomes e arquivos das fontes oficiais**, se houver. Hoje são usadas Barlow Semi Condensed (títulos), Inter (texto) e JetBrains Mono (números), todas com licença aberta e servidas localmente.
- **Códigos de cor oficiais** (hex) do dourado e do azul, caso existam no manual de marca.
- Versão monocromática do escudo para impressão.
