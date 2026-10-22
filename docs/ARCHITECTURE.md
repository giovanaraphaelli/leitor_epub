# Arquitetura

## Visão geral

Aplicação client-side (SPA), sem backend de dados — a única peça de servidor é o login do Google Drive (`server/`, ver Decisões técnicas). Todo o estado persistente (arquivos EPUB, progresso de leitura, temas) fica em IndexedDB, no navegador de quem estiver usando. O deploy é de um app estático (ex: Vercel/Netlify) — múltiplas pessoas podem acessar a mesma URL, cada uma com sua própria biblioteca local, sem que os dados se misturem ou precisem de login.

## Modelo de dados (IndexedDB via Dexie.js)

### `books`
| campo | tipo | descrição |
|---|---|---|
| id | string (SHA-256) | identificador do livro: o hash do conteúdo do EPUB (ver `bookIdFor`), igual em todo aparelho que tem o livro. Os livros anteriores à sincronização tinham um uuid, trocado na abertura do app (`migrateBookIds`) |
| title | string | título extraído do metadata do EPUB |
| author | string | autor extraído do metadata |
| coverBlob | Blob | imagem de capa extraída do EPUB |
| fileBlob | Blob \| null | arquivo `.epub` guardado (com as folhas de estilo saneadas na importação); `null` no livro que está só no Drive, baixado quando é aberto |
| addedAt | number (timestamp) | data de adição à biblioteca |
| fontScale | number | fator que leva o texto do livro ao tamanho do tema; medido na importação |
| locations | string | `book.locations.save()` do arquivo guardado |
| updatedAt | number (timestamp) | última mudança de título, autor, capa ou arquivo |
| fileUpdatedAt | number (timestamp) | quando os bytes do EPUB mudaram pela última vez |
| blobUpdatedAt | number (timestamp) | qual versão do arquivo este aparelho tem |
| pendingUpload | boolean | arquivo e capa ainda não subiram para o Drive |
| driveFileId | string | onde está o EPUB no Drive, depois de enviado (por qualquer aparelho) |
| driveCoverId | string | onde está a capa no Drive |

### `progress`
| campo | tipo | descrição |
|---|---|---|
| bookId | string | referência a `books.id` |
| cfi | string | Canonical Fragment Identifier (posição exata via epub.js) |
| percentage | number | progresso aproximado (0–100) |
| lastReadAt | number (timestamp) | última leitura |

### `highlights`
| campo | tipo | descrição |
|---|---|---|
| id | string (uuid) | identificador do grifo |
| bookId | string | referência a `books.id` |
| cfiRange | string | posição do trecho (CFI) |
| text | string | o texto grifado |
| color | string | cor do grifo |
| createdAt | number (timestamp) | criação |
| note | string | anotação do grifo, quando há |
| updatedAt | number (timestamp) | última mudança do grifo ou da nota; começa na criação |

### `deletions`
| campo | tipo | descrição |
|---|---|---|
| key | string | `book:<id>` ou `highlight:<id>` |
| deletedAt | number (timestamp) | quando foi removido |

Só é gravada com o Drive conectado neste aparelho (`settings.driveEnabled`), para a sincronização distinguir "removido" de "nunca teve". A exclusão de um livro vale também para os grifos dele.

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
| key | string | chave da preferência (ex: `activeTheme`) |
| value | any | valor da preferência |

Chaves em uso: `activeTheme`, `keepScreenOn`, `driveEnabled` (este aparelho foi conectado ao Drive e não desconectou; liga o registro de exclusões) e `driveFolders` (os IDs das pastas do app no Drive).

## Sincronização com o Google Drive

Opcional, com o Drive conectado (escopo `drive.file`: o app só enxerga o que ele mesmo criou). No Drive da pessoa:

```
MyBooks/
  <Título> - <Autor>.epub        (appProperties.bookId = o ID do livro)
  Dados do app/
    biblioteca.json              (livros, progresso, grifos e exclusões)
    capas/<ID>.jpg | .png | .webp
```

Uma sincronização (`syncNow`, em `src/lib/sync/run.ts`; uma por vez) acha ou cria as pastas; lê o `biblioteca.json`, junta com o banco daqui (`mergeLibrary`, uma função pura), grava aqui o que veio de fora e devolve o resultado ao Drive se ele mudou — conferindo antes a `version` do arquivo e recomeçando, até 3 vezes, se outro aparelho gravou no meio; envia os livros pendentes, um por vez; repete a junção, que põe no arquivo os livros que acabaram de subir; e baixa as capas que faltam. Um livro que o Drive recusa é pulado e fica pendente; um erro que interrompe os envios (o Drive cheio, por exemplo) não pula a segunda junção nem as capas, e só é relatado no fim. A biblioteca recarrega assim que o que veio de fora é gravado, sem esperar os envios. Roda ao abrir a biblioteca, depois de importar, editar ou remover, e no "Sincronizar agora". O livro que veio de outro aparelho fica com `fileBlob: null` até ser aberto (`ensureBookFile`). Com `?debug=1`, cada passo vai para o registro de diagnóstico.

## Estrutura de pastas (planejada)

```
server/             # login do Google Drive: rotas /api/auth/* e os arquivos do app (Node 24)
src/
  components/       # componentes de UI reutilizáveis (shadcn + custom)
  pages/            # Library, Reader, Settings
  lib/
    db/             # setup do Dexie + repositórios (books, progress, themes, highlights, deletions) e a migração dos IDs dos livros
    epub/           # wrappers/helpers em torno do epub.js
    drive/          # login e a API do Google Drive
    sync/           # sincronização com o Drive: biblioteca.json, junção, envio e download
  store/            # stores Zustand (tema ativo, livro atual, etc.)
  routes/           # configuração de rotas
```

## Decisões técnicas

- **Sem backend de dados; um servidor só para o login do Google Drive**: livros, progresso e grifos ficam no navegador (e, com a sincronização, no Drive da própria pessoa), sem contas nem API nossa — reduz drasticamente a complexidade e o custo de manter o projeto. O servidor de `server/` só troca o código do login do Google por um refresh token, guardado num cookie cifrado, e renova o access token; não tem banco, e nenhum livro passa por ele. Roda em Docker no Coolify durante o desenvolvimento; a produção na Vercel segue estática, sem ele.
- **Dexie.js em vez de IndexedDB puro**: API mais ergonômica, com suporte a queries e migrations de schema.
- **epub.js**: biblioteca madura para parsing/renderização de EPUB, expõe CFI (posição exata dentro do texto) o que resolve "salvar posição de leitura" com precisão.
- **shadcn/ui**: componentes acessíveis e sem estilo opinativo forte, facilita aplicar a identidade visual customizada (tema "menininha": paletas pastel, cantos arredondados, tipografia suave).
- **O ID do livro vem do conteúdo**: para o mesmo livro ser o mesmo em todo aparelho, e a sincronização levar o progresso e os grifos de um ao outro. Não é um uuid (cada aparelho daria o seu) nem o hash dos bytes do arquivo guardado (a importação reescreve as folhas de estilo e o `repack` data o `mimetype` com a hora de agora, então esses bytes mudam). É o SHA-256 da lista de arquivos do EPUB (caminho, CRC-32 e tamanho), lida do diretório central do zip, sem as folhas de estilo e o `mimetype`; descompactar tudo para hashear o conteúdo custava ~60 ms por arquivo no WebKit.
