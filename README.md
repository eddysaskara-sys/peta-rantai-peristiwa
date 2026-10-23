# Peta Rantai Peristiwa

Aplikasi web pribadi untuk melihat **kaitan sebab-akibat antara peristiwa global dan lokal**.
Setiap sore aplikasi mengambil berita dari media Indonesia dan internasional, lalu Workers AI
menyusunnya menjadi peristiwa per sektor dan **mengusulkan** kaitannya. Pemilik meninjau
di malam hari: menyetujui atau menolak usulan. Penguji hanya bisa melihat.

Final project Mini Bootcamp *Claude for Non-Tech Professional* (MBCL Cohort 3).

## Cara kerja

```
17.30 WIB (otomatis)                              Malam (pemilik, ≤ 5 menit)
Harga pasar (kurs, emas, Brent) ─┐
RSS 12 feed ──► Workers AI ──────┴─► D1 ──► Tinjau: maks 5 usulan per malam,
(lokal & intl)  (peristiwa +                 diurutkan skor prioritas (0–3)
                 usulan kaitan)       ──► Rantai (layar utama), Linimasa, Sektor, Perkiraan
                                          (terbuka untuk penguji, baca saja)
```

Spesifikasi lengkap ada di `BRIEF.md`. Ringkasnya:
- **Prioritas tinjauan** (1 poin per kriteria): berdampak ke Indonesia, menyambung rantai lama,
  sebab dari tanggal lebih awal (≥ 7 hari), dan sektor yang sedang bergerak tidak biasa. Maksimal 15 keputusan per malam; sisanya bersaing lagi besok.
- **Cari kaitan terbesar:** sekali sehari (dan atas permintaan pemilik) AI memindai semua peristiwa 60 hari terakhir untuk mencari
  kaitan sebab-akibat terkuat yang belum tercatat, termasuk penyebab dari beberapa minggu sebelumnya; hasilnya masuk antrean tinjauan.
- **6 kelompok sektor**. Pergerakan diukur hibrida: kurs USD/IDR (Frankfurter), emas (gold-api.com),
  Brent (API Ninjas), dan lonjakan berita untuk kelompok tanpa data harga. Gerak harga dibanding
  kebiasaan geraknya sendiri (30 hari); data harga tidak ditampilkan sebagai grafik.

- **Sumber berita:** 12 feed RSS media Indonesia dan 12 feed media internasional (daftar di `src/constants.js`),
  ditambah 12 topik pencarian **Google News RSS** (6 edisi Indonesia, 6 edisi internasional) yang menjangkau puluhan
  media lain. Judul dipilih **bergiliran per media** agar media yang sangat sering menulis tidak menenggelamkan yang lain.
  GDELT sempat dipakai tetapi ditolak dari jaringan Cloudflare, sehingga dinonaktifkan.
  Tombol **Cek sumber berita** di Tinjau memeriksa semua sumber dari Cloudflare tanpa memakai kuota AI.
- **Data harga:** kurs USD/IDR (Frankfurter, dengan riwayat), emas (gold-api.com), Brent (API Ninjas untuk harga terakhir,
  ditambah riwayat harian **FRED/EIA** tanpa key untuk pembanding 30 hari dan bukti perkiraan).
- **AI:** Cloudflare Workers AI, model utama `@cf/openai/gpt-oss-120b` dengan cadangan `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, dibatasi 40 panggilan per hari agar tetap dalam kuota gratis.
- **Data:** Cloudflare D1 `peta-rantai-db` (skema di `schema.sql`, sudah dibuat; perubahan skema di folder `migrations/`,
  dijalankan di D1 produksi sebelum kode yang membutuhkannya di-push).

## Fitur dari masukan pengguna (23 Okt 2026)

- **Panduan:** tab baru dengan dua versi bahasa sederhana, untuk pengunjung (tanpa PIN) dan untuk pemilik (dengan PIN).
  Pengunjung baru melihat ajakan membuka Panduan di layar Rantai.
- **Perkiraan dikelompokkan** per 6 kelompok sektor (+ Lintas sektor). Kelompok ditentukan otomatis dari **teks perkiraan**
  (mis. perkiraan tentang rupiah masuk Keuangan & Moneter), jadi perkiraan baru langsung masuk kelompoknya. Saringan:
  Perlu keputusan, Menunggu, Selesai. Perkiraan yang sama tidak bisa tercatat dua kali; pemilik bisa menghapus.
- **Pengecekan semi-otomatis:** AI mengumpulkan bukti (berita tersimpan, pencarian Google News sejak tanggal peristiwa,
  perubahan harga terkait) lalu memberi **saran** terjadi / tidak / belum, dengan alasan dan tautan bukti. Status akhir
  hanya berubah bila pemilik menyetujui atau memutuskan sendiri (tombol **Cek sendiri ↗** untuk pengecekan paralel).
  Aplikasi mencatat seberapa sering saran AI sependapat dengan keputusan pemilik. Pengecekan berjalan tiap 5 menit
  (saat jatuh tempo, mingguan, atau saat pemilik menekan **Minta saran AI**) dan menyisakan 8 panggilan AI per hari
  untuk pembaruan harian.
- **Isi riwayat:** pemilik memilih tanggal mulai (mis. 1 Okt 2026); berita lampau diambil dari Google News per jendela
  4 hari, disusun menjadi peristiwa, diusulkan kaitannya (antrean **Usulan dari riwayat**, tidak memakai jatah 5 per
  malam, bisa tersambung ke rantai yang sudah ada), dan beberapa hipotesis dampaknya dicatat sebagai **contoh perkiraan**
  yang dicek semi-otomatis setelah semua jendela selesai.
  Usulan riwayat ditinjau lewat daftar centang **Setujui sekaligus** (yang keyakinan AI ≥ 60% sudah tercentang);
  kaitan yang disetujui langsung masuk Rantai.

## Alamat aplikasi

`https://peta-rantai-peristiwa.eddysaskara.workers.dev`

Alamat `*.workers.dev` tidak bisa dibuka dari sebagian jaringan internet di Indonesia. Dua jalan keluar,
keduanya tetap di Cloudflare:
- **Gratis:** aktifkan DNS Cloudflare di perangkat (Chrome: *Settings → Privacy and security → Security →
  Use secure DNS → Cloudflare (1.1.1.1)*), atau pasang aplikasi **1.1.1.1 / WARP**.
- **Paling andal untuk penguji:** domain sendiri dari Cloudflare Registrar, lalu
  *Workers → peta-rantai-peristiwa → Settings → Domains & Routes → Add → Custom domain*.

## Deploy Cloudflare Worker (sekali saja, ± 5 menit)

1. Buka **dash.cloudflare.com → Workers & Pages → Create application**.
2. Pilih **Import a repository**, sambungkan GitHub bila diminta, lalu pilih repo `peta-rantai-peristiwa`.
3. Pastikan **Project name** = `peta-rantai-peristiwa` (harus sama dengan `name` di `wrangler.toml`).
   Biarkan *Build command* kosong dan *Deploy command* `npx wrangler deploy`. Klik **Create and deploy**.
4. Setelah selesai, buka **Settings → Variables and Secrets → Add**
   (bagian runtime, **bukan** "Build → Variables and secrets"):
   - Type: **Secret**
   - Variable name: `ADMIN_PIN`
   - Value: PIN pilihan Anda (minimal 6 karakter, jangan dibagikan)
   Klik **Deploy**.
   Opsional, untuk harga Brent (kelompok Energi): daftar gratis di api-ninjas.com, lalu tambahkan
   secret `API_NINJAS_KEY` dengan cara yang sama. Tanpa key ini, Energi dinilai dari lonjakan berita.
5. Buka alamat aplikasi, klik **Masuk sebagai pemilik**, masukkan PIN, lalu di **Tinjau** pilih
   *7 hari terakhir* dan **Ambil berita sekarang**. Permintaan masuk antrean dan diproses Cloudflare
   paling lambat 5 menit kemudian (jadwal `*/5 * * * *`).

Setelah itu setiap perubahan kode yang di-push ke GitHub otomatis tayang.

## Menguji di komputer

Tes otomatis memakai database dan AI tiruan, jadi tidak membutuhkan akun Cloudflare.
`npx wrangler deploy --dry-run` memeriksa konfigurasi tanpa men-deploy.
