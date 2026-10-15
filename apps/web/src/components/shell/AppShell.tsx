import type { ReactNode } from "react";
import { FeedbackHost } from "@/components/overload/FeedbackDialog";
import { OverloadHost } from "@/components/overload/OverloadHost";
import { ToastHost } from "@/components/ui/ToastHost";
import { BottomNav } from "./BottomNav";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen lg:pl-[236px]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[236px] border-r border-line lg:block">
        <Sidebar />
      </aside>

      <div className="flex min-h-screen min-w-0 flex-col">
        <Topbar />
        <OverloadHost />
        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-5 pb-24 sm:px-6 sm:py-6 lg:pb-6">{children}</main>
      </div>

      <BottomNav />
      <FeedbackHost />
      <ToastHost />
    </div>
  );
}
