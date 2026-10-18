"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader, PageSkeleton } from "@/components/ui/PageHeader";
import { adminApi, type AdminDevice } from "@/lib/admin/api";
import { useResource } from "@/lib/admin/useResource";
import { fmtAgo } from "@/lib/format";
import { AddDeviceDialog, IdentityForm, ModeForm, ThresholdsForm } from "./DeviceForms";

// Data perangkat (tabel devices): identitas, mode respons anomali, dan ambang batas.
export function DevicesView() {
  const { data: devices, error, loading, reload, loadedAt } = useResource(adminApi.listDevices);
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageHeader
        title="Perangkat"
        subtitle="Identitas, mode respons, dan ambang batas tiap ESP32. Perubahan langsung dipakai backend."
        actions={<Button variant="primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Tambah perangkat</Button>}
      />
      {error && <p role="alert" className="mb-4 rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
      {loading && !devices ? <PageSkeleton /> : (
        <div className="space-y-5">
          {devices?.map((d) => <DeviceCard key={d.id} device={d} now={loadedAt} onSaved={reload} />)}
          {devices?.length === 0 && <Card className="p-8 text-center text-[13px] text-fg-3">Belum ada perangkat.</Card>}
        </div>
      )}
      <AddDeviceDialog open={adding} onClose={() => setAdding(false)} onCreated={reload} />
    </>
  );
}

function DeviceCard({ device, now, onSaved }: { device: AdminDevice; now: number; onSaved: () => void }) {
  const seen = device.last_seen ? Date.parse(device.last_seen) : null;
  const online = seen != null && now - seen < 60_000;
  return (
    <Card>
      <CardHeader
        title={device.name}
        subtitle={`ID ${device.id} · ${seen ? `data terakhir ${fmtAgo(now - seen)}` : "belum pernah mengirim data"}`}
        right={<Badge tone={online ? "success" : "neutral"}>{online ? "Online" : "Offline"}</Badge>}
      />
      <div className="space-y-6 p-5">
        <Section title="Identitas"><IdentityForm device={device} onSaved={onSaved} /></Section>
        <Section title="Mode respons"><ModeForm device={device} onSaved={onSaved} /></Section>
        <Section title="Ambang batas anomali"><ThresholdsForm device={device} onSaved={onSaved} /></Section>
      </div>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-3 text-[13px] font-semibold tracking-wider text-fg-3 uppercase">{title}</h3>
      {children}
    </section>
  );
}
