import { runPipeline, enqueueRun, processQueue } from './pipeline.js';
import { SEKTOR, INDIKATOR, JENIS, AI_DAILY_LIMIT, KELOMPOK, LINTAS_SEKTOR, MAKS_TINJAU } from './constants.js';
import { json, parseList, safeEqual, wibDate, wibDateDaysAgo, addDays, nowIso, kelompokOf } from './util.js';
import { computeSignals } from './market.js';
import { reviewQueue, decidedToday, poolCount } from './priority.js';

const DAILY_CRON = '30 10 * * *';

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (e) {
      console.error(e);
      return json({ error: String(e.message || e) }, 500);
    }
  },

  // Jadwal (lihat [triggers] di wrangler.toml):
  // - 17.30 WIB: pembaruan otomatis harian
  // - tiap 5 menit: jalankan permintaan "Ambil berita sekarang" yang sedang antre
  async scheduled(event, env, ctx) {
    if (event.cron === DAILY_CRON) ctx.waitUntil(runPipeline(env, { trigger: 'jadwal', days: 1 }));
    else ctx.waitUntil(processQueue(env));
  },
};

function isOwner(request, env) {
  const pin = request.headers.get('x-pin') || '';
  return Boolean(env.ADMIN_PIN) && safeEqual(pin, env.ADMIN_PIN);
}

function requireOwner(request, env) {
  if (!env.ADMIN_PIN) return json({ error: 'PIN pemilik belum diatur di Cloudflare (secret ADMIN_PIN).' }, 403);
  if (!isOwner(request, env)) return json({ error: 'PIN salah. Masuk sebagai pemilik untuk melakukan ini.' }, 401);
  return null;
}

async function body(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function eventOut(r) {
  const sektor = parseList(r.sektor);
  return {
    id: r.id,
    tanggal: r.tanggal,
    judul: r.judul,
    ringkasan: r.ringkasan,
    tingkat: r.tingkat,
    sektor,
    kelompok: kelompokOf(sektor),
    indikator: parseList(r.indikator),
    dua_sisi: r.dua_sisi || '',
    dampak: parseList(r.dampak),
    status: r.status,
    n_kaitan: r.n_kaitan ?? undefined,
    n_sumber: r.n_sumber ?? undefined,
  };
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const db = env.DB;
  const owner = isOwner(request, env);

  if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);

  // ---------- Status ----------
  if (path === '/api/status' && method === 'GET') {
    const lastRun = await db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 1').first();
    const c = await db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM events WHERE status='aktif') AS events,
          (SELECT COUNT(*) FROM links WHERE status='disetujui') AS links_ok,
          (SELECT COUNT(*) FROM links WHERE status='usulan') AS links_pending,
          (SELECT COUNT(*) FROM forecasts WHERE status='menunggu' AND tanggal_cek <= ?) AS forecasts_due,
          (SELECT calls FROM ai_usage WHERE day = ?) AS ai_calls`
      )
      .bind(wibDate(), wibDate())
      .first();
    const signals = await computeSignals(db);
    let tinjau = null;
    if (owner) {
      const sudah = await decidedToday(db);
      const kolam = await poolCount(db);
      tinjau = { maks: MAKS_TINJAU, sudah, sisa: Math.min(Math.max(0, MAKS_TINJAU - sudah), kolam), kolam };
    }
    return json({
      owner,
      pinSet: Boolean(env.ADMIN_PIN),
      today: wibDate(),
      lastRun,
      counts: c,
      tinjau,
      aiLimit: AI_DAILY_LIMIT,
      sektor: SEKTOR,
      kelompok: KELOMPOK.map(({ id, nama, sektor, harga, catatan }) => ({ id, nama, sektor, harga, catatan: catatan || '' })),
      lintas: LINTAS_SEKTOR,
      signals,
      indikator: INDIKATOR,
      jenis: JENIS,
    });
  }

  if (path === '/api/market' && method === 'GET') {
    return json({ today: wibDate(), signals: await computeSignals(db) });
  }

  if (path === '/api/login' && method === 'POST') {
    const deny = requireOwner(request, env);
    return deny || json({ ok: true });
  }

  // ---------- Peristiwa ----------
  if (path === '/api/events' && method === 'GET') {
    const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 30));
    const where = ['e.tanggal >= ?'];
    const params = [wibDateDaysAgo(days)];
    const status = url.searchParams.get('status') === 'diarsip' && owner ? 'diarsip' : 'aktif';
    where.push('e.status = ?');
    params.push(status);
    const tingkat = url.searchParams.get('tingkat');
    if (tingkat === 'global' || tingkat === 'lokal') {
      where.push('e.tingkat = ?');
      params.push(tingkat);
    }
    const sektor = url.searchParams.get('sektor');
    if (sektor && SEKTOR.includes(sektor)) {
      where.push('e.sektor LIKE ?');
      params.push(`%"${sektor}"%`);
    }
    const kel = KELOMPOK.find((k) => k.id === url.searchParams.get('kelompok'));
    if (kel) {
      where.push('(' + kel.sektor.map(() => 'e.sektor LIKE ?').join(' OR ') + ')');
      params.push(...kel.sektor.map((s) => `%"${s}"%`));
    }
    const indikator = url.searchParams.get('indikator');
    if (indikator && INDIKATOR.includes(indikator)) {
      where.push('e.indikator LIKE ?');
      params.push(`%"${indikator}"%`);
    }
    const q = (url.searchParams.get('q') || '').trim();
    if (q) {
      where.push('(e.judul LIKE ? OR e.ringkasan LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    const rows = await db
      .prepare(
        `SELECT e.*,
          (SELECT COUNT(*) FROM links l WHERE l.status='disetujui' AND (l.dari_id=e.id OR l.ke_id=e.id)) AS n_kaitan,
          (SELECT COUNT(*) FROM event_articles ea WHERE ea.event_id=e.id) AS n_sumber
         FROM events e WHERE ${where.join(' AND ')}
         ORDER BY e.tanggal DESC, e.id DESC LIMIT 300`
      )
      .bind(...params)
      .all();
    return json({ events: rows.results.map(eventOut) });
  }

  let m = path.match(/^\/api\/events\/(\d+)$/);
  if (m && method === 'GET') {
    const id = Number(m[1]);
    const ev = await db.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
    if (!ev) return json({ error: 'Peristiwa tidak ditemukan.' }, 404);
    const arts = await db
      .prepare(
        'SELECT a.title, a.url, a.source, a.origin, a.published_at FROM articles a JOIN event_articles ea ON ea.article_id = a.id WHERE ea.event_id = ? ORDER BY a.origin, a.published_at'
      )
      .bind(id)
      .all();
    const statuses = owner ? "('disetujui','usulan')" : "('disetujui')";
    const links = await db
      .prepare(
        `SELECT l.*, d.judul AS dari_judul, d.tingkat AS dari_tingkat, d.tanggal AS dari_tanggal,
                k.judul AS ke_judul, k.tingkat AS ke_tingkat, k.tanggal AS ke_tanggal
         FROM links l JOIN events d ON d.id = l.dari_id JOIN events k ON k.id = l.ke_id
         WHERE (l.dari_id = ? OR l.ke_id = ?) AND l.status IN ${statuses}
         ORDER BY l.status, l.keyakinan DESC`
      )
      .bind(id, id)
      .all();
    const fc = await db.prepare('SELECT * FROM forecasts WHERE event_id = ? ORDER BY tanggal_cek').bind(id).all();
    return json({ event: eventOut(ev), articles: arts.results, links: links.results, forecasts: fc.results });
  }

  if (m && method === 'POST') {
    const deny = requireOwner(request, env);
    if (deny) return deny;
    const b = await body(request);
    if (!['aktif', 'diarsip'].includes(b.status)) return json({ error: 'Status tidak dikenal.' }, 400);
    await db.prepare('UPDATE events SET status = ? WHERE id = ?').bind(b.status, Number(m[1])).run();
    return json({ ok: true });
  }

  // ---------- Rantai sebab-akibat ----------
  m = path.match(/^\/api\/chain\/(\d+)$/);
  if (m && method === 'GET') {
    const id = Number(m[1]);
    const depth = Math.max(1, Math.min(4, Number(url.searchParams.get('depth')) || 3));
    const withUsulan = owner && url.searchParams.get('usulan') === '1';
    const focus = await db.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
    if (!focus) return json({ error: 'Peristiwa tidak ditemukan.' }, 404);
    const statuses = withUsulan ? "('disetujui','usulan')" : "('disetujui')";
    const allLinks = (await db.prepare(`SELECT * FROM links WHERE status IN ${statuses}`).all()).results;
    const up = walk(allLinks, id, depth, 'up');
    const down = walk(allLinks, id, depth, 'down');
    const ids = [...new Set([...up, ...down].flat().map((n) => n.eventId))];
    const evMap = new Map();
    if (ids.length) {
      const rows = await db
        .prepare(`SELECT * FROM events WHERE id IN (${ids.map(() => '?').join(',')})`)
        .bind(...ids)
        .all();
      rows.results.forEach((r) => evMap.set(r.id, eventOut(r)));
    }
    const decorate = (levels) =>
      levels.map((lvl) => lvl.map((n) => ({ event: evMap.get(n.eventId), link: n.link, via: n.via })));
    return json({ focus: eventOut(focus), up: decorate(up), down: decorate(down) });
  }

  // ---------- Tinjauan pemilik ----------
  if (path === '/api/review' && method === 'GET') {
    const deny = requireOwner(request, env);
    if (deny) return deny;
    const q = await reviewQueue(db);
    const lastRun = await db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 1').first();
    const lastOk = await db.prepare('SELECT id FROM runs WHERE n_events > 0 ORDER BY id DESC LIMIT 1').first();
    let fresh = [];
    if (lastOk) {
      const rows = await db
        .prepare(
          `SELECT e.*, (SELECT COUNT(*) FROM event_articles ea WHERE ea.event_id=e.id) AS n_sumber
           FROM events e WHERE e.run_id = ? AND e.status = 'aktif' ORDER BY e.id`
        )
        .bind(lastOk.id)
        .all();
      fresh = rows.results.map(eventOut);
    }
    return json({ ...q, lastRun, fresh });
  }

  if (path === '/api/run' && method === 'POST') {
    const deny = requireOwner(request, env);
    if (deny) return deny;
    const b = await body(request);
    const days = Math.max(1, Math.min(7, Number(b.days) || 1));
    return json(await enqueueRun(env, days));
  }

  // ---------- Kaitan ----------
  m = path.match(/^\/api\/links\/(\d+)$/);
  if (m && method === 'POST') {
    const deny = requireOwner(request, env);
    if (deny) return deny;
    const b = await body(request);
    if (!['disetujui', 'ditolak', 'usulan'].includes(b.status)) return json({ error: 'Status tidak dikenal.' }, 400);
    // decided_at dipakai untuk batas MAKS_TINJAU keputusan per malam; mengembalikan ke usulan membebaskan slotnya.
    await db
      .prepare('UPDATE links SET status = ?, decided_at = ? WHERE id = ?')
      .bind(b.status, b.status === 'usulan' ? null : nowIso(), Number(m[1]))
      .run();
    return json({ ok: true });
  }

  if (path === '/api/links' && method === 'POST') {
    const deny = requireOwner(request, env);
    if (deny) return deny;
    const b = await body(request);
    const dari = Number(b.dari_id);
    const ke = Number(b.ke_id);
    if (!dari || !ke || dari === ke) return json({ error: 'Pilih dua peristiwa yang berbeda.' }, 400);
    const jenis = JENIS.includes(b.jenis) ? b.jenis : 'menyebabkan';
    await db
      .prepare(
        "INSERT INTO links (dari_id, ke_id, jenis, alasan, keyakinan, status, dibuat_oleh, created_at) VALUES (?, ?, ?, ?, 1, 'disetujui', 'manual', ?) ON CONFLICT(dari_id, ke_id) DO UPDATE SET status='disetujui', jenis=excluded.jenis, alasan=excluded.alasan"
      )
      .bind(dari, ke, jenis, String(b.alasan || '').slice(0, 300), nowIso())
      .run();
    return json({ ok: true });
  }

  // ---------- Rantai yang sudah disetujui (layar utama) ----------
  if (path === '/api/chains' && method === 'GET') {
    const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 90));
    const kel = url.searchParams.get('kelompok') || '';
    const links = (
      await db
        .prepare(
          `SELECT l.id, l.dari_id, l.ke_id, l.jenis, l.alasan FROM links l
           JOIN events d ON d.id = l.dari_id JOIN events k ON k.id = l.ke_id
           WHERE l.status = 'disetujui' AND d.status = 'aktif' AND k.status = 'aktif'`
        )
        .all()
    ).results;
    const ids = [...new Set(links.flatMap((l) => [l.dari_id, l.ke_id]))];
    const evMap = new Map();
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const rows = await db.prepare(`SELECT * FROM events WHERE id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all();
      rows.results.forEach((r) => evMap.set(r.id, eventOut(r)));
    }
    const chains = buildChains(links, evMap)
      .filter((c) => c.terbaru >= wibDateDaysAgo(days))
      .filter((c) => !kel || c.kelompok.includes(kel));
    return json({ days, kelompok: kel, chains: chains.slice(0, 30), total: chains.length });
  }

  // ---------- Sektor (6 kelompok) ----------
  if (path === '/api/sectors' && method === 'GET') {
    const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 30));
    const rows = await db
      .prepare("SELECT id, tanggal, judul, tingkat, sektor FROM events WHERE status='aktif' AND tanggal >= ? ORDER BY tanggal DESC, id DESC")
      .bind(wibDateDaysAgo(days))
      .all();
    const signals = await computeSignals(db);
    const sig = new Map(signals.map((x) => [x.id, x]));
    const stats = KELOMPOK.map((k) => ({
      id: k.id,
      nama: k.nama,
      catatan: k.catatan || '',
      global: 0,
      lokal: 0,
      rinci: Object.fromEntries(k.sektor.map((s) => [s, 0])),
      terbaru: null,
      signal: sig.get(k.id),
    }));
    const byId = new Map(stats.map((s) => [s.id, s]));
    let lintas = 0;
    for (const r of rows.results) {
      const sektor = parseList(r.sektor);
      const kel = kelompokOf(sektor);
      if (!kel.length) lintas++;
      for (const id of kel) {
        const st = byId.get(id);
        st[r.tingkat === 'global' ? 'global' : 'lokal']++;
        for (const s of sektor) if (s in st.rinci) st.rinci[s]++;
        if (!st.terbaru) st.terbaru = { id: r.id, judul: r.judul, tanggal: r.tanggal };
      }
    }
    return json({ days, kelompok: stats, lintas });
  }

  // ---------- Perkiraan ----------
  if (path === '/api/forecasts' && method === 'GET') {
    const rows = await db
      .prepare(
        'SELECT f.*, e.judul AS event_judul, e.tingkat AS event_tingkat FROM forecasts f JOIN events e ON e.id = f.event_id ORDER BY f.tanggal_cek'
      )
      .all();
    return json({ today: wibDate(), forecasts: rows.results });
  }

  if (path === '/api/forecasts' && method === 'POST') {
    const deny = requireOwner(request, env);
    if (deny) return deny;
    const b = await body(request);
    const teks = String(b.teks || '').trim().slice(0, 300);
    const eventId = Number(b.event_id);
    if (!teks || !eventId) return json({ error: 'Isi teks perkiraan.' }, 400);
    let tanggal = String(b.tanggal_cek || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) tanggal = addDays(wibDate(), Number(b.hari) || 30);
    await db
      .prepare('INSERT INTO forecasts (event_id, teks, tanggal_cek, created_at) VALUES (?, ?, ?, ?)')
      .bind(eventId, teks, tanggal, nowIso())
      .run();
    return json({ ok: true });
  }

  m = path.match(/^\/api\/forecasts\/(\d+)$/);
  if (m && method === 'POST') {
    const deny = requireOwner(request, env);
    if (deny) return deny;
    const b = await body(request);
    if (!['menunggu', 'terjadi', 'tidak'].includes(b.status)) return json({ error: 'Status tidak dikenal.' }, 400);
    await db
      .prepare('UPDATE forecasts SET status = ?, catatan = ? WHERE id = ?')
      .bind(b.status, String(b.catatan || '').slice(0, 300), Number(m[1]))
      .run();
    return json({ ok: true });
  }

  return json({ error: 'Alamat API tidak dikenal.' }, 404);
}

/**
 * Kelompokkan kaitan yang disetujui menjadi rantai (komponen terhubung).
 * Setiap rantai: akar (penyebab paling awal), jalur terpanjang dari akar untuk ringkasan,
 * kelompok sektor yang tersentuh, dan tanggal peristiwa terbaru.
 */
export function buildChains(links, evMap) {
  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  for (const l of links) {
    for (const id of [l.dari_id, l.ke_id]) if (!parent.has(id)) parent.set(id, id);
    const a = find(l.dari_id);
    const b = find(l.ke_id);
    if (a !== b) parent.set(a, b);
  }
  const comps = new Map();
  for (const id of parent.keys()) {
    const r = find(id);
    if (!comps.has(r)) comps.set(r, []);
    comps.get(r).push(id);
  }
  const out = [];
  for (const nodes of comps.values()) {
    const set = new Set(nodes);
    const edges = links.filter((l) => set.has(l.dari_id));
    const hasIn = new Set(edges.map((l) => l.ke_id));
    const byDate = (a, b) => (evMap.get(a)?.tanggal || '').localeCompare(evMap.get(b)?.tanggal || '') || a - b;
    const roots = nodes.filter((n) => !hasIn.has(n)).sort(byDate);
    // Jalur terpanjang dari sebuah akar (DFS dengan penjaga siklus).
    const memo = new Map();
    const longest = (id, seen) => {
      if (memo.has(id)) return memo.get(id);
      let best = [];
      for (const l of edges) {
        if (l.dari_id !== id || seen.has(l.ke_id)) continue;
        seen.add(l.ke_id);
        const tail = longest(l.ke_id, seen);
        seen.delete(l.ke_id);
        if (tail.length + 1 > best.length) best = [{ link: l, ke: l.ke_id }, ...tail];
      }
      memo.set(id, best);
      return best;
    };
    // Akar = penyebab tanpa pendahulu yang jalurnya paling panjang; seri -> yang paling awal.
    let akar = roots[0] ?? [...nodes].sort(byDate)[0];
    let path = longest(akar, new Set([akar]));
    for (const r of roots.slice(1)) {
      const p = longest(r, new Set([r]));
      if (p.length > path.length) {
        akar = r;
        path = p;
      }
    }
    const evs = nodes.map((n) => evMap.get(n)).filter(Boolean);
    if (!evs.length) continue;
    const jalur = [{ event: evMap.get(akar), link: null }].concat(
      path.map((p) => ({ event: evMap.get(p.ke), link: { jenis: p.link.jenis, alasan: p.link.alasan } }))
    );
    out.push({
      akar,
      jalur,
      n_peristiwa: evs.length,
      n_kaitan: edges.length,
      kelompok: KELOMPOK.map((k) => k.id).filter((id) => evs.some((e) => e.kelompok.includes(id))),
      dua_sisi: evs.some((e) => e.dua_sisi),
      terbaru: evs.map((e) => e.tanggal).sort().pop(),
    });
  }
  return out.sort((a, b) => b.terbaru.localeCompare(a.terbaru) || b.n_peristiwa - a.n_peristiwa);
}

/** Telusuri kaitan ke atas (penyebab) atau ke bawah (akibat), per tingkat. */
export function walk(links, startId, depth, dir) {
  const levels = [];
  const visited = new Set([startId]);
  let frontier = [startId];
  for (let d = 0; d < depth && frontier.length; d++) {
    const next = [];
    const level = [];
    for (const id of frontier) {
      for (const l of links) {
        const from = dir === 'up' ? l.ke_id : l.dari_id;
        const to = dir === 'up' ? l.dari_id : l.ke_id;
        if (from !== id || visited.has(to)) continue;
        visited.add(to);
        next.push(to);
        level.push({
          eventId: to,
          via: id,
          link: { id: l.id, jenis: l.jenis, alasan: l.alasan, keyakinan: l.keyakinan, status: l.status, dibuat_oleh: l.dibuat_oleh },
        });
      }
    }
    if (level.length) levels.push(level);
    frontier = next;
  }
  return levels;
}
