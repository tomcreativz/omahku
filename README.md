# Omahku (versi Appwrite)

PWA bergaya **neobrutalism** untuk urusan rumah tangga suami & istri. Tanpa build, siap di-host di GitHub Pages.
Backend: **Appwrite Cloud** (login, database, realtime, undangan pasangan lewat Teams).

👉 **Mulai dari [`TUTORIAL.md`](TUTORIAL.md)** — panduan lengkap langkah demi langkah.

## Fitur

Beranda · Agenda · Tugas Rumah (berulang) · Daftar Belanja · Stok · Menu Dapur · Perawatan Rumah ·
Target Keluarga · Kontak Darurat (112/119/110/113/115 + kontak sendiri) · Riwayat Kesehatan ·
Pengaturan (undang pasangan, nama, password, cadangan JSON, pasang aplikasi).

## Ringkas

1. Buat proyek Appwrite → daftarkan Platform Web (`localhost` dan `USERNAME.github.io`).
2. Buat database `omahku` → tabel `records` → kolom `kind` (varchar 32) & `data` (text) → izin **Users: Create** + **Row security ON**.
3. Isi `js/config.js` (Endpoint, Project ID).
4. Unggah ke GitHub → aktifkan Pages.
5. Undang pasangan lewat email di **Pengaturan**.

## Struktur

```
index.html · manifest.webmanifest · sw.js
css/style.css          tema neobrutalism
js/config.js           Endpoint & Project ID  <-- isi ini
js/data.js             klien Appwrite, state, realtime, undangan
js/modules.js          definisi modul + form & daftar generik
js/pages.js            Beranda, Pengaturan, menu
js/app.js              login, onboarding, tautan email, router
vendor/appwrite.js     Appwrite Web SDK (self-hosted)
fonts/ icons/          Space Grotesk, ikon PWA
```
