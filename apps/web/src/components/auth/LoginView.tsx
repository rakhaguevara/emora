"use client";

import { Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { login, loginDemo } from "@/lib/auth/actions";
import { roleHome, useSession, type Role } from "@/lib/auth/session";
import { LIVE_ENABLED } from "@/lib/live/sync";

// Halaman masuk. Tidak ada pendaftaran: akun dibuat admin. Mode demo (tanpa Supabase) masuk tanpa password.
export function LoginView() {
  const session = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session && (!LIVE_ENABLED || session.token)) router.replace(roleHome(session.user.role));
  }, [session, router]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-solid text-white">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[19px] leading-6 font-bold tracking-[0.08em] text-fg">EMORA</p>
            <p className="text-[13px] text-fg-3">Energy Copilot</p>
          </div>
        </div>
        <section className="rounded-lg border border-line bg-surface p-6">
          <h1 className="text-xl font-semibold text-fg">Masuk</h1>
          {LIVE_ENABLED ? <PasswordForm /> : <DemoLogin />}
        </section>
        <p className="mt-4 text-center text-xs text-fg-3">Belum punya akun? Minta admin untuk membuatkan.</p>
      </div>
    </main>
  );
}

function PasswordForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return setError("Isi username dan password");
    setBusy(true);
    setError(null);
    try {
      const user = await login(username.trim().toLowerCase(), password);
      router.replace(roleHome(user.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="mt-5 space-y-1">
      <Field label="Username" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus
        value={username} onChange={(e) => setUsername(e.target.value)} maxLength={32} />
      <Field label="Password" type="password" autoComplete="current-password"
        value={password} onChange={(e) => setPassword(e.target.value)} maxLength={200} error={error} />
      <Button type="submit" variant="primary" className="mt-2 w-full" disabled={busy}>
        {busy ? "Memeriksa..." : "Masuk"}
      </Button>
    </form>
  );
}

function DemoLogin() {
  const router = useRouter();
  const enter = (role: Role) => router.replace(roleHome(loginDemo(role).role));
  return (
    <div className="mt-3">
      <p className="text-[13px] text-fg-3">
        Mode demo: data simulasi, tanpa backend. Isi kunci Supabase di <code>apps/web/.env.local</code> untuk login sungguhan.
      </p>
      <div className="mt-5 grid gap-2">
        <Button variant="primary" onClick={() => enter("operator")}>Masuk demo sebagai Operator</Button>
        <Button onClick={() => enter("admin")}>Masuk demo sebagai Admin</Button>
      </div>
    </div>
  );
}
