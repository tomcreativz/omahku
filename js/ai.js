// Saran menu dari AI lewat OpenRouter.
// API key diisi sendiri oleh tiap pengguna dan disimpan HANYA di perangkat ini (localStorage).
// Key tidak masuk ke database keluarga dan tidak terlihat oleh pasangan.
import { h, chip, modal, toast, today, addDays } from "./ui.js";
import { state, insertMany, updateRow } from "./data.js";

export const DEFAULT_MODEL = "openrouter/free";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const MEALS = ["Sarapan", "Makan siang", "Makan malam", "Camilan"];

// ---------- Penyimpanan key & model (per pengguna, per perangkat) ----------
const lsKey = () => "omahku_ai_" + (state.user?.id || "x");
export function getAI() {
  try { const o = JSON.parse(localStorage.getItem(lsKey()) || "{}"); return { key: o.key || "", model: o.model || DEFAULT_MODEL }; }
  catch { return { key: "", model: DEFAULT_MODEL }; }
}
function saveAI(o) {
  try { localStorage.setItem(lsKey(), JSON.stringify(o)); return true; } catch { return false; }
}
const maskKey = (k) => (k.length > 8 ? "••••" + k.slice(-4) : "••••");

// ---------- Panggilan ke OpenRouter ----------
async function callAI(messages) {
  const { key, model } = getAI();
  if (!key) throw new Error("API key OpenRouter belum diisi.");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST", signal: ctrl.signal,
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", "HTTP-Referer": location.origin, "X-Title": "Omahku" },
      body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 4000 }),
    });
  } catch (e) {
    throw new Error(e?.name === "AbortError" ? "AI terlalu lama menjawab. Coba lagi, atau kurangi jumlah resep." : "Tidak bisa terhubung ke OpenRouter. Periksa koneksi internet.");
  } finally { clearTimeout(timer); }

  let data = null;
  try { data = await res.json(); } catch { /* biarkan null */ }
  if (!res.ok) {
    const m = data?.error?.message;
    if (res.status === 401) throw new Error("API key tidak valid. Periksa lagi kuncinya.");
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

// ============================================================
// Jendela "Saran AI"
// ============================================================
export function openAIAdvisor({ addToShopping }) {
  const box = h("div");
  let close = () => {};
  let showSettings = !getAI().key;

  const render = () => { box.replaceChildren(settingsPanel(), ...(getAI().key && !showSettings ? [mainPanel()] : [])); };

  // ----- Pengaturan key -----
  function settingsPanel() {
    const ai = getAI();
    if (ai.key && !showSettings) {
      return h("div", { class: "li", style: { marginBottom: "1rem" } },
        h("div", { class: "grow" }, "🔑 API key tersimpan ", h("b", null, maskKey(ai.key)), h("small", null, "Model: " + ai.model)),
        h("button", { class: "btn sm white", type: "button", onclick: () => { showSettings = true; render(); } }, "Ubah"));
    }
    const key = h("input", { id: "ai_key", type: "password", placeholder: "sk-or-v1-…", autocomplete: "off", spellcheck: "false", value: ai.key });
    const mdl = h("input", { id: "ai_model", type: "text", list: "ai_models", autocomplete: "off", spellcheck: "false", value: ai.model });
    const err = h("div", { class: "msg err", hidden: true });
    const save = () => {
      const k = key.value.trim(), m = mdl.value.trim() || DEFAULT_MODEL;
      if (!k) { err.textContent = "API key wajib diisi."; err.hidden = false; key.focus(); return; }
      if (!saveAI({ key: k, model: m })) { err.textContent = "Browser menolak menyimpan. Matikan mode privat lalu coba lagi."; err.hidden = false; return; }
      showSettings = false; toast("API key tersimpan ✓", "ok"); render();
    };
    return h("form", { novalidate: true, onsubmit: (e) => { e.preventDefault(); save(); } },
      h("div", { class: "msg" }, "Isi API key OpenRouter Anda sendiri. Key hanya disimpan di perangkat ini, tidak masuk ke data keluarga dan tidak terlihat oleh pasangan."),
      err,
      h("div", { class: "field" }, h("label", { for: "ai_key" }, "API key OpenRouter"), key,
        h("div", { class: "hint" }, "Buat di ", h("a", { href: "https://openrouter.ai/settings/keys", target: "_blank", rel: "noopener" }, "openrouter.ai/settings/keys"), ". Disarankan pasang batas penggunaan (credit limit) pada key.")),
      h("div", { class: "field" }, h("label", { for: "ai_model" }, "Model"), mdl,
        h("datalist", { id: "ai_models" }, [DEFAULT_MODEL, "openrouter/auto", "openai/gpt-4o-mini"].map((m) => h("option", { value: m }))),
        h("div", { class: "hint" }, "Biarkan openrouter/free untuk model gratis. Daftar model lain di openrouter.ai/models.")),
      h("div", { class: "foot" },
        ai.key ? h("button", { class: "btn white", type: "button", onclick: () => { saveAI({ key: "", model: ai.model }); showSettings = true; toast("API key dihapus"); render(); } }, "Hapus key") : null,
        ai.key ? h("button", { class: "btn white", type: "button", onclick: () => { showSettings = false; render(); } }, "Batal") : null,
        h("button", { class: "btn pink", type: "submit" }, "Simpan")));
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
  if (!getAI().key) { toast("Isi API key OpenRouter dulu."); return openAIAdvisor({ addToShopping }); }
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
