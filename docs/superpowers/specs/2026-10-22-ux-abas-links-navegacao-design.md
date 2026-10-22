# Abas da biblioteca, links do livro, ponto de retorno e navegação no computador — design

**Data:** 2026-10-22 · **Status:** desenho aprovado na conversa. Base: branch `develop`.

## Objetivo

Quatro incômodos de uso:

- **Abas da biblioteca:** "Todos / No aparelho" põe o filtro menos útil primeiro e, no celular, o seletor fica estreito (`max-w-xs`).
- **Cor dos links:** no tema Escuro os links do livro ficam azul-escuros, quase invisíveis.
- **Sem volta depois de um link:** seguir uma nota de rodapé (ou um item do sumário, ou um resultado de busca) leva à página certa, mas não há como voltar para onde se estava lendo.
- **Navegação no computador:** só os botões laterais e o teclado viram página. A roda do mouse e o trackpad não fazem nada.

## Decisões tomadas com o usuário (não reabrir)

- **Abas:** "Baixados | Todos", nessa ordem, "Baixados" como padrão, largura toda no celular.
- **Cor dos links:** opção B do companion visual, um azul que acompanha o tema: escuro nas paletas claras, claro no tema Escuro.
- **O que cria ponto de retorno:** todo salto (link interno, sumário, busca, anotação, Home/End). Virar página não cria.
- **Saltos seguidos:** um ponto só, a página de antes do primeiro salto. Saltos seguintes não o sobrescrevem. Descartados: pilha de saltos e "último salto".
- **Onde fica o botão:** opção B, dentro das barras do leitor (centro da barra de baixo no celular, cabeçalho no computador), com ✕. Descartado: pílula flutuante sobre o texto.
- **Virar página não tira o botão**, porque uma nota pode ter várias páginas. Ele some ao voltar, ao chegar na origem por outro caminho, no ✕ ou ao fechar o livro.
- **Voltar do sistema** (Android, Alt+← no navegador) leva à origem quando há ponto de retorno. Sem ele, vai para a biblioteca, como hoje.
- **Posição salva enquanto o botão existe:** sempre a origem, até voltar ou tocar no ✕. Descartados: "origem até ler umas 5 páginas no destino" e "sempre a atual".
- **Computador:** roda e trackpad viram página; Home/End; lista de atalhos na tecla `?`. Descartado: clique nas laterais do texto (atrapalha seleção e duplo clique e não funciona no Safari).
- **Abordagem:** as regras do ponto de retorno e o detector da roda ficam em módulos puros, com testes no Vitest. O `Reader.tsx` (1.874 linhas) só liga os eventos a eles. O app trata o clique nos links, em vez do epub.js.

## 1. Abas da biblioteca (`src/pages/Library.tsx`)

- `Shelf` passa a ser `"baixados" | "todos"`, renderizados nessa ordem: "Baixados", depois "Todos".
- O padrão é `"baixados"`. A escolha continua lembrada na sessão (`sessionStorage`, chave `mybooks:estante`). Um valor antigo `"aparelho"` é lido como `"baixados"`. Sem valor salvo, cai no padrão.
- As abas continuam aparecendo só quando há algum livro só na nuvem (`someInCloud`).
- **Regra da grade vazia:** sem escolha salva na sessão e sem nenhum livro baixado (`books.every((b) => !hasFile(b))`) e sem importação em andamento, a aba efetiva é "Todos". Assim, um aparelho recém-conectado não abre numa grade vazia. A regra vale só enquanto não há escolha salva: escolher "Baixados" explicitamente e ficar sem livros baixados mostra "Nenhum livro baixado neste aparelho.", como hoje. Para distinguir os dois casos, `readShelf` passa a devolver `null` quando não há valor salvo. A decisão sai de uma função pura (`effectiveShelf(saved: Shelf | null, books, importing)`), testada.
- **Largura:** `w-full` no celular, `sm:max-w-xs` do tablet para cima. Os dois botões continuam `flex-1`.

## 2. Links do livro

### Cor (`src/lib/theme-colors.ts`)

`linkColor(theme): string` devolve um hex `#rrggbb`. É lógica pura, testada.

- Matiz azul fixo (OKLCH, h ≈ 255). Parte da luminosidade OKLab da cor do texto e caminha em direção ao meio (L de 0,45 a 0,75), parando no último ponto que ainda passa do alvo de contraste contra o fundo. Usa o maior croma dentro do gamut sRGB, limitado a 0,14.
- Alvo de contraste WCAG contra o fundo: `min(7, contraste(texto, fundo))`, com piso de 4,5. Se nem 4,5 for possível, devolve a cor do texto.
- Referência da pesquisa, com alvo 7:1: Claro `#1358a5`, Escuro `#66a8fc`, Sépia `#024c97`, Rosa `#08519e`, Lavanda `#07519d`, Menta `#0b53a0`. Os testes conferem o contraste, não os hex exatos.
- Cálculo em TypeScript, não `color-mix()` dentro do iframe: o contraste fica garantido e não depende do suporte do navegador.

### Regras de CSS no livro

As regras de link vão numa `<style>` própria do app (`id="mybooks-links"`) em cada seção renderizada. Ela é criada no hook de conteúdo (`Reader.tsx:932`) e reescrita em todas as seções abertas (`rendition.getContents()`) quando o tema muda. O texto é atribuído com `textContent`, então uma regra que o navegador não entende é ignorada sem erro. Com `rendition.themes.default()`, o `insertRule` lança `SyntaxError`, e isso interromperia o `applyTheme` antes de `fontSize` e `spread`. O `themes.default()` atual não muda.

```css
a[href] { color: <linkColor> !important; }
a[href] {
  text-decoration-line: underline !important;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.15em;
  text-decoration-color: <linkColor a ~60% sobre o fundo>;
}
/* números de nota e links em imagem: mesma cor, sem sublinhado */
a[epub\:type~="noteref"], a[*|type~="noteref"], a[role~="doc-noteref"],
sup > a[href] { text-decoration-line: none !important; }
a[href]:has(> sup:only-child), a[href]:has(img, svg) { text-decoration-line: none !important; }
```

- As duas formas do seletor de `epub:type` são necessárias: o epub.js lê o capítulo como HTML (`srcdoc`), e cada modo de leitura só casa uma delas.
- `:has()` fica numa regra separada, para que um navegador sem suporte perca só essa regra.
- Sem estado visitado: os links internos nunca navegam o iframe, então `:visited` não se aplica.

### Clique

Hoje o epub.js põe um `onclick` em cada link interno (`replaceLinks`), que dispara `linkClicked` e um `display()` sem o `settleAt`. No WebKit, o iframe sandbox não roda esse handler. Passa a valer:

- **`followLink(href)`** no Reader: resolve o href para o formato da spine (`book.path.relative`, e depois `resolveTocHref` se for preciso) e chama `navigateTo(alvo, { checkpoint: true })`.
- **Toque** (`forwardTapToLink`, `Reader.tsx:665-685`): em vez de `link.click()`, lê o `href` do link sob o dedo e chama `followLink`. Isso funciona no Chromium e no WebKit, porque a superfície de gestos fica no documento do app.
- **Mouse/desktop:** no hook de conteúdo, cada `a[href]` interno recebe um `onclick` do app que retorna `false` e chama `followLink`. Ele substitui o do epub.js: o hook do Reader roda depois do `Contents`, que já instalou o dele. É preciso conferir no plano que o `display()` do epub.js não roda também.
- **Links externos** (`http(s)://`, `mailto:`): hoje não abrem. O sandbox sem `allow-popups` bloqueia o `target=_blank`, e no celular o toque é engolido. Passam a abrir pelo app, com `window.open(href, '_blank', 'noopener')`, tanto no toque quanto no clique. Não criam ponto de retorno.
- **Safari no Mac:** sem superfície de gestos e sem scripts no iframe, o clique num link dentro do livro pode continuar sem efeito. Verificar no WebKit do Playwright; se estiver quebrado, fica registrado como limite conhecido.

## 3. Ponto de retorno

### Módulo puro (`src/lib/reader/checkpoint.ts`)

Máquina de estados sem DOM nem epub.js. Recebe eventos e devolve o novo estado mais os efeitos que o Reader executa. Comparar posições é injetado (`contains(location, cfi)`), para o teste não depender do epub.js.

Estado: `idle`, `pending { origin }` ou `active { origin }`. `origin = { cfi, percentage?, chapterLabel? }`.

| Estado | Evento | Novo estado | Efeitos |
|---|---|---|---|
| `idle` | `jump(origin)` | `pending` | — |
| `pending`/`active` | `jump(...)` | igual | nenhum (a origem fica) |
| `pending` | `relocated(loc)` com a origem na tela | `pending` | nenhum (pode ser um refit da página de origem antes do salto) |
| `pending` | `relocated(loc)` sem a origem | `active` | `pushGuard` |
| `pending` | `jumpSettled` com a origem na tela | `idle` | descarta (salto para a mesma página) |
| `pending` | `jumpSettled` sem a origem | `active` | `pushGuard` |
| `pending` | `jumpFailed` | `idle` | — |
| `active` | `relocated(loc)` com a origem na tela | `idle` | `popGuard` (chegou na origem virando página ou pelo link ↩) |
| `active` | `back` (botão Voltar) | `idle` | `popGuard`, `goTo(origin)` |
| `active` | `systemBack` (o guard saiu do histórico) | `idle` | `goTo(origin)` |
| `active` | `dismiss` (✕) | `idle` | `popGuard`, `saveCurrent` |
| qualquer | `close` | `idle` | — |
| `active` | `percentageReady(p)` | `active` com `origin.percentage = p` | — |

- `goTo(origin)` chama `navigateTo(origin.cfi)` **sem** criar ponto. O `relocated` desse salto encontra o estado já em `idle`.
- `popGuard` marca o próximo `popstate` como iniciado pelo app (`navigate(-1)` com uma flag), para que ele não seja lido como `systemBack`.
- Testes no Vitest para cada linha da tabela, mais: salto em cadeia mantendo a origem, `relocated` intermediário de um salto na mesma seção, `state` antigo no histórico ao abrir o leitor sendo ignorado.

### Ligação no Reader

- **Criar:** `navigateTo(alvo, { checkpoint: true })` (`Reader.tsx:1381`) é o funil de sumário, busca, anotações, links e Home/End. Antes do `display`, ele lê a origem:
  - `positionRef.current.cfi`, se continuar na tela (`locationContains`);
  - senão, o `start.cfi` de `currentLocationOf(rendition)`, calculado na hora (o `rendition.location` atrasa por causa do debounce).

  O resettle (`settleAt`, `createResettler`) chama `rendition.display` direto e não cria ponto.
- **Porcentagem da origem:** `percentageForCfi` (`Reader.tsx:1013`) vai para um ref, como `persistCurrentLocationRef`. Se ainda der `undefined`, o `locationsReady.then` (`Reader.tsx:1103`) dispara `percentageReady`. O capítulo vem de `chapterLabelForCfi`.
- **Fechar:** o cleanup do efeito de abertura dispara `close`.

### Posição salva enquanto o ponto existe

Hoje `positionRef` (`Reader.tsx:725`) faz dois papéis: é a posição gravada no banco e é a âncora do resettle. Os dois se separam no `persist` (`Reader.tsx:1019`), por onde passam todas as gravações: virar página, o `persist` depois do `navigateTo`, o recálculo em `locationsReady` e o flush de `visibilitychange`/`pagehide`/cleanup.

- `positionRef` continua sendo a âncora da tela: girar o aparelho ou mudar a fonte durante a nota reposiciona na nota.
- Com o ponto em `pending` ou `active`, o registro gravado é `{ cfi: origin.cfi, percentage: origin.percentage ?? última conhecida, lastReadAt: agora }`. Fechar o app, voltar à biblioteca ou o sistema matar o app durante a nota reabre o livro na origem, e é a origem que vai para o Drive.
- No ✕ (`saveCurrent`), grava na hora a posição atual da tela, que passa a ser a posição normal.
- Ao voltar ou chegar na origem, as gravações seguem o fluxo normal.

### Histórico (Voltar do sistema)

- `pushGuard`: `navigate(location.pathname, { state: { checkpointGuard: true } })`. A URL é a mesma, então o Reader não remonta (o efeito depende só de `bookId`). Usar o React Router, não `history.pushState` cru: o data router guarda `{ usr, key, idx }` no `history.state`.
- `systemBack`: um efeito observa `useLocation()`. Se o `state.checkpointGuard` sumir sem a flag de `popGuard`, dispara `systemBack`.
- Uma entrada com `state.checkpointGuard` sem ponto ativo (reload sobre ela, ou Avançar do navegador) é ignorada e descartada com `navigate(-1)` (marcado como iniciado pelo app). Com `replace`, sobraria uma entrada repetida do leitor, e o Voltar do Android precisaria de dois toques.
- `jumpSettled` é disparado pelo `navigateTo` depois do `settleAt`. Ele existe porque um `relocated` da própria página de origem (refit de fontes) pode chegar antes do salto e não pode descartar o ponto.
- **Seta ← do cabeçalho** (`Reader.tsx:1637`) e o botão da tela de falha (`Reader.tsx:1743`): hoje fazem `navigate('/')`, que empilha uma entrada. O histórico fica `[/, /read/x, /]`, e o Voltar do Android na biblioteca reabre o livro. Passam a voltar no histórico até a entrada anterior ao leitor, contando o guard se ele existir (`navigate(-1)` ou `navigate(-2)`). Se o leitor foi a primeira entrada (link direto ou reload no app instalado), fazem `navigate('/', { replace: true })`. A seta sempre vai para a biblioteca, mesmo com o ponto ativo.
- iPhone instalado: não há Voltar do sistema, só o botão.

### Visual

- **Celular** (barra de baixo, `Reader.tsx:1805`): com o ponto `active`, a grade passa de `grid-cols-3` para `grid-cols-[1fr_auto_1fr]`. A coluna do meio mostra a barra de progresso com a marca ▾ e, abaixo, o botão "↩ Voltar · 12%" mais um ✕, cada um com alvo de toque de 44 px de altura. O texto da % atual sai enquanto o botão está ali. Com as barras escondidas, só o botão fica visível, como a % fica hoje.
- **Computador** (cabeçalho): o botão fica antes da %, no grupo da direita. A partir de `lg`, mostra "↩ Voltar para {capítulo} · 12%"; abaixo disso, "↩ Voltar · 12%". O título encolhe primeiro (`truncate`).
- Cor do botão: `linkColor(tema)` sobre `themeTint(tema, 8)`. Fica no padrão do link e aparece em qualquer paleta.
- **Marca na barra:** `ProgressBar` ganha a prop `marker?: number` (0 a 100), desenhada fora da `div` com `overflow-hidden` para não ser cortada, na cor do link. Ela aparece nas duas barras (a linha do cabeçalho e a barra de 64 px), só quando `origin.percentage` é conhecida.
- `aria-label`: "Voltar para onde você lia ({capítulo}, 12%)" e "Ficar aqui" no ✕.

## 4. Navegação no computador

### Roda e trackpad (`src/lib/reader/wheel-paging.ts`)

`createWheelPager({ threshold = 50, idleMs = 200, lineHeight = 40 })` devolve `{ feed(e): 'next' | 'prev' | null, reset() }`. É puro e recebe `{ deltaX, deltaY, deltaMode, timeStamp }`.

1. Lê `deltaMode` antes dos deltas e converte para pixels: linha × `lineHeight`, página × 800.
2. Fica com o eixo dominante. Se |d| < 1, devolve `null`. d > 0 é próxima: rolar para baixo, ou dedos para a esquerda no trackpad.
3. **Gesto novo** quando passaram mais de `idleMs` desde o último evento, quando a direção inverte, ou quando, depois de 3 ou mais eventos desacelerando, chega um |d| maior que 1,5 × o anterior (um novo flick no meio da inércia). Nesse caso a soma volta a zero e o gesto ainda não disparou.
4. Se este gesto já disparou, devolve `null`: é a cauda da inércia.
5. Soma |d|. Com `deltaMode ≠ 0` ou soma ≥ `threshold`, marca o disparo e devolve a direção.

Testes: dente único, rajada de dentes, flick com cauda, dois flicks seguidos, inversão, Firefox com `deltaMode` de linha.

**Ligação no Reader:** um handler estável (como `keyActions`) e um detector num `useRef` do componente, compartilhado pelas seções: trocar de capítulo cria um iframe novo no meio do gesto. Ele é registrado com `{ passive: false }` em dois lugares, `contents.document` no hook de conteúdo e `bookRowRef` (margens, botões laterais, superfície de gestos). O `onWheel` do React não serve, porque é passivo. O handler:

- Com Ctrl: `reset()` e sai sem `preventDefault` (zoom e pinça ficam com o navegador). Com Meta ou Alt: sai.
- Sem `canPageRef`: sai.
- Se o alvo tem rolagem própria no eixo (`<pre>` ou tabela com `overflow: auto`), sai sem `preventDefault` e suprime o gesto.
- `preventDefault` quando `cancelable`. Isso também evita que o deslize de dois dedos para o lado vire o "voltar" do Chrome no Mac, junto com `overscroll-behavior-x: none` no `<html>` do app.
- Se `feed` devolve uma direção e não há virada em andamento, marca a virada como em andamento, registra `nextRelocation` e chama `rendition.next()` ou `prev()`, liberando no `relocated` ou no timeout de 1 s do `nextRelocation` (`Reader.tsx:244`). O timeout cobre o fim e o início do livro, onde a virada não gera `relocated`. Uma virada pedida durante outra é descartada, não enfileirada: a fila do epub.js empilharia páginas.

`threshold` e `idleMs` são constantes nomeadas, para calibrar no mouse e no trackpad do usuário.

### Teclado (`handleReaderKeydown`, `Reader.tsx:451`)

- ↓ e ↑ viram página, junto com → ← PageDown PageUp.
- **Home:** início do capítulo atual, com `navigateTo(section.href, { checkpoint: true })`.
- **End:** última página do capítulo atual: `navigateTo` para o CFI do último nó de texto da seção já renderizada (`contents.cfiFromNode`), com ponto de retorno. Se já estiver na primeira ou na última página, o ponto é descartado pela regra do "mesma página".
- **`?`** abre a lista de atalhos.
- Alt+← é do navegador e chega como `popstate`, que o ponto de retorno trata.

### Lista de atalhos

- Um `Dialog` (shadcn) com os atalhos: → ↓ PageDown espaço (avançar), ← ↑ PageUp Shift+espaço (voltar), roda/trackpad, Home/End, `/` (buscar), F (tela cheia), Alt+← (voltar ao ponto de retorno) e `?`.
- O diálogo segue o tema ativo, como os outros painéis que renderizam via portal.
- Abre pela tecla `?` e por um item "Atalhos do teclado" no painel de ajustes (`ReaderSettings.tsx`), que só aparece com `(pointer: fine)` (`use-media-query`).

## 5. Base de teste (`scripts/generate-test-epub.mjs`)

Primeira tarefa do plano: a cor e o ponto de retorno dependem dela. Hoje os capítulos do fixture não têm nenhum `<a>` nem `.css`. Acrescentar:

- um link de texto para outro capítulo;
- uma nota EPUB3 `<a epub:type="noteref" href="notas.xhtml#n1"><sup>1</sup></a>`, com destino num capítulo de notas e um link ↩ de volta;
- uma nota antiga `<sup><a href="…">2</a></sup>`;
- um link envolvendo uma `<img>`;
- um link externo `https://`;
- um `.css` com `a { color: #00c; text-decoration: none }`, para provar que o tema vence o livro (o saneamento tira o `color` na importação, mas o `text-decoration` fica);
- uma nota longa, de mais de uma página, para o caso de virar página dentro da nota.

A geração continua determinística. O `scripts/validate-epub.mjs` ganha uma checagem a mais: todo link interno dos capítulos aponta para um arquivo do manifest e, se tiver `#âncora`, para um id que existe no destino. Hoje ele confere só as âncoras do sumário.

## 6. Testes e verificação

- **Vitest (lógica pura):** `checkpoint.ts` (tabela inteira), `wheel-paging.ts`, `linkColor` (contraste ≥ alvo em todos os presets e em temas personalizados difíceis: preto/branco, azul-noite, cinza sobre cinza escuro, texto marrom) e `effectiveShelf`.
- **No navegador, com o fixture novo:**
  - Chromium desktop: clique em link, nota e ↩, Voltar, ✕, Alt+←, roda e trackpad emulados, Home/End, `?`.
  - Chromium com toque emulado: toque em link e em nota, barra de baixo com e sem as barras escondidas.
  - WebKit (Playwright): toque em link; clique em link e roda sobre o texto no desktop, para documentar o limite.
  - Cor dos links nas 6 paletas e numa personalizada.
  - Abas a 375 px e no desktop, incluindo a regra da grade vazia.
  - Posição salva: fechar o leitor com o ponto ativo e reabrir na origem; ✕ seguido de reabrir na nota.
- **No Android do usuário:** Voltar do sistema com o ponto ativo, toque nas notas e roda/trackpad no PC dele.
- **CHANGELOG:** entrada com as decisões (ponto único, origem salva, `<style>` própria, link externo pelo app) e os limites conhecidos.

## Limites conhecidos

- **Safari no Mac:** a roda e o clique em link sobre o texto podem não chegar ao app, porque o iframe do livro não roda scripts no WebKit. Funcionam as margens, os botões e o teclado fora do livro.
- O ponto de retorno vive só na sessão do leitor. Fechar o livro o descarta, e a posição salva já é a origem.
- Os limiares da roda dependem do aparelho. Mouses com roda livre (Logitech) geram rajadas longas e viram uma página por rajada.

## Fora do escopo

- Pilha de saltos e "avançar" depois de voltar.
- Clique nas laterais do texto no desktop.
- Cor de link escolhida à mão por paleta (campo `linkColor` no `Theme`).
- Notas de rodapé em popup.
- Sincronizar o ponto de retorno entre aparelhos.
