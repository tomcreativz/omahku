// Pencarian di semua menu (agenda, tugas, belanja, stok, menu, aset, kesehatan, kontak, dst.).
import { h, modal, emptyState } from "./ui.js";
import { state } from "./data.js";
import { MODULES } from "./modules.js";
import { PROFILE, METRIC } from "./health.js";
import { tableLocked, hasPin } from "./lock.js";

const SVC_FIELDS = [{ k: "what", label: "Pekerjaan" }, { k: "workshop", label: "Bengkel" }, { k: "notes", label: "Catatan" }];

function sources() {
  const list = MODULES.map((m) => ({
    route: m.key, table: m.table, icon: m.icon, label: m.nav || m.title, titleField: m.titleField,
    fields: m.fields || [{ k: "name", label: "Nama" }, { k: "qty", label: "Jumlah" }],
  }));
  list.push(
    { route: "health", table: "health_profiles", icon: "🧑‍⚕️", label: "Profil kesehatan", titleField: "person", fields: PROFILE.fields },
    { route: "health", table: "health_metrics", icon: "📈", label: "Pengukuran", titleField: "person", fields: METRIC.fields },
    { route: "maintenance", table: "asset_services", icon: "🔧", label: "Servis aset", titleField: "what", fields: SVC_FIELDS });
  return list;
}

const valueOf = (v) => (Array.isArray(v) ? v.map((x) => x?.t ?? "").join(", ") : typeof v === "string" || typeof v === "number" ? String(v) : "");
const fold = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function searchAll(query) {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const out = [];
  for (const src of sources()) {
    if (tableLocked(src.table)) continue; // menu terkunci PIN tidak ikut dicari
    for (const r of state.data[src.table] || []) {
      const parts = src.fields.map((f) => ({ label: f.label, k: f.k, text: valueOf(r[f.k]) })).filter((x) => x.text);
      const hay = fold(parts.map((x) => x.text).join(" \n "));
      if (!terms.every((t) => hay.includes(t))) continue;
      const tk = src.titleField || ["title", "name", "dish", "person"].find((k) => r[k]) || src.fields[0].k;
      const title = valueOf(r[tk]) || parts[0]?.text || "(tanpa judul)";
      const inTitle = terms.every((t) => fold(title).includes(t));
      const hit = parts.find((x) => x.k !== tk && terms.some((t) => fold(x.text).includes(t)));
      let snippet = "";
      if (hit) {
        const i = Math.max(0, fold(hit.text).indexOf(terms.find((t) => fold(hit.text).includes(t))) - 25);
        snippet = `${hit.label}: ${i > 0 ? "…" : ""}${hit.text.slice(i, i + 90)}${hit.text.length > i + 90 ? "…" : ""}`;
      }
      out.push({ route: src.route, icon: src.icon, label: src.label, title, snippet, rank: inTitle ? 0 : 1 });
    }
  }
  return out.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title)).slice(0, 40);
}

export function openSearch() {
  const input = h("input", { type: "text", placeholder: "Cari apa saja… (mis. dokter, susu, pajak)", autocomplete: "off", "aria-label": "Cari", enterkeyhint: "search" });
  const list = h("div", { style: { display: "flex", flexDirection: "column", gap: ".5rem", marginTop: ".9rem" } });
  let close = () => {};
  const draw = () => {
    const q = input.value.trim();
    if (!q) { list.replaceChildren(h("div", { class: "note", style: { color: "var(--muted)" } }, "Ketik kata kunci. Pencarian mencakup agenda, tugas, belanja, stok, menu, aset, kesehatan, kontak, dan lainnya.")); return; }
    const res = searchAll(q);
    const lockNote = tableLocked("health_records") || tableLocked("assets") ? h("div", { class: "note", style: { color: "var(--muted)" } }, "🔒 Data Kesehatan, Aset, dan Dokumen tidak ikut dicari selama terkunci. Buka menunya dulu dengan PIN.") : null;
    if (!res.length) { list.replaceChildren(emptyState("🔍", "Tidak ditemukan", `Tidak ada hasil untuk “${q}”.`), ...(lockNote ? [lockNote] : [])); return; }
    const items = res.map((r) => h("a", { class: "li", href: "#/" + r.route, style: { textDecoration: "none" }, onclick: () => close() },
      h("span", { style: { fontSize: "1.4rem" } }, r.icon),
      h("div", { class: "grow" }, h("b", null, r.title), h("small", null, r.label + (r.snippet ? " · " + r.snippet : "")))));
    if (res.length >= 40) items.push(h("div", { class: "note" }, "Menampilkan 40 hasil pertama. Perjelas kata kuncinya."));
    if (lockNote) items.push(lockNote);
    list.replaceChildren(...items);
  };
  input.addEventListener("input", draw);
  close = modal("🔍 Cari", h("div", null, input, list));
  draw();
}
