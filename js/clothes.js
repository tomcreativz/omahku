// Manajemen pakaian (lemari): perhitungan murni tanpa DOM, agar mudah diuji.

export const CATS = ["Harian / santai", "Formal / kerja", "Tidur", "Olahraga", "Ibadah", "Pesta & adat", "Seragam", "Jaket & luaran", "Pakaian dalam", "Lainnya"];
export const CAT_ICON = { "Harian / santai": "👕", "Formal / kerja": "👔", "Tidur": "🌙", "Olahraga": "🏃", "Ibadah": "🕌", "Pesta & adat": "🎉", "Seragam": "🎒", "Jaket & luaran": "🧥", "Pakaian dalam": "🩲", "Lainnya": "🧺" };
export const TYPES = ["Kaos", "Kemeja / blus", "Celana", "Rok", "Terusan / gamis", "Jaket / sweater", "Piyama / daster", "Pakaian dalam", "Kaus kaki", "Lainnya"];
export const CONDITIONS = ["Baik", "Layak pakai", "Perlu perbaikan", "Rusak"];
export const STATUS = { use: "Dipakai", ready: "Siap dilepas", gone: "Sudah dilepas" };
export const RELEASE = ["Donasi", "Dijual", "Diberikan ke orang lain", "Dibuang / dijadikan lap"];
export const IDLE_DAYS = 90;

const D = (s) => new Date(s + "T00:00:00");
const days = (to, from) => Math.round((D(to) - D(from)) / 864e5);
const qtyOf = (r) => { const n = Number(r.qty); return Number.isFinite(n) && n > 0 ? n : 1; };

export const isGone = (r) => r.status === STATUS.gone;
export const isOwned = (r) => !isGone(r);

// Hari sejak terakhir dipakai (atau sejak ditambahkan/dibeli bila belum pernah dicatat). null = tidak diketahui.
export function idleDays(r, now) {
  const base = r.last_worn || r.bought_date || (r.created_at ? String(r.created_at).slice(0, 10) : null);
  return base ? Math.max(0, days(now, base)) : null;
}
export const isIdle = (r, now) => r.status !== STATUS.gone && r.status !== STATUS.ready && (idleDays(r, now) ?? 0) >= IDLE_DAYS;

// Ringkasan untuk satu daftar pakaian. `pieces` = jumlah potong yang masih dimiliki.
export function summarize(rows, now) {
  const own = rows.filter(isOwned);
  const byCat = {};
  for (const r of own) byCat[r.category || "Lainnya"] = (byCat[r.category || "Lainnya"] || 0) + qtyOf(r);
  return {
    pieces: own.reduce((n, r) => n + qtyOf(r), 0),
    items: own.length,
    idle: own.filter((r) => isIdle(r, now)).length,
    ready: rows.filter((r) => r.status === STATUS.ready).length,
    gone: rows.filter(isGone).length,
    repair: own.filter((r) => r.condition === "Perlu perbaikan" || r.condition === "Rusak").length,
    byCat,
  };
}

export const piecesOf = (rows, person) => rows.filter((r) => isOwned(r) && (!person || r.person === person)).reduce((n, r) => n + qtyOf(r), 0);
export const idleList = (rows, now) => rows.filter((r) => isIdle(r, now)).sort((a, b) => (idleDays(b, now) ?? 0) - (idleDays(a, now) ?? 0));
export function idleText(n) {
  if (n == null) return "";
  if (n < 14) return `${n} hari lalu`;
  if (n < 60) return `${Math.round(n / 7)} minggu lalu`;
  if (n < 365) return `${Math.round(n / 30)} bulan lalu`;
  return `${(n / 365).toFixed(1).replace(".0", "")} tahun lalu`;
}
