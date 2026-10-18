import { getSession, setSession } from "./auth/session";

// Klien backend (apps/api). Token sesi ikut otomatis; 401 = sesi tidak berlaku lagi, pengguna dikeluarkan.

// Alamat backend: NEXT_PUBLIC_EMORA_API_URL, atau host halaman ini di port 4000 (berlaku juga saat dibuka dari HP).
export function apiBase(): string {
  return process.env.NEXT_PUBLIC_EMORA_API_URL || `${window.location.protocol}//${window.location.hostname}:4000`;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

export async function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const token = getSession()?.token;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store",
    });
  } catch {
    throw new ApiError(`Backend tidak terjangkau di ${apiBase()} (npm run dev:api sudah jalan?)`, 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) setSession(null);
  if (!res.ok) throw new ApiError(data.message ?? data.error ?? `Backend ${res.status}`, res.status, data.error);
  return data as T;
}
