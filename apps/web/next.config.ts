import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tombol indikator dev menutupi tab pertama navigasi bawah di layar kecil
  devIndicators: false,
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
