"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { jalurLabel } from "@/lib/derive";
import { actions } from "@/lib/store";
import type { Jalur } from "@/lib/types";

function nextSensorId(jalur: Jalur[]): string {
  const used = new Set(jalur.map((j) => j.sensorId));
  for (let i = 1; i < 100; i++) {
    const id = `PZEM-${String(i).padStart(2, "0")}`;
    if (!used.has(id)) return id;
  }
  return "";
}

export function AddJalurDialog({ open, onClose, jalur }: { open: boolean; onClose: () => void; jalur: Jalur[] }) {
  return (
    <Dialog open={open} onClose={onClose} title="Tambah jalur" description="Daftarkan sensor PZEM-004T baru pada panel ini.">
      {open && <AddForm jalur={jalur} onClose={onClose} />}
    </Dialog>
  );
}

function AddForm({ jalur, onClose }: { jalur: Jalur[]; onClose: () => void }) {
  const [name, setName] = useState("");
  const [sensorId, setSensorId] = useState(() => nextSensorId(jalur));
  const [touched, setTouched] = useState(false);

  const nameErr = !name.trim() ? "Nama jalur wajib diisi" : name.trim().length > 40 ? "Maksimal 40 karakter" : null;
  const sensorErr = !sensorId.trim()
    ? "ID sensor wajib diisi"
    : jalur.some((j) => j.sensorId.toLowerCase() === sensorId.trim().toLowerCase())
      ? "ID sensor sudah dipakai jalur lain"
      : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (nameErr || sensorErr) return;
    actions.addJalur(name.trim(), sensorId.trim());
    onClose();
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="space-y-3">
        <Field
          label="Nama jalur"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="mis. Pompa Cadangan"
          error={touched ? nameErr : null}
          autoFocus
        />
        <Field
          label="ID sensor"
          value={sensorId}
          onChange={(e) => setSensorId(e.target.value)}
          error={touched ? sensorErr : null}
          hint="Sesuai label pada modul PZEM-004T"
        />
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Batal</Button>
        <Button type="submit" variant="primary">Tambah jalur</Button>
      </div>
    </form>
  );
}

export function RenameDialog({ jalur, onClose }: { jalur: Jalur | null; onClose: () => void }) {
  return (
    <Dialog open={!!jalur} onClose={onClose} title="Ubah nama jalur" description={jalur ? `Jalur ${jalur.number}` : undefined}>
      {jalur && <RenameForm key={jalur.id} jalur={jalur} onClose={onClose} />}
    </Dialog>
  );
}

function RenameForm({ jalur, onClose }: { jalur: Jalur; onClose: () => void }) {
  const [name, setName] = useState(jalur.name);
  const err = !name.trim() ? "Nama jalur wajib diisi" : name.trim().length > 40 ? "Maksimal 40 karakter" : null;
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (err) return;
        actions.renameJalur(jalur.id, name.trim());
        onClose();
      }}
    >
      <Field label="Nama jalur" value={name} onChange={(e) => setName(e.target.value)} error={err} autoFocus />
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Batal</Button>
        <Button type="submit" variant="primary" disabled={!!err || name.trim() === jalur.name}>Simpan</Button>
      </div>
    </form>
  );
}

export function DeleteDialog({ jalur, onClose }: { jalur: Jalur | null; onClose: () => void }) {
  return (
    <Dialog
      open={!!jalur}
      onClose={onClose}
      title="Hapus jalur?"
      description={jalur ? `${jalurLabel(jalur)} (${jalur.sensorId}) tidak akan dipantau lagi. Riwayat kejadiannya tetap tersimpan.` : undefined}
      footer={
        <>
          <Button onClick={onClose}>Batal</Button>
          <Button
            variant="danger"
            onClick={() => {
              if (jalur) actions.removeJalur(jalur.id);
              onClose();
            }}
          >
            Hapus jalur
          </Button>
        </>
      }
    />
  );
}
