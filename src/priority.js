import { KELOMPOK, INDIKATOR_INDONESIA, MAKS_TINJAU, HARI_KOLAM } from './constants.js';
import { kelompokOf, parseList, wibDate, wibDateDaysAgo, wibDayStartIso } from './util.js';
import { computeSignals } from './market.js';

const NAMA = new Map(KELOMPOK.map((k) => [k.id, k.nama]));

/**
 * Skor prioritas satu usulan kaitan (0-3), 1 poin per kriteria:
 * - Dampak ke Indonesia: akibatnya peristiwa lokal, atau menyentuh rupiah/IHSG/BI Rate.
 * - Menyambung rantai lama: salah satu ujungnya sudah punya kaitan yang disetujui.
 * - Sektor sedang bergerak tidak biasa hari ini (harga atau lonjakan berita).
 * p memakai kolom hasil query review (dari_*, ke_* dengan sektor/indikator sudah berupa array).
 */
export function scoreProposal(p, { approvedIds, signals }) {
  const indonesia = p.ke_tingkat === 'lokal' || (p.ke_indikator || []).some((i) => INDIKATOR_INDONESIA.includes(i));
  const lama = approvedIds.has(p.dari_id) || approvedIds.has(p.ke_id);
  const kelompok = [...new Set([...kelompokOf(p.dari_sektor), ...kelompokOf(p.ke_sektor)])];
  const bergerak = signals.filter((s) => s.bergerak && kelompok.includes(s.id));
  const alasan = [];
  if (indonesia) alasan.push('Berdampak ke Indonesia');
  if (lama) alasan.push('Menyambung rantai lama');
  for (const s of bergerak) alasan.push(`${s.nama}: ${s.label}`);
  return {
    skor: Number(indonesia) + Number(lama) + Number(bergerak.length > 0),
    indonesia,
    lama,
    kelompok,
    kelompok_nama: kelompok.map((k) => NAMA.get(k)),
    alasan_prioritas: alasan,
  };
}

/** Urutan: skor, lalu dampak ke Indonesia, lalu keyakinan AI, lalu yang terbaru. */
export function rankProposals(list, ctx) {
  return list
    .map((p) => ({ ...p, ...scoreProposal(p, ctx) }))
    .sort(
      (a, b) =>
        b.skor - a.skor ||
        Number(b.indonesia) - Number(a.indonesia) ||
        (b.keyakinan || 0) - (a.keyakinan || 0) ||
        String(b.created_at).localeCompare(String(a.created_at)) ||
        b.id - a.id
    );
}

/** Jumlah usulan AI yang sudah diputuskan (setujui/tolak) pemilik hari ini (WIB). */
export async function decidedToday(db, today = wibDate()) {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM links WHERE dibuat_oleh = 'ai' AND status IN ('disetujui','ditolak') AND decided_at >= ?")
    .bind(wibDayStartIso(today))
    .first();
  return row?.n || 0;
}

const POOL_SQL = `FROM links l JOIN events d ON d.id = l.dari_id JOIN events k ON k.id = l.ke_id
  WHERE l.status = 'usulan' AND d.status = 'aktif' AND k.status = 'aktif' AND k.tanggal >= ?`;

/** Jumlah usulan yang masih bersaing (belum tergeser). */
export async function poolCount(db) {
  const row = await db.prepare(`SELECT COUNT(*) AS n ${POOL_SQL}`).bind(wibDateDaysAgo(HARI_KOLAM)).first();
  return row?.n || 0;
}

/**
 * Antrean tinjauan malam ini: maksimal MAKS_TINJAU usulan dikurangi yang sudah diputuskan hari ini.
 * Usulan yang belum ditinjau tetap bersaing besok; yang peristiwanya > HARI_KOLAM hari tergeser.
 */
export async function reviewQueue(db, signals = null) {
  const sig = signals || (await computeSignals(db));
  const rows = await db
    .prepare(
      `SELECT l.*, d.judul AS dari_judul, d.tingkat AS dari_tingkat, d.tanggal AS dari_tanggal, d.sektor AS dari_sektor,
              d.indikator AS dari_indikator, d.dua_sisi AS dari_dua_sisi,
              k.judul AS ke_judul, k.tingkat AS ke_tingkat, k.tanggal AS ke_tanggal, k.sektor AS ke_sektor,
              k.indikator AS ke_indikator, k.dua_sisi AS ke_dua_sisi
       ${POOL_SQL}`
    )
    .bind(wibDateDaysAgo(HARI_KOLAM))
    .all();
  const pool = rows.results.map((r) => ({
    ...r,
    dari_sektor: parseList(r.dari_sektor),
    ke_sektor: parseList(r.ke_sektor),
    dari_indikator: parseList(r.dari_indikator),
    ke_indikator: parseList(r.ke_indikator),
  }));
  const approved = await db.prepare("SELECT dari_id, ke_id FROM links WHERE status = 'disetujui'").all();
  const approvedIds = new Set(approved.results.flatMap((r) => [r.dari_id, r.ke_id]));
  const ranked = rankProposals(pool, { approvedIds, signals: sig });
  const sudah = await decidedToday(db);
  const slot = Math.max(0, MAKS_TINJAU - sudah);
  const tampil = ranked.slice(0, slot);
  return { pending: tampil, menunggu: ranked.length - tampil.length, sudah, slot, maks: MAKS_TINJAU, signals: sig };
}
