import type { ReactNode } from "react";
import CoverImage from "@/components/CoverImage";
import { hasFile, type Book } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

// The cover as the library shows it. A book only on Drive is faded, so what
// can be read without a connection stands out; children go over the cover
// (the grid puts the download button there).
export default function BookCover({
  book,
  className,
  children,
}: {
  book: Book;
  className?: string;
  children?: ReactNode;
}) {
  const cloud = !hasFile(book);
  return (
    <div
      className={cn("relative overflow-hidden rounded-lg border bg-muted", className)}
    >
      {book.coverBlob ? (
        <CoverImage
          blob={book.coverBlob}
          className={cn(
            "h-full w-full object-cover transition-transform group-hover:scale-105",
            cloud && "opacity-45 grayscale",
          )}
        />
      ) : (
        <div
          className={cn(
            "flex h-full items-center justify-center p-2 text-center text-sm text-muted-foreground",
            cloud && "opacity-60",
          )}
        >
          {book.title}
        </div>
      )}
      {children}
    </div>
  );
}
