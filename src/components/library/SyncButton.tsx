import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDriveStore } from "@/store/drive-store";
import { useSyncStore, type SyncStatus } from "@/store/sync-store";

function label(status: SyncStatus, lastSyncAt: number | null, error: string | null): string {
  if (status === "sincronizando") return "Sincronizando…";
  if (status === "erro" && error) return error;
  if (!lastSyncAt) return "Sincronizar agora";
  const time = new Date(lastSyncAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `Sincronizado às ${time}`;
}

// Spins while syncing and carries a dot after a failed sync, the reason in its
// tooltip. Phones show no tooltips, so a sync started here also says how it
// went; the automatic one of every visit stays quiet.
export default function SyncButton() {
  const driveStatus = useDriveStore((s) => s.status);
  const status = useSyncStore((s) => s.status);
  const lastSyncAt = useSyncStore((s) => s.lastSyncAt);
  const error = useSyncStore((s) => s.error);
  const run = useSyncStore((s) => s.run);
  if (driveStatus !== "conectado") return null;

  const syncing = status === "sincronizando";
  const text = label(status, lastSyncAt, error);

  async function syncNow() {
    if (syncing) return;
    const outcome = await run();
    if (!outcome) return;
    if (outcome.error) toast.error(outcome.error, { id: "sync-result" });
    else if (!outcome.announced) toast.success("Biblioteca sincronizada", { id: "sync-result" });
  }

  return (
    <Button
      variant="ghost"
      size="icon-lg"
      aria-label={text}
      title={text}
      aria-busy={syncing}
      onClick={() => void syncNow()}
      className="relative max-sm:size-11"
    >
      <RefreshCw className={cn("size-5", syncing && "animate-spin")} />
      {status === "erro" && (
        <span aria-hidden className="absolute top-2 right-2 size-2 rounded-full bg-destructive" />
      )}
    </Button>
  );
}
