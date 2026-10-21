# BRIEF — Peta Rantai Peristiwa (one-pager)

## Masalah yang diselesaikan
Saya ingin memahami kaitan peristiwa global dan lokal dari hari ke hari, untuk keputusan investasi pribadi,
bahan diskusi dan tulisan, pekerjaan, serta memahami dunia. Kenyataannya, berita tersebar di banyak sumber
(portal berita, X, YouTube, grup WhatsApp, laporan riset) dan **lewat begitu saja karena kesibukan kerja**.
Rantai sebab-akibat, misalnya konflik di Selat Hormuz/Laut Merah → harga minyak → inflasi global → harga lokal,
atau kekeringan → pasokan pangan → inflasi pangan pokok, tidak pernah tercatat dan mudah terlupa.

## Pengguna
- **Pemilik (saya):** meninjau di malam hari, maksimal 5 menit.
- **Penguji:** teman investor dan teman kuliah Magister Manajemen, hanya melihat.

## Fitur inti yang wajib ada
1. **Pengambilan berita otomatis** setiap hari pukul 17.30 WIB dari media besar Indonesia dan internasional.
2. **AI menyusun peristiwa**: menggabungkan berita sejenis, memberi tingkat (global/lokal), sektor, dan indikator pasar.
3. **AI mengusulkan kaitan sebab-akibat**, tetapi **pemilik yang memutuskan** (setujui/tolak).
4. **Tampilan rantai**: penyebab → peristiwa → dampak, beberapa langkah ke atas dan ke bawah.
5. **Tampilan per sektor** (pertanian, perkebunan, peternakan, pertambangan, pangan, pakaian, energi, mineral, dll.).
6. **Dua sisi pemberitaan**: bila media lokal dan internasional menyorot sudut berbeda.
7. **Perkiraan dampak + tanggal cek**, lalu skor ketepatan.
8. **Sumber selalu ditautkan** agar setiap klaim bisa dicek.

## Hal yang sengaja belum dibuat
- Notifikasi ke HP atau email.
- Grafik harga pasar real-time (rupiah, IHSG, emas, minyak).
- Login untuk banyak pengguna; penguji cukup melihat, pemilik memakai PIN.
- Pengaturan sumber berita oleh pengguna; daftar sumber masih ditetapkan di kode.
- Model AI berbayar yang lebih kuat; prototipe memakai kuota gratis Workers AI.

## Hasil wawancara (fase ASK)
| Pertanyaan Claude | Jawaban saya |
|---|---|
| Jam berapa paling mungkin membuka aplikasi untuk meninjau? | Malam. |
| Tema pantauan apa saja? | Ditambah, dan ditampilkan **per sektor**: pertanian, perkebunan, peternakan, pertambangan, pangan, pakaian, energi, mineral, dll. |
| Sumber berita mana yang dipercaya? | Semua media bernama besar, **termasuk internasional**, agar bisa menimbang dari dua sisi. |
| Penguji boleh ikut menyetujui kaitan? | Tidak, **hanya melihat**. |

**Yang berubah setelah wawancara:** rencana awal hanya memantau beberapa tema (minyak, pangan, moneter, rupiah, emas, IHSG).
Setelah wawancara, aplikasi ditambah **tampilan per sektor (22 sektor)**, sumber diperluas ke media internasional
dengan penanda **"dua sisi pemberitaan"**, jadwal pembaruan disetel **17.30 WIB** agar siap ditinjau malam,
dan penguji dibuat **baca saja** dengan PIN untuk pemilik.
