// Tes fitur percobaan Pandangan Video (src/video.js). Memakai D1, YouTube, dan Gemini tiruan.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, Math.min(ms || 0, 5), ...a);
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const worker = (await import(ROOT + '/src/index.js')).default;
const V = await import(ROOT + '/src/video.js');

const ok = (cond, msg) => { console.log((cond ? 'LULUS ' : 'GAGAL ') + msg); if (!cond) process.exitCode = 1; };

// ---- D1 tiruan (sama dengan test/harness.mjs) ----
const sq = new DatabaseSync(':memory:');
sq.exec(readFileSync(ROOT + '/schema.sql', 'utf8'));
const norm = (p) => p.map((v) => (v === undefined ? null : v));
class Stmt {
  constructor(sql) { this.sql = sql; this.p = []; }
  bind(...p) { if (p.length > 100) throw new Error('D1_ERROR: too many SQL variables'); this.p = norm(p); return this; }
  _all() { return sq.prepare(this.sql).all(...this.p); }
  async first() { return this._all()[0] || null; }
  async all() { return { results: this._all() }; }
  async run() { const r = sq.prepare(this.sql).run(...this.p); return { meta: { changes: r.changes } }; }
}
const DB = {
  prepare: (sql) => new Stmt(sql),
  batch: async (stmts) => { sq.exec('BEGIN'); try { const out = stmts.map((s) => /RETURNING|^\s*SELECT/i.test(s.sql) ? { results: s._all() } : (sq.prepare(s.sql).run(...s.p), {})); sq.exec('COMMIT'); return out; } catch (e) { sq.exec('ROLLBACK'); throw e; } },
};

// ---- Data awal: 4 peristiwa, 1 kaitan disetujui ----
const day = (n) => new Date(Date.now() - n * 86400e3 + 7 * 3600e3).toISOString().slice(0, 10);
const ins = sq.prepare("INSERT INTO events (run_id, tanggal, judul, ringkasan, tingkat, sektor, indikator, dua_sisi, dampak, created_at) VALUES (1, ?, ?, '', ?, ?, '[]', '', '[]', ?) RETURNING id");
const e1 = ins.get(day(10), 'Ketegangan Selat Hormuz memanas', 'global', '["Minyak & Gas"]', new Date().toISOString()).id;
const e2 = ins.get(day(8), 'Harga minyak Brent naik ke $95', 'global', '["Minyak & Gas"]', new Date().toISOString()).id;
const e3 = ins.get(day(5), 'Rupiah melemah ke Rp17.400 per dolar', 'lokal', '["Moneter"]', new Date().toISOString()).id;
const e4 = ins.get(day(3), 'BI menahan BI Rate di 5,75%', 'lokal', '["Moneter"]', new Date().toISOString()).id;
const lnk = sq.prepare("INSERT INTO links (dari_id, ke_id, jenis, alasan, keyakinan, status, dibuat_oleh, created_at) VALUES (?, ?, 'menyebabkan', 'Pasokan terganggu', 0.8, 'disetujui', 'ai', ?) RETURNING id").get(e1, e2, new Date().toISOString()).id;
sq.prepare("INSERT INTO links (dari_id, ke_id, jenis, alasan, keyakinan, status, dibuat_oleh, created_at) VALUES (?, ?, 'menyebabkan', 'Impor minyak menekan rupiah', 0.7, 'disetujui', 'ai', ?)").run(e2, e3, new Date().toISOString());

// ---- fetch tiruan ----
const CH = 'UC' + 'abcdefghij0123456789_-';
const iso = (n) => new Date(Date.now() - n * 86400e3).toISOString();
const entry = (id, judul, n, shorts = false) => `<entry><id>yt:video:${id}</id><yt:videoId>${id}</yt:videoId><yt:channelId>${CH}</yt:channelId><title>${judul}</title>
  <link rel="alternate" href="https://www.youtube.com/${shorts ? 'shorts/' + id : 'watch?v=' + id}"/><author><name>Bennix</name><uri>https://www.youtube.com/channel/${CH}</uri></author>
  <published>${iso(n)}</published><media:group><media:title>${judul}</media:title><media:description>Deskripsi &amp; catatan</media:description></media:group></entry>`;
const FEED = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><title>Bennix</title>
  ${entry('vidBaru0001', 'Rupiah Tertekan, Minyak Naik: Apa Artinya untuk IHSG?', 2)}
  ${entry('vidShort001', 'Shorts: BI Rate', 1, true)}
  ${entry('vidLama0001', 'Review Tahun Lalu', 30)}</feed>`;
let geminiMode = 'normal';
let geminiBodies = [];
let fetchLog = [];
const geminiJawab = () => ({
  relevan: true,
  ringkasan: 'Pembicara membahas dampak harga minyak terhadap rupiah dan BI Rate.',
  klaim: [
    { jenis: 'dukung', teks: 'Gangguan di Hormuz membuat pasokan minyak tersendat sehingga Brent naik.', menit: '3:15', kaitan: 'K1' },
    { jenis: 'bantah', teks: 'Pelemahan rupiah lebih karena dolar global, bukan impor minyak.', menit: '1:02:03', kaitan: 'K2' },
    { jenis: 'perkiraan', teks: 'Rupiah melemah melewati Rp17.800 dalam 30 hari', menit: '10:00', peristiwa: 'E3', hari: 30 },
    { jenis: 'perkiraan', teks: 'IHSG turun 5% dalam 60 hari', menit: '12:00', hari: 2000 },
    { jenis: 'pandangan', teks: 'Saatnya beli BBCA di harga diskon.', menit: '20:00' },
    { jenis: 'pandangan', teks: 'Asing banyak jual TLKM, sebaiknya jual juga.' },
    { jenis: 'kaitan_baru', teks: 'Brent naik membuat BI menahan suku bunga.', menit: '7:00', dari: 'E2', ke: 'E4' },
    { jenis: 'kaitan_baru', teks: 'Hormuz menaikkan Brent (sudah tercatat).', menit: '2:00', dari: 'E1', ke: 'E2' },
    { jenis: 'aneh', teks: 'jenis tidak dikenal' },
    { jenis: 'kaitan_baru', teks: 'Arah terbalik tidak boleh jadi kaitan.', dari: 'E4', ke: 'E1', menit: 'kapan-kapan' },
    { jenis: 'dukung', teks: 'Kode kaitan palsu jadi pandangan.', kaitan: 'K99' },
    { jenis: 'pandangan', teks: 'Klaim kesembilan melewati batas 8 klaim.' },
  ],
});
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  fetchLog.push(url);
  if (url === 'https://www.youtube.com/@bennix') {
    const html = '<html><head>' + 'x'.repeat(9000) + `<link rel="alternate" type="application/rss+xml" title="RSS" href="https://www.youtube.com/feeds/videos.xml?channel_id=${CH}"></head></html>`;
    return new Response(html);
  }
  if (url.startsWith('https://www.youtube.com/feeds/videos.xml?channel_id=' + CH)) return new Response(FEED);
  if (url.includes('generativelanguage.googleapis.com/v1beta/models?')) {
    if ((opts.headers || {})['x-goog-api-key'] !== 'kunci-gemini') return new Response('{}', { status: 403 });
    return new Response(JSON.stringify({ models: [
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
      { name: 'models/gemini-3.8-flash-lite', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.8-flash-image', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    ] }));
  }
  if (url.includes(':generateContent')) {
    const body = JSON.parse(opts.body);
    geminiBodies.push({ url, body });
    if (geminiMode === 'kuota') return new Response('{"error":{"code":429,"message":"Resource exhausted"}}', { status: 429 });
    if (geminiMode === 'normal' && body.contents[0].parts[0].video_metadata) return new Response('{"error":{"message":"Invalid value at video_metadata.end_offset"}}', { status: 400 });
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'berpikir...', thought: true }, { text: JSON.stringify(geminiJawab()) }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 123456 },
    }));
  }
  return new Response('not found', { status: 404 });
};

const env0 = { DB, AI: { run: async () => ({}) }, ADMIN_PIN: 'rahasia123', ASSETS: { fetch: async () => new Response('aset') } };
const env = { ...env0, GEMINI_API_KEY: 'kunci-gemini' };
const OWNER = 'rahasia123';
const call = async (e, method, path, body, pin) => {
  let tunggu = [];
  const r = await worker.fetch(new Request('https://x.dev' + path, { method, headers: pin ? { 'x-pin': pin } : {}, body: body ? JSON.stringify(body) : undefined }), e, { waitUntil(p) { tunggu.push(p); } });
  await Promise.all(tunggu);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return [r.status, j];
};
const tabel = () => sq.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'video%'").all().map((r) => r.name);

// ======================= Tanpa GEMINI_API_KEY: fitur tidur =======================
let [s, d] = await call(env0, 'GET', '/api/video');
ok(s === 200 && d.aktif === false && d.videos.length === 0 && d.pengaturan.channels[0].handle === '@bennix', 'tanpa key: /api/video menyatakan belum aktif');
[s, d] = await call(env0, 'GET', '/api/video/catatan');
ok(s === 200 && d.aktif === false && d.catatan.length === 0, 'tanpa key: catatan kosong');
let pv; await worker.scheduled({ cron: V.VIDEO_CRON }, env0, { waitUntil(x) { pv = x; } });
const tidur = await pv;
ok(tidur.nonaktif && fetchLog.length === 0 && tabel().length === 0, 'tanpa key: jadwal video tidak mengambil apa pun dan tidak membuat tabel');
[s, d] = await call(env0, 'POST', '/api/video/periksa', {}, OWNER);
ok(s === 400 && /GEMINI_API_KEY/.test(d.error), 'tanpa key: periksa sekarang menjelaskan secret yang perlu diisi');

// ======================= Unit =======================
ok(V.pilihModel(['models/gemini-2.5-flash', 'models/gemini-3.8-flash-lite', 'models/gemini-3.8-flash', 'models/gemini-flash-latest', 'models/gemini-3.8-flash-image', 'models/gemini-3.9-flash-preview'])
  .join() === 'gemini-3.8-flash,gemini-2.5-flash,gemini-flash-latest,gemini-3.9-flash-preview,gemini-3.8-flash-lite', 'pilihModel: Flash stabil terbaru dulu, alias, preview, lalu Lite; model gambar dibuang');
const feed = V.parseFeedYoutube(FEED);
ok(feed.length === 3 && feed[0].video_id === 'vidBaru0001' && feed[0].channel_nama === 'Bennix' && feed[0].deskripsi === 'Deskripsi & catatan' && feed[1].shorts && !feed[0].shorts, 'parseFeedYoutube: id, channel, deskripsi, penanda Shorts');
ok(V.parseMenit('3:15') === 195 && V.parseMenit('1:02:03') === 3723 && V.parseMenit('kapan') === null && V.parseMenit(90) === 90, 'parseMenit');
ok(V.isRekomendasi('Saatnya beli BBCA di harga diskon') && V.isRekomendasi('Asing jual TLKM, sebaiknya jual juga') && !V.isRekomendasi('Asing banyak aksi jual di IHSG karena rupiah melemah') && !V.isRekomendasi('Investor asing keluar dari pasar obligasi'),
  'isRekomendasi: saran beli/jual saham dibuang, arus dana makro tetap');

// ======================= Dengan key =======================
fetchLog = [];
[s] = await call(env, 'POST', '/api/video/periksa', {});
ok(s === 401, 'periksa sekarang tanpa PIN ditolak');
[s, d] = await call(env, 'POST', '/api/video/periksa', {}, OWNER);
ok(s === 200 && d.ok && d.feed.baru === 3 && d.analisis.video_id === 'vidBaru0001' && d.analisis.ok, `periksa sekarang: feed dibaca dan video terbaru diringkas (${JSON.stringify(d.analisis)})`);
ok(tabel().length === 3, 'tabel video dibuat otomatis saat pertama dipakai');
const vids = Object.fromEntries(sq.prepare('SELECT video_id, status, alasan, model, token FROM videos').all().map((r) => [r.video_id, r]));
ok(vids.vidShort001.status === 'dilewati' && /Shorts/.test(vids.vidShort001.alasan) && vids.vidLama0001.status === 'dilewati' && /14 hari/.test(vids.vidLama0001.alasan), 'Shorts dan video > 14 hari dilewati');
ok(vids.vidBaru0001.status === 'selesai' && vids.vidBaru0001.model === 'gemini-3.8-flash' && vids.vidBaru0001.token === 123456 && /2 rekomendasi saham/.test(vids.vidBaru0001.alasan), 'video diringkas dengan model Flash terbaru; 2 rekomendasi saham tidak dicatat');
ok(fetchLog.includes('https://www.youtube.com/@bennix') && fetchLog.some((u) => u.includes('feeds/videos.xml?channel_id=' + CH)), 'channel ID dicari dari halaman @handle lalu feed dibaca');
const g1 = geminiBodies[0].body;
ok(g1.contents[0].parts[0].file_data.file_uri === 'https://www.youtube.com/watch?v=vidBaru0001' && g1.contents[0].parts[0].video_metadata.end_offset === '1800s' && g1.generationConfig.mediaResolution === 'MEDIA_RESOLUTION_LOW',
  'Gemini menerima URL YouTube, potongan 30 menit, resolusi rendah');
ok(geminiBodies.length === 2 && !geminiBodies[1].body.contents[0].parts[0].video_metadata && geminiBodies[1].url.includes('gemini-3.8-flash:generateContent'), 'bila potongan video ditolak, dicoba ulang tanpa potongan');
const prompt = g1.contents[0].parts[1].text;
ok(/E1 \[[\d-]+ \| global\] Ketegangan Selat Hormuz/.test(prompt) && /K1: E1 → E2 \(menyebabkan\)/.test(prompt) && /ABAIKAN rekomendasi beli\/jual/.test(prompt), 'prompt berisi kode peristiwa, kode kaitan, dan larangan rekomendasi saham');

const klaim = sq.prepare('SELECT * FROM video_klaim ORDER BY id').all();
const by = (j) => klaim.filter((k) => k.jenis === j);
ok(by('dukung').length === 2 && by('dukung').every((k) => k.link_id === lnk) && by('dukung')[0].detik === 195, `dukung: K1 tercatat pada kaitan yang benar; "kaitan_baru" yang sudah tercatat jadi dukung (${by('dukung').length})`);
ok(by('bantah').length === 1 && by('bantah')[0].detik === 3723, 'bantah tercatat dengan menit j:mm:ss');
const pk = by('perkiraan');
ok(pk.length === 2 && pk[0].event_id === e3 && pk[0].hari === 30 && pk[1].event_id === null && pk[1].hari === 180, 'perkiraan: peristiwa dasar dari kode E; jangka waktu dibatasi 7–180 hari');
ok(by('kaitan_baru').length === 1 && by('kaitan_baru')[0].dari_id === e2 && by('kaitan_baru')[0].ke_id === e4, 'ide kaitan baru disimpan dengan penyebab dan akibatnya');
ok(by('pandangan').length === 2 && by('pandangan').some((k) => /palsu/.test(k.teks)) && by('pandangan').some((k) => /terbalik/.test(k.teks) && k.detik === null && k.dari_id === null), 'kode palsu dan kaitan arah terbalik turun menjadi pandangan; menit tidak valid dikosongkan');
ok(!klaim.some((k) => /BBCA|TLKM/.test(k.teks)) && !klaim.some((k) => /tidak dikenal|kesembilan/.test(k.teks)) && klaim.length === 8, 'rekomendasi saham dan jenis tak dikenal tidak tersimpan; maks. 8 klaim');
ok(sq.prepare("SELECT COUNT(*) AS n FROM links WHERE status = 'usulan'").get().n === 0, 'pandangan video tidak menambah usulan kaitan ke antrean Tinjau');

// ======================= API untuk tampilan =======================
[s, d] = await call(env, 'GET', '/api/video/catatan');
ok(s === 200 && d.aktif && d.catatan.length === 3 && d.catatan.filter((c) => c.link_id === lnk).length === 2 && d.catatan[0].url.includes('&t=') && d.catatan[0].video.channel === 'Bennix', 'catatan ▶ publik untuk kaitan, dengan tautan ke menit video');
[s, d] = await call(env, 'GET', '/api/video');
ok(d.videos.length === 1 && d.videos[0].status === 'selesai' && d.videos[0].alasan === null && d.galat === null, 'pengunjung hanya melihat video yang sudah diringkas, tanpa catatan internal');
[s, d] = await call(env, 'GET', '/api/video', null, OWNER);
const vb = d.videos.find((v) => v.video_id === 'vidBaru0001');
ok(d.videos.length === 3 && d.channels[0].id === CH && d.analisis_hari_ini === 1 && vb.klaim.length === 8, 'pemilik melihat semua video, channel, dan kuota harian');
const kD = vb.klaim.find((k) => k.jenis === 'dukung');
const kP = vb.klaim.find((k) => k.jenis === 'perkiraan' && k.event);
ok(kD.link.dari.judul.includes('Hormuz') && kD.link.ke.judul.includes('Brent') && kP.tanggal_cek === addD(vb.tanggal, 30), 'klaim membawa judul kedua ujung kaitan dan tanggal cek perkiraan dari tanggal video');
function addD(a, n) { const x = new Date(a + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
[s, d] = await call(env, 'GET', '/api/chains');
const step = d.chains[0].jalur.find((j) => j.link);
ok(step && step.link.id === lnk, 'rantai utama mengirim id kaitan agar catatan ▶ bisa ditempel');

// ======================= Catat perkiraan dari video =======================
[s] = await call(env, 'POST', `/api/video/klaim/${kP.id}/catat`, {});
ok(s === 401, 'catat perkiraan tanpa PIN ditolak');
const kTanpa = vb.klaim.find((k) => k.jenis === 'perkiraan' && !k.event);
[s, d] = await call(env, 'POST', `/api/video/klaim/${kTanpa.id}/catat`, {}, OWNER);
ok(s === 400 && /belum terhubung/.test(d.error), 'perkiraan tanpa peristiwa dasar tidak bisa dicatat');
[s, d] = await call(env, 'POST', `/api/video/klaim/${kP.id}/catat`, {}, OWNER);
ok(s === 200 && d.ok && d.tanggal_cek === kP.tanggal_cek, 'perkiraan video dicatat ke Perkiraan');
const fc = sq.prepare('SELECT * FROM forecasts WHERE id = ?').get(d.id);
ok(fc.asal === 'video' && fc.event_id === e3 && fc.status === 'menunggu', "perkiraan tersimpan dengan asal 'video'");
[s, d] = await call(env, 'POST', `/api/video/klaim/${kP.id}/catat`, {}, OWNER);
ok(d.sudah === true && sq.prepare("SELECT COUNT(*) AS n FROM forecasts WHERE asal = 'video'").get().n === 1, 'dicatat dua kali tetap satu perkiraan');
[s, d] = await call(env, 'GET', '/api/forecasts');
const fcv = d.forecasts.find((f) => f.asal === 'video');
ok(fcv && fcv.video.channel === 'Bennix' && fcv.video.url.includes('&t=600s') && fcv.kelompok === 'keuangan', 'tab Perkiraan menampilkan sumber video dan kelompok sektornya');

// ======================= Ringkas ulang, hapus, kuota =======================
[s, d] = await call(env, 'POST', '/api/video/vidBaru0001/proses', {}, OWNER);
const klaim2 = sq.prepare("SELECT * FROM video_klaim WHERE video_id = 'vidBaru0001'").all();
ok(d.ok && klaim2.length === 9 && klaim2.filter((k) => k.forecast_id).length === 1, 'ringkas ulang mengganti klaim, kecuali perkiraan yang sudah dicatat');
const hapusId = klaim2.find((k) => k.jenis === 'bantah').id;
[s, d] = await call(env, 'POST', `/api/video/klaim/${hapusId}/hapus`, {}, OWNER);
ok(d.ok && !sq.prepare('SELECT id FROM video_klaim WHERE id = ?').get(hapusId), 'pemilik bisa menghapus klaim yang salah tangkap');
// video lama dilewati bisa diminta; kuota Gemini habis -> dicoba lagi nanti, bukan gagal
geminiMode = 'kuota';
[s, d] = await call(env, 'POST', '/api/video/vidLama0001/proses', {}, OWNER);
const lama = sq.prepare("SELECT * FROM videos WHERE video_id = 'vidLama0001'").get();
ok(d.ok === false && d.kuota && lama.status === 'baru' && lama.percobaan === 0 && lama.coba_lagi > new Date().toISOString() && /Kuota Gemini/.test(lama.alasan), 'kuota Gemini habis: video menunggu dicoba lagi, tidak dihitung gagal');
geminiMode = 'tanpa-potongan';
await V._uji.setState(DB, 'analisis:' + day(0), String(V.VIDEO_MAKS_HARIAN));
sq.prepare("UPDATE videos SET coba_lagi = NULL WHERE video_id = 'vidLama0001'").run();
const kuota = await V.videoTick(env);
ok(kuota.ok && kuota.analisis.kuota && sq.prepare("SELECT status FROM videos WHERE video_id = 'vidLama0001'").get().status === 'baru', `batas ${V.VIDEO_MAKS_HARIAN} video per hari dipatuhi jadwal otomatis`);

// ======================= Jadwal =======================
await V._uji.setState(DB, 'analisis:' + day(0), '0');
await V._uji.setState(DB, 'gemini_at', new Date(Date.now() - 60 * 60000).toISOString());
const runsSebelum = sq.prepare('SELECT COUNT(*) AS n FROM runs').get().n;
let pj; await worker.scheduled({ cron: V.VIDEO_CRON }, env, { waitUntil(x) { pj = x; } });
const jadwal = await pj;
ok(jadwal.ok && jadwal.analisis.video_id === 'vidLama0001' && sq.prepare("SELECT status FROM videos WHERE video_id = 'vidLama0001'").get().status === 'selesai', 'jadwal video meringkas video yang menunggu');
ok(sq.prepare('SELECT COUNT(*) AS n FROM runs').get().n === runsSebelum && sq.prepare("SELECT calls FROM ai_usage").all().length === 0, 'jadwal video tidak menyentuh antrean berita dan kuota Workers AI');
const lagi = await V.videoTick(env);
ok(lagi.ok && (lagi.analisis.jeda || lagi.analisis.kosong) && !lagi.feed, 'jadwal berikutnya menunggu jeda dan tidak membaca feed sebelum 3 jam');
