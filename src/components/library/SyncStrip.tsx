import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import ProgressBar from "@/components/ProgressBar";
import type { Theme } from "@/lib/db/schema";
import { themeTint } from "@/lib/theme-colors";
import { useDriveStore } from "@/store/drive-store";
import { syncStripState } from "@/store/sync-strip";
import { useSyncStore } from "@/store/sync-store";

// Under the library's header, only while there's something to say: books
// going up, or a sync error the reader can act on (see syncStripState).
export default function SyncStrip({ theme }: { theme: Theme }) {
  const driveStatus = useDriveStore((s) => s.status);
  const connect = useDriveStore((s) => s.connect);
  const status = useSyncStore((s) => s.status);
  const progress = useSyncStore((s) => s.progress);
  const problem = useSyncStore((s) => s.problem);
  const error = useSyncStore((s) => s.error);
  const dismissedError = useSyncStore((s) => s.dismissedError);
  const run = useSyncStore((s) => s.run);
  const dismissError = useSyncStore((s) => s.dismissError);

  const strip = syncStripState({ status, progress, problem, error, dismissedError }, driveStatus);
  if (!strip) return null;

  if (strip.kind === "progresso") {
    return (
      <div
        role="status"
        className="mb-6 flex items-center gap-3 rounded-lg px-3 py-2 text-sm"
        style={{ background: themeTint(theme, 5) }}
      >
        <span className="shrink-0">
          Enviando livros · {strip.done} de {strip.total}
        </span>
        <ProgressBar
          theme={theme}
          percentage={(strip.done / strip.total) * 100}
          className="h-1 flex-1 rounded-full"
        />
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="mb-6 flex items-center gap-2 rounded-lg bg-destructive/10 py-1.5 pr-1.5 pl-3 text-sm text-destructive"
    >
      <p className="min-w-0 flex-1">{strip.message}</p>
      <Button
        variant="ghost"
        size="sm"
        className="font-semibold text-destructive hover:text-destructive"
        onClick={() => {
          if (strip.action === "reconectar") connect();
          else void run();
        }}
      >
        {strip.action === "reconectar" ? "Reconectar" : "Tentar de novo"}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Fechar aviso"
        className="text-destructive hover:text-destructive"
        onClick={dismissError}
      >
        <X />
      </Button>
    </div>
  );
}
