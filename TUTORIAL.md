# Tutorial lengkap: Omahku + Appwrite + GitHub Pages

Panduan dari nol sampai suami dan istri bisa memakai aplikasi di HP masing-masing.
Perkiraan waktu: **30–45 menit**. Tidak perlu menulis kode; Anda hanya menyalin beberapa nilai ke satu file.

---

## 0. Baca ini dulu (penting)

**Batas paket gratis Appwrite Cloud** (diverifikasi dari situs Appwrite, Nov 2026):

| Hal | Paket Free |
|---|---|
| Jumlah proyek | maksimal **2** |
| **Proyek di-pause** | **setelah 1 minggu tanpa aktivitas** |
| Pengguna aktif / bulan | 75.000 |
| Bandwidth | 5 GB / bulan |
| Database per proyek | 1 |

Artinya:

- Aturan pause dan batas 2 proyek **sama** dengan Supabase gratis. Jika limit di Supabase Anda sebelumnya adalah "proyek ter-pause" atau "batas jumlah proyek", Appwrite tidak menghilangkan masalah itu. Aplikasi yang dibuka tiap hari **tidak akan** ter-pause.
- Kalau proyek ter-pause: buka Console → proyek → klik **Restore/Resume**. Data tidak hilang.
- Kebutuhan Omahku (2 orang, data teks) jauh di bawah kuota bandwidth dan pengguna.
- Biasakan unduh cadangan: **Pengaturan → Unduh cadangan data (JSON)** (sebulan sekali cukup).

**Perbedaan dengan versi Supabase:**

- Tidak ada "kode undangan". Pasangan diundang **lewat email** (fitur *Teams* bawaan Appwrite). Pasangan tidak perlu mendaftar dulu: ia klik tautan di email, membuat password, lalu langsung masuk.
- Password minimal **8 karakter** (aturan Appwrite).
- Semua data disimpan di **satu tabel** bernama `records`, jadi Anda hanya perlu membuat 2 kolom (tidak perlu membuat 9 tabel).

---

## 1. Yang perlu disiapkan

1. Akun **GitHub** (gratis) → <https://github.com>
2. Akun **Appwrite Cloud** (gratis) → <https://cloud.appwrite.io>
3. Folder proyek ini (hasil ekstrak ZIP).
4. Alamat email untuk suami dan istri (masing-masing satu).

---

## 2. Buat proyek di Appwrite

1. Masuk ke <https://cloud.appwrite.io> → **Create project**.
2. Nama: `Omahku`. Pilih **Region** terdekat (mis. Singapore jika tersedia; jika tidak, pilih yang terdekat).
3. Setelah proyek terbuka, catat dua nilai:
   - **Project ID**: menu **Settings** → *Project ID* (tombol salin).
   - **API Endpoint**: di halaman **Overview** (contoh: `https://sgp.cloud.appwrite.io/v1`). Salin **lengkap sampai `/v1`**.

> Simpan keduanya di Notepad dulu. Dipakai di langkah 6.

---

## 3. Daftarkan alamat situs (Platform Web)

Appwrite hanya mau melayani situs yang sudah didaftarkan (aturan keamanan CORS). Tanpa langkah ini muncul error *"Failed to fetch"* atau *CORS*.

1. Di proyek Anda, buka menu **Apps** (pada versi Console lama: **Overview → Integrations → Platforms**).
2. Klik **Add app** / **Add platform** → pilih **Web**.
3. Isi **Hostname** (tanpa `https://`, tanpa garis miring, tanpa port):
   - Untuk tes di komputer: `localhost`
   - Untuk GitHub Pages: `USERNAME.github.io` (ganti dengan username GitHub Anda, huruf kecil semua)
4. Tambahkan **satu platform per hostname** (jadi dua platform: `localhost` dan `USERNAME.github.io`).

> Hostname inilah yang dipakai Appwrite untuk memvalidasi tautan di email undangan dan email reset password. Jika salah, pengiriman undangan gagal dengan pesan *"Invalid url param: URL host must be either localhost or a registered platform"*.

---

## 4. Pengaturan Auth

1. Menu **Auth → Settings**.
2. Pastikan metode **Email/Password** aktif (biasanya sudah aktif).
3. Cari bagian **Memberships privacy** (privasi keanggotaan). Pastikan **User name** dan **User email** **diaktifkan (tampil)**. Omahku memakai nama dan email untuk menampilkan anggota rumah.
4. (Opsional) **Password dictionary / Personal data**: boleh dibiarkan mati. Jika Anda aktifkan, password yang terlalu umum akan ditolak.

Email undangan dan reset password dikirim oleh Appwrite Cloud secara otomatis. Kadang masuk **folder spam**; ini normal untuk pengirim baru.

---

## 5. Buat database dan tabel

### 5a. Database

1. Menu **Databases → Create database**.
2. Pilih tipe **TablesDB**.
3. **Name**: `Omahku`.
4. **Database ID**: klik ikon pensil/edit pada ID, lalu isi **`omahku`** (huruf kecil). Klik **Create**.

### 5b. Tabel

1. Di dalam database, klik **Create table**.
2. **Name**: `records`. **Table ID**: ubah menjadi **`records`**. Klik **Create**.

### 5c. Kolom (hanya 2)

Buka tab **Columns** → **Create column**:

| Key (persis) | Tipe | Ukuran | Required |
|---|---|---|---|
| `kind` | **Varchar** (jika tidak ada: *String*) | `32` | ✅ ya |
| `data` | **Text** (jika tidak ada: *String*) | tipe Text tidak memakai ukuran; jika memakai *String* isi `16000` | ✅ ya |

Tunggu sampai status kedua kolom **Available** (beberapa detik).

> Omahku menaruh isi catatan dalam bentuk JSON di kolom `data`. Satu catatan maksimal ± 15.000 karakter. Itu sangat longgar untuk catatan keluarga; jika terlewati, aplikasi menampilkan pesan yang jelas.

### 5d. Izin (INI LANGKAH KEAMANAN TERPENTING)

Buka tab **Settings** pada tabel `records`:

1. **Permissions → Add role → Users** (artinya: pengguna yang sudah login). Centang **hanya `Create`**. Jangan centang Read/Update/Delete di tingkat tabel. Jangan menambahkan role **Any**.
2. **Row security**: **aktifkan** (toggle ON).
3. Klik **Update/Save**.

Hasilnya: setiap pengguna login boleh *membuat* baris, dan aplikasi memberi tiap baris izin baca/ubah/hapus **hanya untuk anggota Team (rumah tangga) Anda**. Orang lain, walau punya akun di proyek yang sama, tidak bisa melihat data Anda.

---

## 6. Isi konfigurasi aplikasi

Buka `js/config.js` dengan Notepad/VS Code dan ganti 2 nilai:

```js
ENDPOINT: "https://sgp.cloud.appwrite.io/v1",   // dari langkah 2 (lengkap sampai /v1)
PROJECT_ID: "65f1a2b3c4d5e6f7a8b9",              // dari langkah 2
DATABASE_ID: "omahku",                           // dari langkah 5a
TABLE_ID: "records",                             // dari langkah 5b
```

Semua nilai ini boleh publik. **Jangan** pernah menaruh *API key* Appwrite di sini.

---

## 7. Coba di komputer (opsional tapi disarankan)

Di folder proyek, buka terminal:

```bash
python3 -m http.server 8080
```

(Windows tanpa Python: gunakan ekstensi **Live Server** di VS Code.) Lalu buka <http://localhost:8080>.

Uji dengan urutan ini:

1. **Daftar** dengan email Anda (password ≥ 8 karakter).
2. **Buat rumah baru** (nama rumah + nama panggilan).
3. Tambahkan satu agenda → pastikan muncul di Beranda.
4. Buka **Pengaturan → Undang pasangan**, masukkan email pasangan → pesan "Undangan terkirim".

Jika langkah 1 gagal dengan "Failed to fetch": ulangi langkah 3 (platform `localhost`).
Jika langkah 3 gagal dengan "user_unauthorized" / "not authorized": ulangi langkah 5d.

---

## 8. Tayangkan di GitHub Pages

1. Di GitHub: **New repository** → nama `omahku` → **Public** (GitHub Pages gratis memerlukan repo publik, kecuali Anda memakai paket berbayar) → **Create**.
2. Klik **uploading an existing file** → seret **seluruh isi folder proyek** (pastikan `index.html` ada di akar repo, termasuk folder `js`, `css`, `vendor`, `fonts`, `icons`, dan file `.nojekyll`) → **Commit changes**.
3. **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**.
4. Tunggu 1–2 menit. Alamatnya: `https://USERNAME.github.io/omahku/`.
5. **Pastikan** hostname `USERNAME.github.io` sudah didaftarkan di langkah 3.

> Karena repo publik, file `js/config.js` terlihat orang lain. Itu aman: isinya hanya Endpoint dan Project ID. Data dilindungi izin pada langkah 5d dan login.

---

## 9. Mengundang pasangan

Dilakukan oleh yang **membuat rumah** (pemilik):

1. Buka aplikasi → **Pengaturan → Undang pasangan**.
2. Isi **email pasangan** dan (opsional) nama panggilannya → **Kirim undangan**.
3. Pasangan membuka **email dari Appwrite** di HP/komputernya sendiri (cek *spam* bila perlu) → klik tautan → aplikasi terbuka dan meminta **membuat password** → selesai, langsung masuk ke rumah yang sama.
4. Di **Pengaturan → Anggota**, undangan yang belum diterima ditandai "menunggu diterima" dan bisa **Batalkan**. Tekan **Segarkan** setelah pasangan bergabung.

Catatan:

- Pasangan **tidak perlu** mendaftar atau membuat rumah sendiri. Jika sudah terlanjur mendaftar dengan email itu, tidak masalah; tautan tetap berfungsi.
- Pasangan harus membuka tautan di **perangkatnya sendiri**. Jika tautan dibuka di browser yang sedang login sebagai akun Anda, aplikasi otomatis keluar dari akun itu terlebih dulu.
- Tautan kedaluwarsa atau tidak valid → **Batalkan** undangan, lalu kirim ulang.
- Batas anggota: 2 (ubah `MAX_MEMBERS` di `js/config.js`). Batas ini ditegakkan oleh aplikasi, bukan oleh Appwrite.

---

## 10. Pasang sebagai aplikasi (PWA)

- **Android / Chrome**: menu ⋮ → **Instal aplikasi** (atau tombol di Pengaturan).
- **iPhone / iPad**: Safari → tombol **Bagikan** → **Tambah ke Layar Utama**.
- **Komputer (Chrome/Edge)**: ikon instal di kolom alamat.

Aplikasi akan punya ikon sendiri dan terbuka layar penuh. Tampilannya tersedia offline, tetapi data tetap membutuhkan internet.

---

## 11. Cara kerja keamanan (singkat)

- **Rumah tangga = Team Appwrite.** Pembuat rumah otomatis menjadi *owner* dan satu-satunya yang boleh mengundang/menghapus anggota.
- Setiap catatan disimpan dengan izin `Role.team(<id rumah>)`. Hanya anggota Team yang bisa baca/ubah/hapus.
- Tabel hanya mengizinkan **Create** untuk pengguna login; tidak ada izin baca di tingkat tabel.
- **Uji keamanan 2 menit:** daftar akun ketiga dengan email lain di jendela penyamaran. Akun itu harus melihat halaman "Buat rumah" yang kosong, tanpa data Anda.
- Riwayat kesehatan bersifat sensitif; suami dan istri sama-sama bisa melihatnya.
- Jika dua orang mengubah **catatan yang sama** pada detik yang sama, perubahan yang terakhir tersimpan menimpa yang sebelumnya (cukup untuk pemakaian keluarga).

---

## 12. Pemeliharaan

| Kebutuhan | Cara |
|---|---|
| Proyek ter-pause | Console → proyek → **Restore**; buka aplikasi minimal seminggu sekali |
| Cadangan data | **Pengaturan → Unduh cadangan data (JSON)** |
| Memperbarui aplikasi | Ganti file di repo, lalu naikkan `VERSION` di `sw.js` (mis. `v2`) agar cache lama diganti |
| Ganti nama rumah / nama panggilan | **Pengaturan** |
| Lupa password | Layar login → **Lupa password?** → ikuti email |
| Naik kelas | Appwrite Pro dimulai $25/bulan (tidak pernah di-pause); biasanya tak diperlukan |

---

## 13. Pemecahan masalah

| Gejala | Penyebab & solusi |
|---|---|
| "Failed to fetch" / error CORS | Hostname belum didaftarkan sebagai Platform Web (langkah 3). Tulis tanpa `https://` dan tanpa path |
| Layar "Gagal memuat data" | Cek `ENDPOINT` (harus berakhir `/v1`), `PROJECT_ID`, `DATABASE_ID`, `TABLE_ID` di `js/config.js`; pastikan kolom `kind` & `data` berstatus *Available* |
| "The current user is not authorized" saat menyimpan | Izin tabel: role **Users → Create** belum ada, atau **Row security** belum aktif (langkah 5d) |
| "Invalid document structure / Missing required attribute" | Nama kolom salah ketik. Harus persis `kind` dan `data` (huruf kecil) |
| Undangan tidak sampai | Cek folder spam. Pastikan email benar. Batalkan lalu kirim ulang. Pastikan hostname situs terdaftar |
| "URL host must be either localhost or a registered platform" | Platform untuk alamat situs yang sedang dipakai belum ditambahkan |
| Pasangan melihat halaman "Buat rumah" | Ia mendaftar sendiri tanpa membuka tautan undangan. Minta ia keluar, lalu kirim undangan ke email yang ia pakai mendaftar dan klik tautannya |
| "Password minimal 8 karakter" | Aturan Appwrite |
| Berhenti sinkron | Tutup dan buka lagi aplikasi (otomatis memuat ulang). Pastikan proyek tidak ter-pause |
| "Catatan terlalu panjang" | Satu catatan maksimal ± 15.000 karakter; pecah menjadi beberapa catatan |
| Tampilan lama setelah update | Naikkan `VERSION` di `sw.js`, lalu muat ulang dua kali |
| Login terlepas sendiri di Safari/iPhone | Aplikasi memakai penyimpanan cadangan Appwrite; pastikan "Cegah pelacakan lintas situs" tidak memblokir penyimpanan situs. Memasang ke Layar Utama biasanya membantu |

---

## 14. Daftar periksa akhir

- [ ] Platform Web: `localhost` dan `USERNAME.github.io`
- [ ] Database `omahku`, tabel `records`, kolom `kind` dan `data` (keduanya Available)
- [ ] Tabel: Users → **Create** saja, **Row security ON**
- [ ] `js/config.js` terisi (Endpoint berakhir `/v1`)
- [ ] Repo GitHub publik, GitHub Pages aktif
- [ ] Daftar → buat rumah → tambah agenda berhasil
- [ ] Undangan sampai ke email pasangan, ia bisa masuk
- [ ] Perubahan satu orang muncul di HP yang lain
- [ ] Akun ketiga tidak bisa melihat data

---

## Catatan kejujuran

Kode ini sudah diuji secara otomatis terhadap **Appwrite tiruan** (login, buat rumah, undangan, reset password, pagination 230+ data, realtime) dan alur undangan dicocokkan dengan kode sumber server Appwrite. Namun belum diuji terhadap proyek Appwrite sungguhan. Nama menu Console dapat sedikit berbeda dari tutorial ini karena Appwrite sering memperbarui tampilannya; padanan fungsinya sama. Bila ada langkah yang tidak cocok, kirim tangkapan layarnya.

## Sumber

- Batas paket Free, pause 1 minggu, 2 proyek: <https://appwrite.io/docs/advanced/billing/free> dan <https://new.appwrite.io/pricing>
- Teams dan undangan email: <https://appwrite.io/docs/products/auth/teams> dan <https://appwrite.io/docs/products/auth/team-invites>
- Izin berbasis Team pada baris tabel: <https://appwrite.io/docs/advanced/platform/permissions>
- Tipe kolom teks (varchar/text): <https://appwrite.io/blog/post/new-string-types>
- Platform Web dan CORS: <https://appwrite.io/blog/post/cors-error>
