import { cn } from "@/lib/cn";

// Radar status panel: hijau = tidak ada anomali, merah = ada jalur peringatan/trip.
// Warna ikut currentColor; animasi di globals.css (.radar-*), dimatikan saat reduced-motion.
export function Radar({ alert, className }: { alert: boolean; className?: string }) {
  return (
    <span
      role="img"
      aria-label={alert ? "Radar merah: ada anomali" : "Radar hijau: semua aman"}
      className={cn("radar", alert ? "radar-alert text-danger-solid" : "text-success", className)}
    >
      <span aria-hidden className="radar-ring" />
      <span aria-hidden className="radar-ring radar-ring-2" />
      <span aria-hidden className="radar-sweep" />
      <span aria-hidden className="radar-ripple" />
      <span aria-hidden className="radar-ripple radar-ripple-2" />
      <span aria-hidden className="radar-dot" />
    </span>
  );
}
