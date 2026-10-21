import { collectHeadlines } from './sources.js';
import { runJson, clusterPrompt, linkPrompt, CLUSTER_SCHEMA, LINK_SCHEMA } from './ai.js';
import { SEKTOR, INDIKATOR, JENIS } from './constants.js';
import { wibDate, wibDateDaysAgo, nowIso, parseList, matchLabels } from './util.js';

/**
 * Satu kali pembaruan: ambil berita -> AI menyusun peristiwa -> AI mengusulkan kaitan.
 * Kaitan disimpan sebagai "usulan"; pemilik yang memutuskan setujui/tolak.
 */
export async function runPipeline(env, { trigger = 'manual', days = 1 } = {}) {
  const db = env.DB;
  const busy = await db
    .prepare("SELECT id FROM runs WHERE status = 'berjalan' AND started_at > ? LIMIT 1")
    .bind(new Date(Date.now() - 10 * 60000).toISOString())
    .first();
  if (busy) return { ok: false, message: 'Pembaruan lain sedang berjalan. Tunggu beberapa menit.' };

  const run = await db
    .prepare('INSERT INTO runs (started_at, trigger, status) VALUES (?, ?, ?) RETURNING id')
    .bind(nowIso(), trigger, 'berjalan')
    .first();
  const runId = run.id;
  const notes = [];

  try {
    // 1. Ambil berita
    const { headlines, errors } = await collectHeadlines(days);
    notes.push(...errors.map((e) => 'Sumber gagal: ' + e));

    // 2. Simpan berita yang belum pernah dilihat
    const fresh = await filterNew(db, headlines);
    if (fresh.length) {
      await db.batch(
        fresh.map((h) =>
          db
            .prepare(
              'INSERT OR IGNORE INTO articles (url, title, source, origin, published_at, fetched_at, run_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
            )
            .bind(h.url, h.title, h.source, h.origin, h.published_at, nowIso(), runId)
        )
      );
    }
    if (fresh.length < 3) {
      await finish(db, runId, 'selesai', { n_articles: fresh.length }, [...notes, 'Tidak ada berita baru yang cukup.']);
      return { ok: true, runId, articles: fresh.length, events: 0, links: 0 };
    }
    const saved = await idsForUrls(db, fresh.map((h) => h.url));
    const headlines2 = fresh.map((h) => ({ ...h, id: saved.get(h.url) })).filter((h) => h.id);

    // 3. AI menyusun peristiwa
    const cp = clusterPrompt(headlines2);
    const clustered = await runJson(env, cp.system, cp.user, CLUSTER_SCHEMA);
    const events = normalizeEvents(clustered, headlines2);

    const newEvents = [];
    for (const ev of events) {
      const row = await db
        .prepare(
          'INSERT INTO events (run_id, tanggal, judul, ringkasan, tingkat, sektor, indikator, dua_sisi, dampak, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id'
        )
        .bind(
          runId,
          ev.tanggal,
          ev.judul,
          ev.ringkasan,
          ev.tingkat,
          JSON.stringify(ev.sektor),
          JSON.stringify(ev.indikator),
          ev.dua_sisi,
          JSON.stringify(ev.dampak),
          nowIso()
        )
        .first();
      newEvents.push({ ...ev, id: row.id });
    }
    const pairs = newEvents.flatMap((ev) => ev.articleIds.map((aid) => [ev.id, aid]));
    if (pairs.length) {
      await db.batch(
        pairs.flatMap(([eid, aid]) => [
          db.prepare('INSERT OR IGNORE INTO event_articles (event_id, article_id) VALUES (?, ?)').bind(eid, aid),
          db.prepare('UPDATE articles SET used = 1 WHERE id = ?').bind(aid),
        ])
      );
    }

    // 4. AI mengusulkan kaitan ke peristiwa lama dan antar peristiwa baru
    let nLinks = 0;
    if (newEvents.length) {
      const oldRows = await db
        .prepare(
          "SELECT id, tanggal, judul, tingkat, sektor FROM events WHERE status = 'aktif' AND run_id != ? AND tanggal >= ? ORDER BY tanggal DESC, id DESC LIMIT 40"
        )
        .bind(runId, wibDateDaysAgo(30))
        .all();
      const oldEvents = oldRows.results.map((r) => ({ ...r, sektor: parseList(r.sektor) }));
      if (newEvents.length + oldEvents.length >= 2) {
        const lp = linkPrompt(newEvents, oldEvents);
        const linked = await runJson(env, lp.system, lp.user, LINK_SCHEMA);
        const links = normalizeLinks(linked, newEvents, oldEvents);
        const existing = await existingPairs(db, links);
        const toInsert = links.filter((l) => !existing.has(`${l.dari}-${l.ke}`) && !existing.has(`${l.ke}-${l.dari}`));
        if (toInsert.length) {
          await db.batch(
            toInsert.map((l) =>
              db
                .prepare(
                  "INSERT OR IGNORE INTO links (dari_id, ke_id, jenis, alasan, keyakinan, status, dibuat_oleh, run_id, created_at) VALUES (?, ?, ?, ?, ?, 'usulan', 'ai', ?, ?)"
                )
                .bind(l.dari, l.ke, l.jenis, l.alasan, l.keyakinan, runId, nowIso())
            )
          );
        }
        nLinks = toInsert.length;
      }
    }

    await finish(db, runId, 'selesai', { n_articles: fresh.length, n_events: newEvents.length, n_links: nLinks }, notes);
    return { ok: true, runId, articles: fresh.length, events: newEvents.length, links: nLinks };
  } catch (e) {
    await finish(db, runId, 'gagal', {}, [...notes, String(e.message || e)]);
    return { ok: false, runId, message: String(e.message || e) };
  }
}

async function finish(db, runId, status, counts, notes) {
  await db
    .prepare('UPDATE runs SET finished_at = ?, status = ?, n_articles = ?, n_events = ?, n_links = ?, note = ? WHERE id = ?')
    .bind(
      nowIso(),
      status,
      counts.n_articles || 0,
      counts.n_events || 0,
      counts.n_links || 0,
      notes.join('\n').slice(0, 2000),
      runId
    )
    .run();
}

async function filterNew(db, headlines) {
  const known = new Set();
  for (let i = 0; i < headlines.length; i += 90) {
    const chunk = headlines.slice(i, i + 90).map((h) => h.url);
    const rows = await db
      .prepare(`SELECT url FROM articles WHERE url IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .all();
    rows.results.forEach((r) => known.add(r.url));
  }
  return headlines.filter((h) => !known.has(h.url));
}

async function idsForUrls(db, urls) {
  const map = new Map();
  for (let i = 0; i < urls.length; i += 90) {
    const chunk = urls.slice(i, i + 90);
    const rows = await db
      .prepare(`SELECT id, url FROM articles WHERE url IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .all();
    rows.results.forEach((r) => map.set(r.url, r.id));
  }
  return map;
}

async function existingPairs(db, links) {
  const ids = [...new Set(links.flatMap((l) => [l.dari, l.ke]))];
  const set = new Set();
  if (!ids.length) return set;
  const ph = ids.map(() => '?').join(',');
  const rows = await db
    .prepare(`SELECT dari_id, ke_id FROM links WHERE dari_id IN (${ph}) OR ke_id IN (${ph})`)
    .bind(...ids, ...ids)
    .all();
  rows.results.forEach((r) => set.add(`${r.dari_id}-${r.ke_id}`));
  return set;
}

/** Periksa hasil AI: label harus dari daftar resmi, sumber harus nyata. */
export function normalizeEvents(out, headlines) {
  const list = Array.isArray(out?.peristiwa) ? out.peristiwa : [];
  const today = wibDate();
  const events = [];
  for (const p of list.slice(0, 12)) {
    const idx = [...new Set((p.artikel || []).map(Number))].filter((n) => n >= 1 && n <= headlines.length);
    if (!idx.length || !p.judul) continue;
    const arts = idx.map((n) => headlines[n - 1]);
    const dates = arts.map((a) => a.published_at).filter(Boolean).sort();
    const tanggal = dates.length ? wibDate(new Date(dates[0])) : today;
    const origins = new Set(arts.map((a) => a.origin));
    const mostlyLokal = arts.filter((a) => a.origin === 'lokal').length > arts.length / 2;
    const tingkat = p.tingkat === 'global' || p.tingkat === 'lokal' ? p.tingkat : mostlyLokal ? 'lokal' : 'global';
    const sektor = matchLabels(p.sektor, SEKTOR, 3);
    events.push({
      judul: String(p.judul).trim().slice(0, 160),
      ringkasan: String(p.ringkasan || '').trim().slice(0, 600),
      tingkat,
      sektor: sektor.length ? sektor : [],
      indikator: matchLabels(p.indikator, INDIKATOR, 3),
      // "Dua sisi" hanya dipertahankan bila memang ada sumber lokal DAN internasional.
      dua_sisi: origins.size > 1 ? String(p.dua_sisi || '').trim().slice(0, 400) : '',
      dampak: (Array.isArray(p.dampak) ? p.dampak : [])
        .filter((d) => d && d.teks)
        .slice(0, 2)
        .map((d) => ({ teks: String(d.teks).trim().slice(0, 240), hari: Math.max(3, Math.min(120, Number(d.hari) || 30)) })),
      tanggal,
      articleIds: arts.map((a) => a.id),
    });
  }
  return events;
}

export function normalizeLinks(out, newEvents, oldEvents) {
  const list = Array.isArray(out?.kaitan) ? out.kaitan : [];
  const resolve = (code) => {
    const m = /^([BL])(\d+)$/i.exec(String(code || '').trim());
    if (!m) return null;
    const arr = m[1].toUpperCase() === 'B' ? newEvents : oldEvents;
    return arr[Number(m[2]) - 1] || null;
  };
  const seen = new Set();
  const links = [];
  for (const k of list.slice(0, 15)) {
    const a = resolve(k.dari);
    const b = resolve(k.ke);
    if (!a || !b || a.id === b.id) continue;
    const isNewA = newEvents.includes(a);
    const isNewB = newEvents.includes(b);
    if (!isNewA && !isNewB) continue;
    if (a.tanggal > b.tanggal) continue; // penyebab tidak boleh lebih baru dari akibat
    const key = `${a.id}-${b.id}`;
    if (seen.has(key) || seen.has(`${b.id}-${a.id}`)) continue;
    seen.add(key);
    links.push({
      dari: a.id,
      ke: b.id,
      jenis: JENIS.includes(k.jenis) ? k.jenis : 'menyebabkan',
      alasan: String(k.alasan || '').trim().slice(0, 300),
      keyakinan: Math.max(0, Math.min(1, Number(k.keyakinan) || 0.5)),
    });
  }
  return links;
}
