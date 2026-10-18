"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { useResource } from "@/lib/admin/useResource";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtDayLong, fmtEnergyText, fmtNum, fmtRp, parseLocaleNumber, ymd } from "@/lib/format";
import { fetchDeviceTariffs, fetchTips, type DailyTip, type DeviceTariff } from "@/lib/live/energy";
import { LIVE_DEVICE_ID, refreshAdminData } from "@/lib/live/sync";
import { costRp, effectivePerKwh, TARIFF_PRESETS, type Tariff } from "@/lib/tariff";
import { toast } from "@/lib/toast";

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const enc = encodeURIComponent;
const CUSTOM = "__custom";

// Dashboard operator di browser ini ikut diperbarui tanpa menunggu polling berikutnya
const afterSave = (deviceId: string) => {
  if (deviceId === LIVE_DEVICE_ID) void refreshAdminData();
};

const toTariff = (d: DeviceTariff): Tariff => ({ cls: d.tariff_class, perKwh: d.tariff_per_kwh, taxPct: d.tax_percent });

function TariffForm({ device, onSaved }: { device: DeviceTariff; onSaved: () => void }) {
  const preset0 = TARIFF_PRESETS.find((p) => p.cls === device.tariff_class && p.perKwh === device.tariff_per_kwh);
  const [preset, setPreset] = useState(preset0?.cls ?? CUSTOM);
  const [cls, setCls] = useState(device.tariff_class);
  const [perKwh, setPerKwh] = useState(String(device.tariff_per_kwh).replace(".", ","));
  const [tax, setTax] = useState(String(device.tax_percent).replace(".", ","));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const perKwhN = parseLocaleNumber(perKwh);
  const taxN = parseLocaleNumber(tax);
  const perKwhErr = perKwhN == null || perKwhN <= 0 ? "Isi tarif per kWh, mis. 1444,70" : null;
  const taxErr = taxN == null || taxN < 0 || taxN > 30 ? "Isi 0–30" : null;
  const dirty = cls.trim() !== device.tariff_class || perKwhN !== device.tariff_per_kwh || taxN !== device.tax_percent;
  const preview: Tariff | null = !perKwhErr && !taxErr ? { cls, perKwh: perKwhN!, taxPct: taxN! } : null;

  const pick = (v: string) => {
    setPreset(v);
    const p = TARIFF_PRESETS.find((x) => x.cls === v);
    if (p) {
      setCls(p.cls);
      setPerKwh(fmtNum(p.perKwh, 2));
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (perKwhErr || taxErr || !cls.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api("PATCH", `/api/admin/devices/${enc(device.id)}/tariff`, {
        tariff_class: cls.trim(), tariff_per_kwh: perKwhN, tax_percent: taxN,
      });
      toast("Tarif disimpan. Biaya di dashboard memakai tarif baru.", "success");
      afterSave(device.id);
      onSaved();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form noValidate onSubmit={submit} className="px-5 pt-4 pb-5">
      <div className="mb-4">
        <label htmlFor="tariff-preset" className="mb-1.5 block text-[13px] font-semibold text-fg">Golongan tarif PLN</label>
        <Select id="tariff-preset" value={preset} onChange={(e) => pick(e.target.value)} className="w-full">
          {TARIFF_PRESETS.map((p) => (
            <option key={p.cls} value={p.cls}>{p.cls} · Rp {fmtNum(p.perKwh, 2)}/kWh</option>
          ))}
          <option value={CUSTOM}>Lainnya (isi manual)</option>
        </Select>
        <p className="mt-1.5 text-xs text-fg-3">
          Angka acuan tarif PLN. Cocokkan dengan tagihan atau struk token, karena tarif bisa berubah tiap triwulan.
        </p>
      </div>
      <div className="grid gap-x-4 sm:grid-cols-3">
        <Field label="Nama golongan" value={cls} onChange={(e) => { setCls(e.target.value); setPreset(CUSTOM); }} maxLength={60} />
        <Field
          label="Tarif per kWh" inputMode="decimal" suffix="Rp" value={perKwh}
          onChange={(e) => { setPerKwh(e.target.value); setPreset(CUSTOM); }} error={perKwh ? perKwhErr : null}
        />
        <Field
          label="Pajak (PPJ)" inputMode="decimal" suffix="%" value={tax} onChange={(e) => setTax(e.target.value)}
          error={tax ? taxErr : null} hint="Pajak penerangan jalan daerah Anda. 0 bila tidak dihitung."
        />
      </div>
      {preview && (
        <p className="mb-4 rounded-md bg-surface-2 px-3 py-2 text-[13px] text-fg-2">
          Tarif efektif <b className="text-fg">{fmtRp(effectivePerKwh(preview))}/kWh</b> · contoh 100 kWh ={" "}
          <b className="text-fg">{fmtRp(costRp(100, preview))}</b>
        </p>
      )}
      {error && <p role="alert" className="mb-3 text-xs text-danger">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="sm" disabled={!dirty || busy || !!perKwhErr || !!taxErr || !cls.trim()}>
          Simpan tarif
        </Button>
      </div>
    </form>
  );
}

interface Draft {
  id: number | null;
  day: string;
  title: string;
  body: string;
  saving: string;
}

const blank = (): Draft => ({ id: null, day: ymd(Date.now()), title: "", body: "", saving: "" });

function TipForm({ deviceId, draft, setDraft, onSaved }: {
  deviceId: string; draft: Draft; setDraft: (d: Draft) => void; onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingN = draft.saving.trim() ? parseLocaleNumber(draft.saving) : null;
  const savingErr = draft.saving.trim() && (savingN == null || savingN < 0) ? "Isi angka kWh, mis. 0,5" : null;
  const editing = draft.id != null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim() || savingErr || !draft.day) return;
    setBusy(true);
    setError(null);
    const body = { day: draft.day, title: draft.title.trim(), body: draft.body.trim(), saving_kwh_per_day: savingN };
    try {
      if (editing) await api("PATCH", `/api/admin/devices/${enc(deviceId)}/tips/${draft.id}`, body);
      else await api("POST", `/api/admin/devices/${enc(deviceId)}/tips`, body);
      toast(editing ? "Rekomendasi diperbarui" : "Rekomendasi ditambahkan", "success");
      setDraft({ ...blank(), day: draft.day });
      afterSave(deviceId);
      onSaved();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form noValidate onSubmit={submit} className="px-5 pt-4 pb-5">
      <div className="grid gap-x-4 sm:grid-cols-[180px_minmax(0,1fr)]">
        <Field label="Tanggal tampil" type="date" value={draft.day} onChange={(e) => setDraft({ ...draft, day: e.target.value })} hint="Tampil di dashboard pada tanggal ini." />
        <Field label="Judul" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={120} placeholder="Matikan dispenser saat malam" />
      </div>
      <div className="mb-4">
        <label htmlFor="tip-body" className="mb-1.5 block text-[13px] font-semibold text-fg">Isi rekomendasi</label>
        <textarea
          id="tip-body" rows={3} maxLength={1000} value={draft.body}
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          placeholder="Contoh: pemanas dispenser menyala sepanjang malam. Matikan pukul 21.00–05.00."
          className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-fg"
        />
        <p className="mt-1 text-right text-xs text-fg-3">{draft.body.length}/1000</p>
      </div>
      <Field
        label="Perkiraan hemat (opsional)" inputMode="decimal" suffix="kWh" value={draft.saving}
        onChange={(e) => setDraft({ ...draft, saving: e.target.value })} error={savingErr}
        hint="Per hari. Rupiah per bulan dihitung otomatis dari tarif."
        className="sm:max-w-64"
      />
      {error && <p role="alert" className="mb-3 text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        {editing && <Button size="sm" onClick={() => setDraft(blank())}>Batal ubah</Button>}
        <Button type="submit" variant="primary" size="sm" disabled={busy || !draft.title.trim() || !!savingErr || !draft.day}>
          {editing ? "Simpan perubahan" : "Tambah rekomendasi"}
        </Button>
      </div>
    </form>
  );
}

function TipItem({ tip, tariff, today, onEdit, onDeleted, deviceId }: {
  tip: DailyTip; tariff: Tariff | null; today: string; onEdit: () => void; onDeleted: () => void; deviceId: string;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await api("DELETE", `/api/admin/devices/${enc(deviceId)}/tips/${tip.id}`);
      toast("Rekomendasi dihapus", "success");
      afterSave(deviceId);
      onDeleted();
    } catch (err) {
      toast(errText(err), "error");
      setBusy(false);
      setConfirm(false);
    }
  };
  return (
    <li className="border-b border-line px-5 py-4 last:border-b-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-fg">{tip.title}</p>
          {tip.body && <p className="mt-1 text-[13px] whitespace-pre-line text-fg-2">{tip.body}</p>}
          <p className="mt-1.5 text-xs text-fg-3">
            {tip.savingKwhPerDay != null && tip.savingKwhPerDay > 0 && tariff
              ? `Hemat ± ${fmtEnergyText(tip.savingKwhPerDay)}/hari (± ${fmtRp(costRp(tip.savingKwhPerDay * 30, tariff))}/bulan) · `
              : ""}
            Oleh {tip.createdBy}
          </p>
        </div>
        {tip.day === today && <Badge tone="primary">Hari ini</Badge>}
      </div>
      <div className="mt-3 flex items-center gap-2">
        {confirm ? (
          <>
            <span className="text-[13px] text-fg-2">Hapus rekomendasi ini?</span>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => void remove()}>Hapus</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm(false)}>Batal</Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /> Ubah</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}><Trash2 className="h-3.5 w-3.5" /> Hapus</Button>
          </>
        )}
      </div>
    </li>
  );
}

function DevicePanel({ device, reloadDevices }: { device: DeviceTariff; reloadDevices: () => void }) {
  const loadTips = useCallback(() => fetchTips(device.id), [device.id]);
  const tips = useResource(loadTips);
  const [draft, setDraft] = useState<Draft>(blank);
  const [today] = useState(() => ymd(Date.now()));
  const tariff = toTariff(device);

  // Kelompokkan per tanggal; yang akan datang dan hari ini di atas
  const groups = new Map<string, DailyTip[]>();
  for (const t of tips.data ?? []) groups.set(t.day, [...(groups.get(t.day) ?? []), t]);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        <Card>
          <CardHeader title="Tarif listrik" subtitle="Dipakai untuk semua perhitungan biaya di dashboard operator." />
          <TariffForm key={`${device.tariff_class}|${device.tariff_per_kwh}|${device.tax_percent}`} device={device} onSaved={reloadDevices} />
        </Card>
        <Card>
          <CardHeader
            title={draft.id != null ? "Ubah rekomendasi" : "Tambah rekomendasi harian"}
            subtitle="Tampil di halaman Energi & Efisiensi operator pada tanggal yang dipilih."
          />
          <TipForm deviceId={device.id} draft={draft} setDraft={setDraft} onSaved={() => void tips.reload()} />
        </Card>
      </div>

      <Card className="self-start">
        <CardHeader title="Daftar rekomendasi" subtitle="Terbaru di atas. Rekomendasi hanya tampil pada tanggalnya." />
        {tips.error ? (
          <p role="alert" className="px-5 py-6 text-[13px] text-danger">{tips.error}</p>
        ) : tips.loading && !tips.data ? (
          <p className="px-5 py-8 text-center text-[13px] text-fg-3">Memuat…</p>
        ) : groups.size === 0 ? (
          <p className="mt-4 border-t border-line px-5 py-8 text-center text-[13px] text-fg-3">Belum ada rekomendasi.</p>
        ) : (
          <div className="mt-4">
            {[...groups].map(([day, list]) => (
              <section key={day} className="border-t border-line">
                <h3 className={cn("bg-surface-2 px-5 py-2 text-xs font-semibold", day === today ? "text-primary" : "text-fg-2")}>
                  {fmtDayLong(Date.parse(`${day}T00:00:00+07:00`))}{day > today ? " · terjadwal" : ""}
                </h3>
                <ul>
                  {list.map((t) => (
                    <TipItem
                      key={t.id} tip={t} tariff={tariff} today={today} deviceId={device.id}
                      onEdit={() => {
                        setDraft({ id: t.id, day: t.day, title: t.title, body: t.body, saving: t.savingKwhPerDay == null ? "" : fmtNum(t.savingKwhPerDay, 2) });
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      onDeleted={() => void tips.reload()}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export function TarifAdminView() {
  const devices = useResource(fetchDeviceTariffs);
  const [picked, setPicked] = useState<string | null>(null);
  const list = devices.data ?? [];
  const device = list.find((d) => d.id === picked) ?? list.find((d) => d.id === LIVE_DEVICE_ID) ?? list[0];

  return (
    <>
      <PageHeader
        title="Tarif & Rekomendasi"
        subtitle="Atur tarif listrik untuk perhitungan biaya, dan tulis rekomendasi hemat energi harian untuk operator."
        actions={
          list.length > 1 && device ? (
            <Select aria-label="Pilih perangkat" value={device.id} onChange={(e) => setPicked(e.target.value)} className="w-full sm:w-56">
              {list.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.id})</option>)}
            </Select>
          ) : undefined
        }
      />
      {devices.error ? (
        <Card className="p-5"><p role="alert" className="text-[13px] text-danger">Gagal memuat perangkat: {devices.error}</p></Card>
      ) : !device ? (
        <Card className="p-5"><p className="text-[13px] text-fg-3">{devices.loading ? "Memuat…" : "Belum ada perangkat."}</p></Card>
      ) : (
        <DevicePanel key={device.id} device={device} reloadDevices={() => void devices.reload()} />
      )}
    </>
  );
}
