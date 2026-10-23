import { KELOMPOK } from './constants.js';

const WIB_MS = 7 * 3600 * 1000;

const KELOMPOK_DARI_SEKTOR = new Map(KELOMPOK.flatMap((k) => k.sektor.map((s) => [s, k.id])));

/** Kelompok (id) dari daftar label sektor rinci, urut sesuai daftar KELOMPOK. */
export function kelompokOf(sektor) {
  const ids = new Set((sektor || []).map((s) => KELOMPOK_DARI_SEKTOR.get(s)).filter(Boolean));
  return KELOMPOK.map((k) => k.id).filter((id) => ids.has(id));
}

/** Awal hari WIB (00.00) dalam ISO UTC, untuk membandingkan dengan kolom *_at. */
export function wibDayStartIso(day = wibDate()) {
  return new Date(`${day}T00:00:00+07:00`).toISOString();
}

/** Tanggal WIB (YYYY-MM-DD) untuk sebuah waktu, default sekarang. */
export function wibDate(d = new Date()) {
  return new Date(d.getTime() + WIB_MS).toISOString().slice(0, 10);
}

export function wibDateDaysAgo(days) {
  return wibDate(new Date(Date.now() - days * 86400000));
}

export function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function nowIso() {
  return new Date().toISOString();
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function parseList(value) {
  if (!value) return [];
  try {
    const v = JSON.parse(value);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Jalankan query "... IN (?)" per potongan, karena D1 membatasi 100 variabel per query.
 * sql: fungsi (placeholder) -> teks SQL. extra: parameter lain yang ditaruh SEBELUM daftar id.
 */
export async function allInChunks(db, sql, ids, extra = [], size = 90) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) {
    const chunk = ids.slice(i, i + size);
    const rows = await db.prepare(sql(chunk.map(() => '?').join(','))).bind(...extra, ...chunk).all();
    out.push(...rows.results);
  }
  return out;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Perbandingan string dengan waktu konstan, untuk memeriksa PIN. */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Cocokkan label buatan AI ke daftar resmi (tidak peka huruf besar/kecil). */
export function matchLabels(values, allowed, max) {
  if (!Array.isArray(values)) return [];
  const map = new Map(allowed.map((a) => [norm(a), a]));
  const out = [];
  for (const v of values) {
    const hit = map.get(norm(String(v)));
    if (hit && !out.includes(hit)) out.push(hit);
    if (out.length >= max) break;
  }
  return out;
}

function norm(s) {
  return s.toLowerCase().replace(/&/g, 'dan').replace(/[^a-z0-9]/g, '');
}
