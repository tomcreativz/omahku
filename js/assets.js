// Aset & kendaraan: nomor polisi, STNK, pajak, asuransi, jadwal servis, riwayat servis, saran servis AI, dan pengingat kalender.
import { h, chip, modal, confirmBox, toast, today, fmtDate, fmtShort } from "./ui.js";
import { state, deleteRow, deleteMany, updateRow } from "./data.js";
import { reminders, urgencyOf, addMonthsISO, buildICS, isProperty, isVehicle, labelsOf } from "./assetcalc.js";
import { ensureAIKey, askAIJSON, aiStr, aiNum } from "./ai.js";

const TYPES = ["Motor", "Mobil", "Sepeda", "Rumah / Tanah", "Elektronik", "Lainnya"];
const ICON = { tax: "🧾", stnk: "🪪", ins: "🛡️", svc: "🔧" };
const has = (v) => v != null && v !== "";
const fkm = (n) => Number(n).toLocaleString("id-ID") + " km";
const svcOf = (id) => state.data.asset_services.filter((s) => s.asset_id === id)
  .sort((a, b) => (b.date || "").localeCompare(a.date || "") || String(b.created_at).localeCompare(String(a.created_at)));
const assetById = (id) => state.data.assets.find((a) => a.id === id);

// Pengingat yang akan jatuh tempo dalam 30 hari (atau sudah lewat), untuk Beranda.
export function assetAlerts(now = today()) {
  const out = [];
  for (const a of state.data.assets) for (const r of reminders(a, now)) if (r.days <= 30) out.push({ a, r });
  return out.sort((x, y) => x.r.days - y.r.days);
}

// ---------- Catatan servis ----------
function serviceMod(asset) {
  return {
    key: "asvc", table: "asset_services", singular: "Catatan servis", color: "orange", titleField: "what",
    fields: [
      { k: "date", label: "Tanggal servis", type: "date", required: true, half: true, default: today },
      { k: "km", label: "Kilometer saat servis", type: "number", half: true, min: 0, default: () => asset.odometer ?? "" },
      { k: "what", label: "Pekerjaan servis", required: true, placeholder: "mis. Ganti oli, servis ringan, ganti kampas rem" },
      { k: "workshop", label: "Bengkel", placeholder: "mis. AHASS Maju Jaya" },
      { k: "notes", label: "Catatan", type: "textarea", placeholder: "Suku cadang yang diganti, saran mekanik, dll." },
    ],
    beforeSave: (o) => { o.asset_id = asset.id; },
    // Perbarui "servis terakhir" dan kilometer pada aset.
    afterSave: async (o) => {
      const cur = assetById(asset.id) || asset, p = {};
      if (!cur.last_service_date || o.date >= cur.last_service_date) { p.last_service_date = o.date; if (has(o.km)) p.last_service_km = o.km; }
      if (has(o.km) && Number(o.km) > Number(cur.odometer || 0)) p.odometer = o.km;
      if (Object.keys(p).length) await updateRow("assets", asset.id, p);
    },
  };
}

function kmModal(asset, run) {
  const inp = h("input", { type: "number", min: 0, inputmode: "numeric", value: asset.odometer ?? "", "aria-label": "Kilometer sekarang", placeholder: "mis. 12500" });
  const err = h("div", { class: "msg err", hidden: true });
  let close;
  const form = h("form", { novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const v = Number(inp.value);
    if (!has(inp.value) || !Number.isFinite(v) || v < 0) { err.textContent = "Isi angka kilometer yang benar."; err.hidden = false; return; }
    if (has(asset.odometer) && v < Number(asset.odometer)) { err.textContent = `Kilometer tidak boleh lebih kecil dari catatan sebelumnya (${fkm(asset.odometer)}).`; err.hidden = false; return; }
    if (await run(() => updateRow("assets", asset.id, { odometer: v }), "Kilometer diperbarui ✓")) close();
  } },
    err, h("div", { class: "field" }, h("label", null, "Kilometer di spidometer sekarang"), inp),
    h("div", { class: "foot" }, h("button", { class: "btn white", type: "button", onclick: () => close() }, "Batal"), h("button", { class: "btn primary blue", type: "submit" }, "Simpan")));
  close = modal(`Update KM · ${asset.name}`, form);
}

// ---------- Kalender ----------
function downloadICS(a) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const ics = buildICS(a, today(), stamp);
  if (!ics) return toast("Isi dulu tanggal pajak, STNK, asuransi, atau jadwal servis.");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const slug = (a.name || "aset").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "aset";
  const link = h("a", { href: url, download: `omahku-${slug}.ics` });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  toast("File kalender diunduh. Buka file itu agar pengingat masuk ke kalender HP 📅", "ok");
}

// ---------- Saran servis dari AI ----------
const ADVICE_SYSTEM = `Kamu adalah mekanik dan penasihat perawatan kendaraan berpengalaman di Indonesia (jalan, cuaca tropis, lalu lintas padat). Beri saran perawatan yang aman dan praktis, merujuk pada praktik umum dan buku manual pabrikan. Jika data kurang, katakan apa yang perlu dicek.
Balas HANYA dengan JSON valid, tanpa teks lain dan tanpa markdown, dengan bentuk persis:
{"summary":"ringkasan kondisi 1-2 kalimat","urgency":"segera | dalam waktu dekat | aman","recommended":[{"item":"Ganti oli mesin","when":"setiap 2.000-3.000 km atau 2-3 bulan","reason":"alasan singkat"}],"interval_km":2000,"interval_months":3,"tips":["tips singkat"]}
Tulis dalam Bahasa Indonesia. interval_km dan interval_months adalah interval servis berkala yang disarankan (angka bulat).`;

function advicePrompt(a) {
  const hist = svcOf(a.id).slice(0, 6).map((s) => `${s.date}${has(s.km) ? ` (${fkm(s.km)})` : ""}: ${s.what}`);
  return [
    `Hari ini: ${today()}.`,
    `Jenis: ${a.type || "Kendaraan"}. Merek/tipe: ${a.brand_model || a.name}. Tahun: ${a.year || "tidak diketahui"}.`,
    `Kilometer sekarang: ${has(a.odometer) ? fkm(a.odometer) : "tidak diketahui"}.`,
    `Servis terakhir: ${a.last_service_date || "belum tercatat"}${has(a.last_service_km) ? ` pada ${fkm(a.last_service_km)}` : ""}.`,
    has(a.interval_months) || has(a.interval_km) ? `Interval yang dipakai sekarang: ${a.interval_months ? a.interval_months + " bulan" : "-"} / ${a.interval_km ? fkm(a.interval_km) : "-"}.` : "",
    hist.length ? `Riwayat servis terakhir:\n${hist.join("\n")}` : "Belum ada riwayat servis tercatat.",
    "Beri saran servis berikutnya, bagian yang perlu dicek, dan interval servis berkala yang cocok.",
  ].filter(Boolean).join("\n");
}

function normAdvice(r) {
  const clamp = (v, lo, hi) => { const n = aiNum(v); return n >= lo && n <= hi ? n : null; };
  const items = (Array.isArray(r?.recommended) ? r.recommended : []).map((i) => ({ item: aiStr(i?.item, 90), when: aiStr(i?.when, 140), reason: aiStr(i?.reason, 220) })).filter((i) => i.item).slice(0, 12);
  const urg = aiStr(r?.urgency, 30).toLowerCase();
  const adv = {
    summary: aiStr(r?.summary, 450), items,
    urgency: ["segera", "dalam waktu dekat", "aman"].find((u) => urg.includes(u)) || "",
    interval_km: clamp(r?.interval_km, 500, 50000), interval_months: clamp(r?.interval_months, 1, 36),
    tips: (Array.isArray(r?.tips) ? r.tips : []).map((t) => aiStr(t, 220)).filter(Boolean).slice(0, 6),
  };
  if (!adv.summary && !items.length) throw new Error("AI tidak memberi saran yang bisa dipakai. Coba lagi.");
  return adv;
}

const adviceText = (a) => [a.summary, ...a.items.map((i) => `• ${i.item}${i.when ? " — " + i.when : ""}`), ...a.tips.map((t) => "💡 " + t)].filter(Boolean).join("\n").slice(0, 2500);

async function showAdvice(asset, run) {
  if (!(await ensureAIKey())) return;
  const body = h("div", null, h("div", { class: "spinner", "aria-label": "Memuat" }));
  const close = modal("✨ Saran servis AI", body);
  try {
    const adv = normAdvice(await askAIJSON(ADVICE_SYSTEM, advicePrompt(asset)));
    const tone = { "segera": "red", "dalam waktu dekat": "orange", "aman": "green" }[adv.urgency];
    const cur = () => assetById(asset.id) || asset;
    body.replaceChildren(
      h("div", { class: "meta", style: { display: "flex", flexWrap: "wrap", gap: ".4rem", marginBottom: ".7rem" } }, chip(asset.name, "blue"), adv.urgency ? chip("Servis: " + adv.urgency, tone) : null),
      adv.summary ? h("p", { style: { fontWeight: 700, marginBottom: ".8rem" } }, adv.summary) : null,
      adv.items.length ? h("div", { style: { display: "flex", flexDirection: "column", gap: ".5rem", marginBottom: ".8rem" } }, adv.items.map((i) =>
        h("div", { class: "li", style: { alignItems: "flex-start" } }, h("div", { class: "grow" }, h("b", null, "🔧 " + i.item), i.when ? h("small", null, "⏱ " + i.when) : null, i.reason ? h("small", null, i.reason) : null)))) : null,
      adv.tips.length ? h("div", { class: "note", style: { marginBottom: ".8rem", whiteSpace: "pre-wrap" } }, adv.tips.map((t) => "💡 " + t).join("\n")) : null,
      h("p", { class: "disc", style: { margin: "0 0 .9rem" } }, "ℹ️ Saran AI hanya panduan umum. Ikuti buku manual kendaraan dan pendapat mekanik."),
      h("div", { class: "foot", style: { justifyContent: "stretch" } },
        adv.interval_km || adv.interval_months ? h("button", { class: "btn blue", type: "button", onclick: async () => {
          const p = {}; if (adv.interval_km) p.interval_km = adv.interval_km; if (adv.interval_months) p.interval_months = adv.interval_months;
          await run(() => updateRow("assets", cur().id, p), "Interval servis diperbarui ✓");
        } }, `Pakai interval ini (${[adv.interval_months && adv.interval_months + " bln", adv.interval_km && fkm(adv.interval_km)].filter(Boolean).join(" / ")})`) : null,
        h("button", { class: "btn lilac", type: "button", onclick: async () => { if (await run(() => updateRow("assets", cur().id, { ai_advice: adviceText(adv), ai_advice_date: today() }), "Saran disimpan di aset ✓")) close(); } }, "💾 Simpan saran di aset"),
        h("button", { class: "btn white", type: "button", onclick: () => close() }, "Tutup")));
  } catch (e) {
    console.error(e);
    body.replaceChildren(h("div", { class: "msg err" }, e?.message || "Gagal meminta AI"), h("div", { class: "foot" }, h("button", { class: "btn white", type: "button", onclick: () => close() }, "Tutup")));
  }
}

// ============================================================
// Definisi modul
// ============================================================
export function assetModule({ openForm, run }) {
  return {
    key: "assets", table: "assets", title: "Aset & Kendaraan", nav: "Aset", singular: "Aset", icon: "🏍️", color: "blue", titleField: "name", wide: true,
    emptyTitle: "Belum ada aset", emptyText: "Catat motor, mobil, atau rumah beserta pajak, STNK, asuransi, dan jadwal servisnya. Pengingat akan tampil di Beranda.",
    fields: [
      { k: "name", label: "Nama aset", required: true, placeholder: "mis. Honda Beat Hitam" },
      { k: "type", label: "Jenis", type: "select", options: TYPES, half: true, default: "Motor" },
      { k: "owner", label: "Pemilik / pengguna", type: "member", half: true },
      { k: "plate", label: "Nomor polisi", half: true, placeholder: "B 1234 XYZ" },
      { k: "brand_model", label: "Merek & tipe", half: true, placeholder: "mis. Honda Beat 110", hint: "Dipakai untuk saran servis AI" },
      { k: "year", label: "Tahun", type: "number", half: true, min: 1950, placeholder: "mis. 2019" },
      { k: "color", label: "Warna", half: true },
      { k: "purchase_date", label: "Tanggal beli", type: "date", half: true },
      { k: "insurance", label: "Asuransi (nama / no. polis)", half: true },
      { k: "tax_due", label: "Pajak tahunan jatuh tempo", type: "date", half: true, hint: "PKB kendaraan / PBB rumah" },
      { k: "stnk_due", label: "STNK / plat 5 tahunan berakhir", type: "date", half: true, hint: "Rumah: sertifikat. Lainnya: garansi" },
      { k: "insurance_due", label: "Asuransi berakhir", type: "date", half: true },
      { k: "odometer", label: "Kilometer sekarang", type: "number", half: true, min: 0 },
      { k: "last_service_date", label: "Servis terakhir", type: "date", half: true },
      { k: "last_service_km", label: "KM saat servis terakhir", type: "number", half: true, min: 0 },
      { k: "interval_months", label: "Servis tiap (bulan)", type: "number", half: true, min: 1, placeholder: "mis. 3", hint: "Kosongkan jika tidak berdasarkan waktu" },
      { k: "interval_km", label: "Servis tiap (km)", type: "number", half: true, min: 1, placeholder: "mis. 2000", hint: "Kosongkan jika tidak berdasarkan km" },
      { k: "chassis_no", label: "Nomor rangka", half: true },
      { k: "engine_no", label: "Nomor mesin", half: true },
      { k: "doc_location", label: "Lokasi dokumen (BPKB, STNK, polis)", placeholder: "mis. Lemari kamar, map biru" },
      { k: "notes", label: "Catatan", type: "textarea" },
    ],
    validate: (o) => (has(o.last_service_km) && has(o.odometer) && Number(o.last_service_km) > Number(o.odometer) ? "KM servis terakhir tidak boleh lebih besar dari kilometer sekarang." : ""),
    beforeSave: (o) => { if (o.plate) o.plate = o.plate.toUpperCase(); },
    filters: () => [[
      { id: "all", label: "Semua" },
      { id: "att", label: "⚠ Perlu perhatian", test: (r) => urgencyOf(r, today()) <= 30 },
      { id: "veh", label: "Kendaraan", test: (r) => isVehicle(r) },
    ]],
    sort: (a, b) => urgencyOf(a, today()) - urgencyOf(b, today()) || (a.name || "").localeCompare(b.name || ""),
    afterRemove: async (r) => { const ids = svcOf(r.id).map((s) => s.id); if (ids.length) await deleteMany("asset_services", ids); },
    card: (r, api) => {
      const now = today(), rem = reminders(r, now), L = labelsOf(r), svcs = svcOf(r.id), vehicle = isVehicle(r);
      const owner = r.owner ? state.members.find((m) => m.user_id === r.owner)?.display_name || (r.owner === "both" ? "Berdua" : "") : "";
      const worst = rem.reduce((m, x) => Math.min(m, x.days), 9999);
      const detail = [
        r.purchase_date ? ["Tanggal beli", fmtDate(r.purchase_date)] : null, r.chassis_no ? ["No. rangka", r.chassis_no] : null, r.engine_no ? ["No. mesin", r.engine_no] : null,
        r.insurance ? ["Asuransi", r.insurance] : null, r.doc_location ? ["Dokumen disimpan di", r.doc_location] : null, r.tax_paid_on ? ["Pajak terakhir dibayar", fmtDate(r.tax_paid_on)] : null,
      ].filter(Boolean);
      const next12 = (d) => { let n = addMonthsISO(d, 12), g = 0; while (n <= now && g++ < 20) n = addMonthsISO(n, 12); return n; };
      const acts = [
        h("button", { class: "btn sm orange", type: "button", onclick: () => openForm(serviceMod(r)) }, "🔧 Catat servis"),
        vehicle ? h("button", { class: "btn sm white", type: "button", onclick: () => kmModal(r, run) }, "🛣 Update KM") : null,
        r.tax_due ? h("button", { class: "btn sm green", type: "button", onclick: async () => {
          const nxt = next12(r.tax_due);
          if (await confirmBox(`Catat ${L.tax.toLowerCase()} sudah dibayar? Jatuh tempo berikutnya menjadi ${fmtDate(nxt)}.`, "Ya, sudah dibayar")) run(() => updateRow("assets", r.id, { tax_due: nxt, tax_paid_on: now }), `${L.tax} dicatat sudah dibayar ✓`);
        } }, `✓ ${L.tax} dibayar`) : null,
        r.stnk_due && isVehicle(r) ? h("button", { class: "btn sm green", type: "button", onclick: async () => {
          const nxt = addMonthsISO(r.stnk_due, 60);
          if (await confirmBox(`Catat STNK / plat sudah diperpanjang? Berlaku sampai ${fmtDate(nxt)}.`, "Ya, sudah diperpanjang")) run(() => updateRow("assets", r.id, { stnk_due: nxt }), "STNK dicatat diperpanjang ✓");
        } }, "✓ STNK diperpanjang") : null,
        vehicle ? h("button", { class: "btn sm lilac", type: "button", onclick: () => showAdvice(r, run) }, "✨ Saran servis") : null,
        h("button", { class: "btn sm white", type: "button", onclick: () => downloadICS(r) }, "📅 Ke kalender"),
      ];
      return {
        title: r.name, color: worst < 0 ? "red" : worst <= 14 ? "orange" : "blue",
        meta: [
          r.type ? chip(r.type, "blue") : null, r.plate ? chip("🔢 " + r.plate, "yellow") : null,
          [r.brand_model, r.year, r.color].filter(Boolean).length ? chip([r.brand_model, r.year, r.color].filter(Boolean).join(" · ")) : null,
          owner ? chip("👤 " + owner, "lilac") : null, has(r.odometer) ? chip("🛣 " + fkm(r.odometer)) : null,
        ],
        body: [
          rem.length ? h("div", { class: "meta", style: { display: "flex", flexWrap: "wrap", gap: ".4rem" } }, rem.map((x) =>
            chip(`${ICON[x.id]} ${x.label}${x.date ? " " + fmtShort(x.date) : ""} · ${x.text}`, x.tone))) : h("div", { class: "note" }, "Belum ada pengingat. Isi tanggal pajak, STNK, atau jadwal servis lewat tombol Ubah."),
          detail.length ? h("details", { class: "steps" }, h("summary", null, "📄 Detail & dokumen"), h("div", { style: { display: "flex", flexDirection: "column", gap: ".3rem", marginTop: ".5rem" } }, detail.map(([k, v]) => h("div", { class: "note" }, h("b", null, k + ": "), v)))) : null,
          svcs.length ? h("details", { class: "steps" }, h("summary", null, `🔧 Riwayat servis (${svcs.length})`), h("div", { style: { display: "flex", flexDirection: "column", gap: ".45rem", marginTop: ".5rem" } }, svcs.slice(0, 10).map((s) =>
            h("div", { class: "li" }, h("div", { class: "grow" }, h("b", null, s.what), h("small", null, [fmtShort(s.date), has(s.km) ? fkm(s.km) : "", s.workshop].filter(Boolean).join(" · ")), s.notes ? h("small", null, s.notes) : null),
              h("button", { class: "btn sm white icon-btn", type: "button", "aria-label": "Ubah catatan servis", onclick: () => openForm(serviceMod(r), s) }, "✏️"),
              h("button", { class: "btn sm white icon-btn", type: "button", "aria-label": "Hapus catatan servis", onclick: async () => { if (await confirmBox(`Hapus catatan servis “${s.what}”?`)) run(() => deleteRow("asset_services", s.id), "Dihapus"); } }, "✕"))))) : null,
          r.ai_advice ? h("details", { class: "steps" }, h("summary", null, `✨ Saran servis AI${r.ai_advice_date ? " · " + fmtShort(r.ai_advice_date) : ""}`), h("div", { class: "note", style: { marginTop: ".5rem" } }, r.ai_advice)) : null,
          r.notes ? h("div", { class: "note" }, r.notes) : null,
        ],
        actions: acts,
      };
    },
  };
}
