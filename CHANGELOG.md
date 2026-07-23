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
