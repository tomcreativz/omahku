// Perhitungan kesehatan (murni, tanpa DOM). Hanya panduan umum untuk DEWASA, bukan diagnosis.
// Acuan: IMT & lingkar perut mengikuti kategori Kemenkes RI / Asia-Pasifik, tekanan darah mengikuti
// klasifikasi ESC/PERHI, gula darah mengikuti kriteria PERKENI, kolesterol & asam urat mengikuti batas umum.

export const GLUCOSE_CTX = ["Puasa", "2 jam setelah makan", "Sewaktu"];
export const BLOOD_TYPES = ["A+", "A−", "B+", "B−", "AB+", "AB−", "O+", "O−", "Belum tahu"];

const round1 = (n) => Math.round(n * 10) / 10;
const ok = (n) => typeof n === "number" && Number.isFinite(n) && n > 0;

// ---------- Umur ----------
export function ageOf(birth, now) {
  if (!birth || !now) return null;
  const [by, bm, bd] = birth.split("-").map(Number), [ny, nm, nd] = now.split("-").map(Number);
  if (!by || !ny) return null;
  let y = ny - by, m = nm - bm;
  if (nd < bd) m--;
  if (m < 0) { y--; m += 12; }
  if (y < 0) return null;
  return { y, m };
}
export function ageText(a) {
  if (!a) return "";
  if (a.y < 1) return `${a.m} bln`;
  if (a.y < 5) return a.m ? `${a.y} th ${a.m} bln` : `${a.y} th`;
  return `${a.y} th`;
}
export const isAdult = (a) => !!a && a.y >= 18;

// ---------- IMT, berat ideal ----------
export const bmiOf = (kg, cm) => (ok(kg) && ok(cm) ? round1(kg / ((cm / 100) ** 2)) : null);

export function bmiStatus(b) {
  if (b < 17) return { label: "Sangat kurus", tone: "orange" };
  if (b < 18.5) return { label: "Kurus", tone: "yellow" };
  if (b <= 25) return { label: "Normal", tone: "green" };
  if (b <= 27) return { label: "Gemuk", tone: "yellow" };
  return { label: "Obesitas", tone: "orange" };
}

// Rumus Broca yang dimodifikasi: (TB − 100) − 10%; untuk pria < 160 cm / wanita < 150 cm: TB − 100.
export function idealWeight(cm, sex) {
  if (!ok(cm)) return null;
  const short = (sex === "L" && cm < 160) || (sex === "P" && cm < 150);
  return round1(short ? cm - 100 : (cm - 100) * 0.9);
}
// Rentang berat sehat dari IMT 18,5 – 25.
export function healthyRange(cm) {
  if (!ok(cm)) return null;
  const m2 = (cm / 100) ** 2;
  return [Math.ceil(18.5 * m2), Math.floor(25 * m2)];
}

// ---------- Tekanan darah (mmHg) ----------
export function bpStatus(s, d) {
  if (s >= 180 || d >= 110) return { label: "Hipertensi derajat 3", tone: "red" };
  if (s >= 160 || d >= 100) return { label: "Hipertensi derajat 2", tone: "red" };
  if (s >= 140 || d >= 90) return { label: "Hipertensi derajat 1", tone: "orange" };
  if (s >= 130 || d >= 85) return { label: "Normal tinggi", tone: "yellow" };
  if (s < 90 || d < 60) return { label: "Rendah", tone: "blue" };
  if (s >= 120 || d >= 80) return { label: "Normal", tone: "green" };
  return { label: "Optimal", tone: "green" };
}

// ---------- Gula darah (mg/dL) ----------
export function glucoseStatus(v, ctx) {
  if (v < 70) return { label: "Rendah", tone: "orange" };
  if (ctx === "Puasa") {
    if (v < 100) return { label: "Normal", tone: "green" };
    if (v < 126) return { label: "Pradiabetes", tone: "yellow" };
    return { label: "Tinggi (rentang diabetes)", tone: "orange" };
  }
  if (ctx === "2 jam setelah makan") {
    if (v < 140) return { label: "Normal", tone: "green" };
    if (v < 200) return { label: "Pradiabetes", tone: "yellow" };
    return { label: "Tinggi (rentang diabetes)", tone: "orange" };
  }
  if (v < 140) return { label: "Normal", tone: "green" };
  if (v < 200) return { label: "Agak tinggi", tone: "yellow" };
  return { label: "Tinggi", tone: "orange" };
}

export function cholStatus(v) {
  if (v < 200) return { label: "Normal", tone: "green" };
  if (v < 240) return { label: "Batas tinggi", tone: "yellow" };
  return { label: "Tinggi", tone: "orange" };
}
export function uricStatus(v, sex) {
  const max = sex === "P" ? 6 : 7;
  return v <= max ? { label: "Normal", tone: "green" } : { label: "Tinggi", tone: "orange" };
}
export function pulseStatus(v) {
  if (v < 60) return { label: "Pelan", tone: "blue" };
  if (v <= 100) return { label: "Normal", tone: "green" };
  return { label: "Cepat", tone: "yellow" };
}
export function waistStatus(v, sex) {
  if (sex !== "L" && sex !== "P") return null;
  const lim = sex === "L" ? 90 : 80;
  return v < lim ? { label: "Normal", tone: "green" } : { label: "Obesitas sentral", tone: "orange" };
}

// ---------- Validasi isian pengukuran ----------
const RANGES = [
  ["height_cm", "Tinggi badan", 30, 250], ["weight_kg", "Berat badan", 1, 400], ["waist_cm", "Lingkar perut", 20, 250],
  ["pulse", "Nadi", 20, 250], ["bp_sys", "Tekanan darah atas", 50, 300], ["bp_dia", "Tekanan darah bawah", 30, 200],
  ["glucose", "Gula darah", 20, 900], ["cholesterol", "Kolesterol", 50, 800], ["uric_acid", "Asam urat", 0.5, 30],
];
export function validateMetric(o) {
  const has = (k) => o[k] != null && o[k] !== "";
  if (!RANGES.some(([k]) => has(k))) return "Isi minimal satu angka pengukuran.";
  for (const [k, label, lo, hi] of RANGES) {
    if (has(k) && !(Number(o[k]) >= lo && Number(o[k]) <= hi)) return `${label} tidak masuk akal (${lo}–${hi}). Periksa lagi.`;
  }
  if (has("bp_sys") !== has("bp_dia")) return "Isi kedua angka tekanan darah (atas dan bawah).";
  if (has("bp_sys") && Number(o.bp_sys) <= Number(o.bp_dia)) return "Angka atas tekanan darah harus lebih besar dari angka bawah.";
  return "";
}
