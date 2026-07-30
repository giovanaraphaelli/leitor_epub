# CLAUDE.md

Guia para trabalhar neste projeto com Claude Code. Para visão geral do produto e roadmap, ver [README.md](README.md); para decisões de arquitetura e modelo de dados, ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Sobre o projeto

Leitor de EPUB pessoal em React, sem backend — tudo roda no navegador (upload de EPUB, progresso de leitura e temas ficam em IndexedDB via Dexie). Foco em customização visual completa (cores, tipografia, espaçamento).

## Stack

React + TypeScript + Vite · Tailwind CSS v4 + shadcn/ui (base Radix) · epub.js · Dexie (IndexedDB) · Zustand · React Router · ESLint (flat config)

## Comandos

```bash
npm run dev      # servidor de desenvolvimento
npm run build    # type-check (tsc -b) + build de produção
npm run lint      # eslint .
npm run preview  # preview do build de produção
```

## Convenções de código

- Alias `@/*` aponta para `src/*` (configurado em `tsconfig.json`, `tsconfig.app.json` e `vite.config.ts`).
- `src/components/ui/**` é código gerado pela CLI do shadcn (`npx shadcn@latest add <componente>`) — não editar à mão além de ajustes pontuais de estilo; para mudanças maiores, regenerar via CLI. Essa pasta tem uma exceção de lint (`react-refresh/only-export-components` desligada) em `eslint.config.js`.
- Persistência: tudo passa pelos repositórios em `src/lib/db/` (`books.ts`, `progress.ts`, `themes.ts`) — não acessar `db.*` (Dexie) diretamente fora dessa camada.
- Estado global (tema ativo, etc.) fica em `src/store/` (Zustand). Estado de UI local continua com `useState`/`useRef` nos próprios componentes.
- Sem comentários explicando o óbvio — só quando houver uma razão não evidente (ex: por que uma versão de lib foi fixada).
- Todo elemento clicável (botão, link, item de lista clicável, card usado como botão) leva `cursor-pointer` — `<button>` não tem isso por padrão no navegador. Estados desabilitados usam `cursor-not-allowed`. O componente base `Button` (`src/components/ui/button.tsx`) e `Toggle`/`ToggleGroupItem` já aplicam isso globalmente; elementos clicáveis feitos à mão (botão nativo, `<div role="button">`) precisam da classe explícita.

## Log de alterações

Todo trabalho relevante — feature nova, mudança de arquitetura, troca de lib, decisão de design — deve ser registrado em [CHANGELOG.md](CHANGELOG.md), com **data, o que mudou e por quê**. Ao terminar uma tarefa que altera o código, adicionar a entrada antes de considerar a tarefa concluída. O "por quê" é o que mais importa: decisões óbvias (ex: "criei o componente X porque a tela precisava dele") não precisam de registro; decisões com trade-off (ex: escolha de lib, versão fixada por vulnerabilidade, mudança de abordagem) sim.

## Regras de commit

- Sem backend/contas de usuário neste projeto — commits e mudanças são sempre locais até o momento em que formos configurar deploy.
- Formato [Conventional Commits](https://www.conventionalcommits.org/): `tipo(escopo opcional): descrição curta no imperativo`.
  - Tipos usados aqui: `feat`, `fix`, `docs`, `style`, `refactor`, `chore`, `test`.
  - Descrição em português, no imperativo (ex: `feat(reader): adiciona restauração de posição de leitura`).
  - Corpo do commit (quando necessário) explica o *porquê*, não o *o quê* — o diff já mostra o que mudou.
- Um commit por mudança logicamente coesa; evitar misturar refactor com feature nova no mesmo commit.
- Claude só cria commits quando explicitamente solicitado na conversa — nunca por conta própria, mesmo depois de terminar uma tarefa.
- Nunca usar `--no-verify`, `--amend` (a menos que pedido) ou `push --force`.
