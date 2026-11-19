// Jendela penghubung Belanja ↔ Stok ↔ Menu.
import { h, modal, confirmBox, toast, today } from "./ui.js";
import { state, insertRow, updateRow, deleteMany } from "./data.js";
import { parseQty, planStockIn, planCook, convert, round, defaultMin, candidates, qtyText, STOCK_CATS, UNIT_LIST } from "./kitchen.js";

const num = (v) => { const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) ? n : NaN; };
const field = (label, input) => h("label", { class: "field", style: { margin: 0 } }, h("span", { style: { fontSize: ".78rem", fontWeight: 700 } }, label), input);
const stockInfo = (s) => `${s.name}: ${qtyText(Number(s.qty) || 0, s.unit)}`;

// ---------------------------------------------------------------
// Belanja → Stok. `only` = daftar barang tertentu; bila kosong, semua yang sudah dibeli.
// ---------------------------------------------------------------
export function openStockIn({ run }, only) {
  const items = (only || state.data.shopping_items.filter((r) => r.done));
  if (!items.length) return toast("Centang dulu barang yang sudah dibeli.");
  const dl = h("datalist", { id: "unit_list" }, UNIT_LIST.map((u) => h("option", { value: u })));
  const cards = items.map((r) => {
    const q = parseQty(r.qty);
    const inc = h("input", { type: "checkbox", checked: true, "aria-label": "Masukkan " + r.name });
    const name = h("input", { type: "text", value: r.name, "aria-label": "Nama" });
    const qty = h("input", { type: "text", inputmode: "decimal", value: q.n != null ? String(round(q.n)) : "1", "aria-label": "Jumlah" });
    const unit = h("input", { type: "text", value: q.unit || "", list: "unit_list", placeholder: "satuan", "aria-label": "Satuan", autocomplete: "off" });
    const exp = h("input", { type: "date", "aria-label": "Tanggal kedaluwarsa" });
    const cat = h("select", { "aria-label": "Kategori" }, STOCK_CATS.map((c) => h("option", { value: c }, c)));
    const info = h("div", { class: "note" });
    const refresh = () => {
      const p = planStockIn({ name: name.value, qty: num(qty.value) || 0, unit: unit.value }, state.data.stock_items);
      if (p.mode === "add") { info.textContent = `➕ Ditambahkan ke stok yang ada (${stockInfo(p.stock)} → ${qtyText((Number(p.stock.qty) || 0) + p.add, p.stock.unit)})`; cat.disabled = true; cat.style.opacity = ".5"; }
      else {
        const same = candidates(name.value, state.data.stock_items)[0];
        info.textContent = same ? `🆕 Dibuat sebagai item baru (satuan berbeda dengan stok “${stockInfo(same)}”)` : "🆕 Item baru di stok"; cat.disabled = false; cat.style.opacity = "";
      }
    };
    [name, qty, unit].forEach((el) => el.addEventListener("input", refresh)); refresh();
    const el = h("div", { class: "box card", style: { gap: ".5rem", padding: ".7rem .8rem" } },
      h("div", { style: { display: "flex", gap: ".6rem", alignItems: "center" } }, inc, h("div", { style: { flex: 1, minWidth: 0 } }, name)),
      h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".5rem" } }, field("Jumlah", qty), field("Satuan", unit)),
      h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".5rem" } }, field("Kedaluwarsa (opsional)", exp), field("Kategori", cat)),
      info);
    return { r, inc, name, qty, unit, exp, cat, el };
  });
  let close;
  const submit = async () => {
    const chosen = cards.filter((c) => c.inc.checked);
    if (!chosen.length) return toast("Pilih minimal satu barang.", "err");
    for (const c of chosen) if (!c.name.value.trim() || !(num(c.qty.value) > 0)) return toast(`Isi nama dan jumlah (lebih dari 0) untuk “${c.r.name}”.`, "err");
    const ok = await run(async () => {
      for (const c of chosen) {
        const entry = { name: c.name.value.trim(), qty: num(c.qty.value), unit: c.unit.value.trim() }, p = planStockIn(entry, state.data.stock_items), ex = c.exp.value || null;
        if (p.mode === "add") {
          const st = p.stock, was = Number(st.qty) || 0;
          const expiry = !ex ? st.expiry_date || null : was <= 0 || !st.expiry_date ? ex : st.expiry_date < ex ? st.expiry_date : ex;
          await updateRow("stock_items", st.id, { qty: round(was + p.add), expiry_date: expiry });
        } else {
          await insertRow("stock_items", { name: entry.name, qty: round(entry.qty), min_qty: defaultMin(entry.qty), unit: entry.unit || null, category: c.cat.value, expiry_date: ex });
        }
      }
      await deleteMany("shopping_items", chosen.map((c) => c.r.id));
    }, `${chosen.length} barang masuk stok 📦`);
    if (ok) close();
  };
  close = modal("📦 Pindahkan ke stok", h("div", { style: { display: "flex", flexDirection: "column", gap: ".7rem" } }, dl,
    h("p", { class: "hint" }, "Periksa jumlah dan satuannya. Barang yang sudah ada di stok akan ditambah jumlahnya, sisanya dibuat sebagai item baru. Setelah masuk, barang dihapus dari daftar belanja."),
    ...cards.map((c) => c.el),
    h("div", { class: "foot" }, h("button", { class: "btn white", type: "button", onclick: () => close() }, "Batal"), h("button", { class: "btn green", type: "button", onclick: submit }, "📦 Masukkan ke stok"))));
}

// ---------------------------------------------------------------
// Menu → masak: kurangi stok otomatis (dengan konfirmasi jumlah)
// ---------------------------------------------------------------
export function openCook({ run, addToShopping }, menu) {
  const stock = state.data.stock_items;
  const plan = planCook(menu.ingredients, stock);
  if (!plan.length) return confirmBox(`“${menu.dish}” belum punya daftar bahan. Tandai saja sebagai sudah dimasak?`, "Ya, sudah dimasak").then((y) => y && run(() => updateRow("menus", menu.id, { cooked: true, cooked_on: today(), cooked_log: [] }), "Dicatat sudah dimasak 🍳"));
  const rows = plan.map((p) => {
    const ing = p.ing;
    const use = h("input", { type: "checkbox", checked: !!p.stock, "aria-label": "Kurangi stok " + ing.name });
    const sel = h("select", { "aria-label": "Stok yang dipakai untuk " + ing.name },
      h("option", { value: "" }, "— tidak mengurangi stok —"), ...p.cands.map((s) => h("option", { value: s.id }, `${s.name} (${qtyText(Number(s.qty) || 0, s.unit)})`)));
    if (p.stock) sel.value = p.stock.id;
    const amt = h("input", { type: "text", inputmode: "decimal", "aria-label": "Jumlah dipakai " + ing.name, style: { maxWidth: "6rem" } });
    const unitL = h("span", { style: { fontWeight: 700 } });
    const note = h("div", { class: "note" });
    const shop = h("input", { type: "checkbox", checked: true, "aria-label": "Tambah ke belanja " + ing.name });
    const shopLabel = h("label", { style: { display: "flex", gap: ".5rem", alignItems: "center", flexDirection: "row", margin: 0, fontWeight: 600 } }, shop, "Tambahkan ke daftar belanja");
    const sync = () => {
      const st = stock.find((s) => s.id === sel.value) || null;
      const need = ing.n != null ? convert(ing.n, ing.unit, st?.unit || "") : null;
      if (st) {
        unitL.textContent = st.unit || "";
        if (document.activeElement !== amt) amt.value = need != null ? String(round(need)) : "";
        const have = Number(st.qty) || 0;
        note.textContent = ing.n == null ? "⚠ Jumlah di resep tidak tertulis. Isi jumlah yang terpakai, atau kosongkan jika tidak mengurangi stok."
          : need == null ? `⚠ Satuan resep (${ing.unit || "tanpa satuan"}) beda dengan stok (${st.unit || "tanpa satuan"}). Isi jumlah yang terpakai.`
          : have < need ? `⚠ Stok kurang: tersisa ${qtyText(have, st.unit)}, butuh ${qtyText(need, st.unit)}.` : "";
        use.checked = true;
      } else { note.textContent = ""; use.checked = false; amt.value = ""; unitL.textContent = ""; }
      amt.disabled = !st; use.disabled = !st; shopLabel.style.display = st ? "none" : "flex";
    };
    sel.addEventListener("change", sync); sync();
    const el = h("div", { class: "box card", style: { gap: ".45rem", padding: ".65rem .8rem" } },
      h("div", { style: { display: "flex", gap: ".6rem", alignItems: "center" } }, use, h("b", { style: { flex: 1 } }, ing.raw)),
      p.cands.length ? h("div", { style: { display: "flex", gap: ".5rem", alignItems: "center", flexWrap: "wrap" } }, sel, h("span", null, "pakai"), amt, unitL)
        : h("div", { class: "note" }, "Tidak ada di stok."),
      note, p.cands.length ? null : shopLabel);
    return { p, ing, use, sel, amt, shop, el };
  });
  const auto = h("input", { type: "checkbox", checked: true, "aria-label": "Masukkan yang menipis ke belanja" });
  let close;
  const submit = async () => {
    const log = [], low = [];
    const bad = rows.find((r) => r.sel.value && r.use.checked && r.amt.value.trim() && !(num(r.amt.value) >= 0));
    if (bad) return toast(`Jumlah untuk “${bad.ing.name}” tidak valid.`, "err");
    const ok = await run(async () => {
      for (const r of rows) {
        const st = stock.find((s) => s.id === r.sel.value); if (!st || !r.use.checked) continue;
        const amount = num(r.amt.value); if (!(amount > 0)) continue;
        const have = Number(st.qty) || 0, next = Math.max(0, round(have - amount));
        await updateRow("stock_items", st.id, { qty: next });
        log.push({ id: st.id, name: st.name, amount: round(have - next) });
        if (next <= (Number(st.min_qty) || 0)) low.push({ name: st.name });
      }
      await updateRow("menus", menu.id, { cooked: true, cooked_on: today(), cooked_log: log });
    }, log.length ? `Stok dikurangi untuk ${log.length} bahan 🍳` : "Dicatat sudah dimasak 🍳");
    if (!ok) return;
    close();
    const toBuy = [...(auto.checked ? low : []), ...rows.filter((r) => !r.p.cands.length && r.shop.checked).map((r) => ({ name: r.ing.name, qty: qtyText(r.ing.n, r.ing.unit) || null }))];
    if (toBuy.length) await addToShopping(toBuy);
  };
  close = modal(`🍳 Masak: ${menu.dish}`, h("div", { style: { display: "flex", flexDirection: "column", gap: ".7rem" } },
    h("p", { class: "hint" }, "Stok akan dikurangi sesuai bahan yang dipakai. Periksa jumlahnya, ubah jika perlu, lalu konfirmasi."),
    ...rows.map((r) => r.el),
    h("label", { style: { display: "flex", gap: ".5rem", alignItems: "center", flexDirection: "row", fontWeight: 600 } }, auto, "Masukkan bahan yang jadi menipis/habis ke daftar belanja"),
    h("div", { class: "foot" }, h("button", { class: "btn white", type: "button", onclick: () => close() }, "Batal"), h("button", { class: "btn green", type: "button", onclick: submit }, "✓ Sudah dimasak"))));
}

export async function undoCook({ run }, menu) {
  const log = Array.isArray(menu.cooked_log) ? menu.cooked_log : [];
  if (!(await confirmBox(`Batalkan “${menu.dish}” sudah dimasak?${log.length ? " Stok bahan dikembalikan." : ""}`, "Ya, batalkan"))) return;
  await run(async () => {
    for (const l of log) { const st = state.data.stock_items.find((s) => s.id === l.id); if (st) await updateRow("stock_items", st.id, { qty: round((Number(st.qty) || 0) + Number(l.amount || 0)) }); }
    await updateRow("menus", menu.id, { cooked: false, cooked_on: null, cooked_log: null });
  }, "Dibatalkan. Stok dikembalikan.");
}
