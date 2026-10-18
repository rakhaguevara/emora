"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { RadioCards } from "@/components/ui/RadioCards";
import { adminApi, type AdminDevice, type DeviceMode, type DeviceThresholds } from "@/lib/admin/api";
import { AUTO_CUT_SEC, DECISION_SEC } from "@/lib/live/sync";
import { toast } from "@/lib/toast";

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Simpan dengan status sibuk + pesan galat di form
function useSave(onSaved: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (fn: () => Promise<unknown>, okMessage: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast(okMessage, "success");
      onSaved();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, save };
}

export function IdentityForm({ device, onSaved }: { device: AdminDevice; onSaved: () => void }) {
  const [name, setName] = useState(device.name);
  const [location, setLocation] = useState(device.location ?? "");
  const { busy, error, save } = useSave(onSaved);
  const dirty = name !== device.name || location !== (device.location ?? "");

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save(() => adminApi.updateDevice(device.id, { name: name.trim(), location: location.trim() }), "Identitas perangkat disimpan");
      }}
    >
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field id={`name-${device.id}`} label="Nama" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} hint="Tampil sebagai nama jalur di dashboard operator." />
        <Field id={`loc-${device.id}`} label="Lokasi / fasilitas" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120} error={error} />
      </div>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="sm" disabled={!dirty || busy}>Simpan identitas</Button>
      </div>
    </form>
  );
}

export function ModeForm({ device, onSaved }: { device: AdminDevice; onSaved: () => void }) {
  const { busy, error, save } = useSave(onSaved);
  return (
    <div aria-busy={busy}>
      <RadioCards<DeviceMode>
        legend="Mode respons anomali"
        name={`mode-${device.id}`}
        value={device.mode}
        onChange={(mode) => {
          if (mode !== device.mode && !busy) {
            void save(() => adminApi.setMode(device.id, mode), `Mode: ${mode === "auto" ? "Otomatis" : "Semi-otomatis"}`);
          }
        }}
        options={[
          { value: "semi_auto", label: "Semi-otomatis", hint: `Operator memutuskan dalam ${DECISION_SEC} detik; bila tidak, pengaman memutus relai.` },
          { value: "auto", label: "Otomatis", hint: `Relai diputus ${AUTO_CUT_SEC} detik setelah anomali, kecuali operator membatalkan.` },
        ]}
      />
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}

const TH_FIELDS: { key: keyof DeviceThresholds; label: string; unit: string; step: string }[] = [
  { key: "volt_min", label: "Tegangan min.", unit: "V", step: "1" },
  { key: "volt_max", label: "Tegangan maks.", unit: "V", step: "1" },
  { key: "current_max", label: "Arus maks.", unit: "A", step: "0.1" },
  { key: "power_max", label: "Daya maks.", unit: "W", step: "1" },
  { key: "pf_min", label: "Faktor daya min.", unit: "", step: "0.01" },
  { key: "freq_min", label: "Frekuensi min.", unit: "Hz", step: "0.1" },
  { key: "freq_max", label: "Frekuensi maks.", unit: "Hz", step: "0.1" },
  { key: "temp_max", label: "Suhu maks. (peringatan)", unit: "°C", step: "1" },
  { key: "energy_hourly_max_wh", label: "Energi per jam maks.", unit: "Wh", step: "1" },
];

export function ThresholdsForm({ device, onSaved }: { device: AdminDevice; onSaved: () => void }) {
  const initial = Object.fromEntries(TH_FIELDS.map((f) => [f.key, String(device.thresholds[f.key] ?? "")]));
  const [values, setValues] = useState<Record<string, string>>(initial);
  const { busy, error, save } = useSave(onSaved);
  const dirty = TH_FIELDS.some((f) => values[f.key] !== initial[f.key]);
  const invalid = TH_FIELDS.some((f) => values[f.key].trim() === "" || !Number.isFinite(Number(values[f.key])));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    const thresholds = Object.fromEntries(TH_FIELDS.map((f) => [f.key, Number(values[f.key])])) as unknown as DeviceThresholds;
    void save(() => adminApi.updateDevice(device.id, { thresholds }), "Ambang batas disimpan, langsung dipakai backend");
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="grid gap-x-4 sm:grid-cols-3">
        {TH_FIELDS.map((f) => (
          <Field
            key={f.key}
            id={`${f.key}-${device.id}`}
            label={f.label}
            type="number"
            inputMode="decimal"
            step={f.step}
            suffix={f.unit || undefined}
            value={values[f.key]}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
          />
        ))}
      </div>
      {error && <p role="alert" className="mb-3 text-xs text-danger">{error}</p>}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-fg-3">Proteksi lokal ESP32 (batas HARD_* di firmware) tidak ikut berubah.</p>
        <Button type="submit" variant="primary" size="sm" disabled={!dirty || invalid || busy}>Simpan ambang</Button>
      </div>
    </form>
  );
}

export function AddDeviceDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Tambah perangkat" description="ID harus sama dengan DEVICE_ID di firmware ESP32.">
      {open && <AddDeviceForm onClose={onClose} onCreated={onCreated} />}
    </Dialog>
  );
}

function AddDeviceForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const { busy, error, save } = useSave(() => {
    onCreated();
    onClose();
  });

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save(() => adminApi.createDevice({ id: id.trim(), name: name.trim(), location: location.trim() }), "Perangkat ditambahkan");
      }}
    >
      <Field label="ID perangkat" value={id} onChange={(e) => setId(e.target.value.toLowerCase())} maxLength={64} placeholder="emora-02" spellCheck={false} />
      <Field label="Nama" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      <Field label="Lokasi (opsional)" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120} error={error} />
      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={onClose}>Batal</Button>
        <Button type="submit" variant="primary" disabled={busy}>Tambah</Button>
      </div>
    </form>
  );
}
