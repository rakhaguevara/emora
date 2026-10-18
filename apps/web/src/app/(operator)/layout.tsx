import type { ReactNode } from "react";
import { RequireRole } from "@/components/auth/RequireRole";
import { OperatorShell } from "@/components/shell/OperatorShell";

// Halaman operator: pemantauan, kontrol relai (dengan PIN), respons anomali, feedback.
export default function OperatorLayout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role="operator">
      <OperatorShell>{children}</OperatorShell>
    </RequireRole>
  );
}
