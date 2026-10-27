/**
 * Pandangan Video (fitur percobaan, branch fitur/pandangan-video, 27 Okt 2026).
 *
 * Video opini YouTube (mis. channel Bennix) diringkas Gemini API dan ditempel ke rantai sebagai
 * CATATAN, bukan sebagai peristiwa:
 *   RSS channel YouTube -> Gemini membaca video (URL YouTube publik) -> klaim terstruktur:
 *   - "dukung" / "bantah": catatan ▶ pada kaitan yang sudah disetujui (rantai tidak berubah);
 *   - "perkiraan": bisa dicatat pemilik ke Perkiraan (asal 'video'), lalu dicek seperti perkiraan lain;
 *   - "kaitan_baru" dan "pandangan": hanya tampil di tab Video, tidak masuk rantai atau antrean tinjauan.
 *
 * Semua kode fitur ini ada di file ini, public/video.js, dan public/video.css. Tabelnya dibuat sendiri
 * saat pertama dipakai (lihat migrations/0004_video.sql). Fitur tidur sampai secret GEMINI_API_KEY diisi.
 * Gemini dipakai terpisah dari Workers AI, jadi tidak memakai kuota 40 panggilan per hari.
 */
import { json, wibDate, wibDayStartIso, nowIso, addDays, wibDateDaysAgo, allInChunks, sleep } from './util.js';
import { extractJson } from './ai.js';
import { decodeEntities } from './sources.js';

// ---------- Pengaturan ----------

// Channel yang dipantau. "handle" = alamat @ channel. Bila handle tidak bisa dibaca dari Cloudflare,
// isi "channel_id" (UC..., 24 karakter; ada di sumber halaman channel sebagai "channel_id=").
export const VIDEO_CHANNELS = [
  { handle: '@bennix', nama: 'Bennix' },
];
export const VIDEO_CRON = '7,22,37,52 * * * *'; // jadwal sendiri, terpisah dari antrean berita
export const VIDEO_HARI = 14; // video lebih tua dari ini tidak diringkas otomatis (pemilik tetap bisa memintanya)
export const VIDEO_MAKS_HARIAN = 4; // video yang diringkas Gemini per hari (kuota gratis YouTube: 8 jam/hari)
export const VIDEO_MAKS_MENIT = 30; // hanya 30 menit pertama yang dibaca, agar hemat token dan kuota
export const VIDEO_RSS_JAM = 3; // feed channel diperiksa tiap 3 jam
export const VIDEO_JEDA_MENIT = 10; // jeda antar peringkasan otomatis
export const VIDEO_MAKS_COBA = 3;
export const VIDEO_KLAIM_MAKS = 8;
const KONTEKS_HARI = 45; // peristiwa dan kaitan yang ditawarkan ke Gemini
const KONTEKS_PERISTIWA = 100;
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL_CADANGAN = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const UA = 'Mozilla/5.0 (compatible; PetaRantaiPeristiwa/1.0; prototipe pribadi)';
export const JENIS_KLAIM = ['dukung', 'bantah', 'perkiraan', 'kaitan_baru', 'pandangan'];

// ---------- Tabel ----------

const DDL = [
  `CREATE TABLE IF NOT EXISTS videos (video_id TEXT PRIMARY KEY, channel_id TEXT, channel_nama TEXT, judul TEXT NOT NULL, url TEXT NOT NULL,
    terbit TEXT, deskripsi TEXT, status TEXT NOT NULL DEFAULT 'baru', alasan TEXT, ringkasan TEXT, model TEXT, token INTEGER,
    percobaan INTEGER NOT NULL DEFAULT 0, coba_lagi TEXT, diminta TEXT, diproses_at TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS video_klaim (id INTEGER PRIMARY KEY AUTOINCREMENT, video_id TEXT NOT NULL, jenis TEXT NOT NULL, teks TEXT NOT NULL,
    detik INTEGER, link_id INTEGER, event_id INTEGER, dari_id INTEGER, ke_id INTEGER, hari INTEGER, forecast_id INTEGER, created_at TEXT NOT NULL)`,
  'CREATE TABLE IF NOT EXISTS video_state (kunci TEXT PRIMARY KEY, nilai TEXT, updated_at TEXT)',
  'CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status, terbit)',
  'CREATE INDEX IF NOT EXISTS idx_video_klaim_video ON video_klaim(video_id)',
  'CREATE INDEX IF NOT EXISTS idx_video_klaim_link ON video_klaim(link_id)',
  'CREATE INDEX IF NOT EXISTS idx_video_klaim_fc ON video_klaim(forecast_id)',
];

let tabelSiap = false;
export async function ensureTables(db) {
  if (tabelSiap) return;
  await db.batch(DDL.map((s) => db.prepare(s)));
  tabelSiap = true;
}

async function getState(db, kunci) {
  return (await db.prepare('SELECT nilai FROM video_state WHERE kunci = ?').bind(kunci).first())?.nilai ?? null;
}
async function setState(db, kunci, nilai) {
  await db
    .prepare('INSERT INTO video_state (kunci, nilai, updated_at) VALUES (?, ?, ?) ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai, updated_at = excluded.updated_at')
    .bind(kunci, nilai == null ? null : String(nilai), nowIso())
    .run();
}
async function tambahState(db, kunci) {
  const row = await db
    .prepare("INSERT INTO video_state (kunci, nilai, updated_at) VALUES (?, '1', ?) ON CONFLICT(kunci) DO UPDATE SET nilai = CAST(CAST(nilai AS INTEGER) + 1 AS TEXT), updated_at = excluded.updated_at RETURNING nilai")
    .bind(kunci, nowIso())
    .first();
  return Number(row?.nilai) || 0;
}

// ---------- YouTube: channel dan feed ----------

/** Cari channel ID (UC...) dari halaman @handle. Dibaca bertahap dan berhenti begitu ketemu, agar hemat CPU. */
export async function cariIdChannel(handle) {
  const h = String(handle || '').trim();
  if (!/^@[\w.-]{2,100}$/.test(h)) throw new Error(`handle "${h}" tidak valid`);
  const r = await fetch(`https://www.youtube.com/${h}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'id-ID,id;q=0.9', Cookie: 'SOCS=CAI' },
  });
  if (!r.ok) throw new Error(`halaman channel HTTP ${r.status}`);
  const pola = /(?:feeds\/videos\.xml\?channel_id=|"externalId":"|youtube\.com\/channel\/)(UC[\w-]{22})/;
  if (!r.body || !r.body.getReader) {
    const m = pola.exec(await r.text());
    if (m) return m[1];
    throw new Error('channel ID tidak ditemukan di halaman');
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let total = 0;
  while (total < 2_000_000) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    buf += dec.decode(value, { stream: true });
    const m = pola.exec(buf);
    if (m) {
      reader.cancel().catch(() => {});
      return m[1];
    }
    if (buf.length > 4000) buf = buf.slice(-4000);
  }
  reader.cancel().catch(() => {});
  throw new Error('channel ID tidak ditemukan di halaman');
}

function isi(s, name) {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(s);
  if (!m) return '';
  let v = m[1].trim();
  if (v.startsWith('<![CDATA[')) v = v.slice(9, v.endsWith(']]>') ? -3 : undefined);
  return decodeEntities(v).trim();
}

/** Feed Atom channel YouTube: daftar video terbaru (biasanya 15). */
export function parseFeedYoutube(xml, fallbackNama = '') {
  const out = [];
  const nama = isi(xml.split('<entry')[0], 'title') || fallbackNama;
  for (const blok of xml.split('<entry').slice(1)) {
    const e = blok.split('</entry>')[0];
    const id = isi(e, 'yt:videoId');
    const link = /<link[^>]*rel="alternate"[^>]*href="([^"]+)"/.exec(e)?.[1] || (id ? `https://www.youtube.com/watch?v=${id}` : '');
    if (!/^[\w-]{6,20}$/.test(id) || !/^https:\/\/(www\.)?youtube\.com\//.test(link)) continue;
    const terbit = Date.parse(isi(e, 'published'));
    out.push({
      video_id: id,
      judul: isi(e, 'title').slice(0, 300) || '(tanpa judul)',
      url: link.includes('/shorts/') ? link : `https://www.youtube.com/watch?v=${id}`,
      shorts: link.includes('/shorts/'),
      terbit: Number.isNaN(terbit) ? null : new Date(terbit).toISOString(),
      channel_id: isi(e, 'yt:channelId'),
      channel_nama: isi(/<author>([\s\S]*?)<\/author>/.exec(e)?.[1] || '', 'name') || nama,
      deskripsi: isi(e, 'media:description').slice(0, 1500),
    });
  }
  return out;
}

/** Periksa feed semua channel dan simpan video baru. Tanpa AI. */
export async function ambilFeed(env) {
  const db = env.DB;
  const cutoff = Date.now() - VIDEO_HARI * 86400000;
  const hasil = [];
  let baru = 0;
  for (const ch of VIDEO_CHANNELS) {
    const info = { handle: ch.handle || '', nama: ch.nama || ch.handle || '', id: ch.channel_id || null, n: 0, baru: 0, galat: '' };
    try {
      if (!info.id) {
        const key = 'channel:' + String(ch.handle).toLowerCase();
        info.id = await getState(db, key);
        if (!info.id) {
          info.id = await cariIdChannel(ch.handle);
          await setState(db, key, info.id);
        }
      }
      const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${info.id}`, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error(`feed HTTP ${r.status}`);
      const list = parseFeedYoutube((await r.text()).slice(0, 400_000), info.nama);
      info.n = list.length;
      if (list[0]?.channel_nama) info.nama = list[0].channel_nama;
      if (list.length) {
        const res = await db.batch(
          list.map((v) => {
            const lama = !v.terbit || Date.parse(v.terbit) < cutoff;
            const status = v.shorts || lama ? 'dilewati' : 'baru';
            const alasan = v.shorts ? 'Video Shorts' : lama ? `Lebih lama dari ${VIDEO_HARI} hari` : null;
            return db
              .prepare(
                `INSERT OR IGNORE INTO videos (video_id, channel_id, channel_nama, judul, url, terbit, deskripsi, status, alasan, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING video_id`
              )
              .bind(v.video_id, v.channel_id || info.id, v.channel_nama || info.nama, v.judul, v.url, v.terbit, v.deskripsi, status, alasan, nowIso());
          })
        );
        info.baru = res.filter((x) => x?.results?.length).length;
        baru += info.baru;
      }
    } catch (e) {
      info.galat = String(e.message || e).slice(0, 160);
    }
    hasil.push(info);
  }
  await setState(db, 'rss_at', nowIso());
  await setState(db, 'channels', JSON.stringify(hasil));
  return { channels: hasil, baru };
}

// ---------- Gemini ----------

export class GeminiError extends Error {
  constructor(msg, status = 0) {
    super(msg);
    this.status = status;
  }
}

/** Urutkan model Gemini yang tersedia: Flash stabil versi terbaru dulu, lalu alias terbaru, lalu Flash-Lite. */
export function pilihModel(names) {
  const bersih = names
    .map((n) => String(n).replace(/^models\//, ''))
    .filter((n) => /flash/.test(n) && !/(image|tts|live|audio|exp|thinking|embed|native|computer)/.test(n));
  const versi = (n) => Number(/gemini-(\d+(?:\.\d+)?)/.exec(n)?.[1] || 0);
  const kelas = (n) => (/lite/.test(n) ? 3 : /^gemini-flash-latest$/.test(n) ? 1 : /preview/.test(n) ? 2 : 0);
  return [...new Set(bersih)].sort((a, b) => kelas(a) - kelas(b) || versi(b) - versi(a) || a.length - b.length);
}

async function daftarModel(env) {
  if (env.GEMINI_MODEL) return [env.GEMINI_MODEL, ...MODEL_CADANGAN.filter((m) => m !== env.GEMINI_MODEL)];
  const db = env.DB;
  const key = 'model_daftar:' + wibDate();
  const cache = await getState(db, key);
  if (cache) {
    try {
      return JSON.parse(cache);
    } catch {
      /* hitung ulang */
    }
  }
  let list = [];
  try {
    const r = await fetch(`${GEMINI}/models?pageSize=1000`, { headers: { 'x-goog-api-key': env.GEMINI_API_KEY } });
    if (r.ok) {
      const d = await r.json();
      list = pilihModel((d.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name));
    }
  } catch {
    /* pakai cadangan */
  }
  if (!list.length) list = MODEL_CADANGAN;
  await setState(db, key, JSON.stringify(list.slice(0, 5)));
  return list.slice(0, 5);
}

/**
 * Minta Gemini membaca video YouTube dan menjawab JSON. Hanya VIDEO_MAKS_MENIT menit pertama yang dibaca
 * (resolusi rendah: ±100 token per detik). Bila model menolak pengaturan potongan/resolusi, dicoba tanpa itu;
 * bila model tidak ada atau gangguan server, dicoba model berikutnya.
 */
export async function panggilGemini(env, videoUrl, prompt, meta = {}) {
  const models = await daftarModel(env);
  meta.gagal = [];
  let akhir = null;
  for (const model of models.slice(0, 3)) {
    for (const lengkap of [true, false]) {
      const part = { file_data: { file_uri: videoUrl } };
      if (lengkap) part.video_metadata = { end_offset: `${VIDEO_MAKS_MENIT * 60}s` };
      const body = {
        contents: [{ role: 'user', parts: [part, { text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 6000, ...(lengkap ? { mediaResolution: 'MEDIA_RESOLUTION_LOW' } : {}) },
      };
      let r;
      try {
        r = await fetch(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
          body: JSON.stringify(body),
        });
      } catch (e) {
        akhir = new GeminiError(`${model}: ${String(e.message || e).slice(0, 120)}`);
        meta.gagal.push(akhir.message);
        break;
      }
      if (r.ok) {
        const d = await r.json();
        const teks = (d.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
        if (!teks) {
          akhir = new GeminiError(`${model}: jawaban kosong (${d.candidates?.[0]?.finishReason || d.promptFeedback?.blockReason || 'tanpa alasan'})`);
          meta.gagal.push(akhir.message);
          break;
        }
        let data;
        try {
          data = JSON.parse(teks);
        } catch {
          data = extractJson(teks);
        }
        meta.model = model;
        meta.token = d.usageMetadata?.promptTokenCount ?? null;
        return data;
      }
      const pesan = (await r.text()).replace(/\s+/g, ' ').slice(0, 300);
      akhir = new GeminiError(`${model}: HTTP ${r.status} ${pesan}`, r.status);
      meta.gagal.push(akhir.message.slice(0, 160));
      if (r.status === 429) throw akhir; // kuota habis: jangan menghabiskan model lain
      if (r.status === 400 && lengkap && /video_?metadata|offset|media_?resolution|mediaResolution/i.test(pesan)) continue;
      if (r.status === 400 || r.status === 403) throw akhir; // video tidak bisa dibaca atau key salah
      break; // 404 (model tidak ada) atau 5xx: coba model berikutnya
    }
  }
  throw akhir || new GeminiError('Tidak ada model Gemini yang bisa dipakai.');
}

// ---------- Konteks dan prompt ----------

/** Peristiwa dan kaitan yang sudah disetujui, diberi kode E1.. dan K1.. untuk Gemini. */
export async function konteks(db) {
  const sejak = wibDateDaysAgo(KONTEKS_HARI);
  const events = (
    await db
      .prepare("SELECT id, tanggal, judul, tingkat FROM events WHERE status = 'aktif' AND tanggal >= ? ORDER BY tanggal DESC, id DESC LIMIT ?")
      .bind(sejak, KONTEKS_PERISTIWA)
      .all()
  ).results.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.id - b.id);
  const kodeE = new Map(events.map((e, i) => [e.id, 'E' + (i + 1)]));
  // Tanpa daftar id (D1 membatasi 100 variabel per query).
  const links = (
    await db
      .prepare(
        `SELECT l.id, l.dari_id, l.ke_id, l.jenis, l.alasan FROM links l JOIN events d ON d.id = l.dari_id JOIN events k ON k.id = l.ke_id
         WHERE l.status = 'disetujui' AND d.tanggal >= ? AND k.tanggal >= ? ORDER BY l.id`
      )
      .bind(sejak, sejak)
      .all()
  ).results.filter((l) => kodeE.has(l.dari_id) && kodeE.has(l.ke_id));
  return {
    events,
    links,
    kodeE,
    ev: (c) => {
      const m = /^E(\d+)$/i.exec(String(c || '').trim());
      return m ? events[Number(m[1]) - 1] || null : null;
    },
    link: (c) => {
      const m = /^K(\d+)$/i.exec(String(c || '').trim());
      return m ? links[Number(m[1]) - 1] || null : null;
    },
  };
}

export function videoPrompt(v, ctx) {
  const tanggal = v.terbit ? wibDate(new Date(v.terbit)) : 'tidak diketahui';
  const daftarE = ctx.events.map((e, i) => `E${i + 1} [${e.tanggal} | ${e.tingkat}] ${e.judul}`).join('\n') || '(belum ada)';
  const daftarK =
    ctx.links.map((l, i) => `K${i + 1}: ${ctx.kodeE.get(l.dari_id)} → ${ctx.kodeE.get(l.ke_id)} (${l.jenis}) ${String(l.alasan || '').slice(0, 110)}`).join('\n') ||
    '(belum ada)';
  return `Kamu analis yang menonton video YouTube berbahasa Indonesia tentang investasi dan ekonomi, untuk aplikasi "Peta Rantai Peristiwa" yang mencatat kaitan sebab-akibat peristiwa global dan lokal.
Video: "${v.judul}" dari channel ${v.channel_nama || '-'}, terbit ${tanggal}.
Tugas: catat PANDANGAN pembicara tentang ekonomi makro, sektor, komoditas, kebijakan, dan arah pasar, lalu hubungkan dengan peristiwa (kode E) dan kaitan (kode K) yang sudah tercatat di bawah.
Aturan:
- Catat hanya yang benar-benar disampaikan di video. Jangan menambah fakta. Tulis dengan kata-katamu sendiri (parafrase), maksimal 2 kalimat per klaim; jangan menyalin ucapan panjang.
- ABAIKAN rekomendasi beli/jual/tahan saham tertentu, target harga saham, promosi produk, dan ajakan berlangganan. Aplikasi ini bukan sinyal beli/jual. Yang dicatat hanya pandangan tentang makro, sektor, komoditas, kebijakan, dan arah pasar secara umum (mis. IHSG, rupiah, suku bunga, harga minyak).
- Bedakan fakta, dugaan, dan prediksi pembicara. Pertahankan tingkat kepastiannya.
- "menit": waktu di video saat pandangan itu disampaikan, format "mm:ss" atau "j:mm:ss". Kosongkan bila tidak yakin.
- Jenis klaim:
  - "dukung": pembicara menjelaskan atau membenarkan mekanisme kaitan K yang sudah tercatat. Isi "kaitan" dengan kode K.
  - "bantah": pembicara berpendapat kaitan K itu lemah, keliru, atau dampaknya berbeda. Isi "kaitan".
  - "perkiraan": pembicara memperkirakan sesuatu akan terjadi. Tulis SPESIFIK dan bisa dicek: apa yang berubah, arahnya, dan besarannya bila disebut. Isi "hari" (jangka waktu 7 sampai 180 hari sejak video; bila tidak disebut, perkirakan dari konteks) dan "peristiwa" dengan kode E yang menjadi dasarnya bila ada.
  - "kaitan_baru": pembicara menghubungkan dua peristiwa E sebagai sebab-akibat yang belum ada di daftar K. Isi "dari" (penyebab) dan "ke" (akibat). Penyebab tidak boleh lebih baru dari akibat.
  - "pandangan": pandangan penting lain tentang makro atau sektor. Isi "peristiwa" bila berkaitan dengan satu peristiwa E.
- Pakai kode hanya dari daftar di bawah. Jangan mengarang kode. Kosongkan bidang yang tidak berlaku.
- Maksimal ${VIDEO_KLAIM_MAKS} klaim, yang paling penting dulu.
- "relevan": false bila video tidak membahas makro, sektor, komoditas, kebijakan, atau arah pasar (mis. hanya membahas satu saham, tutorial, atau promosi). Bila false, "klaim" boleh kosong.
- "ringkasan": 2 sampai 3 kalimat isi utama video, dalam Bahasa Indonesia.
Jawab HANYA dengan JSON tanpa teks lain, dengan bentuk:
{"relevan":true,"ringkasan":"","klaim":[{"jenis":"dukung","teks":"","menit":"12:30","kaitan":"K3","dari":"","ke":"","peristiwa":"","hari":0}]}

Peristiwa yang sudah tercatat (kode [tanggal | tingkat] judul):
${daftarE}

Kaitan yang sudah tercatat (penyebab → akibat):
${daftarK}`;
}

// ---------- Pemeriksaan jawaban ----------

/** "12:30" -> 750, "1:02:03" -> 3723. Angka dianggap detik. */
export function parseMenit(m) {
  if (typeof m === 'number' && Number.isFinite(m)) return Math.max(0, Math.min(6 * 3600, Math.round(m)));
  const s = String(m || '').trim();
  if (!/^\d{1,2}(:\d{1,2}){1,2}$/.test(s)) return null;
  const n = s.split(':').map(Number);
  const det = n.reduce((a, x) => a * 60 + x, 0);
  return det <= 6 * 3600 ? det : null;
}

const POLA_REKOMENDASI = /\b(layak (dibeli|dikoleksi|dijual|diakumulasi)|saatnya (beli|jual|serok|akumulasi|masuk)|rekomendasi (beli|jual|saham)|target harga|take profit|cut loss|buy on|sell on|serok|average down|tp di)\b/i;
const BUKAN_SAHAM = new Set(['IHSG', 'OPEC', 'FOMC', 'APBN', 'BBM', 'LPS', 'BUMN', 'BRENT', 'WTI', 'NFP', 'GDP', 'PMI', 'USD', 'IDR', 'CPO']);

/** Rekomendasi beli/jual saham tertentu tidak dicatat (aplikasi ini bukan sinyal beli/jual). */
export function isRekomendasi(teks) {
  const t = String(teks || '');
  if (POLA_REKOMENDASI.test(t)) return true;
  const kode = (t.match(/\b[A-Z]{4}\b/g) || []).filter((k) => !BUKAN_SAHAM.has(k));
  return kode.length > 0 && /\b(beli|jual|tahan|hold|buy|sell|akumulasi)\b/i.test(t);
}

/** Periksa jawaban Gemini: jenis resmi, kode nyata, tanpa rekomendasi saham, tanpa ganda. */
export function normalizeVideo(out, ctx) {
  const relevan = out?.relevan !== false;
  const ringkasan = String(out?.ringkasan || '').replace(/\s+/g, ' ').trim().slice(0, 700);
  const list = Array.isArray(out?.klaim) ? out.klaim : [];
  const sudah = new Set(ctx.links.flatMap((l) => [`${l.dari_id}-${l.ke_id}`, `${l.ke_id}-${l.dari_id}`]));
  const linkPasangan = (a, b) => ctx.links.find((l) => (l.dari_id === a && l.ke_id === b) || (l.dari_id === b && l.ke_id === a));
  const klaim = [];
  const seen = new Set();
  let dibuang = 0;
  for (const k of list.slice(0, 16)) {
    if (klaim.length >= VIDEO_KLAIM_MAKS) break;
    let jenis = JENIS_KLAIM.includes(k?.jenis) ? k.jenis : null;
    const teks = String(k?.teks || '').replace(/\s+/g, ' ').trim().slice(0, 320);
    if (!jenis || !teks) continue;
    if (isRekomendasi(teks)) {
      dibuang++;
      continue;
    }
    const c = { jenis, teks, detik: parseMenit(k.menit), link_id: null, event_id: null, dari_id: null, ke_id: null, hari: null };
    const ev = ctx.ev(k.peristiwa);
    if (jenis === 'dukung' || jenis === 'bantah') {
      const l = ctx.link(k.kaitan);
      if (l) c.link_id = l.id;
      else c.jenis = 'pandangan';
    } else if (jenis === 'kaitan_baru') {
      const a = ctx.ev(k.dari);
      const b = ctx.ev(k.ke);
      if (a && b && a.id !== b.id && sudah.has(`${a.id}-${b.id}`)) {
        // Kaitan itu sebenarnya sudah tercatat: jadikan catatan pendukung.
        c.jenis = 'dukung';
        c.link_id = linkPasangan(a.id, b.id).id;
      } else if (a && b && a.id !== b.id && a.tanggal <= b.tanggal) {
        c.dari_id = a.id;
        c.ke_id = b.id;
      } else {
        c.jenis = 'pandangan';
      }
    } else if (jenis === 'perkiraan') {
      c.hari = Math.max(7, Math.min(180, Math.round(Number(k.hari)) || 30));
    }
    if ((c.jenis === 'perkiraan' || c.jenis === 'pandangan') && ev) c.event_id = ev.id;
    const key = c.jenis + '|' + teks.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    klaim.push(c);
  }
  return { relevan, ringkasan, klaim, dibuang };
}

// ---------- Proses ----------

/** Satu giliran: periksa feed (tiap VIDEO_RSS_JAM) lalu ringkas satu video. Tidur bila GEMINI_API_KEY kosong. */
export async function videoTick(env, { paksa = false, videoId = null } = {}) {
  if (!env.GEMINI_API_KEY) return { ok: false, nonaktif: true, message: 'Secret GEMINI_API_KEY belum diisi.' };
  const db = env.DB;
  try {
    await ensureTables(db);
    const out = { ok: true };
    const last = await getState(db, 'rss_at');
    if (paksa || !last || Date.parse(last) < Date.now() - VIDEO_RSS_JAM * 3600000) out.feed = await ambilFeed(env);
    out.analisis = await analisisBerikutnya(env, { paksa, videoId });
    return out;
  } catch (e) {
    const msg = String(e.message || e).slice(0, 300);
    try {
      await setState(db, 'galat', `${nowIso()} ${msg}`);
    } catch {
      /* abaikan */
    }
    return { ok: false, message: msg };
  }
}

export async function analisisHariIni(db) {
  return Number(await getState(db, 'analisis:' + wibDate())) || 0;
}

/** Ringkas satu video yang menunggu (yang diminta pemilik didahulukan), dengan batas harian dan jeda. */
export async function analisisBerikutnya(env, { paksa = false, videoId = null } = {}) {
  const db = env.DB;
  const kunci = await getState(db, 'proses_at');
  if (kunci && Date.parse(kunci) > Date.now() - 12 * 60000) return { ok: true, sibuk: true };
  const n = await analisisHariIni(db);
  if (n >= (paksa ? VIDEO_MAKS_HARIAN * 2 : VIDEO_MAKS_HARIAN)) return { ok: true, kuota: true, message: `Batas ${VIDEO_MAKS_HARIAN} video per hari tercapai.` };
  if (!paksa) {
    const terakhir = await getState(db, 'gemini_at');
    if (terakhir && Date.parse(terakhir) > Date.now() - VIDEO_JEDA_MENIT * 60000) return { ok: true, jeda: true };
  }
  const v = videoId
    ? await db.prepare('SELECT * FROM videos WHERE video_id = ?').bind(videoId).first()
    : await db
        .prepare("SELECT * FROM videos WHERE status = 'baru' AND (coba_lagi IS NULL OR coba_lagi <= ?) ORDER BY (diminta IS NULL), terbit DESC LIMIT 1")
        .bind(nowIso())
        .first();
  if (!v) return { ok: true, kosong: true };
  await setState(db, 'proses_at', nowIso());
  try {
    return await analisisVideo(env, v);
  } finally {
    await setState(db, 'proses_at', null);
  }
}

export async function analisisVideo(env, v) {
  const db = env.DB;
  const ctx = await konteks(db);
  const meta = {};
  await tambahState(db, 'analisis:' + wibDate());
  await setState(db, 'gemini_at', nowIso());
  let out;
  try {
    out = await panggilGemini(env, v.url, videoPrompt(v, ctx), meta);
  } catch (e) {
    const msg = String(e.message || e).slice(0, 300);
    const kuota = e instanceof GeminiError && e.status === 429;
    const coba = (v.percobaan || 0) + (kuota ? 0 : 1);
    const gagal = coba >= VIDEO_MAKS_COBA || (e instanceof GeminiError && e.status === 403);
    const nanti = new Date(Date.now() + (kuota ? 60 : 30) * 60000).toISOString();
    await db
      .prepare('UPDATE videos SET status = ?, alasan = ?, percobaan = ?, coba_lagi = ?, diminta = NULL, diproses_at = ? WHERE video_id = ?')
      .bind(gagal ? 'gagal' : 'baru', (kuota ? 'Kuota Gemini habis, dicoba lagi nanti. ' : '') + msg, coba, gagal ? null : nanti, nowIso(), v.video_id)
      .run();
    return { ok: false, video_id: v.video_id, message: msg, kuota };
  }
  const h = normalizeVideo(out, ctx);
  const now = nowIso();
  const stmts = [
    db
      .prepare(
        `UPDATE videos SET status = ?, ringkasan = ?, model = ?, token = ?, alasan = ?, percobaan = 0, coba_lagi = NULL, diminta = NULL, diproses_at = ? WHERE video_id = ?`
      )
      .bind(
        h.relevan ? 'selesai' : 'tidak_relevan',
        h.ringkasan,
        meta.model || null,
        meta.token ?? null,
        h.dibuang ? `${h.dibuang} rekomendasi saham tidak dicatat.` : null,
        now,
        v.video_id
      ),
    // Ringkas ulang: klaim lama diganti, kecuali yang sudah dicatat ke Perkiraan.
    db.prepare('DELETE FROM video_klaim WHERE video_id = ? AND forecast_id IS NULL').bind(v.video_id),
    ...h.klaim.map((c) =>
      db
        .prepare(
          'INSERT INTO video_klaim (video_id, jenis, teks, detik, link_id, event_id, dari_id, ke_id, hari, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(v.video_id, c.jenis, c.teks, c.detik, c.link_id, c.event_id, c.dari_id, c.ke_id, c.hari, now)
    ),
  ];
  await db.batch(stmts);
  return { ok: true, video_id: v.video_id, relevan: h.relevan, klaim: h.klaim.length, model: meta.model };
}

// ---------- API ----------

function urlMenit(url, detik) {
  if (detik == null || !/watch\?v=/.test(url)) return url;
  return `${url}&t=${detik}s`;
}

/** Tunggu hasil sebentar; bila lebih lama, pekerjaan tetap berjalan di latar belakang. */
async function tunggu(p, ms, ctx) {
  const aman = p.catch((e) => ({ ok: false, message: String(e.message || e) }));
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(aman);
  return Promise.race([aman, sleep(ms).then(() => ({ ok: true, masihJalan: true }))]);
}

async function tabelAda(db) {
  try {
    await db.prepare('SELECT 1 FROM videos LIMIT 1').first();
    return true;
  } catch {
    return false;
  }
}

async function klaimUntuk(db, ids) {
  if (!ids.length) return [];
  const rows = await allInChunks(
    db,
    (ph) => `SELECT k.*, l.jenis AS link_jenis, l.status AS link_status, l.dari_id AS l_dari, l.ke_id AS l_ke,
        e.judul AS event_judul, e.tanggal AS event_tanggal, f.status AS fc_status, f.tanggal_cek AS fc_tanggal
      FROM video_klaim k LEFT JOIN links l ON l.id = k.link_id LEFT JOIN events e ON e.id = k.event_id
      LEFT JOIN forecasts f ON f.id = k.forecast_id WHERE k.video_id IN (${ph}) ORDER BY k.id`,
    ids
  );
  return rows;
}

function klaimOut(r, v, judul) {
  const tgl = v.terbit ? wibDate(new Date(v.terbit)) : null;
  const ujung = (id) => (id && judul.get(id) ? { id, judul: judul.get(id).judul, tanggal: judul.get(id).tanggal } : null);
  return {
    id: r.id,
    jenis: r.jenis,
    teks: r.teks,
    detik: r.detik,
    url: urlMenit(v.url, r.detik),
    link: r.link_id ? { id: r.link_id, jenis: r.link_jenis, status: r.link_status, dari: ujung(r.l_dari), ke: ujung(r.l_ke) } : null,
    dari: ujung(r.dari_id),
    ke: ujung(r.ke_id),
    event: r.event_id ? { id: r.event_id, judul: r.event_judul, tanggal: r.event_tanggal } : null,
    hari: r.hari,
    tanggal_cek: r.jenis === 'perkiraan' && tgl && r.hari ? addDays(tgl, r.hari) : null,
    forecast: r.forecast_id && r.fc_status ? { id: r.forecast_id, status: r.fc_status, tanggal_cek: r.fc_tanggal } : null,
  };
}

/**
 * Rute /api/video/*. Mengembalikan Response, atau null bila alamatnya bukan milik fitur ini.
 * auth: { owner, requireOwner } dari index.js.
 */
export async function videoApi(request, env, ctx, auth) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (!path.startsWith('/api/video')) return null;
  const db = env.DB;
  const aktif = Boolean(env.GEMINI_API_KEY);
  const pemilik = () => auth.requireOwner(request, env);

  // Catatan ▶ untuk kaitan di rantai (publik).
  if (path === '/api/video/catatan' && method === 'GET') {
    if (!aktif || !(await tabelAda(db))) return json({ aktif, catatan: [] });
    const rows = (
      await db
        .prepare(
          `SELECT k.id, k.link_id, k.jenis, k.teks, k.detik, v.video_id, v.judul, v.url, v.channel_nama, v.terbit
           FROM video_klaim k JOIN videos v ON v.video_id = k.video_id
           WHERE k.link_id IS NOT NULL AND k.jenis IN ('dukung','bantah') AND v.status = 'selesai'
           ORDER BY v.terbit DESC, k.id LIMIT 500`
        )
        .all()
    ).results;
    return json({
      aktif,
      catatan: rows.map((r) => ({
        id: r.id,
        link_id: r.link_id,
        jenis: r.jenis,
        teks: r.teks,
        detik: r.detik,
        url: urlMenit(r.url, r.detik),
        video: { id: r.video_id, judul: r.judul, channel: r.channel_nama, tanggal: r.terbit ? wibDate(new Date(r.terbit)) : null },
      })),
    });
  }

  // Daftar video dan klaimnya (publik; pengunjung hanya melihat yang sudah diringkas).
  if (path === '/api/video' && method === 'GET') {
    const dasar = {
      aktif,
      owner: auth.owner,
      pengaturan: { channels: VIDEO_CHANNELS, hari: VIDEO_HARI, maks_harian: VIDEO_MAKS_HARIAN, menit: VIDEO_MAKS_MENIT, rss_jam: VIDEO_RSS_JAM },
    };
    if (!aktif) return json({ ...dasar, videos: [] });
    await ensureTables(db);
    const where = auth.owner ? '' : "WHERE status = 'selesai'";
    const videos = (await db.prepare(`SELECT * FROM videos ${where} ORDER BY terbit DESC LIMIT 40`).all()).results;
    const rows = await klaimUntuk(db, videos.map((v) => v.video_id));
    const evIds = [...new Set(rows.flatMap((r) => [r.l_dari, r.l_ke, r.dari_id, r.ke_id]).filter(Boolean))];
    const judul = new Map((await allInChunks(db, (ph) => `SELECT id, judul, tanggal FROM events WHERE id IN (${ph})`, evIds)).map((e) => [e.id, e]));
    const per = new Map();
    for (const r of rows) {
      if (!per.has(r.video_id)) per.set(r.video_id, []);
      per.get(r.video_id).push(r);
    }
    let channels = [];
    try {
      channels = JSON.parse((await getState(db, 'channels')) || '[]');
    } catch {
      /* kosong */
    }
    return json({
      ...dasar,
      rss_at: await getState(db, 'rss_at'),
      channels,
      analisis_hari_ini: await analisisHariIni(db),
      galat: auth.owner ? await getState(db, 'galat') : null,
      videos: videos.map((v) => ({
        video_id: v.video_id,
        judul: v.judul,
        url: v.url,
        channel: v.channel_nama,
        tanggal: v.terbit ? wibDate(new Date(v.terbit)) : null,
        status: v.status,
        alasan: auth.owner ? v.alasan : null,
        ringkasan: v.ringkasan,
        model: v.model,
        token: v.token,
        diminta: Boolean(v.diminta),
        diproses_at: v.diproses_at,
        klaim: (per.get(v.video_id) || []).map((r) => klaimOut(r, v, judul)),
      })),
    });
  }

  if (path === '/api/video/periksa' && method === 'POST') {
    const deny = pemilik();
    if (deny) return deny;
    if (!aktif) return json({ error: 'Isi secret GEMINI_API_KEY di Cloudflare dulu.' }, 400);
    return json(await tunggu(videoTick(env, { paksa: true }), 25000, ctx));
  }

  let m = path.match(/^\/api\/video\/([\w-]{6,20})\/proses$/);
  if (m && method === 'POST') {
    const deny = pemilik();
    if (deny) return deny;
    if (!aktif) return json({ error: 'Isi secret GEMINI_API_KEY di Cloudflare dulu.' }, 400);
    await ensureTables(db);
    const r = await db
      .prepare("UPDATE videos SET status = 'baru', diminta = ?, percobaan = 0, coba_lagi = NULL WHERE video_id = ? RETURNING video_id")
      .bind(nowIso(), m[1])
      .first();
    if (!r) return json({ error: 'Video tidak ditemukan.' }, 404);
    return json(await tunggu(analisisBerikutnya(env, { paksa: true, videoId: m[1] }), 25000, ctx));
  }

  m = path.match(/^\/api\/video\/klaim\/(\d+)\/catat$/);
  if (m && method === 'POST') {
    const deny = pemilik();
    if (deny) return deny;
    await ensureTables(db);
    const k = await db
      .prepare('SELECT k.*, v.terbit FROM video_klaim k JOIN videos v ON v.video_id = k.video_id WHERE k.id = ?')
      .bind(Number(m[1]))
      .first();
    if (!k || k.jenis !== 'perkiraan') return json({ error: 'Perkiraan tidak ditemukan.' }, 404);
    if (!k.event_id) return json({ error: 'Perkiraan ini belum terhubung ke peristiwa mana pun, jadi belum bisa dicatat.' }, 400);
    const ada = await db.prepare('SELECT id FROM forecasts WHERE event_id = ? AND teks = ?').bind(k.event_id, k.teks).first();
    if (ada) {
      await db.prepare('UPDATE video_klaim SET forecast_id = ? WHERE id = ?').bind(ada.id, k.id).run();
      return json({ ok: true, sudah: true, id: ada.id });
    }
    // Tanggal cek dihitung dari tanggal video, sama seperti hipotesis AI dihitung dari tanggal peristiwanya.
    const dasarTgl = k.terbit ? wibDate(new Date(k.terbit)) : wibDate();
    const tanggal = addDays(dasarTgl, k.hari || 30);
    const row = await db
      .prepare("INSERT INTO forecasts (event_id, teks, tanggal_cek, created_at, asal) VALUES (?, ?, ?, ?, 'video') RETURNING id")
      .bind(k.event_id, k.teks, tanggal, nowIso())
      .first();
    await db.prepare('UPDATE video_klaim SET forecast_id = ? WHERE id = ?').bind(row.id, k.id).run();
    return json({ ok: true, id: row.id, tanggal_cek: tanggal, lewat: tanggal <= wibDate() });
  }

  m = path.match(/^\/api\/video\/klaim\/(\d+)\/hapus$/);
  if (m && method === 'POST') {
    const deny = pemilik();
    if (deny) return deny;
    await ensureTables(db);
    await db.prepare('DELETE FROM video_klaim WHERE id = ?').bind(Number(m[1])).run();
    return json({ ok: true });
  }

  return json({ error: 'Alamat API video tidak dikenal.' }, 404);
}

/** Tempel sumber video pada perkiraan berasal 'video' (dipakai /api/forecasts). Aman bila tabel belum ada. */
export async function tempelSumberVideo(db, forecasts) {
  const ids = forecasts.filter((f) => f.asal === 'video').map((f) => f.id);
  if (!ids.length) return;
  try {
    const rows = await allInChunks(
      db,
      (ph) => `SELECT k.forecast_id, k.detik, v.judul, v.url, v.channel_nama, v.terbit FROM video_klaim k
               JOIN videos v ON v.video_id = k.video_id WHERE k.forecast_id IN (${ph})`,
      ids
    );
    const map = new Map(rows.map((r) => [r.forecast_id, r]));
    for (const f of forecasts) {
      const r = map.get(f.id);
      if (r) f.video = { judul: r.judul, channel: r.channel_nama, url: urlMenit(r.url, r.detik), tanggal: r.terbit ? wibDate(new Date(r.terbit)) : null };
    }
  } catch {
    /* tabel video belum ada: perkiraan tampil tanpa sumber video */
  }
}

// Dipakai tes.
export const _uji = { getState, setState, wibDayStartIso, resetTabel: () => (tabelSiap = false) };
