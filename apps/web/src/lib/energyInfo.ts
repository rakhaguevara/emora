import { getTips, type DailyTip } from "./live/energy";
import { getTariff, LIVE_ENABLED } from "./live/sync";
import { DEFAULT_TARIFF, type Tariff } from "./tariff";

// Tarif dan rekomendasi harian untuk komponen. Mode live: dari Supabase (diatur admin). Mode demo: bawaan.
// Komponen dirender ulang tiap ada data baru (useApp/useLive), jadi cukup dibaca saat render.
export const currentTariff = (): Tariff => (LIVE_ENABLED ? getTariff() : DEFAULT_TARIFF);
export const allTips = (): DailyTip[] => (LIVE_ENABLED ? getTips() : []);
export const tipsForDay = (day: string): DailyTip[] => allTips().filter((t) => t.day === day);
export type { DailyTip };
