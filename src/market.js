import {
  KELOMPOK,
  SERI_HARGA,
  MIN_RIWAYAT,
  Z_BERGERAK,
  HARGA_BASI_HARI,
  BERITA_MIN,
  BERITA_RASIO,
} from './constants.js';
import { wibDate, addDays, nowIso, parseList, kelompokOf } from './util.js';

/**
 * Pergerakan pasar per kelompok sektor, dengan pendekatan hibrida:
 * - kelompok yang punya seri harga harian dinilai dari gerak harga hari ini dibanding
 *   kebiasaan geraknya sendiri (30 perubahan harian terakhir);
 * - kelompok lain, atau bila data harga tidak tersedia, dinilai dari lonjakan berita.
 * Data harga hanya dipakai di belakang layar untuk prioritas; yang tampil hanya labelnya.
 */

const UA = 'PetaRantaiPeristiwa/1.0 (prototipe pribadi)';

export class KeyMissing extends Error {}

/** Ambil satu seri harga. Mengembalikan [{ day, nilai, perkiraan? }]. */
export async function fetchSeries(kode, env) {
  if (kode === 'USDIDR') {
    const start = addDays(wibDate(), -70);
    const r = await fetch(`https://api.frankfurter.dev/v1/${start}..?from=USD&to=IDR`, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    return Object.entries(d.rates || {})
      .map(([day, v]) => ({ day, nilai: Number(v?.IDR) }))
      .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.day) && x.nilai > 0);
  }
  if (kode === 'XAU') {
    const r = await fetch('https://api.gold-api.com/price/XAU', { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const nilai = Number(d.price);
    if (!(nilai > 0)) throw new Error('harga emas tidak terbaca');
    const t = Date.parse(d.updatedAt || '');
    return [{ day: Number.isNaN(t) ? wibDate() : wibDate(new Date(t)), nilai }];
  }
  if (kode === 'BRENT') {
    if (!env.API_NINJAS_KEY) throw new KeyMissing('secret API_NINJAS_KEY belum diatur di Cloudflare');
    const r = await fetch('https://api.api-ninjas.com/v1/oilprice?type=brent', {
      headers: { 'User-Agent': UA, 'X-Api-Key': env.API_NINJAS_KEY },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const nilai = Number(d.price);
    if (!(nilai > 0)) throw new Error('harga Brent tidak terbaca');
    const day = Number(d.updated) > 0 ? wibDate(new Date(Number(d.updated) * 1000)) : wibDate();
    const out = [{ day, nilai }];
    // Paket gratis hanya memberi harga terakhir. Harga penutupan sebelumnya disimpan untuk
    // hari sebelumnya (tidak menimpa data yang sudah ada) agar perubahan harian bisa dihitung.
    if (Number(d.previous_close) > 0) out.push({ day: addDays(day, -1), nilai: Number(d.previous_close), perkiraan: true });
    return out;
  }
  throw new Error('seri tidak dikenal: ' + kode);
}

/**
 * Riwayat harga harian gratis tanpa key, hanya untuk mengisi hari yang belum punya data
 * (tidak pernah menimpa harga dari sumber utama).
 * - Brent: FRED (Federal Reserve Bank of St. Louis), seri DCOILBRENTEU dari EIA. Biasanya
 *   tertinggal beberapa hari, jadi dipakai sebagai pembanding 30 hari, bukan harga hari ini.
 */
export const RIWAYAT_HARGA = {
  BRENT: { sumber: 'FRED (EIA)', url: (start) => `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILBRENTEU&cosd=${start}` },
};

export function parseFredCsv(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/).slice(1)) {
    const [day, v] = line.split(',');
    const nilai = Number(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day || '') && nilai > 0) out.push({ day, nilai });
  }
  return out;
}

async function fetchHistory(kode) {
  const h = RIWAYAT_HARGA[kode];
  const r = await fetch(h.url(addDays(wibDate(), -75)), { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  if (!/^\s*(observation_date|DATE)/i.test(text)) throw new Error('bukan CSV FRED');
  return parseFredCsv(text);
}

/** Ambil semua seri harga dan simpan. Kegagalan satu sumber tidak menghentikan pembaruan. */
export async function collectMarket(env) {
  const db = env.DB;
  const notes = [];
  for (const kode of Object.keys(SERI_HARGA)) {
    if (RIWAYAT_HARGA[kode]) {
      try {
        const rows = await fetchHistory(kode);
        if (rows.length) {
          await db.batch(
            rows.map((x) =>
              db
                .prepare('INSERT OR IGNORE INTO market_prices (kode, day, nilai, sumber, fetched_at) VALUES (?, ?, ?, ?, ?)')
                .bind(kode, x.day, x.nilai, RIWAYAT_HARGA[kode].sumber, nowIso())
            )
          );
        }
        notes.push(`${SERI_HARGA[kode].nama} riwayat ${RIWAYAT_HARGA[kode].sumber}: ${rows.length} data`);
      } catch (e) {
        notes.push(`${SERI_HARGA[kode].nama} riwayat gagal (${String(e.message || e).slice(0, 60)})`);
      }
    }
    try {
      const rows = await fetchSeries(kode, env);
      if (rows.length) {
        await db.batch(
          rows.map((x) =>
            db
              .prepare(
                // Penutupan sebelumnya ("perkiraan") boleh menggantikan data riwayat sumber lain
                // agar perubahan harian dihitung dari sumber yang sama, tetapi tidak menimpa
                // data sumber utama yang sudah tersimpan.
                x.perkiraan
                  ? "INSERT INTO market_prices (kode, day, nilai, sumber, fetched_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(kode, day) DO UPDATE SET nilai = excluded.nilai, sumber = excluded.sumber, fetched_at = excluded.fetched_at WHERE market_prices.sumber != excluded.sumber"
                  : 'INSERT INTO market_prices (kode, day, nilai, sumber, fetched_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(kode, day) DO UPDATE SET nilai = excluded.nilai, sumber = excluded.sumber, fetched_at = excluded.fetched_at'
              )
              .bind(kode, x.day, x.nilai, SERI_HARGA[kode].sumber, nowIso())
          )
        );
      }
      notes.push(`${SERI_HARGA[kode].nama}: ${rows.length} data`);
    } catch (e) {
      notes.push(`${SERI_HARGA[kode].nama} gagal (${String(e.message || e).slice(0, 80)})`);
    }
  }
  return 'Harga pasar: ' + notes.join(', ');
}

/**
 * Harga terakhir pada atau sebelum suatu tanggal, dan harga terbaru. Untuk bukti perkiraan.
 * Mengembalikan null bila salah satunya tidak ada atau keduanya hari yang sama.
 */
export async function priceChange(db, kode, sejak) {
  const a = await db.prepare('SELECT day, nilai FROM market_prices WHERE kode = ? AND day <= ? ORDER BY day DESC LIMIT 1').bind(kode, sejak).first();
  const b = await db.prepare('SELECT day, nilai FROM market_prices WHERE kode = ? ORDER BY day DESC LIMIT 1').bind(kode).first();
  if (!a || !b || b.day <= a.day) return null;
  return { kode, nama: SERI_HARGA[kode].nama, dari: a, ke: b, perubahan: (b.nilai / a.nilai - 1) * 100 };
}

// ---------- Perhitungan sinyal (fungsi murni, mudah diuji) ----------

function sd(xs) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

/**
 * Gerak harga terakhir dibanding kebiasaan geraknya.
 * values: [{ day, nilai }] urut naik. Mengembalikan null bila data tidak cukup atau basi.
 */
export function priceSignal(values, prior, today = wibDate()) {
  if (!values || values.length < 2) return { ok: false, alasan: 'riwayat harga belum cukup' };
  const last = values[values.length - 1];
  if (last.day < addDays(today, -HARGA_BASI_HARI)) return { ok: false, alasan: `data terakhir ${last.day}` };
  const ret = [];
  for (let i = 1; i < values.length; i++) ret.push((values[i].nilai / values[i - 1].nilai - 1) * 100);
  const perubahan = ret[ret.length - 1];
  const dasar = ret.slice(-31, -1);
  const sementara = dasar.length < MIN_RIWAYAT;
  const biasa = sementara ? prior : sd(dasar);
  if (!(biasa > 0)) return { ok: false, alasan: 'gerak biasanya belum bisa dihitung' };
  const z = Math.abs(perubahan) / biasa;
  return { ok: true, day: last.day, perubahan, biasa, z, sementara, n: dasar.length, bergerak: z >= Z_BERGERAK };
}

/**
 * Lonjakan berita per kelompok: porsi peristiwa kelompok itu pada hari pembaruan terakhir
 * dibanding rata-rata porsinya pada 7 hari sebelumnya. Memakai porsi, bukan jumlah,
 * supaya hari dengan pengambilan berita 7 hari sekaligus tidak dianggap lonjakan.
 * rows: [{ hari, kelompok: [...] }] satu baris per peristiwa (hari = tanggal WIB dibuat).
 */
export function newsSignals(rows) {
  const byDay = new Map();
  for (const r of rows) {
    if (!byDay.has(r.hari)) byDay.set(r.hari, { total: 0, per: {} });
    const d = byDay.get(r.hari);
    d.total++;
    for (const k of r.kelompok) d.per[k] = (d.per[k] || 0) + 1;
  }
  const days = [...byDay.keys()].sort();
  const out = {};
  const latest = days[days.length - 1];
  const prev = days.filter((d) => d < latest && d >= addDays(latest, -7));
  for (const k of KELOMPOK) {
    if (!latest || prev.length < 2) {
      out[k.id] = { ok: false, alasan: 'riwayat berita belum cukup (butuh 3 hari pembaruan)' };
      continue;
    }
    const today = byDay.get(latest);
    const n = today.per[k.id] || 0;
    const porsi = n / today.total;
    const rata = prev.reduce((a, d) => a + (byDay.get(d).per[k.id] || 0) / byDay.get(d).total, 0) / prev.length;
    const rasio = porsi / Math.max(rata, 0.02);
    out[k.id] = { ok: true, day: latest, n, porsi, rata, rasio, bergerak: n >= BERITA_MIN && rasio >= BERITA_RASIO };
  }
  return out;
}

const pct = (x, digits = 1) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(digits).replace('.', ',') + '%';
const kali = (x) => x.toFixed(1).replace('.', ',') + '×';

function hargaLabel(kode, s) {
  const nama = SERI_HARGA[kode].nama;
  const arah = kode === 'USDIDR' ? (s.perubahan > 0 ? ' (rupiah melemah)' : s.perubahan < 0 ? ' (rupiah menguat)' : '') : '';
  const banding = s.bergerak ? `, ${kali(s.z)} gerak biasanya, tidak biasa` : ', dalam batas biasa';
  const tmp = s.sementara ? ' · pembanding sementara' : '';
  return `${nama} ${pct(s.perubahan, kode === 'USDIDR' ? 2 : 1)}${arah}${banding}${tmp}`;
}

function beritaLabel(s) {
  const p = (x) => Math.round(x * 100) + '%';
  return `${s.n} peristiwa (${p(s.porsi)} dari pembaruan terakhir; biasanya ${p(s.rata)})${s.bergerak ? ', lonjakan berita' : ''}`;
}

/** Hitung sinyal semua kelompok dari harga tersimpan dan peristiwa 8 hari terakhir. */
export async function computeSignals(db, today = wibDate()) {
  const prices = {};
  for (const kode of Object.keys(SERI_HARGA)) {
    const rows = await db
      .prepare('SELECT day, nilai FROM market_prices WHERE kode = ? AND day <= ? ORDER BY day DESC LIMIT 45')
      .bind(kode, today)
      .all();
    prices[kode] = rows.results.reverse();
  }
  const evRows = await db
    // Peristiwa dari isi riwayat tidak dihitung: semuanya dibuat pada hari yang sama dan akan mengacaukan porsi harian.
    .prepare(
      "SELECT created_at, sektor FROM events WHERE status = 'aktif' AND created_at >= ? AND (run_id IS NULL OR run_id NOT IN (SELECT id FROM runs WHERE trigger = 'riwayat'))"
    )
    .bind(new Date(`${addDays(today, -8)}T00:00:00+07:00`).toISOString())
    .all();
  const news = newsSignals(
    evRows.results.map((r) => ({ hari: wibDate(new Date(r.created_at)), kelompok: kelompokOf(parseList(r.sektor)) }))
  );

  return KELOMPOK.map((k) => {
    const base = { id: k.id, nama: k.nama };
    if (k.harga) {
      const s = priceSignal(prices[k.harga], SERI_HARGA[k.harga].prior, today);
      if (s.ok) {
        return { ...base, metode: 'harga', bergerak: s.bergerak, day: s.day, skor: s.z, label: hargaLabel(k.harga, s) };
      }
      const n = news[k.id];
      const pengganti = `${SERI_HARGA[k.harga].nama}: ${s.alasan}; sementara dari berita`;
      if (n.ok) return { ...base, metode: 'berita', bergerak: n.bergerak, day: n.day, skor: n.rasio, label: `${beritaLabel(n)} · ${pengganti}` };
      return { ...base, metode: 'kurang-data', bergerak: false, label: `${pengganti}, ${n.alasan}` };
    }
    const n = news[k.id];
    if (n.ok) return { ...base, metode: 'berita', bergerak: n.bergerak, day: n.day, skor: n.rasio, label: beritaLabel(n) };
    return { ...base, metode: 'kurang-data', bergerak: false, label: n.alasan[0].toUpperCase() + n.alasan.slice(1) };
  });
}
