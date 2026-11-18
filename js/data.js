// Lapisan data Omahku untuk Appwrite.
//
// Rancangan: SATU tabel "records" (kolom: kind, data). Setiap catatan (agenda, tugas, dll.) adalah
// satu baris; isinya disimpan sebagai JSON di kolom "data". Hak akses tiap baris = Role.team(<id rumah>),
// jadi hanya anggota "Team" (rumah tangga) yang bisa membaca/mengubah. Rumah tangga = satu Team Appwrite.
import { CONFIG } from "./config.js";

export const TABLES = ["agenda", "tasks", "stock_items", "shopping_items", "menus", "maintenance", "goals", "contacts", "health_records", "health_profiles", "health_metrics", "assets", "asset_services", "sos_numbers"];

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
  const me = meMember(); if (me) me.display_name = name;
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
    membership_id: m.$id, user_id: m.userId, email: m.userEmail,
    display_name: m.userName || (m.userEmail || "").split("@")[0] || "Anggota",
    role: (m.roles || []).includes("owner") ? "owner" : "member",
    confirm: !!m.confirm,
  });
  const all = memberships.map(map);
  state.members = all.filter((m) => m.confirm);
  state.pending = all.filter((m) => !m.confirm);
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
const sortRows = (t) => state.data[t].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

function upsert(kind, row) {
  if (!state.data[kind]) return;
  const list = state.data[kind];
  const i = list.findIndex((x) => x.id === row.$id);
  const dec = decode(row);
  if (i >= 0) list[i] = dec; else list.push(dec);
  sortRows(kind); emit(kind);
}
function remove(kind, id) {
  if (!state.data[kind]) return;
  state.data[kind] = state.data[kind].filter((x) => x.id !== id); emit(kind);
}

export async function loadAll() {
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
  TABLES.forEach(emit);
}
export const loadTable = loadAll; // satu tabel fisik: muat ulang semuanya

export async function insertRow(table, values) {
  const row = await tablesDB.createRow({ databaseId: DB, tableId: TBL, rowId: ID.unique(), data: { kind: table, data: encode(values) }, permissions: perms() });
  upsert(table, row);
}
export async function insertMany(table, rows) {
  const created = await Promise.all(rows.map((v) => tablesDB.createRow({ databaseId: DB, tableId: TBL, rowId: ID.unique(), data: { kind: table, data: encode(v) }, permissions: perms() })));
  created.forEach((r) => upsert(table, r));
}
export async function updateRow(table, id, patch) {
  const list = state.data[table];
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) throw new Error("Catatan tidak ditemukan.");
  const before = list[i], next = { ...before, ...patch };
  const json = encode(next);              // validasi ukuran sebelum optimistis
  list[i] = next; emit(table);            // UI terasa instan
  try { await tablesDB.updateRow({ databaseId: DB, tableId: TBL, rowId: id, data: { data: json } }); }
  catch (e) { list[i] = before; emit(table); throw e; }
}
export async function deleteRow(table, id) {
  await tablesDB.deleteRow({ databaseId: DB, tableId: TBL, rowId: id });
  remove(table, id);
}
export async function deleteMany(table, ids) {
  await Promise.all(ids.map((id) => tablesDB.deleteRow({ databaseId: DB, tableId: TBL, rowId: id })));
  ids.forEach((id) => remove(table, id));
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
