"use client";

import { useCallback, useEffect, useState } from "react";

// Memuat data admin dari backend: { data, error, loading, reload, loadedAt }.
// loadedAt = waktu data terakhir dimuat, acuan teks "x menit lalu" (render tidak boleh memanggil Date.now).
export function useResource<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState(0);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load());
      setLoadedAt(Date.now());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    // Muat sekali saat halaman dibuka; reload() dipanggil lagi setelah perubahan
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  return { data, error, loading, reload, loadedAt };
}
