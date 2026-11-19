// Penghubung Belanja ↔ Stok ↔ Menu: baca jumlah/satuan dari teks, cocokkan nama, hitung pemakaian. Tanpa DOM.

// ---- satuan ----
const MASS = { kg: 1000, kilo: 1000, kilogram: 1000, g: 1, gr: 1, gram: 1, ons: 100 };
const VOL = { l: 1000, lt: 1000, liter: 1000, ml: 1, cc: 1 };
const PCS = ["butir", "buah", "biji", "pcs", "potong", "ekor", "lembar", "batang", "siung"];
const OTHER = ["ikat", "bungkus", "bks", "sachet", "botol", "kaleng", "dus", "kotak", "papan", "pack", "pak", "sdm", "sdt", "gelas", "bonggol", "genggam", "sisir", "kantong", "karung", "liter", "renteng", "box", "tangkai", "helai"];
export const UNIT_LIST = ["kg", "gram", "liter", "ml", "butir", "buah", "pcs", "bungkus", "botol", "kaleng", "dus", "ikat", "sachet", "lembar", "siung", "papan"];
const UNIT_WORDS = new Set([...Object.keys(MASS), ...Object.keys(VOL), ...PCS, ...OTHER]);

// kelas satuan: massa (dasar gram), volume (dasar ml), hitung "pcs", atau lainnya (hanya sama persis yang cocok)
export function unitInfo(u) {
  const x = String(u || "").toLowerCase().trim();
  if (!x) return { cls: "none", f: 1, key: "" };
  if (MASS[x] != null) return { cls: "mass", f: MASS[x], key: x };
  if (VOL[x] != null) return { cls: "vol", f: VOL[x], key: x };
  if (PCS.includes(x)) return { cls: "pcs", f: 1, key: x };
  return { cls: "other", f: 1, key: x === "bks" ? "bungkus" : x === "pak" ? "pack" : x };
}

// Ubah jumlah antar satuan. null jika tidak sebanding.
export function convert(n, from, to) {
  const a = unitInfo(from), b = unitInfo(to);
  if (a.cls === "mass" && b.cls === "mass") return (n * a.f) / b.f;
  if (a.cls === "vol" && b.cls === "vol") return (n * a.f) / b.f;
  if (a.cls === "pcs" && (b.cls === "pcs" || b.cls === "none")) return n;
  if (a.cls === "none" && (b.cls === "pcs" || b.cls === "none")) return n;
  if (a.cls === "other" && b.cls === "other" && a.key === b.key) return n;
  return null;
}

// ---- baca jumlah ----
const FR = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };
function num(t) {
  t = t.trim().replace(/,/g, ".");
  if (FR[t] != null) return FR[t];
  let m = t.match(/^(\d+)\s*([½¼¾⅓⅔])$/); if (m) return Number(m[1]) + FR[m[2]];
  m = t.match(/^(\d+)\s*\/\s*(\d+)$/); if (m) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
  m = t.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/); if (m) return Number(m[3]) ? Number(m[1]) + Number(m[2]) / Number(m[3]) : null;
  m = t.match(/^\d+(\.\d+)?$/); return m ? Number(t) : null;
}
const NUM = String.raw`(\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+\s*[½¼¾⅓⅔]|[½¼¾⅓⅔]|\d+(?:[.,]\d+)?)`;
const QRE = new RegExp(String.raw`(^|[\s(])${NUM}\s*([a-zA-Z]+)?(?=$|[\s),.;])`, "i");

// "Ayam 1/2 kg" → {name:"Ayam", n:0.5, unit:"kg"}; "2 butir telur" → {name:"telur", n:2, unit:"butir"}; "Garam secukupnya" → n:null
export function parseIngredient(line) {
  const raw = String(line || "").trim();
  if (!raw) return null;
  const m = raw.match(QRE);
  if (!m) return { raw, name: cleanName(raw), n: null, unit: "" };
  const n = num(m[2]);
  let unit = "", cut = m[0];
  if (m[3] && UNIT_WORDS.has(m[3].toLowerCase())) unit = m[3].toLowerCase();
  else if (m[3]) cut = m[0].slice(0, m[0].length - m[3].length); // kata biasa setelah angka bukan satuan (mis. "2 telur")
  if (n == null) return { raw, name: cleanName(raw), n: null, unit: "" };
  const rest = (raw.slice(0, m.index) + " " + raw.slice(m.index + cut.length)).replace(/\s+/g, " ");
  return { raw, name: cleanName(rest), n, unit };
}
const cleanName = (s) => s.replace(/\b(secukupnya|sedikit|sesuai selera|secukup rasa|to taste)\b/gi, " ").replace(/[()]/g, " ").replace(/\s*[-–—:]\s*$/, "").replace(/\s+/g, " ").replace(/^[-•*\s]+|[\s,;]+$/g, "").trim();
export const parseQty = (text) => { const p = parseIngredient("x " + (text || "")); return p && p.n != null ? { n: p.n, unit: p.unit } : { n: null, unit: "" }; };

export const splitLines = (txt) => String(txt || "").split(/\n+/).flatMap((l) => (l.includes(",") && !/\d,\d/.test(l) ? l.split(",") : [l])).map((s) => s.trim()).filter(Boolean);

// ---- cocokkan nama ----
const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\(.*?\)/g, " ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["segar", "potong", "iris", "cincang", "halus", "kasar", "secukupnya", "matang", "mentah", "kupas", "geprek", "rebus", "goreng", "bubuk", "utuh", "besar", "kecil", "sedang"]);
const words = (s) => fold(s).split(" ").filter((w) => w && !STOP.has(w));

// skor kecocokan nama; 0 = tidak cocok
export function nameScore(a, b) {
  const x = words(a), y = words(b);
  if (!x.length || !y.length || x.join("").length < 3 || y.join("").length < 3) return 0;
  if (x.join(" ") === y.join(" ")) return 100;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  if (s.every((w) => l.includes(w))) return 60 + Math.round((s.length / l.length) * 30);
  return 0;
}
export function candidates(name, stock) {
  return stock.map((s) => ({ s, score: nameScore(name, s.name) })).filter((x) => x.score > 0).sort((p, q) => q.score - p.score).map((x) => x.s);
}

// ---- masak: bahan menu → pemakaian stok ----
// Hasil per bahan: {ing, stock (terbaik|null), cands, need:{n,unit}|null, use (jumlah dalam satuan stok, bisa null jika tak sebanding), enough}
export function planCook(ingredientsText, stock) {
  return splitLines(ingredientsText).map(parseIngredient).filter((i) => i && i.name).map((ing) => {
    const cands = candidates(ing.name, stock), st = cands[0] || null;
    let use = null;
    if (st && ing.n != null) use = convert(ing.n, ing.unit, st.unit || "");
    const have = st ? Number(st.qty) || 0 : 0;
    const enough = !st ? false : use != null ? have >= use - 1e-9 : have > 0;
    return { ing, stock: st, cands, use: use == null ? null : round(use), enough };
  });
}
export const round = (n) => Math.round(n * 100) / 100;

// Ringkasan ketersediaan bahan sebuah menu: {total, ok, missing:[ing...]}
export function availability(ingredientsText, stock) {
  const plan = planCook(ingredientsText, stock);
  const missing = plan.filter((p) => !p.enough).map((p) => p.ing);
  return { total: plan.length, ok: plan.length - missing.length, missing, plan };
}

// ---- belanja → stok ----
export const defaultMin = (n) => Math.max(0, Math.floor((Number(n) || 0) / 4));
// Tentukan apa yang terjadi saat item dibeli masuk stok: tambah ke stok yang ada, atau item baru.
export function planStockIn(entry, stock) {
  const st = candidates(entry.name, stock)[0] || null;
  if (st) {
    const add = convert(Number(entry.qty) || 0, entry.unit, st.unit || "");
    if (add != null) return { mode: "add", stock: st, add: round(add) };
  }
  return { mode: "new", stock: null, add: Number(entry.qty) || 0 };
}

export const STOCK_CATS = ["Makanan & minuman", "Dapur", "Kebersihan", "Mandi & perawatan", "Bayi & anak", "Obat", "Lainnya"];
export const qtyText = (n, unit) => (n == null ? "" : `${round(n)}${unit ? " " + unit : ""}`);
