# Interface e acessibilidade

## Direção

Ferramenta interna da diretoria, em português do Brasil, usada no computador e no celular. Tom institucional com as cores da Atlética (azul real e dourado), tema escuro por padrão e tema claro opcional.

## Sistema existente

A fonte da verdade é o código; aqui ficam só os ponteiros.

- **Tokens de cor e tema**: `src/app/globals.css` (variáveis em `[data-theme="dark"]` e `[data-theme="light"]`, expostas ao Tailwind 4 por `@theme inline`). Preferência `dark | light | system` salva no navegador por `src/stores/ui.ts`.
- **Fontes** (`src/app/fonts/`, licença aberta): Barlow Semi Condensed (títulos), Inter (texto), JetBrains Mono (números; use a classe `.tnum` para valores alinhados).
- **Componentes base**: `src/components/ui/` (botão, diálogo, formulário, menu, utilitários) sobre Radix UI. Não há shadcn/ui.
- **Componentes compartilhados**: `src/components/shared/` (estados, tabelas, filtros, histórico, envio de arquivos, público/compartilhamento).
- **Leiaute**: `src/components/layout/` (menu lateral recolhível, barra de abas no celular, busca global `Ctrl K`, notificações).
- **Marca**: `public/brand/`. Arquivos finais ainda pendentes: [README § Identidade visual](../README.md#identidade-visual--arquivos-ainda-necessários).

## Interação

- HTML semântico, navegação por teclado, foco visível e contraste adequado nos dois temas.
- Rótulos em todos os campos e controles; erro de validação ao lado do campo, em português.
- Operações assíncronas mostram progresso e resultado; sucesso só depois da resposta do servidor.
- Estados reais em toda tela de dados: carregando, vazio, **erro** (nunca "vazio" quando a consulta falhou), sem permissão, não encontrado, conflito. Detalhes em [arquitetura.md § Interface](backend/arquitetura.md#interface).
- Movimento reduzido: `globals.css` zera animações e transições com `prefers-reduced-motion: reduce`; animações novas devem continuar respeitando isso.
- Textos dependentes do modo usam `isDemoMode`/`isFirebaseMode` (`src/lib/mode.ts`).

## Leiaute e revisão

- Pontos de quebra padrão do Tailwind (`sm`, `md`, `lg`, `xl`); no celular, a navegação vai para a barra de abas inferior.
- Revise telas novas ou alteradas com a skill `web-design-guidelines` e confira os dois temas, o celular e o teclado.
- Ainda não há revisão de acessibilidade registrada nem teste automatizado de interface (E2E).

## Manutenção

Mudança visual ou de interação atualiza primeiro o token/componente de origem; atualize este guia quando uma regra mudar.
