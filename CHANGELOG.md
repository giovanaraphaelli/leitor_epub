# Changelog

Registro de alterações relevantes do projeto: o que mudou e por quê. Ver regras em [CLAUDE.md](CLAUDE.md#log-de-alterações).

## 2026-07-23

- **Scaffold inicial do projeto** — Vite + React 19 + TypeScript, Tailwind CSS v4 e shadcn/ui (base Radix, preset Nova).
  - *Por quê*: stack combinada definida no planejamento inicial (customização visual pesada exige componentes sem estilo opinativo forte, que o shadcn oferece).
- **Estrutura de dados local** — Dexie (IndexedDB) com tabelas `books`, `progress`, `themes`, `settings`; repositórios em `src/lib/db/`.
  - *Por quê*: decisão de não ter backend — cada usuário mantém sua biblioteca e progresso só no próprio navegador, sem necessidade de login.
- **Leitura com epub.js** — parsing de metadata/capa (`src/lib/epub/parse.ts`) e renderização paginada com restauração de posição via CFI (`src/pages/Reader.tsx`).
  - *Por quê*: epub.js expõe CFI (Canonical Fragment Identifier), que permite salvar a posição exata de leitura, não só um número de página.
- **epub.js fixado na versão 0.3.93** (não a mais recente).
  - *Por quê*: a única alternativa mais nova (`0.4.2`) depende de uma versão do `xmldom` com vulnerabilidade **crítica**; a `0.3.93` depende de uma versão com vulnerabilidade **alta** (menor severidade). Nenhuma versão estável do epub.js está livre desse problema hoje — escolhida a de menor risco. Reavaliar se sair uma versão nova da lib.
- **Tema ativo em Zustand** (`src/store/theme-store.ts`) com paletas prontas em `src/lib/db/presets.ts` (Claro, Escuro, Sépia, Rosa Pastel, Lavanda, Menta).
  - *Por quê*: base para a Fase 2 do roadmap (painel de customização) — já deixa a estrutura de tema pronta para o editor de cores/tipografia.
- **Trocado oxlint por ESLint** (flat config, `eslint.config.js`).
  - *Por quê*: preferência explícita da usuária por não usar oxlint.
- **Regra de lint desligada em `src/components/ui/**`** (`react-refresh/only-export-components`).
  - *Por quê*: arquivos gerados pela CLI do shadcn exportam variantes (ex: `buttonVariants`) junto do componente — padrão da própria lib, não um problema real de fast-refresh.
- **Validado o fluxo de leitura com um EPUB real** (livro de ~5MB, com capa e metadata completos): upload, extração de título/autor/capa, paginação e restauração de posição após reabrir o livro — tudo funcionou sem ajustes. Fase 1 do roadmap marcada como concluída no README, exceto o sumário (TOC), que ainda não foi implementado.
  - *Por quê*: validar com um arquivo real antes de começar a Fase 2 (customização), para não construir sobre uma base de leitura com problemas.
- **Painel de ajustes de leitura** (`src/components/reader/ReaderSettings.tsx`): colunas (1/2/auto via `rendition.spread()`), margem, tamanho de fonte e espaçamento entre linhas. Campo `columns` adicionado ao modelo de `Theme`.
  - *Por quê*: pedido direto da usuária por controle de layout de leitura (colunas, margens), além do que já existia no modelo de tema.
- **Margem aplicada como `padding` no container por fora do iframe do epub.js, não dentro do `<body>` do livro.**
  - *Por quê*: o CSS do próprio EPUB pode sobrescrever padding aplicado via `rendition.themes.default()`, então a margem não tinha efeito visível de forma confiável.
- **Removida uma chamada extra a `rendition.resize(null, null)`** que eu tinha adicionado para forçar recálculo de layout ao mudar a margem.
  - *Por quê*: essa chamada força um `clear()` completo dos iframes renderizados seguido de um re-`display()` assíncrono — em teste chegou a travar a tela ("Cannot read properties of undefined (reading 'manager')" quando chamada incorretamente, e depois um travamento silencioso). Rastreei o código-fonte do epub.js e `rendition.spread(...)` (já usado para colunas) já chama `manager.updateLayout()` incondicionalmente a cada render, que remede a largura atual do container (via `clientWidth`) e reaplica o layout às views já renderizadas, sem precisar limpar e redesenhar tudo. Mais simples e sem o risco de corrida.
- **Removida a opção de margem** (campo `margin` do `Theme`, slider no painel de ajustes, padding no container do leitor).
  - *Por quê*: feedback direto da usuária — não gostou do resultado visual/comportamento. Fica só colunas, fonte e espaçamento entre linhas por enquanto; margem pode voltar depois com outra abordagem se fizer sentido.
- **Corrigido o espaçamento entre linhas**, que não tinha efeito nenhum.
  - *Por quê*: a regra era aplicada só em `body` — o CSS do próprio EPUB normalmente define `line-height` direto em `p`, `li` etc., e um valor direto no elemento sempre ganha do valor herdado do body, mesmo com `!important` no body (herança não compete em especificidade). Corrigido aplicando a regra direto nos seletores de texto (`p, li, blockquote, div, span, td`) em `src/pages/Reader.tsx`.
- **Sumário (TOC) navegável** (`src/components/reader/TableOfContents.tsx`): lê `book.loaded.navigation`, mostra a árvore de capítulos (com subitens) num sheet lateral e navega via `rendition.display(href)`, fechando o sheet ao clicar num capítulo. Capítulo atual é destacado comparando com o `href` do evento `relocated`. Fase 1 do roadmap concluída.
  - *Por quê*: último item pendente da Fase 1 — livros de não-ficção como os que a usuária está testando dependem bastante de navegação por capítulo.
- **Corrigida a navegação pelo sumário**, que fechava o painel mas não ia para o capítulo (`rendition.display()` rejeitava com "No Section Found").
  - *Por quê*: inspecionando o EPUB de teste (`unzip`), o `nav.xhtml` está na raiz do arquivo e seus hrefs incluem o prefixo `OEBPS/` (ex: `OEBPS/Text/index_split_006.html`), enquanto o `content.opf` está dentro de `OEBPS/` e a spine guarda hrefs relativos a essa pasta, sem o prefixo (ex: `Text/index_split_006.html`) — os dois formatos só coincidem quando o nav document mora na mesma pasta do OPF, o que não é o caso aqui. Uma primeira tentativa usando `book.canonical(href)` piorou o problema (dobrava o prefixo para `OEBPS/OEBPS/...`). Corrigido em `resolveTocHref()` (`src/pages/Reader.tsx`), que remove segmentos do início do caminho até achar um que exista na spine (`book.spine.get()`), validado com os hrefs reais do livro antes de aplicar.
