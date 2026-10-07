# Leitor EPUB

Leitor de EPUB pessoal, feito para rodar no navegador: você sobe seus próprios arquivos `.epub`, o app lembra onde você parou em cada livro e permite customizar a aparência da leitura (cores, tipografia, espaçamento) do seu jeito.

## Funcionalidades

- **Upload de EPUBs** — arraste ou selecione arquivos `.epub` para adicionar à sua biblioteca
- **Biblioteca** — grade com capa, título e autor dos livros adicionados; remover livro com confirmação
- **Editar e exportar** — título, autor e capa editados no próprio arquivo; exportar o EPUB (no celular, pelo menu de compartilhar, onde fica o Send to Kindle)
- **Leitura paginada** — navegação por capítulos, sumário (TOC); vira a página com as setas na tela, as setas do teclado ou, no celular, deslizando o dedo
- **Busca dentro do livro** — encontra qualquer trecho de texto no livro inteiro, com o capítulo de origem e navegação direta ao clicar
- **Selecionar e grifar** — no celular, segure o dedo numa palavra e ajuste o trecho pelos pins do sistema; no computador, selecione com o mouse. Um cartão perto do trecho oferece copiar ou grifar, e tocar num grifo permite removê-lo. Os grifos ficam salvos por livro
- **Progresso salvo automaticamente** — volta exatamente de onde parou em cada livro
- **Customização visual completa**:
  - Paletas prontas (rosa pastel, lavanda, menta, sépia, claro, escuro)
  - Colunas, tamanho de fonte e espaçamento entre linhas
  - Seletor de fonte com 8 opções (sans-serif e serifadas), com prévia no próprio painel
  - Editor livre de cor de fundo e cor do texto, integrado à seção de paletas prontas

## Stack

| Camada             | Escolha                                          |
| ------------------ | ------------------------------------------------ |
| UI                 | React + TypeScript + Vite                        |
| Estilo/componentes | Tailwind CSS + shadcn/ui                         |
| Renderização EPUB  | epub.js                                          |
| Persistência       | IndexedDB via Dexie.js (100% local no navegador) |
| Estado global      | Zustand                                          |
| Roteamento         | React Router                                     |

Não há backend: cada pessoa que usa o app tem seus livros e progresso guardados localmente no próprio navegador. Isso significa que os dados não sincronizam entre dispositivos diferentes, mas também que nenhum arquivo sai da máquina do usuário.

Mais detalhes de arquitetura em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Instalar como app

O site é instalável (PWA): no Chrome do computador ou do Android, pelo ícone de instalar na barra de endereço ou em "Instalar app" no menu; no iPhone, pelo menu Compartilhar → "Adicionar à Tela de Início". Abre em janela própria, sem a barra do navegador. Depois da primeira visita funciona offline: o Service Worker guarda o app no cache e atualiza sozinho quando há versão nova.

No iPhone, o app da Tela de Início guarda os dados separado do navegador: livros importados no Safari ou no Chrome não aparecem nele, e é preciso importá-los de novo dentro do app. No computador e no Android, app e navegador compartilham os mesmos livros.

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
- [x] Seletor de fonte (8 opções, com prévia)
- [x] Editor livre de cor

### Fase 3 — Polimento

- [ ] Animações e transições suaves
- [ ] Empty states e ilustrações
- [x] Responsividade mobile
- [x] Busca dentro do livro
- [x] Instalável como app (PWA) e funcionando offline
- [x] Editar título, autor e capa; exportar o EPUB

### Fase 4 — Em definição

- [ ] **Formatação padrão automática, limpa para o Kindle** — prioridade atual. Objetivo: o EPUB exportado chegar ao Kindle sem os estilos do editor que brigam com os ajustes do aparelho (fonte, tamanho, margens, cores). Decidido: o arquivo guardado na biblioteca fica intacto; a limpeza é aplicada ao exportar (é o arquivo que o Kindle recebe) e, com as mesmas regras, na leitura dentro do app — assim o padrão pode mudar depois sem perder nada, bastando exportar de novo. A limpeza filtra o CSS propriedade por propriedade (como o "filtrar informações de estilo" do Calibre), em vez de apagar as folhas de estilo: muitos EPUBs marcam itálico e negrito por classe, e apagar tudo sumiria com eles. Referências: as [diretrizes de texto da Amazon para livros reflowable](https://kdp.amazon.com/en_US/help/topic/GH4DRT75GWWAGBTU) (corpo sem tamanho, entrelinha, cor ou fundo impostos; margens laterais 0; recuo ou espaço entre parágrafos; alinhamento explícito nos títulos; nada em px/pt) e o plugin [Modify ePub](https://github.com/kiwidude68/calibre_plugins/wiki/Modify-ePub) do Calibre (remover fontes embutidas, margens de @page, templates .xpgt da Adobe, JavaScript). As regras finais saem de um levantamento do acervo de EPUBs da usuária.
- [x] **Selecionar texto e grifar** — toque longo (celular) ou mouse seleciona; no celular a seleção é a do próprio sistema, com os pins para ajustar; um cartão perto do trecho oferece Copiar e Grifar, e tocar num grifo abre Remover. Uma cor só; os grifos ficam numa tabela do IndexedDB (`highlights`, por CFI), repintados ao abrir o livro, acompanham mudanças de fonte e largura e são apagados junto com o livro. Verificado em Chrome emulando celular, exceto a seleção do sistema, que só se vê no aparelho; **falta confirmar no Android e no iPhone** (o toque longo selecionando, os pins e se o painel do Touch to Search do Chrome cobre o cartão).
- [ ] **Grifos e anotações, o restante** — painel com os grifos do livro (ao lado de Sumário/Buscar, em ordem de leitura, levando ao trecho), anotar um grifo, várias cores, marcadores de página, exportar anotações (Markdown), uma tela com as anotações e os favoritos de todos os livros, dicionário (tradução da palavra selecionada; a definir API externa ou dicionário offline) e compartilhar o trecho como imagem. O painel de seleção já tem lugar para as novas ações.
- [ ] **Backup e sincronização entre aparelhos** — hoje livros, progresso, temas e preferências ficam só no IndexedDB do navegador: limpar os dados do site apaga a biblioteca inteira, e nada passa de um aparelho para outro. Em etapas, sem backend próprio: (1) pedir armazenamento persistente (`navigator.storage.persist()`), para o navegador não apagar os dados sozinho quando faltar espaço — não protege contra a limpeza manual; (2) exportar e importar um backup (progresso, grifos, temas e preferências, com os livros opcionais) num arquivo que a pessoa guarda onde quiser; (3) sincronizar com o Google Drive da própria pessoa, livros incluídos, via login Google no navegador e escopo restrito (`drive.file`, numa pasta "Leitor EPUB" visível no Drive dela). Decidido: cada livro ganha na importação um ID fixo, o hash SHA-256 dos bytes originais (`crypto.subtle.digest`), calculado uma vez e guardado — recalcular não serve, porque editar título/autor/capa regrava o arquivo (`EditBookDialog`); é por esse ID que progresso e grifos se ligam ao livro em outro aparelho ou ao reimportar o mesmo arquivo. O arquivo vai do aparelho da pessoa para o Drive dela sem passar por servidor nosso: o app não hospeda nem distribui livros, e compartilhar livros entre pessoas fica de fora. Notas técnicas: o IndexedDB continua sendo a fonte principal e o app segue funcionando offline; o progresso resolve conflito pelo `lastReadAt`; grifos apagados precisam de marca de exclusão, senão voltam do outro aparelho; o token do login só no navegador dura cerca de 1 h e não tem refresh token, então o app pede autorização de novo de vez em quando; login por popup no app instalado no iPhone costuma dar trabalho — testar cedo. Configuração: projeto no Google Cloud, OAuth Client ID (Web) com as origens autorizadas (localhost e o domínio de produção) e tela de consentimento; em modo de teste, só os e-mails cadastrados entram.

#### Onde paramos

Formatação para o Kindle — decidido o caminho (acima) e levantadas as referências; nada implementado ainda.

1. **Aguardando o acervo de EPUBs da usuária** para um levantamento (só leitura, sem alterar os arquivos) do CSS que os livros usam: fontes embutidas, tamanhos e entrelinha, justificação, recuos, espaço entre parágrafos, itálico/negrito marcados por classe, imagens, notas de rodapé, poesia.
2. **Decisões em aberto**, para depois do levantamento:
   - parágrafo com recuo na primeira linha e sem espaço entre eles (como livro impresso) ou sem recuo e com espaço;
   - se a leitura dentro do app segue o mesmo padrão ou mantém os ajustes atuais (fonte, entrelinha etc.) por cima dele.
3. **Rascunho das regras**: remover fontes embutidas e `font-family`, tamanho e entrelinha do texto corrido, cores e fundos, margens laterais e de `@page`, templates `.xpgt` da Adobe, medidas em px/pt e JavaScript; manter itálico, negrito, versalete, sublinhado, sobrescrito, alinhamento de títulos e blocos, recuos de poesia e citação (convertidos para %/em), quebras de página e tamanho de imagens (em %); acrescentar um CSS mínimo do app (parágrafo padrão, títulos com alinhamento explícito, capítulo em página nova, imagens sem passar da tela).
4. **Para testar**: o Kindle Previewer (gratuito, da Amazon) mostra como o livro fica no Kindle — instalar só com permissão da usuária, confirmando antes o tamanho do download. A prova final é enviar pelo Send to Kindle.

Também pendente, da edição de título/autor/capa: testar com os EPUBs da usuária e enviar um livro editado pelo Send to Kindle, para confirmar que título, autor e capa chegam certos no aparelho.
