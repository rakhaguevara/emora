"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { actions } from "@/lib/store";
import type { AppState } from "@/lib/types";

export function ManagePanelDialog({ open, onClose, app }: { open: boolean; onClose: () => void; app: AppState }) {
  return (
    <Dialog open={open} onClose={onClose} title="Kelola panel" description="Nama ini tampil di sidebar dan ringkasan.">
      {open && <Form app={app} onClose={onClose} />}
    </Dialog>
  );
}

function Form({ app, onClose }: { app: AppState; onClose: () => void }) {
  const [facility, setFacility] = useState(app.facility.name);
  const [panel, setPanel] = useState(app.facility.panelName);
  const fErr = !facility.trim() ? "Wajib diisi" : null;
  const pErr = !panel.trim() ? "Wajib diisi" : null;

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (fErr || pErr) return;
        actions.updateFacility(facility.trim(), panel.trim());
        onClose();
      }}
    >
      <div className="space-y-3">
        <Field label="Nama fasilitas" value={facility} onChange={(e) => setFacility(e.target.value)} error={fErr} autoFocus />
        <Field label="Nama panel" value={panel} onChange={(e) => setPanel(e.target.value)} error={pErr} />
        <dl className="grid grid-cols-2 gap-3 rounded-md bg-surface-2 p-3 text-[13px]">
          <div>
            <dt className="text-fg-3">ID pengontrol</dt>
            <dd className="font-semibold text-fg">{app.panel.deviceId}</dd>
          </div>
          <div>
            <dt className="text-fg-3">Firmware</dt>
            <dd className="font-semibold text-fg">{app.panel.firmware}</dd>
          </div>
        </dl>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Batal</Button>
        <Button type="submit" variant="primary">Simpan</Button>
      </div>
    </form>
  );
}
