#pragma once
// Salin file ini menjadi config.h lalu isi nilainya. config.h tidak ikut ke repo.

#define WIFI_SSID      "nama-wifi-kamu"
#define WIFI_PASSWORD  "password-wifi-kamu"

// Alamat backend. Jangan pakai "localhost": itu menunjuk ke ESP32 sendiri.
// Uji di jaringan lokal : "http://192.168.1.10:4000/ingest"  (IP laptop yang menjalankan backend)
// Backend online (HTTPS): "https://api.contoh.com/ingest"
#define API_URL        "http://192.168.1.10:4000/ingest"

// Harus sama persis dengan INGEST_API_KEY di apps/api/.env
#define DEVICE_KEY     "ganti-dengan-string-acak"

// Harus sama dengan kolom id di tabel devices (Supabase)
#define DEVICE_ID      "emora-01"

// Jeda kirim data (ms). 5000 = 5 detik. Pembacaan sensor tetap tiap 1 detik.
#define SEND_INTERVAL_MS 5000
