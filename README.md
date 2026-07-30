# Leitor EPUB

Leitor de EPUB pessoal, feito para rodar no navegador: você sobe seus próprios arquivos `.epub`, o app lembra onde você parou em cada livro e permite customizar a aparência da leitura (cores, tipografia, espaçamento) do seu jeito.

## Funcionalidades

- **Upload de EPUBs** — arraste ou selecione arquivos `.epub` para adicionar à sua biblioteca
- **Biblioteca** — grade com capa, título e autor dos livros adicionados; remover livro com confirmação
- **Leitura paginada** — navegação por capítulos, sumário (TOC), busca no texto
- **Progresso salvo automaticamente** — volta exatamente de onde parou em cada livro
- **Customização visual completa**:
  - Paletas prontas (rosa pastel, lavanda, menta, sépia, claro, escuro)
  - Editor livre de cor de fundo, cor do texto, fonte, tamanho, espaçamento entre linhas e margens
  - Temas customizados podem ser salvos e reutilizados

## Stack

| Camada | Escolha |
|---|---|
| UI | React + TypeScript + Vite |
| Estilo/componentes | Tailwind CSS + shadcn/ui |
| Renderização EPUB | epub.js |
| Persistência | IndexedDB via Dexie.js (100% local no navegador) |
| Estado global | Zustand |
| Roteamento | React Router |

Não há backend: cada pessoa que usa o app tem seus livros e progresso guardados localmente no próprio navegador. Isso significa que os dados não sincronizam entre dispositivos diferentes, mas também que nenhum arquivo sai da máquina do usuário.

Mais detalhes de arquitetura em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Como rodar

```bash
npm install
npm run dev
```

## Roadmap

### Fase 1 — MVP
- [x] Scaffold do projeto (Vite + React + TS + Tailwind + shadcn)
- [x] Upload e listagem de EPUBs na biblioteca
- [x] Leitura básica com epub.js (paginação)
- [x] Sumário (TOC) navegável
- [x] Salvar e restaurar posição de leitura por livro

### Fase 2 — Customização
- [x] Painel de temas com paletas prontas
- [x] Colunas, tamanho de fonte e espaçamento entre linhas
- [ ] Editor livre de cor e fonte
- [ ] Salvar temas customizados

### Fase 3 — Polimento
- [ ] Animações e transições suaves
- [ ] Empty states e ilustrações
- [ ] Responsividade mobile
- [ ] Busca dentro do livro
