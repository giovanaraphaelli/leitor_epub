# Leitor EPUB

Leitor de EPUB pessoal, feito para rodar no navegador: você sobe seus próprios arquivos `.epub`, o app lembra onde você parou em cada livro e permite customizar a aparência da leitura (cores, tipografia, espaçamento) do seu jeito.

## Funcionalidades

- **Upload de EPUBs** — arraste ou selecione arquivos `.epub` para adicionar à sua biblioteca
- **Biblioteca** — grade com capa, título e autor dos livros adicionados; remover livro com confirmação
- **Editar e exportar** — título, autor e capa editados no próprio arquivo; exportar o EPUB (no celular, pelo menu de compartilhar, onde fica o Send to Kindle)
- **Leitura paginada** — navegação por capítulos, sumário (TOC); vira a página com as setas na tela, as setas do teclado ou, no celular, deslizando o dedo
- **Busca dentro do livro** — encontra qualquer trecho de texto no livro inteiro, com o capítulo de origem e navegação direta ao clicar
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

O site é instalável (PWA): no Chrome do computador ou do Android, pelo ícone de instalar na barra de endereço ou em "Instalar app" no menu; no iPhone, pelo menu Compartilhar → "Adicionar à Tela de Início". Abre em janela própria, sem a barra do navegador. Ainda precisa de internet para abrir (não há modo offline).

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
- [x] Instalável como app (PWA, sem modo offline)
- [x] Editar título, autor e capa; exportar o EPUB

### Fase 4 — Em definição

- [ ] **Formatação padrão automática, limpa para o Kindle** — prioridade atual. Objetivo: o EPUB exportado chegar ao Kindle sem os estilos do editor que brigam com os ajustes do aparelho (fonte, tamanho, margens, cores). Decidido: o arquivo guardado na biblioteca fica intacto; a limpeza é aplicada ao exportar (é o arquivo que o Kindle recebe) e, com as mesmas regras, na leitura dentro do app — assim o padrão pode mudar depois sem perder nada, bastando exportar de novo. A limpeza filtra o CSS propriedade por propriedade (como o "filtrar informações de estilo" do Calibre), em vez de apagar as folhas de estilo: muitos EPUBs marcam itálico e negrito por classe, e apagar tudo sumiria com eles. Referências: as [diretrizes de texto da Amazon para livros reflowable](https://kdp.amazon.com/en_US/help/topic/GH4DRT75GWWAGBTU) (corpo sem tamanho, entrelinha, cor ou fundo impostos; margens laterais 0; recuo ou espaço entre parágrafos; alinhamento explícito nos títulos; nada em px/pt) e o plugin [Modify ePub](https://github.com/kiwidude68/calibre_plugins/wiki/Modify-ePub) do Calibre (remover fontes embutidas, margens de @page, templates .xpgt da Adobe, JavaScript). As regras finais saem de um levantamento do acervo de EPUBs da usuária.
- [ ] **Grifos e anotações, como no Kindle** — adiado para definir melhor. Ideia: grifar trechos, anotar um grifo, listar os grifos por livro (painel ao lado de Sumário/Buscar, em ordem de leitura, levando ao trecho). A definir: marcadores de página, exportar anotações (Markdown), uma tela com as anotações de todos os livros, compartilhar trecho, quantas cores de grifo. Notas técnicas: o epub.js já informa a seleção (evento `selected`, com a posição em CFI) e desenha grifos (`rendition.annotations.highlight`), que acompanham mudanças de fonte e largura; as posições não mudam com a edição de título/capa. O ponto difícil é o celular: a camada transparente sobre o livro que recebe toques e deslizes para virar a página impede selecionar texto — vai precisar de um toque longo que seleciona (como no Kindle) ou de um modo de seleção, e o comportamento no iPhone só a usuária consegue confirmar. Guardar em uma tabela nova do IndexedDB (migração do Dexie), apagada junto com o livro.

#### Onde paramos

Formatação para o Kindle — decidido o caminho (acima) e levantadas as referências; nada implementado ainda.

1. **Aguardando o acervo de EPUBs da usuária** para um levantamento (só leitura, sem alterar os arquivos) do CSS que os livros usam: fontes embutidas, tamanhos e entrelinha, justificação, recuos, espaço entre parágrafos, itálico/negrito marcados por classe, imagens, notas de rodapé, poesia.
2. **Decisões em aberto**, para depois do levantamento:
   - parágrafo com recuo na primeira linha e sem espaço entre eles (como livro impresso) ou sem recuo e com espaço;
   - se a leitura dentro do app segue o mesmo padrão ou mantém os ajustes atuais (fonte, entrelinha etc.) por cima dele.
3. **Rascunho das regras**: remover fontes embutidas e `font-family`, tamanho e entrelinha do texto corrido, cores e fundos, margens laterais e de `@page`, templates `.xpgt` da Adobe, medidas em px/pt e JavaScript; manter itálico, negrito, versalete, sublinhado, sobrescrito, alinhamento de títulos e blocos, recuos de poesia e citação (convertidos para %/em), quebras de página e tamanho de imagens (em %); acrescentar um CSS mínimo do app (parágrafo padrão, títulos com alinhamento explícito, capítulo em página nova, imagens sem passar da tela).
4. **Para testar**: o Kindle Previewer (gratuito, da Amazon) mostra como o livro fica no Kindle — instalar só com permissão da usuária, confirmando antes o tamanho do download. A prova final é enviar pelo Send to Kindle.

Também pendente, da edição de título/autor/capa: testar com os EPUBs da usuária e enviar um livro editado pelo Send to Kindle, para confirmar que título, autor e capa chegam certos no aparelho.
