import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import BookCard from "@/components/library/BookCard";
import BookCover from "@/components/library/BookCover";
import DriveButton from "@/components/library/DriveButton";
import EditBookDialog from "@/components/library/EditBookDialog";
import PendingBookCard from "@/components/library/PendingBookCard";
import SyncButton from "@/components/library/SyncButton";
import SyncStrip from "@/components/library/SyncStrip";
import { listBooks, removeBook, removeLocalFile } from "@/lib/db/books";
import { listProgress } from "@/lib/db/progress";
import { effectiveShelf, parseShelf, type Shelf } from "@/lib/shelf";
import { hasFile, type Book, type BookWithFile, type Progress, type Theme } from "@/lib/db/schema";
import { themeTint } from "@/lib/theme-colors";
import { cn } from "@/lib/utils";
import { useDownloadStore } from "@/store/download-store";
import { useDriveStore } from "@/store/drive-store";
import { useImportStore } from "@/store/import-store";
import { useSyncStore } from "@/store/sync-store";
import { useThemeStore } from "@/store/theme-store";
import ProgressBar from "@/components/ProgressBar";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

// A book being read, as a card at the top of the library. The whole card is
// the button — stretched over it, since a <button> can't hold the heading
// and paragraphs inside. "small" is the second book beside the main one.
function ReadingCard({
  heading,
  book,
  percentage,
  cover,
  small = false,
  theme,
  onOpen,
  className,
}: {
  heading: string;
  book: Book;
  percentage: number;
  cover: ReactNode;
  small?: boolean;
  theme: Theme;
  onOpen: () => void;
  className?: string;
}) {
  const headingId = `${small ? "tambem" : "continuar"}-lendo`;
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "group relative flex items-center gap-4 rounded-2xl p-4",
        !small && "sm:gap-6 sm:p-5",
        className,
      )}
      style={{ background: themeTint(theme, 5) }}
    >
      <button
        type="button"
        aria-label={`${heading}: ${book.title}`}
        onClick={onOpen}
        className="absolute inset-0 z-10 cursor-pointer rounded-2xl outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <div
        className={cn("aspect-2/3 shrink-0", small ? "w-16" : "w-20 sm:w-28")}
      >
        {cover}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <h2
          id={headingId}
          className="text-xs font-medium text-muted-foreground"
        >
          {heading}
        </h2>
        <p
          className={cn(
            "mt-1 line-clamp-2 font-semibold",
            small ? "text-sm" : "text-base sm:text-lg",
          )}
        >
          {book.title}
        </p>
        <p
          className={cn(
            "truncate text-muted-foreground",
            small ? "text-xs" : "text-sm",
          )}
        >
          {book.author}
        </p>
        <div className={cn("flex items-center gap-3", small ? "mt-2" : "mt-3")}>
          <ProgressBar
            theme={theme}
            percentage={percentage}
            className="h-1 min-w-40 max-w-xs flex-1 rounded-full"
          />
          <span className="shrink-0 text-xs text-muted-foreground">
            {percentage}% lido
          </span>
        </div>
      </div>
    </section>
  );
}

// The policy is a static page of its own, not a route of the app: a tab of its
// own, so the installed app isn't left behind.
function PrivacyLink({ children }: { children: ReactNode }) {
  return (
    <a
      href="/privacy"
      target="_blank"
      rel="noopener noreferrer"
      className="cursor-pointer underline underline-offset-2"
    >
      {children}
    </a>
  );
}

// What the app is and what it does with the Google account, for whoever opens
// it for the first time (Google's review of the sign-in screen reads the home
// page too). Only shown while the library is empty.
function AboutSection() {
  return (
    <section
      aria-labelledby="sobre"
      className="mx-auto mt-10 max-w-xl space-y-3 text-center text-sm text-muted-foreground"
    >
      <h2 id="sobre" className="text-base font-medium text-foreground">
        Sobre o E-books
      </h2>
      <p>
        O E-books é um leitor de EPUB pessoal: importe seus livros, leia com as
        cores, a fonte e o espaçamento que preferir, grife trechos e escreva
        anotações. Seus livros, seu progresso e seus grifos ficam guardados no
        seu navegador.
      </p>
      <p>
        Se quiser, conecte sua conta Google: o E-books usa o Google Drive, só
        com acesso aos arquivos que ele mesmo cria, para guardar seus livros,
        progresso e grifos e levar a leitura de um aparelho para o outro.
      </p>
      <p lang="en">
        E-books is a personal EPUB reader. Optionally, you can connect your
        Google account: E-books then uses Google Drive, restricted to the files
        it creates itself, to keep your books, reading progress and highlights
        and carry your reading from one device to another.
      </p>
      <p>
        <PrivacyLink>Política de privacidade · Privacy policy</PrivacyLink>
      </p>
    </section>
  );
}

// Same id for every result: a repeated announcement replaces the toast
// instead of stacking a second one.
function showDriveResult(result: string) {
  const options = { id: "drive-result" };
  if (result === "conectado") toast.success("Google Drive conectado", options);
  else if (result === "cancelado") toast("Conexão com o Google Drive cancelada", options);
  else if (result === "sem-permissao")
    toast.error("O Google Drive não foi liberado", {
      ...options,
      description: "Ao conectar, deixe marcada a permissão do Google Drive.",
    });
  else toast.error("Não foi possível conectar ao Google Drive", options);
}

// Kept for the session, so coming back from the reader (which navigates to
// "/") doesn't reset it.
const SHELF_KEY = "mybooks:estante";

function readShelf(): Shelf | null {
  try {
    return parseShelf(sessionStorage.getItem(SHELF_KEY));
  } catch {
    return null;
  }
}

export default function Library() {
  const [books, setBooks] = useState<Book[]>([]);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [bookToRemove, setBookToRemove] = useState<Book | null>(null);
  // A new session per opening remounts the dialog (see EditBookDialog).
  const [editing, setEditing] = useState<{ book: BookWithFile; session: number } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [savedShelf, setSavedShelf] = useState<Shelf | null>(readShelf);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const driveResult = searchParams.get("drive");
  const activeTheme = useThemeStore((s) => s.activeTheme);

  // Same reasoning as Reader.tsx: text-foreground/text-muted-foreground/
  // hover:bg-muted read CSS variables, so overriding them here makes the
  // library follow the same theme as the reader instead of always showing
  // the app's default light look. --primary/--primary-foreground cover the
  // "Adicionar EPUB" button — there's no separate accent color in Theme yet,
  // so it uses the theme's colors inverted (text color as fill, background
  // as its label) instead of the app's default black/white button. --border:
  // the app's fixed light gray read as a bright line on dark palettes.
  const themeVars = {
    background: activeTheme.background,
    color: activeTheme.textColor,
    "--foreground": activeTheme.textColor,
    "--muted-foreground": activeTheme.textColor,
    "--muted": `${activeTheme.textColor}1a`,
    "--primary": activeTheme.textColor,
    "--primary-foreground": activeTheme.background,
    "--border": themeTint(activeTheme, 15),
    // The book menu and the import notifications (Toaster, rendered in place).
    "--popover": themeTint(activeTheme, 5),
    "--popover-foreground": activeTheme.textColor,
  } as CSSProperties;
  // The book menu and the dialogs render through portals, outside the themed
  // subtree, so they get the palette again. --input and --ring: the edit
  // fields' border and focus ring, the app's fixed light grays otherwise — a
  // bright outline on a dark palette.
  const portalVars = {
    ...themeVars,
    background: undefined,
    "--background": activeTheme.background,
    "--accent": `${activeTheme.textColor}1a`,
    "--accent-foreground": activeTheme.textColor,
    "--input": themeTint(activeTheme, 20),
    "--ring": themeTint(activeTheme, 65),
  } as CSSProperties;

  // Read again whenever a sync brought something from another device, and
  // whenever an import or a download finished (either may end while the
  // reader is open).
  const syncRevision = useSyncStore((s) => s.revision);
  const importItems = useImportStore((s) => s.items);
  const importRevision = useImportStore((s) => s.revision);
  const addFiles = useImportStore((s) => s.add);
  const dismissImport = useImportStore((s) => s.dismiss);
  const downloading = useDownloadStore((s) => s.downloading);
  const downloadRevision = useDownloadStore((s) => s.revision);
  const download = useDownloadStore((s) => s.download);
  const driveConnected = useDriveStore((s) => s.status === "conectado");
  useEffect(() => {
    listBooks().then(setBooks);
    listProgress().then(setProgress);
  }, [syncRevision, importRevision, downloadRevision]);

  // Every visit to the library syncs: opening the app, and coming back from a
  // book, whose new position then goes up.
  useEffect(() => {
    void useDriveStore
      .getState()
      .check()
      .then(() => useSyncStore.getState().run());
  }, []);

  // Google's login comes back here as ?drive=<result> (server/auth/routes.ts).
  // Announced from this effect, which runs after the Toaster below has
  // mounted, and then taken off the address.
  useEffect(() => {
    if (!driveResult) return;
    showDriveResult(driveResult);
    setSearchParams(
      (params) => {
        params.delete("drive");
        return params;
      },
      { replace: true },
    );
  }, [driveResult, setSearchParams]);

  const progressByBook = useMemo(
    () => new Map(progress.map((p) => [p.bookId, p])),
    [progress],
  );

  // Most recent activity first: when the book was last read, or when it was
  // added if it hasn't been opened yet — so a book just imported still shows
  // up near the top instead of below everything ever read.
  const sortedBooks = useMemo(
    () =>
      [...books].sort((a, b) => {
        const activity = (book: Book) =>
          progressByBook.get(book.id)?.lastReadAt ?? book.addedAt;
        return activity(b) - activity(a);
      }),
    [books, progressByBook],
  );

  // "Continuar lendo" goes to the most recent book started but not finished;
  // the next one sits beside it on desktop, so the space it would otherwise
  // leave empty is used. A book only opened (still at 0%) or already finished
  // doesn't count — otherwise glancing at a new book's cover pushed the one
  // actually being read down into the small card. With none in progress, the
  // last one opened still gets the main card.
  const [lastRead, alsoReading] = useMemo(() => {
    const withProgress = (book: Book) => ({
      book,
      percentage: progressByBook.get(book.id)!.percentage,
    });
    const opened = sortedBooks.filter((b) => progressByBook.get(b.id)?.cfi);
    const inProgress = opened.filter((b) => {
      const { percentage } = progressByBook.get(b.id)!;
      return percentage > 0 && percentage < 100;
    });
    const main = inProgress[0] ?? opened[0];
    const second = inProgress.find((b) => b !== main);
    return [main && withProgress(main), second && withProgress(second)];
  }, [sortedBooks, progressByBook]);

  // The tabs only show while some book is only on Drive; without them, every
  // book is here anyway.
  const someInCloud = books.some((book) => !hasFile(book));
  const shelf = effectiveShelf(savedShelf, books.some(hasFile), importItems.length > 0);
  const showingAvailable = someInCloud && shelf === "disponiveis";
  const visibleBooks: Book[] = !someInCloud
    ? sortedBooks
    : sortedBooks.filter((book) => hasFile(book) !== showingAvailable);
  // A book being imported is already on this device.
  const visibleImports = showingAvailable ? [] : importItems;

  function chooseShelf(next: Shelf) {
    setSavedShelf(next);
    try {
      sessionStorage.setItem(SHELF_KEY, next);
    } catch {
      // Storage blocked (private mode): the tab just isn't remembered.
    }
  }

  function pickFiles() {
    fileInputRef.current?.click();
  }

  async function handleRemove(id: string) {
    await removeBook(id);
    setBooks(await listBooks());
    setProgress(await listProgress());
    void useSyncStore.getState().run();
  }

  // Only the file here goes; the book stays on Drive and comes back with ⤓.
  async function handleRemoveLocal(book: Book) {
    try {
      await removeLocalFile(book.id);
      setBooks(await listBooks());
      toast(`"${book.title}" removido deste aparelho`);
    } catch (error) {
      console.error("Não foi possível remover o livro deste aparelho", error);
      toast.error("Não foi possível remover deste aparelho");
    }
  }

  const openBook = (id: string) => navigate(`/read/${id}`);

  return (
    <div className="flex min-h-screen flex-col" style={themeVars}>
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        <header className="mb-6 flex items-center gap-2 sm:mb-8 sm:gap-3">
          <img
            src="/favicon.svg"
            alt=""
            className="size-8 shrink-0 rounded-lg"
          />
          <h1 className="flex items-center gap-1 min-w-0 flex-1 truncate text-xl font-semibold sm:text-2xl">
            E-books
            {books.length > 0 && (
              <span className="min-w-0 truncate text-sm font-normal text-muted-foreground sm:text-base">
                · {books.length} {books.length === 1 ? "livro" : "livros"}
              </span>
            )}
          </h1>
          <SyncButton />
          <DriveButton portalStyle={portalVars} />
          <Button
            onClick={pickFiles}
            aria-label="Adicionar EPUB"
            className="max-sm:size-11 max-sm:px-0"
          >
            <Plus />
            <span className="max-sm:hidden">Adicionar EPUB</span>
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".epub"
            multiple
            className="hidden"
            onChange={(e) => {
              const input = e.target;
              if (input.files?.length) addFiles(Array.from(input.files));
              // Cleared so picking the same file again (say, re-adding a book
              // just removed) still fires `change` — the browser skips it for
              // an unchanged value.
              input.value = "";
            }}
          />
        </header>

        <SyncStrip theme={activeTheme} />

        {/* On desktop the main card shares its row with the next book in
            progress (3:2), which keeps its own, shorter height and sits on
            the row's baseline; alone, the main card shrinks to its content
            instead of stretching across an empty row. Phones show only it. */}
        {lastRead && (
          <div
            className={cn(
              "mb-10",
              alsoReading &&
                "sm:grid sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] sm:gap-4",
            )}
          >
            <ReadingCard
              heading="Continuar lendo"
              book={lastRead.book}
              percentage={lastRead.percentage}
              cover={<BookCover book={lastRead.book} className="h-full w-full shadow-md" />}
              theme={activeTheme}
              onOpen={() => openBook(lastRead.book.id)}
              className={alsoReading ? undefined : "sm:w-fit sm:max-w-2xl"}
            />
            {alsoReading && (
              <ReadingCard
                small
                heading="Também lendo"
                book={alsoReading.book}
                percentage={alsoReading.percentage}
                cover={<BookCover book={alsoReading.book} className="h-full w-full shadow-sm" />}
                theme={activeTheme}
                onOpen={() => openBook(alsoReading.book.id)}
                className="hidden sm:flex sm:self-end"
              />
            )}
          </div>
        )}

        {books.length === 0 && importItems.length === 0 ? (
          <button
            type="button"
            onClick={pickFiles}
            className="mx-auto mt-12 flex w-full max-w-sm cursor-pointer flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center transition-colors hover:bg-muted"
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-muted">
              <Plus className="size-6" />
            </span>
            <span className="font-medium">Adicionar seu primeiro EPUB</span>
            <span className="text-sm text-muted-foreground">
              Escolha um ou mais arquivos .epub do seu aparelho.
            </span>
          </button>
        ) : (
          <section aria-labelledby="todos-os-livros">
            <h2
              id="todos-os-livros"
              className={cn(
                "mb-3 text-xs font-medium text-muted-foreground",
                someInCloud && "sr-only",
              )}
            >
              Todos os livros
            </h2>
            {/* "Baixados" is what can be read without a connection;
                "Disponíveis", what's on Drive still to download. */}
            {someInCloud && (
              <div
                role="group"
                aria-label="Quais livros mostrar"
                className="mb-4 flex w-full gap-1 rounded-lg bg-muted p-1 text-sm sm:max-w-xs"
              >
                {(
                  [
                    ["baixados", "Baixados"],
                    ["disponiveis", "Disponíveis"],
                  ] as const
                ).map(([value, text]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={shelf === value}
                    onClick={() => chooseShelf(value)}
                    className={cn(
                      "flex-1 cursor-pointer rounded-md px-3 py-1.5 transition-colors",
                      shelf === value
                        ? "font-medium shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    style={
                      shelf === value ? { background: activeTheme.background } : undefined
                    }
                  >
                    {text}
                  </button>
                ))}
              </div>
            )}
            {visibleBooks.length === 0 && visibleImports.length === 0 && (
              <p className="mb-4 text-sm text-muted-foreground">
                {showingAvailable
                  ? "Todos os livros do Google Drive já estão neste aparelho."
                  : "Nenhum livro baixado neste aparelho."}
              </p>
            )}
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 sm:gap-x-6 md:grid-cols-4 lg:grid-cols-5">
              {visibleImports.map((item) => (
                <PendingBookCard
                  key={item.key}
                  item={item}
                  onDismiss={() => dismissImport(item.key)}
                />
              ))}
              {visibleBooks.map((book) => (
                <BookCard
                  key={book.id}
                  book={book}
                  percentage={progressByBook.get(book.id)?.percentage ?? 0}
                  theme={activeTheme}
                  portalStyle={portalVars}
                  downloading={downloading.includes(book.id)}
                  driveConnected={driveConnected}
                  onOpen={() => openBook(book.id)}
                  onEdit={(file) => {
                    setEditing({ book: file, session: Date.now() });
                    setEditOpen(true);
                  }}
                  onRemove={setBookToRemove}
                  onDownload={() => void download(book)}
                  onRemoveLocal={() => void handleRemoveLocal(book)}
                />
              ))}
              {!showingAvailable && (
                <button
                  type="button"
                  onClick={pickFiles}
                  className="flex aspect-2/3 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground transition-colors hover:bg-muted"
                >
                  <Plus className="size-5" />
                  Adicionar
                </button>
              )}
            </div>
          </section>
        )}
        {books.length === 0 && importItems.length === 0 && <AboutSection />}
      </div>

      <AlertDialog
        open={bookToRemove !== null}
        onOpenChange={(open) => {
          if (!open) setBookToRemove(null);
        }}
      >
        <AlertDialogContent style={portalVars}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remover "{bookToRemove?.title}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bookToRemove?.driveFileId
                ? "O livro, o progresso e os grifos saem deste aparelho e dos outros conectados ao seu Google Drive. Essa ação não pode ser desfeita."
                : "O arquivo e o progresso de leitura salvo serão removidos permanentemente. Essa ação não pode ser desfeita."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => bookToRemove && handleRemove(bookToRemove.id)}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {editing && (
        <EditBookDialog
          key={editing.session}
          book={editing.book}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={async () => {
            setBooks(await listBooks());
            void useSyncStore.getState().run();
          }}
          style={portalVars}
        />
      )}

      <footer className="border-t px-6 py-4 text-center text-xs text-muted-foreground">
        <p className="flex items-center justify-center gap-1.5">
          <Lock className="size-3.5 shrink-0" />
          Seus livros e seu progresso de leitura ficam guardados no seu
          navegador; o Google Drive é opcional.
        </p>
        <p className="mt-1">
          E-books · <PrivacyLink>Política de privacidade</PrivacyLink>
        </p>
      </footer>
      <Toaster />
    </div>
  );
}
