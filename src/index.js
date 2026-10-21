import { runPipeline } from './pipeline.js';
import { SEKTOR, INDIKATOR, JENIS, AI_DAILY_LIMIT } from './constants.js';
import { json, parseList, safeEqual, wibDate, wibDateDaysAgo, addDays, nowIso } from './util.js';

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (e) {
      console.error(e);
      return json({ error: String(e.message || e) }, 500);
    }
  },

  // Pembaruan otomatis harian (lihat [triggers] di wrangler.toml).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runPipeline(env, { trigger: 'jadwal', days: 1 }));
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
  return {
    id: r.id,
    tanggal: r.tanggal,
    judul: r.judul,
    ringkasan: r.ringkasan,
    tingkat: r.tingkat,
    sektor: parseList(r.sektor),
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
    return json({
      owner,
      pinSet: Boolean(env.ADMIN_PIN),
      today: wibDate(),
      lastRun,
      counts: c,
      aiLimit: AI_DAILY_LIMIT,
      sektor: SEKTOR,
      indikator: INDIKATOR,
      jenis: JENIS,
    });
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
    const pending = await db
      .prepare(
        `SELECT l.*, d.judul AS dari_judul, d.tingkat AS dari_tingkat, d.tanggal AS dari_tanggal, d.sektor AS dari_sektor,
                k.judul AS ke_judul, k.tingkat AS ke_tingkat, k.tanggal AS ke_tanggal, k.sektor AS ke_sektor
         FROM links l JOIN events d ON d.id = l.dari_id JOIN events k ON k.id = l.ke_id
         WHERE l.status = 'usulan' AND d.status = 'aktif' AND k.status = 'aktif'
         ORDER BY l.keyakinan DESC LIMIT 60`
      )
      .all();
    const lastRun = await db.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT 1").first();
    const lastOk = await db.prepare("SELECT id FROM runs WHERE n_events > 0 ORDER BY id DESC LIMIT 1").first();
    let fresh = [];
    if (lastOk) {
      const rows = await db
        .prepare(
          `SELECT e.*, (SELECT COUNT(*) FROM event_articles ea WHERE ea.event_id=e.id) AS n_sumber
           FROM events e WHERE e.run_id = ? ORDER BY e.id`
        )
        .bind(lastOk.id)
        .all();
      fresh = rows.results.map(eventOut);
    }
    const runs = await db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 8').all();
    return json({
      pending: pending.results.map((r) => ({ ...r, dari_sektor: parseList(r.dari_sektor), ke_sektor: parseList(r.ke_sektor) })),
      lastRun,
      fresh,
      runs: runs.results,
    });
  }

  if (path === '/api/run' && method === 'POST') {
    const deny = requireOwner(request, env);
    if (deny) return deny;
    const b = await body(request);
    const days = Math.max(1, Math.min(7, Number(b.days) || 1));
    const result = await runPipeline(env, { trigger: 'manual', days });
    return json(result, result.ok ? 200 : 409);
  }

  // ---------- Kaitan ----------
  m = path.match(/^\/api\/links\/(\d+)$/);
  if (m && method === 'POST') {
    const deny = requireOwner(request, env);
    if (deny) return deny;
    const b = await body(request);
    if (!['disetujui', 'ditolak', 'usulan'].includes(b.status)) return json({ error: 'Status tidak dikenal.' }, 400);
    await db.prepare('UPDATE links SET status = ? WHERE id = ?').bind(b.status, Number(m[1])).run();
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

  // ---------- Sektor ----------
  if (path === '/api/sectors' && method === 'GET') {
    const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 30));
    const rows = await db
      .prepare("SELECT id, tanggal, judul, tingkat, sektor FROM events WHERE status='aktif' AND tanggal >= ? ORDER BY tanggal DESC, id DESC")
      .bind(wibDateDaysAgo(days))
      .all();
    const stats = SEKTOR.map((s) => ({ sektor: s, global: 0, lokal: 0, terbaru: null }));
    const byName = new Map(stats.map((s) => [s.sektor, s]));
    for (const r of rows.results) {
      for (const s of parseList(r.sektor)) {
        const st = byName.get(s);
        if (!st) continue;
        st[r.tingkat === 'global' ? 'global' : 'lokal']++;
        if (!st.terbaru) st.terbaru = { id: r.id, judul: r.judul, tanggal: r.tanggal };
      }
    }
    return json({ days, sectors: stats });
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
