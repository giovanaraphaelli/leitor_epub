import { useState, type CSSProperties } from "react";
import { CloudAlert, CloudCheck, CloudOff, type LucideIcon } from "lucide-react";
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
import { useDriveStore, type DriveStatus } from "@/store/drive-store";

// The button is hidden while the state is unknown or there's no login server.
const STATES: Partial<Record<DriveStatus, { icon: LucideIcon; label: string }>> = {
  desconectado: { icon: CloudOff, label: "Google Drive: desconectado" },
  conectado: { icon: CloudCheck, label: "Google Drive: conectado" },
  reconectar: { icon: CloudAlert, label: "Google Drive: conecte de novo" },
};

function description(status: DriveStatus, email: string | null): string {
  if (status === "conectado") {
    return email ? `Conectado como ${email}.` : "Conectado ao Google Drive.";
  }
  if (status === "reconectar") {
    return "O acesso ao Google Drive expirou ou foi removido. Conecte de novo para continuar.";
  }
  return "Guarde livros, progresso e grifos no seu Google Drive e continue a leitura em outro aparelho.";
}

export default function DriveButton({ portalStyle }: { portalStyle: CSSProperties }) {
  const status = useDriveStore((s) => s.status);
  const account = useDriveStore((s) => s.account);
  const connect = useDriveStore((s) => s.connect);
  const disconnect = useDriveStore((s) => s.disconnect);
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const state = STATES[status];
  if (!state) return null;
  const Icon = state.icon;

  async function handleDisconnect() {
    setLeaving(true);
    try {
      await disconnect();
      setOpen(false);
    } catch {
      toast.error("Não foi possível desconectar", {
        description: "Confira a conexão e tente de novo.",
      });
    } finally {
      setLeaving(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label={state.label}
        title={state.label}
        onClick={() => setOpen(true)}
        className="max-sm:size-11"
      >
        <Icon className="size-5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent style={portalStyle}>
          <DialogHeader>
            <DialogTitle>Google Drive</DialogTitle>
            <DialogDescription>{description(status, account?.email ?? null)}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {status === "conectado" ? (
              <Button variant="outline" onClick={handleDisconnect} disabled={leaving}>
                {leaving ? "Desconectando..." : "Desconectar"}
              </Button>
            ) : (
              <Button onClick={connect}>
                {status === "reconectar" ? "Reconectar" : "Conectar ao Google Drive"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
