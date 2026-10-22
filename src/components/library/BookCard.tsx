import type { CSSProperties } from "react";
import {
  ArrowDownToLine,
  CloudUpload,
  Download,
  EllipsisVertical,
  LoaderCircle,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ProgressBar from "@/components/ProgressBar";
import BookCover from "@/components/library/BookCover";
import { hasFile, type Book, type BookWithFile, type Theme } from "@/lib/db/schema";
import { exportBook } from "@/lib/epub/export";
import { needsDownload } from "@/lib/sync/book-file";
import { cn } from "@/lib/utils";

// A book in the library's grid: cover (with ⤓ when it's only on Drive),
// progress, title and its ⋯ menu.
export default function BookCard({
  book,
  percentage,
  theme,
  portalStyle,
  downloading,
  driveConnected,
  onOpen,
  onEdit,
  onRemove,
  onDownload,
  onRemoveLocal,
}: {
  book: Book;
  percentage: number;
  theme: Theme;
  // The menu renders through a portal, outside the themed subtree.
  portalStyle: CSSProperties;
  downloading: boolean;
  driveConnected: boolean;
  onOpen: () => void;
  onEdit: (book: BookWithFile) => void;
  onRemove: (book: Book) => void;
  onDownload: () => void;
  onRemoveLocal: () => void;
}) {
  return (
    <div className="group relative flex flex-col gap-2">
      {/* Stretched over the card, as in ReadingCard: a real button, so Enter
          and Space both open the book, and the ⋯ menu sits beside it instead
          of nested inside it. */}
      <button
        type="button"
        aria-label={`Abrir ${book.title}`}
        onClick={onOpen}
        className="absolute inset-0 z-10 cursor-pointer rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <BookCover book={book} className="aspect-2/3 w-full">
        {/* Over the open button (z-20, like the ⋯ menu): downloads without
            opening. The theme's colors, so it reads on any palette. */}
        {!hasFile(book) && (
          <button
            type="button"
            onClick={onDownload}
            disabled={downloading}
            aria-label={downloading ? `Baixando ${book.title}` : `Baixar ${book.title}`}
            title={downloading ? "Baixando…" : "Baixar para este aparelho"}
            className="absolute right-2 bottom-2 z-20 flex size-10 cursor-pointer items-center justify-center rounded-full shadow-md transition-transform hover:scale-105 disabled:cursor-not-allowed"
            style={{ background: theme.background, color: theme.textColor }}
          >
            {downloading ? (
              <LoaderCircle className="size-5 animate-spin" />
            ) : (
              <ArrowDownToLine className="size-5" />
            )}
          </button>
        )}
      </BookCover>
      {/* Always rendered, invisible for unstarted books, so every card's
          title starts at the same height across a row. */}
      <ProgressBar
        theme={theme}
        percentage={percentage}
        className={cn("-mt-0.5 h-1 rounded-full", percentage === 0 && "invisible")}
      />
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium">{book.title}</p>
          <p className="truncate text-xs text-muted-foreground">{book.author}</p>
        </div>
        {/* modal={false}: a modal menu that closes while a dialog opens can
            leave `pointer-events: none` stuck on the body in Radix. */}
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
          <DropdownMenuContent align="end" style={portalStyle}>
            {/* Editing and exporting need the current file here: a book only
                on Drive, or one edited on another device since, is downloaded
                first (⤓, or opening it). Editing the old copy would put its
                old title back over the other device's edit. */}
            <DropdownMenuItem
              className="cursor-pointer"
              disabled={!hasFile(book) || needsDownload(book)}
              onSelect={() => {
                if (!hasFile(book) || needsDownload(book)) return;
                onEdit(book);
              }}
            >
              <Pencil />
              Editar
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer"
              disabled={!hasFile(book) || needsDownload(book)}
              onSelect={() => {
                if (hasFile(book) && !needsDownload(book)) void exportBook(book);
              }}
            >
              <Download />
              Exportar
            </DropdownMenuItem>
            {/* Frees the space here; the book stays on Drive and comes back
                with ⤓. Only once Drive has this very file (nothing pending)
                and is connected to bring it back: otherwise the file here
                could be the only copy. */}
            {hasFile(book) && book.driveFileId && (
              <DropdownMenuItem
                className="cursor-pointer"
                disabled={book.pendingUpload !== false || !driveConnected}
                onSelect={onRemoveLocal}
              >
                <CloudUpload />
                Remover deste aparelho
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              className="cursor-pointer"
              onSelect={() => onRemove(book)}
            >
              <Trash2 />
              Excluir livro
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
