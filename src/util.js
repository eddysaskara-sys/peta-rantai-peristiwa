const WIB_MS = 7 * 3600 * 1000;

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
