// ============================================================
// KONFIGURASI — isi dengan data dari proyek Appwrite Anda
// (lihat TUTORIAL.md langkah 3–6). Semua nilai ini AMAN untuk publik;
// keamanan data dijaga oleh izin (permissions) di Appwrite.
// JANGAN pernah menaruh API key server di sini.
// ============================================================
export const CONFIG = {
  APP_NAME: "Omahku",

  // Appwrite Console > Overview > "API Endpoint" (sudah termasuk /v1).
  // Contoh: "https://sgp.cloud.appwrite.io/v1"  atau  "https://cloud.appwrite.io/v1"
  ENDPOINT: "https://GANTI-DENGAN-REGION.cloud.appwrite.io/v1",

  // Appwrite Console > Settings > Project ID
  PROJECT_ID: "GANTI-DENGAN-PROJECT-ID",

  // ID database & tabel yang Anda buat (disarankan persis seperti ini)
  DATABASE_ID: "omahku",
  TABLE_ID: "records",

  // Jumlah maksimal anggota rumah tangga (suami + istri = 2)
  MAX_MEMBERS: 2,
};
