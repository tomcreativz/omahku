// Perhitungan pengingat aset (murni, tanpa DOM): pajak, STNK, asuransi, servis, dan file kalender (.ics).

const D = (s) => new Date(s + "T00:00:00");
const p2 = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const daysTo = (to, from) => Math.round((D(to) - D(from)) / 864e5);
// Tambah bulan tanpa "melompat" bulan (31 Jan + 1 bln = 28/29 Feb).
export function addMonthsISO(s, n) {
  const d = D(s), day = d.getDate();
  d.setMonth(d.getMonth() + n);
  if (d.getDate() !== day) d.setDate(0);
  return iso(d);
}

export const toneByDays = (days) => (days < 0 ? "red" : days <= 14 ? "orange" : days <= 60 ? "yellow" : "green");
export function relText(days) {
  if (days < 0) return `Terlambat ${-days} hari`;
  if (days === 0) return "Hari ini";
  if (days === 1) return "Besok";
  if (days <= 60) return `${days} hari lagi`;
  return `${Math.round(days / 30)} bln lagi`;
}

const filled = (v) => v != null && v !== "";

export function nextService(a, now) {
  const mo = Number(a.interval_months) || 0, km = Number(a.interval_km) || 0;
  let byDate = null, byKm = null, daysLeft = null, kmLeft = null;
  if (mo && a.last_service_date) { byDate = addMonthsISO(a.last_service_date, mo); daysLeft = daysTo(byDate, now); }
  if (km && filled(a.last_service_km)) {
    byKm = Number(a.last_service_km) + km;
    if (filled(a.odometer)) kmLeft = byKm - Number(a.odometer);
  }
  if (daysLeft == null && kmLeft == null) return null;
  const over = (daysLeft != null && daysLeft < 0) || (kmLeft != null && kmLeft < 0);
  const near = (daysLeft != null && daysLeft <= 14) || (kmLeft != null && kmLeft <= 300);
  const soon = (daysLeft != null && daysLeft <= 30) || (kmLeft != null && kmLeft <= 500);
  const parts = [];
  if (daysLeft != null) parts.push(relText(daysLeft));
  if (kmLeft != null) parts.push(kmLeft < 0 ? `lewat ${-kmLeft} km` : `${kmLeft} km lagi`);
  return { byDate, byKm, daysLeft, kmLeft, over, tone: over ? "red" : near ? "orange" : soon ? "yellow" : "green", text: parts.join(" · ") };
}

// Aset yang masuk menu Perawatan: kendaraan, atau aset lain yang sudah punya data servis.
export const hasServiceData = (a) => filled(a.last_service_date) || filled(a.last_service_km) || filled(a.interval_months) || filled(a.interval_km);
export const isProperty = (a) => a.type === "Rumah / Tanah";
export const isVehicle = (a) => !a.type || ["Motor", "Mobil", "Sepeda"].includes(a.type);
const LABELS = { veh: { tax: "Pajak", stnk: "STNK/plat" }, prop: { tax: "PBB", stnk: "Sertifikat" }, oth: { tax: "Pajak/biaya", stnk: "Garansi" } };
export const labelsOf = (a) => LABELS[isProperty(a) ? "prop" : isVehicle(a) ? "veh" : "oth"];

// Daftar pengingat satu aset. `days` dipakai untuk mengurutkan (kecil = mendesak).
// kind: "all" (semua), "docs" (pajak/STNK/asuransi saja), "svc" (servis saja).
export function reminders(a, now, kind = "all") {
  const out = [];
  const L = labelsOf(a);
  const defs = [["tax", L.tax, "tax_due"], ["stnk", L.stnk, "stnk_due"], ["ins", "Asuransi", "insurance_due"]];
  for (const [id, label, key] of defs) {
    if (kind === "svc" || !a[key]) continue;
    const days = daysTo(a[key], now);
    out.push({ id, label, date: a[key], days, tone: toneByDays(days), text: relText(days) });
  }
  const s = kind === "docs" ? null : nextService(a, now);
  if (s) {
    let days = s.daysLeft ?? 999;
    if (s.kmLeft != null) days = s.kmLeft < 0 ? Math.min(days, -1) : s.kmLeft <= 300 ? Math.min(days, 7) : s.kmLeft <= 500 ? Math.min(days, 30) : days;
    out.push({ id: "svc", label: "Servis", date: s.byDate, days, tone: s.tone, text: s.text });
  }
  return out;
}
export const urgencyOf = (a, now, kind = "all") => reminders(a, now, kind).reduce((m, r) => Math.min(m, r.days), 9999);

// ---------- Kalender (.ics) ----------
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const fold = (line) => { const out = []; while (line.length > 72) { out.push(line.slice(0, 72)); line = " " + line.slice(72); } out.push(line); return out.join("\r\n"); };
const ymd = (s) => s.replace(/-/g, "");

export function buildICS(a, now, stamp, kind = "all") {
  const name = a.name + (a.plate ? ` (${a.plate})` : "");
  const L = labelsOf(a);
  const what = { tax: `${L.tax} ${name} jatuh tempo`, stnk: `${L.stnk} ${name} berakhir`, ins: `Asuransi ${name} berakhir`, svc: `Servis berkala ${name}` };
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Omahku//Pengingat Aset//ID", "CALSCALE:GREGORIAN"];
  let n = 0;
  for (const r of reminders(a, now, kind)) {
    if (!r.date) continue;
    n++;
    lines.push("BEGIN:VEVENT", `UID:${a.id || "aset"}-${r.id}-${ymd(r.date)}@omahku`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(r.date)}`, `DTEND;VALUE=DATE:${ymd(addMonthsISO(r.date, 0).replace(/(\d+)-(\d+)-(\d+)/, (_, y, m, d) => iso(new Date(+y, +m - 1, +d + 1))))}`,
      `SUMMARY:${esc(what[r.id])}`, `DESCRIPTION:${esc("Pengingat dari Omahku. Jangan lupa diurus sebelum jatuh tempo.")}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(what[r.id])}`, "TRIGGER:-P6DT15H", "END:VALARM",
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(what[r.id])}`, "TRIGGER:-PT15H", "END:VALARM",
      "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return n ? lines.map(fold).join("\r\n") + "\r\n" : "";
}
