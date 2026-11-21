import { CONFIG } from "./config.js";
import { h, $, toast } from "./ui.js";
import { configured, state, onChange, loadHousehold, loadAll, subscribe, unsubscribe, meMember, fetchUser, signIn, signUp, signOut, sendRecovery, completeRecovery, setPassword, acceptInvite, createHousehold, syncMyProfile, loadMembers, loadOutbox, restoreOffline, clearOffline, flushOutbox, pendingCount } from "./data.js";
import { isNetworkError } from "./offline.js";
import { forgetAI } from "./ai.js";
import { MODULES, modByKey, renderModule } from "./modules.js";
import { renderDashboard, renderSettings, renderMore } from "./pages.js";
import { themeButton } from "./theme.js";
import { openSearch } from "./search.js";
import { keyForRoute, isLocked, renderLockScreen, hasPin, touch, lockSignature, clearPin } from "./lock.js";

const app = $("#app");
document.title = `${CONFIG.APP_NAME} — urusan rumah, tertata`;

// ---------- PWA ----------
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); window.__installPrompt = e; document.dispatchEvent(new CustomEvent("rt:rerender")); });
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
const offlineBar = h("div", { class: "offline", hidden: true, role: "status" });
function updateBar() {
  const n = pendingCount();
  if (!navigator.onLine) { offlineBar.textContent = "Mode offline — menampilkan data tersimpan di perangkat" + (n ? ` · ${n} perubahan menunggu dikirim` : "."); offlineBar.hidden = false; }
  else if (n) { offlineBar.textContent = `Mengirim ${n} perubahan…`; offlineBar.hidden = false; }
  else offlineBar.hidden = true;
}
document.body.append(offlineBar);
updateBar();
onChange((what) => { if (what === "outbox") updateBar(); });

// Koneksi kembali: kirim perubahan yang tertunda, ambil data terbaru, sambungkan realtime lagi.
addEventListener("online", async () => {
  updateBar();
  if (!state.household) return;
  try { await flushOutbox(); await loadAll(); await loadMembers(); subscribe(); syncMyProfile().catch(() => {}); }
  catch (e) {
    if (e?.code === 401) { toast(friendly(e), "err"); unsubscribe(); state.user = null; state.household = null; state.loaded = false; enter(); }
  }
  updateBar();
});
addEventListener("offline", updateBar);
document.addEventListener("rt:sync", (e) => {
  const { sent = 0, failed = 0 } = e.detail || {};
  if (failed) { toast(`${failed} perubahan offline tidak bisa disimpan (mungkin sudah dihapus atau diubah pasangan).`, "err"); loadAll().catch(() => {}); }
  else if (sent) toast(`${sent} perubahan offline sudah tersimpan ✓`, "ok");
  updateBar();
});

const mount = (...nodes) => { app.replaceChildren(...nodes); window.scrollTo(0, 0); };
const logo = () => h("div", { class: "brand" }, h("span", { class: "logo" }, "🏠"), h("span", null, CONFIG.APP_NAME));
const splash = () => mount(h("div", { class: "splash" }, h("div", { class: "spinner", role: "status", "aria-label": "Memuat" })));

const friendly = (e) => {
  const m = typeof e === "string" ? e : e?.message || "", t = e?.type || "";
  if (t === "user_invalid_credentials" || /invalid credentials/i.test(m)) return "Email atau password salah.";
  if (t === "user_already_exists" || /already exists|already registered/i.test(m)) return "Email sudah terdaftar. Silakan masuk.";
  if (t === "user_blocked") return "Akun ini diblokir.";
  if (t === "general_rate_limit_exceeded" || /rate limit|too many/i.test(m)) return "Terlalu banyak percobaan. Coba lagi beberapa menit lagi.";
  if (t === "password_recently_used" || t === "password_personal_data") return "Password tidak diterima. Gunakan password lain yang lebih unik.";
  if (/password.*(between 8|at least 8|8 and)/i.test(m)) return "Password minimal 8 karakter.";
  if (t === "user_password_mismatch") return "Password saat ini salah.";
  if (t === "team_invalid_secret" || t === "team_invite_mismatch") return "Tautan undangan tidak valid atau sudah kedaluwarsa. Minta pasangan mengirim ulang.";
  if (t === "general_unauthorized_scope" || e?.code === 401) return "Sesi berakhir atau tidak punya izin. Silakan masuk lagi.";
  if (/failed to fetch|network|load failed/i.test(m)) return "Tidak bisa terhubung ke server. Periksa koneksi internet, atau pastikan alamat situs ini sudah didaftarkan sebagai Platform Web di Appwrite.";
  return m || "Terjadi kesalahan.";
};

// ============================================================
// Layar: belum dikonfigurasi
// ============================================================
function showSetup() {
  mount(h("div", { class: "auth" }, h("div", { class: "box card", style: { maxWidth: "620px" } },
    logo(), h("h2", null, "Hampir siap! Hubungkan Appwrite"),
    h("ol", { style: { paddingLeft: "1.2rem", display: "flex", flexDirection: "column", gap: ".4rem" } },
      h("li", null, "Buat proyek di cloud.appwrite.io."),
      h("li", null, "Buat database + tabel sesuai ", h("code", null, "TUTORIAL.md"), "."),
      h("li", null, "Isi Endpoint dan Project ID di ", h("code", null, "js/config.js"), "."),
      h("li", null, "Muat ulang halaman ini.")),
    h("p", { class: "note" }, "Panduan lengkap ada di TUTORIAL.md."))));
}

// ============================================================
// Layar: login / daftar
// ============================================================
function showAuth(initialMode = "in") {
  let mode = initialMode;
  const msg = h("div", { class: "msg", hidden: true });
  const nick = h("input", { id: "nm", type: "text", maxlength: 40, autocomplete: "given-name", placeholder: "mis. Budi" });
  const fNick = h("div", { class: "field" }, h("label", { for: "nm" }, "Nama panggilan"), nick);
  const email = h("input", { id: "em", type: "email", required: true, autocomplete: "email", placeholder: "nama@email.com" });
  const pass = h("input", { id: "pw", type: "password", required: true, minlength: 8, autocomplete: "current-password", placeholder: "Minimal 8 karakter" });
  const submit = h("button", { class: "btn pink block", type: "submit" });
  const forgot = h("button", { class: "linkbtn", type: "button" }, "Lupa password?");
  const tIn = h("button", { type: "button" }, "Masuk"), tUp = h("button", { type: "button" }, "Daftar");

  const say = (t, err) => { msg.textContent = t; msg.hidden = !t; msg.className = "msg" + (err ? " err" : ""); };
  const sync = () => {
    tIn.className = mode === "in" ? "on" : ""; tUp.className = mode === "up" ? "on" : "";
    submit.textContent = mode === "in" ? "Masuk →" : "Buat akun →";
    pass.autocomplete = mode === "in" ? "current-password" : "new-password";
    fNick.hidden = mode !== "up"; forgot.hidden = mode !== "in"; say("");
  };
  tIn.onclick = () => { mode = "in"; sync(); }; tUp.onclick = () => { mode = "up"; sync(); };

  forgot.onclick = async () => {
    if (!email.value.trim()) return say("Isi email dulu, lalu klik “Lupa password?”.", true);
    try { await sendRecovery(email.value.trim()); say("Tautan reset password dikirim ke email Anda (cek juga folder spam)."); }
    catch (err) { say(friendly(err), true); }
  };

  const form = h("form", { class: "box form", onsubmit: async (e) => {
    e.preventDefault(); submit.disabled = true; say("");
    try {
      if (mode === "in") await signIn(email.value.trim(), pass.value);
      else await signUp(email.value.trim(), pass.value, nick.value.trim());
      state.user = await fetchUser(); await enter();
    } catch (err) {
      if (err?.type === "user_session_already_exists") { state.user = await fetchUser(); await enter(); }
      else say(friendly(err), true);
    }
    submit.disabled = false;
  } },
    h("div", { class: "tabs2", role: "tablist" }, tIn, tUp), msg, fNick,
    h("div", { class: "field" }, h("label", { for: "em" }, "Email"), email),
    h("div", { class: "field" }, h("label", { for: "pw" }, "Password"), pass),
    submit, h("div", { style: { marginTop: ".6rem", textAlign: "center" } }, forgot));
  sync();

  const pills = [["📅 Agenda", "blue"], ["✅ Tugas", "green"], ["🛒 Belanja", "orange"], ["🎯 Target", "yellow"], ["🚨 Darurat", "red"], ["🩺 Kesehatan", "pink"]];
  mount(h("div", { class: "auth" }, h("div", { class: "wrap" },
    h("div", { class: "pitch" }, logo(),
      h("h1", null, "Urusan rumah, ", h("mark", null, "tertata"), " berdua."),
      h("p", null, "Agenda, tugas, belanja, kontak darurat, sampai riwayat kesehatan — satu aplikasi untuk suami dan istri."),
      h("div", { class: "pills" }, pills.map(([t, c]) => h("span", { class: "chip " + c }, t)))),
    form)));
}

// Dipakai untuk (a) reset password lewat email, (b) membuat password pertama setelah menerima undangan
function showPasswordForm({ title, text, button, onSubmit }) {
  const pw = h("input", { type: "password", minlength: 8, required: true, autocomplete: "new-password", placeholder: "Password baru (min. 8 karakter)" });
  const msg = h("div", { class: "msg err", hidden: true });
  mount(h("div", { class: "auth" }, h("form", { class: "box form", style: { width: "min(460px,100%)" }, onsubmit: async (e) => {
    e.preventDefault();
    try { await onSubmit(pw.value); } catch (err) { msg.textContent = friendly(err); msg.hidden = false; }
  } }, logo(), h("h2", { style: { margin: ".8rem 0 .3rem" } }, title), text ? h("p", { style: { marginBottom: "1rem" } }, text) : null,
    msg, h("div", { class: "field" }, pw), h("button", { class: "btn pink block", type: "submit" }, button))));
}

// ============================================================
// Layar: buat rumah (belum punya rumah tangga)
// ============================================================
function showOnboarding() {
  const msg = h("div", { class: "msg err", hidden: true });
  const hhName = h("input", { id: "hn", type: "text", placeholder: "mis. Rumah Budi & Sari", maxlength: 60, required: true });
  const nick = h("input", { id: "nk", type: "text", placeholder: "mis. Budi", maxlength: 40, required: true, value: state.user?.name || "" });
  const submit = h("button", { class: "btn pink block", type: "submit" }, "Buat & mulai →");
  const form = h("form", { class: "box form", style: { width: "min(480px,100%)" }, onsubmit: async (e) => {
    e.preventDefault(); submit.disabled = true; msg.hidden = true;
    try { await createHousehold(hhName.value.trim(), nick.value.trim()); await enter(); }
    catch (err) { msg.textContent = friendly(err); msg.hidden = false; submit.disabled = false; }
  } },
    logo(), h("h2", { style: { margin: ".8rem 0 .2rem" } }, "Selamat datang! 👋"),
    h("p", { style: { marginBottom: "1rem" } }, "Buat rumah tangga Anda. Setelah itu, undang pasangan lewat email di menu Pengaturan."),
    msg, h("div", { class: "field" }, h("label", { for: "hn" }, "Nama rumah tangga"), hhName),
    h("div", { class: "field" }, h("label", { for: "nk" }, "Nama panggilanmu"), nick),
    submit,
    h("div", { class: "msg", style: { marginTop: "1rem", marginBottom: 0 } }, "Sudah diundang pasangan? Buka tautan di email undangannya, bukan membuat rumah baru di sini."),
    h("div", { style: { marginTop: ".6rem", textAlign: "center" } }, h("button", { class: "linkbtn", type: "button", onclick: logout }, "Keluar")));
  mount(h("div", { class: "auth" }, form));
}

function showFatal(e) {
  console.error(e);
  mount(h("div", { class: "auth" }, h("div", { class: "box card", style: { maxWidth: "560px" } }, h("h2", null, "Gagal memuat data 😵"),
    h("div", { class: "msg err" }, friendly(e)),
    h("p", { class: "note" }, "Periksa TUTORIAL.md: tabel “records” dengan kolom kind & data, izin tabel (Users → Create), Row security aktif, serta Platform Web untuk alamat situs ini."),
    h("div", { class: "sos" }, h("button", { class: "btn yellow", type: "button", onclick: () => enter() }, "Coba lagi"), h("button", { class: "btn white", type: "button", onclick: logout }, "Keluar")))));
}

// ============================================================
// Aplikasi utama
// ============================================================
const NAV = [
  { to: "", icon: "🏠", label: "Beranda", color: "yellow" },
  ...MODULES.filter((m) => !m.hidden).map((m) => ({ to: m.key, icon: m.icon, label: m.nav, color: m.color })),
  { to: "pengaturan", icon: "⚙️", label: "Pengaturan" },
];
const TABS = ["", "agenda", "tasks", "shopping"];
let main, side, tabbar, topbarName, unsub;

function showApp() {
  const GROUP = { agenda: "Harian", stock: "Rumah", goals: "Keluarga", pengaturan: "Akun" };
  const navLinks = NAV.flatMap((n) => [
    GROUP[n.to] ? h("div", { class: "nav-label" }, GROUP[n.to]) : null,
    h("a", { href: "#/" + n.to, "data-to": n.to, style: `--c:var(--${n.color || "yellow"})` }, h("span", { class: "ico" }, n.icon), n.label)]);
  side = h("aside", { class: "side", "aria-label": "Menu utama" }, logo(),
    h("button", { class: "search-btn", type: "button", onclick: openSearch }, "🔍", h("span", null, "Cari…"), h("kbd", null, "Ctrl K")),
    h("nav", { class: "nav" }, navLinks),
    h("div", { class: "who" }, h("div", { class: "grow" }, h("small", null, "Masuk sebagai"), h("b", { id: "who-name" }, ""), h("small", { id: "who-house" }, "")), themeButton()));
  const top = h("header", { class: "topbar" }, logo(), h("div", { class: "sos", style: { gap: ".4rem", flexWrap: "nowrap" } },
    h("button", { class: "btn sm white icon-btn", type: "button", "aria-label": "Cari", onclick: openSearch }, "🔍"), themeButton(),
    h("a", { class: "btn sm white", href: "#/pengaturan", "aria-label": "Pengaturan" }, h("span", { id: "top-name" }, ""), " ⚙️")));
  tabbar = h("nav", { class: "tabbar", "aria-label": "Menu utama" },
    ...TABS.map((to) => { const n = NAV.find((x) => x.to === to); return h("a", { href: "#/" + to, "data-to": to }, h("span", { class: "ico" }, n.icon), n.label); }),
    h("a", { href: "#/lainnya", "data-to": "lainnya" }, h("span", { class: "ico" }, "☰"), "Lainnya"));
  main = h("main", { class: "main", id: "main", tabindex: "-1" });
  mount(h("div", { class: "shell" }, side, h("div", null, top, main)), tabbar);
  setNames();
  unsub?.(); unsub = onChange(() => schedule());
  render(true);
}

function setNames() {
  const me = meMember();
  const a = $("#who-name"), b = $("#who-house"), c = $("#top-name");
  if (a) a.textContent = me?.display_name || ""; if (b) b.textContent = state.household?.name || ""; if (c) c.textContent = me?.display_name || "";
}

const currentRoute = () => {
  const r = location.hash.replace(/^#\/?/, "").split("?")[0];
  return r;
};

let raf = 0;
function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => render(false)); }
document.addEventListener("rt:rerender", schedule);
addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
  if (!state.household || document.querySelector(".overlay")) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSearch(); }
  else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey) { e.preventDefault(); openSearch(); }
});
addEventListener("hashchange", () => state.household && render(true));

function render(navigated) {
  if (!main || !main.isConnected || !state.household) return;
  const a = document.activeElement;
  if (!navigated && a && main.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== "checkbox" && a.value) {
    a.addEventListener("blur", schedule, { once: true }); return; // jangan hapus ketikan yang sedang berlangsung
  }
  const y = window.scrollY;
  const route = currentRoute();
  main.replaceChildren();
  const lk = keyForRoute(route);
  try {
    if (lk && isLocked(lk)) renderLockScreen(main, lk, { logout, onUnlock: () => { toast("Terbuka 🔓"); lockSig = lockSignature(); render(true); } });
    else if (route === "") renderDashboard(main);
    else if (route === "lainnya") renderMore(main);
    else if (route === "pengaturan") renderSettings(main, { logout, onRenamed: () => { setNames(); schedule(); } });
    else if (modByKey[route]) renderModule(modByKey[route], main);
    else { location.hash = "#/"; return; }
    if (lk && !hasPin() && !localStorage.getItem("omahku_pin_hint_off")) main.prepend(pinHint());
  } catch (e) {
    console.error(e);
    main.replaceChildren(h("div", { class: "box card" }, h("h2", null, "Ups, ada yang salah"), h("div", { class: "msg err" }, String(e?.message || e))));
  }
  document.querySelectorAll("[data-to]").forEach((el) => {
    const on = el.dataset.to === route || (route === "documents" && el.dataset.to === "assets") || (route === "lainnya" && el.dataset.to === "lainnya");
    el.classList.toggle("on", on); on ? el.setAttribute("aria-current", "page") : el.removeAttribute("aria-current");
  });
  if (navigated) { window.scrollTo(0, 0); } else window.scrollTo(0, y);
}

// ============================================================
// Alur masuk / keluar
// ============================================================
let entering = null;
export function enter() {
  if (entering) return entering;
  entering = (async () => {
    try {
      if (!state.user) state.user = await fetchUser();
      if (!state.user) { unsubscribe(); state.household = null; state.loaded = false; return showAuth(); }
      splash();
      await loadOutbox();
      if (!(await loadHousehold())) return showOnboarding();
      await loadAll(); subscribe(); showApp(); syncMyProfile().catch((e) => console.warn("Profil anggota belum tersimpan", e));
    } catch (e) {
      // Tidak ada internet: buka salinan data terakhir yang tersimpan di perangkat
      if (isNetworkError(e) && (await restoreOffline())) { showApp(); toast("Mode offline: menampilkan data tersimpan di perangkat.", "ok"); updateBar(); return; }
      showFatal(e);
    }
    finally { entering = null; }
  })();
  return entering;
}

// Pengingat kecil untuk mengaktifkan PIN di menu penting.
function pinHint() {
  const box = h("div", { class: "box card", style: { flexDirection: "row", alignItems: "center", gap: ".6rem", flexWrap: "wrap", padding: ".6rem .9rem", marginBottom: "1rem", background: "var(--tint-yellow, var(--soft))" } },
    h("span", { style: { flex: 1, minWidth: "12rem" } }, "🔓 Menu ini belum dilindungi PIN. Aktifkan agar data penting tidak terbuka saat HP dipinjam."),
    h("a", { class: "btn sm yellow", href: "#/pengaturan" }, "Aktifkan PIN"),
    h("button", { class: "btn sm white", type: "button", onclick: () => { try { localStorage.setItem("omahku_pin_hint_off", "1"); } catch { /* abaikan */ } box.remove(); } }, "Nanti saja"));
  return box;
}

// Perpanjang waktu buka selama dipakai; kunci kembali otomatis saat tidak aktif.
["pointerdown", "keydown", "scroll"].forEach((ev) => addEventListener(ev, () => { if (state.household) touch(); }, { passive: true, capture: true }));
let lockSig = "";
setInterval(() => {
  if (!state.household || !main?.isConnected) return;
  const sig = lockSignature();
  if (lockSig && sig !== lockSig) { document.querySelectorAll(".overlay").forEach((o) => o.remove()); document.body.style.overflow = ""; render(true); }
  lockSig = sig;
}, 5000);

async function logout() {
  if (pendingCount() && navigator.onLine) await flushOutbox().catch(() => {});
  if (pendingCount() && !confirm(`Ada ${pendingCount()} perubahan offline yang belum terkirim. Jika keluar sekarang, perubahan itu hilang. Tetap keluar?`)) return;
  const uid = state.user?.id;
  clearPin(uid);
  unsubscribe(); await signOut();
  forgetAI(uid); // sisa key pribadi dari versi lama (bila ada) ikut dibersihkan dari perangkat
  state.user = null; state.household = null; state.loaded = false; state.members = []; state.pending = [];
  await clearOffline(); updateBar();
  toast("Sampai jumpa! 👋"); enter();
}

// ============================================================
// Tautan dari email (undangan pasangan / reset password)
// ============================================================
const cleanUrl = () => history.replaceState(null, "", location.pathname);

async function handleInvite(p) {
  splash();
  try {
    const cur = await fetchUser();
    if (cur && cur.id !== p.userId) await signOut();            // browser masih login sebagai akun lain
    try { await acceptInvite(p); }
    catch (e) { if (e?.type !== "membership_already_confirmed") throw e; }
    cleanUrl();
    state.user = await fetchUser();
    if (state.user && !state.user.hasPassword) {
      return showPasswordForm({
        title: "Selamat datang di rumah baru! 🏠", text: "Buat password agar Anda bisa masuk lagi nanti.", button: "Simpan & masuk",
        onSubmit: async (pw) => { await setPassword(pw); toast("Password tersimpan ✓", "ok"); await enter(); },
      });
    }
    await enter();
  } catch (e) { cleanUrl(); state.user = null; showAuth(); toast(friendly(e), "err"); }
}

function handleRecovery(p) {
  showPasswordForm({
    title: "Buat password baru", button: "Simpan password",
    onSubmit: async (pw) => { await completeRecovery(p.userId, p.secret, pw); cleanUrl(); toast("Password diperbarui. Silakan masuk.", "ok"); state.user = null; showAuth(); },
  });
}

// ============================================================
async function boot() {
  if (!configured) return showSetup();
  const q = new URLSearchParams(location.search);
  const p = Object.fromEntries(["teamId", "membershipId", "userId", "secret"].map((k) => [k, q.get(k)]));
  if (p.teamId && p.membershipId && p.userId && p.secret) return handleInvite(p);
  if (p.userId && p.secret) return handleRecovery(p);
  splash();
  enter();
}
boot();
