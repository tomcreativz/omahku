// Jadwal imunisasi anak (murni, tanpa DOM). Mengacu pada rekomendasi IDAI 2023/2024 untuk usia 0-18 tahun.
// Hanya panduan pengingat. Jadwal sebenarnya bisa berbeda per anak: ikuti dokter anak / posyandu / puskesmas.
// at = usia (bulan) yang dianjurkan, till = batas usia (bulan) sebelum dianggap terlambat.

export const VACCINES = [
  { k: "hepb0", name: "Hepatitis B (lahir)", at: 0, till: 1 },
  { k: "polio0", name: "Polio 0 (tetes)", at: 0, till: 1 },
  { k: "bcg", name: "BCG", at: 0, till: 3 },
  { k: "dpt1", name: "DTP-HB-Hib 1", at: 2, till: 4 },
  { k: "polio1", name: "Polio 1", at: 2, till: 4 },
  { k: "pcv1", name: "PCV 1", at: 2, till: 4 },
  { k: "rota1", name: "Rotavirus 1", at: 2, till: 4 },
  { k: "dpt2", name: "DTP-HB-Hib 2", at: 3, till: 5 },
  { k: "polio2", name: "Polio 2", at: 3, till: 5 },
  { k: "dpt3", name: "DTP-HB-Hib 3", at: 4, till: 7 },
  { k: "polio3", name: "Polio 3", at: 4, till: 7 },
  { k: "pcv2", name: "PCV 2", at: 4, till: 7 },
  { k: "rota2", name: "Rotavirus 2", at: 4, till: 7 },
  { k: "pcv3", name: "PCV 3", at: 6, till: 9 },
  { k: "rota3", name: "Rotavirus 3", at: 6, till: 9 },
  { k: "flu1", name: "Influenza 1", at: 6, till: 9 },
  { k: "flu2", name: "Influenza 2", at: 7, till: 10 },
  { k: "mr", name: "Campak / MR", at: 9, till: 12 },
  { k: "pcv4", name: "PCV 4 (booster)", at: 12, till: 18 },
  { k: "var1", name: "Varisela 1", at: 12, till: 18 },
  { k: "hepa1", name: "Hepatitis A 1", at: 12, till: 24 },
  { k: "var2", name: "Varisela 2", at: 14, till: 24 },
  { k: "dpt4", name: "DTP-HB-Hib 4 (booster)", at: 18, till: 24 },
  { k: "polio4", name: "Polio 4 (booster)", at: 18, till: 24 },
  { k: "hepb4", name: "Hepatitis B (booster)", at: 18, till: 24 },
  { k: "mmr1", name: "MMR 1", at: 18, till: 24 },
  { k: "hepa2", name: "Hepatitis A 2", at: 18, till: 30 },
  { k: "tifoid", name: "Tifoid (ulang tiap 3 tahun)", at: 24, till: 36 },
  { k: "dpt5", name: "DTP 5", at: 60, till: 84 },
  { k: "mmr2", name: "MMR 2", at: 60, till: 84 },
  { k: "hpv1", name: "HPV 1 (terutama anak perempuan)", at: 108, till: 180 },
  { k: "hpv2", name: "HPV 2 (6 bulan setelah HPV 1)", at: 114, till: 192 },
  { k: "dpt6", name: "Td/Tdap (DTP 6)", at: 120, till: 216 },
];

export const ageLabel = (m) => (m < 1 ? "lahir" : m < 24 ? `${m} bln` : m % 12 === 0 ? `${m / 12} th` : `${Math.floor(m / 12)} th ${m % 12} bln`);

// Umur dalam bulan penuh dari { y, m } (hasil ageOf).
export const monthsOf = (age) => (age ? age.y * 12 + age.m : null);

// status: given | now | soon | late | missed | future
export function statusOf(v, am, given, catchup) {
  if (given) return { id: "given", label: "Sudah ✓", tone: "green" };
  if (am < v.at - 1) return { id: "future", label: "Nanti " + ageLabel(v.at), tone: "" };
  if (am < v.at) return { id: "soon", label: "Segera (bulan ini)", tone: "yellow" };
  if (am <= v.till) return { id: "now", label: "Saatnya", tone: "orange" };
  return catchup ? { id: "late", label: "Terlambat", tone: "red" } : { id: "missed", label: "Belum tercatat", tone: "" };
}

// Daftar imunisasi satu anak. givenKeys = Set kunci dosis yang sudah tercatat.
export function planFor(age, givenKeys, catchup) {
  const am = monthsOf(age);
  if (am == null) return [];
  return VACCINES.map((v) => ({ ...v, st: statusOf(v, am, givenKeys.has(v.k), catchup) }));
}

// Dosis yang perlu perhatian: saatnya, segera, atau terlambat (jika pemantauan terlambat dinyalakan).
export const needsAttention = (plan) => plan.filter((p) => ["now", "soon", "late"].includes(p.st.id));
