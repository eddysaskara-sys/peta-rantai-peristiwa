import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const worker = (await import(ROOT + '/src/index.js')).default;

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
let aiCalls = 0, failSchemaOnce = true;
const AI = {
  async run(model, input) {
    aiCalls++;
    if (input.response_format && failSchemaOnce) { failSchemaOnce = false; throw new Error('json_schema not supported'); }
    const u = input.messages[1].content;
    if (u.startsWith('Daftar berita')) {
      const n = (u.match(/^\d+\./gm) || []).length;
      const obj = { peristiwa: [
        { judul: 'Ketegangan di Selat Hormuz memanas', ringkasan: 'Kapal tanker terganggu.', tingkat: 'global', sektor: ['Minyak & Gas', 'geopolitik & keamanan', 'Sektor Ngarang'], indikator: ['Harga Minyak'], artikel: [1, n, 99], dua_sisi: 'Media lokal fokus BBM, internasional fokus militer.', dampak: [{ teks: 'Harga BBM nonsubsidi naik', hari: 30 }] },
        { judul: 'BI menahan suku bunga 5,75%', ringkasan: 'BI Rate tetap.', tingkat: 'lokal', sektor: ['Moneter'], indikator: ['BI Rate', 'Rupiah'], artikel: [3], dua_sisi: 'harus dibuang karena satu sisi', dampak: [] },
        { judul: 'Kekeringan ganggu panen gandum', ringkasan: 'Panen turun.', tingkat: 'global', sektor: ['Pertanian', 'Pangan'], indikator: ['Harga Pangan'], artikel: [n], dampak: [{ teks: 'Harga roti naik', hari: 500 }] },
        { judul: 'Tanpa artikel', ringkasan: '-', tingkat: 'lokal', sektor: [], artikel: [] },
      ] };
      // kembalikan sebagai teks berpagar agar jalur ekstraksi teruji
      return { response: 'Berikut hasilnya:\n```json\n' + JSON.stringify(obj) + '\n```' };
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
globalThis.fetch = async (url) => {
  url = String(url);
  if (url.includes('gdeltproject')) {
    if (url.includes('drought')) return new Response('Please limit requests to one every 5 seconds', { status: 429 });
    const loc = url.includes('sourcecountry%3Aindonesia');
    const arts = loc ? [gd('BI Rate Tetap di 5 , 75 %, Rupiah Tertekan', 1, 'Indonesia'), gd('Harga beras naik ( Bulog )', 2, 'Indonesia')]
                     : [gd('Oil jumps as Hormuz tensions rise', 1, 'United States'), gd('Tankers rerouted from Strait of Hormuz', 2, 'United Kingdom')];
    return new Response(JSON.stringify({ articles: arts }));
  }
  if (url.includes('cnbcindonesia')) return new Response(`<rss><channel><item><title><![CDATA[Harga BBM nonsubsidi naik &amp; antre]]></title><link>https://cnbcindonesia.com/r${round}/1</link><pubDate>${new Date(now - 3600e3).toUTCString()}</pubDate></item><item><title>Berita lama sekali</title><link>https://cnbcindonesia.com/old</link><pubDate>Mon, 01 Jan 2024 00:00:00 +0000</pubDate></item></channel></rss>`);
  if (url.includes('antaranews')) return new Response('nope', { status: 500 });
  if (url.includes('aljazeera')) return new Response(`<rss><channel><item><title>Drought hits wheat harvest in Europe &#039;badly&#039;</title><link>https://aljazeera.com/r${round}/a</link><pubDate>${new Date(now - 7200e3).toUTCString()}</pubDate></item></channel></rss>`);
  throw new Error('unexpected fetch ' + url);
};

const env = { DB, AI, ADMIN_PIN: 'rahasia123', ASSETS: { fetch: async () => new Response('<html>aset</html>') } };
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
ok(arts.includes('BI Rate Tetap di 5,75%, Rupiah Tertekan'), 'judul GDELT dirapikan: ' + arts[0]);
ok(!arts.includes('Berita lama sekali'), 'berita di luar rentang waktu dibuang');
ok(arts.some((a) => a.includes("'badly'")), 'entitas HTML didekode');
const run1 = sq.prepare('SELECT * FROM runs').all()[0];
ok(/antaranews/.test(run1.note) && /GDELT #4/.test(run1.note), 'sumber gagal tercatat di catatan: ' + JSON.stringify(run1.note));

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
const mg = d.sectors.find((x) => x.sektor === 'Minyak & Gas');
ok(mg.global === 1 && mg.terbaru, 'statistik sektor');

console.log('... pembaruan kedua (berita baru, ada peristiwa lama)');
round = 1; failSchemaOnce = false;
[s, d] = await doRun(3);
console.log(JSON.stringify(d));
ok(s === 200 && d.events === 3, 'pembaruan 2 berhasil');
const l2 = sq.prepare("SELECT * FROM links WHERE run_id = ?").all(d.runId);
ok(l2.some((l) => l.jenis === 'menyebabkan' && l.alasan === 'Lama ke baru'), 'kaitan lama->baru diterima, jenis aneh jadi "menyebabkan"');
ok(!l2.some((l) => l.alasan === 'lama-lama ditolak'), 'kaitan lama->lama ditolak');

round = 1;
[s, d] = await doRun(1);
ok(s === 200 && d.events === 0, 'pembaruan tanpa berita baru tidak memanggil AI');

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
ok(d.counts.ai_calls === 4, 'pemakaian AI tercatat (4 panggilan)');
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
ok((await p4) === null, 'jadwal 5 menit tanpa antrean tidak melakukan apa-apa');
