// Dokumen penting (sertifikat rumah, KK, KTP, BPKB, polis, ijazah, dll). Berada di menu Aset (tab "Dokumen").
import { h, chip, today, daysBetween, fmtDate, fmtShort } from "./ui.js";
import { state } from "./data.js";

export const DOC_CATS = ["Identitas & keluarga", "Properti", "Kendaraan", "Asuransi & jaminan", "Pendidikan", "Kesehatan", "Lainnya"];
const ICON = { "Identitas & keluarga": "🪪", "Properti": "🏠", "Kendaraan": "🚗", "Asuransi & jaminan": "🛡️", "Pendidikan": "🎓", "Kesehatan": "🩺", "Lainnya": "📄" };
export const COPY = ["Belum ada", "Foto di HP", "Scan di cloud / komputer", "Fotokopi"];
// [nama, kategori, ada masa berlaku?]
export const SUGGEST = [
  ["Kartu Keluarga (KK)", "Identitas & keluarga"], ["KTP", "Identitas & keluarga"], ["Akta kelahiran", "Identitas & keluarga"], ["Akta / buku nikah", "Identitas & keluarga"],
  ["Paspor", "Identitas & keluarga", true], ["SIM", "Identitas & keluarga", true], ["NPWP", "Identitas & keluarga"],
  ["Sertifikat rumah / tanah", "Properti"], ["PBB", "Properti"], ["IMB / PBG", "Properti"], ["BPKB", "Kendaraan"],
  ["Polis asuransi", "Asuransi & jaminan", true], ["BPJS Kesehatan", "Asuransi & jaminan"], ["Ijazah", "Pendidikan"], ["Buku KIA", "Kesehatan"],
];
const revealed = new Set();
const rerender = () => document.dispatchEvent(new CustomEvent("rt:rerender"));
const fold = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export const daysLeft = (d, now = today()) => (d?.expiry_date ? daysBetween(now, d.expiry_date) : null);
const remindOf = (d) => (Number(d.remind_days) > 0 ? Number(d.remind_days) : 60);
export function statusOf(d, now = today()) {
  const n = daysLeft(d, now);
  if (n == null) return { n: null, tone: "green", text: "", level: 9 };
  if (n < 0) return { n, tone: "red", text: `Kedaluwarsa ${-n} hari lalu`, level: 0 };
  if (n === 0) return { n, tone: "red", text: "Berakhir hari ini", level: 0 };
  if (n <= remindOf(d)) return { n, tone: n <= 14 ? "red" : "orange", text: n < 60 ? `${n} hari lagi` : `${Math.round(n / 30)} bulan lagi`, level: 1 };
  return { n, tone: "green", text: n < 60 ? `${n} hari lagi` : n < 700 ? `${Math.round(n / 30)} bulan lagi` : `${(n / 365).toFixed(1).replace(".0", "")} tahun lagi`, level: 2 };
}
// Untuk Beranda: dokumen yang masa berlakunya segera habis atau sudah lewat.
export function docAlerts(now = today()) {
  return state.data.documents.map((d) => ({ d, st: statusOf(d, now) })).filter((x) => x.st.level <= 1).sort((a, b) => a.st.n - b.st.n);
}
const noCopy = (d) => !d.copy || d.copy === "Belum ada";
const mask = (s) => { const t = String(s); return t.length <= 4 ? "••••" : "•".repeat(Math.min(8, t.length - 4)) + t.slice(-4); };
const safeUrl = (u) => { try { const x = new URL(u); return x.protocol === "http:" || x.protocol === "https:" ? x.href : null; } catch { return null; } };

// Tab "Aset | Dokumen" yang tampil di kedua halaman
export function docTabs(active) {
  const n = state.data.documents.length, soon = docAlerts().length;
  const go = (to) => () => { if (location.hash !== "#/" + to) location.hash = "#/" + to; };
  return h("div", { class: "filters", role: "tablist", "aria-label": "Aset dan dokumen" },
    h("button", { type: "button", role: "tab", "aria-selected": String(active === "assets"), class: active === "assets" ? "on" : "", onclick: go("assets") }, "🏍️ Aset & kendaraan"),
    h("button", { type: "button", role: "tab", "aria-selected": String(active === "documents"), class: active === "documents" ? "on" : "", onclick: go("documents") }, `📄 Dokumen penting (${n})${soon ? " ⚠" : ""}`));
}

export function documentModule({ openForm }) {
  const mod = {
    key: "documents", table: "documents", title: "Dokumen Penting", nav: "Dokumen", singular: "Dokumen", icon: "📄", color: "blue", titleField: "name", hidden: true,
    emptyTitle: "Belum ada dokumen tercatat", emptyText: "Catat dokumen penting keluarga: di mana disimpan, nomornya, dan kapan berakhir. Pilih dari daftar usulan di atas untuk memulai.",
    fields: [
      { k: "name", label: "Nama dokumen", required: true, placeholder: "mis. Sertifikat rumah (SHM)" },
      { k: "category", label: "Kategori", type: "select", options: DOC_CATS, half: true, default: "Identitas & keluarga" },
      { k: "person", label: "Atas nama / pemilik", type: "person", half: true, placeholder: "mis. Budi, atau Keluarga" },
      { k: "doc_no", label: "Nomor dokumen", half: true, placeholder: "Opsional", inputmode: "text" },
      { k: "location", label: "Disimpan di", half: true, placeholder: "mis. Lemari kamar, map biru" },
      { k: "issue_date", label: "Tanggal terbit", type: "date", half: true },
      { k: "expiry_date", label: "Berlaku sampai", type: "date", half: true, hint: "Kosongkan jika berlaku seumur hidup" },
      { k: "remind_days", label: "Ingatkan sebelum berakhir (hari)", type: "number", half: true, min: 1, default: 60 },
      { k: "copy", label: "Salinan digital", type: "select", options: COPY, half: true, default: "Belum ada" },
      { k: "link", label: "Tautan salinan (opsional)", placeholder: "https://… (Google Drive, dll.)", hint: "Hanya tautan ke salinan Anda sendiri." },
      { k: "notes", label: "Catatan", type: "textarea", placeholder: "mis. Atas nama almarhum ayah, asli di bank" },
    ],
    validate: (o) => (o.link && !safeUrl(String(o.link).trim()) ? "Tautan harus diawali https://" : o.issue_date && o.expiry_date && o.expiry_date < o.issue_date ? "Tanggal berakhir tidak boleh sebelum tanggal terbit." : ""),
    beforeSave: (o) => { if (o.link) o.link = String(o.link).trim(); o.remind_days = Number(o.remind_days) > 0 ? Math.round(Number(o.remind_days)) : 60; },
    top: (root) => {
      const have = state.data.documents.map((d) => fold(d.name));
      const todo = SUGGEST.filter(([n]) => !have.some((x) => x.includes(fold(n)) || fold(n).includes(x)));
      root.append(docTabs("documents"));
      root.append(h("section", { class: "box card", style: { marginBottom: "1rem", background: "var(--tint-blue, var(--soft))" } },
        todo.length ? h("div", null, h("b", null, "Dokumen yang umumnya perlu dicatat"), h("div", { class: "meta", style: { display: "flex", flexWrap: "wrap", gap: ".4rem", marginTop: ".5rem" } }, todo.map(([n, c, ex]) =>
          h("button", { class: "btn sm white", type: "button", onclick: () => openForm(mod, null, { name: n, category: c }) }, "＋ " + n)))) : h("b", null, "👍 Semua dokumen umum sudah tercatat."),
        h("div", { class: "note", style: { color: "var(--muted)" } }, "Aplikasi ini mencatat lokasi, nomor, dan masa berlaku, bukan menyimpan fotonya. Jangan menulis password, PIN ATM, atau kode rahasia di sini.")));
    },
    filters: (rows) => {
      const cnt = (c) => rows.filter((r) => (r.category || "Lainnya") === c).length, now = today();
      return [[{ id: "all", label: "Semua" }, { id: "soon", label: "⚠ Segera habis / kedaluwarsa", test: (r) => statusOf(r, now).level <= 1 }, { id: "nocopy", label: "📷 Belum ada salinan", test: noCopy }],
        [{ id: "all", label: "Semua kategori" }, ...DOC_CATS.filter((c) => cnt(c) > 0).map((c) => ({ id: c, label: `${ICON[c]} ${c} (${cnt(c)})`, test: (r) => (r.category || "Lainnya") === c }))]];
    },
    sort: (a, b) => statusOf(a).level - statusOf(b).level || (a.category || "").localeCompare(b.category || "") || (a.name || "").localeCompare(b.name || ""),
    card: (r) => {
      const st = statusOf(r), shown = revealed.has(r.id), link = r.link ? safeUrl(r.link) : null;
      const color = st.level === 0 ? "red" : st.level === 1 ? "orange" : "blue";
      return {
        title: `${ICON[r.category] || "📄"} ${r.name}`, color,
        meta: [r.person ? chip("👤 " + r.person, "lilac") : null, r.category ? chip(r.category, "blue") : null,
          r.expiry_date ? chip(`${st.level <= 1 ? "⚠ " : "⏳ "}Berlaku s/d ${fmtShort(r.expiry_date)} · ${st.text}`, st.tone) : r.issue_date ? chip("Seumur hidup", "green") : null,
          noCopy(r) ? chip("📷 Belum ada salinan", "yellow") : chip("✅ " + r.copy, "green")],
        body: [
          r.location ? h("div", { class: "note" }, "📍 Disimpan di: ", h("b", null, r.location)) : h("div", { class: "note", style: { color: "var(--muted)" } }, "📍 Lokasi penyimpanan belum diisi"),
          r.doc_no ? h("div", { class: "note", style: { display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap" } }, "No: ", h("b", { style: { fontVariantNumeric: "tabular-nums", letterSpacing: shown ? "0" : ".08em" } }, shown ? r.doc_no : mask(r.doc_no)),
            h("button", { class: "btn sm white", type: "button", "aria-label": shown ? "Sembunyikan nomor" : "Tampilkan nomor", onclick: () => { shown ? revealed.delete(r.id) : revealed.add(r.id); rerender(); } }, shown ? "🙈 Sembunyikan" : "👁 Tampilkan")) : null,
          r.issue_date ? h("div", { class: "note" }, "Terbit: " + fmtDate(r.issue_date)) : null,
          r.notes ? h("div", { class: "note" }, r.notes) : null,
        ],
        actions: [link ? h("a", { class: "btn sm blue", href: link, target: "_blank", rel: "noopener noreferrer" }, "🔗 Buka salinan") : null],
      };
    },
  };
  return mod;
}
