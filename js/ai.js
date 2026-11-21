// Saran menu dari AI lewat OpenRouter.
// API key OpenRouter adalah KEY KELUARGA: satu key untuk seluruh anggota, disimpan di data keluarga (app_settings).
// Semua anggota memakainya; hanya pemilik rumah (anggota pertama) yang dapat mengubah/menghapusnya (izin ditegakkan Appwrite).
import { h, chip, modal, toast, today, addDays, daysBetween, fmtDate, fmtShort } from "./ui.js";
import { state, insertMany, updateRow, isOwner, ownerMember, familyAI, saveFamilyAI } from "./data.js";

export const DEFAULT_MODEL = "openrouter/free";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const MEALS = ["Sarapan", "Makan siang", "Makan malam", "Camilan"];

// ---------- Key & model (key keluarga) ----------
export function getAI() { const f = familyAI(); return { key: f.key, model: f.model || DEFAULT_MODEL }; }
const ownerLabel = () => { const o = ownerMember(); return o ? `${o.display_name} (${o.role_name})` : "pembuat rumah"; };
// Key pribadi dari versi lama (di perangkat ini) hanya dipakai untuk mengisi otomatis formulir pemilik; tidak dipakai langsung.
const legacyKey = () => { try { return JSON.parse(localStorage.getItem("omahku_ai_" + state.user?.id) || "{}").key || ""; } catch { return ""; } };
export function forgetAI(userId) { try { localStorage.removeItem("omahku_ai_" + userId); } catch { /* abaikan */ } }
const maskKey = (k) => (k.length > 8 ? "••••" + k.slice(-4) : "••••");

// ---------- Panggilan ke OpenRouter ----------
async function callAI(messages, { maxTokens = 4000, timeout = 120000 } = {}) {
  const { key, model } = getAI();
  if (!key) throw new Error("API key OpenRouter belum diisi.");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST", signal: ctrl.signal,
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", "HTTP-Referer": location.origin, "X-Title": "Omahku" },
      body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: maxTokens }),
    });
  } catch (e) {
    throw new Error(e?.name === "AbortError" ? "AI terlalu lama menjawab. Coba lagi, atau kurangi jumlah resep." : "Tidak bisa terhubung ke OpenRouter. Periksa koneksi internet.");
  } finally { clearTimeout(timer); }

  let data = null;
  try { data = await res.json(); } catch { /* biarkan null */ }
  if (!res.ok) {
    const m = data?.error?.message;
    if (res.status === 401) throw new Error(isOwner() ? "API key tidak valid. Periksa lagi kuncinya." : `Key AI keluarga tidak valid. Minta ${ownerLabel()} memperbaikinya.`);
    if (res.status === 402) throw new Error("Saldo OpenRouter tidak cukup. Isi saldo, atau pakai model gratis (openrouter/free).");
    if (res.status === 404) throw new Error("Model tidak ditemukan. Periksa nama modelnya.");
    if (res.status === 429) throw new Error("Terlalu banyak permintaan atau model gratis sedang penuh. Tunggu sebentar lalu coba lagi.");
    throw new Error(m ? "OpenRouter: " + m : `OpenRouter error (${res.status}).`);
  }
  const text = data?.choices?.[0]?.message?.content;
  if (!text || typeof text !== "string") throw new Error("AI tidak memberi jawaban. Coba lagi.");
  return text;
}

function parseJSON(text) {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("Jawaban AI tidak bisa dibaca. Coba lagi.");
  try { return JSON.parse(text.slice(a, b + 1)); }
  catch { throw new Error("Jawaban AI tidak bisa dibaca. Coba lagi."); }
}

const str = (v, n = 200) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };

function normRecipe(r) {
  const dish = str(r?.dish, 120);
  if (!dish) return null;
  const ingredients = (Array.isArray(r.ingredients) ? r.ingredients : [])
    .map((i) => (typeof i === "string" ? { name: str(i, 80), qty: "" } : { name: str(i?.name, 80), qty: str(i?.qty, 40) }))
    .map((i) => ({ name: i.name.replace(/,/g, " "), qty: i.qty.replace(/,/g, " ") }))
    .filter((i) => i.name).slice(0, 40);
  const steps = (Array.isArray(r.steps) ? r.steps : [])
    .map((s) => str(s, 500).replace(/^\d+\s*[.)]\s*/, "")).filter(Boolean).slice(0, 25);
  const mins = num(r.time_minutes), serv = num(r.servings);
  return {
    dish, ingredients, steps,
    meal: MEALS.includes(r.meal) ? r.meal : "Makan siang",
    info: [mins ? `⏱ ${mins} menit` : "", serv ? `🍽 ${serv} porsi` : ""].filter(Boolean).join(" · "),
    tip: str(r.tip, 300),
  };
}

const SYSTEM = `Kamu adalah asisten dapur untuk keluarga di Indonesia. Beri resep praktis dan hemat dengan bahan yang mudah dibeli di pasar atau supermarket Indonesia. Tulis dalam Bahasa Indonesia dengan takaran jelas (gram, sdm, sdt, siung, butir, dll) dan langkah memasak yang rinci.
Balas HANYA dengan JSON valid, tanpa teks lain dan tanpa markdown, dengan bentuk persis:
{"recipes":[{"dish":"nama masakan","meal":"Sarapan | Makan siang | Makan malam | Camilan","time_minutes":30,"servings":4,"ingredients":[{"name":"Ayam","qty":"500 g"}],"steps":["Langkah pertama","Langkah kedua"],"tip":"tips singkat"}]}`;

async function askRecipes(userPrompt) {
  const text = await callAI([{ role: "system", content: SYSTEM }, { role: "user", content: userPrompt }]);
  const list = parseJSON(text).recipes;
  const out = (Array.isArray(list) ? list : []).map(normRecipe).filter(Boolean);
  if (!out.length) throw new Error("AI tidak memberi resep yang bisa dipakai. Coba lagi dengan permintaan lain.");
  return out;
}

// ---------- Bantu: stok & belanja ----------
const norm = (s) => String(s || "").toLowerCase().trim();
const inStock = (name) => state.data.stock_items.some((s) => {
  const a = norm(name), b = norm(s.name);
  return b.length >= 3 && a.length >= 3 && Number(s.qty) > Number(s.min_qty) && (a === b || a.startsWith(b + " ") || b.startsWith(a + " "));
});
const stockNames = () => state.data.stock_items.filter((s) => Number(s.qty) > Number(s.min_qty)).map((s) => s.name).slice(0, 40);

function shoppingFrom(recipes, skipStock) {
  const map = new Map();
  for (const r of recipes) for (const i of r.ingredients) {
    if (skipStock && inStock(i.name)) continue;
    const k = norm(i.name), prev = map.get(k);
    if (!prev) map.set(k, { name: i.name, qty: i.qty });
    else if (i.qty && prev.qty !== i.qty) prev.qty = prev.qty ? `${prev.qty} + ${i.qty}` : i.qty;
  }
  return [...map.values()];
}

const ingLine = (i) => (i.qty ? `${i.name} ${i.qty}` : i.name);
const stepsText = (steps) => steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
const notesText = (r) => [r.info, r.tip ? "💡 " + r.tip : ""].filter(Boolean).join("\n");

const noKeyPanel = () => h("div", { class: "msg" }, `🔑 Key AI keluarga belum diatur. Minta ${ownerLabel()} mengisinya di Pengaturan → Key AI keluarga.`);

// Formulir isi key keluarga (hanya untuk pemilik rumah).
function keyForm({ onDone, onCancel, onDeleted }) {
  if (!isOwner()) return noKeyPanel();
  const ai = getAI();
  const key = h("input", { id: "ai_key", type: "password", placeholder: "sk-or-v1-…", autocomplete: "off", spellcheck: "false", value: ai.key || legacyKey() });
  const mdl = h("input", { id: "ai_model", type: "text", list: "ai_models", autocomplete: "off", spellcheck: "false", value: ai.model });
  const err = h("div", { class: "msg err", hidden: true });
  const submit = h("button", { class: "btn pink", type: "submit" }, "Simpan");
  const save = async () => {
    const k = key.value.trim(), m = mdl.value.trim() || DEFAULT_MODEL;
    if (!k) { err.textContent = "API key wajib diisi."; err.hidden = false; key.focus(); return; }
    submit.disabled = true;
    try { await saveFamilyAI({ key: k, model: m }); forgetAI(state.user?.id); toast("Key keluarga tersimpan ✓", "ok"); onDone(); }
    catch (e) { console.error(e); err.textContent = e?.message || "Gagal menyimpan."; err.hidden = false; submit.disabled = false; }
  };
  const remove = async () => {
    try { await saveFamilyAI({ key: "", model: ai.model }); toast("Key keluarga dihapus"); onDeleted?.(); }
    catch (e) { console.error(e); toast(e?.message || "Gagal menghapus", "err"); }
  };
  return h("form", { novalidate: true, onsubmit: (e) => { e.preventDefault(); save(); } },
    h("div", { class: "msg" }, `Key ini dipakai bersama seluruh keluarga. Hanya pembuat rumah (${ownerLabel()}) yang dapat mengubah atau menghapusnya; anggota lain hanya memakainya.`),
    err,
    h("div", { class: "field" }, h("label", { for: "ai_key" }, "API key OpenRouter"), key,
      h("div", { class: "hint" }, "Buat di ", h("a", { href: "https://openrouter.ai/settings/keys", target: "_blank", rel: "noopener" }, "openrouter.ai/settings/keys"), ". Disarankan pasang batas penggunaan (credit limit) pada key.")),
    h("div", { class: "field" }, h("label", { for: "ai_model" }, "Model"), mdl,
      h("datalist", { id: "ai_models" }, [DEFAULT_MODEL, "openrouter/auto", "openai/gpt-4o-mini"].map((m) => h("option", { value: m }))),
      h("div", { class: "hint" }, "Biarkan openrouter/free untuk model gratis. Daftar model lain di openrouter.ai/models.")),
    h("div", { class: "foot" },
      ai.key ? h("button", { class: "btn white", type: "button", onclick: remove }, "Hapus key") : null,
      ai.key && onCancel ? h("button", { class: "btn white", type: "button", onclick: onCancel }, "Batal") : null,
      submit));
}

// Kotak "Key AI keluarga" di halaman Pengaturan: semua anggota melihat statusnya; hanya pemilik yang bisa mengubah.
export function familyKeyBox() {
  const ai = getAI(), owner = isOwner();
  const rerender = () => document.dispatchEvent(new CustomEvent("rt:rerender"));
  const open = () => { const close = modal("🔑 Key AI keluarga", keyForm({ onDone: () => { close(); rerender(); }, onCancel: () => close(), onDeleted: () => { close(); rerender(); } })); };
  return h("section", { class: "box card" }, h("h3", null, "🔑 Key AI keluarga"),
    h("div", { class: "li" },
      h("div", { class: "grow" }, ai.key ? ["Aktif ", h("b", null, maskKey(ai.key))] : "Belum diatur",
        h("small", null, ai.key ? "Model: " + ai.model : owner ? "Isi key OpenRouter agar fitur AI bisa dipakai keluarga." : `Minta ${ownerLabel()} mengisinya.`)),
      owner ? h("button", { class: "btn sm white", type: "button", onclick: open }, ai.key ? "Ubah" : "Atur") : chip("🔒 Hanya pembuat rumah", "yellow")),
    h("div", { class: "note" }, "Satu key dipakai bersama oleh seluruh anggota keluarga untuk fitur saran AI."));
}

// Pastikan key ada. Pemilik: buka jendela isi key bila belum ada. Anggota lain: beri tahu siapa yang harus mengisinya.
export function ensureAIKey() {
  return new Promise((resolve) => {
    if (getAI().key) return resolve(true);
    if (!isOwner()) { toast(`Key AI keluarga belum diatur. Minta ${ownerLabel()} mengisinya di Pengaturan.`, "err"); return resolve(false); }
    let done = false, close = () => {};
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    close = modal("🔑 Key AI keluarga", keyForm({ onDone: () => { finish(true); close(); } }), { onClose: () => finish(false) });
  });
}

// Minta AI menjawab dalam bentuk JSON (dipakai fitur lain, mis. saran servis).
export async function askAIJSON(system, user, opts) {
  return parseJSON(await callAI([{ role: "system", content: system }, { role: "user", content: user }], opts));
}
export { str as aiStr, num as aiNum };

// ============================================================
// Jendela "Saran AI"
// ============================================================
export function openAIAdvisor({ addToShopping }) {
  const box = h("div");
  let close = () => {};
  let showSettings = false;

  const render = () => { box.replaceChildren(settingsPanel(), ...(getAI().key && !showSettings ? [mainPanel()] : [])); };

  // ----- Pengaturan key (hanya pemilik yang bisa mengubah) -----
  function settingsPanel() {
    const ai = getAI(), owner = isOwner();
    if (!ai.key) return owner ? keyForm({ onDone: render, onDeleted: render }) : noKeyPanel();
    if (owner && showSettings) {
      return keyForm({ onDone: () => { showSettings = false; render(); }, onCancel: () => { showSettings = false; render(); }, onDeleted: () => { showSettings = false; render(); } });
    }
    return h("div", { class: "li", style: { marginBottom: "1rem" } },
      h("div", { class: "grow" }, "🔑 Key keluarga aktif ", h("b", null, maskKey(ai.key)), h("small", null, "Model: " + ai.model)),
      owner ? h("button", { class: "btn sm white", type: "button", onclick: () => { showSettings = true; render(); } }, "Ubah") : null);
  }

  // ----- Form permintaan + hasil -----
  function mainPanel() {
    const wish = h("textarea", { id: "ai_wish", rows: 3, placeholder: "mis. menu hemat untuk 3 hari, anak tidak suka pedas, ada ayam dan tempe di kulkas" });
    const count = h("select", { id: "ai_count" }, [1, 3, 5, 7].map((n) => h("option", { value: n, selected: n === 3 }, `${n} resep`)));
    const meal = h("select", { id: "ai_meal" }, [["", "Semua waktu makan"], ...MEALS.map((m) => [m, m])].map(([v, l]) => h("option", { value: v }, l)));
    const serv = h("input", { id: "ai_serv", type: "number", min: 1, max: 20, value: 4, inputmode: "numeric" });
    const start = h("input", { id: "ai_start", type: "date", value: today() });
    const useStock = h("input", { id: "ai_stock", type: "checkbox", checked: true });
    const go = h("button", { class: "btn pink block", type: "submit" }, "✨ Minta saran");
    const results = h("div", { style: { marginTop: "1rem" } });

    const form = h("form", { novalidate: true },
      h("div", { class: "field" }, h("label", { for: "ai_wish" }, "Mau masak apa?"), wish, h("div", { class: "hint" }, "Boleh dikosongkan, AI akan memberi menu rumahan yang bervariasi.")),
      h("div", { class: "row" },
        h("div", { class: "field" }, h("label", { for: "ai_count" }, "Jumlah resep"), count),
        h("div", { class: "field" }, h("label", { for: "ai_meal" }, "Waktu makan"), meal)),
      h("div", { class: "row" },
        h("div", { class: "field" }, h("label", { for: "ai_serv" }, "Porsi (orang)"), serv),
        h("div", { class: "field" }, h("label", { for: "ai_start" }, "Mulai tanggal"), start)),
      h("label", { class: "checks", style: { display: "flex", flexDirection: "row", alignItems: "center", gap: ".6rem", marginBottom: "1rem", cursor: "pointer" } }, useStock, h("span", null, "Utamakan bahan yang masih ada di Stok")),
      go);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const n = Number(count.value), recent = state.data.menus.slice(-20).map((m) => m.dish).filter(Boolean);
      const lines = [
        `Buatkan ${n} resep berbeda.`,
        `Permintaan keluarga: ${wish.value.trim() || "menu rumahan sehari-hari yang bervariasi dan bergizi"}.`,
        `Waktu makan: ${meal.value || "campur (sarapan, makan siang, makan malam)"}.`,
        `Porsi: ${Math.max(1, Number(serv.value) || 4)} orang.`,
        useStock.checked && stockNames().length ? `Bahan yang masih ada di rumah (utamakan): ${stockNames().join(", ")}.` : "",
        recent.length ? `Hindari masakan yang sudah ada di rencana menu: ${recent.join(", ")}.` : "",
      ].filter(Boolean).join("\n");
      go.disabled = true; go.textContent = "⏳ AI sedang menulis resep…";
      results.replaceChildren(h("div", { class: "spinner", "aria-label": "Memuat" }));
      try {
        const recipes = await askRecipes(lines);
        results.replaceChildren(resultsView(recipes, start.value || today()));
      } catch (err) {
        results.replaceChildren(h("div", { class: "msg err" }, err.message));
      } finally { go.disabled = false; go.textContent = "✨ Minta saran lagi"; }
    });
    return h("div", null, form, results);
  }

  // ----- Daftar hasil + simpan -----
  function resultsView(recipes, startDate) {
    const sel = recipes.map(() => ({ on: true }));
    const dates = recipes.map((_, i) => addDays(startDate, i));
    const meals = recipes.map((r) => r.meal);
    const addShop = h("input", { type: "checkbox", checked: true });
    const saveBtn = h("button", { class: "btn green block", type: "button" });
    const upd = () => { const n = sel.filter((s) => s.on).length; saveBtn.textContent = `💾 Simpan ${n} resep ke Menu`; saveBtn.disabled = !n; };

    const cards = recipes.map((r, i) => {
      const cb = h("input", { type: "checkbox", checked: true, "aria-label": "Pilih " + r.dish, onchange: (e) => { sel[i].on = e.target.checked; upd(); } });
      const d = h("input", { type: "date", value: dates[i], "aria-label": "Tanggal " + r.dish, onchange: (e) => { dates[i] = e.target.value || dates[i]; } });
      const m = h("select", { "aria-label": "Waktu makan " + r.dish, onchange: (e) => { meals[i] = e.target.value; } }, MEALS.map((x) => h("option", { value: x, selected: x === r.meal }, x)));
      return h("article", { class: "box", style: { padding: ".8rem", boxShadow: "var(--sh-sm)", marginBottom: ".8rem", display: "flex", flexDirection: "column", gap: ".55rem" } },
        h("div", { style: { display: "flex", gap: ".7rem", alignItems: "flex-start" } }, cb,
          h("div", { style: { flex: 1, minWidth: 0 } }, h("div", { class: "ct", style: { fontWeight: 700, fontSize: "1.08rem", overflowWrap: "anywhere" } }, r.dish),
            h("div", { class: "meta", style: { display: "flex", flexWrap: "wrap", gap: ".4rem", marginTop: ".35rem" } }, chip("✨ AI", "lilac"), r.info ? chip(r.info) : null))),
        h("div", { class: "note", style: { fontSize: ".92rem", overflowWrap: "anywhere" } }, "🧂 " + (r.ingredients.map(ingLine).join(", ") || "—")),
        r.steps.length ? h("details", { class: "steps" }, h("summary", null, `👩‍🍳 Cara memasak (${r.steps.length} langkah)`), h("ol", null, r.steps.map((s) => h("li", null, s)))) : null,
        r.tip ? h("div", { class: "note", style: { fontSize: ".9rem" } }, "💡 " + r.tip) : null,
        h("div", { class: "row" }, d, m));
    });

    saveBtn.addEventListener("click", async () => {
      const chosen = recipes.map((r, i) => ({ r, i })).filter(({ i }) => sel[i].on);
      if (!chosen.length) return;
      saveBtn.disabled = true;
      try {
        await insertMany("menus", chosen.map(({ r, i }) => ({
          dish: r.dish, date: dates[i], meal: meals[i], ai: true,
          ingredients: r.ingredients.map(ingLine).join("\n"),
          steps: stepsText(r.steps) || null,
          notes: notesText(r) || null,
        })));
        toast(`${chosen.length} resep masuk ke Menu ✓`, "ok");
        if (addShop.checked) await addToShopping(shoppingFrom(chosen.map(({ r }) => r), true));
        close();
      } catch (e) { console.error(e); toast(e?.message || "Gagal menyimpan", "err"); saveBtn.disabled = false; }
    });
    upd();
    return h("div", null,
      h("h3", { style: { margin: ".2rem 0 .8rem" } }, "Hasil saran"), cards,
      h("label", { class: "checks", style: { display: "flex", flexDirection: "row", alignItems: "center", gap: ".6rem", margin: ".4rem 0 1rem", cursor: "pointer" } }, addShop, h("span", null, "Masukkan bahan ke Daftar Belanja (yang belum ada di Stok)")),
      saveBtn);
  }

  render();
  close = modal("✨ Saran Menu dari AI", box);
}

// ============================================================
// Lengkapi resep yang sudah ada (bahan + cara memasak)
// ============================================================
export async function completeRecipe(row, { addToShopping }, btn) {
  if (!getAI().key) { toast("Key AI keluarga belum diatur."); return openAIAdvisor({ addToShopping }); }
  if (btn) { btn.disabled = true; btn.textContent = "⏳ AI menulis…"; }
  try {
    const have = (row.ingredients || "").split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    const [r] = await askRecipes([
      `Lengkapi resep untuk masakan "${row.dish}" (${row.meal || "makan siang"}).`,
      have.length ? `Bahan yang sudah dicatat keluarga (pakai ini sebagai dasar): ${have.join(", ")}.` : "",
      "Buat hanya 1 resep untuk masakan ini, dengan daftar bahan lengkap dan langkah memasak rinci.",
    ].filter(Boolean).join("\n"));
    const patch = { steps: stepsText(r.steps) || null, ai: true };
    if (!have.length) patch.ingredients = r.ingredients.map(ingLine).join("\n");
    if (!row.notes) patch.notes = notesText(r) || null;
    await updateRow("menus", row.id, patch);
    toast("Resep dilengkapi ✨", "ok");
  } catch (e) {
    console.error(e); toast(e?.message || "Gagal meminta AI", "err");
    if (btn) { btn.disabled = false; btn.textContent = "✨ Resep AI"; }
  }
}

// ============================================================
// Rencana menu mingguan (dari stok, utamakan yang hampir kedaluwarsa)
// ============================================================
const WEEK_SYSTEM = `Kamu adalah perencana menu mingguan untuk keluarga di Indonesia. Susun menu rumahan yang hemat, bergizi, dan bervariasi (jangan mengulang masakan yang sama), dengan bahan yang mudah dibeli di pasar atau supermarket Indonesia. Tulis dalam Bahasa Indonesia dengan takaran jelas.
Balas HANYA dengan JSON valid, tanpa teks lain dan tanpa markdown, dengan bentuk persis:
{"days":[{"day":0,"meals":[{"meal":"Makan siang","dish":"nama masakan","time_minutes":30,"servings":4,"ingredients":[{"name":"Ayam","qty":"500 g"}]}]}]}
"day" adalah nomor hari mulai dari 0. Jangan menulis langkah memasak.`;

const WEEKDAY = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const dayName = (iso) => WEEKDAY[new Date(iso + "T00:00:00").getDay()];
const daysLeftOf = (r) => (r.expiry_date ? daysBetween(today(), r.expiry_date) : null);
const usableStock = () => state.data.stock_items.filter((s) => Number(s.qty) > 0 && !(daysLeftOf(s) != null && daysLeftOf(s) < 0));
const stockHit = (name, list) => list.find((s) => { const a = norm(name), b = norm(s.name); return a.length >= 3 && b.length >= 3 && (a === b || a.startsWith(b + " ") || b.startsWith(a + " ")); });

function normWeek(raw, nDays, meals, taken) {
  const seenDish = new Set(), seenSlot = new Set(), out = [];
  for (const d of Array.isArray(raw?.days) ? raw.days : []) {
    const day = Number(d?.day);
    if (!Number.isInteger(day) || day < 0 || day >= nDays) continue;
    for (const m of Array.isArray(d?.meals) ? d.meals : []) {
      const r = normRecipe({ ...m, steps: [], meal: m?.meal });
      if (!r || !meals.includes(r.meal)) continue;
      const slot = day + "|" + r.meal, dish = norm(r.dish);
      if (taken.has(slot) || seenSlot.has(slot) || seenDish.has(dish)) continue;
      seenSlot.add(slot); seenDish.add(dish);
      out.push({ ...r, day });
    }
  }
  return out.sort((a, b) => a.day - b.day || MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal));
}

export async function openWeeklyPlanner({ addToShopping }) {
  if (!(await ensureAIKey())) return;
  const box = h("div");
  let close = () => {};

  const days = h("select", { id: "wp_days" }, [3, 5, 7].map((n) => h("option", { value: n, selected: n === 7 }, `${n} hari`)));
  const start = h("input", { id: "wp_start", type: "date", value: today() });
  const serv = h("input", { id: "wp_serv", type: "number", min: 1, max: 20, value: 4, inputmode: "numeric" });
  const wish = h("textarea", { id: "wp_wish", rows: 2, placeholder: "mis. hemat, anak tidak suka pedas, minggu ini banyak sayur" });
  const mealBoxes = MEALS.slice(0, 3).map((m) => ({ m, el: h("input", { type: "checkbox", checked: m !== "Sarapan", "aria-label": m }) }));
  const useStock = h("input", { id: "wp_stock", type: "checkbox", checked: true });
  const go = h("button", { class: "btn pink block", type: "submit" }, "📆 Buat rencana");
  const results = h("div", { style: { marginTop: "1rem" } });

  const form = h("form", { novalidate: true },
    h("div", { class: "msg" }, "AI menyusun menu per hari, memakai stok di rumah lebih dulu (terutama yang hampir kedaluwarsa), dan melewati jadwal yang sudah terisi. Cara memasak bisa diminta nanti lewat tombol ✨ Resep AI di tiap menu."),
    h("div", { class: "row" }, h("div", { class: "field" }, h("label", { for: "wp_start" }, "Mulai tanggal"), start), h("div", { class: "field" }, h("label", { for: "wp_days" }, "Lama rencana"), days)),
    h("div", { class: "field" }, h("label", null, "Waktu makan yang direncanakan"),
      h("div", { style: { display: "flex", flexWrap: "wrap", gap: ".5rem 1.2rem" } }, mealBoxes.map(({ m, el }) => h("label", { class: "checks", style: { display: "flex", flexDirection: "row", alignItems: "center", gap: ".5rem", cursor: "pointer" } }, el, h("span", null, m))))),
    h("div", { class: "row" }, h("div", { class: "field" }, h("label", { for: "wp_serv" }, "Porsi (orang)"), serv)),
    h("div", { class: "field" }, h("label", { for: "wp_wish" }, "Permintaan khusus (opsional)"), wish),
    h("label", { class: "checks", style: { display: "flex", flexDirection: "row", alignItems: "center", gap: ".6rem", marginBottom: "1rem", cursor: "pointer" } }, useStock, h("span", null, "Utamakan bahan dari Stok")),
    go);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const meals = mealBoxes.filter(({ el }) => el.checked).map(({ m }) => m);
    if (!meals.length) { results.replaceChildren(h("div", { class: "msg err" }, "Pilih minimal satu waktu makan.")); return; }
    const n = Number(days.value), startDate = start.value || today();
    const taken = new Set();
    const takenTxt = [];
    for (let i = 0; i < n; i++) for (const m of meals) {
      const ex = state.data.menus.find((x) => x.date === addDays(startDate, i) && x.meal === m);
      if (ex) { taken.add(i + "|" + m); takenTxt.push(`hari ${i} ${m}: ${ex.dish}`); }
    }
    const stock = useStock.checked ? usableStock() : [];
    const soon = stock.filter((s) => { const d = daysLeftOf(s); return d != null && d <= 7; }).sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
    const rest = stock.filter((s) => !soon.includes(s)).slice(0, 40);
    const prompt = [
      `Buat rencana menu ${n} hari. Hari 0 = ${startDate} (${dayName(startDate)}); lalu hari 1, 2, dst. berurutan.`,
      `Waktu makan yang diisi tiap hari: ${meals.join(", ")}. Setiap hari semua waktu makan itu harus terisi, kecuali yang sudah terisi.`,
      `Porsi: ${Math.max(1, Number(serv.value) || 4)} orang.`,
      `Permintaan keluarga: ${wish.value.trim() || "menu rumahan sehari-hari yang bervariasi dan bergizi"}.`,
      soon.length ? `Bahan yang HAMPIR KEDALUWARSA (pakai lebih dulu, di hari-hari awal): ${soon.map((s) => `${s.name} (kedaluwarsa ${s.expiry_date}, sisa ${Number(s.qty)}${s.unit ? " " + s.unit : ""})`).join("; ")}.` : "",
      rest.length ? `Bahan lain yang masih ada di rumah: ${rest.map((s) => s.name).join(", ")}.` : "",
      takenTxt.length ? `Jadwal yang sudah terisi (jangan dibuat ulang): ${takenTxt.join("; ")}.` : "",
    ].filter(Boolean).join("\n");
    go.disabled = true; go.textContent = "⏳ AI menyusun rencana…";
    results.replaceChildren(h("div", { class: "spinner", "aria-label": "Memuat" }));
    try {
      const raw = await askAIJSON(WEEK_SYSTEM, prompt, { maxTokens: 7000, timeout: 180000 });
      const plan = normWeek(raw, n, meals, taken);
      if (!plan.length) throw new Error("AI tidak memberi rencana yang bisa dipakai. Coba lagi, atau kurangi jumlah hari.");
      results.replaceChildren(planView(plan, startDate, soon));
    } catch (err) {
      results.replaceChildren(h("div", { class: "msg err" }, err.message));
    } finally { go.disabled = false; go.textContent = "📆 Buat ulang rencana"; }
  });

  function planView(plan, startDate, soon) {
    const on = plan.map(() => true);
    const addShop = h("input", { type: "checkbox", checked: true });
    const saveBtn = h("button", { class: "btn green block", type: "button" });
    const upd = () => { const c = on.filter(Boolean).length; saveBtn.textContent = `💾 Simpan ${c} menu ke Menu Dapur`; saveBtn.disabled = !c; };
    const out = [h("h3", { style: { margin: ".2rem 0 .8rem" } }, `Rencana ${plan.length} menu`)];
    let curDay = -1;
    plan.forEach((r, i) => {
      if (r.day !== curDay) { curDay = r.day; const d = addDays(startDate, r.day); out.push(h("div", { class: "group-title" }, `${dayName(d)}, ${fmtShort(d)}`)); }
      const useSoon = r.ingredients.some((g) => stockHit(g.name, soon));
      const useStk = r.ingredients.filter((g) => stockHit(g.name, usableStock())).length;
      out.push(h("article", { class: "box", style: { padding: ".7rem .8rem", boxShadow: "var(--sh-sm)", margin: ".5rem 0 .8rem", display: "flex", flexDirection: "column", gap: ".4rem" } },
        h("div", { style: { display: "flex", gap: ".7rem", alignItems: "flex-start" } },
          h("input", { type: "checkbox", checked: true, "aria-label": "Pilih " + r.dish, onchange: (e) => { on[i] = e.target.checked; upd(); } }),
          h("div", { style: { flex: 1, minWidth: 0 } }, h("div", { style: { fontWeight: 700, overflowWrap: "anywhere" } }, r.dish),
            h("div", { style: { display: "flex", flexWrap: "wrap", gap: ".4rem", marginTop: ".35rem" } }, chip(r.meal, "pink"), r.info ? chip(r.info) : null,
              useSoon ? chip("♻ Pakai stok hampir kedaluwarsa", "orange") : useStk ? chip(`📦 ${useStk} bahan dari stok`, "green") : null))),
        h("div", { class: "note", style: { fontSize: ".9rem", overflowWrap: "anywhere" } }, "🧂 " + (r.ingredients.map(ingLine).join(", ") || "—"))));
    });
    const need = shoppingFrom(plan, true).length;
    saveBtn.addEventListener("click", async () => {
      const chosen = plan.filter((_, i) => on[i]);
      if (!chosen.length) return;
      saveBtn.disabled = true;
      try {
        await insertMany("menus", chosen.map((r) => ({ dish: r.dish, date: addDays(startDate, r.day), meal: r.meal, ai: true, ingredients: r.ingredients.map(ingLine).join("\n"), steps: null, notes: r.info || null })));
        toast(`${chosen.length} menu masuk ke Menu Dapur ✓`, "ok");
        if (addShop.checked) await addToShopping(shoppingFrom(chosen, true));
        close();
      } catch (e) { console.error(e); toast(e?.message || "Gagal menyimpan", "err"); saveBtn.disabled = false; }
    });
    upd();
    out.push(h("label", { class: "checks", style: { display: "flex", flexDirection: "row", alignItems: "center", gap: ".6rem", margin: ".6rem 0 1rem", cursor: "pointer" } }, addShop,
      h("span", null, `Masukkan bahan ke Daftar Belanja (sekitar ${need} jenis, yang belum ada di Stok)`)), saveBtn);
    return h("div", null, out);
  }

  box.append(form, results);
  close = modal("📆 Rencana Menu Mingguan", box);
}
