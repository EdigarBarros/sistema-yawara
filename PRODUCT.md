# Central Yawara — produto

## Problema e objetivo

A diretoria da Associação Atlética Acadêmica de Psicologia Yawara organiza campanhas (rifas), eventos, reuniões, finanças, marketing e projetos de extensão. A Central reúne essa gestão num só lugar, com permissões por cargo, histórico e auditoria, para que cada integrante veja e faça só o que o cargo permite.

## Público e papéis

Integrantes e diretoria da Atlética, em computador e celular. Os acessos vêm de cargos configuráveis (Presidência, Secretaria, Direção Financeira, Marketing, Eventos, Ensino e Extensão, Assessor…) e de um cargo "Suporte do sistema", acima da Presidência. Contas só por convite. Perfis e permissões padrão: [README § Modo demonstração](README.md#modo-demonstração) e [seguranca.md](docs/backend/seguranca.md#modelo-de-permissões).

## Fluxos e módulos

Os módulos e suas interações principais estão no [README § Módulos](README.md#módulos): login e convite, início, campanhas e vendas, eventos, documentos, secretaria e atas, financeiro, marketing, ensino e extensão, diretoria, auditoria e configurações.

## Estado atual

- Interface completa nos dois modos: `demo` (dados fictícios no navegador) e `firebase` (uso real).
- Backend implementado e testado **só com o Firebase Emulator Suite**. Nenhum projeto real foi publicado.
- Dois caminhos de implantação documentados: gratuito (Spark + rota de API na hospedagem, arquivos guardados no próprio banco ou por link) e Blaze (Cloud Functions e Cloud Storage).

## Fora do escopo

Ver [README § Fora do escopo](README.md#fora-do-escopo) (pagamentos reais, publicação em redes sociais, e-mails transacionais além da redefinição de senha, sorteio oficial, avaliação de integrantes).

## Requisitos que não podem regredir

- Esconder um botão não é segurança: cada regra da interface vale também no servidor e nas regras do Firestore/Storage.
- Fechado por padrão; o navegador não grava dados de negócio.
- Visibilidade por registro calculada no servidor; dados pessoais (compradores, presença) separados e só para quem pode ver.
- Modos `demo` e `firebase` nunca se misturam; dados fictícios nunca vão para um projeto real.
- Português do Brasil, uso em celular e computador, tema claro e escuro, respeito a movimento reduzido.
- Privacidade e LGPD conforme [seguranca.md](docs/backend/seguranca.md#privacidade-e-lgpd).

## Critérios de aceite

- `npm run check` passa (lint, tipos, testes unitários, lint tipado sem erro, build).
- `npm run test:rules` e `npm run test:functions` passam nos emuladores.
- No modo demo, cada perfil de demonstração mostra só os módulos e ações do seu cargo.
- No modo Firebase com emuladores, o seed cria as contas fictícias e os fluxos do README funcionam com mensagens de sucesso só depois da resposta do servidor.

## Decisões pendentes (dependem da Atlética)

- Qual caminho de implantação usar (gratuito ou Blaze) e quem cria o projeto Firebase e a hospedagem — passos no [README](README.md#o-que-depende-do-responsável-pela-atlética).
- Arquivos finais de identidade visual — lista no [README](README.md#identidade-visual--arquivos-ainda-necessários).

## Manutenção

Atualize este documento quando objetivo, escopo, restrições ou critérios mudarem. Detalhes técnicos ficam em `docs/backend/` e evidências de setup em [docs/setup.md](docs/setup.md).
