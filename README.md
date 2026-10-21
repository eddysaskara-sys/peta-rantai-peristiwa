# Peta Rantai Peristiwa

Aplikasi web pribadi untuk melihat **kaitan sebab-akibat antara peristiwa global dan lokal**.
Setiap sore aplikasi mengambil berita dari media Indonesia dan internasional, lalu Workers AI
menyusunnya menjadi peristiwa per sektor dan **mengusulkan** kaitannya. Pemilik meninjau
di malam hari: menyetujui atau menolak usulan. Penguji hanya bisa melihat.

Final project Mini Bootcamp *Claude for Non-Tech Professional* (MBCL Cohort 3).

## Cara kerja

```
17.30 WIB (otomatis)                     Malam (pemilik, ≤ 5 menit)
GDELT + RSS  ──►  Workers AI  ──►  D1  ──►  Tinjau: setujui / tolak kaitan
(lokal & intl)   (peristiwa +           ──►  Rantai, Linimasa, Sektor, Perkiraan
                  usulan kaitan)              (terbuka untuk penguji, baca saja)
```

- **Sumber berita:** GDELT DOC 2.0 API (gratis, tanpa key) dan RSS CNBC Indonesia, Antara, Al Jazeera.
- **AI:** Cloudflare Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`), dibatasi 30 panggilan per hari agar tetap dalam kuota gratis.
- **Data:** Cloudflare D1 `peta-rantai-db` (skema di `schema.sql`, sudah dibuat).

## Deploy pertama kali (sekali saja, ± 5 menit)

1. Buka **dash.cloudflare.com → Workers & Pages → Create application**.
2. Pilih **Import a repository**, sambungkan GitHub bila diminta, lalu pilih repo `peta-rantai-peristiwa`.
3. Pastikan **Project name** = `peta-rantai-peristiwa` (harus sama dengan `name` di `wrangler.toml`).
   Biarkan *Build command* kosong dan *Deploy command* `npx wrangler deploy`. Klik **Create and deploy**.
4. Setelah selesai, buka **Settings → Variables and Secrets → Add**:
   - Type: **Secret**
   - Variable name: `ADMIN_PIN`
   - Value: PIN pilihan Anda (minimal 6 karakter, jangan dibagikan)
   Klik **Deploy**.
5. Buka alamat `https://peta-rantai-peristiwa.<subdomain-anda>.workers.dev`,
   klik **Masuk sebagai pemilik**, masukkan PIN, lalu di **Tinjau** pilih *7 hari terakhir* dan **Ambil berita sekarang**.

Setelah itu setiap perubahan kode yang di-push ke GitHub otomatis tayang.

## Menguji di komputer

Tes otomatis memakai database dan AI tiruan, jadi tidak membutuhkan akun Cloudflare.
`npx wrangler deploy --dry-run` memeriksa konfigurasi tanpa men-deploy.
