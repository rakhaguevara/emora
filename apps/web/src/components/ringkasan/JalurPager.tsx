"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useMedia } from "@/lib/useMedia";

// Kartu jalur dibagi per halaman: 3 per halaman di HP, 6 di layar ≥768px (2 baris × 3 kolom di laptop).
// Halaman berikutnya bisa digeser (sentuh) atau dipindah dengan tombol panah.
export function JalurPager<T>({ items, render }: { items: T[]; render: (item: T) => ReactNode }) {
  const roomy = useMedia("(min-width: 768px)");
  const size = roomy ? 6 : 3;
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  const n = pages.length;

  const ref = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const current = Math.min(page, n - 1);

  // Ukuran halaman berubah (rotasi layar, resize) atau jumlah jalur berkurang: kembali ke awal.
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTo({ left: 0 }); // memicu onScroll yang mengatur ulang nomor halaman
  }, [size]);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (el && el.clientWidth) setPage(Math.round(el.scrollLeft / el.clientWidth));
  }, []);

  const go = (i: number) => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: i * el.clientWidth, behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <div>
      {n > 1 && (
        <div className="mb-3 flex items-center justify-end gap-2">
          <span className="mr-1 text-[13px] text-fg-3 tabular-nums" aria-live="polite">
            Halaman {current + 1} dari {n}
          </span>
          <button
            type="button" aria-label="Halaman sebelumnya" disabled={current === 0} onClick={() => go(current - 1)}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-line-strong bg-surface text-fg-2 enabled:hover:bg-surface-2 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button" aria-label="Halaman berikutnya" disabled={current === n - 1} onClick={() => go(current + 1)}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-line-strong bg-surface text-fg-2 enabled:hover:bg-surface-2 disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
      <div
        ref={ref}
        onScroll={onScroll}
        className="-mx-1 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {pages.map((group, i) => (
          <div
            key={i}
            role="group"
            aria-label={`Halaman ${i + 1} dari ${n}`}
            className={cn(
              "grid w-full shrink-0 snap-center content-start gap-4 p-1 md:grid-cols-2 xl:grid-cols-3",
            )}
          >
            {group.map((item) => render(item))}
          </div>
        ))}
      </div>
    </div>
  );
}
