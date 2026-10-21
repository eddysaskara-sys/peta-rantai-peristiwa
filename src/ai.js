import { MODEL, FALLBACK_MODEL, AI_DAILY_LIMIT, SEKTOR, INDIKATOR, JENIS } from './constants.js';
import { wibDate } from './util.js';

export class QuotaError extends Error {}

/**
 * Panggil Workers AI dan kembalikan objek JSON.
 * Mencoba model utama dulu, lalu model cadangan bila gagal atau jawabannya tidak bisa dibaca.
 * `meta` diisi nama model yang berhasil dan daftar percobaan yang gagal (untuk catatan pembaruan).
 */
export async function runJson(env, system, user, schema, meta = {}) {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  const key = schema.required[0];
  const attempts = [
    { model: MODEL, input: { messages, max_tokens: 8000, reasoning: { effort: 'low' } } },
    { model: MODEL, input: { messages, max_tokens: 8000 } },
    { model: FALLBACK_MODEL, input: { messages, max_tokens: 3500, temperature: 0.2, response_format: { type: 'json_schema', json_schema: schema } } },
    { model: FALLBACK_MODEL, input: { messages, max_tokens: 3500, temperature: 0.2 } },
  ];
  meta.gagal = [];
  for (const a of attempts) {
    await bumpUsage(env);
    try {
      const out = responseOf(await env.AI.run(a.model, a.input));
      const data = out && typeof out === 'object' ? out : extractJson(String(out ?? ''));
      if (!data || !Array.isArray(data[key])) throw new Error(`jawaban tanpa "${key}"`);
      meta.model = a.model;
      return data;
    } catch (e) {
      if (e instanceof QuotaError) throw e;
      meta.gagal.push(`${a.model.split('/').pop()}: ${String(e.message || e).slice(0, 80)}`);
    }
  }
  throw new Error('Semua model AI gagal: ' + meta.gagal.join(' | '));
}

/** Ambil isi jawaban dari berbagai bentuk respons Workers AI. */
export function responseOf(res) {
  if (res == null) return res;
  if (typeof res !== 'object') return res;
  if ('response' in res) return res.response;
  const msg = res.choices?.[0]?.message;
  if (msg) return msg.parsed ?? msg.content;
  if (typeof res.output_text === 'string') return res.output_text;
  if (Array.isArray(res.output)) {
    return res.output
      .filter((o) => o.type === 'message')
      .flatMap((o) => o.content || [])
      .map((c) => c.text || '')
      .join('');
  }
  return res;
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
Tugas: dari daftar judul berita bernomor, susun daftar PERISTIWA yang penting bagi ekonomi dan pasar.
Aturan:
- Pilih hanya berita yang berdampak pada ekonomi makro, pasar keuangan, komoditas, energi, pangan, kebijakan pemerintah atau bank sentral, perdagangan, atau geopolitik yang dapat memengaruhi harga dan pasokan.
- ABAIKAN: kasus kriminal dan korupsi perorangan, gosip, olahraga, hiburan, profil tokoh, tips konsumen, kecelakaan kecil, dan berita perusahaan asing yang tidak berkaitan dengan Indonesia atau komoditas.
- Gabungkan berita yang membahas kejadian yang sama menjadi satu peristiwa dan cantumkan semua nomornya.
- Maksimal 12 peristiwa, boleh lebih sedikit. Lebih baik 6 peristiwa yang relevan daripada 12 yang asal.
- "judul": spesifik dan informatif, maksimal 14 kata, menyebut SIAPA/APA dan angkanya bila ada. Contoh baik: "BI menahan BI Rate di 5,75% dan menaikkan deposit facility". Contoh buruk: "Kebijakan BI", "Kebijakan Pemerintah", "Pengembangan Teknologi".
- Pertahankan tingkat kepastian berita. Bila judul menyebut rumor, dugaan, rencana, atau prediksi, tulis tetap sebagai rumor/dugaan/rencana/prediksi. Jangan mengubahnya menjadi fakta.
- "tingkat": "lokal" bila kejadiannya di Indonesia, "global" bila di luar Indonesia.
- "sektor": 1 sampai 3 label yang LANGSUNG terdampak, HANYA dari daftar: ${SEKTOR.join('; ')}.
- "indikator": label indikator pasar yang LANGSUNG terpengaruh, HANYA dari daftar: ${INDIKATOR.join('; ')}. Kosongkan ([]) bila tidak ada hubungan langsung.
- "artikel": nomor berita sumber. Wajib diisi.
- "ringkasan": 1 sampai 2 kalimat faktual, hanya berdasarkan judul. Jangan menambah angka atau fakta yang tidak ada.
- "dua_sisi": bila media Indonesia (ID) dan internasional (INTL) menyorot sudut berbeda untuk peristiwa yang sama, jelaskan dalam 1 kalimat. Bila tidak ada, string kosong.
- "dampak": 0 sampai 2 hipotesis dampak lanjutan ke Indonesia, masing-masing {"teks": ..., "hari": jangka waktu 7 sampai 90}. Tulis sebagai hipotesis.
- Seluruh teks dalam Bahasa Indonesia.
Jawab HANYA dengan JSON tanpa teks lain, dengan bentuk:
{"peristiwa":[{"judul":"","ringkasan":"","tingkat":"global|lokal","sektor":[],"indikator":[],"artikel":[1,2],"dua_sisi":"","dampak":[{"teks":"","hari":30}]}]}`;
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
- Usulkan kaitan bila ada mekanisme ekonomi yang masuk akal. Jangan mengaitkan hanya karena topiknya mirip.
- Jalur penularan yang umum antara peristiwa global dan Indonesia, sebagai panduan:
  konflik di jalur pelayaran/produsen minyak -> harga minyak -> biaya BBM, subsidi energi, inflasi;
  kebijakan The Fed/dolar AS -> arus modal -> rupiah -> BI Rate -> kredit dan IHSG;
  cuaca ekstrem/gagal panen -> harga pangan global -> impor dan inflasi pangan;
  harga batubara/sawit/nikel -> ekspor dan neraca dagang -> rupiah dan APBN;
  tarif/sanksi dagang -> rantai pasok -> industri dan ekspor;
  kebijakan BI/pemerintah -> likuiditas perbankan, daya beli, sektor terkait.
- Kaitan antara dua peristiwa baru (B ke B) juga boleh.
- Penyebab tidak boleh terjadi setelah akibat.
- "jenis": salah satu dari ${JENIS.join(', ')}.
- "alasan": 1 kalimat yang menjelaskan mekanismenya, dalam Bahasa Indonesia.
- "keyakinan": angka 0 sampai 1, jujur. Kaitan lemah beri angka rendah (0,2 sampai 0,4).
- Maksimal 15 kaitan. Bila memang tidak ada kaitan yang masuk akal, kembalikan daftar kosong.
Jawab HANYA dengan JSON tanpa teks lain, memakai kode peristiwa (mis. "B1", "L4"), dengan bentuk:
{"kaitan":[{"dari":"B1","ke":"B2","jenis":"menyebabkan","alasan":"","keyakinan":0.6}]}`;
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
