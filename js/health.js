// Profil kesehatan, pengukuran berkala (berat, tekanan darah, gula darah, dll.) dan grafik tren.
import { h, chip, today, fmtDate, fmtShort, emptyState, confirmBox } from "./ui.js";
import { state, deleteRow, meMember } from "./data.js";
import { planFor, needsAttention, monthsOf, ageLabel } from "./vaxcalc.js";
import { ageOf, ageText, isAdult, bmiOf, bmiStatus, idealWeight, healthyRange, bpStatus, glucoseStatus, cholStatus, uricStatus,
  pulseStatus, waistStatus, validateMetric, GLUCOSE_CTX, BLOOD_TYPES } from "./healthcalc.js";

const norm = (s) => String(s || "").trim().toLowerCase();
const fnum = (n) => Number(n).toLocaleString("id-ID", { maximumFractionDigits: 1 });
const CTX_SHORT = { "Puasa": "puasa", "2 jam setelah makan": "2 jam setelah makan", "Sewaktu": "sewaktu" };

const mine = (rows, person) => rows.filter((r) => norm(r.person) === norm(person));
const newest = (rows) => [...rows].sort((a, b) => (b.date || "").localeCompare(a.date || "") || String(b.created_at).localeCompare(String(a.created_at)));
const profileOf = (person) => state.data.health_profiles.find((p) => norm(p.person) === norm(person));
const has = (v) => v != null && v !== "";
const latest = (person, test) => newest(mine(state.data.health_metrics, person)).find(test);
const heightOf = (person) => latest(person, (r) => has(r.height_cm))?.height_cm ?? profileOf(person)?.height_cm ?? null;

// ============================================================
// Definisi formulir (dipakai openForm di modules.js)
// ============================================================
export const PROFILE = {
  key: "hprofile", table: "health_profiles", singular: "Profil kesehatan", color: "green", titleField: "person",
  fields: [
    { k: "person", label: "Nama anggota keluarga", type: "person", required: true, placeholder: "mis. Budi, Sari, Adik" },
    { k: "birth_date", label: "Tanggal lahir", type: "date", required: true, half: true },
    { k: "sex", label: "Jenis kelamin", type: "select", options: [["", "— Pilih —"], ["L", "Laki-laki"], ["P", "Perempuan"]], half: true, required: true },
    { k: "blood_type", label: "Golongan darah", type: "select", options: [["", "— Belum diisi —"], ...BLOOD_TYPES], half: true },
    { k: "height_cm", label: "Tinggi badan (cm)", type: "number", half: true, min: 30, placeholder: "mis. 165" },
    { k: "insurance", label: "Nomor BPJS / asuransi", placeholder: "mis. BPJS 0001234567890" },
    { k: "vax_catchup", label: "Pengingat imunisasi (anak < 18 th)", type: "select", options: [["", "Hanya yang sedang waktunya"], ["yes", "Ingatkan juga yang terlewat"]], hint: "Pilih yang kedua jika imunisasi anak belum lengkap." },
    { k: "notes", label: "Catatan khusus", type: "textarea", placeholder: "mis. Riwayat keluarga diabetes, hamil, pakai kacamata…" },
  ],
};

export const METRIC = {
  key: "hmetric", table: "health_metrics", title: "Pengukuran", nav: "Pengukuran", singular: "Pengukuran", icon: "📈", color: "blue", titleField: "person",
  emptyTitle: "Belum ada pengukuran", emptyText: "Catat berat badan, tekanan darah, gula darah, dan lainnya secara berkala untuk melihat tren.",
  fields: [
    { k: "person", label: "Untuk siapa", type: "person", required: true, placeholder: "mis. Budi", default: () => selPerson || meMember()?.display_name },
    { k: "date", label: "Tanggal", type: "date", required: true, half: true, default: today },
    { k: "weight_kg", label: "Berat badan (kg)", type: "number", half: true, min: 1, placeholder: "mis. 65.5" },
    { k: "height_cm", label: "Tinggi badan (cm)", type: "number", half: true, min: 30, placeholder: "isi jika berubah (anak)" },
    { k: "waist_cm", label: "Lingkar perut (cm)", type: "number", half: true, min: 20 },
    { k: "bp_sys", label: "Tekanan darah atas", type: "number", half: true, min: 50, placeholder: "mis. 120", hint: "Sistolik (mmHg)" },
    { k: "bp_dia", label: "Tekanan darah bawah", type: "number", half: true, min: 30, placeholder: "mis. 80", hint: "Diastolik (mmHg)" },
    { k: "glucose", label: "Gula darah (mg/dL)", type: "number", half: true, min: 20 },
    { k: "glucose_ctx", label: "Jenis gula darah", type: "select", options: GLUCOSE_CTX, half: true, default: "Puasa", hint: "Puasa = tidak makan ≥ 8 jam" },
    { k: "cholesterol", label: "Kolesterol total (mg/dL)", type: "number", half: true, min: 50 },
    { k: "uric_acid", label: "Asam urat (mg/dL)", type: "number", half: true, min: 0.5 },
    { k: "pulse", label: "Denyut nadi (per menit)", type: "number", half: true, min: 20 },
    { k: "notes", label: "Catatan", type: "textarea", placeholder: "mis. Diukur setelah olahraga, sebelum minum obat…" },
  ],
  validate: validateMetric,
  beforeSave: (o) => { if (!has(o.glucose)) o.glucose_ctx = null; },
};

// ============================================================
// Penjelasan nilai (angka + status warna)
// ============================================================
// Mengembalikan daftar { id, label, text, status } untuk satu baris pengukuran.
function describe(r, person, prof, heightCm) {
  const age = prof?.birth_date ? ageOf(prof.birth_date, r.date || today()) : null;
  const adult = isAdult(age), sex = prof?.sex;
  const out = [];
  if (has(r.height_cm)) out.push({ id: "h", label: "Tinggi", text: `${fnum(r.height_cm)} cm` });
  if (has(r.weight_kg)) out.push({ id: "w", label: "Berat", text: `${fnum(r.weight_kg)} kg` });
  if (has(r.weight_kg) && heightCm) {
    const b = bmiOf(Number(r.weight_kg), Number(heightCm));
    if (b) out.push({ id: "bmi", label: "IMT", text: fnum(b), status: adult ? bmiStatus(b) : null });
  }
  if (has(r.waist_cm)) out.push({ id: "waist", label: "Lingkar perut", text: `${fnum(r.waist_cm)} cm`, status: adult ? waistStatus(Number(r.waist_cm), sex) : null });
  if (has(r.bp_sys) && has(r.bp_dia)) out.push({ id: "bp", label: "Tekanan darah", text: `${r.bp_sys}/${r.bp_dia}`, status: adult ? bpStatus(Number(r.bp_sys), Number(r.bp_dia)) : null });
  if (has(r.glucose)) out.push({ id: "glu", label: `Gula darah (${CTX_SHORT[r.glucose_ctx] || "sewaktu"})`, text: `${fnum(r.glucose)}`, status: adult ? glucoseStatus(Number(r.glucose), r.glucose_ctx || "Sewaktu") : null });
  if (has(r.cholesterol)) out.push({ id: "chol", label: "Kolesterol", text: `${fnum(r.cholesterol)}`, status: adult ? cholStatus(Number(r.cholesterol)) : null });
  if (has(r.uric_acid)) out.push({ id: "uric", label: "Asam urat", text: `${fnum(r.uric_acid)}`, status: adult ? uricStatus(Number(r.uric_acid), sex) : null });
  if (has(r.pulse)) out.push({ id: "pulse", label: "Nadi", text: `${fnum(r.pulse)}/mnt`, status: adult ? pulseStatus(Number(r.pulse)) : null });
  return out;
}

// ============================================================
// Grafik garis kecil (SVG)
// ============================================================
const NS = "http://www.w3.org/2000/svg";
const s = (tag, attrs, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null) el.append(c);
  return el;
};

function chart(title, unit, series, note) {
  const W = 320, H = 130, L = 38, R = 12, T = 12, B = 26;
  const all = series.flatMap((x) => x.pts);
  const t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(...all.map((p) => p.t));
  let lo = Math.min(...all.map((p) => p.v)), hi = Math.max(...all.map((p) => p.v));
  const pad = (hi - lo) * 0.15 || Math.max(1, hi * 0.05); lo -= pad; hi += pad;
  const X = (t) => (t1 === t0 ? (L + W - R) / 2 : L + ((t - t0) / (t1 - t0)) * (W - L - R));
  const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Grafik ${title}`, style: "width:100%;height:auto;display:block" });
  svg.append(s("line", { x1: L, y1: H - B, x2: W - R, y2: H - B, style: "stroke:var(--ink)", "stroke-width": 2 }), s("line", { x1: L, y1: T, x2: L, y2: H - B, style: "stroke:var(--ink)", "stroke-width": 2 }));
  const txt = (x, y, t, anchor = "end") => { const e = s("text", { x, y, "text-anchor": anchor, "font-size": 10, "font-weight": 700, style: "fill:var(--text)" }); e.textContent = t; return e; };
  svg.append(txt(L - 4, T + 8, fnum(hi - pad)), txt(L - 4, H - B - 2, fnum(lo + pad)));
  const d0 = new Date(t0), d1 = new Date(t1), dm = (d) => d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
  svg.append(txt(L, H - 8, dm(d0), "start"));
  if (t1 !== t0) svg.append(txt(W - R, H - 8, dm(d1), "end"));
  for (const x of series) {
    if (x.pts.length > 1) svg.append(s("polyline", { points: x.pts.map((p) => `${X(p.t)},${Y(p.v)}`).join(" "), fill: "none", style: "stroke:var(--ink)", "stroke-width": 3, "stroke-linejoin": "round" }));
    for (const p of x.pts) svg.append(s("circle", { cx: X(p.t), cy: Y(p.v), r: 5, fill: x.color, style: "stroke:var(--ink)", "stroke-width": 2.5 }));
  }
  const last = series.map((x) => `${fnum(x.pts[x.pts.length - 1].v)}`).join("/");
  return h("div", { class: "box chart" },
    h("div", { class: "chart-h" }, h("b", null, title), h("span", { class: "chip " + (series[0].chip || "") }, `${last} ${unit}`)),
    svg,
    series.length > 1 ? h("div", { class: "chart-leg" }, series.map((x) => h("span", null, h("i", { style: { background: x.color } }), x.name))) : null,
    note ? h("div", { class: "hint", style: { fontSize: ".8rem", color: "var(--muted)" } }, note) : null);
}

function chartsFor(person) {
  const rows = [...mine(state.data.health_metrics, person)].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const pts = (f, list = rows) => list.filter((r) => has(r[f]) && r.date).map((r) => ({ t: new Date(r.date + "T00:00:00").getTime(), v: Number(r[f]) }));
  const out = [];
  const add = (title, unit, series, note) => { if (series.every((x) => x.pts.length >= 2)) out.push(chart(title, unit, series, note)); };
  add("Berat badan", "kg", [{ name: "Berat", pts: pts("weight_kg"), color: "#7BE0A4", chip: "green" }]);
  add("Tinggi badan", "cm", [{ name: "Tinggi", pts: pts("height_cm"), color: "#6BC5FF", chip: "blue" }]);
  add("Tekanan darah", "mmHg", [{ name: "Atas", pts: pts("bp_sys", rows.filter((r) => has(r.bp_dia))), color: "#FF8FAB" }, { name: "Bawah", pts: pts("bp_dia"), color: "#6BC5FF" }]);
  const byCtx = {};
  rows.filter((r) => has(r.glucose)).forEach((r) => (byCtx[r.glucose_ctx || "Sewaktu"] ||= []).push(r));
  const best = Object.entries(byCtx).sort((a, b) => b[1].length - a[1].length)[0];
  if (best) add(`Gula darah (${CTX_SHORT[best[0]] || best[0]})`, "mg/dL", [{ name: "Gula", pts: pts("glucose", best[1]), color: "#FFD93D", chip: "yellow" }]);
  add("Kolesterol total", "mg/dL", [{ name: "Kolesterol", pts: pts("cholesterol"), color: "#FF9F5A", chip: "orange" }]);
  add("Asam urat", "mg/dL", [{ name: "Asam urat", pts: pts("uric_acid"), color: "#C3A6FF", chip: "lilac" }]);
  return out;
}

// ============================================================
// Daftar pengukuran (dipakai renderModule generik)
// ============================================================
let selPerson = "";   // "" = semua orang
export function metricMod(openTabs) {
  return {
    ...METRIC,
    top: (root) => {
      root.append(openTabs());
      const people = [...new Set(state.data.health_metrics.map((r) => r.person))].sort();
      if (selPerson && !people.includes(selPerson)) selPerson = "";
      if (!selPerson && people.length === 1) selPerson = people[0];
      if (people.length > 1) {
        root.append(h("div", { class: "filters", role: "group", "aria-label": "Pilih anggota" }, ["", ...people].map((p) =>
          h("button", { type: "button", class: p === selPerson ? "on" : "", onclick: () => { selPerson = p; document.dispatchEvent(new CustomEvent("rt:rerender")); } }, p || "Semua orang"))));
      }
      if (selPerson) {
        const cs = chartsFor(selPerson);
        if (cs.length) root.append(h("div", { class: "charts" }, cs));
        else root.append(h("div", { class: "msg" }, "📈 Grafik tren muncul setelah ada minimal 2 pengukuran untuk jenis yang sama."));
      } else if (people.length > 1) root.append(h("div", { class: "msg" }, "Pilih satu nama di atas untuk melihat grafik tren."));
      root.append(h("p", { class: "disc" }, "ℹ️ Status warna hanyalah panduan umum untuk orang dewasa, bukan diagnosis. Konsultasikan hasil dengan dokter."));
    },
    filters: () => [[{ id: "sel", label: "", test: (r) => !selPerson || r.person === selPerson }]],
    sort: (a, b) => (b.date || "").localeCompare(a.date || "") || String(b.created_at).localeCompare(String(a.created_at)),
    wide: true,
    card: (r) => {
      const prof = profileOf(r.person);
      const items = describe(r, r.person, prof, r.height_cm || heightOf(r.person));
      return {
        title: `${r.person} · ${fmtDate(r.date)}`, color: "blue",
        meta: items.map((i) => chip(`${i.label} ${i.text}${i.status ? " · " + i.status.label : ""}`, i.status?.tone || "")),
        body: [!prof ? h("div", { class: "note" }, "ℹ️ Belum ada profil untuk " + r.person + ", jadi status tidak dinilai otomatis.") : null, r.notes ? h("div", { class: "note" }, r.notes) : null],
      };
    },
  };
}

// ============================================================
// Tab Profil
// ============================================================
function tile(label, text, status, sub) {
  return h("div", { class: "vital" }, h("small", null, label), h("b", null, text), status ? chip(status.label, status.tone) : null, sub ? h("small", { class: "sub" }, sub) : null);
}

const givenKeys = (person) => new Set(mine(state.data.health_records, person).map((r) => r.vax).filter(Boolean));
const profilePlan = (p, age) => planFor(age, givenKeys(p.person), p.vax_catchup === "yes");

// Imunisasi anak yang perlu perhatian (untuk Beranda).
export function vaxAlerts() {
  const out = [], t = today();
  for (const p of state.data.health_profiles) {
    const age = p.birth_date ? ageOf(p.birth_date, t) : null;
    if (!age || isAdult(age)) continue;
    for (const v of needsAttention(profilePlan(p, age))) out.push({ p, v, age });
  }
  const rank = { late: 0, now: 1, soon: 2 };
  return out.sort((a, b) => rank[a.v.st.id] - rank[b.v.st.id] || a.v.at - b.v.at);
}

function vaxSection(p, age, deps) {
  const plan = profilePlan(p, age), am = monthsOf(age), att = needsAttention(plan);
  const done = plan.filter((x) => x.st.id === "given").length;
  const recs = mine(state.data.health_records, p.person);
  const give = (v) => {
    const mod = { ...deps.recMod, key: "hvax", view: undefined, beforeSave: (o) => { o.vax = v.k; } };
    deps.openForm(mod, null, { person: p.person, type: "Vaksinasi", title: v.name });
  };
  const rows = plan.filter((x) => x.st.id !== "future" || x.at - am <= 12);
  return h("details", { class: "steps", open: att.length > 0 },
    h("summary", null, `💉 Jadwal imunisasi (${done}/${plan.length} tercatat)${att.length ? ` · ${att.length} perlu perhatian` : ""}`),
    h("div", { style: { display: "flex", flexDirection: "column", gap: ".4rem", marginTop: ".5rem" } },
      rows.map((x) => {
        const rec = x.st.id === "given" ? recs.find((r) => r.vax === x.k) : null;
        return h("div", { class: "li" },
          h("div", { class: "grow" }, h("b", null, x.name), h("small", null, rec?.date ? "Diberikan " + fmtShort(rec.date) : "Dianjurkan usia " + ageLabel(x.at))),
          x.st.id === "given" ? chip("✓", "green") : chip(x.st.label, x.st.tone),
          x.st.id === "given" ? null : h("button", { class: "btn sm green", type: "button", "aria-label": "Catat sudah " + x.name, onclick: () => give(x) }, "✓ Sudah"));
      })),
    h("p", { class: "disc", style: { margin: ".6rem 0 0" } }, "ℹ️ Mengacu rekomendasi IDAI 2023/2024. Jadwal tiap anak bisa berbeda, ikuti arahan dokter anak atau posyandu. “Belum tercatat” berarti belum ada catatan di aplikasi, bukan berarti terlewat."));
}

function profileCard(p, deps) {
  const { openForm, run } = deps;
  const age = ageOf(p.birth_date, today()), adult = isAdult(age);
  const h0 = heightOf(p.person);
  const lw = latest(p.person, (r) => has(r.weight_kg));
  const metrics = newest(mine(state.data.health_metrics, p.person));
  const pick = (f) => metrics.find((r) => has(r[f]));
  const tiles = [];
  if (h0) tiles.push(tile("Tinggi", `${fnum(h0)} cm`));
  if (lw) {
    tiles.push(tile("Berat", `${fnum(lw.weight_kg)} kg`, null, fmtShort(lw.date)));
    const b = bmiOf(Number(lw.weight_kg), Number(h0));
    if (b) tiles.push(tile("IMT (BMI)", fnum(b), adult ? bmiStatus(b) : null));
    if (adult && h0) {
      const ideal = idealWeight(Number(h0), p.sex), rng = healthyRange(Number(h0)), diff = Number(lw.weight_kg) - ideal;
      tiles.push(tile("Berat ideal", `${fnum(ideal)} kg`, null, `${Math.abs(diff) < 0.5 ? "Sudah ideal 👍" : (diff > 0 ? "Lebih " : "Kurang ") + fnum(Math.abs(diff)) + " kg"} · sehat ${rng[0]}–${rng[1]} kg`));
    }
  } else if (adult && h0) {
    const ideal = idealWeight(Number(h0), p.sex), rng = healthyRange(Number(h0));
    tiles.push(tile("Berat ideal", `${fnum(ideal)} kg`, null, `rentang sehat ${rng[0]}–${rng[1]} kg`));
  }
  const bp = metrics.find((r) => has(r.bp_sys) && has(r.bp_dia));
  if (bp) tiles.push(tile("Tekanan darah", `${bp.bp_sys}/${bp.bp_dia}`, adult ? bpStatus(Number(bp.bp_sys), Number(bp.bp_dia)) : null, fmtShort(bp.date)));
  const g = pick("glucose");
  if (g) tiles.push(tile(`Gula darah (${CTX_SHORT[g.glucose_ctx] || "sewaktu"})`, fnum(g.glucose), adult ? glucoseStatus(Number(g.glucose), g.glucose_ctx || "Sewaktu") : null, fmtShort(g.date)));
  const c = pick("cholesterol");
  if (c) tiles.push(tile("Kolesterol", fnum(c.cholesterol), adult ? cholStatus(Number(c.cholesterol)) : null, fmtShort(c.date)));
  const u = pick("uric_acid");
  if (u) tiles.push(tile("Asam urat", fnum(u.uric_acid), adult ? uricStatus(Number(u.uric_acid), p.sex) : null, fmtShort(u.date)));
  const w = pick("waist_cm");
  if (w) tiles.push(tile("Lingkar perut", `${fnum(w.waist_cm)} cm`, adult ? waistStatus(Number(w.waist_cm), p.sex) : null, fmtShort(w.date)));
  const pl = pick("pulse");
  if (pl) tiles.push(tile("Nadi", `${fnum(pl.pulse)}/mnt`, adult ? pulseStatus(Number(pl.pulse)) : null, fmtShort(pl.date)));

  const recs = mine(state.data.health_records, p.person);
  const byType = (t) => recs.filter((r) => r.type === t);
  const alerts = [
    ...byType("Alergi").map((r) => chip("⚠ " + r.title, "red")),
    ...byType("Kondisi / penyakit").map((r) => chip("• " + r.title, "yellow")),
    ...byType("Obat rutin").map((r) => chip("💊 " + r.title, "blue")),
  ];

  return h("article", { class: "box card accent", style: { borderLeftColor: "var(--green)" } },
    h("div", { class: "top" }, h("div", { class: "grow" },
      h("div", { class: "ct", style: { fontSize: "1.3rem" } }, p.person),
      h("div", { class: "meta", style: { marginTop: ".4rem" } },
        age ? chip("🎂 " + ageText(age), "pink") : null,
        p.sex ? chip(p.sex === "L" ? "♂ Laki-laki" : "♀ Perempuan", "blue") : null,
        p.blood_type && p.blood_type !== "Belum tahu" ? chip("🩸 Gol. darah " + p.blood_type, "red") : null,
        p.insurance ? chip("🪪 " + p.insurance) : null))),
    tiles.length ? h("div", { class: "vitals" }, tiles) : h("div", { class: "note" }, "Belum ada pengukuran. Tekan “＋ Ukur” untuk mulai mencatat berat, tekanan darah, gula darah, dll."),
    age && !adult ? h("div", { class: "note" }, "👶 Untuk anak/remaja, status IMT dan tekanan darah dinilai memakai kurva khusus. Pantau di posyandu atau dokter anak.") : null,
    age && !adult ? vaxSection(p, age, deps) : null,
    alerts.length ? h("div", { class: "meta" }, alerts) : null,
    p.notes ? h("div", { class: "note" }, p.notes) : null,
    h("div", { class: "acts" },
      h("button", { class: "btn sm green", type: "button", onclick: () => openForm(METRIC, null, { person: p.person }) }, "＋ Ukur"),
      h("button", { class: "btn sm white", type: "button", onclick: () => openForm(PROFILE, p) }, "✏️ Ubah profil"),
      h("button", { class: "btn sm white", type: "button", "aria-label": "Hapus profil " + p.person, onclick: async () => { if (await confirmBox(`Hapus profil “${p.person}”? Data pengukuran tidak ikut terhapus.`)) run(() => deleteRow("health_profiles", p.id), "Dihapus"); } }, "🗑")));
}

function profilesView(root, deps, tabs) {
  const { openForm } = deps;
  const list = [...state.data.health_profiles].sort((a, b) => a.person.localeCompare(b.person));
  root.append(h("div", { class: "page-head" },
    h("h1", null, h("span", null, "🩺"), "Kesehatan Keluarga", h("span", { class: "tag" }, String(list.length))),
    h("button", { class: "btn green", type: "button", onclick: () => openForm(PROFILE) }, "＋ Profil")), tabs());
  const missing = state.members.map((m) => m.display_name).filter((n) => !profileOf(n));
  const quick = missing.length ? h("div", { class: "sos", style: { marginBottom: "1rem" } }, h("span", null, "Buat cepat:"), missing.map((n) =>
    h("button", { class: "btn sm white", type: "button", onclick: () => openForm(PROFILE, null, { person: n }) }, "＋ " + n))) : null;
  if (!list.length) {
    root.append(emptyState("🩺", "Belum ada profil kesehatan", "Isi tanggal lahir, golongan darah, dan tinggi badan tiap anggota. IMT dan berat ideal dihitung otomatis.",
      h("button", { class: "btn green", type: "button", onclick: () => openForm(PROFILE) }, "＋ Buat profil pertama")));
    if (quick) root.append(h("div", { style: { marginTop: "1rem" } }, quick));
    return;
  }
  if (quick) root.append(quick);
  root.append(h("div", { class: "grid wide" }, list.map((p) => profileCard(p, deps))));
  root.append(h("p", { class: "disc" }, "ℹ️ Berat ideal memakai rumus Broca, rentang sehat dari IMT 18,5–25. Status warna hanyalah panduan umum untuk orang dewasa, bukan diagnosis. Konsultasikan hasil dengan dokter."));
}

// ============================================================
// Halaman Kesehatan bertab: Profil · Pengukuran · Catatan
// ============================================================
let tab = "profile";
export function healthView(root, deps) {
  const { renderModule, recMod } = deps;
  const tabs = () => h("div", { class: "filters", role: "tablist", "aria-label": "Bagian kesehatan" },
    [["profile", "👤 Profil"], ["metrics", "📈 Pengukuran"], ["records", "📋 Catatan & Riwayat"]].map(([id, label]) =>
      h("button", { type: "button", role: "tab", "aria-selected": String(id === tab), class: id === tab ? "on" : "", onclick: () => { tab = id; document.dispatchEvent(new CustomEvent("rt:rerender")); } }, label)));
  if (tab === "metrics") return renderModule(metricMod(tabs), root);
  if (tab === "records") return renderModule({ ...recMod, view: undefined, top: (r, rows) => { r.append(tabs()); recMod.top?.(r, rows); } }, root);
  return profilesView(root, deps, tabs);
}
