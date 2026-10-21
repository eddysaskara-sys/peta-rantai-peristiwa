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
