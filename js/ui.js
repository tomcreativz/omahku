// Helper UI kecil tanpa framework. Semua teks dari pengguna dimasukkan via textContent (aman dari XSS).

const PROP_KEYS = new Set(["value", "checked", "disabled", "selected", "hidden"]);

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (PROP_KEYS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);

// ---------- Tanggal ----------
const pad = (n) => String(n).padStart(2, "0");
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => iso(new Date());
export const addDays = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return iso(d); };
export const addMonths = (s, n) => { const d = new Date(s + "T00:00:00"); d.setMonth(d.getMonth() + n); return iso(d); };
export const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 864e5);
export const fmtDate = (s) => !s ? "" : new Date(s + "T00:00:00").toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
export const fmtShort = (s) => !s ? "" : new Date(s + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short" });
export const hhmm = (t) => (t || "").slice(0, 5);
export function relDay(s) {
  const n = daysBetween(today(), s);
  if (n === 0) return "Hari ini";
  if (n === 1) return "Besok";
  if (n === -1) return "Kemarin";
  if (n > 1) return `${n} hari lagi`;
  return `${-n} hari lalu`;
}

// ---------- Toast ----------
let toastBox;
export function toast(msg, kind = "") {
  if (!toastBox) { toastBox = h("div", { class: "toasts", role: "status", "aria-live": "polite" }); document.body.append(toastBox); }
  const t = h("div", { class: "toast " + kind }, msg);
  toastBox.append(t);
  setTimeout(() => t.remove(), kind === "err" ? 5000 : 2600);
}

// ---------- Modal / bottom sheet ----------
export function modal(title, content, { onClose } = {}) {
  const prevFocus = document.activeElement;
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    document.body.style.overflow = "";
    onClose?.();
    prevFocus?.focus?.();
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const overlay = h("div", { class: "overlay", onmousedown: (e) => { if (e.target === overlay) close(); } },
    h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title },
      h("header", null, h("h2", null, title), h("button", { class: "btn sm white icon-btn", type: "button", "aria-label": "Tutup", onclick: close }, "✕")),
      h("div", { class: "content" }, content)));
  document.body.append(overlay);
  document.body.style.overflow = "hidden";
  document.addEventListener("keydown", onKey);
  setTimeout(() => overlay.querySelector("input:not([type=checkbox]),select,textarea,.btn.primary")?.focus(), 30);
  return close;
}

export function confirmBox(message, okLabel = "Ya, hapus") {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => { if (!answered) { answered = true; resolve(v); } close(); };
    const close = modal("Konfirmasi", h("div", null,
      h("p", { style: { marginBottom: "1rem", fontWeight: 700 } }, message),
      h("div", { class: "foot" },
        h("button", { class: "btn white", type: "button", onclick: () => done(false) }, "Batal"),
        h("button", { class: "btn red", type: "button", onclick: () => done(true) }, okLabel))),
      { onClose: () => { if (!answered) { answered = true; resolve(false); } } });
  });
}

export const chip = (text, color = "") => h("span", { class: "chip " + color }, text);

export function emptyState(icon, title, text, action) {
  return h("div", { class: "box empty" }, h("div", { class: "big" }, icon), h("h3", null, title),
    text ? h("p", null, text) : null, action || null);
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => toast("Tersalin ✓", "ok"), () => toast("Gagal menyalin", "err"));
  const ta = h("textarea", { style: { position: "fixed", opacity: 0 } }); ta.value = text; document.body.append(ta); ta.select();
  try { document.execCommand("copy"); toast("Tersalin ✓", "ok"); } catch { toast("Gagal menyalin", "err"); }
  ta.remove();
}

// Nomor telepon -> format untuk wa.me (Indonesia)
export function waNumber(p) {
  let d = (p || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("0")) d = "62" + d.slice(1);
  return d;
}
