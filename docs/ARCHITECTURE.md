# Arquitetura

## Visão geral

Aplicação client-side (SPA), sem backend. Todo o estado persistente (arquivos EPUB, progresso de leitura, temas) fica em IndexedDB, no navegador de quem estiver usando. O deploy é de um app estático (ex: Vercel/Netlify) — múltiplas pessoas podem acessar a mesma URL, cada uma com sua própria biblioteca local, sem que os dados se misturem ou precisem de login.

## Modelo de dados (IndexedDB via Dexie.js)

### `books`
| campo | tipo | descrição |
|---|---|---|
| id | string (uuid) | identificador do livro |
| title | string | título extraído do metadata do EPUB |
| author | string | autor extraído do metadata |
| coverBlob | Blob | imagem de capa extraída do EPUB |
| fileBlob | Blob | arquivo `.epub` original |
| addedAt | number (timestamp) | data de adição à biblioteca |

### `progress`
| campo | tipo | descrição |
|---|---|---|
| bookId | string | referência a `books.id` |
| cfi | string | Canonical Fragment Identifier (posição exata via epub.js) |
| percentage | number | progresso aproximado (0–100) |
| lastReadAt | number (timestamp) | última leitura |

### `themes`
| campo | tipo | descrição |
|---|---|---|
| id | string (uuid) | identificador do tema |
| name | string | nome dado pelo usuário |
| background | string (cor) | cor de fundo |
| textColor | string (cor) | cor do texto |
| fontFamily | string | fonte selecionada |
| fontSize | number | tamanho da fonte (px/rem) |
| lineHeight | number | espaçamento entre linhas |
| columns | 'auto' \| 'single' \| 'double' | layout de colunas do texto |
| isPreset | boolean | se é um tema padrão do app ou criado pelo usuário |

### `settings`
| campo | tipo | descrição |
|---|---|---|
| key | string | chave da preferência (ex: `activeThemeId`) |
| value | any | valor da preferência |

## Estrutura de pastas (planejada)

```
src/
  components/       # componentes de UI reutilizáveis (shadcn + custom)
  pages/            # Library, Reader, Settings
  lib/
    db/             # setup do Dexie + repositórios (books, progress, themes)
    epub/           # wrappers/helpers em torno do epub.js
  store/            # stores Zustand (tema ativo, livro atual, etc.)
  routes/           # configuração de rotas
```

## Decisões técnicas

- **Sem backend/auth**: como cada usuário só acessa seus próprios dados locais, não há necessidade de contas ou API — reduz drasticamente a complexidade e o custo de manter o projeto.
- **Dexie.js em vez de IndexedDB puro**: API mais ergonômica, com suporte a queries e migrations de schema.
- **epub.js**: biblioteca madura para parsing/renderização de EPUB, expõe CFI (posição exata dentro do texto) o que resolve "salvar posição de leitura" com precisão.
- **shadcn/ui**: componentes acessíveis e sem estilo opinativo forte, facilita aplicar a identidade visual customizada (tema "menininha": paletas pastel, cantos arredondados, tipografia suave).
