// Halaman Beranda, Pengaturan, dan menu "Lainnya".
import { CONFIG } from "./config.js";
import { h, chip, toast, modal, copyText, today, daysBetween, fmtDate, fmtShort, hhmm, relDay } from "./ui.js";
import { state, meMember, memberName, updateRow, TABLES, isOwner, renameHousehold, renameMe, inviteMember, cancelInvite, setPassword, loadMembers, loadAll, setMemberAlias } from "./data.js";
import { MODULES, modByKey, run, openForm, addToShopping, nextDue, progressOf } from "./modules.js";
import { assetAlerts, serviceAlerts } from "./assets.js";
import { isLocked, lockSettings } from "./lock.js";
import { docAlerts } from "./documents.js";
import { summarize, piecesOf } from "./clothes.js";
import { vaxAlerts } from "./health.js";
import { ageLabel } from "./vaxcalc.js";
import { getPref, setPref } from "./theme.js";

const link = (to, text, cls = "btn sm white") => h("a", { class: cls, href: "#/" + to }, text);
const panel = (title, color, to, ...body) =>
  h("section", { class: "box panel" },
    h("h3", { style: { background: `var(--${color})` } }, h("span", null, title), to ? link(to, "Lihat ›", "btn sm white more") : null),
    h("div", { class: "body" }, ...body));
const lockedNote = () => h("div", { class: "note", style: { fontWeight: 700 } }, "🔒 Terkunci. Buka menunya dan masukkan PIN untuk melihat.");
const none = (t) => h("div", { class: "note", style: { fontWeight: 700, color: "var(--muted)" } }, t);
const li = (main, sub, right) => h("div", { class: "li" }, h("div", { class: "grow" }, main, sub ? h("small", null, sub) : null), right || null);

// ============================================================
export function renderDashboard(root) {
  const D = state.data, t = today(), me = meMember();
  const agendaToday = D.agenda.filter((r) => !r.done && r.date === t).sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
  const agendaSoon = D.agenda.filter((r) => !r.done && r.date > t).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || ""))).slice(0, 3);
  const overdueAgenda = D.agenda.filter((r) => !r.done && r.date < t);
  const tasksOpen = D.tasks.filter((r) => r.status !== "done");
  const tasksMine = tasksOpen.filter((r) => r.assignee === me?.user_id || r.assignee === "both");
  const low = D.stock_items.filter((r) => Number(r.qty) <= Number(r.min_qty));
  const expiring = D.stock_items.filter((r) => r.expiry_date && daysBetween(t, r.expiry_date) <= 14).sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
  const alerts = assetAlerts(t);
  const svcAl = serviceAlerts(t);
  const docAl = docAlerts(t);
  const vax = vaxAlerts();
  const maint = D.maintenance.map((r) => ({ r, n: nextDue(r) })).filter((x) => x.n && daysBetween(t, x.n) <= 14).sort((a, b) => a.n.localeCompare(b.n));
  const goals = D.goals.filter((g) => progressOf(g) < 100).sort((a, b) => (a.target_date || "9").localeCompare(b.target_date || "9")).slice(0, 3);
  const followups = D.health_records.filter((r) => r.followup_date && daysBetween(t, r.followup_date) <= 30).sort((a, b) => a.followup_date.localeCompare(b.followup_date));
  const shopping = D.shopping_items.filter((r) => !r.done);
  const primary = D.contacts.filter((r) => r.is_primary);

  const hour = new Date().getHours();
  const greet = hour < 11 ? "Selamat pagi" : hour < 15 ? "Selamat siang" : hour < 18 ? "Selamat sore" : "Selamat malam";

  root.append(
    h("section", { class: "box hello" },
      h("div", null, h("h1", null, `${greet}, ${me?.display_name || ""}! 👋`), h("p", null, `${fmtDate(t)} · ${state.household.name}`)),
      h("div", { style: { display: "flex", gap: ".6rem", flexWrap: "wrap" } },
        h("button", { class: "btn blue", type: "button", onclick: () => openForm(modByKey.agenda) }, "＋ Agenda"),
        h("button", { class: "btn green", type: "button", onclick: () => openForm(modByKey.tasks) }, "＋ Tugas"))),

    h("div", { class: "stats" },
      stat("📅", agendaToday.length, "Agenda hari ini", "agenda", "blue"),
      stat("✅", tasksOpen.length, "Tugas terbuka", "tasks", "green"),
      stat("🛒", shopping.length, "Perlu dibeli", "shopping", "orange"),
      stat("📦", low.length, "Stok menipis", "stock", low.length ? "red" : "lilac"),
      stat("🎯", goals.length, "Target berjalan", "goals", "yellow")),

    h("div", { class: "dash" },
      panel("📅 Hari ini & akan datang", "blue", "agenda",
        overdueAgenda.length ? h("div", { class: "chip red", style: { alignSelf: "flex-start" } }, `${overdueAgenda.length} agenda terlewat`) : null,
        agendaToday.length ? agendaToday.map((r) => li(r.title, [r.time ? hhmm(r.time) : "Sepanjang hari", memberName(r.assignee)].filter(Boolean).join(" · "),
          h("input", { type: "checkbox", "aria-label": "Selesai", onchange: (e) => run(() => updateRow("agenda", r.id, { done: e.target.checked })) }))) : none("Tidak ada agenda hari ini. 🎈"),
        agendaSoon.length ? h("small", { style: { fontWeight: 700 } }, "Berikutnya") : null,
        agendaSoon.map((r) => li(r.title, `${fmtShort(r.date)} · ${relDay(r.date)}${r.time ? " · " + hhmm(r.time) : ""}`))),

      panel("✅ Tugas saya", "green", "tasks",
        tasksMine.length ? tasksMine.sort((a, b) => (a.due_date || "9").localeCompare(b.due_date || "9")).slice(0, 5).map((r) => li(r.title, r.due_date ? `${fmtShort(r.due_date)} · ${relDay(r.due_date)}` : "Tanpa tenggat",
          h("input", { type: "checkbox", "aria-label": "Selesai", onchange: (e) => e.target.checked && markTaskDone(r) }))) : none(tasksOpen.length ? `Tidak ada tugas atas namamu. ${tasksOpen.length} tugas lain masih terbuka.` : "Semua beres! 🎉")),

      panel("🛒 Belanja & stok", "orange", "shopping",
        shopping.length ? shopping.slice(0, 5).map((r) => li(r.name, r.qty)) : none("Daftar belanja kosong."),
        low.length ? [h("small", { style: { fontWeight: 700 } }, "Stok menipis"), h("div", { class: "meta", style: { display: "flex", flexWrap: "wrap", gap: ".4rem" } }, low.slice(0, 8).map((r) => chip(`${r.name} (${Number(r.qty)})`, "red"))),
          h("button", { class: "btn sm orange", type: "button", onclick: () => addToShopping(low.map((r) => ({ name: r.name }))) }, "🛒 Masukkan semua ke belanja")] : null),

      panel("⏰ Cek kedaluwarsa", "red", "stock",
        expiring.length ? expiring.slice(0, 6).map((r) => { const n = daysBetween(t, r.expiry_date); return li(r.name, `${fmtDate(r.expiry_date)}${r.qty != null ? " · sisa " + Number(r.qty) + (r.unit ? " " + r.unit : "") : ""}`, chip(n < 0 ? `Lewat ${-n} hari` : relDay(r.expiry_date), n < 0 ? "red" : n <= 3 ? "red" : "orange")); })
          : none(D.stock_items.some((r) => r.expiry_date) ? "Tidak ada yang kedaluwarsa dalam 14 hari. 👍" : "Isi tanggal kedaluwarsa di Stok agar tidak ada makanan yang terlewat.")),

      panel("🏍️ Pajak & dokumen", "blue", "assets",
        isLocked("assets") ? lockedNote() : (alerts.length || docAl.length)
          ? [...alerts.slice(0, 4).map(({ a, r }) => li(`${a.name}${a.plate ? " · " + a.plate : ""}`, `${r.label}${r.date ? " · " + fmtDate(r.date) : ""}`, chip(r.text, r.tone))),
             ...docAl.slice(0, 4).map(({ d, st }) => li(`📄 ${d.name}${d.person ? " · " + d.person : ""}`, `Berlaku sampai ${fmtDate(d.expiry_date)}`, chip(st.text, st.tone)))]
          : none(D.assets.length || D.documents.length ? "Tidak ada pajak atau dokumen yang jatuh tempo. 👍" : "Catat motor, mobil, dan dokumen penting agar pajak dan masa berlakunya tidak terlewat.")),

      panel("💉 Imunisasi anak", "pink", "health",
        isLocked("health") ? lockedNote() : vax.length ? vax.slice(0, 6).map(({ p, v }) => li(`${p.person}: ${v.name}`, `Dianjurkan usia ${ageLabel(v.at)}`, chip(v.st.label, v.st.tone)))
          : none(D.health_profiles.some((p) => p.birth_date) ? "Tidak ada imunisasi yang perlu dikejar sekarang. 👍" : "Isi tanggal lahir anak di Profil Kesehatan untuk jadwal imunisasi.")),

      panel("🛠️ Perawatan segera", "orange", "maintenance",
        maint.length || svcAl.length ? [
          ...svcAl.slice(0, 3).map(({ a, r }) => li(`🔧 Servis ${a.name}${a.plate ? " · " + a.plate : ""}`, r.date ? fmtDate(r.date) : "Berdasarkan kilometer", chip(r.text, r.tone))),
          ...maint.slice(0, 5).map(({ r, n }) => li(r.title, `${fmtDate(n)}`, chip(daysBetween(t, n) < 0 ? `Terlambat ${-daysBetween(t, n)}h` : relDay(n), daysBetween(t, n) < 0 ? "red" : "orange")))] : none("Belum ada perawatan atau servis yang jatuh tempo dalam 14 hari.")),

      panel("👕 Lemari pakaian", "blue", "clothes",
        (() => {
          const names = [...new Set(D.clothes.map((r) => r.person).filter(Boolean))];
          if (!names.length) return none("Catat pakaian tiap anggota agar lemari tetap ringkas.");
          return names.map((n) => {
            const s = summarize(D.clothes.filter((r) => r.person === n), t), tg = D.clothes_targets.find((x) => x.person === n)?.target;
            return li(n, `${s.pieces} potong${tg ? " / target " + tg : ""}`, s.idle ? chip(`😴 ${s.idle} jarang dipakai`, "yellow") : tg && s.pieces > tg ? chip("Melebihi target", "red") : chip("Rapi", "green"));
          });
        })()),

      panel("🎯 Target keluarga", "yellow", "goals",
        goals.length ? goals.map((g) => h("div", { class: "li", style: { flexDirection: "column", alignItems: "stretch" } },
          h("div", { style: { display: "flex", justifyContent: "space-between", gap: ".5rem" } }, h("b", null, g.title), h("b", null, progressOf(g) + "%")),
          h("div", { class: "bar" }, h("i", { style: { width: progressOf(g) + "%" } })))) : none("Belum ada target. Mulai dari satu impian kecil! ✨")),

      panel("🩺 Kontrol kesehatan", "pink", "health",
        followups.length ? followups.slice(0, 5).map((r) => li(`${r.person}: ${r.title}`, fmtDate(r.followup_date), chip(relDay(r.followup_date), daysBetween(t, r.followup_date) < 0 ? "red" : "orange"))) : none("Tidak ada jadwal kontrol dalam 30 hari.")),

      panel("🚨 Kontak darurat", "red", "contacts",
        primary.length ? primary.slice(0, 4).map((r) => li(r.name, r.relation, h("a", { class: "btn sm green", href: "tel:" + (r.phone || "").replace(/\s/g, "") }, "📞 " + (r.phone || "")))) : none("Tandai kontak sebagai “utama” agar tampil di sini."),
        h("a", { class: "btn red block", href: "tel:112" }, "📞 112 — Darurat umum"))));
}

const stat = (icon, n, label, to, color) =>
  h("a", { class: "box stat", href: "#/" + to, style: { background: `var(--${color})` } }, h("b", null, String(n)), h("span", null, `${icon} ${label}`));

function markTaskDone(r) { modByKey.tasks.card(r, { patch: (row, p, m) => run(() => updateRow("tasks", row.id, p), m) }).check.set(true); }

// ============================================================
export function renderMore(root) {
  const GROUPS = [["Harian", ["agenda", "tasks", "shopping"]], ["Rumah", ["stock", "menu", "clothes", "maintenance", "assets"]], ["Keluarga", ["goals", "contacts", "health"]]];
  const known = new Set(GROUPS.flatMap(([, k]) => k));
  const tile = ([to, ico, label, color]) => h("a", { href: "#/" + to, style: `--c:var(--${color})` }, h("span", { class: "ico" }, ico), h("span", { class: "lb" }, label));
  const mod = (k) => { const m = MODULES.find((x) => x.key === k); return m ? [m.key, m.icon, m.nav, m.color] : null; };
  const extra = MODULES.filter((m) => !m.hidden && !known.has(m.key)).map((m) => [m.key, m.icon, m.nav, m.color]);
  const sections = GROUPS.map(([name, keys], i) => [name, [...keys.map(mod).filter(Boolean), ...(i === 1 ? extra : [])]]);
  sections.push(["Akun", [["pengaturan", "⚙️", "Pengaturan", "white"]]]);
  root.append(h("div", { class: "page-head" }, h("h1", null, "Semua menu")),
    ...sections.flatMap(([name, items]) => [h("div", { class: "nav-label more-label" }, name), h("div", { class: "menu-grid" }, items.map(tile))]));
}

// ============================================================
export function renderSettings(root, { logout, onRenamed }) {
  const hh = state.household, me = meMember(), owner = isOwner();
  const hhName = h("input", { type: "text", value: hh.name, maxlength: 60, "aria-label": "Nama rumah" });
  const myName = h("input", { type: "text", value: me?.display_name || state.user.name || "", maxlength: 40, "aria-label": "Nama panggilan" });
  const oldPw = state.user.hasPassword ? h("input", { type: "password", placeholder: "Password saat ini", autocomplete: "current-password", "aria-label": "Password saat ini" }) : null;
  const pw = h("input", { type: "password", placeholder: "Password baru (min. 8 karakter)", minlength: 8, autocomplete: "new-password", "aria-label": "Password baru" });

  const total = state.members.length + state.pending.length;
  const full = total >= hh.max_members;

  // Beri nama panggilan untuk anggota lain
  function renameMember(m) {
    const input = h("input", { type: "text", value: m.name_known ? m.display_name : "", maxlength: 40, placeholder: "Contoh: Sari", "aria-label": "Nama anggota" });
    const save = (val) => run(async () => { await setMemberAlias(m.user_id, val); close(); schedule(); }, "Tersimpan ✓");
    const close = modal("Nama untuk anggota ini", h("div", null,
      h("div", { class: "field" }, h("label", null, "Nama yang ditampilkan"), input),
      h("div", { class: "foot" },
        h("button", { class: "btn white", type: "button", onclick: () => save("") }, "Kembalikan"),
        h("button", { class: "btn yellow", type: "button", onclick: () => save(input.value.trim()) }, "Simpan"))));
  }
  const memberRow = (m) => {
    const self = m.user_id === state.user.id;
    const sub = m.email || (!self && !m.name_known ? "Nama belum tersedia — ketuk ✏️ untuk memberi nama" : m.role === "owner" ? "Pembuat rumah" : "Anggota");
    const badge = chip(m.role === "owner" ? "👑" : "👤", "lilac");
    const right = self ? badge : h("span", { style: { display: "inline-flex", gap: ".4rem", alignItems: "center" } }, badge,
      h("button", { class: "btn sm white icon-btn", type: "button", "aria-label": "Ubah nama anggota", onclick: () => renameMember(m) }, "✏️"));
    return li(m.display_name + (self ? " (kamu)" : ""), sub, right);
  };

  const members = h("div", { style: { display: "flex", flexDirection: "column", gap: ".5rem" } },
    state.members.map(memberRow),
    state.pending.map((m) => li(m.email || m.display_name, "Undangan terkirim — menunggu diterima", owner
      ? h("button", { class: "btn sm white", type: "button", onclick: () => run(async () => { await cancelInvite(m.membership_id); schedule(); }, "Undangan dibatalkan") }, "Batalkan")
      : chip("⏳ Menunggu", "yellow"))));

  const invEmail = h("input", { type: "email", placeholder: "email pasangan", autocomplete: "off", "aria-label": "Email pasangan" });
  const invName = h("input", { type: "text", placeholder: "Nama panggilan pasangan (opsional)", maxlength: 40, "aria-label": "Nama pasangan" });
  const schedule = () => document.dispatchEvent(new CustomEvent("rt:rerender"));

  const installBtn = h("button", { class: "btn lilac", type: "button", hidden: !window.__installPrompt, onclick: async () => {
    const p = window.__installPrompt; if (!p) return; p.prompt(); await p.userChoice; window.__installPrompt = null; installBtn.hidden = true;
  } }, "📲 Pasang aplikasi di perangkat");
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  root.append(
    h("div", { class: "page-head" }, h("h1", null, h("span", null, "⚙️"), "Pengaturan")),
    h("div", { class: "grid wide" },
      h("section", { class: "box card" }, h("h3", null, "🏠 Rumah tangga"),
        h("div", { class: "field" }, h("label", null, "Nama rumah"), hhName),
        h("button", { class: "btn yellow", type: "button", onclick: () => run(async () => {
          const v = hhName.value.trim(); if (!v) throw new Error("Nama rumah tidak boleh kosong.");
          await renameHousehold(v); onRenamed();
        }, "Tersimpan ✓") }, "Simpan nama rumah"),
        h("hr", { style: { border: "1.5px dashed var(--ink)", margin: ".8rem 0" } }),
        h("b", null, "💌 Undang pasangan"),
        owner
          ? (full
            ? h("div", { class: "note" }, `Rumah ini sudah terisi (${total}/${hh.max_members}).`)
            : h("form", { style: { display: "flex", flexDirection: "column", gap: ".6rem" }, onsubmit: (e) => {
                e.preventDefault();
                run(async () => { await inviteMember(invEmail.value.trim(), invName.value.trim()); invEmail.value = ""; invName.value = ""; schedule(); }, "Undangan terkirim ke email pasangan ✉️");
              } }, invEmail, invName, h("button", { class: "btn pink", type: "submit" }, "Kirim undangan"),
              h("div", { class: "note" }, "Pasangan akan menerima email berisi tautan. Setelah mengkliknya, ia membuat password dan langsung bergabung. Cek folder spam bila belum masuk.")))
          : h("div", { class: "note" }, "Hanya pembuat rumah yang dapat mengundang anggota.")),

      h("section", { class: "box card" }, h("h3", null, "👨‍👩‍👧 Anggota"), members,
        h("button", { class: "btn sm white", type: "button", onclick: () => run(async () => { await loadAll(); await loadMembers(); schedule(); }, "Diperbarui") }, "🔄 Segarkan"),
        h("div", { class: "field", style: { marginTop: ".6rem" } }, h("label", null, "Nama panggilanmu"), myName),
        h("button", { class: "btn yellow", type: "button", onclick: () => run(async () => {
          const v = myName.value.trim(); if (!v) throw new Error("Nama tidak boleh kosong.");
          await renameMe(v); onRenamed();
        }, "Tersimpan ✓") }, "Simpan nama")),

      h("section", { class: "box card" }, h("h3", null, "🔐 Akun"),
        h("div", { class: "note" }, "Masuk sebagai " + state.user.email),
        h("div", { class: "field" }, h("label", null, "Ganti password"), oldPw, pw),
        h("div", { class: "sos" },
          h("button", { class: "btn white", type: "button", onclick: () => run(async () => {
            if (pw.value.length < 8) throw new Error("Password minimal 8 karakter.");
            await setPassword(pw.value, oldPw?.value); pw.value = ""; if (oldPw) oldPw.value = "";
          }, "Password diganti ✓") }, "Ganti password"),
          h("button", { class: "btn red", type: "button", onclick: logout }, "Keluar"))),

      lockSettings(),

      h("section", { class: "box card" }, h("h3", null, "🎨 Tampilan"),
        h("div", { class: "filters", role: "group", "aria-label": "Tema" }, [["auto", "Otomatis"], ["light", "☀️ Terang"], ["dark", "🌙 Gelap"]].map(([id, label]) =>
          h("button", { type: "button", class: getPref() === id ? "on" : "", onclick: () => setPref(id) }, label))),
        h("div", { class: "note" }, "Otomatis mengikuti pengaturan HP atau komputer. Pilihan ini hanya berlaku di perangkat ini.")),

      h("section", { class: "box card" }, h("h3", null, "📲 Aplikasi & cadangan"),
        installBtn,
        isIOS ? h("div", { class: "note" }, "iPhone/iPad: ketuk tombol Bagikan di Safari, lalu “Tambah ke Layar Utama”.") : h("div", { class: "note" }, "Bila tombol pasang tidak muncul, gunakan menu browser: “Instal aplikasi” / “Tambahkan ke layar utama”."),
        h("button", { class: "btn blue", type: "button", onclick: exportBackup }, "💾 Unduh cadangan data (JSON)"),
        h("div", { class: "note" }, `${CONFIG.APP_NAME} menyimpan data di Appwrite milik Anda. Cadangan ini berguna sebagai arsip pribadi.`))));
}

function exportBackup() {
  const out = { app: CONFIG.APP_NAME, exported_at: new Date().toISOString(), household: { name: state.household.name }, members: state.members.map((m) => m.display_name), data: {} };
  for (const t of TABLES) out.data[t] = state.data[t].map(({ household_id, created_by, ...rest }) => rest);
  const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" })), download: `omahku-cadangan-${today()}.json` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast("Cadangan diunduh ✓", "ok");
}
