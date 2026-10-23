import { KELOMPOK, AI_DAILY_LIMIT, AI_CADANGAN, AI_CADANGAN_DIMINTA, CEK_PER_GILIRAN, CEK_ULANG_HARI } from './constants.js';
import { kelompokOf, parseList, wibDate, nowIso, addDays } from './util.js';
import { priceChange } from './market.js';
import { fetchGnews, titleKey } from './sources.js';
import { runJson, checkPrompt, CEK_SCHEMA, QuotaError } from './ai.js';

/**
 * Perkiraan: pengelompokan otomatis dan pengecekan semi-otomatis.
 * AI hanya memberi SARAN (terjadi / tidak / belum). Status akhir selalu diputuskan pemilik.
 */

// ---------- Pengelompokan ----------

// Kata kunci per kelompok sektor. Frasa yang lebih panjang dicocokkan lebih dulu, sehingga
// "minyak goreng" masuk Pangan, bukan Energi, dan "tarif listrik" masuk Energi, bukan Perdagangan.
export const KATA_KELOMPOK = {
  energi: ['impor bbm', 'subsidi energi', 'subsidi bbm', 'tarif listrik', 'harga minyak', 'minyak mentah', 'bbm', 'minyak', 'brent', 'wti', 'opec', 'lng', 'gas alam', 'gas', 'listrik', 'batu bara', 'batubara', 'energi', 'solar', 'pertalite', 'pertamax', 'bensin', 'kilang', 'pertamina'],
  pangan: ['inflasi pangan', 'harga pangan', 'impor pangan', 'minyak goreng', 'minyak sawit', 'swasembada pangan', 'pangan', 'beras', 'gandum', 'jagung', 'kedelai', 'cabai', 'bawang', 'gula', 'sawit', 'cpo', 'pupuk', 'panen', 'ternak', 'daging', 'telur', 'bulog'],
  tambang: ['emas', 'nikel', 'timah', 'tembaga', 'bauksit', 'tambang', 'pertambangan', 'smelter', 'mineral', 'hilirisasi'],
  keuangan: ['bi rate', 'suku bunga', 'the fed', 'nilai tukar', 'arus keluar modal', 'arus modal', 'modal asing', 'defisit anggaran', 'rupiah', 'kurs', 'dolar', 'ihsg', 'saham', 'obligasi', 'sbn', 'yield', 'inflasi', 'kredit', 'bank', 'perbankan', 'likuiditas', 'investor', 'apbn', 'pajak', 'fiskal', 'utang'],
  dagang: ['neraca dagang', 'neraca perdagangan', 'rantai pasok', 'jalur laut', 'laut merah', 'biaya pengiriman', 'bea masuk', 'ekspor', 'impor', 'tarif', 'pelabuhan', 'pelayaran', 'kapal', 'kontainer', 'logistik', 'pengiriman', 'selat', 'hormuz', 'perdagangan'],
  industri: ['daya beli', 'tenaga kerja', 'manufaktur', 'pabrik', 'industri', 'tekstil', 'garmen', 'otomotif', 'ritel', 'konsumsi', 'phk', 'upah', 'properti', 'konstruksi', 'teknologi', 'pariwisata', 'wisata', 'kesehatan'],
};
export const LINTAS = { id: 'lintas', nama: 'Lintas sektor' };

const KAMUS = Object.entries(KATA_KELOMPOK)
  .flatMap(([id, words]) => words.map((w) => ({ w, id })))
  .sort((a, b) => b.w.length - a.w.length);

function normText(t) {
  return ' ' + String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
}

/** Istilah kamus yang muncul di teks, urut kemunculan: [{ w, id, pos }]. */
export function istilah(teks) {
  let s = normText(teks);
  const found = [];
  for (const { w, id } of KAMUS) {
    const needle = ' ' + w + ' ';
    let i = s.indexOf(needle);
    while (i >= 0) {
      found.push({ w, id, pos: i });
      s = s.slice(0, i + 1) + ' '.repeat(w.length) + s.slice(i + 1 + w.length);
      i = s.indexOf(needle);
    }
  }
  return found.sort((a, b) => a.pos - b.pos);
}

/**
 * Kelompok sebuah perkiraan, dari teksnya sendiri: kelompok dengan istilah terbanyak
 * (+1 untuk kelompok istilah pertama, biasanya pokok kalimat). Seri -> kelompok peristiwa asal.
 * Tanpa istilah -> kelompok peristiwa asal -> "Lintas sektor".
 */
export function kelompokPerkiraan(teks, eventSektor = []) {
  const asal = kelompokOf(eventSektor);
  const hits = istilah(teks);
  if (!hits.length) return asal[0] || LINTAS.id;
  const skor = {};
  for (const h of hits) skor[h.id] = (skor[h.id] || 0) + 1;
  skor[hits[0].id] += 1;
  const max = Math.max(...Object.values(skor));
  const seri = Object.keys(skor).filter((k) => skor[k] === max);
  if (seri.length === 1) return seri[0];
  return asal.find((k) => seri.includes(k)) || KELOMPOK.map((k) => k.id).find((k) => seri.includes(k));
}

// ---------- Kata kunci pencarian bukti ----------

const INGGRIS = {
  'harga minyak': ['oil price'], 'minyak mentah': ['crude'], minyak: ['oil'], bbm: ['fuel'], brent: ['brent'], opec: ['opec'],
  gas: ['gas'], lng: ['lng'], 'batu bara': ['coal'], batubara: ['coal'], listrik: ['electricity'], emas: ['gold'],
  nikel: ['nickel'], timah: ['tin'], tembaga: ['copper'], rupiah: ['rupiah'], 'suku bunga': ['interest rate'],
  'the fed': ['fed'], inflasi: ['inflation'], pangan: ['food'], beras: ['rice'], gandum: ['wheat'], sawit: ['palm oil'],
  cpo: ['palm oil'], pupuk: ['fertilizer'], tarif: ['tariff'], ekspor: ['export'], impor: ['import'], kapal: ['ship'],
  pelayaran: ['shipping'], kontainer: ['container'], 'biaya pengiriman': ['freight'], pengiriman: ['shipping'],
  saham: ['stocks'], obligasi: ['bond'], yield: ['yield'], dolar: ['dollar'], hormuz: ['hormuz'], 'laut merah': ['red sea'],
};
const STOP = new Set('yang dan atau di ke dari dalam pada untuk dengan oleh dapat akan bisa jika karena sehingga serta lebih hingga sebesar menjadi adanya ini itu tersebut hari bulan minggu tahun ke depan sekitar berpotensi kemungkinan hipotesis mungkin terhadap antara juga masih telah sudah belum tidak bila maka secara para setiap seperti agar namun tetap baru lama kenaikan penurunan naik turun meningkat menurun meningkatkan menurunkan memicu menekan menahan mendorong'.split(' '));

/** Kata kunci untuk mencari bukti: istilah kamus dulu, lalu kata penting lain. */
export function kataKunci(teks, maks = 6) {
  const out = [];
  for (const h of istilah(teks)) if (!out.includes(h.w)) out.push(h.w);
  if (out.length < 3) {
    for (const w of normText(teks).trim().split(' ')) {
      if (w.length >= 5 && !STOP.has(w) && !/^\d+$/.test(w) && !out.some((o) => o.includes(w))) out.push(w);
      if (out.length >= maks) break;
    }
  }
  return out.slice(0, maks);
}

const ARAH = ['naik', 'turun', 'melemah', 'menguat', 'stabil', 'melonjak', 'anjlok', 'meningkat', 'menurun'];

/** Pencarian Google News untuk cek manual oleh pemilik (dibuka di tab baru). */
export function cariManualUrl(teks) {
  const kk = kataKunci(teks, 3);
  const n = normText(teks);
  const arah = ARAH.find((a) => n.includes(' ' + a + ' '));
  const q = [...kk, arah].filter(Boolean).join(' ');
  return `https://news.google.com/search?q=${encodeURIComponent(q)}&hl=id&gl=ID&ceid=ID:id`;
}

/** Seri harga yang relevan untuk sebuah perkiraan. */
export function seriTerkait(teks) {
  const w = new Set(istilah(teks).map((h) => h.w));
  const out = [];
  if (['rupiah', 'kurs', 'dolar', 'nilai tukar'].some((x) => w.has(x))) out.push('USDIDR');
  if (w.has('emas')) out.push('XAU');
  if (['minyak', 'harga minyak', 'minyak mentah', 'brent', 'opec', 'bbm', 'impor bbm', 'subsidi bbm'].some((x) => w.has(x))) out.push('BRENT');
  return out;
}

// ---------- Bukti ----------

const pctStr = (x, d = 1) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d).replace('.', ',') + '%';
const angka = (x) => (x >= 1000 ? Math.round(x).toLocaleString('id-ID') : x.toFixed(2).replace('.', ','));

export function hargaKalimat(c) {
  const d = c.kode === 'USDIDR' ? 2 : 1;
  const arah = c.kode === 'USDIDR' ? (c.perubahan > 0 ? ' (rupiah melemah)' : c.perubahan < 0 ? ' (rupiah menguat)' : '') : '';
  let s = `${c.nama} ${angka(c.dari.nilai)} (${c.dari.day}) → ${angka(c.ke.nilai)} (${c.ke.day}): ${pctStr(c.perubahan, d)}${arah}`;
  const ex = [];
  if (c.tertinggi && c.tertinggi.day !== c.ke.day && c.tertinggi.perubahan > Math.max(c.perubahan, 0)) ex.push(`tertinggi ${angka(c.tertinggi.nilai)} (${c.tertinggi.day}, ${pctStr(c.tertinggi.perubahan, d)})`);
  if (c.terendah && c.terendah.day !== c.ke.day && c.terendah.perubahan < Math.min(c.perubahan, 0)) ex.push(`terendah ${angka(c.terendah.nilai)} (${c.terendah.day}, ${pctStr(c.terendah.perubahan, d)})`);
  return ex.length ? `${s}; di antaranya ${ex.join(', ')}` : s;
}

/**
 * Kumpulkan bukti untuk satu perkiraan:
 * 1. berita tersimpan sesudah tanggal dasar yang judulnya memuat kata kunci (selain berita sumbernya sendiri);
 * 2. pencarian Google News sesudah tanggal dasar (bila diizinkan);
 * 3. perubahan harga pasar terkait sejak tanggal dasar.
 */
export async function kumpulkanBukti(db, f, { cariOnline = true, today = wibDate() } = {}) {
  const dasar = f.event_tanggal || String(f.created_at || '').slice(0, 10);
  // Bila tanggal cek sudah lewat, yang dinilai keadaan pada tanggal itu: berita dibatasi sampai
  // 3 hari sesudahnya (laporan sering terlambat sehari-dua), harga sampai tanggal cek.
  const lewat = f.tanggal_cek <= today;
  const sampai = lewat ? addDays(f.tanggal_cek, 3) : null;
  const kk = kataKunci(f.teks);
  const pola = [...new Set(kk.flatMap((k) => [k, ...(INGGRIS[k] || [])]))].slice(0, 10);
  const kandidat = [];
  if (pola.length) {
    const rows = await db
      .prepare(
        `SELECT title, url, source, origin, published_at FROM articles
         WHERE COALESCE(published_at, fetched_at) >= ? AND COALESCE(published_at, fetched_at) < ?
           AND id NOT IN (SELECT article_id FROM event_articles WHERE event_id = ?)
           AND (${pola.map(() => 'title LIKE ?').join(' OR ')})
         ORDER BY published_at DESC LIMIT 400`
      )
      .bind(`${dasar}T00:00:00`, sampai ? `${addDays(sampai, 1)}T00:00:00` : '9999', f.event_id, ...pola.map((p) => `%${p}%`))
      .all();
    kandidat.push(...rows.results);
  }
  let online = 0;
  if (cariOnline && kk.length) {
    try {
      const q = kk.slice(0, 3).map((k) => (k.includes(' ') ? `"${k}"` : k)).join(' OR ');
      const items = await fetchGnews({ q, edisi: 'id' }, { setelah: dasar, sebelum: sampai ? addDays(sampai, 1) : null, limit: 30 });
      online = items.length;
      kandidat.push(...items.map((a) => ({ title: a.title, url: a.url, source: a.source, origin: a.origin, published_at: a.published_at })));
    } catch {
      /* pencarian daring gagal: cukup berita tersimpan */
    }
  }
  const pl = pola.map((p) => ' ' + p + ' ');
  const seen = new Set();
  const berita = kandidat
    .filter((a) => {
      const tgl = String(a.published_at || '').slice(0, 10);
      if (tgl && (tgl < dasar || (sampai && tgl > sampai))) return false;
      const k = titleKey(a.title);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((a) => {
      const t = normText(a.title);
      return { ...a, skor: pl.filter((p) => t.includes(p)).length };
    })
    .filter((a) => a.skor > 0)
    .sort((a, b) => b.skor - a.skor || String(b.published_at).localeCompare(String(a.published_at)))
    .slice(0, 10)
    .sort((a, b) => String(a.published_at).localeCompare(String(b.published_at)))
    .map((a) => ({ judul: a.title, url: a.url, sumber: a.source, asal: a.origin, tanggal: String(a.published_at || '').slice(0, 10) }));
  const harga = [];
  for (const kode of seriTerkait(f.teks)) {
    const c = await priceChange(db, kode, dasar, lewat ? f.tanggal_cek : null);
    if (c) harga.push(hargaKalimat(c));
  }
  return { dasar, sampai, berita, harga, online };
}

// ---------- Saran AI ----------

const PUTUSAN = ['terjadi', 'tidak', 'belum'];

/** Periksa jawaban AI: putusan dari daftar resmi, nomor bukti harus nyata. */
export function normalizeChecks(out, batch, today = wibDate()) {
  const list = Array.isArray(out?.cek) ? out.cek : [];
  const res = new Map();
  for (const c of list) {
    const f = batch.find((x) => String(x.id) === String(c.id).replace(/^P/i, ''));
    if (!f || res.has(f.id)) continue;
    let putusan = PUTUSAN.includes(c.putusan) ? c.putusan : 'belum';
    // Sebelum tanggal cek, "tidak terjadi" belum bisa disimpulkan.
    if (putusan === 'tidak' && f.tanggal_cek > today) putusan = 'belum';
    const nomor = [...new Set((Array.isArray(c.bukti) ? c.bukti : []).map(Number))].filter((n) => n >= 1 && n <= f.bukti.berita.length);
    res.set(f.id, {
      status: putusan,
      keyakinan: Math.max(0, Math.min(1, Number(c.keyakinan) || 0.5)),
      alasan: String(c.alasan || '').trim().slice(0, 400),
      dipakai: nomor,
    });
  }
  return res;
}

export async function aiCallsToday(db) {
  const row = await db.prepare('SELECT calls FROM ai_usage WHERE day = ?').bind(wibDate()).first();
  return row?.calls || 0;
}

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

/** Perkiraan yang perlu dicek sekarang, urut: diminta pemilik, jatuh tempo, lainnya. */
export async function perluDicek(db, { maks = CEK_PER_GILIRAN, riwayatSelesai = true } = {}) {
  const today = wibDate();
  const D = 86400000;
  const rows = await db
    .prepare(
      `SELECT f.*, e.judul AS event_judul, e.tanggal AS event_tanggal, e.sektor AS event_sektor
       FROM forecasts f JOIN events e ON e.id = f.event_id
       WHERE f.status = 'menunggu' AND (
         f.cek_diminta IS NOT NULL
         OR (f.saran_at IS NULL AND (f.tanggal_cek <= ? OR (f.asal = 'riwayat' AND ? = 1) OR f.created_at <= ?))
         OR (f.saran_status = 'gagal' AND f.saran_at <= ?)
         OR (f.saran_status = 'belum' AND f.tanggal_cek <= ? AND f.saran_at <= ?)
         OR (f.saran_status IS NOT NULL AND f.saran_at <= ?)
       )
       ORDER BY (f.cek_diminta IS NULL), (f.tanggal_cek > ?), f.tanggal_cek, f.id
       LIMIT ?`
    )
    .bind(
      today,
      riwayatSelesai ? 1 : 0,
      iso(CEK_ULANG_HARI.mingguan * D),
      iso(CEK_ULANG_HARI.gagal * D),
      today,
      iso(CEK_ULANG_HARI.belum * D),
      iso(CEK_ULANG_HARI.mingguan * D),
      today,
      maks
    )
    .all();
  return rows.results;
}

/**
 * Satu giliran pengecekan: ambil beberapa perkiraan, kumpulkan bukti, minta saran AI, simpan.
 * Menyisakan kuota AI untuk pembaruan harian. Mengembalikan ringkasan untuk log.
 */
export async function checkForecasts(env, { maks = CEK_PER_GILIRAN, riwayatSelesai = true } = {}) {
  const db = env.DB;
  const list = await perluDicek(db, { maks, riwayatSelesai });
  if (!list.length) return { ok: true, dicek: 0 };
  const diminta = list.some((f) => f.cek_diminta);
  const calls = await aiCallsToday(db);
  const batas = AI_DAILY_LIMIT - (diminta ? AI_CADANGAN_DIMINTA : AI_CADANGAN);
  if (calls >= batas) return { ok: false, dicek: 0, message: 'Kuota AI hari ini disisakan untuk pembaruan harian.' };

  const batch = [];
  for (const f of list) batch.push({ ...f, bukti: await kumpulkanBukti(db, f) });
  const cp = checkPrompt(batch, wibDate());
  let hasil = new Map();
  let gagal = '';
  try {
    const meta = {};
    hasil = normalizeChecks(await runJson(env, cp.system, cp.user, CEK_SCHEMA, meta), batch);
  } catch (e) {
    if (e instanceof QuotaError) return { ok: false, dicek: 0, message: e.message };
    gagal = String(e.message || e).slice(0, 200);
  }
  const now = nowIso();
  await db.batch(
    batch.map((f) => {
      const h = hasil.get(f.id);
      const bukti = JSON.stringify({ berita: f.bukti.berita, harga: f.bukti.harga, dipakai: h ? h.dipakai : [], dasar: f.bukti.dasar, sampai: f.bukti.sampai });
      return db
        .prepare(
          'UPDATE forecasts SET saran_status = ?, saran_alasan = ?, saran_keyakinan = ?, saran_bukti = ?, saran_at = ?, cek_diminta = NULL WHERE id = ?'
        )
        .bind(
          h ? h.status : 'gagal',
          h ? h.alasan : gagal ? 'Pengecekan AI gagal: ' + gagal : 'AI tidak memberi penilaian untuk perkiraan ini.',
          h ? h.keyakinan : null,
          bukti,
          now,
          f.id
        );
    })
  );
  return { ok: true, dicek: batch.length, hasil: [...hasil.values()].map((h) => h.status) };
}

// ---------- Bentuk keluaran API ----------

export function forecastOut(r, today = wibDate()) {
  const saran = r.saran_status
    ? {
        status: r.saran_status,
        alasan: r.saran_alasan || '',
        keyakinan: r.saran_keyakinan,
        at: r.saran_at,
        bukti: (() => {
          try {
            return JSON.parse(r.saran_bukti || '{}');
          } catch {
            return {};
          }
        })(),
      }
    : null;
  const menunggu = r.status === 'menunggu';
  return {
    id: r.id,
    event_id: r.event_id,
    event_judul: r.event_judul,
    event_tanggal: r.event_tanggal,
    event_tingkat: r.event_tingkat,
    teks: r.teks,
    tanggal_cek: r.tanggal_cek,
    status: r.status,
    catatan: r.catatan || '',
    created_at: r.created_at,
    asal: r.asal || 'manual',
    kelompok: kelompokPerkiraan(r.teks, parseList(r.event_sektor)),
    jatuh_tempo: menunggu && r.tanggal_cek <= today,
    // Perlu keputusan pemilik: sudah jatuh tempo, atau AI sudah menemukan jawabannya lebih awal.
    perlu: Boolean(menunggu && (r.tanggal_cek <= today || (saran && ['terjadi', 'tidak'].includes(saran.status)))),
    antre: Boolean(r.cek_diminta),
    saran,
    diputuskan_at: r.diputuskan_at || null,
    diputuskan_dengan: r.diputuskan_dengan || null,
    cari: cariManualUrl(r.teks),
  };
}

/** Ringkasan ketepatan dan kesepakatan AI-pemilik. */
export function ringkasan(list) {
  const selesai = list.filter((f) => f.status === 'terjadi' || f.status === 'tidak');
  const banding = selesai.filter((f) => f.saran && ['terjadi', 'tidak'].includes(f.saran.status));
  return {
    total: list.length,
    perlu: list.filter((f) => f.perlu).length,
    menunggu: list.filter((f) => f.status === 'menunggu' && !f.perlu).length,
    selesai: selesai.length,
    terjadi: selesai.filter((f) => f.status === 'terjadi').length,
    banding: banding.length,
    sepakat: banding.filter((f) => f.status === f.saran.status).length,
  };
}

export const KELOMPOK_PERKIRAAN = [...KELOMPOK.map(({ id, nama }) => ({ id, nama })), LINTAS];
