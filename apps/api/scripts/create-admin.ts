// Membuat akun admin dari terminal. Dipakai untuk admin pertama; akun berikutnya dibuat lewat halaman Admin.
// Pemakaian: npm run create-admin -- <username> "<Nama Tampilan>"
// Password ditanyakan di terminal (minimal 8 karakter).
import { createInterface } from 'node:readline/promises';
import { hashSecret } from '../src/auth/crypto.js';
import { supabase } from '../src/supabase.js';

const [username, displayName] = process.argv.slice(2);
if (!username || !displayName || !/^[a-z0-9._-]{3,32}$/.test(username)) {
  console.error('Pemakaian: npm run create-admin -- <username> "<Nama Tampilan>"');
  console.error('Username 3–32 karakter: huruf kecil, angka, titik, minus, garis bawah.');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question('Password (min. 8 karakter): ');
rl.close();
if (password.length < 8) {
  console.error('Password minimal 8 karakter.');
  process.exit(1);
}

const { error } = await supabase.from('app_users').insert({
  username, display_name: displayName.trim().slice(0, 60), role: 'admin', password_hash: await hashSecret(password),
});
if (error) {
  console.error(error.code === '23505' ? `Username "${username}" sudah dipakai.` : `Gagal: ${error.message}`);
  process.exit(1);
}
console.log(`Admin "${username}" dibuat. Masuk di dashboard: /login`);
