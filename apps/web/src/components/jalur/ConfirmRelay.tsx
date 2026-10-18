"use client";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { jalurLabel } from "@/lib/derive";
import { actions } from "@/lib/store";
import type { Jalur } from "@/lib/types";

export function ConfirmRelayOff({ jalur, onClose }: { jalur: Jalur | null; onClose: () => void }) {
  return (
    <Dialog
      open={!!jalur}
      onClose={onClose}
      title="Matikan relai?"
      description={jalur ? `Beban pada ${jalurLabel(jalur)} akan terputus. Tindakan ini dicatat sebagai kejadian Manual.` : undefined}
      footer={
        <>
          <Button onClick={onClose}>Batal</Button>
          <Button
            variant="danger"
            onClick={() => {
              if (jalur) actions.setRelay(jalur.id, false);
              onClose();
            }}
          >
            Matikan relai
          </Button>
        </>
      }
    />
  );
}
