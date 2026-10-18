import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tombol indikator dev menutupi tab pertama navigasi bawah di layar kecil
  devIndicators: false,
  // Izinkan membuka dashboard dari HP di jaringan lokal (hotspot/WiFi), mis. http://10.197.88.135:3000
  allowedDevOrigins: ["10.*.*.*", "192.168.*.*"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
