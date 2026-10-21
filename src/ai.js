import { MODEL, AI_DAILY_LIMIT, SEKTOR, INDIKATOR, JENIS } from './constants.js';
import { wibDate } from './util.js';

export class QuotaError extends Error {}

/** Panggil Workers AI dan kembalikan objek JSON. */
export async function runJson(env, system, user, schema) {
  await bumpUsage(env);
  const base = {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: 3500,
    temperature: 0.2,
  };
  let res;
  try {
    res = await env.AI.run(MODEL, { ...base, response_format: { type: 'json_schema', json_schema: schema } });
  } catch (e) {
    // Jika mode JSON tidak didukung, ulangi tanpa skema dan urai teksnya.
    res = await env.AI.run(MODEL, base);
  }
  const out = res && typeof res === 'object' && 'response' in res ? res.response : res;
  if (out && typeof out === 'object') return out;
  return extractJson(String(out ?? ''));
}

export function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI tidak mengembalikan JSON');
  const raw = text.slice(start, end + 1);
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(raw.replace(/,\s*([}\]])/g, '$1'));
  }
}

async function bumpUsage(env) {
  const day = wibDate();
  const row = await env.DB.prepare(
    'INSERT INTO ai_usage (day, calls) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET calls = calls + 1 RETURNING calls'
  )
    .bind(day)
    .first();
  if (row && row.calls > AI_DAILY_LIMIT) {
    throw new QuotaError(`Batas ${AI_DAILY_LIMIT} panggilan AI hari ini sudah tercapai. Coba lagi besok.`);
  }
}

// ---------- Tahap 1: susun berita menjadi peristiwa ----------

export const CLUSTER_SCHEMA = {
  type: 'object',
  properties: {
    peristiwa: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          judul: { type: 'string' },
          ringkasan: { type: 'string' },
          tingkat: { type: 'string', enum: ['global', 'lokal'] },
          sektor: { type: 'array', items: { type: 'string' } },
          indikator: { type: 'array', items: { type: 'string' } },
          artikel: { type: 'array', items: { type: 'integer' } },
          dua_sisi: { type: 'string' },
          dampak: {
            type: 'array',
            items: {
              type: 'object',
              properties: { teks: { type: 'string' }, hari: { type: 'integer' } },
              required: ['teks', 'hari'],
            },
          },
        },
        required: ['judul', 'ringkasan', 'tingkat', 'sektor', 'artikel'],
      },
    },
  },
  required: ['peristiwa'],
};

export function clusterPrompt(headlines) {
  const system = `Kamu analis ekonomi dan geopolitik yang membantu seorang investor di Indonesia memahami kaitan peristiwa global dan lokal.
Tugas: dari daftar judul berita bernomor, susun daftar PERISTIWA penting.
Aturan:
- Pilih hanya berita yang berdampak pada ekonomi, pasar keuangan, komoditas, kebijakan, perdagangan, atau geopolitik. Abaikan kriminal biasa, gosip, olahraga, hiburan, profil tokoh, dan tips konsumen.
- Gabungkan beberapa berita yang membahas kejadian yang sama menjadi satu peristiwa.
- Maksimal 12 peristiwa, urutkan dari yang paling berpengaruh.
- "tingkat": "lokal" bila kejadiannya di Indonesia, "global" bila di luar Indonesia.
- "sektor": 1 sampai 3 label, HANYA dari daftar: ${SEKTOR.join('; ')}.
- "indikator": 0 sampai 3 label, HANYA dari daftar: ${INDIKATOR.join('; ')}.
- "artikel": nomor berita yang menjadi sumber peristiwa itu. Wajib diisi.
- "ringkasan": 1 sampai 2 kalimat faktual, hanya berdasarkan judul yang tersedia. Jangan menambah angka atau fakta yang tidak ada di judul.
- "dua_sisi": bila sumber media Indonesia dan internasional menyorot sudut yang berbeda, jelaskan perbedaannya dalam 1 kalimat. Bila tidak ada, isi string kosong.
- "dampak": 0 sampai 2 hipotesis dampak lanjutan yang masuk akal, masing-masing dengan "hari" = perkiraan jangka waktu (7 sampai 90 hari). Tulis sebagai hipotesis, bukan kepastian.
- Seluruh teks dalam Bahasa Indonesia yang jelas.
Jawab hanya dengan JSON sesuai skema.`;
  const lines = headlines.map(
    (h, i) => `${i + 1}. [${h.origin === 'lokal' ? 'ID' : 'INTL'} | ${h.source} | ${(h.published_at || '').slice(0, 10)}] ${h.title}`
  );
  const user = `Daftar berita:\n${lines.join('\n')}`;
  return { system, user };
}

// ---------- Tahap 2: usulkan kaitan sebab-akibat ----------

export const LINK_SCHEMA = {
  type: 'object',
  properties: {
    kaitan: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          dari: { type: 'string' },
          ke: { type: 'string' },
          jenis: { type: 'string', enum: JENIS },
          alasan: { type: 'string' },
          keyakinan: { type: 'number' },
        },
        required: ['dari', 'ke', 'jenis', 'alasan', 'keyakinan'],
      },
    },
  },
  required: ['kaitan'],
};

export function linkPrompt(newEvents, oldEvents) {
  const system = `Kamu analis rantai sebab-akibat ekonomi. Usulkan KAITAN antar peristiwa, dari PENYEBAB ke AKIBAT.
Aturan:
- Setiap kaitan wajib melibatkan minimal satu peristiwa berkode B (baru).
- Usulkan kaitan hanya bila ada mekanisme ekonomi yang masuk akal (misalnya: harga minyak naik -> biaya impor BBM naik -> tekanan inflasi). Jangan mengaitkan hanya karena topiknya mirip.
- Penyebab tidak boleh terjadi setelah akibat.
- "jenis": salah satu dari ${JENIS.join(', ')}.
- "alasan": 1 kalimat yang menjelaskan mekanismenya, dalam Bahasa Indonesia.
- "keyakinan": angka 0 sampai 1, jujur. Kaitan yang lemah beri angka rendah.
- Maksimal 15 kaitan. Lebih baik sedikit tapi kuat.
Jawab hanya dengan JSON sesuai skema, gunakan kode peristiwa (mis. "B1", "L4").`;
  const fmt = (e, code) =>
    `${code} [${e.tanggal} | ${e.tingkat} | ${(e.sektor || []).join(', ')}] ${e.judul}` +
    (e.ringkasan && code.startsWith('B') ? ` — ${e.ringkasan}` : '');
  const user =
    `Peristiwa baru:\n${newEvents.map((e, i) => fmt(e, 'B' + (i + 1))).join('\n')}\n\n` +
    (oldEvents.length
      ? `Peristiwa lama (30 hari terakhir):\n${oldEvents.map((e, i) => fmt(e, 'L' + (i + 1))).join('\n')}`
      : 'Belum ada peristiwa lama.');
  return { system, user };
}
