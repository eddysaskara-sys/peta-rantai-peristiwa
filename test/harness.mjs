import { DatabaseSync } from 'node:sqlite';
// Jeda antar permintaan (Google News, GDELT) dipercepat agar tes tidak lama; urutannya tetap sama.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, Math.min(ms || 0, 5), ...a);
import { readFileSync } from 'node:fs';
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const worker = (await import(ROOT + '/src/index.js')).default;
const { cleanTitle, parseGnews, selectHeadlines, originOf } = await import(ROOT + '/src/sources.js');
const { GNEWS_TOPIK } = await import(ROOT + '/src/constants.js');
const { kelompokPerkiraan, normalizeChecks, kataKunci } = await import(ROOT + '/src/forecast.js');
const { bagiJendela, pilihContohPerkiraan, dekatJadwalHarian } = await import(ROOT + '/src/pipeline.js');
const { priceChange } = await import(ROOT + '/src/market.js');
const { kumpulkanBukti, hargaKalimat, sebarPerHari } = await import(ROOT + '/src/forecast.js');
const { priceSignal, newsSignals } = await import(ROOT + '/src/market.js');
const { rankProposals } = await import(ROOT + '/src/priority.js');
const { MAKS_TINJAU } = await import(ROOT + '/src/constants.js');
const { normalizeScan } = await import(ROOT + '/src/pipeline.js');

// ---- D1 tiruan ----
const sq = new DatabaseSync(':memory:');
sq.exec(readFileSync(ROOT + '/schema.sql', 'utf8'));
const norm = (p) => p.map((v) => (v === undefined ? null : v));
class Stmt {
  constructor(sql) { this.sql = sql; this.p = []; }
  bind(...p) { this.p = norm(p); return this; }
  _all() { return sq.prepare(this.sql).all(...this.p); }
  async first() { return this._all()[0] || null; }
  async all() { return { results: this._all() }; }
  async run() { const r = sq.prepare(this.sql).run(...this.p); return { meta: { changes: r.changes } }; }
}
const DB = {
  prepare: (sql) => new Stmt(sql),
  batch: async (stmts) => { sq.exec('BEGIN'); try { const out = stmts.map((s) => /RETURNING|^\s*SELECT/i.test(s.sql) ? { results: s._all() } : (sq.prepare(s.sql).run(...s.p), {})); sq.exec('COMMIT'); return out; } catch (e) { sq.exec('ROLLBACK'); throw e; } },
};

// ---- AI tiruan ----
let aiCalls = 0, failSchemaOnce = true, lastCheckPrompt = '', lastScanPrompt = '', lastLinkPrompt = '';
const AI = {
  async run(model, input) {
    aiCalls++;
    if (failSchemaOnce) { failSchemaOnce = false; throw new Error('model sibuk'); }
    const u = input.messages[1].content;
    if (u.startsWith('Peristiwa (urut tanggal)')) {
      lastScanPrompt = u;
      const n = (u.match(/^E\d+ /gm) || []).length;
      return { response: { kaitan: [
        { dari: 'E1', ke: 'E' + n, jenis: 'memperkuat', alasan: 'Sebab lama memperkuat akibat terbaru.', keyakinan: 0.8 },
        { dari: 'E2', ke: 'E' + n, jenis: 'menyebabkan', alasan: 'Sebab lama kedua.', keyakinan: 0.6 },
        { dari: 'E' + n, ke: 'E1', jenis: 'menyebabkan', alasan: 'terbalik: akibat lebih awal dari sebab', keyakinan: 0.9 },
        { dari: 'E1', ke: 'E1', jenis: 'menyebabkan', alasan: 'diri sendiri', keyakinan: 0.9 },
        { dari: 'E999', ke: 'E2', jenis: 'menyebabkan', alasan: 'kode palsu', keyakinan: 0.9 },
        { dari: 'E1', ke: 'E' + n, jenis: 'menyebabkan', alasan: 'ganda', keyakinan: 0.9 },
      ] } };
    }
    if (u.startsWith('Peristiwa baru')) lastLinkPrompt = u;
    if (u.startsWith('Hari ini:')) {
      lastCheckPrompt = u;
      const cek = [...u.matchAll(/Perkiraan P(\d+)[^\n]*\n"([^"]*)"/g)].map(([, id, teks]) =>
        /BBM/.test(teks)
          ? { id: 'P' + id, putusan: 'terjadi', keyakinan: 0.8, alasan: 'Harga BBM nonsubsidi naik pada berita nomor 1.', bukti: [1, 42] }
          : { id: 'P' + id, putusan: 'tidak', keyakinan: 0.6, alasan: 'Belum terlihat.', bukti: [] }
      );
      return { response: { cek } };
    }
    if (u.startsWith('Daftar berita')) {
      const n = (u.match(/^\d+\./gm) || []).length;
      const obj = { peristiwa: [
        { judul: 'Ketegangan di Selat Hormuz memanas', ringkasan: 'Kapal tanker terganggu.', tingkat: 'global', sektor: ['Minyak & Gas', 'geopolitik & keamanan', 'Sektor Ngarang'], indikator: ['Harga Minyak'], artikel: [1, n, 99], dua_sisi: 'Media lokal fokus BBM, internasional fokus militer.', dampak: [{ teks: 'Harga BBM nonsubsidi naik', hari: 30 }] },
        { judul: 'BI menahan suku bunga 5,75%', ringkasan: 'BI Rate tetap.', tingkat: 'lokal', sektor: ['Moneter'], indikator: ['BI Rate', 'Rupiah'], artikel: [3], dua_sisi: 'harus dibuang karena satu sisi', dampak: [] },
        { judul: 'Kekeringan ganggu panen gandum', ringkasan: 'Panen turun.', tingkat: 'global', sektor: ['Pertanian', 'Pangan'], indikator: ['Harga Pangan'], artikel: [n], dampak: [{ teks: 'Harga roti naik', hari: 500 }] },
        { judul: 'Tanpa artikel', ringkasan: '-', tingkat: 'lokal', sektor: [], artikel: [] },
      ] };
      // kembalikan sebagai teks berpagar agar jalur ekstraksi teruji
      return { choices: [{ message: { content: 'Berikut hasilnya:\n```json\n' + JSON.stringify(obj) + '\n```' } }] };
    }
    const hasOld = u.includes('L1 [');
    return { response: { kaitan: [
      { dari: 'B1', ke: 'B2', jenis: 'memperkuat', alasan: 'Harga minyak naik menekan rupiah.', keyakinan: 0.7 },
      { dari: 'B3', ke: 'B2', jenis: 'menyebabkan', alasan: 'Harga pangan memengaruhi inflasi.', keyakinan: 1.4 },
      { dari: 'B9', ke: 'B1', jenis: 'menyebabkan', alasan: 'id tidak ada', keyakinan: 0.5 },
      { dari: 'B2', ke: 'B2', jenis: 'menyebabkan', alasan: 'diri sendiri', keyakinan: 0.5 },
      ...(hasOld ? [{ dari: 'L1', ke: 'B1', jenis: 'jenis-aneh', alasan: 'Lama ke baru', keyakinan: 0.4 }, { dari: 'L1', ke: 'L2', jenis: 'menyebabkan', alasan: 'lama-lama ditolak', keyakinan: 0.4 }] : []),
    ] } };
  },
};

// ---- fetch tiruan (GDELT + RSS) ----
let round = 0;
const now = Date.now();
const gd = (t, i, country) => ({ url: `https://contoh.id/${round}/${t.length}/${i}`, title: t, seendate: new Date(now - i * 3600e3).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z', domain: 'contoh.id', sourcecountry: country });
// Harga: USD/IDR 45 hari kerja bergerak kecil, lalu hari terakhir melonjak 1,5% (gerak tidak biasa).
const fxRates = {};
{
  // 46 hari kerja yang berakhir pada hari kerja terakhir (tidak bergantung pada hari tes dijalankan).
  let v = 17000, d = new Date(Date.now() + 86400e3);
  const days = [];
  while (days.length < 46) { d = new Date(d.getTime() - 86400e3); if (d.getUTCDay() % 6) days.unshift(d.toISOString().slice(0, 10)); }
  days.forEach((day, i) => { v = i === days.length - 1 ? v * 1.015 : v * (1 + (i % 2 ? 0.002 : -0.0018)); fxRates[day] = { IDR: Math.round(v) }; });
}
let marketDown = false, gnewsDaily = false, gnewsDown = false, gdeltRiwayatDown = false, fetchLog = [];
const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);
const fredCsv = () => {
  let out = 'observation_date,DCOILBRENTEU\n';
  for (let i = 40; i >= 5; i--) out += `${dayStr(Date.now() - i * 86400e3)},${i === 20 ? '.' : (70 + (i % 3) * 0.5).toFixed(2)}\n`;
  return out;
};
const gnItem = (title, src, host, date) =>
  `<item><title>${title} - ${src}</title><link>https://news.google.com/rss/articles/${encodeURIComponent(title)}</link><pubDate>${new Date(date).toUTCString()}</pubDate><description>&lt;a&gt;x&lt;/a&gt;</description><source url="https://${host}">${src}</source></item>`;
const gnewsMock = (u) => {
  const q = decodeURIComponent(u.split('q=')[1].split('&')[0]);
  const en = u.includes('hl=en-US');
  const w = /after:(\d{4}-\d{2}-\d{2}) before:(\d{4}-\d{2}-\d{2})/.exec(q);
  if (w && GNEWS_TOPIK.some((t) => q.startsWith(t.q))) {
    // Jendela riwayat: 2 berita per topik, bertanggal di dalam jendela.
    const t = Date.parse(w[1] + 'T05:00:00Z') + 86400e3;
    const topik = q.slice(0, 12);
    // Google News kadang menyertakan berita sesudah jendela; harus dibuang.
    const bocor = gnItem(`Berita sesudah jendela ${w[2]} ${topik}`, 'Kontan', 'kontan.co.id', Date.parse(w[2] + 'T05:00:00Z'));
    return bocor + (en
      ? gnItem(`Oil prices climb ${w[1]} ${topik}`, 'Reuters', 'www.reuters.com', t) + gnItem(`Shipping rates jump ${w[1]} ${topik}`, 'CNBC', 'www.cnbc.com', t + 3600e3)
      : gnItem(`Harga BBM nonsubsidi naik ${w[1]} ${topik}`, 'Kontan', 'industri.kontan.co.id', t) + gnItem(`Rupiah melemah ${w[1]} ${topik}`, 'Bisnis.com', 'market.bisnis.com', t + 7200e3));
  }
  const after = /after:(\d{4}-\d{2}-\d{2})/.exec(q);
  if (after) {
    // Pencarian bukti perkiraan.
    return gnItem('Harga BBM nonsubsidi resmi naik mulai hari ini', 'CNBC Indonesia', 'www.cnbcindonesia.com', Date.now() - 3600e3) +
      gnItem('Harga BBM lama sebelum peristiwa', 'Detik', 'finance.detik.com', Date.parse(after[1]) - 5 * 86400e3);
  }
  if (!gnewsDaily) return '';
  return gnItem('Harga beras naik di Jakarta', 'Kompas', 'money.kompas.com', Date.now() - 1800e3) + gnItem('Fed holds rates steady', 'Reuters', 'www.reuters.com', Date.now() - 2400e3);
};
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  fetchLog.push(url);
  if (url.includes('fredgraph')) return marketDown ? new Response('err', { status: 503 }) : new Response(fredCsv());
  if (url.includes('news.google.com/rss/search')) {
    if (gnewsDown) return new Response('unusual traffic', { status: 503 });
    return new Response(`<rss><channel>${gnewsMock(url)}</channel></rss>`);
  }
  if (url.includes('frankfurter')) return marketDown ? new Response('err', { status: 503 }) : new Response(JSON.stringify({ base: 'USD', rates: fxRates }));
  if (url.includes('gold-api')) return new Response(JSON.stringify({ name: 'Gold', price: 4069.8, symbol: 'XAU', updatedAt: new Date().toISOString() }));
  if (url.includes('api-ninjas')) {
    if ((opts.headers || {})['X-Api-Key'] !== 'kunci-uji') return new Response('{"error":"Invalid API Key."}', { status: 400 });
    return new Response(JSON.stringify({ price: 80, previous_close: 76, updated: Math.floor(Date.now() / 1000), type: 'brent' }));
  }
  if (url.includes('gdeltproject') && url.includes('startdatetime=')) {
    if (gdeltRiwayatDown) return new Response('Please limit requests to one every 5 seconds', { status: 429 });
    const st = /startdatetime=(\d{8})/.exec(url)[1];
    const t = Date.UTC(+st.slice(0, 4), +st.slice(4, 6) - 1, +st.slice(6, 8)) + 30 * 3600e3;
    const id = url.includes('sourcecountry%3Aindonesia');
    return new Response(JSON.stringify({ articles: [{ url: `https://gdelt.contoh/${st}/${id ? 'id' : 'en'}`, title: id ? `Inflasi pangan naik ${st}` : `Fed signals pause ${st}`, seendate: new Date(t).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z', domain: id ? 'kompas.com' : 'apnews.com', sourcecountry: id ? 'Indonesia' : 'United States' }] }));
  }
  if (url.includes('gdeltproject')) {
    if (url.includes('drought')) return new Response('Please limit requests to one every 5 seconds', { status: 429 });
    const loc = url.includes('sourcecountry%3Aindonesia');
    const arts = loc ? [gd('BI Rate Tetap di 5 , 75 %, Rupiah Tertekan', 1, 'Indonesia'), gd('Harga beras naik ( Bulog )', 2, 'Indonesia')]
                     : [gd('Oil jumps as Hormuz tensions rise', 1, 'United States'), gd('Tankers rerouted from Strait of Hormuz', 2, 'United Kingdom')];
    return new Response(JSON.stringify({ articles: arts }));
  }
  if (url.includes('cnbcindonesia.com/news')) return new Response(`<rss><channel><item><title>BI Rate tetap 5,75%</title><link>https://cnbcindonesia.com/r${round}/bi</link><pubDate>${new Date(now - 1800e3).toUTCString()}</pubDate></item><item><title>Harga beras naik</title><link>https://cnbcindonesia.com/r${round}/beras</link><pubDate>${new Date(now - 2400e3).toUTCString()}</pubDate></item></channel></rss>`);
  if (url.includes('oilprice')) return new Response(`<rss><channel><item><title>Oil jumps as Hormuz tensions rise</title><link>https://oilprice.com/r${round}/1</link><pubDate>${new Date(now - 3000e3).toUTCString()}</pubDate></item><item><title>Tankers rerouted from Strait of Hormuz</title><link>https://oilprice.com/r${round}/2</link><pubDate>${new Date(now - 3300e3).toUTCString()}</pubDate></item></channel></rss>`);
  if (url.includes('cnbcindonesia')) return new Response(`<rss><channel><item><title><![CDATA[Harga BBM nonsubsidi naik &amp; antre]]></title><link>https://cnbcindonesia.com/r${round}/1</link><pubDate>${new Date(now - 3600e3).toUTCString()}</pubDate></item><item><title>Berita lama sekali</title><link>https://cnbcindonesia.com/old</link><pubDate>Mon, 01 Jan 2024 00:00:00 +0000</pubDate></item></channel></rss>`);
  if (url.includes('antaranews')) return new Response('nope', { status: 500 });
  if (url.includes('aljazeera')) return new Response(`<rss><channel><item><title>Drought hits wheat harvest in Europe &#039;badly&#039;</title><link>https://aljazeera.com/r${round}/a</link><pubDate>${new Date(now - 7200e3).toUTCString()}</pubDate></item></channel></rss>`);
  return new Response('<rss><channel></channel></rss>');
};

const env = { DB, AI, ADMIN_PIN: 'rahasia123', API_NINJAS_KEY: 'kunci-uji', ASSETS: { fetch: async () => new Response('<html>aset</html>') } };
const call = async (method, path, body, pin) => {
  const r = await worker.fetch(new Request('https://x.dev' + path, { method, headers: pin ? { 'x-pin': pin } : {}, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return [r.status, j];
};
const doRun = async (days) => {
  const [s, d] = await call('POST', '/api/run', { days }, 'rahasia123');
  if (s !== 200 || !d.runId) return [s, d];
  let p;
  await worker.scheduled({ cron: '*/5 * * * *' }, env, { waitUntil(x) { p = x; } });
  return [s, await p];
};
const ok = (cond, msg) => { console.log((cond ? 'LULUS ' : 'GAGAL ') + msg); if (!cond) process.exitCode = 1; };

let [s, d] = await call('GET', '/api/status');
ok(s === 200 && d.owner === false && d.pinSet === true, 'status publik');
[s, d] = await call('GET', '/');
ok(d.includes('aset'), 'halaman disajikan dari aset');
[s] = await call('POST', '/api/run', { days: 1 });
ok(s === 401, 'run tanpa PIN ditolak');
[s] = await call('POST', '/api/run', { days: 1 }, 'salah');
ok(s === 401, 'run dengan PIN salah ditolak');

console.log('... menjalankan pembaruan pertama (menunggu jeda GDELT)');
[s, d] = await doRun(1);
console.log(JSON.stringify(d));
ok(s === 200 && d.events === 3 && d.links === 2, 'pembaruan 1: 3 peristiwa, 2 kaitan valid');
const ev = sq.prepare('SELECT * FROM events').all();
ok(JSON.parse(ev[0].sektor).join('|') === 'Minyak & Gas|Geopolitik & Keamanan', 'label sektor dicocokkan, label ngarang dibuang');
ok(ev[0].dua_sisi !== '' , 'dua sisi dipertahankan bila ada sumber lokal+internasional? -> ' + JSON.stringify(ev[0].dua_sisi));
ok(ev[1].dua_sisi === '', 'dua sisi dibuang bila hanya satu sisi');
ok(JSON.parse(ev[2].dampak)[0].hari === 120, 'horizon dampak dibatasi 120 hari');
const arts = sq.prepare('SELECT title FROM articles').all().map((a) => a.title);
ok(cleanTitle('BI Rate Tetap di 5 , 75 %, Rupiah') === 'BI Rate Tetap di 5,75%, Rupiah', 'judul gaya GDELT dirapikan');
ok(!arts.includes('Berita lama sekali'), 'berita di luar rentang waktu dibuang');
ok(arts.some((a) => a.includes("'badly'")), 'entitas HTML didekode');
const run1 = sq.prepare('SELECT * FROM runs').all()[0];
ok(/Antara terkini: HTTP 500/.test(run1.note) && /Berita per sumber/.test(run1.note) && /AI peristiwa/.test(run1.note), 'catatan memuat sumber gagal, jumlah per sumber, dan hasil AI');

[s, d] = await call('GET', '/api/review', null, 'rahasia123');
ok(s === 200 && d.pending.length === 2 && d.fresh.length === 3, 'tinjau: 2 usulan, 3 peristiwa baru');
const linkB1B2 = d.pending.find((p) => p.dari_judul.includes('Hormuz'));
ok(linkB1B2 && d.pending.every((p) => p.keyakinan <= 1), 'keyakinan dibatasi 0..1');
[s] = await call('GET', '/api/review');
ok(s === 401, 'tinjau tidak bisa dilihat penguji');

[s, d] = await call('GET', '/api/chain/' + linkB1B2.ke_id);
ok(s === 200 && d.up.length === 0, 'rantai publik kosong sebelum disetujui');
[s] = await call('POST', '/api/links/' + linkB1B2.id, { status: 'disetujui' }, 'rahasia123');
ok(s === 200, 'setujui kaitan');
[s, d] = await call('GET', '/api/chain/' + linkB1B2.ke_id);
ok(d.up.length === 1 && d.up[0][0].event.judul.includes('Hormuz'), 'rantai: penyebab muncul setelah disetujui');
[s, d] = await call('GET', '/api/chain/' + linkB1B2.ke_id + '?usulan=1', null, 'rahasia123');
ok(d.up[0].length === 2, 'pemilik bisa melihat usulan di rantai');
[s, d] = await call('GET', '/api/chain/' + linkB1B2.ke_id + '?usulan=1');
ok(d.up[0].length === 1, 'penguji tidak melihat usulan meski meminta');

[s, d] = await call('GET', '/api/events?days=30&sektor=Moneter');
ok(d.events.length === 1 && d.events[0].judul.startsWith('BI'), 'filter sektor');
[s, d] = await call('GET', '/api/events?days=30&tingkat=global&q=Hormuz');
ok(d.events.length === 1 && d.events[0].n_kaitan === 1, 'filter tingkat + cari + hitung kaitan');
[s, d] = await call('GET', '/api/sectors');
const en = d.kelompok.find((x) => x.id === 'energi');
ok(d.kelompok.length === 6 && en.global === 1 && en.rinci['Minyak & Gas'] === 1 && en.terbaru, 'statistik 6 kelompok sektor, rincian sektor tetap ada');
[s, d] = await call('GET', '/api/events?days=30&kelompok=energi');
ok(d.events.length === 1 && d.events[0].kelompok.includes('energi'), 'filter kelompok sektor');

// ---- Harga pasar & sinyal ----
const mp = sq.prepare('SELECT kode, COUNT(*) AS n FROM market_prices GROUP BY kode').all();
const nOf = (k) => mp.find((r) => r.kode === k)?.n || 0;
const brentRows = sq.prepare("SELECT day, nilai, sumber FROM market_prices WHERE kode = 'BRENT' ORDER BY day").all();
ok(nOf('USDIDR') >= 40 && nOf('XAU') === 1 && brentRows.length === 37, 'harga tersimpan: kurs dengan riwayat, emas 1 titik, Brent riwayat FRED + harga terakhir');
ok(brentRows.filter((r) => r.sumber === 'FRED (EIA)').length === 35 && brentRows.at(-1).sumber === 'API Ninjas' && brentRows.at(-2).sumber === 'API Ninjas', 'FRED hanya mengisi hari kosong; API Ninjas tetap dipakai untuk 2 hari terakhir');
const run1note = sq.prepare('SELECT note FROM runs WHERE id = 1').get().note;
ok(/Harga pasar: Brent riwayat FRED \(EIA\): 35 data, Brent: 2 data, Emas: 1 data, USD\/IDR: \d+ data/.test(run1note), 'catatan pembaruan memuat hasil harga pasar');
[s, d] = await call('GET', '/api/market');
const sig = Object.fromEntries(d.signals.map((x) => [x.id, x]));
console.log('  sinyal:', d.signals.map((x) => `${x.id}=${x.metode}/${x.bergerak ? 'GERAK' : '-'}`).join(' '));
ok(sig.keuangan.metode === 'harga' && sig.keuangan.bergerak && /rupiah melemah/.test(sig.keuangan.label), 'kurs melonjak 1,5% terbaca sebagai gerak tidak biasa');
ok(sig.energi.metode === 'harga' && sig.energi.bergerak && !/pembanding sementara/.test(sig.energi.label), 'Brent +5,3% dibanding riwayat 30 hari dari FRED, bukan pembanding sementara');
ok(sig.tambang.metode !== 'harga' && /Emas: riwayat harga belum cukup/.test(sig.tambang.label), 'emas 1 titik: jatuh ke berita dan dijelaskan');
ok(sig.pangan.metode !== 'harga', 'pangan dinilai dari berita');

// unit: priceSignal
const flat = Array.from({ length: 31 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, '0')}`.replace('2026-09-31', '2026-10-01'), nilai: 100 * (1 + (i % 2 ? 0.01 : -0.01)) }));
const today0 = flat[flat.length - 1].day;
let ps = priceSignal(flat, 2, today0);
ok(ps.ok && !ps.sementara && !ps.bergerak, 'priceSignal: gerak biasa tidak ditandai');
ps = priceSignal([...flat, { day: '2026-10-02', nilai: flat[30].nilai * 1.08 }], 2, '2026-10-02');
ok(ps.ok && ps.bergerak && ps.z > 1.5, 'priceSignal: lonjakan 8% ditandai');
ps = priceSignal(flat, 2, '2026-10-20');
ok(!ps.ok && /data terakhir/.test(ps.alasan), 'priceSignal: data basi tidak dipakai');

// unit: newsSignals berbasis porsi (hari backfill 35 peristiwa tidak dianggap lonjakan)
const nrows = [];
const add = (hari, n, kel) => { for (let i = 0; i < n; i++) nrows.push({ hari, kelompok: kel }); };
add('2026-10-20', 30, ['keuangan']); add('2026-10-20', 5, ['energi']);
add('2026-10-21', 9, ['keuangan']); add('2026-10-21', 1, ['dagang']);
add('2026-10-22', 5, ['keuangan']); add('2026-10-22', 4, ['dagang']);
const ns = newsSignals(nrows);
ok(ns.dagang.bergerak && !ns.keuangan.bergerak && !ns.energi.bergerak, 'newsSignals: lonjakan porsi perdagangan terdeteksi, keuangan tidak');
ok(!newsSignals(nrows.filter((r) => r.hari === '2026-10-22')).dagang.ok, 'newsSignals: riwayat kurang dari 3 hari = belum cukup');

// unit: urutan prioritas
const base = { dari_tingkat: 'global', dari_sektor: [], ke_sektor: [], dari_indikator: [], ke_indikator: [], keyakinan: 0.5, created_at: '2026-10-22' };
const ranked = rankProposals([
  { ...base, id: 1, dari_id: 1, ke_id: 2, ke_tingkat: 'global', keyakinan: 0.9 },
  { ...base, id: 2, dari_id: 3, ke_id: 4, ke_tingkat: 'lokal' },
  { ...base, id: 3, dari_id: 5, ke_id: 6, ke_tingkat: 'global', ke_indikator: ['Rupiah'], dari_sektor: ['Minyak & Gas'] },
  { ...base, id: 4, dari_id: 7, ke_id: 8, ke_tingkat: 'lokal', dari_sektor: ['Energi'] },
], { approvedIds: new Set([8]), signals: [{ id: 'energi', nama: 'Energi', bergerak: true, label: 'Brent +5%' }] });
ok(ranked.map((r) => r.id).join(',') === '4,3,2,1' && ranked[0].skor === 3 && ranked[3].skor === 0, 'urutan prioritas: 3 poin > 2 > 1 > 0');
ok(ranked[0].alasan_prioritas.join(' | ') === 'Berdampak ke Indonesia | Menyambung rantai lama | Energi: Brent +5%', 'alasan prioritas ditampilkan');

// ---- Batas 5 tinjauan per malam ----
const insEv = sq.prepare("INSERT INTO events (run_id, tanggal, judul, ringkasan, tingkat, sektor, indikator, dua_sisi, dampak, created_at) VALUES (1, ?, ?, '', ?, ?, '[]', '', '[]', ?)");
for (const [j, t, sk] of [['Ekspor tekstil turun', 'lokal', '["Tekstil & Pakaian"]'], ['Tarif baru AS', 'global', '["Perdagangan & Logistik"]'], ['Harga nikel naik', 'global', '["Mineral & Pertambangan"]']]) {
  insEv.run(new Date().toISOString().slice(0, 10), j, t, sk, new Date().toISOString());
}
const evIds = sq.prepare("SELECT id FROM events ORDER BY id").all().map((r) => r.id);
const tambahan = sq.prepare("INSERT OR IGNORE INTO links (dari_id, ke_id, jenis, alasan, keyakinan, status, dibuat_oleh, created_at) VALUES (?, ?, 'menyebabkan', 'uji', 0.3, 'usulan', 'ai', ?)");
for (let i = 0; i < evIds.length; i++) for (let j = 0; j < evIds.length; j++) if (i !== j) tambahan.run(evIds[i], evIds[j], new Date().toISOString());
[s, d] = await call('GET', '/api/review', null, 'rahasia123');
const kolam = d.pending.length + d.menunggu;
// Satu kaitan sudah disetujui hari ini di uji sebelumnya, jadi slot malam ini tinggal 4.
ok(d.sudah === 1 && d.slot === MAKS_TINJAU - 1 && d.pending.length === MAKS_TINJAU - 1 && d.menunggu === kolam - (MAKS_TINJAU - 1) && kolam > MAKS_TINJAU, `tinjau: hanya ${MAKS_TINJAU} keputusan per malam (1 sudah, ${MAKS_TINJAU - 1} dari ${kolam} usulan tampil)`);
ok(d.pending.every((p, i, a) => i === 0 || a[i - 1].skor >= p.skor), 'tinjau: urut menurut skor prioritas');
for (const p of d.pending.slice(0, 2)) await call('POST', '/api/links/' + p.id, { status: p.id % 2 ? 'disetujui' : 'ditolak' }, 'rahasia123');
[s, d] = await call('GET', '/api/review', null, 'rahasia123');
ok(d.pending.length === MAKS_TINJAU - 3 && d.sudah === 3, `setelah 2 keputusan lagi, sisa slot malam ini ${MAKS_TINJAU - 3}`);
[s, d] = await call('GET', '/api/status', null, 'rahasia123');
ok(d.tinjau.sisa === MAKS_TINJAU - 3 && d.tinjau.maks === MAKS_TINJAU && MAKS_TINJAU > 5, `status: lencana Tinjau menunjukkan sisa ${MAKS_TINJAU - 3} (batas malam ${MAKS_TINJAU}, bukan 5)`);
const anyDecided = sq.prepare("SELECT id FROM links WHERE decided_at IS NOT NULL AND dibuat_oleh='ai' ORDER BY decided_at DESC, id DESC LIMIT 1").get().id;
await call('POST', '/api/links/' + anyDecided, { status: 'usulan' }, 'rahasia123');
[s, d] = await call('GET', '/api/review', null, 'rahasia123');
ok(d.sudah === 2 && d.pending.length === MAKS_TINJAU - 2, 'membatalkan keputusan mengembalikan slotnya');
[s, d] = await call('GET', '/api/status');
ok(d.tinjau === null && Array.isArray(d.signals) && d.kelompok.length === 6, 'status publik: tanpa info tinjauan, dengan sinyal dan kelompok');

// ---- Rantai utama ----
[s, d] = await call('GET', '/api/chains');
ok(s === 200 && d.chains.length >= 1 && d.chains[0].jalur.length >= 2 && d.chains[0].jalur[0].link === null, 'rantai utama: daftar rantai dengan akar dan jalur');
const hormuzChain = d.chains.find((c) => c.jalur.some((x) => x.event.judul.includes('Hormuz')));
ok(hormuzChain && hormuzChain.kelompok.includes('energi') && hormuzChain.dua_sisi, 'rantai memuat kelompok sektor dan label ⚖️');
[s, d] = await call('GET', '/api/chains?kelompok=industri');
ok(d.chains.every((c) => c.kelompok.includes('industri')), 'rantai utama bisa disaring per kelompok');

console.log('... pembaruan kedua (berita baru, ada peristiwa lama)');
round = 1; failSchemaOnce = false;
[s, d] = await doRun(3);
console.log(JSON.stringify(d));
ok(s === 200 && d.events === 3, 'pembaruan 2 berhasil');
const l2 = sq.prepare("SELECT * FROM links WHERE run_id = ?").all(d.runId);
ok(l2.some((l) => l.jenis === 'menyebabkan' && l.alasan === 'Lama ke baru'), 'kaitan lama->baru diterima, jenis aneh jadi "menyebabkan"');
ok(!l2.some((l) => l.alasan === 'lama-lama ditolak'), 'kaitan lama->lama ditolak');

round = 1; marketDown = true;
[s, d] = await doRun(1);
ok(s === 200 && d.ok, 'pembaruan ulang berjalan walau sumber kurs gagal');
const lastNote = sq.prepare('SELECT note FROM runs ORDER BY id DESC LIMIT 1').get().note;
ok(/USD\/IDR gagal \(HTTP 503\)/.test(lastNote), 'kegagalan sumber harga dicatat');
marketDown = false;

const evId = sq.prepare('SELECT id FROM events LIMIT 1').get().id;
[s] = await call('POST', '/api/forecasts', { event_id: evId, teks: 'Harga BBM naik', hari: 30 }, 'rahasia123');
[s, d] = await call('GET', '/api/forecasts');
ok(d.forecasts.length === 1 && d.forecasts[0].status === 'menunggu', 'perkiraan tercatat');
[s] = await call('POST', '/api/forecasts/' + d.forecasts[0].id, { status: 'terjadi' }, 'rahasia123');
[s, d] = await call('GET', '/api/forecasts');
ok(d.forecasts[0].status === 'terjadi', 'perkiraan ditandai terjadi');
[s] = await call('POST', '/api/events/' + evId, { status: 'diarsip' }, 'rahasia123');
[s, d] = await call('GET', '/api/events?days=30');
ok(!d.events.some((e) => e.id === evId), 'peristiwa diarsipkan hilang dari linimasa');

[s, d] = await call('GET', '/api/status');
console.log('AI dipanggil', aiCalls, 'kali; tercatat', d.counts.ai_calls);
ok(d.counts.ai_calls === aiCalls, 'pemakaian AI tercatat sama dengan jumlah panggilan');
[s, d] = await call('GET', '/api/tidak-ada');
ok(s === 404, 'alamat tak dikenal -> 404');

// antrean: permintaan ganda tidak membuat antrean baru, jadwal harian tetap jalan
let [a1, q1] = await call('POST', '/api/run', { days: 2 }, 'rahasia123');
let [a2, q2] = await call('POST', '/api/run', { days: 2 }, 'rahasia123');
ok(q1.runId === q2.runId && q2.already === true, 'permintaan ganda memakai antrean yang sama');
[s, d] = await call('GET', '/api/status');
ok(d.lastRun.status === 'antre', 'status menampilkan antrean');
let p2; await worker.scheduled({ cron: '30 10 * * *' }, env, { waitUntil(x) { p2 = x; } }); const daily = await p2;
ok(daily.ok === true, 'jadwal harian berjalan');
let p3; await worker.scheduled({ cron: '*/5 * * * *' }, env, { waitUntil(x) { p3 = x; } }); const fromQ = await p3;
ok(fromQ && fromQ.runId === q1.runId, 'antrean diproses oleh jadwal 5 menit');
let p4; await worker.scheduled({ cron: '*/5 * * * *' }, env, { waitUntil(x) { p4 = x; } });
const scanHarian = await p4;
const scanRow = sq.prepare('SELECT * FROM runs WHERE id = ?').get(scanHarian.runId);
ok(scanHarian.ok && scanRow.trigger === 'kaitan' && scanRow.status === 'selesai' && /otomatis/.test(scanRow.note), 'tanpa antrean: cari kaitan terbesar berjalan otomatis setelah pembaruan hari ini');
ok(scanHarian.links === 2, `pemindaian otomatis menambah 2 usulan kaitan (${scanHarian.links})`);
let p5; await worker.scheduled({ cron: '*/5 * * * *' }, env, { waitUntil(x) { p5 = x; } });
const idle = await p5;
ok(idle && idle.dicek === 0 && !idle.runId, 'pemindaian otomatis hanya sekali sehari; tanpa antrean dan perkiraan jatuh tempo tidak melakukan apa-apa');


// ======================= Masukan pengguna 23 Okt 2026 =======================
const OWNER = 'rahasia123';
const tick = async () => { let p; await worker.scheduled({ cron: '*/5 * * * *' }, env, { waitUntil(x) { p = x; } }); return p; };

// ---- Pengelompokan perkiraan ----
ok(kelompokPerkiraan('Harga BBM domestik berpotensi naik 5-8% jika kurs Rupiah tetap, memicu inflasi pangan', ['Energi']) === 'energi', 'kelompok: pokok kalimat BBM -> Energi walau menyebut rupiah');
ok(kelompokPerkiraan('Suku bunga yang tetap dapat menstabilkan nilai tukar Rupiah', ['Energi']) === 'keuangan', 'kelompok: dari teks perkiraan, bukan dari peristiwa asal');
ok(kelompokPerkiraan('Harga minyak goreng naik dalam sebulan', []) === 'pangan', 'kelompok: "minyak goreng" masuk Pangan, bukan Energi');
ok(kelompokPerkiraan('Lonjakan impor India menaikkan biaya pengiriman kontainer', []) === 'dagang', 'kelompok: perdagangan & logistik');
ok(kelompokPerkiraan('Pemerintah menunda pemilu', ['Moneter']) === 'keuangan' && kelompokPerkiraan('Pemerintah menunda pemilu', ['Geopolitik & Keamanan']) === 'lintas', 'kelompok: tanpa istilah -> kelompok peristiwa asal, lalu lintas sektor');
ok(kataKunci('Harga BBM nonsubsidi naik dalam 30 hari').includes('bbm'), 'kata kunci bukti memuat istilah kamus');

// ---- API perkiraan: kelompok, cegah ganda, hapus ----
const evBBM = sq.prepare("SELECT id, tanggal FROM events WHERE status = 'aktif' ORDER BY id DESC LIMIT 1").get();
sq.prepare('UPDATE events SET tanggal = ? WHERE id = ?').run(dayStr(Date.now() - 20 * 86400e3), evBBM.id);
let [fs1, f1] = await call('POST', '/api/forecasts', { event_id: evBBM.id, teks: 'Harga BBM nonsubsidi naik', tanggal_cek: dayStr(Date.now() - 2 * 86400e3) }, OWNER);
let [, f1b] = await call('POST', '/api/forecasts', { event_id: evBBM.id, teks: 'Harga BBM nonsubsidi naik', hari: 30 }, OWNER);
ok(fs1 === 200 && f1.id && f1b.sudah === true && f1b.id === f1.id, 'perkiraan yang sama tidak tercatat dua kali');
let [, f2] = await call('POST', '/api/forecasts', { event_id: evBBM.id, teks: 'Rupiah melemah ke 18.000 per dolar', hari: 30 }, OWNER);
let [, f3] = await call('POST', '/api/forecasts', { event_id: evBBM.id, teks: 'Perkiraan salah ketik', hari: 30 }, OWNER);
[s] = await call('POST', '/api/forecasts/' + f3.id + '/hapus');
ok(s === 401, 'penguji tidak bisa menghapus perkiraan');
[s] = await call('POST', '/api/forecasts/' + f3.id + '/hapus', {}, OWNER);
[s, d] = await call('GET', '/api/forecasts');
ok(!d.forecasts.some((f) => f.id === f3.id), 'pemilik bisa menghapus perkiraan');
const fc1 = d.forecasts.find((f) => f.id === f1.id);
const fc2 = d.forecasts.find((f) => f.id === f2.id);
ok(fc1.kelompok === 'energi' && fc2.kelompok === 'keuangan' && d.kelompok.length === 7, 'perkiraan baru otomatis masuk kelompoknya (6 kelompok + lintas sektor)');
ok(fc1.perlu === true && fc1.jatuh_tempo && fc2.perlu === false && fc2.saran === null && /news\.google\.com\/search\?q=/.test(fc1.cari), 'perkiraan jatuh tempo ditandai perlu keputusan; tautan cek manual tersedia');
ok(d.ringkasan.perlu >= 1 && d.ringkasan.total === d.forecasts.length, 'ringkasan perkiraan tersedia');

// ---- Pengecekan semi-otomatis ----
sq.prepare("INSERT INTO articles (url, title, source, origin, published_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?)").run('https://contoh.id/bbm-naik', 'Pertamina umumkan harga BBM nonsubsidi naik', 'contoh.id', 'lokal', new Date(Date.now() - 5 * 86400e3).toISOString(), new Date().toISOString());
sq.prepare("INSERT INTO articles (url, title, source, origin, published_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?)").run('https://contoh.id/petugas', 'Petugas gas melon razia pangkalan', 'contoh.id', 'lokal', new Date(Date.now() - 4 * 86400e3).toISOString(), new Date().toISOString());
[s] = await call('POST', '/api/forecasts/' + f2.id + '/cek');
ok(s === 401, 'penguji tidak bisa meminta pengecekan');
[s] = await call('POST', '/api/forecasts/' + f2.id + '/cek', {}, OWNER);
[s, d] = await call('GET', '/api/forecasts');
ok(d.forecasts.find((f) => f.id === f2.id).antre === true, 'permintaan saran AI masuk antrean');
const aiBefore = aiCalls;
const chk = await tick();
console.log('  cek:', JSON.stringify(chk));
ok(chk.dicek === 2 && aiCalls === aiBefore + 1, 'satu giliran pengecekan: 2 perkiraan dalam 1 panggilan AI');
ok(/Pertamina umumkan harga BBM nonsubsidi naik/.test(lastCheckPrompt) && /resmi naik mulai hari ini/.test(lastCheckPrompt), 'bukti dari berita tersimpan dan pencarian Google News');
ok(!/Harga BBM lama sebelum peristiwa/.test(lastCheckPrompt), 'berita sebelum tanggal dasar tidak dipakai sebagai bukti');
ok(/USD\/IDR [\d.,]+ \(/.test(lastCheckPrompt), 'perkiraan rupiah diberi bukti perubahan kurs');
[s, d] = await call('GET', '/api/forecasts');
const c1 = d.forecasts.find((f) => f.id === f1.id);
const c2 = d.forecasts.find((f) => f.id === f2.id);
ok(c1.status === 'menunggu' && c1.saran.status === 'terjadi' && c1.saran.bukti.dipakai.join() === '1', 'saran AI tersimpan, nomor bukti palsu dibuang, status akhir belum berubah');
ok(c1.saran.bukti.berita.length >= 2 && c1.saran.bukti.berita.every((b) => b.tanggal >= c1.saran.bukti.dasar), 'bukti berita tersimpan untuk dicek pemilik');
ok(!c1.saran.bukti.berita.some((b) => /Petugas/.test(b.judul)), 'kata pendek tidak cocok di tengah kata lain (gas ≠ petugas)');
ok(c2.saran.status === 'belum' && !c2.antre, '"tidak terjadi" sebelum tanggal cek diubah menjadi "belum"');
const map = normalizeChecks({ cek: [{ id: 'P9', putusan: 'ngawur', keyakinan: 7, bukti: [1] }] }, [{ id: 9, tanggal_cek: '2000-01-01', bukti: { berita: [{}] } }]);
ok(map.get(9).status === 'belum' && map.get(9).keyakinan === 1, 'putusan tak dikenal menjadi "belum", keyakinan dibatasi');
[s] = await call('POST', '/api/forecasts/' + f1.id, { status: 'terjadi', dengan: 'saran-ai' }, OWNER);
[s, d] = await call('GET', '/api/forecasts');
const dec = d.forecasts.find((f) => f.id === f1.id);
ok(dec.status === 'terjadi' && dec.diputuskan_dengan === 'saran-ai' && d.ringkasan.banding >= 1 && d.ringkasan.sepakat >= 1, 'pemilik menyetujui saran; kesepakatan AI-pemilik dihitung');
const idle2 = await tick();
ok(idle2.dicek === 0, 'perkiraan yang baru dicek tidak dicek ulang terus-menerus');
sq.prepare("UPDATE ai_usage SET calls = 39 WHERE day = ?").run(new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10));
[s] = await call('POST', '/api/forecasts/' + f2.id + '/cek', {}, OWNER);
const q39 = await tick();
ok(q39.dicek === 0 && /Kuota/.test(q39.message), 'pengecekan berhenti saat kuota AI hampir habis');
sq.prepare("UPDATE ai_usage SET calls = ? WHERE day = ?").run(aiCalls, new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10));

// ---- Google News & pemilihan sumber ----
const gx = '<rss><channel>' + gnItem('Harga beras naik', 'Kompas', 'money.kompas.com', Date.now()) + gnItem('Oil up', 'Reuters', 'www.reuters.com', Date.now()) + gnItem('Kabar lain', 'Blog', 'blog.example.org', Date.now()) + '</channel></rss>';
const gp = parseGnews(gx, 'lokal');
ok(gp[0].title === 'Harga beras naik' && gp[0].source === 'money.kompas.com' && gp[0].origin === 'lokal', 'Google News: akhiran nama media dibuang, domain jadi sumber');
ok(gp[1].origin === 'internasional' && gp[2].origin === 'lokal', 'Google News: asal media dari domain, sisanya mengikuti edisi');
ok(originOf('industri.kontan.co.id', 'internasional') === 'lokal' && originOf('www.bbc.co.uk', 'lokal') === 'internasional', 'asal media: .id dan daftar media dikenali');
const many = Array.from({ length: 80 }, (_, i) => ({ url: 'https://a/' + i, title: 'Berita A nomor ' + i, source: 'a.com', origin: 'lokal', published_at: new Date(Date.now() - i * 60e3).toISOString() }));
const few = Array.from({ length: 4 }, (_, i) => ({ url: 'https://b/' + i, title: 'Berita B lama ' + i, source: 'b.com', origin: 'lokal', published_at: new Date(Date.now() - 86400e3 - i * 60e3).toISOString() }));
const sel = selectHeadlines([...many, ...few], 20, 10);
ok(sel.length === 20 && sel.filter((a) => a.source === 'b.com').length === 4, 'pemilihan bergiliran: media yang jarang menulis tetap terwakili');
gnewsDaily = true;
round = 7;
fetchLog = [];
[s, d] = await doRun(1);
ok(d.ok && fetchLog.filter((u) => u.includes('news.google.com/rss/search')).length === 12, 'pembaruan harian ikut mencari 12 topik Google News');
ok(fetchLog.length <= 45, `jumlah permintaan ke luar per pembaruan (${fetchLog.length}) di bawah batas 50 Cloudflare gratis`);
gnewsDaily = false;

// ---- Cek sumber (tanpa AI) ----
let [, cs] = await call('POST', '/api/sumber/cek', {}, OWNER);
const aiCs = aiCalls;
const csRun = await tick();
const csRow = sq.prepare('SELECT * FROM runs WHERE id = ?').get(cs.runId);
ok(csRun.runId === cs.runId && csRow.status === 'selesai' && /Cek sumber \(tanpa AI\)/.test(csRow.note) && /Antara terkini: HTTP 500/.test(csRow.note) && aiCalls === aiCs, 'cek sumber: jumlah per sumber dan sumber gagal tercatat, tanpa AI');
ok(sq.prepare("SELECT COUNT(*) AS n FROM articles WHERE run_id = ?").get(cs.runId).n === 0, 'cek sumber tidak menyimpan berita');
[s, d] = await call('GET', '/api/status');
ok(d.lastRun.trigger !== 'cek-sumber' && d.sumber.rss_lokal >= 8 && d.sumber.topik_en === 6, 'status: info pembaruan tidak tertimpa cek sumber; ringkasan sumber tersedia');

// ---- Isi riwayat ----
ok(bagiJendela('2026-10-01', '2026-10-10').map((j) => j.mulai + '..' + j.sampai).join() === '2026-10-01..2026-10-04,2026-10-05..2026-10-08,2026-10-09..2026-10-10', 'riwayat dibagi per 4 hari');
const contoh = pilihContohPerkiraan([
  { id: 1, tanggal: '2026-10-02', tingkat: 'global', indikator: [], articleIds: [1], dampak: [{ teks: 'A panjang', hari: 60 }, { teks: 'A pendek', hari: 7 }] },
  { id: 2, tanggal: '2026-10-02', tingkat: 'lokal', indikator: [], articleIds: [1, 2], dampak: [{ teks: 'B', hari: 7 }] },
], 4);
ok(contoh.length === 2 && contoh[0].teks === 'B' && contoh[1].teks === 'A pendek' && contoh[1].tanggal_cek === '2026-10-09', 'contoh perkiraan: jangka pendek dan berdampak ke Indonesia didahulukan, satu per peristiwa');
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const mulai = dayStr(Date.parse(today) - 10 * 86400e3);
[s] = await call('POST', '/api/riwayat', { mulai });
ok(s === 401, 'penguji tidak bisa mengisi riwayat');
// Peristiwa "lama" dari pembaruan biasa dipindah ke hari ini supaya riwayat mencakup 10 hari terakhir.
sq.prepare("UPDATE events SET tanggal = ? WHERE run_id IN (SELECT id FROM runs WHERE trigger IN ('jadwal','manual'))").run(today);
let [, rw] = await call('POST', '/api/riwayat', { mulai }, OWNER);
ok(rw.ok && rw.jendela === 3 && rw.sampai === dayStr(Date.parse(today) - 86400e3), 'riwayat: 3 jendela sampai kemarin');
let [, rw2] = await call('POST', '/api/riwayat', { mulai }, OWNER);
ok(rw2.jendela === 0 && rw2.dilewati === 3, 'meminta ulang tidak menggandakan jendela');
const nEvBefore = sq.prepare('SELECT COUNT(*) AS n FROM events').get().n;
const sigBefore = JSON.stringify((await call('GET', '/api/market'))[1].signals.map((x) => [x.id, x.label]));
const mundurkanRiwayat = () => sq.prepare("UPDATE runs SET finished_at = ? WHERE trigger = 'riwayat' AND finished_at IS NOT NULL").run(new Date(Date.now() - 20 * 60e3).toISOString());
// Google News menolak: jendela dijadwalkan ulang, bukan dianggap selesai.
gnewsDown = true;
gdeltRiwayatDown = true;
fetchLog = [];
const tolak = await tick();
const rowTolak = sq.prepare('SELECT * FROM runs WHERE id = ?').get(tolak.runId);
ok(tolak.percobaan === 1 && rowTolak.status === 'antre' && rowTolak.started_at > new Date().toISOString() && /percobaan=1/.test(rowTolak.note), 'riwayat yang ditolak Google News dijadwalkan ulang 30 menit lagi');
ok(fetchLog.filter((u) => u.includes('news.google.com')).length === 3, 'berhenti setelah 3 penolakan berturut-turut');
ok(sq.prepare("SELECT COUNT(*) AS n FROM runs WHERE trigger = 'riwayat' AND status = 'antre' AND started_at <= ?").get(new Date().toISOString()).n === 0, 'semua giliran riwayat ikut menunggu (jeda bersama)');
sq.prepare("UPDATE runs SET started_at = ? WHERE trigger = 'riwayat' AND status = 'antre' AND id != ?").run(new Date(Date.now() - 60e3).toISOString(), tolak.runId);
gnewsDown = false;
gdeltRiwayatDown = false;
for (let i = 0; i < 3; i++) {
  mundurkanRiwayat();
  if (i === 2) sq.prepare("UPDATE runs SET started_at = ? WHERE id = ?").run(new Date(Date.now() - 60e3).toISOString(), tolak.runId);
  const r = await tick();
  ok(r && r.ok && r.events >= 1, `jendela riwayat ${i + 1} diproses (${r && r.events} peristiwa)`);
  if (i === 0) {
    const jeda = await tick();
    ok(!jeda.runId, 'giliran riwayat berikutnya menunggu jeda 15 menit');
  }
}
const rwEvents = sq.prepare("SELECT e.* FROM events e JOIN runs r ON r.id = e.run_id WHERE r.trigger = 'riwayat'").all();
ok(rwEvents.length === sq.prepare('SELECT COUNT(*) AS n FROM events').get().n - nEvBefore && rwEvents.every((e) => e.tanggal >= mulai && e.tanggal < today), 'peristiwa riwayat bertanggal di dalam jendelanya');
const rwArts = sq.prepare("SELECT a.* FROM articles a JOIN runs r ON r.id = a.run_id WHERE r.trigger = 'riwayat'").all();
ok(rwArts.length > 0 && !rwArts.some((a) => a.title.startsWith('Berita sesudah jendela')), 'berita di luar jendela riwayat dibuang walau dikirim Google News');
ok(rwArts.some((a) => a.url.startsWith('https://gdelt.contoh/')), 'riwayat juga memakai GDELT dengan rentang tanggal sebagai cadangan');
ok(rwArts.some((a) => a.origin === 'lokal' && a.source === 'industri.kontan.co.id') && rwArts.some((a) => a.origin === 'internasional' && a.source === 'reuters.com'), 'riwayat mengambil media lokal dan internasional lewat Google News');
const sigAfter = JSON.stringify((await call('GET', '/api/market'))[1].signals.map((x) => [x.id, x.label]));
ok(sigBefore === sigAfter, 'peristiwa riwayat tidak mengacaukan sinyal lonjakan berita hari ini');
const rwFc = sq.prepare("SELECT * FROM forecasts WHERE asal = 'riwayat'").all();
ok(rwFc.length >= 3 && rwFc.every((f) => f.tanggal_cek > f.created_at.slice(0, 0)), `contoh perkiraan dari riwayat tercatat (${rwFc.length})`);
[s, d] = await call('GET', '/api/status', null, OWNER);
ok(d.riwayat.selesai === 3 && d.riwayat.total === 3 && d.lastRun.trigger !== 'riwayat', 'status: kemajuan riwayat; info pembaruan tetap dari pembaruan biasa');
[s, d] = await call('GET', '/api/review', null, OWNER);
const nightlyIds = new Set(d.pending.map((p) => p.id));
const rwLinkIds = sq.prepare("SELECT l.id FROM links l JOIN runs r ON r.id = l.run_id WHERE r.trigger = 'riwayat' AND l.status = 'usulan'").all().map((r) => r.id);
ok(rwLinkIds.length >= 1 && d.riwayat.total === rwLinkIds.length && rwLinkIds.every((id) => !nightlyIds.has(id)), 'usulan riwayat punya antrean sendiri, tidak masuk 5 usulan malam ini');
ok(!d.fresh.some((e) => rwEvents.some((r) => r.id === e.id)), '"peristiwa dari pembaruan terakhir" tidak berisi riwayat');
const sudahSebelum = d.sudah;
[s] = await call('POST', '/api/links/' + d.riwayat.pending[0].id, { status: 'disetujui' }, OWNER);
[s, d] = await call('GET', '/api/review', null, OWNER);
ok(d.sudah === sudahSebelum && d.riwayat.total === rwLinkIds.length - 1, 'menyetujui usulan riwayat tidak memakan jatah 5 per malam');
[s, d] = await call('GET', '/api/chains?days=30');
ok(d.chains.some((c) => c.jalur.some((x) => rwEvents.some((r) => r.id === x.event.id))), 'kaitan riwayat yang disetujui tampil di Rantai');
// Contoh perkiraan riwayat dicek setelah semua jendela selesai.
const rc = await tick();
ok(rc.dicek >= 1, 'contoh perkiraan riwayat dicek otomatis setelah riwayat selesai');
[s, d] = await call('GET', '/api/forecasts');
ok(d.forecasts.some((f) => f.asal === 'riwayat' && f.saran), 'contoh perkiraan riwayat punya saran AI');
// Riwayat tertahan saat kuota AI menipis.
[, rw] = await call('POST', '/api/riwayat', { mulai: dayStr(Date.parse(mulai) - 8 * 86400e3) }, OWNER);
sq.prepare("UPDATE ai_usage SET calls = 35 WHERE day = ?").run(today);
mundurkanRiwayat();
const held = await tick();
ok(rw.jendela === 2 && !held.runId && sq.prepare("SELECT COUNT(*) AS n FROM runs WHERE trigger = 'riwayat' AND status = 'antre'").get().n === 2, 'riwayat ditunda bila kuota AI tinggal cadangan untuk pembaruan harian');
[s, d] = await call('GET', '/api/chain/' + evBBM.id);
ok(Array.isArray(d.tercatat) && d.tercatat.some((t) => t.teks === 'Harga BBM nonsubsidi naik'), 'rantai menyertakan perkiraan yang sudah tercatat');

// ======================= Perbaikan sesudah uji produksi 23 Okt (18.20 WIB) =======================
// Pembaruan harian tidak boleh hilang bila bertabrakan dengan pekerjaan lain.
sq.prepare("INSERT INTO runs (started_at, trigger, status, note) VALUES (?, 'riwayat', 'berjalan', 'riwayat=2026-01-01..2026-01-02')").run(new Date().toISOString());
let ph; await worker.scheduled({ cron: '30 10 * * *' }, env, { waitUntil(x) { ph = x; } }); const harian = await ph;
const qh = sq.prepare('SELECT * FROM runs WHERE id = ?').get(harian.runId);
ok(harian.antre === true && qh.trigger === 'jadwal' && qh.status === 'antre', 'pembaruan harian yang bertabrakan masuk antrean, tidak dilewati');
sq.prepare("UPDATE runs SET status = 'selesai', finished_at = ? WHERE trigger = 'riwayat' AND status = 'berjalan'").run(new Date(Date.now() - 20 * 60e3).toISOString());
const jalanHarian = await tick();
ok(jalanHarian.runId === harian.runId && sq.prepare('SELECT status FROM runs WHERE id = ?').get(harian.runId).status === 'selesai', 'antrean pembaruan harian dijalankan jadwal 5 menit berikutnya, mendahului riwayat');
ok(dekatJadwalHarian(new Date('2026-10-23T10:30:00Z')) && dekatJadwalHarian(new Date('2026-10-23T10:15:00Z')) && !dekatJadwalHarian(new Date('2026-10-23T10:45:00Z')) && !dekatJadwalHarian(new Date('2026-10-23T09:30:00Z')), 'riwayat tidak dimulai sekitar 17.30 WIB');

// Bukti harga dinilai sampai tanggal cek, dengan titik tertinggi/terendah.
const fxDays = sq.prepare("SELECT day, nilai FROM market_prices WHERE kode = 'USDIDR' ORDER BY day").all();
const d0 = fxDays[fxDays.length - 12].day, d1 = fxDays[fxDays.length - 6].day;
const pc = await priceChange(DB, 'USDIDR', d0, d1);
ok(pc && pc.ke.day === d1 && pc.ke.day < fxDays.at(-1).day, 'perubahan kurs dihitung sampai tanggal cek, bukan sampai hari ini');
ok(pc.tertinggi.nilai >= pc.ke.nilai && pc.terendah.nilai <= pc.ke.nilai, 'titik tertinggi dan terendah dalam rentang tersedia');
const kal = hargaKalimat({ kode: 'USDIDR', nama: 'USD/IDR', dari: { day: '2026-10-02', nilai: 17950 }, ke: { day: '2026-10-12', nilai: 18010 }, perubahan: 0.33, tertinggi: { day: '2026-10-09', nilai: 18150, perubahan: 1.11 }, terendah: { day: '2026-10-12', nilai: 18010, perubahan: 0.33 } });
ok(/di antaranya tertinggi 18\.150 \(2026-10-09, \+1,11%\)/.test(kal) && !/terendah/.test(kal), 'kalimat harga menyebut titik tertinggi bila relevan');

// Bukti berita dibatasi sampai 3 hari sesudah tanggal cek bila tanggal cek sudah lewat.
const evOld = sq.prepare("SELECT id FROM events ORDER BY id LIMIT 1").get().id;
sq.prepare('UPDATE events SET tanggal = ? WHERE id = ?').run(dayStr(Date.now() - 30 * 86400e3), evOld);
for (const [t, ago] of [['Harga BBM nonsubsidi naik tajam di SPBU', 25], ['Harga BBM nonsubsidi turun lagi sebulan kemudian', 2]]) {
  sq.prepare("INSERT INTO articles (url, title, source, origin, published_at, fetched_at) VALUES (?, ?, 'contoh.id', 'lokal', ?, ?)").run('https://contoh.id/w/' + ago, t, new Date(Date.now() - ago * 86400e3).toISOString(), new Date().toISOString());
}
const bk = await kumpulkanBukti(DB, { id: 999, event_id: evOld, event_tanggal: dayStr(Date.now() - 30 * 86400e3), teks: 'Harga BBM nonsubsidi naik dalam 14 hari', tanggal_cek: dayStr(Date.now() - 16 * 86400e3) }, { cariOnline: false });
ok(bk.sampai && bk.berita.some((b) => /naik tajam/.test(b.judul)) && !bk.berita.some((b) => /turun lagi/.test(b.judul)), 'berita sesudah tanggal cek (+3 hari) tidak dipakai sebagai bukti');
const { gnewsUrl } = await import(ROOT + '/src/sources.js');
ok(decodeURIComponent(gnewsUrl({ q: 'bbm', edisi: 'id' }, { setelah: '2026-10-02', sebelum: '2026-10-20' })).includes('after:2026-10-02 before:2026-10-20'), 'pencarian bukti daring memakai batas after:/before:');
const sebar = sebarPerHari([...Array.from({ length: 12 }, (_, i) => ({ published_at: '2026-10-19T0' + (i % 9) + ':00:00Z', skor: 2 })), { published_at: '2026-10-03T01:00:00Z', skor: 1 }, { published_at: '2026-10-08T01:00:00Z', skor: 1 }], 5);
ok(sebar.length === 5 && sebar[0].published_at.startsWith('2026-10-03') && sebar[1].published_at.startsWith('2026-10-08'), 'bukti dipilih tersebar per hari, bukan menumpuk di ujung rentang');

// ======================= Setujui sekaligus usulan riwayat (24 Okt) =======================
const rwUsulan = sq.prepare("SELECT l.id FROM links l JOIN runs r ON r.id = l.run_id WHERE r.trigger = 'riwayat' AND l.status = 'usulan'").all().map((x) => x.id);
const harianUsulan = sq.prepare("SELECT l.id FROM links l WHERE l.status = 'usulan' AND (l.run_id IS NULL OR l.run_id NOT IN (SELECT id FROM runs WHERE trigger = 'riwayat'))").all().map((x) => x.id);
[s] = await call('POST', '/api/links/riwayat', { setujui: rwUsulan });
ok(s === 401, 'penguji tidak bisa menyetujui sekaligus');
[s, d] = await call('POST', '/api/links/riwayat', {}, OWNER);
ok(s === 400, 'tanpa pilihan ditolak');
const [, rvBefore] = await call('GET', '/api/review', null, OWNER);
ok(rvBefore.riwayat.total === rwUsulan.length && rwUsulan.length >= 2, `antrean riwayat lengkap (${rwUsulan.length}) untuk daftar centang`);
const pilih = rwUsulan.slice(0, rwUsulan.length - 1);
const sisaRw = rwUsulan.at(-1);
[s, d] = await call('POST', '/api/links/riwayat', { setujui: [...pilih, ...harianUsulan.slice(0, 2), 999999] }, OWNER);
ok(s === 200 && d.disetujui === pilih.length, 'setujui sekaligus: hanya usulan riwayat yang berubah');
ok(harianUsulan.slice(0, 2).every((id) => sq.prepare('SELECT status FROM links WHERE id = ?').get(id).status === 'usulan'), 'usulan harian tidak bisa disetujui lewat jalur riwayat (jatah 5 per malam tetap berlaku)');
const [, rvAfter] = await call('GET', '/api/review', null, OWNER);
ok(rvAfter.sudah === rvBefore.sudah && rvAfter.riwayat.total === 1, 'setujui sekaligus tidak memakai jatah malam; sisa 1 usulan riwayat');
const [, st2] = await call('GET', '/api/status', null, OWNER);
ok(st2.riwayatCentang === 0.6 && st2.tinjau.riwayat === 1, 'status menyertakan batas centang dan sisa usulan riwayat');
[s, d] = await call('POST', '/api/links/riwayat', { setujui: [pilih[0]], tolak: [sisaRw, pilih[0]] }, OWNER);
ok(d.ditolak === 1 && d.disetujui === 0 && sq.prepare('SELECT status FROM links WHERE id = ?').get(sisaRw).status === 'ditolak', 'tolak yang tidak dicentang; yang sudah disetujui tidak berubah');
const [, ch2] = await call('GET', '/api/chains?days=90');
const rwEv = new Set(sq.prepare("SELECT e.id FROM events e JOIN runs r ON r.id = e.run_id WHERE r.trigger = 'riwayat'").all().map((x) => x.id));
ok(ch2.chains.some((c) => c.jalur.some((x) => rwEv.has(x.event.id))), 'setelah disetujui sekaligus, peristiwa riwayat tampil di Rantai');

// ======================= Cari kaitan terbesar + batas tinjauan (24 Okt) =======================
// unit: kriteria "sebab dari tanggal lebih awal"
const rj = rankProposals([
  { ...base, id: 11, dari_id: 31, ke_id: 32, ke_tingkat: 'global', dari_tanggal: '2026-10-01', ke_tanggal: '2026-10-20' },
  { ...base, id: 12, dari_id: 33, ke_id: 34, ke_tingkat: 'global', dari_tanggal: '2026-10-18', ke_tanggal: '2026-10-20' },
], { approvedIds: new Set(), signals: [] });
ok(rj[0].id === 11 && rj[0].skor === 1 && rj[0].alasan_prioritas.includes('Sebab dari 19 hari sebelumnya') && rj[1].skor === 0, 'prioritas: sebab dari >= 7 hari sebelumnya mendapat 1 poin');

// unit: normalizeScan
const evs = [{ id: 1, tanggal: '2026-10-01' }, { id: 2, tanggal: '2026-10-05' }, { id: 3, tanggal: '2026-10-20' }];
const ns2 = normalizeScan({ kaitan: [
  { dari: 'E1', ke: 'E3', jenis: 'x', alasan: 'a', keyakinan: 3 },
  { dari: 'E3', ke: 'E2', jenis: 'menyebabkan', alasan: 'terbalik', keyakinan: 0.5 },
  { dari: 'E2', ke: 'E3', jenis: 'meredam', alasan: 'sudah ada', keyakinan: 0.5 },
  { dari: 'e1', ke: 'E2', jenis: 'memperkuat', alasan: 'b', keyakinan: 0.4 },
  { dari: 'E3', ke: 'E1', jenis: 'menyebabkan', alasan: 'ganda terbalik', keyakinan: 0.5 },
] }, evs, new Set(['2-3', '3-2']));
ok(ns2.length === 2 && ns2[0].dari === 1 && ns2[0].ke === 3 && ns2[0].jenis === 'menyebabkan' && ns2[0].keyakinan === 1 && ns2[1].dari === 1 && ns2[1].ke === 2, 'pemindaian: kode nyata, urutan tanggal, belum tercatat, tanpa ganda');

// API: pemilik meminta pemindaian
[s] = await call('POST', '/api/kaitan/cari');
ok(s === 401, 'penguji tidak bisa meminta pemindaian');
let [, sc1] = await call('POST', '/api/kaitan/cari', {}, OWNER);
let [, sc2] = await call('POST', '/api/kaitan/cari', {}, OWNER);
ok(sc1.ok && sc2.already && sc1.runId === sc2.runId, 'permintaan pemindaian ganda memakai antrean yang sama');
sq.prepare("UPDATE ai_usage SET calls = 0 WHERE day = ?").run(today);
// Peristiwa paling awal dibuat 40 hari lalu: harus ikut dipindai dan ditawarkan sebagai penyebab.
const tertua = sq.prepare("SELECT id FROM events WHERE status = 'aktif' ORDER BY id LIMIT 1").get().id;
sq.prepare('UPDATE events SET tanggal = ? WHERE id = ?').run(dayStr(Date.now() - 40 * 86400e3), tertua);
const scanQ = await tick();
const scanRun = sq.prepare('SELECT * FROM runs WHERE id = ?').get(sc1.runId);
ok(scanQ.runId === sc1.runId && scanRun.status === 'selesai' && /diminta pemilik/.test(scanRun.note), 'pemindaian diminta pemilik diproses jadwal 5 menit');
ok(lastScanPrompt.includes(dayStr(Date.now() - 40 * 86400e3)) && /jangan diulang/.test(lastScanPrompt), 'pemindaian mencakup peristiwa 40 hari lalu dan daftar pasangan yang sudah tercatat');
const scanLinks = sq.prepare("SELECT l.*, d.tanggal AS dt, k.tanggal AS kt FROM links l JOIN events d ON d.id = l.dari_id JOIN events k ON k.id = l.ke_id WHERE l.run_id = ?").all(sc1.runId);
ok(scanLinks.length >= 1 && scanLinks.every((l) => l.status === 'usulan' && l.dt <= l.kt), `usulan dari pemindaian tersimpan (${scanLinks.length})`);
const [, rvScan] = await call('GET', '/api/review', null, OWNER);
const jauhP = rvScan.pending.find((p) => scanLinks.some((l) => l.id === p.id));
ok(rvScan.lastScan && rvScan.lastScan.id === sc1.runId && rvScan.skorMaks === 4, 'Tinjau menampilkan hasil pemindaian terakhir dan skor maks 4');
ok(jauhP && jauhP.alasan_prioritas.some((a) => /^Sebab dari \d+ hari sebelumnya$/.test(a)), 'usulan jarak jauh dari pemindaian masuk antrean tinjauan malam dengan alasan "Sebab dari N hari sebelumnya"');
// Pembaruan harian menawarkan peristiwa lama (> 30 hari) sebagai pembanding.
round = 9;
lastLinkPrompt = '';
[s, d] = await doRun(1);
ok(d.ok && lastLinkPrompt.includes(dayStr(Date.now() - 40 * 86400e3)), 'pembaruan harian ikut menawarkan peristiwa 40 hari lalu sebagai penyebab');
