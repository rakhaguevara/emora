// Nama operator yang melakukan tindakan dari dashboard (disimpan per browser).
// Sementara sebelum ada login: peran selalu 'operator', nama dikirim ke backend dan tercatat di audit.

const KEY = "emora.operator";
export const OPERATOR_FALLBACK = "Operator";

export function getOperator(): string {
  try {
    return localStorage.getItem(KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function setOperator(name: string) {
  try {
    localStorage.setItem(KEY, name.trim().slice(0, 60));
  } catch {
    /* penyimpanan diblokir: nama hanya berlaku untuk tindakan ini */
  }
}

export const operatorName = () => getOperator() || OPERATOR_FALLBACK;
