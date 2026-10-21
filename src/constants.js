export const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// Batas panggilan AI per hari agar tetap di dalam kuota gratis Workers AI.
export const AI_DAILY_LIMIT = 30;

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

// Kueri GDELT: dua untuk media Indonesia, dua untuk media internasional berbahasa Inggris.
export const GDELT_QUERIES = [
  '(inflasi OR "suku bunga" OR rupiah OR IHSG OR "harga emas" OR "harga minyak" OR "BI Rate") sourcecountry:indonesia',
  '(pangan OR beras OR pupuk OR sawit OR panen OR tambang OR nikel OR batubara OR tekstil OR ekspor) sourcecountry:indonesia',
  '("oil prices" OR OPEC OR "Federal Reserve" OR inflation OR tariff OR "central bank") sourcelang:english',
  '(drought OR "food prices" OR "Strait of Hormuz" OR "Red Sea" OR sanctions OR "supply chain" OR "commodity prices") sourcelang:english',
];

export const RSS_FEEDS = [
  { url: 'https://www.cnbcindonesia.com/news/rss', source: 'cnbcindonesia.com', origin: 'lokal' },
  { url: 'https://www.cnbcindonesia.com/market/rss', source: 'cnbcindonesia.com', origin: 'lokal' },
  { url: 'https://www.antaranews.com/rss/terkini.xml', source: 'antaranews.com', origin: 'lokal' },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml', source: 'aljazeera.com', origin: 'internasional' },
];

// Jumlah maksimum judul berita yang dikirim ke AI per pembaruan.
export const MAX_LOKAL = 50;
export const MAX_INTERNASIONAL = 40;
