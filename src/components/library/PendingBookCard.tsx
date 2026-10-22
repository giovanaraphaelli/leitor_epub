import { LoaderCircle, X } from "lucide-react";
import CoverImage from "@/components/CoverImage";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ImportItem } from "@/store/import-store";

// A file still in the import queue: not a book yet, so nothing to open or to
// pick from a menu. Its cover and title come in as soon as they're read.
export default function PendingBookCard({
  item,
  onDismiss,
}: {
  item: ImportItem;
  onDismiss: () => void;
}) {
  const failed = item.status === "falhou";
  // A failed file is shown by its name: it's the file that couldn't be imported.
  const name = failed ? item.fileName : (item.title ?? item.fileName);
  const preparing = !failed && item.title !== undefined;
  const status = failed
    ? "Não foi possível importar"
    : item.status === "fila"
      ? "Na fila"
      : "Preparando…";
  return (
    <div className="flex flex-col gap-2" aria-busy={!failed}>
      <div className="relative aspect-2/3 w-full overflow-hidden rounded-lg border bg-muted">
        {!failed && item.coverBlob ? (
          <CoverImage blob={item.coverBlob} className="h-full w-full object-cover opacity-60" />
        ) : (
          <div
            className={cn(
              "flex h-full items-center justify-center p-2 text-center text-sm break-all text-muted-foreground",
              !failed && "animate-pulse",
            )}
          >
            {/* Under the spinner the title would only clutter it; it's right below the cover. */}
            {!preparing && name}
          </div>
        )}
        {preparing && (
          <div className="absolute inset-0 flex items-center justify-center">
            <LoaderCircle className="size-8 animate-spin" aria-hidden />
          </div>
        )}
      </div>
      {/* Where BookCard has its progress bar, so titles line up across a row. */}
      <div className="-mt-0.5 h-1" />
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium">{name}</p>
          <p className={cn("truncate text-xs", failed ? "text-destructive" : "text-muted-foreground")}>
            {status}
          </p>
        </div>
        {failed && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Dispensar ${item.fileName}`}
            onClick={onDismiss}
            className="-mr-1.5 text-muted-foreground"
          >
            <X />
          </Button>
        )}
      </div>
    </div>
  );
}
