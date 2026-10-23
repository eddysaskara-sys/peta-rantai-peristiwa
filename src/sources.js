import {
  GDELT_QUERIES,
  GDELT_RIWAYAT,
  RSS_FEEDS,
  MAX_LOKAL,
  MAX_INTERNASIONAL,
  GNEWS_TOPIK,
  GNEWS_EDISI,
  GNEWS_PER_TOPIK,
  GNEWS_PER_TOPIK_RIWAYAT,
  RSS_PER_FEED,
  GNEWS_JEDA_MS,
  DOMAIN_INDONESIA,
  DOMAIN_INTERNASIONAL,
} from './constants.js';
import { sleep, addDays } from './util.js';

const UA = 'PetaRantaiPeristiwa/1.0 (prototipe pribadi)';
const MAX_XML = 150_000; // batasi ukuran yang diproses agar hemat CPU
const MAX_XML_GNEWS = 260_000; // feed Google News lebih panjang karena deskripsinya berisi HTML

/**
 * Ambil semua sumber berita. Sumber yang gagal dicatat, tidak menghentikan proses.
 * - Pembaruan biasa: { days } -> feed RSS + pencarian topik Google News beberapa hari terakhir.
 * - Riwayat: { jendela: { mulai, sampai } } -> hanya Google News, dibatasi tanggal, karena feed RSS
 *   hanya berisi berita terbaru.
 */
export async function collectHeadlines(opts = {}) {
  if (typeof opts === 'number') opts = { days: opts };
  const days = Math.max(1, Math.min(7, Number(opts.days) || 1));
  const jendela = opts.jendela || null;
  const errors = [];
  const stats = [];

  const rssPromise = jendela
    ? Promise.resolve([])
    : Promise.all(
        RSS_FEEDS.map(async (feed) => {
          const name = feed.label || feed.source;
          try {
            const r = await fetch(feed.url, { headers: { 'User-Agent': UA } });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const xml = (await r.text()).slice(0, MAX_XML);
            const items = parseRss(xml, feed.source, feed.origin, RSS_PER_FEED);
            stats.push(`${name}: ${items.length}`);
            return items;
          } catch (e) {
            errors.push(`${name}: ${e.message}`);
            return [];
          }
        })
      );

  // Pembaruan biasa: semua topik sekaligus. Riwayat: berurutan dengan jeda, dan berhenti bila
  // Google News menolak beberapa kali berturut-turut agar tidak memperparah pembatasan.
  const ambilTopik = async (t, i) => {
    const name = `Google News ${t.edisi.toUpperCase()} #${i + 1}`;
    try {
      const items = await fetchGnews(t, jendela ? { jendela } : { days });
      stats.push(`${name}: ${items.length}`);
      return items;
    } catch (e) {
      errors.push(`${name}: ${String(e.message || e).slice(0, 80)}`);
      return null;
    }
  };
  let gnewsPromise;
  if (!jendela) {
    gnewsPromise = Promise.all(GNEWS_TOPIK.map((t, i) => ambilTopik(t, i).then((x) => x || [])));
  } else {
    gnewsPromise = (async () => {
      const out = [];
      let tolak = 0;
      for (let i = 0; i < GNEWS_TOPIK.length; i++) {
        if (i > 0) await sleep(GNEWS_JEDA_MS);
        const items = await ambilTopik(GNEWS_TOPIK[i], i);
        if (items) {
          tolak = 0;
          out.push(items);
        } else if (++tolak >= 3) {
          errors.push('Google News menolak 3 kali berturut-turut; topik lain dilewati.');
          break;
        }
      }
      return out;
    })();
  }

  // GDELT membatasi kira-kira 1 permintaan per 5 detik per alamat IP. Alamat IP Cloudflare
  // dipakai bersama banyak pengguna, jadi diberi jeda lebih lama dan satu kali coba ulang.
  // Pembaruan biasa memakai GDELT_QUERIES (kosong); riwayat memakai GDELT_RIWAYAT sebagai cadangan.
  const rentang = jendela
    ? { start: gdeltTime(Date.parse(`${jendela.mulai}T00:00:00+07:00`)), end: gdeltTime(Date.parse(`${addDays(jendela.sampai, 1)}T00:00:00+07:00`) - 1000) }
    : `${days}d`;
  const queries = jendela ? GDELT_RIWAYAT : GDELT_QUERIES;
  if (jendela) await gnewsPromise; // jangan menumpuk permintaan riwayat
  const gdelt = [];
  for (let i = 0; i < queries.length; i++) {
    if (i > 0) await sleep(7000);
    let items = null;
    for (let attempt = 0; attempt < 2 && items === null; attempt++) {
      try {
        items = await fetchGdelt(queries[i], rentang);
      } catch (e) {
        if (attempt === 0 && /limit requests|429/i.test(e.message)) {
          await sleep(12000);
        } else {
          errors.push(`GDELT #${i + 1}: ${e.message.slice(0, 80)}`);
          break;
        }
      }
    }
    if (items) {
      stats.push(`GDELT #${i + 1}: ${items.length}`);
      gdelt.push(...items);
    }
  }

  const rss = (await rssPromise).flat();
  const gnews = (await gnewsPromise).flat();
  let all = [...gdelt, ...rss, ...gnews];
  if (jendela) {
    // Google News tidak selalu menaati after:/before: (uji 23 Okt: jendela 1-4 Okt berisi berita 5 Okt),
    // jadi tanggal disaring ketat menurut WIB, lalu dipilih merata per hari.
    const from = Date.parse(`${jendela.mulai}T00:00:00+07:00`);
    const to = Date.parse(`${addDays(jendela.sampai, 1)}T00:00:00+07:00`);
    all = all.filter((a) => a.published_at && Date.parse(a.published_at) >= from && Date.parse(a.published_at) < to);
  } else {
    const cutoff = Date.now() - (days + 1) * 86400000;
    all = all.filter((a) => !a.published_at || Date.parse(a.published_at) >= cutoff);
  }
  return { headlines: selectHeadlines(all, MAX_LOKAL, MAX_INTERNASIONAL, { perHari: Boolean(jendela) }), errors, stats, total: all.length };
}

/** Alamat pencarian Google News RSS untuk satu topik. */
export function gnewsUrl(topik, { days = 1, jendela = null, setelah = null } = {}) {
  const ed = GNEWS_EDISI[topik.edisi] || GNEWS_EDISI.id;
  let q = topik.q;
  if (jendela) q += ` after:${jendela.mulai} before:${addDays(jendela.sampai, 1)}`;
  else if (setelah) q += ` after:${setelah}`;
  else q += ` when:${days + 1}d`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${ed.hl}&gl=${ed.gl}&ceid=${ed.ceid}`;
}

export async function fetchGnews(topik, opts = {}) {
  const r = await fetch(gnewsUrl(topik, opts), { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const xml = (await r.text()).slice(0, MAX_XML_GNEWS);
  const ed = GNEWS_EDISI[topik.edisi] || GNEWS_EDISI.id;
  const limit = opts.limit || (opts.jendela ? GNEWS_PER_TOPIK_RIWAYAT : GNEWS_PER_TOPIK);
  return parseGnews(xml, ed.origin, limit);
}

/** Feed Google News: judul berakhiran " - Nama Media", media asli ada di <source url="...">. */
export function parseGnews(xml, defaultOrigin, limit = 30) {
  const out = [];
  for (const it of items(xml, limit * 2)) {
    if (out.length >= limit) break;
    let title = decodeEntities(stripTags(tag(it, 'title')));
    const link = tag(it, 'link').trim();
    const srcM = it.match(/<source[^>]*url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/);
    const srcName = srcM ? decodeEntities(srcM[2]).trim() : '';
    const host = srcM ? hostOf(decodeEntities(srcM[1])) : '';
    if (srcName && title.endsWith(' - ' + srcName)) title = title.slice(0, -(srcName.length + 3));
    if (!title || !/^https?:\/\//.test(link)) continue;
    out.push({
      url: link,
      title: cleanTitle(title),
      source: host || srcName || 'news.google.com',
      origin: originOf(host, defaultOrigin),
      published_at: toIso(tag(it, 'pubDate')),
    });
  }
  return out;
}

/** Media Indonesia atau internasional, dari nama domainnya. */
export function originOf(host, fallback) {
  if (!host) return fallback;
  const match = (list) => list.some((d) => host === d || host.endsWith('.' + d));
  if (host.endsWith('.id') || match(DOMAIN_INDONESIA)) return 'lokal';
  if (match(DOMAIN_INTERNASIONAL)) return 'internasional';
  return fallback;
}

/** Waktu UTC dalam format GDELT (YYYYMMDDHHMMSS). */
export function gdeltTime(ms) {
  return new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

/** rentang: "3d" (timespan) atau { start, end } dalam format GDELT. */
export async function fetchGdelt(query, rentang) {
  const waktu = typeof rentang === 'string' ? `&timespan=${rentang}` : `&startdatetime=${rentang.start}&enddatetime=${rentang.end}`;
  const url =
    'https://api.gdeltproject.org/api/v2/doc/doc?query=' +
    encodeURIComponent(query) +
    `&mode=artlist&format=json&maxrecords=${typeof rentang === 'string' ? 50 : 150}${waktu}&sort=hybridrel`;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  const text = await r.text();
  if (!text.trim().startsWith('{')) throw new Error(text.slice(0, 120) || `HTTP ${r.status}`);
  const data = JSON.parse(text);
  return (data.articles || [])
    .filter((a) => a.url && a.title)
    .map((a) => ({
      url: a.url,
      title: cleanTitle(a.title),
      source: a.domain || hostOf(a.url),
      origin: a.sourcecountry === 'Indonesia' ? 'lokal' : 'internasional',
      published_at: gdeltDate(a.seendate),
    }));
}

export function parseRss(xml, source, origin, limit = 30) {
  const out = [];
  for (const it of items(xml, limit * 2)) {
    if (out.length >= limit) break;
    const title = decodeEntities(stripTags(tag(it, 'title')));
    const link = (tag(it, 'link') || tag(it, 'guid')).trim();
    if (!title || !/^https?:\/\//.test(link)) continue;
    out.push({
      url: link,
      title: cleanTitle(title),
      source,
      origin,
      published_at: toIso(tag(it, 'pubDate') || tag(it, 'dc:date')),
    });
  }
  return out;
}

/**
 * Buang duplikat, lalu pilih bergiliran per media (terbaru dulu di tiap media), terpisah untuk
 * media lokal dan internasional. Urutan hasil: semua lokal dulu, lalu internasional.
 */
export function selectHeadlines(list, maxLokal = MAX_LOKAL, maxIntl = MAX_INTERNASIONAL, { perHari = false } = {}) {
  const seenUrl = new Set();
  const seenTitle = new Set();
  const unique = [];
  for (const a of list) {
    const key = titleKey(a.title);
    if (seenUrl.has(a.url) || seenTitle.has(key)) continue;
    seenUrl.add(a.url);
    seenTitle.add(key);
    unique.push(a);
  }
  unique.sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));
  const pick = perHari ? roundRobinPerHari : roundRobin;
  const lokal = pick(unique.filter((a) => a.origin === 'lokal'), maxLokal);
  const intl = pick(unique.filter((a) => a.origin !== 'lokal'), maxIntl);
  return [...lokal, ...intl];
}

/** Riwayat: bergiliran per hari (WIB), dan di dalam tiap hari bergiliran per media. */
function roundRobinPerHari(items, max) {
  const byDay = new Map();
  for (const a of items) {
    const d = a.published_at ? new Date(Date.parse(a.published_at) + 7 * 3600e3).toISOString().slice(0, 10) : '';
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(a);
  }
  const queues = [...byDay.values()].map((list) => roundRobin(list, list.length));
  const out = [];
  let i = 0;
  while (out.length < max && queues.some((q) => q.length)) {
    const q = queues[i++ % queues.length];
    if (q.length) out.push(q.shift());
  }
  return out.sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));
}

export function titleKey(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
}

function roundRobin(items, max) {
  const bySrc = new Map();
  for (const a of items) {
    if (!bySrc.has(a.source)) bySrc.set(a.source, []);
    bySrc.get(a.source).push(a);
  }
  const queues = [...bySrc.values()];
  const out = [];
  let i = 0;
  while (out.length < max && queues.some((q) => q.length)) {
    const q = queues[i++ % queues.length];
    if (q.length) out.push(q.shift());
  }
  // Kembalikan dalam urutan waktu terbaru agar daftar untuk AI tetap rapi.
  return out.sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));
}

/** Isi elemen XML pertama bernama `name` (tanpa regex agar hemat CPU di Cloudflare). */
function tag(s, name) {
  const open = '<' + name;
  let i = s.indexOf(open);
  while (i >= 0) {
    const c = s.charCodeAt(i + open.length);
    if (c === 62 || c === 32 || c === 9 || c === 10 || c === 13) break; // '>' atau spasi
    i = s.indexOf(open, i + 1);
  }
  if (i < 0) return '';
  const start = s.indexOf('>', i) + 1;
  if (start <= 0 || s.charCodeAt(start - 2) === 47) return ''; // <tag ... /> tanpa isi
  const end = s.indexOf('</' + name + '>', start);
  if (end < 0) return '';
  let v = s.slice(start, end).trim();
  if (v.startsWith('<![CDATA[')) v = v.slice(9);
  if (v.endsWith(']]>')) v = v.slice(0, -3);
  return v.trim();
}

/** Potong XML menjadi blok <item>...</item> (paling banyak `limit` blok). */
function items(xml, limit) {
  const out = [];
  let i = 0;
  while (out.length < limit) {
    i = xml.indexOf('<item', i);
    if (i < 0) break;
    const c = xml.charCodeAt(i + 5);
    if (c !== 62 && c !== 32 && c !== 10 && c !== 13 && c !== 9) {
      i += 5;
      continue;
    }
    const end = xml.indexOf('</item>', i);
    if (end < 0) break;
    out.push(xml.slice(i, end + 7));
    i = end + 7;
  }
  return out;
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, ' ');
}

export function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

export function cleanTitle(t) {
  return t
    .replace(/\s+/g, ' ')
    .replace(/(\d) ([,.]) (\d)/g, '$1$2$3') // GDELT: "5 , 75" -> "5,75"
    .replace(/\s+([,.:;!?%)])/g, '$1')
    .replace(/([(])\s+/g, '$1')
    .trim()
    .slice(0, 220);
}

function gdeltDate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s || '');
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

function toIso(s) {
  if (!s) return null;
  const t = Date.parse(s.trim());
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function hostOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
