"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { adminApi, type AdminUser } from "@/lib/admin/api";
import type { Role } from "@/lib/auth/session";
import { toast } from "@/lib/toast";

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Buat akun baru. Operator otomatis mendapat PIN kontrol yang ditampilkan sekali lewat onPin.
export function CreateUserDialog({ open, onClose, onCreated, onPin }: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  onPin: (user: AdminUser, pin: string) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Tambah akun" description="Akun hanya bisa dibuat oleh admin.">
      {open && <CreateForm onClose={onClose} onCreated={onCreated} onPin={onPin} />}
    </Dialog>
  );
}

function CreateForm({ onClose, onCreated, onPin }: { onClose: () => void; onCreated: () => void; onPin: (u: AdminUser, pin: string) => void }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.createUser({ username: username.trim().toLowerCase(), display_name: displayName.trim(), role, password });
      toast(`Akun ${res.user.username} dibuat`, "success");
      onCreated();
      onClose();
      if (res.pin) onPin(res.user, res.pin);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-1">
      <Field label="Nama tampilan" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60}
        hint="Tercatat di jejak audit setiap tindakan." />
      <Field label="Username" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={32}
        autoCapitalize="none" spellCheck={false} hint="3–32 karakter: huruf kecil, angka, titik, minus, garis bawah." />
      <div className="pb-4">
        <label htmlFor="new-role" className="mb-1.5 block text-[13px] font-semibold text-fg">Peran</label>
        <Select id="new-role" value={role} onChange={(e) => setRole(e.target.value as Role)} className="w-full">
          <option value="operator">Operator: memantau dan mengontrol relai (dengan PIN)</option>
          <option value="admin">Admin: mengelola akun dan data</option>
        </Select>
      </div>
      <Field label="Password awal" type="password" autoComplete="new-password" value={password}
        onChange={(e) => setPassword(e.target.value)} maxLength={200} error={error} hint="Minimal 8 karakter. Berikan ke pemilik akun." />
      <div className="flex justify-end gap-2 pt-2">
        <Button onClick={onClose}>Batal</Button>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? "Menyimpan..." : "Buat akun"}</Button>
      </div>
    </form>
  );
}

export function ResetPasswordDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  return (
    <Dialog open={!!user} onClose={onClose} title="Reset password" description={user ? `Akun ${user.username}. Sesi login lamanya dicabut.` : undefined}>
      {user && <ResetPasswordForm user={user} onClose={onClose} />}
    </Dialog>
  );
}

function ResetPasswordForm({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await adminApi.resetPassword(user.id, password);
      toast(`Password ${user.username} diganti`, "success");
      onClose();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <Field label="Password baru" type="password" autoComplete="new-password" autoFocus value={password}
        onChange={(e) => setPassword(e.target.value)} maxLength={200} error={error} hint="Minimal 8 karakter." />
      <div className="flex justify-end gap-2 pt-2">
        <Button onClick={onClose}>Batal</Button>
        <Button type="submit" variant="primary" disabled={busy}>Simpan</Button>
      </div>
    </form>
  );
}

// PIN hanya bisa dilihat sekali: server menyimpan hash-nya saja.
export function PinRevealDialog({ reveal, onClose }: { reveal: { user: AdminUser; pin: string } | null; onClose: () => void }) {
  return (
    <Dialog
      open={!!reveal}
      onClose={onClose}
      title="PIN kontrol operator"
      description={reveal ? `${reveal.user.display_name} (${reveal.user.username})` : undefined}
      footer={<Button variant="primary" onClick={onClose}>Sudah dicatat</Button>}
    >
      {reveal && (
        <>
          <p className="rounded-md bg-surface-2 py-4 text-center font-mono text-3xl font-semibold tracking-[0.4em] text-fg">
            {reveal.pin}
          </p>
          <p className="mt-3 text-[13px] text-fg-2">
            Berikan PIN ini langsung ke operator. PIN wajib diisi setiap menyalakan atau mematikan relai.
            <b> PIN tidak bisa dilihat lagi</b> setelah jendela ini ditutup. Bila lupa, reset PIN.
          </p>
        </>
      )}
    </Dialog>
  );
}

export function ConfirmDialog({ open, title, description, confirmLabel, onConfirm, onClose }: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      toast(errText(err), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={onClose}>Batal</Button>
          <Button variant="danger" disabled={busy} onClick={confirm}>{confirmLabel}</Button>
        </>
      }
    />
  );
}
