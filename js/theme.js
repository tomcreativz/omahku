// Mode gelap: "auto" (ikut perangkat), "light", atau "dark". Pilihan disimpan di perangkat ini.
import { h } from "./ui.js";

const KEY = "omahku_theme";
const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export const getPref = () => { try { return localStorage.getItem(KEY) || "auto"; } catch { return "auto"; } };
export const effective = () => { const p = getPref(); return p === "auto" ? (mq?.matches ? "dark" : "light") : p; };

export function apply() {
  const t = effective();
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#15131d" : "#FFD93D");
  document.querySelectorAll(".theme-btn").forEach((b) => { b.textContent = t === "dark" ? "☀️" : "🌙"; b.setAttribute("aria-label", t === "dark" ? "Pakai mode terang" : "Pakai mode gelap"); });
}

export function setPref(p) {
  try { if (p === "auto") localStorage.removeItem(KEY); else localStorage.setItem(KEY, p); } catch { /* mode privat */ }
  apply();
  document.dispatchEvent(new CustomEvent("rt:rerender"));
}

if (mq?.addEventListener) mq.addEventListener("change", () => { if (getPref() === "auto") apply(); });
apply();

// Tombol kecil untuk ganti terang/gelap.
export function themeButton(cls = "btn sm white icon-btn") {
  const b = h("button", { class: cls + " theme-btn", type: "button", onclick: () => setPref(effective() === "dark" ? "light" : "dark") });
  b.textContent = effective() === "dark" ? "☀️" : "🌙";
  b.setAttribute("aria-label", effective() === "dark" ? "Pakai mode terang" : "Pakai mode gelap");
  return b;
}
