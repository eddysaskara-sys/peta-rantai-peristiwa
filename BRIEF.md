# BRIEF — Peta Rantai Peristiwa (versi final setelah ASK, 23 Okt 2026)

| Bagian | Isi |
|---|---|
| **Masalah** | Berita global dan lokal tersebar di banyak sumber dan lewat begitu saja karena kesibukan kerja. Rantai sebab-akibatnya (mis. konflik Laut Merah → harga minyak → inflasi → harga lokal) tidak pernah tercatat, sehingga tidak bisa dipakai untuk keputusan investasi, tulisan, atau diskusi. |
| **Pemakai** | **Pemilik:** meninjau di malam hari, maksimal 5 menit. **Teman pengamat global:** hanya melihat. |
| **Rangkuman 1 kalimat** | App ini adalah **peta rantai peristiwa** untuk **pemilik (dan teman pengamat global yang hanya melihat)** yang **setiap malam menyajikan 5 kaitan sebab-akibat global–lokal terpenting, mengikuti sektor yang sedang bergerak di pasar, untuk ditinjau dalam 5 menit.** |

## Fitur inti (5)
1. **Pengambilan berita otomatis** setiap hari pukul 17.30 WIB dari media besar nasional dan internasional. Setiap peristiwa menautkan sumbernya.
2. **AI menyusun peristiwa**: menggabungkan berita sejenis, memberi tingkat (global/lokal), kelompok sektor, dan **label ⚖️** bila media lokal dan internasional menyorot sudut berbeda.
3. **AI mengusulkan kaitan sebab-akibat, maksimal 5 per malam**, diurutkan menurut skor prioritas. Usulan yang belum ditinjau menumpuk dan bersaing lagi keesokan harinya. Pemilik menyetujui atau menolak dengan PIN.
4. **Tampilan rantai (layar utama)**: penyebab → peristiwa → dampak, bisa disaring per kelompok sektor.
5. **Perkiraan dampak dengan tanggal cek dan skor ketepatan** (layar kedua).

### Aturan prioritas (fitur 3)
1 poin per kriteria, skor 0–3:
- **Dampak ke Indonesia**: akibatnya peristiwa lokal, atau menyentuh rupiah, IHSG, atau BI Rate.
- **Menyambung rantai lama**: salah satu ujungnya sudah punya kaitan yang disetujui.
- **Sektor sedang bergerak tidak biasa** (lihat di bawah).

Bila skor sama: yang berdampak ke Indonesia, lalu keyakinan AI, lalu yang terbaru.
Batas 5 dihitung dari keputusan (setujui/tolak) per malam WIB; membatalkan keputusan mengembalikan slotnya.
Usulan yang peristiwanya lebih tua dari 30 hari dianggap sudah tergeser.

### "Sektor bergerak tidak biasa": hibrida
| Kelompok | Sektor rinci | Ukuran | Sumber |
|---|---|---|---|
| Pangan & Agribisnis | Pertanian, Perkebunan, Peternakan, Perikanan, Pangan | Lonjakan berita | API Panel Harga Bapanas tidak terbuka untuk publik |
| Energi | Energi, Minyak & Gas | Harga Brent | API Ninjas (perlu secret `API_NINJAS_KEY`) |
| Tambang & Mineral | Mineral & Pertambangan | Harga emas | gold-api.com, tanpa key |
| Industri & Konsumsi | Tekstil & Pakaian, Manufaktur & Industri, Properti & Konstruksi, Teknologi & Digital, Pariwisata, Kesehatan, Ketenagakerjaan | Lonjakan berita | Peristiwa yang sudah disusun |
| Keuangan & Moneter | Keuangan & Perbankan, Moneter, Fiskal & Kebijakan | Kurs USD/IDR | Frankfurter (kurs acuan ECB), tanpa key |
| Perdagangan & Logistik | Perdagangan & Logistik, Transportasi | Lonjakan berita | Peristiwa yang sudah disusun |

- **Harga**: perubahan harian terakhir dibanding simpangan baku 30 perubahan harian sebelumnya. "Tidak biasa" bila ≥ 1,5× gerak biasanya.
  Selama riwayat tersimpan < 10 hari, dipakai **pembanding sementara** (gerak harian lazim: Brent 2%, emas 1%, USD/IDR 0,4%) dan labelnya menyebut itu.
- **Lonjakan berita**: porsi peristiwa kelompok itu pada pembaruan terakhir dibanding rata-rata porsinya 7 hari sebelumnya; "lonjakan" bila ≥ 2 peristiwa dan ≥ 2× porsi biasa. Butuh minimal 3 hari pembaruan.
- Bila harga gagal diambil, basi (> 4 hari), atau riwayatnya belum cukup, kelompok itu sementara dinilai dari lonjakan berita, dan labelnya menjelaskan alasannya.
- Label "Geopolitik & Keamanan" dan "Iklim & Bencana" adalah pemicu lintas sektor dan tidak masuk kelompok mana pun.

## Non-goals
- Notifikasi ke HP atau email.
- Grafik harga real-time. Data harga hanya untuk prioritas; yang tampil hanya label.
- Login banyak pengguna. Penguji hanya melihat, pemilik memakai PIN.
- Pengaturan sumber berita atau kelompok sektor oleh pengguna.
- Model AI berbayar.
- Rekomendasi beli/jual.
- Harga harian nikel, timah, batu bara, CPO, dan IHSG.

## "Selesai" itu seperti apa
1. Setiap malam setelah 17.30 WIB tampil **maksimal 5 usulan kaitan**; setiap peristiwa punya link sumber, dan label ⚖️ bila relevan.
2. Setelah pemilik menyetujui satu usulan, **rantainya langsung tampil di layar utama**. Penguji tanpa PIN tidak bisa mengubah apa pun.
3. **Tinjauan satu malam ≤ 5 menit** (diukur dengan timer), dan setiap usulan menampilkan alasan prioritasnya.

## Hasil wawancara (fase ASK)
| # | Pertanyaan Claude | Jawaban | Dampak ke build |
|---|---|---|---|
| 1 | Kalau hanya 2 menit, mana yang harus jalan: rantai, atau perkiraan + skor? | Rantai | Rantai jadi layar utama |
| 2 | Berapa usulan realistis ditinjau dalam 5 menit? | 5 | Batas 5 per malam + urutan prioritas |
| 3 | Bila tidak dibuka satu malam, usulan diapakan? | Menumpuk | Usulan lama bersaing lagi besok |
| 4 | Apa arti "terpenting"? | Dampak ke Indonesia, rantai lama, sektor pantauan | Skor 1 poin per kriteria |
| 5 | Sektor mana yang dipantau? | *Balik bertanya:* kelompokkan, dan prioritas bergeser mengikuti pasar | 22 sektor → 6 kelompok, prioritas dinamis |
| 6 | Pergerakan pasar dari berita atau harga? | Harga | Riset API gratis |
| 7 | Hibrida harga + berita? | Setuju | 3 kelompok dari harga, 3 dari berita |
| 8 | Dua sisi pemberitaan? | Fitur inti, label ⚖️ | Digabung ke fitur 2 |
