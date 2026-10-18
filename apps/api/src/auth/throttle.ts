// Pembatas percobaan gagal (login dan PIN) untuk mencegah tebak-tebakan.
// Setelah MAX_FAILURES gagal berturut-turut, kunci dikunci selama LOCK_MS. Disimpan di memori proses.

const MAX_FAILURES = 5;
const LOCK_MS = 5 * 60_000;

interface Entry {
  failures: number;
  lockedUntil: number;
}

export class Throttle {
  private entries = new Map<string, Entry>();

  // Sisa detik penguncian, atau 0 bila boleh mencoba
  lockedFor(key: string): number {
    const e = this.entries.get(key);
    if (!e || e.lockedUntil <= Date.now()) return 0;
    return Math.ceil((e.lockedUntil - Date.now()) / 1000);
  }

  // Mencatat kegagalan; mengembalikan sisa percobaan sebelum dikunci
  fail(key: string): number {
    const e = this.entries.get(key) ?? { failures: 0, lockedUntil: 0 };
    e.failures += 1;
    if (e.failures >= MAX_FAILURES) {
      e.failures = 0;
      e.lockedUntil = Date.now() + LOCK_MS;
    }
    this.entries.set(key, e);
    return e.lockedUntil > Date.now() ? 0 : MAX_FAILURES - e.failures;
  }

  reset(key: string) {
    this.entries.delete(key);
  }
}

export const lockMessage = (sec: number) => `Terlalu banyak percobaan gagal. Coba lagi dalam ${Math.ceil(sec / 60)} menit.`;
