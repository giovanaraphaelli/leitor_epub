import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { v4 as uuid } from "uuid";
import { Download, EllipsisVertical, Lock, Pencil, Plus, Trash2 } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import CoverImage from "@/components/CoverImage";
import EditBookDialog from "@/components/library/EditBookDialog";
import { listBooks, addBook, removeBook } from "@/lib/db/books";
import { listProgress } from "@/lib/db/progress";
import { exportBook } from "@/lib/epub/export";
import { parseEpubMetadata } from "@/lib/epub/parse";
import type { Book, Progress, Theme } from "@/lib/db/schema";
import { themeTint } from "@/lib/theme-colors";
import { cn } from "@/lib/utils";
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

export default function Library() {
  const [books, setBooks] = useState<Book[]>([]);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [importing, setImporting] = useState(false);
  const [bookToRemove, setBookToRemove] = useState<Book | null>(null);
  // A new session per opening remounts the dialog (see EditBookDialog).
  const [editing, setEditing] = useState<{ book: Book; session: number } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
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

  useEffect(() => {
    listBooks().then(setBooks);
    listProgress().then(setProgress);
  }, []);

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

  function pickFiles() {
    fileInputRef.current?.click();
  }

  async function handleFiles(input: HTMLInputElement) {
    const files = input.files;
    if (!files || files.length === 0) return;
    setImporting(true);
    const failed: string[] = [];

    try {
      // One file that isn't a valid EPUB doesn't stop the others.
      for (const file of Array.from(files)) {
        try {
          const metadata = await parseEpubMetadata(file);
          await addBook({
            id: uuid(),
            title: metadata.title,
            author: metadata.author,
            coverBlob: metadata.coverBlob,
            fileBlob: file,
            addedAt: Date.now(),
          });
        } catch (error) {
          console.error(`Não foi possível importar ${file.name}`, error);
          failed.push(file.name);
        }
      }
    } finally {
      // Cleared so picking the same file again (say, re-adding a book just
      // removed) still fires `change` — the browser skips it for an unchanged value.
      input.value = "";
      setImporting(false);
      if (failed.length > 0) {
        toast.error(
          failed.length === 1
            ? "Não foi possível importar 1 arquivo"
            : `Não foi possível importar ${failed.length} arquivos`,
          {
            description: `${failed.join(", ")} — ${
              failed.length === 1
                ? "não parece ser um EPUB válido."
                : "não parecem ser EPUBs válidos."
            }`,
            // Long enough to read the file names.
            duration: 8000,
          },
        );
      }
      setBooks(await listBooks());
    }
  }

  async function handleRemove(id: string) {
    await removeBook(id);
    setBooks(await listBooks());
    setProgress(await listProgress());
  }

  const openBook = (id: string) => navigate(`/read/${id}`);

  const cover = (book: Book, className: string) => (
    <div
      className={cn("overflow-hidden rounded-lg border bg-muted", className)}
    >
      {book.coverBlob ? (
        <CoverImage
          blob={book.coverBlob}
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
        />
      ) : (
        <div className="flex h-full items-center justify-center p-2 text-center text-sm text-muted-foreground">
          {book.title}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col" style={themeVars}>
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        <header className="mb-6 flex items-center gap-3 sm:mb-8">
          <img
            src="/favicon.svg"
            alt=""
            className="size-8 shrink-0 rounded-lg"
          />
          <h1 className="flex items-center gap-1 min-w-0 flex-1 truncate text-xl font-semibold sm:text-2xl">
            Biblioteca
            {books.length > 0 && (
              <span className="text-sm font-normal text-muted-foreground sm:text-base">
                · {books.length} {books.length === 1 ? "livro" : "livros"}
              </span>
            )}
          </h1>
          <Button
            onClick={pickFiles}
            disabled={importing}
            aria-label="Adicionar EPUB"
            className="max-sm:size-11 max-sm:px-0"
          >
            <Plus />
            <span className="max-sm:hidden">
              {importing ? "Importando..." : "Adicionar EPUB"}
            </span>
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".epub"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target)}
          />
        </header>

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
              cover={cover(lastRead.book, "h-full w-full shadow-md")}
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
                cover={cover(alsoReading.book, "h-full w-full shadow-sm")}
                theme={activeTheme}
                onOpen={() => openBook(alsoReading.book.id)}
                className="hidden sm:flex sm:self-end"
              />
            )}
          </div>
        )}

        {books.length === 0 ? (
          <button
            type="button"
            onClick={pickFiles}
            disabled={importing}
            className="mx-auto mt-12 flex w-full max-w-sm cursor-pointer flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center transition-colors hover:bg-muted disabled:cursor-not-allowed"
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-muted">
              <Plus className="size-6" />
            </span>
            <span className="font-medium">
              {importing ? "Importando..." : "Adicionar seu primeiro EPUB"}
            </span>
            <span className="text-sm text-muted-foreground">
              Escolha um ou mais arquivos .epub do seu aparelho.
            </span>
          </button>
        ) : (
          <section aria-labelledby="todos-os-livros">
            <h2
              id="todos-os-livros"
              className="mb-3 text-xs font-medium text-muted-foreground"
            >
              Todos os livros
            </h2>
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 sm:gap-x-6 md:grid-cols-4 lg:grid-cols-5">
              {sortedBooks.map((book) => {
                const percentage = progressByBook.get(book.id)?.percentage ?? 0;
                return (
                  <div
                    key={book.id}
                    className="group relative flex flex-col gap-2"
                  >
                    {/* Stretched over the card, as in ReadingCard: a real
                        button, so Enter and Space both open the book, and the
                        ⋯ menu sits beside it instead of nested inside it. */}
                    <button
                      type="button"
                      aria-label={`Abrir ${book.title}`}
                      onClick={() => openBook(book.id)}
                      className="absolute inset-0 z-10 cursor-pointer rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    />
                    {cover(book, "aspect-2/3 w-full")}
                    {/* Always rendered, invisible for unstarted books, so every
                        card's title starts at the same height across a row. */}
                    <ProgressBar
                      theme={activeTheme}
                      percentage={percentage}
                      className={cn(
                        "-mt-0.5 h-1 rounded-full",
                        percentage === 0 && "invisible",
                      )}
                    />
                    <div className="flex items-start gap-1">
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm font-medium">
                          {book.title}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {book.author}
                        </p>
                      </div>
                      {/* modal={false}: a modal menu that closes while opening
                          the dialog below can leave `pointer-events: none`
                          stuck on the body in Radix. */}
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Opções de ${book.title}`}
                            className="relative z-20 -mr-1.5 text-muted-foreground"
                          >
                            <EllipsisVertical />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" style={portalVars}>
                          <DropdownMenuItem
                            className="cursor-pointer"
                            onSelect={() => {
                              setEditing({ book, session: Date.now() });
                              setEditOpen(true);
                            }}
                          >
                            <Pencil />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="cursor-pointer"
                            onSelect={() => void exportBook(book)}
                          >
                            <Download />
                            Exportar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            className="cursor-pointer"
                            onSelect={() => setBookToRemove(book)}
                          >
                            <Trash2 />
                            Remover
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={pickFiles}
                disabled={importing}
                className="flex aspect-2/3 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed"
              >
                <Plus className="size-5" />
                {importing ? "Importando..." : "Adicionar"}
              </button>
            </div>
          </section>
        )}
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
              O arquivo e o progresso de leitura salvo serão removidos
              permanentemente. Essa ação não pode ser desfeita.
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
          onSaved={async () => setBooks(await listBooks())}
          style={portalVars}
        />
      )}

      <footer className="border-t px-6 py-4 text-center text-xs text-muted-foreground">
        <p className="flex items-center justify-center gap-1.5">
          <Lock className="size-3.5 shrink-0" />
          Seus livros e seu progresso de leitura ficam guardados só aqui, no seu
          navegador — nada sai da sua máquina.
        </p>
      </footer>
      <Toaster />
    </div>
  );
}
