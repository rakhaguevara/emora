# PRD: EMORA — Electrical Energy Monitoring and Optimization for Risk Assessment

Sistem monitoring parameter kelistrikan dan mitigasi risiko berbasis IoT untuk meningkatkan keamanan dan efisiensi penggunaan energi.

Status: Draft v0.2 · 2026-10-15 · Sumber: proposal EMORA (Bidang Energi, Industrial Energy Efficiency Copilot, target TKT 3 → 4 dalam 6 bulan)

## 1. Latar belakang dan tujuan

Penyimpangan parameter listrik pada peralatan industri (mis. motor) dapat menandakan kondisi operasi tidak normal. Sistem monitoring IoT berbasis ESP32 + PZEM-004T sudah umum, tetapi umumnya berhenti pada menampilkan data dan pengendalian beban sederhana. EMORA menambahkan **penilaian risiko, rekomendasi tindakan, dan dua mode respons yang dapat dikonfigurasi** sesuai karakteristik peralatan dan SOP pengguna, serta evaluasi **feedback pengguna** atas respons sistem.

Aspek pembeda yang diusulkan (masih harus dibuktikan lewat pengujian dan perbandingan dengan sistem sejenis):
- Pemantauan parameter listrik + penilaian risiko + rekomendasi dalam satu sistem.
- Dua mode respons berbantuan ML (otomatis dan semi-otomatis).
- Loop feedback pengguna untuk memperbaiki rekomendasi berikutnya.

**Tujuan produk**
1. Menampilkan semua parameter sensor real-time di dashboard.
2. Mendeteksi anomali dan menghitung skor serta level risiko.
3. Mode semi-auto: memberi rekomendasi ON/OFF, pengguna memutuskan, sistem meminta feedback.
4. Mode auto: relay memutus beban saat kriteria pemutusan terpenuhi.
5. Menyimpan data sementara di Supabase untuk grafik riwayat, alert, dan bahan evaluasi.

**Bukan tujuan (saat ini)**
- Klaim kesiapan untuk motor atau panel industri. Pengujian awal memakai beban skala kecil (lampu) di laboratorium.
- Prediksi kerusakan berbasis model yang tervalidasi (pengembangan lanjutan).
- Multi-pengguna/organisasi, penagihan, prediksi biaya listrik.
- Penyimpanan data jangka panjang.

## 2. Pengguna

Operator/pemilik peralatan yang memantau satu atau beberapa perangkat EMORA dan menentukan respons berdasarkan SOP-nya. Skema mendukung banyak perangkat lewat `device_id`.

## 3. Prinsip keselamatan (mengikat seluruh desain)

1. **Proteksi tidak boleh bergantung pada cloud atau ML.** Ambang batas keselamatan keras (overcurrent, overvoltage, overheat, dst.) dievaluasi di ESP32 dan tetap bekerja saat internet putus. ML hanya memberi masukan tambahan; ia tidak menjadi satu-satunya dasar perlindungan.
2. Pemutusan otomatis hanya mengikuti kriteria yang ditetapkan dan divalidasi lewat pengujian.
3. Peralihan semi-auto → auto boleh **disarankan** sistem, tetapi keputusan ada pada pengguna.
4. Semua perintah relay dari jarak jauh wajib terautentikasi dan tercatat (`relay_commands`).
5. Perubahan perilaku relay di firmware (saat ini mode "NO-TRIP", relay selalu ON) harus diuji bertahap dengan beban lampu sebelum beban lain.

## 4. Arsitektur

```
ESP32 (EMORA)  ◄── perintah relay (MQTT command / polling) ──┐
  │ telemetri                                                  │
  ├─ MQTT ──► Broker ──┐                                       │
  └─ HTTPS POST ───────┤                                       │
                       ▼                                       │
         Backend (Fastify + TypeScript) ───────────────────────┘
         validasi · alert · risk scoring · rekomendasi
         antrian perintah · feedback · (kelak) layanan ML
                       │ service_role
                       ▼
               Supabase (Postgres + Realtime + Auth)
                       │ Realtime + query (anon/authenticated, read-only)
                       ▼
         Frontend (Next.js + Tailwind + Recharts)
         dashboard · kontrol mode & relay · feedback
```

| Lapisan | Pilihan | Alasan |
|---|---|---|
| Transport perangkat | MQTT (utama), HTTP POST (alternatif) | MQTT standar IoT dan dua arah (telemetri naik, perintah turun). HTTP lebih sederhana untuk prototipe. |
| Backend | Node.js + Fastify + TypeScript | Satu bahasa dengan frontend, ekosistem `mqtt` matang. Harus berjalan terus (memegang koneksi MQTT), bukan serverless. |
| ML | Fase lanjut: layanan Python terpisah (scikit-learn) dipanggil backend, atau model ringan di backend | Belum diputuskan; awalnya skor risiko berbasis aturan sebagai baseline pembanding ML. |
| Database | Supabase (Postgres) | Dipilih pengguna. Realtime bawaan untuk dashboard. |
| Frontend | Next.js (App Router) + Tailwind + Recharts | Standar React, cukup untuk time-series. |

Backend tetap diperlukan karena `service_role` key tidak boleh ada di perangkat, dan karena logika alert, risiko, perintah, serta autentikasi aksi pengguna harus terpusat.

## 5. Data dari perangkat

Kontrak payload telemetri (JSON), divalidasi di `apps/api/src/schema.ts`:

| Field | Tipe | Satuan | Sumber di EMORA.ino |
|---|---|---|---|
| `device_id` | string | – | konfigurasi firmware, mis. `emora-01` |
| `voltage` | number | V | `pzem.voltage()` |
| `current` | number | A | `pzem.current()` |
| `power` | number | W | `pzem.power()` |
| `energy_wh` | number | Wh | `pzem.energy() * 1000` |
| `frequency` | number | Hz | `pzem.frequency()` |
| `pf` | number | – | `pzem.pf()` |
| `temperature` | number \| null | °C | DHT22 (suhu udara sekitar, **bukan** suhu internal motor) |
| `humidity` | number \| null | % | DHT22 |
| `hourly_energy_wh` | number | Wh | `hourlyEnergyConsumed` |
| `relay_on` | boolean | – | status `RELAY_PIN` (active LOW) |
| `buzzer_on` | boolean | – | status `BUZZER_PIN` |

NaN dikirim sebagai `null`. Timestamp diberikan server. PZEM-004T yang dipakai adalah modul satu fase; rentang ukurnya mengikuti varian modul.

**MQTT:** telemetri `emora/<device_id>/telemetry` (QoS 1); perintah `emora/<device_id>/command`; ack `emora/<device_id>/ack`.
**HTTP:** `POST /ingest` dengan header `x-device-key`.
**Frekuensi kirim:** disarankan 5 detik (±17 ribu baris/hari). Pada 1 detik ±86 ribu baris/hari, lebih berat untuk free tier Supabase (500 MB) dengan retensi 7 hari.

## 6. Mode operasi

| | Semi-auto (default) | Auto |
|---|---|---|
| Relay | Hanya berubah atas perintah pengguna | Memutus beban saat kriteria pemutusan terpenuhi |
| Peran ML | Merekomendasikan ON/OFF dari parameter, skor risiko, dan riwayat feedback | Membantu menentukan kondisi yang perlu pemutusan dari pola parameter, riwayat pemutusan otomatis, dan feedback |
| Feedback | Setelah pengguna bertindak, sistem menanyakan apakah rekomendasi tadi sesuai | Setelah pemutusan otomatis, sistem menanyakan apakah pemutusan tadi sesuai |
| Peralihan mode | Sistem dapat menyarankan beralih ke auto; pengguna memutuskan | Pengguna dapat kembali ke semi-auto kapan saja |

Mode disimpan di `devices.mode` dan harus diketahui firmware (dikirim sebagai perintah/konfigurasi) agar keputusan pemutusan keras tetap lokal.

## 7. Penilaian risiko, alert, dan rekomendasi

**Alert** (ambang per perangkat di `devices.thresholds`, default sama dengan konstanta firmware):

| Tipe | Kondisi | Default |
|---|---|---|
| `undervoltage` / `overvoltage` | V < `volt_min` / V > `volt_max` | 180 / 245 V |
| `overcurrent` | I > `current_max` | 2.0 A |
| `overpower` | P > `power_max` | 50 W |
| `overheat` | suhu > `temp_max` | 45 °C |
| `frequency` | di luar `freq_min`–`freq_max` | 49–51 Hz |
| `power_factor` | PF < `pf_min` dan P > 5 W | 0.85 |
| `energy_hourly` | Wh jam berjalan > batas | 100 Wh |

Alert dibuka saat kondisi mulai dan ditutup saat normal (tidak berulang tiap detik). Sudah diimplementasikan di backend.

**Risiko:** skor 0–100 dan level `low/medium/high/critical` (`risk_assessments`), dengan `factors` yang menjelaskan kontribusi tiap parameter. Fase awal berbasis aturan (jarak parameter dari ambang, durasi, jumlah alert aktif); fase ML menambah skor dari model dengan `source = 'ml'`.

**Rekomendasi:** `relay_on`, `relay_off`, `switch_to_auto`, atau `none`, disertai alasan (`recommendations`). Status: `pending → executed | dismissed | expired`.

**Feedback:** `feedback.appropriate` (sesuai/tidak) + komentar opsional, terikat ke rekomendasi atau perintah. Data ini bahan evaluasi dan pelatihan ulang; manfaatnya harus dibuktikan dengan membandingkan rekomendasi sebelum dan sesudah feedback digunakan.

## 8. Kebutuhan fungsional

**Frontend** (desain: 5 layar referensi dari pengguna; lihat catatan di bawah tabel)
- F1. Kartu nilai terkini: tegangan, arus, daya, energi, frekuensi, PF, suhu, kelembapan.
- F2. Grafik real-time (5 menit – 24 jam) untuk parameter utama.
- F3. Konsumsi energi per jam (`readings_hourly`).
- F4. Alert aktif dan riwayat; skor/level risiko; status relay dan buzzer.
- F5. Indikator online/offline (`last_seen` > 30 detik = offline).
- F6. Pemilih mode auto/semi-auto.
- F7. Panel rekomendasi: tombol jalankan/abaikan, tombol ON/OFF manual, dialog feedback.
- F8. Saran peralihan ke mode auto dengan konfirmasi pengguna.
- F9. Halaman login.

**Backend**
- B1. Ingest MQTT dan HTTP dengan validasi (sudah ada).
- B2. Alert open/close (sudah ada).
- B3. Endpoint baca `latest`, `readings` (sudah ada).
- B4. Risk scoring berbasis aturan + simpan `risk_assessments`.
- B5. Pembuat rekomendasi (semi-auto) dan eksekusi pemutusan (auto) → `relay_commands`.
- B6. Endpoint terautentikasi: ubah mode, kirim perintah relay, jalankan/abaikan rekomendasi, kirim feedback.
- B7. Pengantaran perintah ke ESP32 (publish MQTT, atau endpoint polling bila tanpa broker) dan pencatatan ack.
- B8. Integrasi model ML (fase lanjut).

**Firmware**
- D1. WiFi + reconnect; publish telemetri (MQTT/HTTP).
- D2. Terima perintah relay dan mode; kirim ack.
- D3. Proteksi lokal tetap berjalan tanpa internet (prinsip keselamatan 1).
- D4. Menggantikan mode NO-TRIP dengan logika mode auto/semi-auto yang sudah diuji bertahap.

**Catatan desain UI (v0.2.1).** Referensi desain yang diterima memodelkan satu panel dengan beberapa **jalur** (cabang beban, masing-masing satu sensor PZEM-004T dan satu relai), bukan satu perangkat tunggal. Layar: Ringkasan/Detail Jalur, Peringatan & Kejadian, Energi & Efisiensi, Perangkat. Implikasinya:
- Skema database perlu tabel `channels` (jalur) dan `readings.channel_id`; skema saat ini masih satu perangkat per pembacaan. Perubahan ini belum dibuat.
- Desain belum menampilkan suhu/kelembapan DHT22 maupun pemilih mode auto/semi-auto dan panel rekomendasi ML dari proposal. Perlu diputuskan apakah ditambahkan.
- Desain memakai istilah *trip* (relai memutus otomatis), *debounce* per jalur, *akui* kejadian, dan perkiraan biaya (Rp). Tarif/kWh saat ini asumsi di `apps/web/src/lib/constants.ts`.
- Frontend sudah berjalan dengan data simulasi di browser; penyambungan ke backend/Supabase menunggu keputusan skema di atas.

**Pemutusan saat beban berlebih (v0.2.2).** Saat arus/daya melewati batas lebih dari waktu debounce, perilaku bergantung pada *mode pemutusan* per jalur (dapat diubah kapan saja):
- **Tanya setiap kali** (default): dialog meminta pengguna memilih *putus otomatis* atau *putus manual*, dengan opsi mengingat pilihan.
- **Otomatis**: relai diputus otomatis; pengguna diminta feedback sesudahnya.
- **Manual**: relai menunggu pengguna mematikannya; setelah itu muncul form feedback.
- **Pengaman (tidak dapat dimatikan)**: bila tidak ada keputusan dalam 30 detik, atau beban melewati 130% batas, sistem memutus sendiri (`cutSource = failsafe`). Sesuai prinsip keselamatan 1.
- **Feedback** (`Feedback` di `apps/web/src/lib/types.ts`): dampak (tidak ada/ringan/berat), ketepatan waktu, dugaan penyebab, catatan, plus konteks (nilai, batas, durasi). Tujuannya membandingkan dampak buruk pemutusan manual vs otomatis. Saat ini perbandingan berbasis aturan (`lib/ml.ts`, minimal 5 feedback per kelompok); model ML menggantikan fungsi `adviseCutMode`. Data dapat diekspor CSV untuk pelatihan.
- Pemetaan ke database: tabel `feedback` perlu kolom dampak/waktu/penyebab/konteks; `relay_commands.source` perlu nilai `failsafe`; `devices`/`channels` perlu kolom `cut_mode`. Belum dimigrasi.
- Alat demo "Simulasikan beban berlebih" memicu lonjakan arus 120% selama 90 detik; hanya ada karena data masih simulasi.

## 9. Kebutuhan non-fungsional

- **Latensi:** data tampil ≤ 3 detik; perintah relay sampai ke perangkat ≤ 3 detik saat online.
- **Keamanan:** `service_role` hanya di backend; ESP32 memakai `INGEST_API_KEY`/kredensial MQTT; frontend memakai `anon`/`authenticated` read-only dengan RLS; aksi tulis (mode, relay, feedback) hanya lewat backend yang memverifikasi login. Policy baca saat ini terbuka untuk `anon` (hanya untuk pengembangan); **login wajib sebelum kontrol relay dari dashboard diaktifkan**.
- **Retensi:** data mentah dihapus setelah 7 hari (`purge_old_readings(7)`, dijadwalkan di Supabase Cron). Tabel `feedback`, `recommendations`, dan `relay_commands` perlu retensi lebih panjang karena menjadi bahan evaluasi ML; pastikan ukurannya kecil dibanding `readings`.
- **Ketahanan:** firmware tetap melindungi tanpa internet; dashboard tetap berfungsi bila satu transport mati.

## 10. Rencana pengujian dan indikator keberhasilan (TKT 4, laboratorium)

Beban skala kecil (lampu). Skenario minimal: akurasi pembacaan vs alat ukur referensi; pengiriman dan tampilan data di dashboard; aktivasi peringatan dan buzzer; respons relay (kedua mode); latensi perintah; perilaku saat internet putus; skenario anomali (tegangan, arus, PF) pada kedua mode; evaluasi rekomendasi dan penggunaan feedback.

Metrik yang diusulkan (angka target ditetapkan bersama tim): galat pengukuran relatif terhadap alat referensi, latensi end-to-end, persentase paket telemetri yang tersimpan, waktu respons relay, proporsi rekomendasi yang dinilai "sesuai" sebelum vs sesudah feedback diterapkan.

Hasil beban kecil belum membuktikan kesiapan untuk motor atau panel industri; itu memerlukan pengujian lanjutan, verifikasi akurasi, dan evaluasi keselamatan serta kesesuaian SOP.

## 11. Struktur repositori

```
Sistem-elect-main/
├── PZEM004Tv30 2/        firmware ESP32 (EMORA.ino + library)
├── apps/
│   ├── api/              backend Fastify
│   └── web/              frontend Next.js (tempat desain dashboard)
├── supabase/migrations/  skema database
└── docs/PRD.md
```

## 12. Pertanyaan terbuka

1. **Broker MQTT:** HiveMQ Cloud, Mosquitto lokal, atau HTTP polling dulu? Perintah relay turun ke perangkat lebih mudah dengan MQTT.
2. **Kriteria pemutusan mode auto:** apa saja kondisi yang memicu relay memutus (ambang apa, berapa lama), dan siapa yang menetapkannya? Perlu ditentukan sebelum D4 dikerjakan.
3. **ML:** data latih dari mana (data lab sendiri atau dataset publik)? Algoritma apa? Dijalankan di mana?
4. **Login:** Supabase Auth dengan email atau provider lain? Satu akun atau beberapa peran?
5. **Hosting:** frontend (Vercel?) dan backend (Railway/Fly.io/VPS?).
6. **Notifikasi** di luar dashboard (Telegram/email) saat alert kritis: perlu atau tidak?
7. **Jumlah perangkat:** satu prototipe atau lebih?

## 13. Tahapan

| Fase | Isi | Status |
|---|---|---|
| 0 | PRD, scaffold frontend/backend, skema Supabase, ingest + alert, simulator | Selesai |
| 1 | Buat project Supabase, jalankan migration, isi `.env`, uji dengan simulator | Menunggu pengguna |
| 2 | Implementasi desain dashboard (data simulasi di browser) | Selesai; belum tersambung ke backend |
| 3 | Backend: risk scoring, rekomendasi, perintah relay, login, endpoint mode/feedback | Belum mulai |
| 4 | Firmware: WiFi, telemetri, terima perintah, proteksi lokal, mode auto/semi-auto | Belum mulai |
| 5 | Model ML (rekomendasi + saran pemutusan) dan evaluasi feedback | Belum mulai |
| 6 | Pengujian lab TKT 4, retensi terjadwal, deploy | Belum mulai |
