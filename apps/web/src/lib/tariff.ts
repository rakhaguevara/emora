// Tarif listrik untuk perhitungan biaya. Mode live: diatur admin (tabel devices). Mode demo: DEFAULT_TARIFF.
export interface Tariff {
  cls: string; // golongan, mis. "R-1/1.300 VA"
  perKwh: number; // Rp/kWh sebelum pajak
  taxPct: number; // PPJ / pajak daerah, persen
}

// Acuan tarif tenaga listrik PLN non-subsidi (berlaku sejak 2024, belum berubah per rilis terakhir yang
// kami ketahui). Admin wajib mencocokkan dengan tagihan/token: tarif bisa berubah tiap triwulan.
export const TARIFF_PRESETS: { cls: string; perKwh: number }[] = [
  { cls: "R-1/900 VA (subsidi)", perKwh: 605 },
  { cls: "R-1/900 VA (non-subsidi)", perKwh: 1352 },
  { cls: "R-1/1.300 VA", perKwh: 1444.7 },
  { cls: "R-1/2.200 VA", perKwh: 1444.7 },
  { cls: "R-2/3.500–5.500 VA", perKwh: 1699.53 },
  { cls: "R-3/6.600 VA ke atas", perKwh: 1699.53 },
  { cls: "B-2/6.600 VA–200 kVA", perKwh: 1444.7 },
  { cls: "P-1/6.600 VA–200 kVA", perKwh: 1699.53 },
];

export const DEFAULT_TARIFF: Tariff = { cls: "R-1/1.300 VA", perKwh: 1444.7, taxPct: 0 };

// Biaya termasuk pajak
export const costRp = (kwh: number, t: Tariff) => kwh * t.perKwh * (1 + t.taxPct / 100);

// Tarif efektif per kWh (termasuk pajak)
export const effectivePerKwh = (t: Tariff) => t.perKwh * (1 + t.taxPct / 100);
