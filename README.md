# EMORA — Energy Copilot

Monitoring dan manajemen energi listrik: **ESP32 + PZEM-004T + DHT22 → backend → Supabase → dashboard web**.
Rencana produk lengkap: [docs/PRD.md](docs/PRD.md).

Panduan ini berisi langkah manual dari awal sampai akhir: menyiapkan komputer, database, backend, merakit hardware,
flash ESP32, sampai memastikan data masuk. Ikuti berurutan.

## Status saat ini (baca dulu)

| Bagian | Status |
|---|---|
| Dashboard (`apps/web`) | UI lengkap dan responsive, tetapi **datanya simulasi di browser**. Belum membaca data dari ESP32 atau Supabase. |
| Backend (`apps/api`) | Menerima data ESP32 lewat `POST /ingest`, menyimpan ke Supabase, membuat alert. Logikanya diuji dengan Supabase **tiruan**, belum dengan Supabase asli. |
| Firmware (`firmware/EMORA_FINAL`) | Satu file `.ino`: baca sensor, alarm lokal, kirim data lewat WiFi. **Belum pernah dikompilasi dengan toolchain ESP32 atau dijalankan di ESP32.** Sintaksnya dicek di komputer dengan stub dan pembuat JSON-nya diuji. |
| Kontrol relai dari dashboard | **Belum ada.** Relai selalu ON, tidak ada pemutusan otomatis dan tidak ada perintah dari dashboard. |
| Dashboard ↔ Supabase | **Belum tersambung.** Dashboard memakai model "banyak jalur" yang belum ada di skema database. |

Artinya, setelah semua langkah di bawah selesai, **data dari ESP32 sampai ke tabel Supabase** (kamu lihat di Table Editor),
tetapi **belum tampil di dashboard**. Dashboard tetap bisa dicoba dengan data simulasi (langkah 2).

## Isi repositori

| Folder | Isi |
|---|---|
| `firmware/EMORA_FINAL/` | **Firmware final satu file (`EMORA_FINAL.ino`). Ini yang di-flash ke ESP32.** |
| `firmware/EMORA_IoT/` | Versi lama yang sama isinya tetapi terpecah jadi 3 file. Tidak perlu dipakai. |
| `PZEM004Tv30 2/` | Firmware asli (`EMORA.ino`): hanya Serial Monitor, tanpa WiFi. Tidak diubah. |
| `apps/api/` | Backend Fastify + TypeScript |
| `apps/web/` | Dashboard Next.js |
| `supabase/migrations/` | Skema database |

## Alur data

```
PZEM-004T + DHT22 → ESP32 ──WiFi/HTTP POST──▶ Backend (apps/api) ──▶ Supabase (tabel readings, alerts)
                                                                              │ (belum tersambung)
                                                                              ▼
                                                                   Dashboard (apps/web, data simulasi)
```

## Yang perlu disiapkan

**Perangkat keras:** ESP32 (dengan kabel USB data), modul PZEM-004T v3.0 beserta trafo arus (CT) bawaannya, DHT22,
modul relai, buzzer, kabel jumper, dan beban uji kecil (mis. lampu).

**Komputer (macOS/Windows/Linux):**
- [Node.js](https://nodejs.org) versi 20 atau lebih baru (cek: `node -v`)
- [Arduino IDE 2](https://www.arduino.cc/en/software)
- Akun [Supabase](https://supabase.com) (gratis)
- Laptop dan ESP32 terhubung ke **WiFi yang sama**, **2,4 GHz**

---

## 1. Pasang dependensi

Di folder utama repositori:

```bash
npm install
```

Kalau muncul error `Invalid Version`, hapus `node_modules` dan `package-lock.json` di folder utama serta di `apps/web` dan `apps/api`, lalu jalankan `npm install` lagi.

## 2. Coba dashboard tanpa hardware

```bash
npm run dev:web        # buka http://localhost:3000
```

Semua halaman dan aksi (relai, ambang, feedback, simulasi beban berlebih) bekerja pada data simulasi di browser.
Menu avatar (kanan atas) → "Setel ulang data demo" mengembalikan keadaan awal. Hentikan dengan `Ctrl+C`.

## 3. Siapkan Supabase

1. Buat project baru di [supabase.com](https://supabase.com). Tunggu sampai selesai disiapkan.
2. Buka **SQL Editor** → **New query**, tempel seluruh isi
   [supabase/migrations/20261014000000_init.sql](supabase/migrations/20261014000000_init.sql), lalu klik **Run**.
   Harus tampil "Success".
3. Buka **Table Editor**. Tabel `devices` harus berisi satu baris `emora-01`. Kalau tabelnya tidak ada, migration gagal dijalankan.
4. Buka **Project Settings → API**, catat:
   - **Project URL** (`https://xxxx.supabase.co`)
   - **service_role key** atau **secret key**: **rahasia, hanya untuk backend.** Jangan taruh di firmware, dashboard, atau chat.

Kunci untuk dashboard (nanti, bila dashboard disambungkan) ada di file `apps/web/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxx
```

Contohnya ada di `apps/web/.env.example`. Kunci *publishable* memang boleh dipakai di browser (akses dibatasi RLS).
**Saat ini dashboard belum membaca file ini**, jadi mengisinya belum mengubah tampilan.

## 4. Jalankan backend

```bash
cp apps/api/.env.example apps/api/.env
```

Isi `apps/api/.env`:

```env
PORT=4000
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role / secret key dari langkah 3>
INGEST_API_KEY=<string acak, buat dengan: openssl rand -hex 16>
```

Biarkan `MQTT_URL` kosong (MQTT nonaktif; firmware memakai HTTP). Simpan `INGEST_API_KEY`: nilainya sama
dengan `DEVICE_KEY` di firmware. Lalu jalankan:

```bash
npm run dev:api        # http://localhost:4000
```

Biarkan terminal ini tetap terbuka selama ESP32 dipakai. Uji tanpa ESP32:

```bash
curl http://localhost:4000/health        # -> {"ok":true}

curl -i -X POST http://localhost:4000/ingest \
  -H 'content-type: application/json' -H 'x-device-key: <INGEST_API_KEY>' \
  -d '{"device_id":"emora-01","voltage":220.1,"current":0.15,"power":30,"energy_wh":1000,"frequency":50,"pf":0.92,"temperature":31.5,"humidity":60}'
```

Hasil yang benar: `HTTP/1.1 202`, dan di Supabase **Table Editor → readings** ada satu baris baru.
Untuk data berkelanjutan tanpa hardware: `npm run simulate` di terminal lain.

| Kode | Arti |
|---|---|
| 202 | Berhasil disimpan |
| 401 | `x-device-key` tidak sama dengan `INGEST_API_KEY` |
| 404 | `device_id` belum ada di tabel `devices` |
| 400 | Format data salah |

**Jangan lanjut ke ESP32 sebelum curl di atas menghasilkan 202.** Kalau ini gagal, ESP32 juga akan gagal.

## 5. Rakit hardware

> **BAHAYA: PZEM-004T mengukur listrik PLN (220 V AC).** Kesalahan wiring dapat menyebabkan sengatan listrik,
> korsleting, atau kebakaran. Rakit dan uji dengan listrik **mati**, gunakan beban kecil (mis. lampu) dahulu,
> dan minta orang yang berpengalaman memeriksa wiring sebelum dinyalakan. Jangan sentuh bagian bertegangan saat menyala.
> Pastikan relai dan kabel mampu menahan arus beban.

| Komponen | Pin ESP32 | Keterangan |
|---|---|---|
| PZEM-004T (data) | GPIO16 (RX2), GPIO17 (TX2) | Sambung silang: RX ESP32 ke TX PZEM, TX ESP32 ke RX PZEM |
| PZEM-004T (catu) | 5V dan GND | Modul butuh 5 V. Periksa datasheet modul untuk level sinyal |
| DHT22 | GPIO14 | Data suhu/kelembapan (+ VCC 3,3 V dan GND) |
| Relai | GPIO26 | **Active LOW**: LOW = ON. Firmware menyalakan relai saat start |
| Buzzer | GPIO27 | HIGH = bunyi saat ada anomali |

Pada tahap awal, pasang hanya sisi sinyal dulu (ESP32 + sensor lewat USB, sisi PLN belum disambung).
Sisi PLN disambung terakhir, setelah wiring diperiksa.

## 6. Flash firmware ke ESP32

1. Buka **Arduino IDE 2**.
2. **Boards Manager** → cari `esp32` oleh *Espressif Systems* → **Install**.
3. **Library Manager** → install:
   - `PZEM004Tv30` (oleh mandulaj)
   - `DHT sensor library` (oleh Adafruit)
   - `Adafruit Unified Sensor` (jika diminta)
4. **File → Open** → `firmware/EMORA_FINAL/EMORA_FINAL.ino` (satu file, tidak perlu file lain).
5. Di blok **PENGATURAN** di bagian atas file, isi lima nilai:

   ```cpp
   #define WIFI_SSID      "nama-wifi"
   #define WIFI_PASSWORD  "password-wifi"
   #define API_URL        "http://192.168.1.10:4000/ingest"   // IP laptop, BUKAN localhost
   #define DEVICE_KEY     "<sama dengan INGEST_API_KEY>"
   #define DEVICE_ID      "emora-01"                           // sama dengan kolom id di tabel devices
   ```

   Cari IP laptop: macOS `ipconfig getifaddr en0`, Windows `ipconfig` (IPv4 Address), Linux `hostname -I`.
   Setelah diisi, file ini berisi password dan kunci: **jangan di-commit atau dibagikan.**
6. Colok ESP32 ke laptop dengan kabel USB **data** (bukan kabel khusus charger).
7. **Tools → Board → esp32** → pilih `ESP32 Dev Module` (sesuaikan dengan boardmu). **Tools → Port** → pilih port ESP32.
   Kalau port tidak muncul, pasang driver CP210x atau CH340 sesuai chip di boardmu.
8. Klik **Upload** (tanda panah →). Bila macet di "Connecting…", tahan tombol **BOOT** di ESP32 sampai upload mulai.
9. **Tools → Serial Monitor**, atur **115200 baud**. Tekan tombol **EN/RST** di ESP32 bila layar kosong.

Keluaran yang diharapkan:

```
==================================================
 EMORA - MONITORING & MANAJEMEN ENERGI (IoT)
 Status Relay: ON (Daya Terhubung ke Beban)
 Device: emora-01
==================================================
[NET] Menghubungkan ke WiFi nama-wifi
[NET] WiFi terhubung, IP 192.168.1.25, sinyal -58 dBm
V: 220.1 V | I: 0.153 A | P: 30.2 W | Freq: 50.0 Hz | E: 1000.0 Wh | PF: 0.92 | Temp: 31.5 C | Status: NORMAL
[NET] Data terkirim
```

## 7. Pastikan data masuk (urut dari ESP32 ke database)

1. Serial Monitor menampilkan `[NET] Data terkirim` setiap 5 detik.
2. Terminal backend mencatat `POST /ingest` dengan status 202.
3. Supabase **Table Editor → readings** bertambah baris baru, kolom `ts` terus maju.
4. `curl http://localhost:4000/api/devices/emora-01/latest` mengembalikan pembacaan terakhir.
5. Pancing anomali (mis. turunkan `POWER_MAX` di firmware, upload ulang): buzzer berbunyi dan tabel `alerts` terisi.

Kalau kelima langkah berhasil, rantai ESP32 → backend → Supabase sudah aktif.

## Pemecahan masalah

| Gejala | Penyebab dan solusi |
|---|---|
| Upload gagal / "Connecting…" terus | Tahan tombol BOOT saat upload mulai. Coba kabel USB lain (harus kabel data) dan pilih port yang benar. |
| Port tidak muncul | Pasang driver CP210x / CH340. |
| `[NET] Gagal kirim, kode: -1` | ESP32 tidak sampai ke backend. Cek IP di `API_URL`, backend sedang jalan, WiFi sama. Di macOS izinkan koneksi masuk untuk Node saat firewall bertanya. |
| Kode `401` | `DEVICE_KEY` berbeda dengan `INGEST_API_KEY`. Salin ulang tanpa spasi. |
| Kode `404` | `DEVICE_ID` belum ada di tabel `devices`. Tambahkan barisnya, atau samakan dengan `emora-01`. |
| Kode `400` | Format data ditolak backend. Lihat log terminal backend. |
| Tidak pernah terhubung WiFi | SSID/password salah, atau WiFi 5 GHz. Gunakan 2,4 GHz. |
| `Gagal membaca data dari sensor PZEM-004T!` | Wiring RX/TX PZEM tertukar, catu 5 V modul, atau modul belum teraliri listrik PLN. **Selama ini terjadi, tidak ada data yang dikirim ke backend.** |
| Suhu/kelembapan `null` di database | DHT22 gagal dibaca (wiring/pin 14). Data lain tetap dikirim. |
| IP laptop berubah | Router memberi IP baru. Perbarui `API_URL`, upload ulang. Atur IP statis/reservasi di router agar tetap. |
| Backend gagal start | `apps/api/.env` belum diisi atau salah. Cek `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY`. |
| `PGRST205 ... table not found` | Migration (langkah 3) belum dijalankan di project Supabase yang sama dengan `SUPABASE_URL`. |

## Catatan keselamatan dan keamanan

- Firmware **tidak mengubah logika proteksi**: ambang batas, buzzer, dan relai sama dengan `EMORA.ino`, dan berjalan
  tanpa internet. Pengiriman data berjalan di task terpisah sehingga WiFi yang lambat tidak menunda alarm.
- Relai pada firmware ini selalu menyala dan **tidak ada pemutusan otomatis** atau perintah jarak jauh. Fitur mode
  otomatis/manual di dashboard belum terhubung ke firmware. Jangan andalkan sistem ini sebagai pengaman beban.
- `API_URL` berawalan `http://` mengirim data tanpa enkripsi (cukup untuk jaringan rumah/lab). Untuk backend online
  pakai `https://`. Firmware saat ini memakai `setInsecure()` pada HTTPS (tidak memeriksa sertifikat server); ganti
  dengan sertifikat root sebelum dipakai sungguhan.
- `apps/api/.env` dan `apps/web/.env.local` sudah di `.gitignore`. `EMORA_FINAL.ino` **tidak**: jangan commit setelah diisi
  password WiFi dan `DEVICE_KEY`.
- `service_role` / secret key hanya untuk backend. Kalau pernah terlanjur dibagikan, buat ulang di Supabase.
- Backend harus selalu menyala dan bisa dijangkau ESP32. Untuk pemakaian nyata, deploy ke layanan hosting (bukan laptop).

## Yang belum dikerjakan

1. **Skema multi-jalur**: dashboard memodelkan satu panel dengan banyak jalur (tiap jalur satu PZEM + relai), sedangkan
   tabel sekarang satu perangkat per pembacaan. Perlu tabel `channels` dan kolom `channel_id` di `readings`.
   Firmware pun perlu membaca beberapa PZEM bila memang banyak jalur.
2. **Sambungkan dashboard ke Supabase** (ganti `apps/web/src/lib/store.ts`).
3. **Kontrol relai dari dashboard**: perintah turun ke ESP32, mode otomatis/manual, feedback ke ML. Keputusan pemutusan
   harus tetap di ESP32 (failsafe lokal bila WiFi putus).
4. **Status sensor**: kirim data berkala dengan penanda `sensor_ok=false` saat PZEM gagal dibaca, supaya dashboard bisa
   membedakan "perangkat mati" dari "sensor bermasalah".
5. **Login** sebelum kontrol relai diaktifkan.
6. Uji firmware pada hardware sungguhan, lalu perbaiki bila perlu.
