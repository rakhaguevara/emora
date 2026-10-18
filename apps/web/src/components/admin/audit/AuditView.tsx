"use client";

import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader, PageSkeleton } from "@/components/ui/PageHeader";
import { adminApi, type AuditCommand, type AuditModeChange, type DeviceMode } from "@/lib/admin/api";
import { useResource } from "@/lib/admin/useResource";
import { fmtEventTime } from "@/lib/format";

// Jejak audit: perintah relai (siapa, alasan, status di ESP32) dan perubahan mode respons.

const MODE: Record<DeviceMode, string> = { auto: "Otomatis", semi_auto: "Semi-otomatis" };
const SOURCE: Record<AuditCommand["source"], string> = {
  user: "Operator",
  recommendation: "Operator (rekomendasi)",
  auto: "Sistem",
  local: "Proteksi ESP32",
};
const STATUS: Record<AuditCommand["status"], { text: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  pending: { text: "Menunggu ESP32", tone: "neutral" },
  sent: { text: "Diterima ESP32", tone: "warning" },
  acked: { text: "Dikonfirmasi", tone: "success" },
  failed: { text: "Gagal diterapkan", tone: "danger" },
};

interface Row {
  key: string;
  ts: number;
  deviceId: string;
  actor: string;
  title: string;
  detail: string;
  badge?: { text: string; tone: "success" | "warning" | "danger" | "neutral" };
}

const fromCommand = (c: AuditCommand): Row => ({
  key: `cmd${c.id}`,
  ts: Date.parse(c.ts),
  deviceId: c.device_id,
  actor: c.actor,
  title: `Relai ${c.action === "on" ? "ON" : "OFF"} · ${SOURCE[c.source]}`,
  detail: [c.reason, c.mode && `mode ${MODE[c.mode]}`].filter(Boolean).join(" · "),
  badge: STATUS[c.status],
});

const fromModeChange = (m: AuditModeChange): Row => ({
  key: `mode${m.id}`,
  ts: Date.parse(m.ts),
  deviceId: m.device_id,
  actor: m.actor,
  title: "Mode respons diubah",
  detail: `${m.prev_mode ? MODE[m.prev_mode] : "—"} → ${MODE[m.mode]}`,
});

const loadAudit = () => adminApi.audit(150);

export function AuditView() {
  const { data, error, loading, reload, loadedAt: now } = useResource(loadAudit);
  const rows = data
    ? [...data.commands.map(fromCommand), ...data.mode_changes.map(fromModeChange)].sort((a, b) => b.ts - a.ts)
    : [];

  return (
    <>
      <PageHeader
        title="Aktivitas"
        subtitle="Siapa menyalakan/mematikan relai, alasannya, dan perubahan mode. Pelaku tercatat dari akun yang login."
        actions={<Button onClick={() => void reload()} disabled={loading}><RefreshCw className="h-4 w-4" /> Muat ulang</Button>}
      />
      {error && <p role="alert" className="mb-4 rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
      {loading && !data ? <PageSkeleton /> : (
        <Card>
          {rows.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-fg-3">Belum ada aktivitas.</p>
          ) : (
            <ul>
              {rows.map((r) => (
                <li key={r.key} className="flex flex-wrap items-start gap-x-4 gap-y-1 border-b border-line px-5 py-3.5 last:border-b-0">
                  <p className="w-36 shrink-0 text-[13px] text-fg-3 tabular-nums">{fmtEventTime(r.ts, now)}</p>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-fg">{r.title}</p>
                    <p className="text-[13px] text-fg-2">
                      <b className="font-medium">{r.actor}</b> · {r.deviceId}{r.detail && ` · ${r.detail}`}
                    </p>
                  </div>
                  {r.badge && <Badge tone={r.badge.tone}>{r.badge.text}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
