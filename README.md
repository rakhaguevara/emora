# EMORA — Energy Copilot

Monitoring dan manajemen energi listrik: **ESP32 + PZEM-004T + DHT22 → backend → Supabase → dashboard web**.
Rencana produk lengkap: [docs/PRD.md](docs/PRD.md).

## Status saat ini (baca dulu)

| Bagian | Status |
|---|---|
| Dashboard (`apps/web`) | UI lengkap dan responsive, tetapi **datanya simulasi di browser**. Belum membaca data dari ESP32 atau Supabase. |
| Backend (`apps/api`) | Menerima data dari ESP32 lewat `POST /ingest`, menyimpan ke Supabase, dan membuat alert. Logikanya sudah diuji dengan Supabase **tiruan**, belum dengan Supabase asli. |
| Firmware IoT (`firmware/EMORA_IoT`) | Sudah ditulis (WiFi + kirim data). **Belum pernah dikompilasi atau dijalankan di ESP32.** Pembuat JSON-nya sudah diuji di komputer. |
| Dashboard ↔ Supabase | **Belum tersambung.** Dashboard memakai model "banyak jalur" yang belum ada di skema database (lihat bagian terakhir). |

Artinya, setelah mengikuti panduan ini **data dari ESP32 sampai ke tabel Supabase** (bisa kamu lihat di Table Editor),
tetapi **belum tampil di dashboard**. Penghubung dashboard ke Supabase adalah langkah pengembangan berikutnya.

## Isi repositori

| Folder | Isi |
|---|---|
| `PZEM004Tv30 2/` | Firmware asli (`EMORA.ino`): hanya Serial Monitor, tanpa WiFi. Tidak diubah. |
| `firmware/EMORA_IoT/` | Firmware yang mengirim data ke backend. **Ini yang di-flash ke ESP32.** |
| `apps/api/` | Backend Fastify + TypeScript |
| `apps/web/` | Dashboard Next.js |
| `supabase/migrations/` | Skema database |

---

## 1. Coba dashboard tanpa hardware

```bash
npm install
npm run dev:web        # buka http://localhost:3000
```

Semua halaman dan aksi (relai, ambang, feedback, simulasi beban berlebih) bekerja pada data simulasi.
Menu avatar → "Setel ulang data demo" mengembalikan keadaan awal.

## 2. Siapkan Supabase

1. Buat project di [supabase.com](https://supabase.com).
2. Buka **SQL Editor**, tempel seluruh isi [supabase/migrations/20261014000000_init.sql](supabase/migrations/20261014000000_init.sql), lalu **Run**.
3. Pastikan tabel `devices` berisi satu baris `emora-01` (dibuat oleh migration).
4. Buka **Project Settings → API**, catat:
   - **Project URL**
   - **service_role key** (rahasia, hanya untuk backend. Jangan taruh di firmware atau dashboard).

## 3. Jalankan backend

```bash
cp apps/api/.env.example apps/api/.env
```

Isi `apps/api/.env`:

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
INGEST_API_KEY=<string acak, buat dengan: openssl rand -hex 16>
PORT=4000
```

Biarkan `MQTT_URL` kosong (MQTT dinonaktifkan; firmware memakai HTTP). Lalu:

```bash
npm run dev:api        # http://localhost:4000
```

Uji tanpa ESP32, kirim satu data palsu:

```bash
curl -i -X POST http://localhost:4000/ingest \
  -H 'content-type: application/json' -H 'x-device-key: <INGEST_API_KEY>' \
  -d '{"device_id":"emora-01","voltage":220.1,"current":0.15,"power":30,"energy_wh":1000,"frequency":50,"pf":0.92,"temperature":31.5,"humidity":60}'
```

Hasil yang benar: `HTTP/1.1 202`. Cek di Supabase **Table Editor → readings**: ada satu baris baru.
Untuk data berkelanjutan: `npm run simulate` (butuh `INGEST_API_KEY` di `.env`).

| Kode | Arti |
|---|---|
| 202 | Berhasil disimpan |
| 401 | `x-device-key` tidak sama dengan `INGEST_API_KEY` |
| 404 | `device_id` belum ada di tabel `devices` |
| 400 | Format data salah |

## 4. Rakit hardware

> **BAHAYA: PZEM-004T mengukur listrik PLN (220 V AC).** Kesalahan wiring dapat menyebabkan sengatan listrik,
> korsleting, atau kebakaran. Rakit dan uji dengan listrik **mati**, gunakan beban kecil (mis. lampu) dahulu,
> dan minta orang yang berpengalaman memeriksa wiring sebelum dinyalakan. Jangan sentuh bagian bertegangan saat menyala.

Pin yang dipakai firmware (sesuaikan dengan skema hardware kamu, dan periksa datasheet modul untuk level tegangan):

| Komponen | Pin ESP32 | Keterangan |
|---|---|---|
| PZEM-004T | GPIO16 (RX2), GPIO17 (TX2) | Sambung silang: RX ESP32 ke TX PZEM, TX ESP32 ke RX PZEM |
| DHT22 | GPIO14 | Data suhu/kelembapan |
| Relai | GPIO26 | **Active LOW**: LOW = ON. Firmware menyalakan relai saat start |
| Buzzer | GPIO27 | HIGH = bunyi saat ada anomali |

## 5. Flash firmware ke ESP32

1. Pasang **Arduino IDE 2**.
2. **Boards Manager** → cari `esp32` oleh *Espressif Systems* → Install.
3. **Library Manager** → install `PZEM004Tv30` (mandulaj) dan `DHT sensor library` (Adafruit).
   (Kalau diminta, install juga `Adafruit Unified Sensor`.)
4. Buka `firmware/EMORA_IoT/EMORA_IoT.ino`.
5. Di folder yang sama, **salin** `config.example.h` menjadi `config.h`, lalu isi:

   ```cpp
   #define WIFI_SSID      "nama-wifi"
   #define WIFI_PASSWORD  "password-wifi"
   #define API_URL        "http://192.168.1.10:4000/ingest"   // IP laptop, BUKAN localhost
   #define DEVICE_KEY     "<sama dengan INGEST_API_KEY>"
   #define DEVICE_ID      "emora-01"                           // sama dengan kolom id di tabel devices
   ```

   Cari IP laptop: macOS `ipconfig getifaddr en0`, Windows `ipconfig`. Laptop dan ESP32 harus di **WiFi yang sama**.
   ESP32 hanya mendukung WiFi **2,4 GHz**.
6. **Tools → Board** pilih `ESP32 Dev Module` (sesuaikan dengan boardmu), lalu pilih **Port**.
7. Klik **Upload**. Bila macet di "Connecting…", tahan tombol **BOOT** di ESP32 sampai upload mulai.
8. Buka **Serial Monitor** pada **115200 baud**.

Keluaran yang diharapkan:

```
[NET] Menghubungkan ke WiFi nama-wifi
[NET] WiFi terhubung, IP 192.168.1.25, sinyal -58 dBm
V: 220.1 V | I: 0.153 A | P: 30.2 W | ... | Status: NORMAL
[NET] Data terkirim
```

## 6. Pastikan data masuk

Berurutan dari ESP32 ke database:

1. Serial Monitor menampilkan `[NET] Data terkirim` setiap 5 detik.
2. Terminal backend mencatat `POST /ingest` dengan status 202.
3. Supabase **Table Editor → readings** bertambah baris baru, kolom `ts` terus maju.
4. `curl http://localhost:4000/api/devices/emora-01/latest` mengembalikan pembacaan terakhir.

## Pemecahan masalah

| Gejala | Penyebab dan solusi |
|---|---|
| `[NET] Gagal kirim, kode: -1` | ESP32 tidak sampai ke backend. Cek IP di `API_URL`, backend sedang jalan, WiFi sama. Di macOS, izinkan koneksi masuk untuk Node saat diminta firewall. |
| Kode `401` | `DEVICE_KEY` berbeda dengan `INGEST_API_KEY`. Salin ulang tanpa spasi. |
| Kode `404` | `DEVICE_ID` belum ada di tabel `devices`. Tambahkan barisnya, atau samakan dengan `emora-01`. |
| Tidak pernah terhubung WiFi | SSID/password salah, atau WiFi 5 GHz. Gunakan 2,4 GHz. |
| `Gagal membaca data dari sensor PZEM-004T!` | Wiring RX/TX PZEM, catu 5 V modul, atau modul belum teraliri listrik PLN. Data tidak dikirim selama PZEM gagal dibaca. |
| Suhu/kelembapan `null` di database | DHT22 gagal dibaca (wiring/pin 14). Data lain tetap dikirim. |
| Compile error `config.h` | `config.h` belum dibuat dari `config.example.h`. |
| IP laptop berubah | Router memberi IP baru. Perbarui `API_URL`, upload ulang. Atur IP statis/reservasi di router agar tetap. |

## Catatan keselamatan dan keamanan

- Firmware ini **tidak mengubah logika proteksi**: ambang batas, buzzer, dan relai sama dengan `EMORA.ino`, dan berjalan
  tanpa internet. Pengiriman data berjalan di task terpisah sehingga WiFi yang lambat tidak menunda alarm.
- Relai pada firmware ini selalu menyala dan **tidak ada pemutusan otomatis** atau perintah jarak jauh. Fitur mode
  otomatis/manual di dashboard belum terhubung ke firmware.
- `API_URL` berawalan `http://` mengirim data tanpa enkripsi (cukup untuk jaringan rumah/lab). Untuk backend online
  pakai `https://`. Firmware saat ini memakai `setInsecure()` pada HTTPS (tidak memeriksa sertifikat server); ganti
  dengan sertifikat root sebelum dipakai sungguhan.
- Jangan commit `apps/api/.env` dan `firmware/EMORA_IoT/config.h` (sudah di `.gitignore`).
- Backend harus selalu menyala dan bisa dijangkau ESP32. Untuk pemakaian nyata, deploy ke layanan hosting (bukan laptop).

## Langkah berikutnya (belum dikerjakan)

1. **Skema multi-jalur**: dashboard memodelkan satu panel dengan banyak jalur (tiap jalur satu PZEM + relai), sedangkan
   tabel sekarang satu perangkat per pembacaan. Perlu tabel `channels` dan kolom `channel_id` di `readings`.
   Firmware pun perlu membaca beberapa PZEM (`PZEMMultiDevice` pada library) bila memang banyak jalur.
2. **Sambungkan dashboard ke Supabase** (ganti `apps/web/src/lib/store.ts`).
3. **Kontrol relai dari dashboard**: perintah turun ke ESP32 (MQTT atau polling), mode otomatis/manual, feedback ke ML.
4. **Login** sebelum kontrol relai diaktifkan.
5. Uji firmware pada hardware sungguhan, lalu perbaiki bila perlu.
