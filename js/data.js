// Lapisan data Omahku untuk Appwrite.
//
// Rancangan: SATU tabel "records" (kolom: kind, data). Setiap catatan (agenda, tugas, dll.) adalah
// satu baris; isinya disimpan sebagai JSON di kolom "data". Hak akses tiap baris = Role.team(<id rumah>),
// jadi hanya anggota "Team" (rumah tangga) yang bisa membaca/mengubah. Rumah tangga = satu Team Appwrite.
import { CONFIG } from "./config.js";
import { idbGet, idbSet, idbDel, isNetworkError } from "./offline.js";

export const TABLES = ["agenda", "tasks", "stock_items", "shopping_items", "menus", "maintenance", "goals", "contacts", "health_records", "health_profiles", "health_metrics", "assets", "asset_services", "sos_numbers", "clothes", "clothes_targets", "documents", "member_profiles", "app_settings"];

export const configured = !/GANTI-DENGAN/.test(CONFIG.ENDPOINT + CONFIG.PROJECT_ID);

const AW = window.Appwrite;
const client = configured ? new AW.Client().setEndpoint(CONFIG.ENDPOINT).setProject(CONFIG.PROJECT_ID) : null;
const account = configured ? new AW.Account(client) : null;
const teams = configured ? new AW.Teams(client) : null;
const tablesDB = configured ? new AW.TablesDB(client) : null;
const { ID, Query, Permission, Role } = AW || {};

const DB = CONFIG.DATABASE_ID, TBL = CONFIG.TABLE_ID;
const MAX_JSON = 15000; // kolom "text" Appwrite maksimal 16.383 karakter

export const state = {
  user: null,        // { id, email, name, hasPassword }
  household: null,   // { id, name, max_members }
  members: [],       // anggota yang sudah bergabung
  pending: [],       // undangan yang belum diterima
  data: Object.fromEntries(TABLES.map((t) => [t, []])),
  loaded: false,
};

const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (what) => listeners.forEach((fn) => fn(what));

export const meMember = () => state.members.find((m) => m.user_id === state.user?.id);
export const memberName = (v) => {
  if (!v) return "";
  if (v === "both") return "Berdua";
  return state.members.find((m) => m.user_id === v)?.display_name || "";
};
export const isOwner = () => !!meMember() && meMember().role === "owner";
export const ownerMember = () => state.members.find((m) => m.role === "owner") || null;
export const ROLE_PRESETS = ["Suami", "Istri", "Ayah", "Ibu", "Anak"];
const defaultRoleName = (m) => (m.role === "owner" ? "Suami" : "Istri"); // pembuat rumah = anggota pertama

// Nama anggota: pakai data Appwrite bila tersedia; bila disembunyikan, pakai profil yang disimpan anggota itu sendiri.
const emailName = (e) => String(e || "").split("@")[0];
// Gabungkan semua catatan profil milik satu anggota (jaga-jaga bila ada lebih dari satu): nilai terakhir yang terisi menang.
function profileOf(userId) {
  const out = { name: "", email: "", alias: "", role_name: "" };
  for (const p of state.data.member_profiles || []) {
    if (p.user_id !== userId) continue;
    for (const k of Object.keys(out)) if (p[k]) out[k] = p[k];
  }
  return out;
}
function refreshNames() {
  for (const m of [...state.members, ...state.pending]) {
    const p = profileOf(m.user_id);
    const alias = m.user_id === state.user?.id ? "" : p.alias; // nama panggilan dari anggota lain; diri sendiri memakai namanya sendiri
    m.display_name = alias || m.api_name || p.name || emailName(m.api_email) || emailName(p.email) || "Anggota";
    m.email = m.api_email || p.email || "";
    m.name_known = !!(alias || m.api_name || p.name || m.api_email || p.email);
    m.role_name = p.role_name || defaultRoleName(m);
  }
}

// URL aplikasi ini (untuk tautan di email undangan / reset password).
// Hostname-nya HARUS terdaftar sebagai Platform Web di Appwrite Console.
export const appUrl = () => location.origin + location.pathname.replace(/index\.html$/, "");

// ============================================================
// Akun
// ============================================================
const toUser = (u) => (u ? { id: u.$id, email: u.email, name: u.name || "", hasPassword: !!u.passwordUpdate } : null);

export async function fetchUser() {
  try { return toUser(await account.get()); }
  catch (e) { if (e?.code === 401) return null; throw e; }
}
export async function signIn(email, password) {
  await account.createEmailPasswordSession({ email, password });
}
export async function signUp(email, password, name) {
  await account.create({ userId: ID.unique(), email, password, name: name || undefined });
  await signIn(email, password);
}
export async function signOut() { try { await account.deleteSession({ sessionId: "current" }); } catch { /* sudah keluar */ } }
export async function sendRecovery(email) { await account.createRecovery({ email, url: appUrl() }); }
export async function completeRecovery(userId, secret, password) { await account.updateRecovery({ userId, secret, password }); }
export async function setPassword(password, oldPassword) {
  await account.updatePassword({ password, oldPassword: oldPassword || undefined });
  if (state.user) state.user.hasPassword = true;
}
export async function renameMe(name) {
  await account.updateName({ name });
  if (state.user) state.user.name = name;
  const me = meMember(); if (me) { me.api_name = name; me.display_name = name; }
  syncMyProfile().catch(() => { /* akan dicoba lagi saat masuk berikutnya */ });
}
export async function acceptInvite({ teamId, membershipId, userId, secret }) {
  await teams.updateMembershipStatus({ teamId, membershipId, userId, secret });
}

// ============================================================
// Rumah tangga = Team
// ============================================================
export async function loadHousehold() {
  const { teams: list } = await teams.list();
  if (!list.length) { state.household = null; state.members = []; state.pending = []; return false; }
  const t = list[0];
  state.household = { id: t.$id, name: t.name, max_members: CONFIG.MAX_MEMBERS };
  await loadMembers();
  return true;
}

export async function loadMembers() {
  const { memberships } = await teams.listMemberships({ teamId: state.household.id });
  const map = (m) => ({
    membership_id: m.$id, user_id: m.userId,
    // Appwrite bisa menyembunyikan nama/email anggota lain (privasi keanggotaan). Simpan apa adanya,
    // lalu refreshNames() melengkapinya dari catatan "member_profiles" milik tiap anggota.
    api_name: m.userName || "", api_email: m.userEmail || "", email: m.userEmail || "",
    display_name: m.userName || (m.userEmail || "").split("@")[0] || "Anggota",
    role: (m.roles || []).includes("owner") ? "owner" : "member",
    confirm: !!m.confirm,
  });
  const all = memberships.map(map);
  state.members = all.filter((m) => m.confirm);
  state.pending = all.filter((m) => !m.confirm);
  refreshNames();
  emit("members");
}

export async function createHousehold(houseName, nickname) {
  if (nickname && nickname !== state.user?.name) await renameMe(nickname);
  await teams.create({ teamId: ID.unique(), name: houseName });
  await loadHousehold();
}
export async function renameHousehold(name) {
  await teams.updateName({ teamId: state.household.id, name });
  state.household.name = name;
}
export async function inviteMember(email, name) {
  if (state.members.length + state.pending.length >= state.household.max_members)
    throw new Error(`Rumah tangga ini sudah penuh (maksimal ${state.household.max_members} anggota).`);
  await teams.createMembership({ teamId: state.household.id, roles: ["member"], email, url: appUrl(), name: name || undefined });
  await loadMembers();
}
export async function cancelInvite(membershipId) {
  await teams.deleteMembership({ teamId: state.household.id, membershipId });
  await loadMembers();
}

// ============================================================
// Data (baris di tabel "records")
// ============================================================
const decode = (r) => {
  let obj = {};
  try { obj = JSON.parse(r.data || "{}"); } catch { /* data rusak: tampilkan kosong */ }
  return { ...obj, id: r.$id, created_at: r.$createdAt, household_id: state.household?.id };
};
const encode = (obj) => {
  const { id, created_at, household_id, ...rest } = obj;
  const json = JSON.stringify(rest);
  if (json.length > MAX_JSON) throw new Error("Catatan terlalu panjang. Persingkat teks atau pecah menjadi beberapa catatan.");
  return json;
};
const perms = () => {
  const r = Role.team(state.household.id);
  return [Permission.read(r), Permission.update(r), Permission.delete(r)];
};
// Baris yang boleh DIBACA seluruh anggota, tetapi hanya DIUBAH/DIHAPUS oleh pemilik rumah (ditegakkan oleh Appwrite).
const ownerPerms = (ownerUid) => [Permission.read(Role.team(state.household.id)), Permission.update(Role.user(ownerUid)), Permission.delete(Role.user(ownerUid))];
const sortRows = (t) => state.data[t].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

function upsert(kind, row) {
  if (!state.data[kind]) return;
  const list = state.data[kind];
  const i = list.findIndex((x) => x.id === row.$id);
  const dec = decode(row);
  if (i >= 0) list[i] = dec; else list.push(dec);
  sortRows(kind); if (kind === "member_profiles") refreshNames(); emit(kind);
}
function remove(kind, id) {
  if (!state.data[kind]) return;
  state.data[kind] = state.data[kind].filter((x) => x.id !== id); if (kind === "member_profiles") refreshNames(); emit(kind);
}

// ------------------------------------------------------------
// Offline: antrean perubahan (outbox) + salinan data di perangkat (snapshot)
// ------------------------------------------------------------
// Saat tidak ada internet, perubahan tetap tampil di layar dan masuk antrean, lalu dikirim berurutan
// begitu koneksi kembali. Baris yang dibuat offline memakai id sementara berawalan "tmp_".
let outbox = [];          // [{ op: "insert"|"update"|"delete", table, id, values? }]
let outboxUid = null;     // pemilik antrean (agar tidak tercampur antar akun)
let inflight = null;      // operasi yang sedang dikirim (tidak boleh digabung/diubah)
let flushing = null;
const isTmp = (id) => String(id).startsWith("tmp_");
export const pendingCount = () => outbox.length;
const shouldQueue = () => !navigator.onLine || outbox.length > 0; // antrean tidak kosong: jaga urutan

async function persistOutbox() {
  try { await idbSet("outbox", { uid: outboxUid, ops: outbox }); } catch { /* penyimpanan perangkat diblokir/penuh */ }
  emit("outbox");
}
export async function loadOutbox() {
  if (outbox.length && outboxUid === (state.user?.id || null)) return;
  try {
    const o = await idbGet("outbox");
    outbox = o && o.uid === state.user?.id && Array.isArray(o.ops) ? o.ops : [];
    outboxUid = state.user?.id || null;
  } catch { outbox = []; }
}
function enqueue(op) {
  outboxUid = state.user?.id || null;
  if (op.op === "update") {
    const prev = outbox.find((o) => o !== inflight && o.id === op.id && (o.op === "insert" || o.op === "update"));
    if (prev) { prev.values = op.values; return persistOutbox(); } // gabungkan: cukup kirim versi terakhir
  } else if (op.op === "delete") {
    const hadInsert = outbox.some((o) => o !== inflight && o.id === op.id && o.op === "insert");
    outbox = outbox.filter((o) => o === inflight || o.id !== op.id);
    if (hadInsert) return persistOutbox(); // dibuat & dihapus saat offline: tak perlu dikirim sama sekali
  }
  outbox.push(op);
  return persistOutbox();
}
const kick = () => { if (navigator.onLine) flushOutbox().catch(() => {}); };

function adoptServerId(op, row) {
  const tmp = op.id, real = row.$id;
  for (const x of outbox) if (x !== op && x.id === tmp) x.id = real; // operasi susulan kini menunjuk baris asli
  const list = state.data[op.table] || [];
  if (list.some((r) => r.id === real)) state.data[op.table] = list.filter((r) => r.id !== tmp); // echo realtime sudah masuk
  else { const loc = list.find((r) => r.id === tmp); if (loc) { loc.id = real; loc.created_at = row.$createdAt; } }
  sortRows(op.table); emit(op.table);
}

// Kirim antrean berurutan. Berhenti bila jaringan putus (sisa antrean tetap tersimpan).
export function flushOutbox() {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0, failed = 0;
    try {
      while (outbox.length) {
        const o = outbox[0];
        inflight = o;
        try {
          if (o.op === "insert") {
            const row = await tablesDB.createRow({ databaseId: DB, tableId: TBL, rowId: ID.unique(), data: { kind: o.table, data: encode(o.values) }, permissions: o.ownerOnly ? ownerPerms(o.ownerUid) : perms() });
            adoptServerId(o, row);
          } else if (o.op === "update") {
            await tablesDB.updateRow({ databaseId: DB, tableId: TBL, rowId: o.id, data: { data: encode(o.values) } });
          } else {
            try { await tablesDB.deleteRow({ databaseId: DB, tableId: TBL, rowId: o.id }); }
            catch (e) { if (e?.code !== 404) throw e; } // sudah terhapus di server: anggap beres
          }
          sent++;
        } catch (e) {
          if (isNetworkError(e)) break;
          console.warn("Perubahan offline tidak bisa dikirim", o, e); failed++; // mis. baris sudah dihapus pasangan
        } finally { inflight = null; }
        const i = outbox.indexOf(o); if (i >= 0) outbox.splice(i, 1);
        await persistOutbox();
      }
    } finally {
      flushing = null; inflight = null;
      if (sent || failed) document.dispatchEvent(new CustomEvent("rt:sync", { detail: { sent, failed } }));
    }
    return { sent, failed };
  })();
  return flushing;
}

let saveTimer = 0;
async function saveSnapshot() {
  if (!state.user || !state.household || !state.loaded) return;
  try { await idbSet("snapshot", { v: 1, savedAt: Date.now(), user: state.user, household: state.household, members: state.members, pending: state.pending, data: state.data }); }
  catch { /* penyimpanan perangkat diblokir/penuh: aplikasi tetap jalan, hanya tanpa mode offline */ }
}
function applyOutbox() { // pasang kembali perubahan yang belum terkirim di atas salinan data
  for (const o of outbox) {
    const list = state.data[o.table]; if (!list) continue;
    const i = list.findIndex((r) => r.id === o.id);
    if (o.op === "delete") { if (i >= 0) list.splice(i, 1); continue; }
    const row = { ...(i >= 0 ? list[i] : {}), ...o.values, id: o.id, created_at: i >= 0 ? list[i].created_at : new Date().toISOString(), household_id: state.household?.id };
    if (i >= 0) list[i] = row; else list.push(row);
  }
  TABLES.forEach(sortRows);
}
// Dipakai saat server tak terjangkau: isi state dari salinan terakhir di perangkat.
export async function restoreOffline() {
  let snap;
  try { snap = await idbGet("snapshot"); } catch { return false; }
  if (!snap || !snap.user || !snap.household) return false;
  if (state.user && state.user.id !== snap.user.id) return false;
  state.user = snap.user; state.household = snap.household;
  state.members = snap.members || []; state.pending = snap.pending || [];
  state.data = Object.fromEntries(TABLES.map((t) => [t, snap.data?.[t] || []]));
  await loadOutbox();
  applyOutbox();
  state.loaded = true;
  return true;
}
export async function clearOffline() { // dipanggil saat keluar akun
  clearTimeout(saveTimer); outbox = []; outboxUid = null;
  try { await idbDel("snapshot"); await idbDel("outbox"); } catch { /* abaikan */ }
}

export async function loadAll() {
  if (outbox.length) {
    await flushOutbox();
    if (outbox.length) throw new Error("Failed to fetch"); // koneksi belum pulih: pertahankan data lokal
  }
  const fresh = Object.fromEntries(TABLES.map((t) => [t, []]));
  let cursor = null;
  for (;;) {
    const queries = [Query.limit(100)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const { rows } = await tablesDB.listRows({ databaseId: DB, tableId: TBL, queries });
    for (const r of rows) if (fresh[r.kind]) fresh[r.kind].push(decode(r));
    if (rows.length < 100) break;
    cursor = rows[rows.length - 1].$id;
  }
  for (const t of TABLES) fresh[t].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  state.data = fresh; state.loaded = true;
  refreshNames();
  TABLES.forEach(emit);
}
export const loadTable = loadAll; // satu tabel fisik: muat ulang semuanya

function localInsert(table, values, opts = {}) {
  const id = "tmp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  state.data[table].push({ ...values, id, created_at: new Date().toISOString(), household_id: state.household?.id });
  sortRows(table); if (table === "member_profiles") refreshNames(); emit(table);
  return enqueue({ op: "insert", table, id, values: { ...values }, ...(opts.ownerOnly ? { ownerOnly: true, ownerUid: opts.ownerUid } : {}) });
}

export async function insertRow(table, values, opts = {}) {
  encode(values); // validasi ukuran lebih dulu
  const queued = shouldQueue();
  if (!queued) {
    try {
      const row = await tablesDB.createRow({ databaseId: DB, tableId: TBL, rowId: ID.unique(), data: { kind: table, data: encode(values) }, permissions: opts.ownerOnly ? ownerPerms(opts.ownerUid) : perms() });
      upsert(table, row); return;
    } catch (e) { if (!isNetworkError(e)) throw e; }
  }
  await localInsert(table, values, opts);
  if (queued) kick();
}
export async function insertMany(table, rows) {
  rows.forEach(encode);
  const queued = shouldQueue();
  if (!queued) {
    const res = await Promise.allSettled(rows.map((v) => tablesDB.createRow({ databaseId: DB, tableId: TBL, rowId: ID.unique(), data: { kind: table, data: encode(v) }, permissions: perms() })));
    let hard = null;
    for (let i = 0; i < res.length; i++) {
      if (res[i].status === "fulfilled") upsert(table, res[i].value);
      else if (isNetworkError(res[i].reason)) await localInsert(table, rows[i]);
      else hard = hard || res[i].reason;
    }
    if (hard) throw hard;
    return;
  }
  for (const v of rows) await localInsert(table, v);
  kick();
}
export async function updateRow(table, id, patch) {
  const list = state.data[table];
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) throw new Error("Catatan tidak ditemukan.");
  const before = list[i], next = { ...before, ...patch };
  const json = encode(next);              // validasi ukuran sebelum optimistis
  list[i] = next; if (table === "member_profiles") refreshNames(); emit(table);            // UI terasa instan
  const queued = shouldQueue() || isTmp(id);
  if (!queued) {
    try { await tablesDB.updateRow({ databaseId: DB, tableId: TBL, rowId: id, data: { data: json } }); return; }
    catch (e) { if (!isNetworkError(e)) { list[i] = before; emit(table); throw e; } }
  }
  await enqueue({ op: "update", table, id, values: next });
  if (queued) kick();
}
export async function deleteRow(table, id) {
  const queued = shouldQueue() || isTmp(id);
  if (!queued) {
    try { await tablesDB.deleteRow({ databaseId: DB, tableId: TBL, rowId: id }); remove(table, id); return; }
    catch (e) { if (!isNetworkError(e)) throw e; }
  }
  remove(table, id);
  await enqueue({ op: "delete", table, id });
  if (queued) kick();
}
export async function deleteMany(table, ids) {
  await Promise.all(ids.map((id) => deleteRow(table, id)));
}

// Ubah satu field profil anggota (nilai kosong = hapus). Bila ada baris ganda, hanya baris pertama yang menyimpan nilainya.
async function setProfileField(userId, field, value) {
  const clean = String(value || "").trim().slice(0, 40);
  const mine = (state.data.member_profiles || []).filter((p) => p.user_id === userId);
  if (!mine.length) { if (clean) await insertRow("member_profiles", { user_id: userId, name: "", email: "", alias: "", role_name: "", [field]: clean }); return; }
  for (let i = 0; i < mine.length; i++) {
    const want = i === 0 ? clean : "";
    if ((mine[i][field] || "") !== want) await updateRow("member_profiles", mine[i].id, { [field]: want });
  }
}
// Nama panggilan untuk anggota lain (tampil di kedua perangkat).
export const setMemberAlias = (userId, alias) => setProfileField(userId, "alias", alias);
// Nama peran (Suami, Istri, Ayah, …). Pembuat rumah boleh mengubah siapa pun; anggota hanya perannya sendiri.
export function setMemberRole(userId, roleName) {
  if (!isOwner() && userId !== state.user?.id) throw new Error("Hanya pembuat rumah yang dapat mengubah peran anggota lain.");
  return setProfileField(userId, "role_name", roleName);
}

// ------------------------------------------------------------
// Key AI keluarga: satu key untuk seluruh keluarga. Dibaca semua anggota, hanya pemilik rumah yang bisa mengubahnya.
// Baris dibuat dengan izin ubah/hapus khusus pemilik; field "by" mencegah baris buatan anggota lain dipakai.
// ------------------------------------------------------------
function familyAIRow() {
  const owner = ownerMember();
  const rows = (state.data.app_settings || []).filter((r) => owner && r.by === owner.user_id);
  return rows[rows.length - 1] || null;
}
export function familyAI() {
  const r = familyAIRow();
  return { key: r?.ai_key || "", model: r?.ai_model || "" };
}
export async function saveFamilyAI({ key, model }) {
  if (!isOwner()) throw new Error("Hanya pembuat rumah yang dapat mengubah key AI keluarga.");
  const values = { by: ownerMember().user_id, ai_key: String(key || "").trim(), ai_model: String(model || "").trim() };
  const cur = familyAIRow();
  if (cur) await updateRow("app_settings", cur.id, values);
  else await insertRow("app_settings", values, { ownerOnly: true, ownerUid: values.by });
}

// Simpan nama & email saya ke data keluarga agar anggota lain bisa menampilkannya.
let syncingProfile = false;
export async function syncMyProfile() {
  if (syncingProfile || !state.user || !state.household || !state.loaded || !meMember()) return;
  syncingProfile = true;
  try {
    const email = state.user.email || "";
    const name = state.user.name || emailName(email) || "Anggota";
    const cur = state.data.member_profiles.find((p) => p.user_id === state.user.id);
    if (!cur) await insertRow("member_profiles", { user_id: state.user.id, name, email });
    else if (cur.name !== name || cur.email !== email) await updateRow("member_profiles", cur.id, { name, email });
  } finally { syncingProfile = false; }
}

// ============================================================
// Realtime: perubahan dari pasangan muncul langsung
// ============================================================
let unsub = null;
export function subscribe() {
  unsubscribe();
  unsub = client.subscribe(AW.Channel.tablesdb(DB).table(TBL).row(), (res) => {
    const row = res.payload;
    if (!row || !row.$id) return;
    if (res.events.some((e) => e.endsWith(".delete"))) {
      for (const t of TABLES) remove(t, row.$id);
    } else if (row.kind) upsert(row.kind, row);
  });
}
export function unsubscribe() { try { unsub?.(); } catch { /* abaikan */ } unsub = null; }

// Cadangan bila koneksi realtime sempat putus: muat ulang saat tab kembali aktif
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.household && state.loaded) {
    loadAll().catch(() => {}); loadMembers().catch(() => {});
  }
});

// Simpan salinan data setiap ada perubahan (ditunda sebentar agar tidak berulang-ulang)
listeners.add(() => { clearTimeout(saveTimer); saveTimer = setTimeout(saveSnapshot, 600); });
// Coba kirim ulang perubahan yang tertunda (mis. sinyal "online" tapi koneksi buruk)
setInterval(() => { if (outbox.length && navigator.onLine && state.household) flushOutbox().catch(() => {}); }, 30000);
