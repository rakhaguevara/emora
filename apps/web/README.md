# EMORA Web

Dashboard Next.js (App Router) + Tailwind + Recharts. Bahasa Indonesia, zona waktu WIB.

```bash
npm run dev:web   # dari root repo, http://localhost:3000
```

## Halaman
| Rute | Isi |
|---|---|
| `/` | Ringkasan: kartu total, daftar jalur, relai, daya total 24 jam |
| `/jalur/[nomor]` | Detail jalur: pembacaan, grafik riwayat, kontrol relai, ambang |
| `/peringatan` | Riwayat kejadian, filter, akui, ekspor CSV |
| `/energi` | Konsumsi 30 hari, porsi per jalur, faktor daya, rekomendasi |
| `/perangkat` | Kesehatan panel dan sensor, tambah/ubah/hapus jalur |

## Data
Saat ini seluruh data berasal dari simulasi di browser (`src/lib/sim`), disimpan di localStorage
(`src/lib/store.ts`). Semua tindakan (relai, ambang, akui, tambah jalur) bekerja terhadap state itu.
Menu avatar → "Setel ulang data demo" mengembalikan keadaan awal.

Saat backend siap, ganti `store.ts` dengan pemanggilan API/Supabase; komponen hanya memakai
`useApp()`, `useLive()`, dan `actions`.
