import { GDELT_QUERIES, RSS_FEEDS, MAX_LOKAL, MAX_INTERNASIONAL } from './constants.js';
import { sleep } from './util.js';

const UA = 'PetaRantaiPeristiwa/1.0 (prototipe pribadi)';
const MAX_XML = 150_000; // batasi ukuran yang diproses agar hemat CPU

/** Ambil semua sumber berita. Sumber yang gagal dicatat, tidak menghentikan proses. */
export async function collectHeadlines(days) {
  const errors = [];
  const timespan = `${Math.max(1, Math.min(7, days))}d`;

  const rssPromise = Promise.all(
    RSS_FEEDS.map(async (feed) => {
      try {
        const r = await fetch(feed.url, { headers: { 'User-Agent': UA } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const xml = (await r.text()).slice(0, MAX_XML);
        return parseRss(xml, feed.source, feed.origin, 30);
      } catch (e) {
        errors.push(`${feed.source}: ${e.message}`);
        return [];
      }
    })
  );

  // GDELT membatasi kira-kira 1 permintaan per 5 detik, jadi dijalankan berurutan.
  const gdelt = [];
  for (let i = 0; i < GDELT_QUERIES.length; i++) {
    if (i > 0) await sleep(5500);
    try {
      gdelt.push(...(await fetchGdelt(GDELT_QUERIES[i], timespan)));
    } catch (e) {
      errors.push(`GDELT #${i + 1}: ${e.message}`);
    }
  }

  const rss = (await rssPromise).flat();
  const cutoff = Date.now() - (days + 1) * 86400000;
  const all = [...gdelt, ...rss].filter((a) => !a.published_at || Date.parse(a.published_at) >= cutoff);
  return { headlines: selectHeadlines(all), errors };
}

export async function fetchGdelt(query, timespan) {
  const url =
    'https://api.gdeltproject.org/api/v2/doc/doc?query=' +
    encodeURIComponent(query) +
    `&mode=artlist&format=json&maxrecords=50&timespan=${timespan}&sort=hybridrel`;
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
  const items = [];
  const re = /<item[\s>][\s\S]*?<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && items.length < limit) {
    const it = m[0];
    const title = decodeEntities(stripTags(tag(it, 'title')));
    const link = (tag(it, 'link') || tag(it, 'guid')).trim();
    if (!title || !/^https?:\/\//.test(link)) continue;
    items.push({
      url: link,
      title: cleanTitle(title),
      source,
      origin,
      published_at: toIso(tag(it, 'pubDate') || tag(it, 'dc:date')),
    });
  }
  return items;
}

/** Buang duplikat, urutkan terbaru, dan seimbangkan media lokal dan internasional. */
export function selectHeadlines(list) {
  const seenUrl = new Set();
  const seenTitle = new Set();
  const unique = [];
  for (const a of list) {
    const key = a.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
    if (seenUrl.has(a.url) || seenTitle.has(key)) continue;
    seenUrl.add(a.url);
    seenTitle.add(key);
    unique.push(a);
  }
  unique.sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));
  const lokal = unique.filter((a) => a.origin === 'lokal').slice(0, MAX_LOKAL);
  const intl = unique.filter((a) => a.origin !== 'lokal').slice(0, MAX_INTERNASIONAL);
  return [...lokal, ...intl];
}

function tag(s, name) {
  const m = s.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`));
  if (!m) return '';
  return m[1].replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();
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

function hostOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
