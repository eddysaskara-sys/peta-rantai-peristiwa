// Model utama lebih kuat dalam mengikuti instruksi; model cadangan dipakai bila gagal.
export const MODEL = '@cf/openai/gpt-oss-120b';
export const FALLBACK_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// Batas panggilan AI per hari agar tetap di dalam kuota gratis Workers AI.
export const AI_DAILY_LIMIT = 40;

export const SEKTOR = [
  'Energi',
  'Minyak & Gas',
  'Mineral & Pertambangan',
  'Pertanian',
  'Perkebunan',
  'Peternakan',
  'Perikanan',
  'Pangan',
  'Tekstil & Pakaian',
  'Manufaktur & Industri',
  'Keuangan & Perbankan',
  'Moneter',
  'Fiskal & Kebijakan',
  'Perdagangan & Logistik',
  'Properti & Konstruksi',
  'Teknologi & Digital',
  'Transportasi',
  'Pariwisata',
  'Kesehatan',
  'Ketenagakerjaan',
  'Geopolitik & Keamanan',
  'Iklim & Bencana',
];

export const INDIKATOR = [
  'Rupiah',
  'IHSG',
  'Emas',
  'Harga Minyak',
  'BI Rate',
  'Suku Bunga The Fed',
  'Inflasi',
  'Harga Pangan',
  'Harga Komoditas',
  'Obligasi & Yield',
];

export const JENIS = ['menyebabkan', 'memperkuat', 'meredam', 'memicu respons'];

// ---------- 6 kelompok sektor (BRIEF final, 23 Okt 2026) ----------
// Label sektor rinci tetap disimpan di peristiwa; kelompok diturunkan darinya.
// "harga": kode seri harga yang dipakai untuk mengukur pergerakan pasar kelompok itu.
//          null = kelompok dinilai dari lonjakan berita.
export const KELOMPOK = [
  { id: 'pangan', nama: 'Pangan & Agribisnis', sektor: ['Pertanian', 'Perkebunan', 'Peternakan', 'Perikanan', 'Pangan'], harga: null,
    catatan: 'API harian Panel Harga Badan Pangan Nasional tidak terbuka untuk publik, jadi dinilai dari lonjakan berita.' },
  { id: 'energi', nama: 'Energi', sektor: ['Energi', 'Minyak & Gas'], harga: 'BRENT' },
  { id: 'tambang', nama: 'Tambang & Mineral', sektor: ['Mineral & Pertambangan'], harga: 'XAU' },
  { id: 'industri', nama: 'Industri & Konsumsi', sektor: ['Tekstil & Pakaian', 'Manufaktur & Industri', 'Properti & Konstruksi', 'Teknologi & Digital', 'Pariwisata', 'Kesehatan', 'Ketenagakerjaan'], harga: null },
  { id: 'keuangan', nama: 'Keuangan & Moneter', sektor: ['Keuangan & Perbankan', 'Moneter', 'Fiskal & Kebijakan'], harga: 'USDIDR' },
  { id: 'dagang', nama: 'Perdagangan & Logistik', sektor: ['Perdagangan & Logistik', 'Transportasi'], harga: null },
];
// Label yang menjadi pemicu lintas sektor, tidak masuk kelompok mana pun.
export const LINTAS_SEKTOR = ['Geopolitik & Keamanan', 'Iklim & Bencana'];

// Seri harga. "prior" = besar gerak harian yang lazim (%), dipakai sebagai pembanding
// sementara selama riwayat harga yang tersimpan belum mencapai MIN_RIWAYAT hari.
export const SERI_HARGA = {
  BRENT: { nama: 'Brent', sumber: 'API Ninjas', prior: 2.0 },
  XAU: { nama: 'Emas', sumber: 'gold-api.com', prior: 1.0 },
  USDIDR: { nama: 'USD/IDR', sumber: 'Frankfurter (kurs acuan ECB)', prior: 0.4 },
};
export const MIN_RIWAYAT = 10; // jumlah perubahan harian minimum untuk pembanding 30 hari
export const Z_BERGERAK = 1.5; // gerak hari ini >= 1,5x gerak biasanya = "tidak biasa"
export const HARGA_BASI_HARI = 4; // data harga lebih tua dari ini dianggap tidak tersedia
export const BERITA_MIN = 2; // lonjakan berita: minimal 2 peristiwa di kelompok itu
export const BERITA_RASIO = 2; // dan porsinya >= 2x rata-rata 7 hari sebelumnya

// ---------- Prioritas tinjauan ----------
export const MAKS_TINJAU = 5; // usulan kaitan per malam
export const HARI_KOLAM = 30; // usulan yang peristiwanya lebih tua dari ini sudah tergeser
// Indikator yang menandakan rantai sudah sampai ke Indonesia.
export const INDIKATOR_INDONESIA = ['Rupiah', 'IHSG', 'BI Rate'];

// GDELT dinonaktifkan: dalam uji 21 Okt 2026 semua kueri dari Cloudflare ditolak
// ("limit requests to one every 5 seconds") karena alamat IP Cloudflare dipakai bersama.
// Kode pengambilnya tetap ada; isi daftar ini untuk mengaktifkannya kembali.
export const GDELT_QUERIES = [];

// 12 feed pertama sudah dicek aktif pada 21 Okt 2026. Feed tambahan diperiksa dari Cloudflare lewat
// "Cek sumber berita" pada 23 Okt 2026: semuanya aktif (suara.com 404 dan mining.com 403 sudah dibuang).
// Feed yang gagal hanya dicatat, tidak menghentikan proses.
// "label" membedakan beberapa feed dari media yang sama di catatan pembaruan.
export const RSS_FEEDS = [
  // Media Indonesia
  { url: 'https://www.cnbcindonesia.com/news/rss', source: 'cnbcindonesia.com', label: 'CNBC Indonesia news', origin: 'lokal' },
  { url: 'https://www.cnbcindonesia.com/market/rss', source: 'cnbcindonesia.com', label: 'CNBC Indonesia market', origin: 'lokal' },
  { url: 'https://www.cnnindonesia.com/ekonomi/rss', source: 'cnnindonesia.com', label: 'CNN Indonesia ekonomi', origin: 'lokal' },
  { url: 'https://finance.detik.com/rss', source: 'detik.com', origin: 'lokal' },
  { url: 'https://feed.liputan6.com/rss/bisnis', source: 'liputan6.com', origin: 'lokal' },
  { url: 'https://www.republika.co.id/rss/ekonomi', source: 'republika.co.id', origin: 'lokal' },
  { url: 'https://sindikasi.okezone.com/index.php/rss/11/RSS2.0', source: 'okezone.com', origin: 'lokal' },
  { url: 'https://www.antaranews.com/rss/terkini.xml', source: 'antaranews.com', label: 'Antara terkini', origin: 'lokal' },
  // Media Indonesia (tambahan 23 Okt 2026)
  { url: 'https://www.antaranews.com/rss/ekonomi.xml', source: 'antaranews.com', label: 'Antara ekonomi', origin: 'lokal' },
  { url: 'https://www.cnnindonesia.com/internasional/rss', source: 'cnnindonesia.com', label: 'CNN Indonesia internasional', origin: 'lokal' },
  { url: 'https://rss.tempo.co/bisnis', source: 'tempo.co', origin: 'lokal' },
  // Media internasional
  { url: 'https://www.aljazeera.com/xml/rss/all.xml', source: 'aljazeera.com', origin: 'internasional' },
  { url: 'https://feeds.npr.org/1006/rss.xml', source: 'npr.org', origin: 'internasional' },
  { url: 'https://oilprice.com/rss/main', source: 'oilprice.com', origin: 'internasional' },
  { url: 'https://www.investing.com/rss/news_14.rss', source: 'investing.com', label: 'Investing.com ekonomi', origin: 'internasional' },
  // Media internasional (tambahan 23 Okt 2026)
  { url: 'https://www.investing.com/rss/news_11.rss', source: 'investing.com', label: 'Investing.com komoditas', origin: 'internasional' },
  { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', source: 'bbc.co.uk', origin: 'internasional' },
  { url: 'https://www.theguardian.com/business/rss', source: 'theguardian.com', origin: 'internasional' },
  { url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html', source: 'cnbc.com', label: 'CNBC economy', origin: 'internasional' },
  { url: 'https://rss.dw.com/rdf/rss-en-bus', source: 'dw.com', origin: 'internasional' },
  { url: 'https://www.hellenicshippingnews.com/feed/', source: 'hellenicshippingnews.com', origin: 'internasional' },
  { url: 'https://www.federalreserve.gov/feeds/press_monetary.xml', source: 'federalreserve.gov', origin: 'internasional' },
];

// Pencarian topik Google News RSS: menjangkau puluhan media sekaligus (Kontan, Bisnis, Kompas,
// Reuters, Bloomberg, dst.) dan bisa dibatasi tanggal (after:/before:), sehingga juga dipakai
// untuk mengisi riwayat. Edisi "id" = media Indonesia, "en" = media internasional.
export const GNEWS_TOPIK = [
  { q: '"harga minyak" OR BBM OR Pertamina', edisi: 'id' },
  { q: 'rupiah OR "BI Rate" OR "Bank Indonesia"', edisi: 'id' },
  { q: 'inflasi OR "harga pangan" OR beras OR Bulog', edisi: 'id' },
  { q: 'ekspor OR impor OR "neraca perdagangan" OR tarif', edisi: 'id' },
  { q: 'nikel OR "batu bara" OR sawit OR "harga emas"', edisi: 'id' },
  { q: 'IHSG OR "modal asing" OR APBN', edisi: 'id' },
  { q: '"oil prices" OR OPEC OR Brent', edisi: 'en' },
  { q: '"Federal Reserve" OR "Treasury yields" OR "dollar index"', edisi: 'en' },
  { q: 'tariffs OR sanctions OR "trade deal"', edisi: 'en' },
  { q: 'shipping OR "Red Sea" OR Hormuz OR freight', edisi: 'en' },
  { q: '"food prices" OR wheat OR rice OR fertilizer', edisi: 'en' },
  { q: 'Indonesia economy OR rupiah OR Jakarta', edisi: 'en' },
];
export const GNEWS_EDISI = {
  id: { hl: 'id', gl: 'ID', ceid: 'ID:id', origin: 'lokal' },
  en: { hl: 'en-US', gl: 'US', ceid: 'US:en', origin: 'internasional' },
};
export const GNEWS_PER_TOPIK = 20; // judul per topik pada pembaruan harian
export const RSS_PER_FEED = 20; // cukup karena pemilihan bergiliran hanya mengambil beberapa judul per media
export const GNEWS_PER_TOPIK_RIWAYAT = 100; // judul per topik untuk satu jendela riwayat (maksimum Google News)

// Media yang dianggap "media Indonesia" walau muncul di edisi internasional, dan sebaliknya.
// Domain berakhiran .id selalu dianggap media Indonesia.
export const DOMAIN_INDONESIA = [
  'cnbcindonesia.com', 'kompas.com', 'kompas.tv', 'detik.com', 'tempo.co', 'liputan6.com', 'okezone.com',
  'sindonews.com', 'tribunnews.com', 'bisnis.com', 'antaranews.com', 'republika.co.id', 'cnnindonesia.com',
  'kumparan.com', 'idxchannel.com', 'beritasatu.com', 'suara.com', 'merdeka.com', 'jpnn.com',
  'bloombergtechnoz.com', 'idntimes.com', 'metrotvnews.com', 'mediaindonesia.com', 'jawapos.com',
  'thejakartapost.com', 'tvonenews.com', 'emitennews.com', 'viva.co.id', 'kontan.co.id',
];
export const DOMAIN_INTERNASIONAL = [
  'reuters.com', 'bloomberg.com', 'cnbc.com', 'ft.com', 'wsj.com', 'bbc.com', 'bbc.co.uk', 'theguardian.com',
  'aljazeera.com', 'apnews.com', 'nikkei.com', 'scmp.com', 'channelnewsasia.com', 'investing.com',
  'oilprice.com', 'marketwatch.com', 'yahoo.com', 'forbes.com', 'economist.com', 'nytimes.com', 'dw.com',
  'france24.com', 'straitstimes.com', 'cnn.com', 'npr.org',
];

// Jumlah maksimum judul berita yang dikirim ke AI per pembaruan. Pemilihannya bergiliran per
// media, supaya media yang sangat sering menulis tidak menenggelamkan media lain.
export const MAX_LOKAL = 50;
export const MAX_INTERNASIONAL = 40;

// ---------- Isi riwayat (23 Okt 2026) ----------
export const RIWAYAT_JENDELA = 4; // hari per giliran; satu giliran = satu pembaruan riwayat
export const RIWAYAT_MAKS_HARI = 60; // riwayat paling jauh yang boleh diminta
export const RIWAYAT_PERKIRAAN = 4; // contoh perkiraan otomatis per jendela riwayat
// Google News menolak (HTTP 503) bila terlalu banyak permintaan dari Cloudflare dalam waktu singkat
// (uji 23 Okt: setelah ±36 permintaan dalam 10 menit). Karena itu riwayat diambil pelan-pelan.
export const RIWAYAT_JEDA_MENIT = 15; // jeda antar giliran riwayat
export const RIWAYAT_ULANG_MENIT = 30; // giliran yang ditolak Google News dicoba lagi setelah ini
export const RIWAYAT_MAKS_COBA = 6;
export const GNEWS_JEDA_MS = 1500; // jeda antar permintaan Google News pada riwayat

// ---------- Pengecekan perkiraan semi-otomatis (23 Okt 2026) ----------
export const CEK_PER_GILIRAN = 4; // perkiraan per panggilan AI
export const AI_CADANGAN = 8; // panggilan AI yang disisakan untuk pembaruan harian
export const AI_CADANGAN_DIMINTA = 2; // cadangan saat pemilik sendiri meminta pengecekan
export const CEK_ULANG_HARI = { belum: 3, gagal: 1, mingguan: 7 };
