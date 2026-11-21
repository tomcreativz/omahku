// Definisi modul + tampilan daftar generik.
import { h, chip, copyText, modal, confirmBox, toast, emptyState, today, addDays, addMonths, daysBetween, fmtDate, fmtShort, hhmm, relDay, waNumber } from "./ui.js";
import { state, meMember, memberName, insertRow, insertMany, updateRow, deleteRow, deleteMany } from "./data.js";
import { openAIAdvisor, completeRecipe, openWeeklyPlanner } from "./ai.js";
import { healthView } from "./health.js";
import { openStockIn, openCook, undoCook, openSuggest, shoppingSuggestions } from "./kitchenui.js";
import { availability, candidates, qtyText, STOCK_CATS } from "./kitchen.js";
import { assetModule, serviceTools, serviceAssets } from "./assets.js";
import { documentModule, docTabs } from "./documents.js";
import { CATS, CAT_ICON, TYPES, CONDITIONS, STATUS, RELEASE, IDLE_DAYS, isGone, isIdle, idleDays, idleText, summarize, piecesOf, idleList } from "./clothes.js";

export async function run(fn, okMsg) {
  try { await fn(); if (okMsg) toast(okMsg, "ok"); return true; }
  catch (e) { console.error(e); toast(e?.message || "Terjadi kesalahan", "err"); return false; }
}

const DEFAULT_SOS = [["112", "Darurat umum"], ["119", "Ambulans"], ["110", "Polisi"], ["113", "Pemadam"], ["115", "SAR"]];
function editSos(current) {
  const rows = h("div", { style: { display: "flex", flexDirection: "column", gap: ".5rem" } });
  const addRow = (n = "", l = "") => {
    const r = h("div", { style: { display: "grid", gridTemplateColumns: "90px 1fr auto", gap: ".4rem", alignItems: "center" } },
      h("input", { type: "tel", inputMode: "tel", placeholder: "Nomor", value: n, "aria-label": "Nomor", maxLength: 20 }),
      h("input", { type: "text", placeholder: "Keterangan", value: l, "aria-label": "Keterangan", maxLength: 40 }),
      h("button", { class: "btn sm white icon-btn", type: "button", "aria-label": "Hapus baris", onclick: () => r.remove() }, "🗑"));
    rows.append(r);
  };
  current.forEach(([n, l]) => addRow(n, l));
  let close;
  const save = async () => {
    const items = [...rows.children].map((r) => { const i = r.querySelectorAll("input"); return { number: i[0].value.trim(), label: i[1].value.trim() }; }).filter((x) => x.number);
    if (items.some((x) => !/^[\d+*#\s-]+$/.test(x.number))) return toast("Nomor hanya boleh berisi angka.", "err");
    if (await run(async () => {
      const old = (state.data.sos_numbers || []).map((r) => r.id);
      if (old.length) await deleteMany("sos_numbers", old);
      if (items.length) await insertMany("sos_numbers", items.map((x) => ({ ...x, label: x.label || "Darurat" })));
    }, "Nomor darurat disimpan")) close();
  };
  const reset = async () => {
    if (await run(async () => { const old = (state.data.sos_numbers || []).map((r) => r.id); if (old.length) await deleteMany("sos_numbers", old); }, "Dikembalikan ke standar")) close();
  };
  close = modal("Ubah nomor darurat", h("div", null,
    h("p", { class: "hint", style: { marginBottom: ".8rem" } }, "Nomor ini dipakai bersama oleh seluruh anggota rumah. Tambahkan nomor lokal, mis. puskesmas atau satpam."),
    rows,
    h("button", { class: "btn sm white", type: "button", style: { marginTop: ".7rem" }, onclick: () => addRow() }, "＋ Tambah nomor"),
    h("div", { class: "foot", style: { marginTop: "1rem" } },
      h("button", { class: "btn white", type: "button", onclick: reset }, "↺ Standar"),
      h("button", { class: "btn green", type: "button", onclick: save }, "Simpan"))));
}

const by = (...fns) => (a, b) => { for (const f of fns) { const x = f(a), y = f(b); if (x < y) return -1; if (x > y) return 1; } return 0; };
const BIG = "9999-12-31";
const bool = (v) => (v ? 1 : 0);

// ============================================================
// Form generik
// ============================================================
function memberOptions() {
  return [["", "— Belum ditentukan —"], ...state.members.map((m) => [m.user_id, `${m.display_name} (${m.role_name})`]), ["both", "Berdua"]];
}

export function openForm(mod, row = null, prefill = {}) {
  const isEdit = !!row;
  const inputs = {};
  const val = (f) => {
    if (isEdit) {
      if (f.type === "lines") return (row[f.k] || []).map((x) => x.t).join("\n");
      if (f.type === "time") return hhmm(row[f.k]);
      return row[f.k] ?? "";
    }
    return prefill[f.k] ?? (typeof f.default === "function" ? f.default() : f.default) ?? "";
  };

  const build = (f) => {
    const id = `f_${mod.key}_${f.k}`;
    let input;
    const v = val(f);
    if (f.type === "textarea" || f.type === "lines") input = h("textarea", { id, placeholder: f.placeholder || "", rows: f.type === "lines" ? 4 : 3 });
    else if (f.type === "select" || f.type === "member") {
      const opts = f.type === "member" ? memberOptions() : (f.options || []).map((o) => (Array.isArray(o) ? o : [o, o]));
      input = h("select", { id }, opts.map(([ov, ol]) => h("option", { value: ov }, ol)));
    } else if (f.type === "range") input = h("input", { id, type: "range", min: 0, max: 100, step: 5 });
    else if (f.type === "person") {
      const names = new Set([...state.members.map((m) => m.display_name), ...state.data.health_records.map((r) => r.person), ...state.data.health_profiles.map((r) => r.person), ...state.data.health_metrics.map((r) => r.person)]);
      const dl = h("datalist", { id: id + "_dl" }, [...names].map((n) => h("option", { value: n })));
      input = h("input", { id, type: "text", list: id + "_dl", placeholder: f.placeholder || "", autocomplete: "off" });
      inputs[f.k + "_dl"] = dl;
    } else input = h("input", { id, type: f.type || "text", placeholder: f.placeholder || "", inputmode: f.inputmode, step: f.type === "number" ? "any" : undefined, min: f.min });
    if (f.type === "range") { input.value = v === "" ? 0 : v; } else input.value = v;
    inputs[f.k] = input;
    const out = h("div", { class: "field" }, h("label", { for: id }, f.label + (f.required ? " *" : "")), input, inputs[f.k + "_dl"] || null,
      f.type === "range" ? h("div", { class: "hint", id: id + "_out" }, `${input.value}%`) : null,
      f.hint ? h("div", { class: "hint" }, f.hint) : null);
    if (f.type === "range") input.addEventListener("input", () => { out.querySelector(".hint").textContent = input.value + "%"; });
    return out;
  };

  const body = [];
  for (let i = 0; i < mod.fields.length; i++) {
    const f = mod.fields[i], n = mod.fields[i + 1];
    if (f.half && n?.half) { body.push(h("div", { class: "row" }, build(f), build(n))); i++; } else body.push(build(f));
  }

  const err = h("div", { class: "msg err", hidden: true });
  const submit = h("button", { class: "btn primary " + (mod.color || ""), type: "submit" }, isEdit ? "Simpan" : "Tambah");
  const form = h("form", { novalidate: true }, err, body,
    h("div", { class: "foot" }, h("button", { class: "btn white", type: "button", onclick: () => close() }, "Batal"), submit));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = {};
    for (const f of mod.fields) {
      let v = inputs[f.k].value;
      if (typeof v === "string") v = v.trim();
      if (f.required && !v) { err.textContent = `${f.label} wajib diisi.`; err.hidden = false; inputs[f.k].focus(); return; }
      if (f.type === "number" || f.type === "range") v = v === "" ? null : Number(v);
      else if (f.type === "lines") {
        const old = isEdit ? row[f.k] || [] : [];
        v = v.split("\n").map((s) => s.trim()).filter(Boolean).map((t) => ({ t, d: !!old.find((o) => o.t === t)?.d }));
      } else if (v === "" && ["date", "time", "member", "select", "tel", "text", "textarea"].includes(f.type || "text")) v = f.required ? v : null;
      out[f.k] = v;
    }
    const bad = mod.validate?.(out);
    if (bad) { err.textContent = bad; err.hidden = false; return; }
    mod.beforeSave?.(out);
    submit.disabled = true;
    const ok = await run(async () => { await (isEdit ? updateRow(mod.table, row.id, out) : insertRow(mod.table, out)); await mod.afterSave?.(out, row); }, isEdit ? "Tersimpan ✓" : "Ditambahkan ✓");
    submit.disabled = false;
    if (ok) close();
  });

  const close = modal(`${isEdit ? "Ubah" : "Tambah"} ${mod.singular}`, form);
  return close;
}

// ============================================================
// Tampilan daftar generik
// ============================================================
const uiState = {};

export function renderModule(mod, root) {
  if (mod.view) return mod.view(root);
  const rows = state.data[mod.table];
  const st = (uiState[mod.key] ||= {});
  const groups = mod.filters ? mod.filters(rows) : [];
  groups.forEach((g, i) => { if (!g.find((o) => o.id === st[i])) st[i] = g[0].id; });

  let shown = rows;
  groups.forEach((g, i) => { const o = g.find((x) => x.id === st[i]); if (o?.test) shown = shown.filter(o.test); });
  shown = [...shown].sort(mod.sort || (() => 0));

  const api = {
    edit: (r) => openForm(mod, r),
    remove: async (r) => { if (await confirmBox(`Hapus “${r[mod.titleField || "title"] || r.name || r.dish}”?`)) run(async () => { await deleteRow(mod.table, r.id); await mod.afterRemove?.(r); }, "Dihapus"); },
    patch: (r, p, msg) => run(() => updateRow(mod.table, r.id, p), msg),
  };

  root.append(h("div", { class: "page-head" },
    h("h1", null, h("span", null, mod.icon), mod.title, h("span", { class: "tag" }, String(shown.length))),
    h("button", { class: "btn " + (mod.color || ""), type: "button", onclick: () => openForm(mod) }, "＋ Tambah")));

  mod.top?.(root, rows);

  for (let gi = 0; gi < groups.length; gi++) {
    if (groups[gi].length < 2) continue;
    root.append(h("div", { class: "filters", role: "group", "aria-label": "Filter" }, groups[gi].map((o) =>
      h("button", { type: "button", class: o.id === st[gi] ? "on" : "", onclick: () => { st[gi] = o.id; document.dispatchEvent(new CustomEvent("rt:rerender")); } }, o.label))));
  }

  if (!shown.length) {
    root.append(emptyState(mod.icon, rows.length ? "Tidak ada yang cocok" : mod.emptyTitle || "Belum ada data", mod.emptyText,
      h("button", { class: "btn " + (mod.color || ""), type: "button", onclick: () => openForm(mod) }, "＋ Tambah " + mod.singular.toLowerCase())));
    return;
  }

  const grid = h("div", { class: "grid" + (mod.wide ? " wide" : "") });
  if (mod.groupBy) {
    let cur = null, g = null;
    for (const r of shown) {
      const key = mod.groupBy(r);
      if (key !== g) { g = key; root.append(h("div", { class: "group-title" }, key)); cur = h("div", { class: "grid" + (mod.wide ? " wide" : "") }); root.append(cur); }
      cur.append(wrapCard(mod, r, api));
    }
  } else {
    for (const r of shown) grid.append(wrapCard(mod, r, api));
    root.append(grid);
  }
}

function wrapCard(mod, r, api) {
  const c = mod.card(r, api);
  const acts = h("div", { class: "acts" }, c.actions || [],
    h("button", { class: "btn sm white", type: "button", onclick: () => api.edit(r) }, "✏️ Ubah"),
    h("button", { class: "btn sm white", type: "button", "aria-label": "Hapus", onclick: () => api.remove(r) }, "🗑"));
  const left = c.check ? h("input", { type: "checkbox", checked: c.check.on, "aria-label": c.check.label || "Selesai", onchange: (e) => c.check.set(e.target.checked) }) : null;
  return h("article", { class: "box card accent" + (c.done ? " done" : ""), style: { borderLeftColor: `var(--${c.color || "yellow"})` } },
    h("div", { class: "top" }, left, h("div", { class: "grow" }, h("div", { class: "ct" }, c.title), c.meta?.length ? h("div", { class: "meta", style: { marginTop: ".4rem" } }, c.meta) : null)),
    c.body || null, acts);
}

// ============================================================
// Menu Perawatan: rumah + kendaraan (servis, riwayat, KM, saran AI)
// ============================================================
function maintenanceView(root) {
  const mod = modByKey.maintenance, assetMod = modByKey.assets;
  const st = (uiState.maintenance ||= { f: "all" });
  const tools = serviceTools({ openForm, run });
  const homeRows = state.data.maintenance, veh = serviceAssets();
  const homeSoon = (r) => { const n = nextDue(r); return n && daysBetween(today(), n) <= 14; };
  const FILTERS = [["all", "Semua"], ["home", "🏠 Rumah"], ["veh", "🚗 Kendaraan"], ["soon", "⚠ Segera / terlambat"]];
  const showHome = st.f !== "veh", showVeh = st.f !== "home";
  let home = showHome ? homeRows : [], vs = showVeh ? veh : [];
  if (st.f === "soon") { home = home.filter(homeSoon); vs = vs.filter((a) => tools.urgency(a) <= 14); }
  home = [...home].sort(mod.sort); vs = [...vs].sort((a, b) => tools.urgency(a) - tools.urgency(b) || (a.name || "").localeCompare(b.name || ""));
  const api = {
    edit: (r) => openForm(mod, r),
    remove: async (r) => { if (await confirmBox(`Hapus “${r.title}”?`)) run(() => deleteRow("maintenance", r.id), "Dihapus"); },
    patch: (r, p, msg) => run(() => updateRow("maintenance", r.id, p), msg),
  };
  root.append(h("div", { class: "page-head" },
    h("h1", null, h("span", null, mod.icon), mod.title, h("span", { class: "tag" }, String(home.length + vs.length))),
    h("div", { style: { display: "flex", gap: ".5rem", flexWrap: "wrap" } },
      h("button", { class: "btn orange", type: "button", onclick: () => openForm(mod) }, "＋ Rumah"),
      h("button", { class: "btn blue", type: "button", onclick: () => openForm(assetMod, null, { type: "Motor" }) }, "＋ Kendaraan"))),
    h("div", { class: "filters", role: "group", "aria-label": "Filter" }, FILTERS.map(([id, label]) =>
      h("button", { type: "button", class: id === st.f ? "on" : "", onclick: () => { st.f = id; document.dispatchEvent(new CustomEvent("rt:rerender")); } }, label))));
  if (!home.length && !vs.length) {
    root.append(emptyState(mod.icon, homeRows.length || veh.length ? "Tidak ada yang cocok" : "Belum ada jadwal perawatan",
      "Servis AC, kuras bak mandi, ganti filter air, servis motor atau mobil, ganti oli…",
      h("div", { style: { display: "flex", gap: ".5rem", flexWrap: "wrap", justifyContent: "center" } },
        h("button", { class: "btn orange", type: "button", onclick: () => openForm(mod) }, "＋ Perawatan rumah"),
        h("button", { class: "btn blue", type: "button", onclick: () => openForm(assetMod, null, { type: "Motor" }) }, "＋ Kendaraan"))));
    return;
  }
  if (home.length) { if (st.f === "all" || st.f === "soon") root.append(h("div", { class: "group-title" }, "🏠 Rumah")); root.append(h("div", { class: "grid" }, home.map((r) => wrapCard(mod, r, api)))); }
  if (vs.length) { if (st.f === "all" || st.f === "soon") root.append(h("div", { class: "group-title" }, "🚗 Kendaraan")); root.append(h("div", { class: "grid wide" }, vs.map((a) => tools.card(a)))); }
  if (showVeh && !veh.length) root.append(h("p", { class: "disc" }, "Belum ada kendaraan. Tekan “＋ Kendaraan” untuk mencatat motor atau mobil beserta jadwal servisnya."));
}

// ============================================================
// Lemari pakaian: ringkasan, target, rapikan, lepas
// ============================================================
function targetModal(person) {
  const cur = state.data.clothes_targets.find((x) => x.person === person);
  const inp = h("input", { type: "number", min: 1, inputmode: "numeric", value: cur?.target ?? "", "aria-label": "Target jumlah pakaian", placeholder: "mis. 60" });
  let close;
  const save = async (val) => {
    if (await run(async () => {
      if (val == null) { if (cur) await deleteRow("clothes_targets", cur.id); }
      else if (cur) await updateRow("clothes_targets", cur.id, { target: val });
      else await insertRow("clothes_targets", { person, target: val });
    }, val == null ? "Target dihapus" : "Target disimpan ✓")) close();
  };
  close = modal(`Target pakaian · ${person}`, h("form", { novalidate: true, onsubmit: (e) => { e.preventDefault(); const v = Math.round(Number(inp.value)); if (!inp.value || !(v >= 1)) return toast("Isi angka lebih dari 0.", "err"); save(v); } },
    h("p", { class: "hint", style: { marginBottom: ".8rem" } }, "Batas jumlah pakaian (potong) yang nyaman untuk satu orang. Aplikasi akan mengingatkan jika lemari melebihi target. Pakaian yang sudah dilepas tidak dihitung."),
    h("div", { class: "field" }, h("label", null, "Target total pakaian (potong)"), inp),
    h("div", { class: "foot" }, cur ? h("button", { class: "btn white", type: "button", onclick: () => save(null) }, "Hapus target") : null, h("button", { class: "btn primary blue", type: "submit" }, "Simpan"))));
}

function releaseModal(r, api) {
  let close;
  const pick = async (how) => { if (await run(() => updateRow("clothes", r.id, { status: STATUS.gone, released_how: how, released_on: today() }), "Dicatat sudah dilepas ✓")) close(); };
  close = modal(`Lepas: ${r.name}`, h("div", null,
    h("p", { style: { marginBottom: ".8rem" } }, "Diapakan pakaian ini? Catatannya tetap tersimpan di “Sudah dilepas”, dan jumlah lemari berkurang."),
    h("div", { style: { display: "flex", flexDirection: "column", gap: ".5rem" } }, RELEASE.map((how) => h("button", { class: "btn white", type: "button", onclick: () => pick(how) }, how)))));
}

function tidyModal(rows) {
  const now = today(), list = idleList(rows, now);
  let close;
  const body = h("div", { style: { display: "flex", flexDirection: "column", gap: ".5rem" } });
  const draw = () => {
    const cur = idleList(rows.map((r) => state.data.clothes.find((x) => x.id === r.id) || r), now);
    if (!cur.length) { body.replaceChildren(h("div", { class: "msg" }, "Beres! Tidak ada lagi pakaian yang jarang dipakai. 🌿")); return; }
    body.replaceChildren(...cur.map((r) => h("div", { class: "li", style: { alignItems: "flex-start", flexWrap: "wrap" } },
      h("div", { class: "grow" }, h("b", null, r.name + (Number(r.qty) > 1 ? ` ×${Number(r.qty)}` : "")), h("small", null, [r.person, r.category, `terakhir dipakai ${idleText(idleDays(r, now))}`].filter(Boolean).join(" · "))),
      h("div", { style: { display: "flex", gap: ".4rem", flexWrap: "wrap" } },
        h("button", { class: "btn sm green", type: "button", onclick: async () => { await run(() => updateRow("clothes", r.id, { last_worn: now }), "Masih dipakai ✓"); draw(); } }, "Masih dipakai"),
        h("button", { class: "btn sm orange", type: "button", onclick: async () => { await run(() => updateRow("clothes", r.id, { status: STATUS.ready }), "Ditandai siap dilepas"); draw(); } }, "📤 Lepas")))));
  };
  draw();
  close = modal("🧹 Rapikan lemari", h("div", null,
    h("p", { class: "hint", style: { marginBottom: ".8rem" } }, `Pakaian ini tidak tercatat dipakai ≥ ${IDLE_DAYS} hari (3 bulan). Tanyakan: apakah benar-benar masih dipakai? Kalau ya, tekan “Masih dipakai”. Kalau tidak, tandai untuk dilepas (donasi, jual, atau berikan).`),
    body, h("div", { class: "foot" }, h("button", { class: "btn white", type: "button", onclick: () => close() }, "Tutup"))));
  return list.length;
}

function clothesTop(root, rows) {
  const st = uiState.clothes || {}, sel = String(st[0] || "all"), person = sel.startsWith("p:") ? sel.slice(2) : null, now = today();
  const scope = person ? rows.filter((r) => r.person === person) : rows;
  const s = summarize(scope, now);
  const vital = (label, val, sub) => h("div", { class: "vital" }, h("small", null, label), h("b", null, String(val)), sub ? h("span", { class: "sub" }, sub) : null);
  const cats = Object.entries(s.byCat).sort((a, b) => b[1] - a[1]);
  const meter = (n, t) => h("div", { class: "bar", style: { height: "14px", marginTop: ".25rem" } }, h("i", { style: { width: Math.min(100, Math.round((n / t) * 100)) + "%", background: n > t ? "var(--red)" : "var(--green)" } }));
  let target = null;
  if (person) {
    const t = state.data.clothes_targets.find((x) => x.person === person)?.target;
    target = h("div", null,
      h("div", { style: { display: "flex", justifyContent: "space-between", gap: ".5rem", alignItems: "center", flexWrap: "wrap" } },
        h("b", null, t ? `Target ${person}: ${s.pieces} / ${t} potong${s.pieces > t ? " ⚠ melebihi" : ""}` : `${person} belum punya target jumlah pakaian`),
        h("button", { class: "btn sm white", type: "button", onclick: () => targetModal(person) }, t ? "🎯 Ubah target" : "🎯 Atur target")),
      t ? meter(s.pieces, t) : null);
  } else {
    const names = [...new Set(rows.map((r) => r.person).filter(Boolean))];
    if (names.length) target = h("div", { style: { display: "flex", flexDirection: "column", gap: ".5rem" } }, names.map((n) => {
      const pcs = piecesOf(rows, n), t = state.data.clothes_targets.find((x) => x.person === n)?.target;
      return h("div", null, h("div", { style: { display: "flex", justifyContent: "space-between", gap: ".5rem", flexWrap: "wrap" } }, h("b", null, n), h("span", null, t ? `${pcs} / ${t} potong${pcs > t ? " ⚠" : ""}` : `${pcs} potong`)), t ? meter(pcs, t) : null);
    }));
  }
  root.append(h("section", { class: "box panel", style: { marginBottom: "1.2rem" } },
    h("h3", { style: { background: "var(--blue)" } }, h("span", null, `👕 Ringkasan lemari${person ? " · " + person : ""}`),
      h("button", { class: "btn sm white more", type: "button", onclick: () => { if (!rows.some((r) => isIdle(r, now))) return toast("Tidak ada pakaian yang jarang dipakai. Lemari sudah rapi 🌿"); tidyModal(scope.length ? scope : rows); } }, `🧹 Rapikan lemari${s.idle ? " (" + s.idle + ")" : ""}`)),
    h("div", { class: "body" },
      h("div", { class: "vitals" }, vital("Total pakaian", s.pieces, "potong"), vital("Jenis pakaian", s.items, "item tercatat"),
        vital("Jarang dipakai", s.idle, `≥ ${IDLE_DAYS} hari`), vital("Siap dilepas", s.ready, "menunggu"), vital("Sudah dilepas", s.gone, "lemari lebih ringan"), s.repair ? vital("Perlu perbaikan", s.repair, "jahit / ganti") : null),
      cats.length ? h("div", { class: "meta", style: { display: "flex", flexWrap: "wrap", gap: ".4rem" } }, cats.map(([c, n]) => chip(`${CAT_ICON[c] || "👕"} ${c}: ${n}`, "blue"))) : null,
      target,
      h("details", { class: "steps" }, h("summary", null, "💡 Tips lemari minimalis"),
        h("ol", null, [
          "Aturan 1 masuk, 1 keluar: setiap membeli satu pakaian, lepaskan satu yang lama.",
          "Tekan “👕 Dipakai hari ini” setiap kali memakainya. Setelah beberapa bulan, kelihatan mana yang jarang dipakai.",
          `Tidak dipakai ≥ ${IDLE_DAYS} hari? Tanyakan apakah benar-benar perlu. Yang cukup, lepas (donasi, jual, atau berikan).`,
          "Pakaian rusak: perbaiki sekarang, atau lepaskan. Jangan ditumpuk.",
          "Atur target jumlah tiap orang agar belanja pakaian lebih terkendali.",
        ].map((t) => h("li", null, t)))))));
}

// ============================================================
// Konstanta pilihan
// ============================================================
const REPEAT = { none: "Tidak berulang", daily: "Harian", weekly: "Mingguan", monthly: "Bulanan" };
const MEALS = ["Sarapan", "Makan siang", "Makan malam", "Camilan"];
const dueChip = (date, done) => {
  if (!date) return null;
  const n = daysBetween(today(), date);
  return chip(`${fmtShort(date)} · ${relDay(date)}`, done ? "" : n < 0 ? "red" : n === 0 ? "orange" : "");
};
const expDays = (r) => (r.expiry_date ? daysBetween(today(), r.expiry_date) : null);
const who = (v) => (memberName(v) ? chip("👤 " + memberName(v), "lilac") : null);

// ============================================================
// Modul
// ============================================================
export const MODULES = [
  // ---------------- Agenda ----------------
  {
    key: "agenda", table: "agenda", title: "Agenda Keluarga", nav: "Agenda", singular: "Agenda", icon: "📅", color: "blue",
    emptyTitle: "Belum ada agenda", emptyText: "Catat jadwal penting: kontrol dokter, acara sekolah, arisan, dan lainnya.",
    fields: [
      { k: "title", label: "Kegiatan", required: true, placeholder: "mis. Rapat orang tua murid" },
      { k: "date", label: "Tanggal", type: "date", required: true, half: true, default: today },
      { k: "time", label: "Jam", type: "time", half: true },
      { k: "category", label: "Kategori", type: "select", options: ["Keluarga", "Anak", "Kesehatan", "Pekerjaan", "Sosial", "Lainnya"], half: true, default: "Keluarga" },
      { k: "assignee", label: "Penanggung jawab", type: "member", half: true },
      { k: "notes", label: "Catatan", type: "textarea" },
    ],
    filters: () => [[
      { id: "active", label: "Belum selesai", test: (r) => !r.done },
      { id: "today", label: "Hari ini", test: (r) => r.date === today() },
      { id: "done", label: "Selesai", test: (r) => r.done },
      { id: "all", label: "Semua" },
    ]],
    sort: by((r) => bool(r.done), (r) => r.date, (r) => r.time || "99"),
    card: (r, api) => ({
      title: r.title, done: r.done, color: "blue",
      check: { on: r.done, set: (v) => api.patch(r, { done: v }) },
      meta: [dueChip(r.date, r.done), r.time ? chip("🕐 " + hhmm(r.time)) : null, r.category ? chip(r.category, "blue") : null, who(r.assignee)],
      body: r.notes ? h("div", { class: "note" }, r.notes) : null,
    }),
  },

  // ---------------- Tugas ----------------
  {
    key: "tasks", table: "tasks", title: "Tugas Rumah", nav: "Tugas", singular: "Tugas", icon: "✅", color: "green",
    emptyTitle: "Belum ada tugas", emptyText: "Bagi pekerjaan rumah supaya jelas siapa mengerjakan apa.",
    fields: [
      { k: "title", label: "Tugas", required: true, placeholder: "mis. Menyapu & mengepel" },
      { k: "category", label: "Kategori", type: "select", options: ["Bersih-bersih", "Dapur", "Cucian", "Anak", "Belanja", "Taman & luar", "Lainnya"], half: true, default: "Bersih-bersih" },
      { k: "assignee", label: "Penanggung jawab", type: "member", half: true },
      { k: "due_date", label: "Tenggat", type: "date", half: true },
      { k: "repeat", label: "Ulangi", type: "select", options: Object.entries(REPEAT), half: true, default: "none" },
      { k: "notes", label: "Catatan", type: "textarea" },
    ],
    beforeSave: (o) => { o.repeat ||= "none"; },
    filters: () => [[
      { id: "open", label: "Belum selesai", test: (r) => r.status !== "done" },
      { id: "mine", label: "Tugas saya", test: (r) => r.status !== "done" && (r.assignee === meMember()?.user_id || r.assignee === "both") },
      { id: "done", label: "Selesai", test: (r) => r.status === "done" },
      { id: "all", label: "Semua" },
    ]],
    sort: by((r) => (r.status === "done" ? 1 : 0), (r) => r.due_date || BIG),
    card: (r, api) => {
      const complete = async (on) => {
        if (on && r.repeat && r.repeat !== "none") {
          const step = (d) => (r.repeat === "daily" ? addDays(d, 1) : r.repeat === "weekly" ? addDays(d, 7) : addMonths(d, 1));
          let next = step(r.due_date || today()), guard = 0;
          while (daysBetween(today(), next) <= 0 && guard++ < 400) next = step(next);
          return api.patch(r, { status: "todo", due_date: next }, `Dijadwalkan lagi: ${fmtShort(next)} 🔁`);
        }
        return api.patch(r, { status: on ? "done" : "todo" });
      };
      return {
        title: r.title, done: r.status === "done", color: "green",
        check: { on: r.status === "done", set: complete },
        meta: [r.status === "doing" ? chip("🔧 Dikerjakan", "yellow") : null, dueChip(r.due_date, r.status === "done"), r.category ? chip(r.category, "green") : null, who(r.assignee), r.repeat && r.repeat !== "none" ? chip("🔁 " + REPEAT[r.repeat]) : null],
        body: r.notes ? h("div", { class: "note" }, r.notes) : null,
        actions: r.status === "todo" ? [h("button", { class: "btn sm yellow", type: "button", onclick: () => api.patch(r, { status: "doing" }) }, "▶ Mulai")] : [],
      };
    },
  },

  // ---------------- Belanja (tampilan khusus) ----------------
  {
    key: "shopping", table: "shopping_items", title: "Daftar Belanja", nav: "Belanja", singular: "Barang", icon: "🛒", color: "orange",
    view: (root) => {
      const rows = [...state.data.shopping_items].sort(by((r) => bool(r.done), (r) => r.created_at));
      const doneIds = rows.filter((r) => r.done).map((r) => r.id);
      const todo = rows.filter((r) => !r.done);
      const rp = (n) => "Rp " + Math.round(n).toLocaleString("id-ID");
      const priceOf = (r) => (r.price != null && r.price !== "" && Number(r.price) >= 0 ? Number(r.price) : null);
      const sum = (list) => list.reduce((t, r) => t + (priceOf(r) || 0), 0);
      const totalAll = sum(rows), totalTodo = sum(todo), totalDone = sum(rows.filter((r) => r.done));
      const noPrice = todo.filter((r) => priceOf(r) == null).length;
      const shareText = `🛒 Daftar belanja ${state.household?.name || ""}\n\n` + todo.map((r) => `☐ ${r.name}${r.qty ? " — " + r.qty : ""}${priceOf(r) != null ? " (" + rp(priceOf(r)) + ")" : ""}`).join("\n")
        + (totalTodo ? `\n\nPerkiraan total: ${rp(totalTodo)}` : "") + "\n\nDari Omahku";
      const parsePrice = (v) => { const t = String(v).replace(/[^\d]/g, ""); if (!t) return null; const n = Number(t); return n <= 1e10 ? n : null; };
      const name = h("input", { type: "text", placeholder: "Tambah barang… (mis. Telur)", required: true, "aria-label": "Nama barang", autocomplete: "off", enterkeyhint: "done" });
      const qty = h("input", { type: "text", placeholder: "Jumlah", style: { maxWidth: "8rem" }, "aria-label": "Jumlah" });
      const price = h("input", { type: "text", inputmode: "numeric", placeholder: "Harga (Rp)", style: { maxWidth: "9.5rem" }, "aria-label": "Harga dalam rupiah", autocomplete: "off" });
      const form = h("form", { class: "box card", style: { flexDirection: "row", flexWrap: "wrap", gap: ".6rem", marginBottom: "1.2rem" },
        onsubmit: async (e) => {
          e.preventDefault();
          const n = name.value.trim(); if (!n) return;
          const q = qty.value.trim(), pr = parsePrice(price.value); name.value = ""; qty.value = ""; price.value = "";
          window.__refocusShopping = true;
          await run(() => insertRow("shopping_items", { name: n, qty: q || null, price: pr }));
        } },
        h("div", { style: { flex: "1 1 220px" } }, name), qty, price, h("button", { class: "btn orange", type: "submit" }, "＋ Tambah"));
      root.append(
        h("div", { class: "page-head" }, h("h1", null, h("span", null, "🛒"), "Daftar Belanja", h("span", { class: "tag" }, String(rows.length - doneIds.length))),
          h("div", { class: "sos" }, todo.length ? [
            h("a", { class: "btn green", href: "https://wa.me/?text=" + encodeURIComponent(shareText), target: "_blank", rel: "noopener" }, "📲 Kirim ke WhatsApp"),
            h("button", { class: "btn white", type: "button", onclick: () => copyText(shareText) }, "📋 Salin")] : null,
          h("button", { class: "btn orange", type: "button", onclick: () => openSuggest({ addToShopping }) }, `💡 Saran belanja${shoppingSuggestions().length ? " (" + shoppingSuggestions().length + ")" : ""}`),
          doneIds.length ? h("button", { class: "btn green", type: "button", onclick: () => openStockIn({ run }) }, `📦 Pindahkan ke stok (${doneIds.length})`) : null,
          doneIds.length ? h("button", { class: "btn white", type: "button", onclick: async () => { if (await confirmBox(`Hapus ${doneIds.length} barang yang sudah dibeli?`, "Ya, bersihkan")) run(() => deleteMany("shopping_items", doneIds), "Dibersihkan"); } }, `🧹 Bersihkan yang sudah dibeli (${doneIds.length})`) : null)),
        form);
      if (window.__refocusShopping) { window.__refocusShopping = false; setTimeout(() => name.focus(), 0); }
      if (!rows.length) { root.append(emptyState("🛒", "Daftar belanja kosong", "Tambah barang di atas, atau kirim dari halaman Stok dan Menu.")); return; }
      root.append(h("section", { class: "box card", style: { marginBottom: "1.2rem", background: "var(--tint-green)" }, "aria-label": "Total belanja" },
        h("div", { style: { display: "flex", flexWrap: "wrap", gap: ".6rem 2rem", alignItems: "baseline" } },
          h("div", null, h("small", { style: { display: "block", fontWeight: 700 } }, "💰 Belum dibeli"), h("b", { style: { fontSize: "1.7rem" } }, rp(totalTodo))),
          h("div", null, h("small", { style: { display: "block", fontWeight: 700 } }, "✅ Sudah dibeli"), h("b", { style: { fontSize: "1.2rem" } }, rp(totalDone))),
          h("div", null, h("small", { style: { display: "block", fontWeight: 700 } }, "Total semua"), h("b", { style: { fontSize: "1.2rem" } }, rp(totalAll)))),
        noPrice ? h("div", { class: "note" }, `${noPrice} barang belum diberi harga, jadi belum masuk hitungan. Isi harganya di kolom Rp pada tiap barang.`) : null,
        h("div", { class: "note", style: { color: "var(--muted)" } }, "Harga = total harga barang itu (jumlah × harga satuan), bukan harga per satuan.")));
      const grid = h("div", { class: "grid wide" });
      for (const r of rows) {
        grid.append(h("div", { class: "box li", style: { boxShadow: "var(--sh-sm)", opacity: r.done ? 0.6 : 1 } },
          h("input", { type: "checkbox", checked: r.done, "aria-label": "Sudah dibeli: " + r.name, onchange: (e) => run(() => updateRow("shopping_items", r.id, { done: e.target.checked })) }),
          h("div", { class: "grow", style: { textDecoration: r.done ? "line-through" : "none", fontWeight: 700 } }, r.name, r.qty ? h("small", null, r.qty) : null,
            (() => { const st = !r.done && candidates(r.name, state.data.stock_items)[0]; return st ? h("small", { style: { textDecoration: "none" } }, `📦 di stok: ${qtyText(Number(st.qty) || 0, st.unit)}`) : null; })()),
          h("input", { type: "text", inputmode: "numeric", placeholder: "Rp", value: priceOf(r) != null ? Math.round(priceOf(r)).toLocaleString("id-ID") : "", "aria-label": "Harga " + r.name, autocomplete: "off", style: { width: "7.5rem", minHeight: "40px", padding: ".3rem .5rem", textAlign: "right" },
            onfocus: (e) => e.target.select(),
            onchange: (e) => { const v = parsePrice(e.target.value); if (v === priceOf(r)) { e.target.value = v != null ? v.toLocaleString("id-ID") : ""; return; } run(() => updateRow("shopping_items", r.id, { price: v })); } }),
          r.done ? h("button", { class: "btn sm green icon-btn", type: "button", "aria-label": "Pindahkan ke stok: " + r.name, title: "Pindahkan ke stok", onclick: () => openStockIn({ run }, [r]) }, "📦") : null,
          h("button", { class: "btn sm white icon-btn", type: "button", "aria-label": "Hapus " + r.name, onclick: () => run(() => deleteRow("shopping_items", r.id)) }, "✕")));
      }
      root.append(grid);
    },
  },

  // ---------------- Stok ----------------
  {
    key: "stock", table: "stock_items", title: "Stok Kebutuhan", nav: "Stok", singular: "Stok", icon: "📦", color: "lilac", titleField: "name",
    emptyTitle: "Belum ada stok", emptyText: "Catat kebutuhan rutin (beras, sabun, popok…), tandai batas minimumnya, dan isi tanggal kedaluwarsa agar tidak terlewat.",
    fields: [
      { k: "name", label: "Nama barang", required: true, placeholder: "mis. Susu UHT" },
      { k: "qty", label: "Jumlah sekarang", type: "number", required: true, half: true, default: 1, min: 0 },
      { k: "min_qty", label: "Batas menipis", type: "number", half: true, default: 1, min: 0, hint: "Tandai menipis jika ≤ angka ini" },
      { k: "unit", label: "Satuan", placeholder: "pcs, kg, liter…", half: true },
      { k: "category", label: "Kategori", type: "select", options: STOCK_CATS, half: true, default: "Makanan & minuman" },
      { k: "expiry_date", label: "Tanggal kedaluwarsa", type: "date", hint: "Kosongkan jika tidak ada. Jika ada beberapa kemasan, isi yang paling cepat kedaluwarsa." },
    ],
    beforeSave: (o) => { o.qty ??= 0; o.min_qty ??= 0; },
    filters: () => [[
      { id: "all", label: "Semua" },
      { id: "low", label: "⚠ Menipis", test: (r) => Number(r.qty) <= Number(r.min_qty) },
      { id: "exp", label: "⏰ Kedaluwarsa ≤ 14 hari", test: (r) => expDays(r) != null && expDays(r) <= 14 },
    ]],
    sort: by((r) => { const d = expDays(r); return d != null && d < 0 ? 0 : d != null && d <= 14 ? 1 : Number(r.qty) <= Number(r.min_qty) ? 2 : 3; }, (r) => r.expiry_date || BIG, (r) => (r.name || "").toLowerCase()),
    card: (r, api) => {
      const low = Number(r.qty) <= Number(r.min_qty), d = expDays(r), expired = d != null && d < 0;
      const step = (n) => api.patch(r, { qty: Math.max(0, Number(r.qty) + n) });
      const expChip = d == null ? null : expired ? chip(`⛔ Kedaluwarsa ${-d} hari lalu`, "red") : d === 0 ? chip("⚠ Kedaluwarsa hari ini", "red")
        : chip(`⏰ Exp ${fmtShort(r.expiry_date)} · ${relDay(r.expiry_date)}`, d <= 7 ? "orange" : d <= 30 ? "yellow" : "green");
      return {
        title: r.name, color: expired ? "red" : low ? "red" : "lilac",
        meta: [expired ? null : low ? chip("⚠ Menipis", "red") : chip("Aman", "green"), expChip, r.category ? chip(r.category, "lilac") : null],
        body: [
          h("div", { class: "sos" },
            h("button", { class: "btn sm white icon-btn", type: "button", "aria-label": "Kurangi", onclick: () => step(-1) }, "−"),
            h("b", { style: { fontSize: "1.6rem", minWidth: "3ch", textAlign: "center" } }, String(Number(r.qty))),
            h("button", { class: "btn sm white icon-btn", type: "button", "aria-label": "Tambah", onclick: () => step(1) }, "＋"),
            h("span", null, r.unit || "")),
          expired ? h("div", { class: "note", style: { fontWeight: 700 } }, "⛔ Sudah kedaluwarsa. Jangan dikonsumsi atau dipakai lagi. Buang lalu beli yang baru.")
            : d != null && d <= 3 ? h("div", { class: "note", style: { fontWeight: 700 } }, "⚠ Segera gunakan sebelum kedaluwarsa.") : null,
        ],
        actions: [
          expired ? h("button", { class: "btn sm red", type: "button", onclick: () => api.patch(r, { qty: 0, expiry_date: null }, "Dicatat sudah dibuang 🗑") }, "🗑 Sudah dibuang") : null,
          low || expired ? h("button", { class: "btn sm orange", type: "button", onclick: () => addToShopping([{ name: r.name }]) }, "🛒 Ke belanja") : null,
        ],
      };
    },
  },

  // ---------------- Menu ----------------
  {
    key: "menu", table: "menus", title: "Menu Dapur", nav: "Menu", singular: "Menu", icon: "🍳", color: "pink", titleField: "dish",
    emptyTitle: "Belum ada rencana menu", emptyText: "Rencanakan masakan harian dan catat bahan yang perlu dibeli.",
    fields: [
      { k: "dish", label: "Masakan", required: true, placeholder: "mis. Sayur sop ayam" },
      { k: "date", label: "Tanggal", type: "date", required: true, half: true, default: today },
      { k: "meal", label: "Waktu makan", type: "select", options: MEALS, half: true, default: "Makan siang" },
      { k: "ingredients", label: "Bahan", type: "textarea", placeholder: "Satu bahan per baris:\nAyam 1/2 kg\nWortel", hint: "Bisa dikirim ke Daftar Belanja sekali klik." },
      { k: "steps", label: "Cara memasak", type: "textarea", placeholder: "Satu langkah per baris", hint: "Bisa diisi otomatis lewat tombol ✨ Resep AI di kartu menu." },
      { k: "notes", label: "Catatan", type: "textarea" },
    ],
    top: (root) => {
      root.append(h("section", { class: "box panel", style: { marginBottom: "1.2rem", background: "var(--tint-lilac)" } },
        h("h3", null, "✨ Bingung mau masak apa?"),
        h("div", { class: "body" },
          h("p", { style: { fontSize: ".95rem" } }, "Minta AI membuatkan resep lengkap dengan bahan dan cara memasak. Hasilnya bisa langsung masuk ke Menu dan Daftar Belanja."),
          h("div", { class: "sos" }, h("button", { class: "btn lilac", type: "button", onclick: () => openAIAdvisor({ addToShopping }) }, "✨ Saran AI"), h("button", { class: "btn pink", type: "button", onclick: () => openWeeklyPlanner({ addToShopping }) }, "📆 Rencana 1 minggu")))));
    },
    filters: () => [[{ id: "up", label: "Mulai hari ini", test: (r) => r.date >= today() }, { id: "past", label: "Sebelumnya", test: (r) => r.date < today() }, { id: "all", label: "Semua" }]],
    sort: by((r) => r.date, (r) => MEALS.indexOf(r.meal)),
    groupBy: (r) => `${relDay(r.date) === "Hari ini" || relDay(r.date) === "Besok" ? relDay(r.date) + " · " : ""}${fmtDate(r.date)}`,
    card: (r) => {
      const items = splitItems(r.ingredients);
      const steps = (r.steps || "").split("\n").map((x) => x.trim().replace(/^\d+\s*[.)]\s*/, "")).filter(Boolean);
      const av = !r.cooked && items.length ? availability(r.ingredients, state.data.stock_items) : null;
      const kitchen = { run, addToShopping };
      return {
        title: r.dish, color: r.cooked ? "green" : "pink",
        meta: [r.meal ? chip(r.meal, "pink") : null, r.ai ? chip("✨ AI", "lilac") : null,
          r.cooked ? chip(`✅ Dimasak${r.cooked_on ? " " + fmtShort(r.cooked_on) : ""}`, "green") : null,
          av ? (av.missing.length ? chip(`🧂 ${av.ok}/${av.total} bahan ada di stok`, "orange") : chip("✅ Semua bahan ada di stok", "green")) : null],
        body: [
          items.length ? h("div", { class: "note" }, "🧂 " + items.join(", ")) : null,
          steps.length ? h("details", { class: "steps" }, h("summary", null, `👩‍🍳 Cara memasak (${steps.length} langkah)`), h("ol", null, steps.map((x) => h("li", null, x)))) : null,
          av && av.missing.length ? h("div", { class: "note" }, "🛒 Perlu dibeli: " + av.missing.map((m) => m.name).join(", ")) : null,
          r.notes ? h("div", { class: "note" }, r.notes) : null,
        ],
        actions: [
          !r.cooked ? h("button", { class: "btn sm green", type: "button", onclick: () => openCook(kitchen, r) }, "🍳 Sudah dimasak") : h("button", { class: "btn sm white", type: "button", onclick: () => undoCook(kitchen, r) }, "↩ Batalkan"),
          av && av.missing.length ? h("button", { class: "btn sm orange", type: "button", onclick: () => addToShopping(av.missing.map((m) => ({ name: m.name, qty: qtyText(m.n, m.unit) || null }))) }, "🛒 Bahan kurang ke belanja") : null,
          !steps.length ? h("button", { class: "btn sm lilac", type: "button", onclick: (e) => completeRecipe(r, { addToShopping }, e.currentTarget) }, "✨ Resep AI") : null,
        ],
      };
    },
  },

  // ---------------- Pakaian ----------------
  {
    key: "clothes", table: "clothes", title: "Lemari Pakaian", nav: "Pakaian", singular: "Pakaian", icon: "👕", color: "blue", titleField: "name", wide: false,
    emptyTitle: "Lemari masih kosong", emptyText: "Catat pakaian tiap anggota keluarga per kategori (harian, formal, tidur, olahraga…). Tandai saat dipakai agar kelihatan mana yang jarang disentuh, lalu lepaskan yang tidak perlu.",
    fields: [
      { k: "name", label: "Nama pakaian", required: true, placeholder: "mis. Kemeja putih lengan panjang" },
      { k: "person", label: "Pemilik", type: "person", required: true, half: true, default: () => meMember()?.display_name || "" },
      { k: "category", label: "Kategori", type: "select", options: CATS, half: true, default: "Harian / santai" },
      { k: "type", label: "Jenis", type: "select", options: TYPES, half: true, default: "Kaos" },
      { k: "qty", label: "Jumlah (potong)", type: "number", half: true, min: 1, default: 1, hint: "Untuk yang serupa, mis. 5 kaus kaki" },
      { k: "color", label: "Warna", half: true },
      { k: "size", label: "Ukuran", half: true, placeholder: "mis. M, 38, 2 tahun" },
      { k: "condition", label: "Kondisi", type: "select", options: CONDITIONS, half: true, default: "Baik" },
      { k: "bought_date", label: "Tanggal beli", type: "date", half: true },
      { k: "last_worn", label: "Terakhir dipakai", type: "date", hint: "Boleh kosong. Nanti terisi sendiri lewat tombol “Dipakai hari ini”." },
      { k: "notes", label: "Catatan", type: "textarea", placeholder: "mis. Hadiah, perlu dijahit, dipakai hanya untuk kondangan" },
    ],
    beforeSave: (o) => { o.qty = Math.max(1, Math.round(Number(o.qty) || 1)); o.status ??= STATUS.use; },
    afterSave: async (o, old) => {
      if (old) return;
      const t = state.data.clothes_targets.find((x) => x.person === o.person)?.target;
      const n = piecesOf(state.data.clothes, o.person);
      if (t && n > t) toast(`Lemari ${o.person} sekarang ${n} potong, melebihi target ${t}. Aturan 1 masuk 1 keluar: pilih 1 yang dilepas 🌿`);
    },
    top: (root, rows) => clothesTop(root, rows),
    filters: (rows) => {
      const st = uiState.clothes || {}, sel = String(st[0] || "all"), person = sel.startsWith("p:") ? sel.slice(2) : null;
      const names = [...new Set([...state.members.map((m) => m.display_name), ...rows.map((r) => r.person)].filter(Boolean))];
      const inScope = rows.filter((r) => !person || r.person === person), now = today();
      const cnt = (c) => inScope.filter((r) => !isGone(r) && r.category === c).reduce((n, r) => n + (Number(r.qty) || 1), 0);
      return [
        [{ id: "all", label: "Semua anggota" }, ...names.map((n) => ({ id: "p:" + n, label: n, test: (r) => r.person === n }))],
        [{ id: "all", label: "Semua kategori" }, ...CATS.filter((c) => cnt(c) > 0 || st[1] === c).map((c) => ({ id: c, label: `${CAT_ICON[c]} ${c} (${cnt(c)})`, test: (r) => (r.category || "Lainnya") === c }))],
        [{ id: "own", label: "Masih dimiliki", test: (r) => !isGone(r) },
          { id: "idle", label: `😴 Jarang dipakai (≥ ${IDLE_DAYS} hari)`, test: (r) => isIdle(r, now) },
          { id: "ready", label: "📤 Siap dilepas", test: (r) => r.status === STATUS.ready },
          { id: "gone", label: "✅ Sudah dilepas", test: (r) => isGone(r) }],
      ];
    },
    sort: by((r) => (isGone(r) ? 2 : r.status === STATUS.ready ? 1 : 0), (r) => r.person || "", (r) => r.category || "", (r) => (r.name || "").toLowerCase()),
    card: (r, api) => {
      const now = today(), idle = idleDays(r, now), gone = isGone(r), ready = r.status === STATUS.ready, idleFlag = isIdle(r, now);
      const worn = Number(r.worn_count) || 0;
      return {
        title: (Number(r.qty) > 1 ? `${r.name} ×${Number(r.qty)}` : r.name), done: gone, color: gone ? "lilac" : ready ? "orange" : idleFlag ? "yellow" : "blue",
        meta: [
          r.person ? chip("👤 " + r.person, "lilac") : null, r.category ? chip(`${CAT_ICON[r.category] || "👕"} ${r.category}`, "blue") : null,
          r.type ? chip(r.type) : null, r.color ? chip(r.color) : null, r.size ? chip("Uk. " + r.size) : null,
          r.condition && r.condition !== "Baik" ? chip(r.condition === "Layak pakai" ? "Layak pakai" : "🪡 " + r.condition, r.condition === "Layak pakai" ? "yellow" : "orange") : null,
          ready ? chip("📤 Siap dilepas", "orange") : null, gone ? chip(`✅ ${r.released_how || "Dilepas"}${r.released_on ? " · " + fmtShort(r.released_on) : ""}`, "green") : null,
          !gone && idleFlag ? chip(`😴 Tak dipakai ${idleText(idle).replace(" lalu", "")}`, "yellow") : null,
        ],
        body: [
          !gone ? h("div", { class: "note" }, worn ? `Dipakai ${worn}×` : "Belum ada catatan pemakaian", r.last_worn ? ` · terakhir ${idleText(idleDays({ last_worn: r.last_worn }, now))}` : "") : null,
          r.notes ? h("div", { class: "note" }, r.notes) : null,
        ],
        actions: gone ? [h("button", { class: "btn sm white", type: "button", onclick: () => api.patch(r, { status: STATUS.use, released_how: null, released_on: null }, "Dikembalikan ke lemari") }, "↩ Kembalikan")] : [
          h("button", { class: "btn sm green", type: "button", onclick: () => api.patch(r, { last_worn: now, worn_count: worn + 1 }, "Dicatat dipakai hari ini 👕") }, "👕 Dipakai hari ini"),
          ready ? h("button", { class: "btn sm orange", type: "button", onclick: () => releaseModal(r, api) }, "📤 Lepas…") : h("button", { class: "btn sm white", type: "button", onclick: () => api.patch(r, { status: STATUS.ready }, "Ditandai siap dilepas") }, "📤 Siap dilepas"),
          ready ? h("button", { class: "btn sm white", type: "button", onclick: () => api.patch(r, { status: STATUS.use, last_worn: now }, "Disimpan lagi di lemari") }, "↩ Simpan lagi") : null,
        ],
      };
    },
  },

  // ---------------- Perawatan rumah ----------------
  {
    key: "maintenance", table: "maintenance", title: "Perawatan", nav: "Perawatan", singular: "Perawatan rumah", icon: "🛠️", color: "orange",
    emptyTitle: "Belum ada jadwal perawatan", emptyText: "Servis AC, kuras bak mandi, ganti filter air, cek tabung gas…",
    view: (root) => maintenanceView(root),
    fields: [
      { k: "title", label: "Perawatan", required: true, placeholder: "mis. Servis AC" },
      { k: "category", label: "Kategori", type: "select", options: ["AC & elektronik", "Air & pipa", "Taman", "Bangunan", "Lainnya"], half: true, default: "AC & elektronik" },
      { k: "interval_days", label: "Ulangi tiap (hari)", type: "number", half: true, min: 1, placeholder: "mis. 90", hint: "Kosongkan jika sekali saja" },
      { k: "last_done", label: "Terakhir dilakukan", type: "date" },
      { k: "notes", label: "Catatan", type: "textarea", placeholder: "Teknisi langganan, nomor HP, biaya, dll." },
    ],
    filters: () => [[{ id: "all", label: "Semua" }, { id: "soon", label: "Segera / terlambat", test: (r) => { const n = nextDue(r); return n && daysBetween(today(), n) <= 14; } }]],
    sort: by((r) => nextDue(r) || BIG),
    card: (r, api) => {
      const n = nextDue(r);
      const left = n ? daysBetween(today(), n) : null;
      const st = left == null ? chip("Belum terjadwal") : left < 0 ? chip(`Terlambat ${-left} hari`, "red") : left <= 14 ? chip(`${left === 0 ? "Hari ini" : left + " hari lagi"}`, "orange") : chip(`${left} hari lagi`, "green");
      return {
        title: r.title, color: left != null && left < 0 ? "red" : "orange",
        meta: [st, r.category ? chip(r.category, "orange") : null, r.interval_days ? chip(`🔁 ${r.interval_days} hari`) : null],
        body: [
          h("div", { class: "note" }, r.last_done ? `Terakhir: ${fmtDate(r.last_done)}` : "Belum pernah dicatat", n ? ` · Berikutnya: ${fmtDate(n)}` : ""),
          r.notes ? h("div", { class: "note" }, r.notes) : null,
        ],
        actions: [h("button", { class: "btn sm green", type: "button", onclick: () => api.patch(r, { last_done: today() }, "Dicatat selesai hari ini ✓") }, "✓ Selesai hari ini")],
      };
    },
  },

  // ---------------- Aset ----------------
  (() => { const m = assetModule({ openForm, run }); const t = m.top; return { ...m, top: (root, rows) => { root.append(docTabs("assets")); t?.(root, rows); } }; })(),
  documentModule({ openForm }),

  // ---------------- Target ----------------
  {
    key: "goals", table: "goals", title: "Target Keluarga", nav: "Target", singular: "Target", icon: "🎯", color: "yellow",
    emptyTitle: "Belum ada target", emptyText: "Tulis impian bersama: renovasi dapur, liburan, anak masuk sekolah…",
    fields: [
      { k: "title", label: "Target", required: true, placeholder: "mis. Liburan keluarga ke Bali" },
      { k: "category", label: "Kategori", type: "select", options: ["Keluarga", "Rumah", "Pendidikan", "Liburan", "Kesehatan", "Karier", "Lainnya"], half: true, default: "Keluarga" },
      { k: "target_date", label: "Target tercapai", type: "date", half: true },
      { k: "milestones", label: "Langkah-langkah", type: "lines", placeholder: "Satu langkah per baris:\nTentukan tanggal\nCari penginapan", hint: "Jika diisi, progres dihitung otomatis dari langkah yang selesai." },
      { k: "progress", label: "Progres manual", type: "range", default: 0, hint: "Dipakai jika tidak ada langkah-langkah." },
      { k: "notes", label: "Catatan", type: "textarea" },
    ],
    beforeSave: (o) => { if (o.milestones?.length) o.progress = Math.round((o.milestones.filter((m) => m.d).length / o.milestones.length) * 100); },
    filters: () => [[{ id: "run", label: "Berjalan", test: (r) => progressOf(r) < 100 }, { id: "done", label: "Tercapai 🎉", test: (r) => progressOf(r) >= 100 }, { id: "all", label: "Semua" }]],
    sort: by((r) => (progressOf(r) >= 100 ? 1 : 0), (r) => r.target_date || BIG),
    wide: true,
    card: (r, api) => {
      const p = progressOf(r), ms = r.milestones || [];
      return {
        title: r.title, color: p >= 100 ? "green" : "yellow", done: false,
        meta: [p >= 100 ? chip("Tercapai 🎉", "green") : null, r.target_date ? dueChip(r.target_date, p >= 100) : null, r.category ? chip(r.category, "yellow") : null],
        body: [
          h("div", { class: "bar", role: "progressbar", "aria-valuenow": p, "aria-valuemin": 0, "aria-valuemax": 100 }, h("i", { style: { width: p + "%" } })),
          h("b", null, p + "%"),
          ms.length ? h("div", { class: "checks" }, ms.map((m, i) => h("label", { class: m.d ? "d" : "" },
            h("input", { type: "checkbox", checked: m.d, onchange: (e) => {
              const next = ms.map((x, j) => (j === i ? { ...x, d: e.target.checked } : x));
              api.patch(r, { milestones: next, progress: Math.round((next.filter((x) => x.d).length / next.length) * 100) });
            } }), h("span", null, m.t)))) : null,
          r.notes ? h("div", { class: "note" }, r.notes) : null,
        ],
      };
    },
  },

  // ---------------- Kontak darurat ----------------
  {
    key: "contacts", table: "contacts", title: "Kontak Darurat", nav: "Darurat", singular: "Kontak", icon: "🚨", color: "red", titleField: "name",
    emptyTitle: "Belum ada kontak", emptyText: "Simpan nomor dokter, keluarga terdekat, RT/satpam, bengkel, dan lainnya.",
    fields: [
      { k: "name", label: "Nama", required: true, placeholder: "mis. dr. Sari (Dokter anak)" },
      { k: "relation", label: "Kategori", type: "select", options: ["Keluarga", "Dokter", "RS / Klinik", "Tetangga / RT", "Satpam", "Teknisi", "Sekolah", "Lainnya"], half: true, default: "Keluarga" },
      { k: "phone", label: "Nomor telepon", type: "tel", required: true, half: true, inputmode: "tel", placeholder: "08xxxxxxxxxx" },
      { k: "address", label: "Alamat", type: "textarea", placeholder: "Opsional" },
      { k: "notes", label: "Catatan", type: "textarea", placeholder: "mis. Praktik Senin–Jumat 17.00" },
      { k: "is_primary", label: "Kontak utama", type: "select", options: [["false", "Bukan"], ["true", "Ya, tampilkan di Beranda"]], default: "false" },
    ],
    beforeSave: (o) => { o.is_primary = o.is_primary === "true" || o.is_primary === true; },
    top: (root) => {
      const saved = state.data.sos_numbers || [];
      const list = saved.length ? saved.map((r) => [r.number, r.label]) : DEFAULT_SOS;
      root.append(h("section", { class: "box panel", style: { marginBottom: "1.2rem", background: "var(--tint-red)" } },
        h("h3", null, h("span", null, "📞 Nomor darurat nasional"), h("button", { class: "btn sm white more", type: "button", onclick: () => editSos(list) }, "✏️ Ubah")),
        h("div", { class: "body" }, h("div", { class: "sos" }, list.map(([n, l]) =>
          h("a", { class: "btn red call", href: "tel:" + n.replace(/[^\d+*#]/g, ""), "aria-label": `Telepon ${l} ${n}` }, `${n}`, h("small", { style: { fontWeight: 500 } }, l)))))));
    },
    sort: by((r) => (r.is_primary ? 0 : 1), (r) => (r.name || "").toLowerCase()),
    card: (r) => ({
      title: r.name, color: "red",
      meta: [r.is_primary ? chip("★ Utama", "yellow") : null, r.relation ? chip(r.relation, "red") : null],
      body: [
        h("div", { class: "sos" },
          h("a", { class: "btn green call", href: "tel:" + (r.phone || "").replace(/\s/g, "") }, "📞 " + (r.phone || "")),
          h("a", { class: "btn sm white", href: "https://wa.me/" + waNumber(r.phone), target: "_blank", rel: "noopener" }, "WhatsApp")),
        r.address ? h("div", { class: "note" }, "📍 " + r.address) : null,
        r.notes ? h("div", { class: "note" }, r.notes) : null,
      ],
    }),
  },

  // ---------------- Riwayat kesehatan ----------------
  {
    key: "health", table: "health_records", title: "Riwayat Kesehatan", nav: "Kesehatan", singular: "Catatan kesehatan", icon: "🩺", color: "green",
    view: (root) => healthView(root, { renderModule, openForm, run, recMod: modByKey.health }),
    emptyTitle: "Belum ada catatan kesehatan", emptyText: "Catat alergi, obat rutin, vaksin, kunjungan dokter, dan hasil lab tiap anggota keluarga.",
    fields: [
      { k: "person", label: "Untuk siapa", type: "person", required: true, placeholder: "mis. Budi, Sari, Adik", default: () => meMember()?.display_name },
      { k: "type", label: "Jenis", type: "select", options: HEALTH_TYPES(), half: true, default: "Kunjungan dokter" },
      { k: "date", label: "Tanggal", type: "date", half: true, default: today },
      { k: "title", label: "Judul / diagnosis", required: true, placeholder: "mis. Alergi udang · Vaksin MR · Demam berdarah" },
      { k: "provider", label: "Dokter / fasilitas", placeholder: "mis. dr. Sari, RS Siloam" },
      { k: "notes", label: "Catatan", type: "textarea", placeholder: "Dosis obat, hasil, anjuran dokter…" },
      { k: "followup_date", label: "Kontrol / ulang berikutnya", type: "date", hint: "Akan muncul di Beranda saat sudah dekat." },
    ],
    top: (root, rows) => {
      const crit = rows.filter((r) => ["Alergi", "Kondisi / penyakit", "Obat rutin"].includes(r.type));
      if (!crit.length) return;
      const people = [...new Set(crit.map((r) => r.person))];
      root.append(h("section", { class: "box panel", style: { marginBottom: "1.2rem", background: "var(--tint-green)" } },
        h("h3", null, "⚕️ Ringkasan penting"),
        h("div", { class: "body" }, people.map((p) => h("div", { class: "li", style: { alignItems: "flex-start" } },
          h("b", null, p),
          h("div", { class: "grow", style: { display: "flex", flexWrap: "wrap", gap: ".35rem" } },
            crit.filter((r) => r.person === p).map((r) => chip(`${r.type === "Alergi" ? "⚠ " : r.type === "Obat rutin" ? "💊 " : "• "}${r.title}`, r.type === "Alergi" ? "red" : r.type === "Obat rutin" ? "blue" : "yellow"))))))));
    },
    filters: (rows) => [
      [{ id: "all", label: "Semua orang" }, ...[...new Set(rows.map((r) => r.person))].sort().map((p) => ({ id: "p:" + p, label: p, test: (r) => r.person === p }))],
      [{ id: "all", label: "Semua jenis" }, ...HEALTH_TYPES().filter((t) => rows.some((r) => r.type === t)).map((t) => ({ id: "t:" + t, label: t, test: (r) => r.type === t }))],
    ],
    sort: (a, b) => (b.date || "").localeCompare(a.date || ""),
    wide: true,
    card: (r) => ({
      title: r.title, color: r.type === "Alergi" ? "red" : "green",
      meta: [chip("🧑 " + r.person, "pink"), r.type ? chip(r.type, r.type === "Alergi" ? "red" : "green") : null, r.date ? chip(fmtDate(r.date)) : null, r.followup_date ? chip("⏰ Kontrol " + fmtShort(r.followup_date) + " · " + relDay(r.followup_date), daysBetween(today(), r.followup_date) < 0 ? "red" : "orange") : null],
      body: [r.provider ? h("div", { class: "note" }, "🏥 " + r.provider) : null, r.notes ? h("div", { class: "note" }, r.notes) : null],
    }),
  },
];

function HEALTH_TYPES() { return ["Info dasar", "Alergi", "Kondisi / penyakit", "Obat rutin", "Vaksinasi", "Kunjungan dokter", "Hasil lab", "Lainnya"]; }

export const progressOf = (r) => {
  const ms = r.milestones || [];
  return ms.length ? Math.round((ms.filter((m) => m.d).length / ms.length) * 100) : Number(r.progress || 0);
};
export const nextDue = (r) => (r.last_done && r.interval_days ? addDays(r.last_done, Number(r.interval_days)) : null);
const splitItems = (txt) => (txt || "").split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);

export async function addToShopping(items) {
  const have = new Set(state.data.shopping_items.filter((r) => !r.done).map((r) => r.name.toLowerCase()));
  const fresh = items.filter((i) => !have.has(i.name.toLowerCase()));
  if (!fresh.length) return toast("Sudah ada di daftar belanja");
  await run(() => insertMany("shopping_items", fresh.map((i) => ({ name: i.name, qty: i.qty || null }))), `${fresh.length} barang masuk daftar belanja 🛒`);
}

export const modByKey = Object.fromEntries(MODULES.map((m) => [m.key, m]));
