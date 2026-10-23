import { collectHeadlines } from './sources.js';
import { collectMarket } from './market.js';
import { runJson, clusterPrompt, linkPrompt, CLUSTER_SCHEMA, LINK_SCHEMA } from './ai.js';
import {
  SEKTOR,
  INDIKATOR,
  JENIS,
  AI_DAILY_LIMIT,
  AI_CADANGAN,
  RIWAYAT_JENDELA,
  RIWAYAT_MAKS_HARI,
  RIWAYAT_PERKIRAAN,
  RIWAYAT_JEDA_MENIT,
  RIWAYAT_ULANG_MENIT,
  RIWAYAT_MAKS_COBA,
  INDIKATOR_INDONESIA,
} from './constants.js';
import { wibDate, wibDateDaysAgo, nowIso, parseList, matchLabels, addDays } from './util.js';
import { checkForecasts, aiCallsToday } from './forecast.js';

/**
 * Satu kali pembaruan: ambil berita -> AI menyusun peristiwa -> AI mengusulkan kaitan.
 * Kaitan disimpan sebagai "usulan"; pemilik yang memutuskan setujui/tolak.
 */
export async function runPipeline(env, { trigger = 'manual', days = 1, runId: queuedId = null, jendela = null } = {}) {
  const db = env.DB;
  const busy = await db
    .prepare("SELECT id FROM runs WHERE status = 'berjalan' AND started_at > ? LIMIT 1")
    .bind(new Date(Date.now() - 10 * 60000).toISOString())
    .first();
  if (busy) return { ok: false, message: 'Pembaruan lain sedang berjalan. Tunggu beberapa menit.' };

  let runId = queuedId;
  if (runId) {
    await db.prepare("UPDATE runs SET status = 'berjalan', started_at = ? WHERE id = ?").bind(nowIso(), runId).run();
  } else {
    const run = await db
      .prepare('INSERT INTO runs (started_at, trigger, status) VALUES (?, ?, ?) RETURNING id')
      .bind(nowIso(), trigger, 'berjalan')
      .first();
    runId = run.id;
  }
  // Catatan pembaruan riwayat selalu diawali penanda jendelanya, untuk melacak jendela yang sudah selesai.
  const notes = jendela ? [penandaJendela(jendela)] : [];

  try {
    // 0. Ambil harga pasar (untuk prioritas sektor). Gagal di sini tidak menghentikan pembaruan.
    if (!jendela) {
      try {
        notes.push(await collectMarket(env));
      } catch (e) {
        notes.push('Harga pasar gagal: ' + String(e.message || e).slice(0, 120));
      }
    }

    // 1. Ambil berita
    const { headlines, errors, stats = [] } = await collectHeadlines(jendela ? { jendela } : { days });
    notes.push('Berita per sumber: ' + stats.join(', '));
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
      // Riwayat yang gagal karena sumber menolak dijadwalkan ulang, bukan dianggap selesai.
      if (jendela && errors.length) return jadwalUlangRiwayat(db, runId, jendela, notes);
      await finish(db, runId, 'selesai', { n_articles: fresh.length }, [...notes, 'Tidak ada berita baru yang cukup.']);
      return { ok: true, runId, articles: fresh.length, events: 0, links: 0 };
    }
    const saved = await idsForUrls(db, fresh.map((h) => h.url));
    const headlines2 = fresh.map((h) => ({ ...h, id: saved.get(h.url) })).filter((h) => h.id);

    // 3. AI menyusun peristiwa
    const cp = clusterPrompt(headlines2, { riwayat: Boolean(jendela) });
    const m1 = {};
    const clustered = await runJson(env, cp.system, cp.user, CLUSTER_SCHEMA, m1);
    const events = normalizeEvents(clustered, headlines2, jendela);
    notes.push(`AI peristiwa (${m1.model}): ${clustered.peristiwa.length} diusulkan, ${events.length} lolos pemeriksaan`);
    if (m1.gagal.length) notes.push('Percobaan AI gagal: ' + m1.gagal.join(' | '));

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

    // 3b. Riwayat: catat beberapa hipotesis dampak AI sebagai contoh perkiraan, untuk dicek semi-otomatis.
    if (jendela && newEvents.length) {
      const contoh = pilihContohPerkiraan(newEvents);
      if (contoh.length) {
        await db.batch(
          contoh.map((c) =>
            db
              .prepare("INSERT INTO forecasts (event_id, teks, tanggal_cek, created_at, asal) VALUES (?, ?, ?, ?, 'riwayat')")
              .bind(c.event_id, c.teks, c.tanggal_cek, nowIso())
          )
        );
        notes.push(`Contoh perkiraan dari riwayat: ${contoh.length}`);
      }
    }

    // 4. AI mengusulkan kaitan ke peristiwa lama dan antar peristiwa baru
    let nLinks = 0;
    if (newEvents.length) {
      const oldEvents = (await peristiwaPembanding(db, runId, jendela)).map((r) => ({ ...r, sektor: parseList(r.sektor) }));
      if (newEvents.length + oldEvents.length >= 2) {
        const lp = linkPrompt(newEvents, oldEvents);
        const m2 = {};
        const linked = await runJson(env, lp.system, lp.user, LINK_SCHEMA, m2);
        const links = normalizeLinks(linked, newEvents, oldEvents);
        notes.push(`AI kaitan (${m2.model}): ${linked.kaitan.length} diusulkan, ${links.length} lolos pemeriksaan`);
        if (m2.gagal.length) notes.push('Percobaan AI gagal: ' + m2.gagal.join(' | '));
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

/**
 * Pemilik meminta pembaruan: dicatat sebagai antrean lalu diproses oleh jadwal
 * berikutnya (tiap 5 menit). Dengan begitu permintaan dari browser selesai cepat
 * dan tidak terputus oleh batas waktu proxy.
 */
export async function enqueueRun(env, days) {
  const db = env.DB;
  const pending = await db
    .prepare("SELECT id FROM runs WHERE status IN ('antre','berjalan') AND trigger IN ('manual','jadwal') ORDER BY id DESC LIMIT 1")
    .first();
  if (pending) return { ok: true, runId: pending.id, already: true };
  const row = await db
    .prepare("INSERT INTO runs (started_at, trigger, status, note) VALUES (?, 'manual', 'antre', ?) RETURNING id")
    .bind(nowIso(), `days=${days}`)
    .first();
  return { ok: true, runId: row.id, already: false };
}

/** Pemeriksaan sumber berita tanpa AI: berapa judul yang didapat dari setiap sumber. */
export async function enqueueCekSumber(env) {
  const db = env.DB;
  const pending = await db.prepare("SELECT id FROM runs WHERE status IN ('antre','berjalan') AND trigger = 'cek-sumber' LIMIT 1").first();
  if (pending) return { ok: true, runId: pending.id, already: true };
  const row = await db
    .prepare("INSERT INTO runs (started_at, trigger, status) VALUES (?, 'cek-sumber', 'antre') RETURNING id")
    .bind(nowIso())
    .first();
  return { ok: true, runId: row.id, already: false };
}

/** Kembalikan jendela riwayat ke antrean, paling cepat RIWAYAT_ULANG_MENIT lagi (maks. RIWAYAT_MAKS_COBA kali). */
async function jadwalUlangRiwayat(db, runId, jendela, notes) {
  const row = await db.prepare('SELECT note FROM runs WHERE id = ?').bind(runId).first();
  const coba = (Number(/percobaan=(\d+)/.exec(row?.note || '')?.[1]) || 0) + 1;
  if (coba >= RIWAYAT_MAKS_COBA) {
    await finish(db, runId, 'gagal', {}, [...notes, `Sumber menolak ${coba} kali; tekan "Isi riwayat" lagi nanti.`]);
    return { ok: false, runId, message: 'riwayat gagal setelah beberapa kali dicoba' };
  }
  const nanti = new Date(Date.now() + RIWAYAT_ULANG_MENIT * 60000).toISOString();
  await db.batch([
    db
      .prepare("UPDATE runs SET status = 'antre', started_at = ?, note = ? WHERE id = ?")
      .bind(nanti, `${penandaJendela(jendela)} percobaan=${coba}\n${notes.slice(1).join('\n')}`.slice(0, 2000), runId),
    // Jeda bersama: giliran riwayat lain juga menunggu, supaya tidak memperpanjang pembatasan.
    db.prepare("UPDATE runs SET started_at = ? WHERE trigger = 'riwayat' AND status = 'antre' AND started_at < ?").bind(nanti, nanti),
  ]);
  return { ok: false, runId, ulang: nanti, percobaan: coba };
}

export function penandaJendela(j) {
  return `riwayat=${j.mulai}..${j.sampai}`;
}

export function parseJendela(note) {
  const m = /riwayat=(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/.exec(note || '');
  return m ? { mulai: m[1], sampai: m[2] } : null;
}

/** Bagi rentang tanggal menjadi jendela beberapa hari. */
export function bagiJendela(mulai, sampai, panjang = RIWAYAT_JENDELA) {
  const out = [];
  for (let a = mulai; a <= sampai; a = addDays(a, panjang)) {
    const b = addDays(a, panjang - 1);
    out.push({ mulai: a, sampai: b < sampai ? b : sampai });
  }
  return out;
}

/**
 * Isi riwayat: antrekan pembaruan riwayat per jendela RIWAYAT_JENDELA hari, dari `mulai` sampai
 * sehari sebelum peristiwa pertama dari pembaruan biasa (agar tidak menumpuk dengan data yang ada).
 * Jendela yang sudah selesai atau masih antre dilewati.
 */
export async function enqueueRiwayat(env, mulai) {
  const db = env.DB;
  const today = wibDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mulai || '')) return { ok: false, message: 'Tanggal mulai tidak valid.' };
  const paling = addDays(today, -RIWAYAT_MAKS_HARI);
  if (mulai < paling) mulai = paling;
  const pertama = await db
    .prepare(
      "SELECT MIN(e.tanggal) AS t FROM events e JOIN runs r ON r.id = e.run_id WHERE r.trigger IN ('jadwal','manual')"
    )
    .first();
  let sampai = addDays(today, -1);
  if (pertama?.t && addDays(pertama.t, -1) < sampai) sampai = addDays(pertama.t, -1);
  if (mulai > sampai) return { ok: false, message: `Riwayat sampai ${sampai} sudah tercakup oleh pembaruan biasa.` };
  const ada = await db.prepare("SELECT note, status FROM runs WHERE trigger = 'riwayat' AND status IN ('antre','berjalan','selesai')").all();
  const sudah = new Set(ada.results.map((r) => parseJendela(r.note)).filter(Boolean).map(penandaJendela));
  const baru = bagiJendela(mulai, sampai).filter((j) => !sudah.has(penandaJendela(j)));
  if (baru.length) {
    await db.batch(
      baru.map((j) =>
        db.prepare("INSERT INTO runs (started_at, trigger, status, note) VALUES (?, 'riwayat', 'antre', ?)").bind(nowIso(), penandaJendela(j))
      )
    );
  }
  return { ok: true, mulai, sampai, jendela: baru.length, dilewati: bagiJendela(mulai, sampai).length - baru.length };
}

/** Kemajuan isi riwayat untuk ditampilkan. */
export async function statusRiwayat(db) {
  const rows = (await db.prepare("SELECT id, status, note, n_events, n_links FROM runs WHERE trigger = 'riwayat' ORDER BY id").all()).results;
  if (!rows.length) return null;
  const j = rows.map((r) => ({ ...parseJendela(r.note), status: r.status, n_events: r.n_events, n_links: r.n_links }));
  const by = (st) => j.filter((x) => x.status === st).length;
  return {
    total: j.length,
    antre: by('antre'),
    berjalan: by('berjalan'),
    selesai: by('selesai'),
    gagal: by('gagal'),
    mulai: j.map((x) => x.mulai).filter(Boolean).sort()[0] || null,
    sampai: j.map((x) => x.sampai).filter(Boolean).sort().pop() || null,
    peristiwa: j.reduce((a, x) => a + (x.n_events || 0), 0),
    kaitan: j.reduce((a, x) => a + (x.n_links || 0), 0),
  };
}

/**
 * Dipanggil jadwal tiap 5 menit: bereskan yang macet, jalankan satu antrean bila ada
 * (pembaruan manual dan cek sumber didahulukan, riwayat menyusul selama kuota AI cukup),
 * dan bila tidak ada antrean, jalankan satu giliran pengecekan perkiraan.
 */
export async function processQueue(env) {
  const db = env.DB;
  await db
    .prepare("UPDATE runs SET status = 'gagal', finished_at = ?, note = COALESCE(note,'') || '\nTerhenti (melewati 15 menit).' WHERE status = 'berjalan' AND started_at < ?")
    .bind(nowIso(), new Date(Date.now() - 15 * 60000).toISOString())
    .run();
  const busy = await db.prepare("SELECT id FROM runs WHERE status = 'berjalan' LIMIT 1").first();
  if (!busy) {
    // started_at pada antrean = paling cepat boleh dijalankan (dipakai untuk menjadwal ulang riwayat).
    const q = await db
      .prepare(
        "SELECT id, trigger, note FROM runs WHERE status = 'antre' AND started_at <= ? ORDER BY CASE trigger WHEN 'riwayat' THEN 1 ELSE 0 END, id LIMIT 1"
      )
      .bind(nowIso())
      .first();
    if (q && q.trigger === 'cek-sumber') return runCekSumber(env, q.id);
    if (q && q.trigger === 'riwayat') {
      const terakhir = await db
        .prepare("SELECT finished_at FROM runs WHERE trigger = 'riwayat' AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1")
        .first();
      const jedaCukup = !terakhir || Date.parse(terakhir.finished_at) <= Date.now() - RIWAYAT_JEDA_MENIT * 60000;
      if (jedaCukup && (await aiCallsToday(db)) <= AI_DAILY_LIMIT - AI_CADANGAN) {
        return runPipeline(env, { trigger: 'riwayat', runId: q.id, jendela: parseJendela(q.note) });
      }
      // Menunggu jeda antar giliran, atau kuota AI hari ini disisakan untuk pembaruan harian.
    } else if (q) {
      const days = Number(/days=(\d+)/.exec(q.note || '')?.[1]) || 1;
      return runPipeline(env, { trigger: 'manual', days, runId: q.id });
    }
  }
  const riwayatJalan = await db.prepare("SELECT id FROM runs WHERE trigger = 'riwayat' AND status IN ('antre','berjalan') LIMIT 1").first();
  return checkForecasts(env, { riwayatSelesai: !riwayatJalan });
}

/** Cek sumber: ambil semua sumber berita dan harga, catat jumlahnya, tanpa AI dan tanpa menyimpan berita. */
export async function runCekSumber(env, runId) {
  const db = env.DB;
  await db.prepare("UPDATE runs SET status = 'berjalan', started_at = ? WHERE id = ?").bind(nowIso(), runId).run();
  const notes = [];
  try {
    try {
      notes.push(await collectMarket(env));
    } catch (e) {
      notes.push('Harga pasar gagal: ' + String(e.message || e).slice(0, 120));
    }
    const { headlines, errors, stats, total } = await collectHeadlines({ days: 1 });
    notes.push(`Cek sumber (tanpa AI): ${total} judul terkumpul, ${headlines.length} terpilih untuk AI.`);
    notes.push('Berita per sumber: ' + stats.join(', '));
    notes.push(...errors.map((e) => 'Sumber gagal: ' + e));
    await finish(db, runId, 'selesai', { n_articles: total }, notes);
    return { ok: true, runId, total, gagal: errors.length };
  } catch (e) {
    await finish(db, runId, 'gagal', {}, [...notes, String(e.message || e)]);
    return { ok: false, runId, message: String(e.message || e) };
  }
}

/**
 * Peristiwa lama yang ditawarkan ke AI untuk dikaitkan.
 * - Pembaruan biasa: 40 peristiwa terbaru dalam 30 hari.
 * - Riwayat: 25 peristiwa sebelum jendela (rantai yang lebih awal) dan 15 sesudahnya
 *   (agar riwayat bisa tersambung ke rantai yang sudah ada sekarang).
 */
async function peristiwaPembanding(db, runId, jendela) {
  const cols = 'SELECT id, tanggal, judul, tingkat, sektor FROM events';
  if (!jendela) {
    return (
      await db
        .prepare(`${cols} WHERE status = 'aktif' AND run_id != ? AND tanggal >= ? ORDER BY tanggal DESC, id DESC LIMIT 40`)
        .bind(runId, wibDateDaysAgo(30))
        .all()
    ).results;
  }
  const sebelum = await db
    .prepare(`${cols} WHERE status = 'aktif' AND run_id != ? AND tanggal < ? AND tanggal >= ? ORDER BY tanggal DESC, id DESC LIMIT 25`)
    .bind(runId, jendela.mulai, addDays(jendela.mulai, -30))
    .all();
  const sesudah = await db
    .prepare(
      `SELECT e.id, e.tanggal, e.judul, e.tingkat, e.sektor FROM events e
       WHERE e.status = 'aktif' AND e.run_id != ? AND e.tanggal > ?
       ORDER BY (SELECT COUNT(*) FROM links l WHERE l.status = 'disetujui' AND (l.dari_id = e.id OR l.ke_id = e.id)) DESC, e.tanggal, e.id
       LIMIT 15`
    )
    .bind(runId, jendela.sampai)
    .all();
  return [...sebelum.results.reverse(), ...sesudah.results];
}

/**
 * Contoh perkiraan dari riwayat: hipotesis dampak AI dari peristiwa riwayat, diutamakan yang
 * jangka waktunya pendek (sudah bisa dicek sekarang) dan peristiwanya berdampak ke Indonesia.
 */
export function pilihContohPerkiraan(events, maks = RIWAYAT_PERKIRAAN) {
  const kandidat = events.flatMap((ev) =>
    (ev.dampak || []).map((d) => ({
      event_id: ev.id,
      teks: d.teks,
      hari: d.hari,
      tanggal_cek: addDays(ev.tanggal, d.hari),
      bobot: (ev.tingkat === 'lokal' || (ev.indikator || []).some((i) => INDIKATOR_INDONESIA.includes(i)) ? 0 : 1) + (ev.articleIds?.length > 1 ? 0 : 0.5),
    }))
  );
  const dipakai = new Set();
  return kandidat
    .sort((a, b) => a.hari - b.hari || a.bobot - b.bobot)
    .filter((c) => (dipakai.has(c.event_id) ? false : (dipakai.add(c.event_id), true)))
    .slice(0, maks)
    .map(({ event_id, teks, tanggal_cek }) => ({ event_id, teks, tanggal_cek }));
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
      .prepare(`SELECT url FROM articles WHERE used = 1 AND url IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .all();
    rows.results.forEach((r) => known.add(r.url));
  }
  // Berita yang pernah diambil tetapi belum masuk peristiwa mana pun boleh ditawarkan lagi ke AI.
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
export function normalizeEvents(out, headlines, jendela = null) {
  const list = Array.isArray(out?.peristiwa) ? out.peristiwa : [];
  const today = wibDate();
  const events = [];
  for (const p of list.slice(0, 12)) {
    const idx = [...new Set((p.artikel || []).map(Number))].filter((n) => n >= 1 && n <= headlines.length);
    if (!idx.length || !p.judul) continue;
    const arts = idx.map((n) => headlines[n - 1]);
    const dates = arts.map((a) => a.published_at).filter(Boolean).sort();
    let tanggal = dates.length ? wibDate(new Date(dates[0])) : today;
    if (jendela) {
      if (tanggal < jendela.mulai) tanggal = jendela.mulai;
      if (tanggal > jendela.sampai) tanggal = jendela.sampai;
    }
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
