import { MODEL, FALLBACK_MODEL, AI_DAILY_LIMIT, SEKTOR, INDIKATOR, JENIS, LINTAS_SEKTOR } from './constants.js';
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

export function clusterPrompt(headlines, { riwayat = false } = {}) {
  const system = `Kamu analis ekonomi dan geopolitik yang membantu seorang investor di Indonesia memahami kaitan peristiwa global dan lokal.
Tugas: dari daftar judul berita bernomor, susun daftar PERISTIWA yang penting bagi ekonomi dan pasar.
Aturan:
- Pilih hanya berita yang berdampak pada ekonomi makro, pasar keuangan, komoditas, energi, pangan, kebijakan pemerintah atau bank sentral, perdagangan, atau geopolitik yang dapat memengaruhi harga dan pasokan.
- ABAIKAN: kasus kriminal dan korupsi perorangan, gosip, olahraga, hiburan, profil tokoh, tips konsumen, kecelakaan kecil, dan berita perusahaan asing yang tidak berkaitan dengan Indonesia atau komoditas.
- Gabungkan berita yang membahas kejadian yang sama menjadi satu peristiwa dan cantumkan semua nomornya. Berita media Indonesia (ID) dan internasional (INTL) tentang kejadian yang sama WAJIB digabung, walaupun bahasanya berbeda.
- Maksimal 12 peristiwa, boleh lebih sedikit. Lebih baik 6 peristiwa yang relevan daripada 12 yang asal.
- "judul": spesifik dan informatif, maksimal 14 kata, menyebut SIAPA/APA dan angkanya bila ada. Contoh baik: "BI menahan BI Rate di 5,75% dan menaikkan deposit facility". Contoh buruk: "Kebijakan BI", "Kebijakan Pemerintah", "Pengembangan Teknologi".
- Pertahankan tingkat kepastian berita. Bila judul menyebut rumor, dugaan, rencana, atau prediksi, tulis tetap sebagai rumor/dugaan/rencana/prediksi. Jangan mengubahnya menjadi fakta.
- "tingkat": "lokal" bila kejadiannya di Indonesia, "global" bila di luar Indonesia.
- "sektor": 1 sampai 3 label yang LANGSUNG terdampak, HANYA dari daftar: ${SEKTOR.join('; ')}. ${LINTAS_SEKTOR.join(' dan ')} hanya boleh dipakai bersama minimal satu sektor ekonomi lain yang terdampak.
- "indikator": label indikator pasar yang LANGSUNG terpengaruh, HANYA dari daftar: ${INDIKATOR.join('; ')}. Kosongkan ([]) bila tidak ada hubungan langsung.
- "artikel": nomor berita sumber. Wajib diisi.
- "ringkasan": 1 sampai 2 kalimat faktual, hanya berdasarkan judul. Jangan menambah angka atau fakta yang tidak ada.
- "dua_sisi": bila media Indonesia (ID) dan internasional (INTL) menyorot sudut berbeda untuk peristiwa yang sama, jelaskan dalam 1 kalimat: apa yang disorot media Indonesia dan apa yang disorot media internasional. Bila sudutnya sama atau hanya ada satu jenis media, string kosong.
- "dampak": 0 sampai 2 hipotesis dampak lanjutan ke Indonesia, masing-masing {"teks": ..., "hari": jangka waktu 7 sampai 90}. Tulis sebagai hipotesis yang SPESIFIK dan BISA DICEK dari berita atau data: sebut apa yang berubah, arahnya (naik/turun/melemah/menguat), dan bila wajar besarannya. Contoh baik: "Harga BBM nonsubsidi naik dalam 14 hari", "Rupiah melemah melewati Rp18.000 per dolar dalam 21 hari". Contoh buruk: "Dapat memengaruhi daya beli", "Investor mungkin berhati-hati".${riwayat ? '\n- Peristiwa ini sudah lampau. Pilih jangka waktu "hari" 7 sampai 21 agar hasilnya sudah bisa dicek sekarang.' : ''}
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
      ? `Peristiwa lain yang sudah tercatat (perhatikan tanggalnya):\n${oldEvents.map((e, i) => fmt(e, 'L' + (i + 1))).join('\n')}`
      : 'Belum ada peristiwa lama.');
  return { system, user };
}

// ---------- Tahap 3: saran pengecekan perkiraan ----------

export const CEK_SCHEMA = {
  type: 'object',
  properties: {
    cek: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          putusan: { type: 'string', enum: ['terjadi', 'tidak', 'belum'] },
          keyakinan: { type: 'number' },
          alasan: { type: 'string' },
          bukti: { type: 'array', items: { type: 'integer' } },
        },
        required: ['id', 'putusan', 'keyakinan', 'alasan', 'bukti'],
      },
    },
  },
  required: ['cek'],
};

export function checkPrompt(batch, today) {
  const system = `Kamu pemeriksa perkiraan ekonomi yang teliti dan berhati-hati. Untuk setiap perkiraan, nilai apakah bukti (judul berita dan data harga) menunjukkan perkiraan itu SUDAH TERJADI setelah tanggal dasarnya.
Aturan:
- "terjadi": hanya bila ada judul berita atau data harga yang JELAS menunjukkan hasil yang diperkirakan sudah terjadi: arahnya sama, dan besarannya kira-kira sesuai bila perkiraan menyebut angka.
- "tidak": hanya bila tanggal cek SUDAH LEWAT dan bukti menunjukkan kebalikannya atau jelas tidak terjadi.
- "belum": bila bukti belum cukup, hanya tidak langsung, atau tanggal cek belum lewat dan hasilnya belum terlihat. Jika ragu, pilih "belum".
- Perkiraan bersyarat ("jika ..."): periksa juga syaratnya. Bila syarat tidak terpenuhi, pilih "belum" kecuali tanggal cek sudah lewat.
- Rencana, wacana, atau prediksi pihak lain BUKAN bukti bahwa sesuatu sudah terjadi.
- Jangan menambah fakta di luar bukti yang diberikan.
- "bukti": nomor judul berita yang menjadi dasar putusanmu (kosong bila tidak ada).
- "alasan": 1 sampai 2 kalimat dalam Bahasa Indonesia, sebut bukti terkuat dan tanggalnya.
- "keyakinan": angka 0 sampai 1, jujur.
Jawab HANYA dengan JSON tanpa teks lain, satu entri per perkiraan, dengan bentuk:
{"cek":[{"id":"P12","putusan":"terjadi|tidak|belum","keyakinan":0.6,"alasan":"","bukti":[1,3]}]}`;
  const blocks = batch.map((f) => {
    const b = f.bukti;
    const berita = b.berita.length
      ? b.berita.map((a, i) => `${i + 1}. [${a.tanggal} | ${a.sumber}] ${a.judul}`).join('\n')
      : '(tidak ada berita yang cocok)';
    const harga = b.harga.length ? b.harga.map((h) => `- ${h}`).join('\n') : '(tidak ada data harga terkait)';
    return `Perkiraan P${f.id} (dasar: peristiwa ${b.dasar} "${f.event_judul}"; tanggal cek ${f.tanggal_cek}${f.tanggal_cek <= today ? ', SUDAH LEWAT' : ', belum lewat'}):
"${f.teks}"
Data harga sejak tanggal dasar:
${harga}
Berita sesudah tanggal dasar:
${berita}`;
  });
  return { system, user: `Hari ini: ${today}\n\n${blocks.join('\n\n---\n\n')}` };
}
