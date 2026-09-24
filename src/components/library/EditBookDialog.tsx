import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ImageUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import CoverImage from "@/components/CoverImage";
import { updateBook } from "@/lib/db/books";
import type { Book } from "@/lib/db/schema";
import {
  ProtectedEpubError,
  editBookInfo,
  joinAuthors,
  loadImage,
  readBookInfo,
} from "@/lib/epub/edit";
import { parseEpubMetadata } from "@/lib/epub/parse";

// Mounted afresh (a new `key`) each time it opens, so the fields start from
// the book instead of from the last, maybe cancelled, edit. `open` separate
// from `book` keeps the content in place while the dialog animates out. Its
// content renders through a portal, outside the themed page — hence `style`.
export default function EditBookDialog({
  book,
  open,
  onClose,
  onSaved,
  style,
}: {
  book: Book;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  style: CSSProperties;
}) {
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const [newCover, setNewCover] = useState<Blob | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "protected" | "saving">("loading");
  const coverInputRef = useRef<HTMLInputElement>(null);

  // Filled from the file itself, not the library's copy: that holds only the
  // first author, and saving would drop the rest.
  useEffect(() => {
    let cancelled = false;
    readBookInfo(book.fileBlob)
      .then((info) => {
        if (cancelled) return;
        if (info.title) setTitle(info.title);
        setAuthor(joinAuthors(info.authors));
        setStatus("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ProtectedEpubError) setStatus("protected");
        else {
          console.error("Não foi possível ler as informações do livro", error);
          setStatus("ready");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [book]);

  async function pickCover(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      await loadImage(file);
      setNewCover(file);
    } catch {
      toast.error("Não foi possível abrir essa imagem", {
        description: `${file.name} — escolha uma imagem JPG ou PNG.`,
      });
    }
  }

  async function save() {
    const cleanTitle = title.trim();
    const cleanAuthor = author.trim();
    setStatus("saving");
    try {
      const fileBlob = await editBookInfo(book.fileBlob, {
        title: cleanTitle,
        author: cleanAuthor,
        cover: newCover ?? undefined,
      });
      // Opening the result the way an import does also proves it's still
      // a readable EPUB before it replaces the original.
      const parsed = await parseEpubMetadata(new File([fileBlob], "livro.epub"));
      await updateBook(book.id, {
        title: cleanTitle,
        author: cleanAuthor || "Autor desconhecido",
        coverBlob: parsed.coverBlob,
        fileBlob,
      });
      toast.success("Informações atualizadas");
      onSaved();
      onClose();
    } catch (error) {
      console.error("Não foi possível salvar as informações do livro", error);
      toast.error("Não foi possível salvar as alterações", {
        description: "O arquivo do livro não foi modificado.",
      });
      setStatus("ready");
    }
  }

  const busy = status === "loading" || status === "saving";
  const cover = newCover ?? book.coverBlob;

  return (
    <Dialog open={open} onOpenChange={(open) => !open && status !== "saving" && onClose()}>
      <DialogContent style={style} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar informações</DialogTitle>
          <DialogDescription>
            As alterações ficam no próprio arquivo, e valem também ao exportar o EPUB.
          </DialogDescription>
        </DialogHeader>

        {status === "protected" ? (
          <p className="text-sm">
            Este livro tem proteção contra cópia (DRM) e não pode ser editado.
          </p>
        ) : (
          <form
            id="edit-book"
            className="flex gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="flex w-24 shrink-0 flex-col gap-2">
              <div className="aspect-2/3 overflow-hidden rounded-md border bg-muted">
                {cover ? (
                  <CoverImage blob={cover} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
                    Sem capa
                  </div>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => coverInputRef.current?.click()}
              >
                <ImageUp />
                Trocar
              </Button>
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => pickCover(event.target)}
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-book-title">Título</Label>
                <Input
                  id="edit-book-title"
                  value={title}
                  disabled={busy}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-book-author">Autor</Label>
                <Input
                  id="edit-book-author"
                  value={author}
                  disabled={busy}
                  onChange={(event) => setAuthor(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Mais de um autor: separe com &.
                </p>
              </div>
            </div>
          </form>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={status === "saving"} onClick={onClose}>
            Cancelar
          </Button>
          {status !== "protected" && (
            <Button type="submit" form="edit-book" disabled={busy || !title.trim()}>
              {status === "saving" ? "Salvando..." : "Salvar"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
