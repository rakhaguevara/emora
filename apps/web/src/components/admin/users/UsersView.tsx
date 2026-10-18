"use client";

import { MoreHorizontal, Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import { PageHeader, PageSkeleton } from "@/components/ui/PageHeader";
import { adminApi, type AdminUser } from "@/lib/admin/api";
import { useResource } from "@/lib/admin/useResource";
import { ROLE_LABEL, useSession } from "@/lib/auth/session";
import { fmtAgo } from "@/lib/format";
import { toast } from "@/lib/toast";
import { ConfirmDialog, CreateUserDialog, PinRevealDialog, ResetPasswordDialog } from "./UserDialogs";

type Pending = { kind: "toggle" | "delete" | "pin"; user: AdminUser };

const CONFIRM: Record<Pending["kind"], (u: AdminUser) => { title: string; description: string; label: string }> = {
  toggle: (u) => u.active
    ? { title: "Nonaktifkan akun?", description: `${u.display_name} tidak bisa masuk lagi dan sesinya dicabut. Bisa diaktifkan kembali.`, label: "Nonaktifkan" }
    : { title: "Aktifkan akun?", description: `${u.display_name} bisa masuk lagi dengan password yang sama.`, label: "Aktifkan" },
  delete: (u) => ({ title: "Hapus akun?", description: `Akun ${u.username} dihapus permanen. Riwayat tindakannya tetap tercatat dengan namanya.`, label: "Hapus akun" }),
  pin: (u) => ({ title: "Buat PIN baru?", description: `PIN lama ${u.display_name} langsung tidak berlaku. PIN baru ditampilkan sekali.`, label: "Buat PIN baru" }),
};

export function UsersView() {
  const me = useSession()?.user;
  const { data: users, error, loading, reload, loadedAt } = useResource(adminApi.listUsers);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reveal, setReveal] = useState<{ user: AdminUser; pin: string } | null>(null);

  const run = async ({ kind, user }: Pending) => {
    if (kind === "toggle") {
      await adminApi.updateUser(user.id, { active: !user.active });
      toast(`Akun ${user.username} ${user.active ? "dinonaktifkan" : "diaktifkan"}`, "success");
    } else if (kind === "delete") {
      await adminApi.deleteUser(user.id);
      toast(`Akun ${user.username} dihapus`, "info");
    } else {
      const { pin } = await adminApi.resetPin(user.id);
      setReveal({ user, pin });
    }
    await reload();
  };

  const itemsFor = (u: AdminUser): MenuItem[] => {
    const self = u.id === me?.id;
    return [
      { label: "Reset password", onSelect: () => setResetting(u) },
      ...(u.role === "operator" ? [{ label: "Buat PIN baru", onSelect: () => setPending({ kind: "pin", user: u }) }] : []),
      ...(self ? [] : [
        { label: u.active ? "Nonaktifkan" : "Aktifkan", onSelect: () => setPending({ kind: "toggle", user: u }) },
        { label: "Hapus akun", danger: true, onSelect: () => setPending({ kind: "delete", user: u }) },
      ]),
    ];
  };

  const confirm = pending ? CONFIRM[pending.kind](pending.user) : null;
  const operators = users?.filter((u) => u.role === "operator").length ?? 0;

  return (
    <>
      <PageHeader
        title="Akun"
        subtitle="Admin dan operator. Tidak ada pendaftaran mandiri: semua akun dibuat di sini."
        actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Tambah akun</Button>}
      />

      {error && <p role="alert" className="mb-4 rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
      {loading && !users ? <PageSkeleton /> : users && (
        <Card>
          <p className="border-b border-line px-5 py-3 text-[13px] text-fg-3">
            {users.length} akun · {operators} operator. Setiap operator punya PIN kontrol sendiri untuk ON/OFF relai.
          </p>
          <ul>
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-5 py-3.5 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-fg">
                    {u.display_name} {u.id === me?.id && <span className="text-xs font-normal text-fg-3">(kamu)</span>}
                  </p>
                  <p className="text-[13px] text-fg-3">@{u.username}</p>
                </div>
                <Badge tone={u.role === "admin" ? "primary" : "neutral"}>{ROLE_LABEL[u.role]}</Badge>
                <Badge tone={u.active ? "success" : "warning"}>{u.active ? "Aktif" : "Nonaktif"}</Badge>
                <p className="w-40 text-[13px] text-fg-3">
                  {u.last_login_at ? `Masuk ${fmtAgo(loadedAt - Date.parse(u.last_login_at))}` : "Belum pernah masuk"}
                </p>
                <Menu
                  label={`Aksi untuk ${u.username}`}
                  items={itemsFor(u)}
                  trigger={
                    <span className="flex h-9 w-9 items-center justify-center rounded-md border border-line-strong text-fg-2 hover:bg-surface-2">
                      <MoreHorizontal className="h-4 w-4" />
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <CreateUserDialog open={creating} onClose={() => setCreating(false)} onCreated={reload} onPin={(user, pin) => setReveal({ user, pin })} />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
      <ConfirmDialog
        open={!!pending}
        title={confirm?.title ?? ""}
        description={confirm?.description}
        confirmLabel={confirm?.label ?? ""}
        onConfirm={() => run(pending!)}
        onClose={() => setPending(null)}
      />
      <PinRevealDialog reveal={reveal} onClose={() => setReveal(null)} />
    </>
  );
}
