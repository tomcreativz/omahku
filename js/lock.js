// Kunci PIN untuk menu penting (Kesehatan, Aset & Dokumen). PIN hanya tersimpan di perangkat ini (hash PBKDF2), tidak dikirim ke server.
// Ini pengaman dari orang yang meminjam HP/komputer yang sedang masuk. Bukan pengganti password akun.
import { h, modal, confirmBox, toast } from "./ui.js";
import { state } from "./data.js";

export const LOCKABLE = {
  health: { label: "Riwayat Kesehatan", icon: "🩺", routes: ["health"], tables: ["health_profiles", "health_metrics", "health_records"] },
  assets: { label: "Aset & Dokumen", icon: "🏍️", routes: ["assets", "documents"], tables: ["assets", "documents"] },
};
const ITER = 120000;
const TIMEOUTS = [[1, "1 menit"], [5, "5 menit"], [15, "15 menit"], [60, "1 jam"]];
let lastActive = 0;

const keyName = () => "omahku_pin_" + (state.user?.id || "");
const read = () => { try { return JSON.parse(localStorage.getItem(keyName()) || "null"); } catch { return null; } };
const write = (c) => { try { localStorage.setItem(keyName(), JSON.stringify(c)); } catch { /* penyimpanan penuh/diblokir */ } };
export const hasPin = () => !!read()?.hash;
export const getCfg = () => { const c = read(); return c ? { protect: { health: true, assets: true, ...(c.protect || {}) }, timeout: c.timeout || 5 } : { protect: { health: true, assets: true }, timeout: 5 }; };

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function derive(pin, salt, iter = ITER) {
  if (!globalThis.crypto?.subtle) throw new Error("Browser ini tidak mendukung penyimpanan PIN yang aman. Gunakan Chrome atau Safari terbaru.");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  return b64(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256));
}
export const validPin = (p) => /^\d{4,6}$/.test(String(p));

export async function setPin(pin, oldPin) {
  if (!validPin(pin)) throw new Error("PIN harus 4 sampai 6 angka.");
  const cur = read();
  if (cur?.hash && !(await verifyPin(oldPin)).ok) throw new Error("PIN lama salah.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  write({ ...(cur || {}), v: 1, salt: b64(salt), iter: ITER, hash: await derive(pin, salt), fails: 0, until: 0 });
  lastActive = Date.now();
}
export async function verifyPin(pin) {
  const c = read(); if (!c?.hash) return { ok: true };
  const now = Date.now();
  if (c.until && c.until > now) return { ok: false, wait: Math.ceil((c.until - now) / 1000) };
  const ok = validPin(pin) && (await derive(pin, unb64(c.salt), c.iter)) === c.hash;
  if (ok) { write({ ...c, fails: 0, until: 0 }); lastActive = Date.now(); return { ok: true }; }
  const fails = (c.fails || 0) + 1, wait = fails >= 5 ? Math.min(600, 30 * 2 ** (fails - 5)) : 0;
  write({ ...c, fails, until: wait ? now + wait * 1000 : 0 });
  return { ok: false, wait, left: Math.max(0, 5 - fails) };
}
export async function removePin(pin) { if (!(await verifyPin(pin)).ok) throw new Error("PIN salah."); localStorage.removeItem(keyName()); }
export function clearPin(userId) { try { localStorage.removeItem("omahku_pin_" + (userId || state.user?.id || "")); } catch { /* abaikan */ } lastActive = 0; }
export function saveCfg(patch) { const c = read(); if (!c) return; write({ ...c, protect: { ...c.protect, ...(patch.protect || {}) }, timeout: patch.timeout ?? c.timeout }); }

export const keyForRoute = (route) => Object.keys(LOCKABLE).find((k) => LOCKABLE[k].routes.includes(route)) || null;
export const keyForTable = (table) => Object.keys(LOCKABLE).find((k) => LOCKABLE[k].tables.includes(table)) || null;
export function isLocked(key) {
  const c = read();
  if (!c?.hash || !key) return false;
  if (!(c.protect?.[key] ?? true)) return false;
  return Date.now() - lastActive >= (c.timeout || 5) * 60000;
}
export const tableLocked = (table) => isLocked(keyForTable(table));
export const lockNow = () => { lastActive = 0; };
export const touch = () => { if (lastActive && Date.now() - lastActive < (getCfg().timeout || 5) * 60000) lastActive = Date.now(); };
export const lockSignature = () => Object.keys(LOCKABLE).map((k) => (isLocked(k) ? 1 : 0)).join("");

// ---------- layar kunci ----------
export function renderLockScreen(root, key, { logout, onUnlock }) {
  const info = LOCKABLE[key];
  const pin = h("input", { type: "password", inputmode: "numeric", pattern: "[0-9]*", maxlength: 6, autocomplete: "off", "aria-label": "PIN", placeholder: "• • • •", style: { textAlign: "center", fontSize: "1.6rem", letterSpacing: ".4em", maxWidth: "12rem" } });
  const msg = h("div", { class: "msg err", hidden: true, role: "alert" });
  const btn = h("button", { class: "btn yellow", type: "submit" }, "🔓 Buka");
  let timer = 0;
  const show = (t) => { msg.textContent = t; msg.hidden = !t; };
  const countdown = (sec) => {
    clearInterval(timer); btn.disabled = true; pin.disabled = true; let s = sec;
    const tick = () => { if (s <= 0) { clearInterval(timer); btn.disabled = false; pin.disabled = false; show(""); pin.focus(); return; } show(`Terlalu banyak percobaan. Coba lagi dalam ${s} detik.`); s -= 1; };
    tick(); timer = setInterval(tick, 1000);
  };
  const form = h("form", { novalidate: true, style: { display: "flex", flexDirection: "column", alignItems: "center", gap: ".8rem" },
    onsubmit: async (e) => {
      e.preventDefault(); if (!pin.value) return;
      btn.disabled = true;
      try {
        const r = await verifyPin(pin.value);
        if (r.ok) { clearInterval(timer); onUnlock(); return; }
        pin.value = "";
        if (r.wait) countdown(r.wait); else { show(`PIN salah.${r.left != null ? ` Sisa ${r.left} percobaan sebelum dikunci sementara.` : ""}`); btn.disabled = false; pin.focus(); }
      } catch (err) { show(err.message); btn.disabled = false; }
    } }, pin, msg, btn);
  root.append(h("div", { class: "box card", style: { maxWidth: "26rem", margin: "2rem auto", alignItems: "center", textAlign: "center", gap: ".8rem", padding: "1.4rem" } },
    h("div", { style: { fontSize: "2.6rem", lineHeight: 1 } }, "🔒"),
    h("h2", null, `${info.label} terkunci`),
    h("p", { class: "note" }, "Masukkan PIN untuk membuka menu ini."),
    form,
    h("details", { class: "steps", style: { alignSelf: "stretch", textAlign: "left" } }, h("summary", null, "Lupa PIN?"),
      h("div", { class: "note", style: { marginTop: ".5rem" } }, "PIN hanya tersimpan di perangkat ini dan terhapus saat Anda keluar dari akun. Keluar, masuk lagi dengan password akun, lalu buat PIN baru di Pengaturan."),
      h("button", { class: "btn sm red", type: "button", style: { marginTop: ".6rem" }, onclick: async () => { if (await confirmBox("Keluar dari akun? PIN di perangkat ini akan dihapus dan bisa dibuat ulang setelah masuk lagi.", "Ya, keluar")) logout(); } }, "Keluar & atur ulang PIN")),
    h("a", { href: "#/", class: "btn sm white" }, "← Kembali ke Beranda")));
  setTimeout(() => pin.focus(), 50);
  const c = read(); if (c?.until > Date.now()) countdown(Math.ceil((c.until - Date.now()) / 1000));
}

// ---------- bagian di Pengaturan ----------
const pinInput = (label) => h("input", { type: "password", inputmode: "numeric", pattern: "[0-9]*", maxlength: 6, autocomplete: "off", "aria-label": label, placeholder: label });
const again = () => document.dispatchEvent(new CustomEvent("rt:rerender"));

export function lockSettings() {
  const set = hasPin(), cfg = getCfg();
  if (!set) {
    const a = pinInput("PIN baru (4–6 angka)"), b = pinInput("Ulangi PIN");
    return h("section", { class: "box card" }, h("h3", null, "🔒 Kunci PIN"),
      h("div", { class: "note" }, "Lindungi menu penting dengan PIN: Riwayat Kesehatan serta Aset & Dokumen. Menu lain tetap terbuka. PIN hanya berlaku di perangkat ini."),
      h("div", { class: "field" }, a, b),
      h("button", { class: "btn yellow", type: "button", onclick: async () => {
        if (!validPin(a.value)) return toast("PIN harus 4 sampai 6 angka.", "err");
        if (a.value !== b.value) return toast("Kedua PIN tidak sama.", "err");
        try { await setPin(a.value); toast("PIN aktif 🔒", "ok"); again(); } catch (e) { toast(e.message, "err"); }
      } }, "Aktifkan PIN"));
  }
  const pinForm = (title, withOld, withNew, action) => {
    const o = withOld ? pinInput("PIN saat ini") : null, n = withNew ? pinInput("PIN baru (4–6 angka)") : null, n2 = withNew ? pinInput("Ulangi PIN baru") : null;
    let close;
    close = modal(title, h("form", { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (n && !validPin(n.value)) return toast("PIN harus 4 sampai 6 angka.", "err");
      if (n && n.value !== n2.value) return toast("Kedua PIN tidak sama.", "err");
      try { await action(o?.value, n?.value); close(); again(); } catch (err) { toast(err.message, "err"); }
    } }, h("div", { class: "field" }, o, n, n2), h("div", { class: "foot" }, h("button", { class: "btn yellow", type: "submit" }, "Simpan"))));
    setTimeout(() => (o || n).focus(), 50);
  };
  return h("section", { class: "box card" }, h("h3", null, "🔒 Kunci PIN ", h("span", { class: "chip green" }, "Aktif")),
    h("div", { class: "note" }, "Menu yang dikunci (PIN diminta saat dibuka):"),
    ...Object.entries(LOCKABLE).map(([k, v]) => h("label", { style: { display: "flex", gap: ".6rem", alignItems: "center", flexDirection: "row", fontWeight: 600 } },
      h("input", { type: "checkbox", checked: cfg.protect[k], onchange: (e) => { saveCfg({ protect: { [k]: e.target.checked } }); again(); } }), `${v.icon} ${v.label}`)),
    h("div", { class: "field" }, h("label", null, "Kunci kembali otomatis setelah tidak dipakai"),
      h("select", { "aria-label": "Waktu kunci otomatis", onchange: (e) => saveCfg({ timeout: Number(e.target.value) }) }, TIMEOUTS.map(([m, l]) => h("option", { value: m, selected: m === cfg.timeout }, l)))),
    h("div", { class: "sos" },
      h("button", { class: "btn white", type: "button", onclick: () => { lockNow(); toast("Terkunci 🔒"); again(); } }, "🔒 Kunci sekarang"),
      h("button", { class: "btn white", type: "button", onclick: () => pinForm("Ubah PIN", true, true, (o, n) => setPin(n, o)) }, "Ubah PIN"),
      h("button", { class: "btn red", type: "button", onclick: () => pinForm("Matikan PIN", true, false, (o) => removePin(o)) }, "Matikan PIN")),
    h("div", { class: "note", style: { color: "var(--muted)" } }, "PIN melindungi dari orang yang meminjam HP atau komputer Anda. PIN tersimpan terenkripsi hanya di perangkat ini, jadi atur terpisah di tiap perangkat. Lupa PIN? Keluar lalu masuk lagi, PIN akan terhapus."));
}
