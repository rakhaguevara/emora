import { Bell, LayoutGrid, Smartphone, Zap } from "lucide-react";

export const NAV = [
  { href: "/", label: "Ringkasan", short: "Ringkasan", icon: LayoutGrid, match: (p: string) => p === "/" || p.startsWith("/jalur") },
  { href: "/peringatan", label: "Peringatan & Kejadian", short: "Peringatan", icon: Bell, match: (p: string) => p.startsWith("/peringatan") },
  { href: "/energi", label: "Energi & Efisiensi", short: "Energi", icon: Zap, match: (p: string) => p.startsWith("/energi") },
  { href: "/perangkat", label: "Perangkat", short: "Perangkat", icon: Smartphone, match: (p: string) => p.startsWith("/perangkat") },
];
