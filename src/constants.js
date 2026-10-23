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

// Semua feed di bawah sudah dicek aktif pada 21 Okt 2026.
export const RSS_FEEDS = [
  // Media Indonesia
  { url: 'https://www.cnbcindonesia.com/news/rss', source: 'cnbcindonesia.com', origin: 'lokal' },
  { url: 'https://www.cnbcindonesia.com/market/rss', source: 'cnbcindonesia.com', origin: 'lokal' },
  { url: 'https://www.cnnindonesia.com/ekonomi/rss', source: 'cnnindonesia.com', origin: 'lokal' },
  { url: 'https://finance.detik.com/rss', source: 'detik.com', origin: 'lokal' },
  { url: 'https://feed.liputan6.com/rss/bisnis', source: 'liputan6.com', origin: 'lokal' },
  { url: 'https://www.republika.co.id/rss/ekonomi', source: 'republika.co.id', origin: 'lokal' },
  { url: 'https://sindikasi.okezone.com/index.php/rss/11/RSS2.0', source: 'okezone.com', origin: 'lokal' },
  { url: 'https://www.antaranews.com/rss/terkini.xml', source: 'antaranews.com', origin: 'lokal' },
  // Media internasional
  { url: 'https://www.aljazeera.com/xml/rss/all.xml', source: 'aljazeera.com', origin: 'internasional' },
  { url: 'https://feeds.npr.org/1006/rss.xml', source: 'npr.org', origin: 'internasional' },
  { url: 'https://oilprice.com/rss/main', source: 'oilprice.com', origin: 'internasional' },
  { url: 'https://www.investing.com/rss/news_14.rss', source: 'investing.com', origin: 'internasional' },
];

// Jumlah maksimum judul berita yang dikirim ke AI per pembaruan.
export const MAX_LOKAL = 50;
export const MAX_INTERNASIONAL = 40;
