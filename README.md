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
  dan sektor yang sedang bergerak tidak biasa. Maksimal 5 keputusan per malam; sisanya bersaing lagi besok.
- **6 kelompok sektor**. Pergerakan diukur hibrida: kurs USD/IDR (Frankfurter), emas (gold-api.com),
  Brent (API Ninjas), dan lonjakan berita untuk kelompok tanpa data harga. Gerak harga dibanding
  kebiasaan geraknya sendiri (30 hari); data harga tidak ditampilkan sebagai grafik.

- **Sumber berita:** RSS dari 7 media Indonesia (CNBC Indonesia, CNN Indonesia, Detik, Liputan6, Republika, Okezone, Antara) dan 4 media internasional (Al Jazeera, NPR, OilPrice, Investing.com). GDELT sempat dipakai tetapi ditolak dari jaringan Cloudflare, sehingga dinonaktifkan.
- **AI:** Cloudflare Workers AI, model utama `@cf/openai/gpt-oss-120b` dengan cadangan `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, dibatasi 40 panggilan per hari agar tetap dalam kuota gratis.
- **Data:** Cloudflare D1 `peta-rantai-db` (skema di `schema.sql`, sudah dibuat; perubahan skema di folder `migrations/`).

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
