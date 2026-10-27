'use strict';
// Pandangan Video (fitur percobaan, branch fitur/pandangan-video).
// Dimuat sebelum app.js. app.js hanya memanggil fungsi di sini bila ada (typeof ... === 'function'),
// jadi menghapus file ini (dan video.css) tidak merusak aplikasi.
// Memakai fungsi bantu dari app.js saat dipanggil: state, api, esc, safeUrl, tgl, waktu, toast, go, openEvent.

const videoState = { aktif: false, catatan: new Map(), at: 0, tabDipasang: false, filter: 'semua' };

const VJENIS = {
  dukung: { label: 'Mendukung kaitan', ikon: '▶', kelas: 'dukung' },
  bantah: { label: 'Membantah kaitan', ikon: '▶', kelas: 'bantah' },
  perkiraan: { label: 'Perkiraan pembicara', ikon: '🔮', kelas: 'perkiraan' },
  kaitan_baru: { label: 'Ide kaitan baru (belum masuk rantai)', ikon: '💡', kelas: 'ide' },
  pandangan: { label: 'Pandangan lain', ikon: '💬', kelas: 'pandangan' },
};
const VSTATUS = {
  baru: 'Menunggu diringkas',
  selesai: 'Sudah diringkas',
  tidak_relevan: 'Tidak membahas makro',
  dilewati: 'Dilewati',
  gagal: 'Gagal',
};

function vMenit(d) {
  if (d == null) return '';
  const j = Math.floor(d / 3600);
  const m = Math.floor((d % 3600) / 60);
  const s = String(d % 60).padStart(2, '0');
  return j ? `${j}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
function vLinkMenit(url, detik, label) {
  return `<a class="vmenit" href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${label || (detik != null ? `menit ${vMenit(detik)}` : 'buka video')} ↗</a>`;
}

// ---------- Dipanggil dari app.js ----------

/** Muat catatan ▶ untuk kaitan (disimpan 60 detik). */
async function videoLoadNotes(force) {
  if (!force && Date.now() - videoState.at < 60000) return;
  try {
    const d = await api('/api/video/catatan');
    videoState.aktif = Boolean(d.aktif);
    videoState.catatan = new Map();
    (d.catatan || []).forEach((c) => {
      if (!videoState.catatan.has(c.link_id)) videoState.catatan.set(c.link_id, []);
      videoState.catatan.get(c.link_id).push(c);
    });
    videoState.at = Date.now();
  } catch (e) {
    videoState.catatan = new Map(); // fitur belum ada di server: diam saja
  }
}

/** Catatan ▶ di bawah satu kaitan (layar rantai dan panel detail). */
function videoNotesHtml(linkId) {
  const list = videoState.catatan.get(linkId) || [];
  if (!list.length) return '';
  const item = (c) => `<li class="vnote ${c.jenis}">
      <span class="vnote-head">▶ ${c.jenis === 'dukung' ? 'Didukung' : 'Dibantah'}: <b>${esc(c.video.channel || 'video')}</b> · ${tgl(c.video.tanggal)} · ${vLinkMenit(c.url, c.detik)}</span>
      <span class="vnote-teks">${esc(c.teks)}</span></li>`;
  const ringkas = list.length === 1 ? '1 pandangan video' : `${list.length} pandangan video`;
  return `<details class="vnotes"><summary>▶ ${ringkas} <span class="muted">(ringkasan AI, bukan fakta)</span></summary><ul>${list.map(item).join('')}</ul></details>`;
}

/** Chip di kartu rantai utama bila ada pandangan video pada kaitannya. */
function videoChainChip(c) {
  const n = (c.jalur || []).reduce((a, s) => a + (s.link && s.link.id ? (videoState.catatan.get(s.link.id) || []).length : 0), 0);
  return n ? `<span class="chip vid" title="Ada pandangan dari video YouTube pada kaitan di rantai ini">▶ ${n} pandangan video</span>` : '';
}

/** Sumber video pada perkiraan di tab Perkiraan. */
function videoSumberFcHtml(f) {
  if (f.asal !== 'video') return '';
  if (!f.video) return '<p class="muted small" style="margin-top:4px">▶ Dari pandangan video</p>';
  return `<p class="muted small" style="margin-top:4px">▶ Dari video <b>${esc(f.video.channel || '')}</b> · ${esc(f.video.judul)} (${tgl(f.video.tanggal)}) · ${vLinkMenit(f.video.url, null, 'tonton bagian ini')}</p>`;
}

/** Pasang tab Video setelah status dimuat (pengunjung hanya melihatnya bila fitur aktif). */
async function videoAfterStatus() {
  await videoLoadNotes(true);
  let tab = document.querySelector('.tab[data-tab="video"]');
  if (!tab) {
    tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tab';
    tab.dataset.tab = 'video';
    tab.textContent = 'Video';
    const panduan = document.querySelector('.tab[data-tab="panduan"]');
    panduan.parentNode.insertBefore(tab, panduan);
    tab.addEventListener('click', () => go('video'));
  }
  tab.hidden = !(videoState.aktif || state.owner);
}

function videoPanduanHtml(mode) {
  if (!videoState.aktif && mode !== 'pemilik') return '';
  if (mode === 'pemilik') {
    return `<div class="guide-card">
      <h3>Pandangan video (percobaan)</h3>
      <ul class="steps">
        <li>Aplikasi memeriksa channel YouTube pantauan tiap ±3 jam. Video baru (maks. 14 hari) diringkas Gemini, paling banyak 4 video per hari dan hanya 30 menit pertamanya.</li>
        <li>Pandangan yang <b>mendukung</b> atau <b>membantah</b> kaitan yang sudah disetujui tampil sebagai catatan ▶ di Rantai. Rantainya sendiri tidak berubah.</li>
        <li><b>Perkiraan</b> dari video tidak dicatat otomatis. Buka tab Video, lalu klik <b>Catat ke Perkiraan</b> bila layak; tanggal ceknya dihitung dari tanggal video.</li>
        <li><b>Ide kaitan baru</b> dan pandangan lain hanya tampil di tab Video; tidak masuk antrean Tinjau.</li>
        <li>Rekomendasi beli/jual saham tertentu tidak dicatat. Klaim yang salah tangkap bisa dihapus; cek dulu lewat tautan menitnya.</li>
        <li>Butuh secret <b>GEMINI_API_KEY</b> di Cloudflare (gratis dari Google AI Studio). Tanpa itu fitur ini diam.</li>
      </ul>
    </div>`;
  }
  return `<div class="guide-card">
      <h3>▶ Pandangan video</h3>
      <ul class="steps">
        <li>Beberapa kaitan di Rantai punya catatan ▶: ringkasan AI dari video YouTube analis yang membahas kaitan itu, dengan tautan ke menit videonya.</li>
        <li>Ini <b>opini</b>, bukan peristiwa dan bukan saran beli/jual. Tonton bagian videonya untuk memastikan maksud pembicara.</li>
        <li>Daftar lengkapnya ada di menu <button type="button" class="linklike plainbtn" data-goto="video">Video</button>.</li>
      </ul>
    </div>`;
}

// ---------- Tab Video ----------

function vKlaimHtml(k, v) {
  const owner = state.owner;
  const evBtn = (e) => (e ? `<button type="button" class="linklike plainbtn" data-vopen="${e.id}">${esc(e.judul)}</button>` : '');
  let konteks = '';
  if (k.link && k.link.dari && k.link.ke) konteks = `<p class="small vkonteks">${evBtn(k.link.dari)} <span class="muted">→ ${esc(k.link.jenis || '')} →</span> ${evBtn(k.link.ke)}</p>`;
  else if (k.dari && k.ke) konteks = `<p class="small vkonteks">${evBtn(k.dari)} <span class="muted">→</span> ${evBtn(k.ke)}</p>`;
  else if (k.event) konteks = `<p class="small vkonteks muted">Terkait: ${evBtn(k.event)}</p>`;
  let aksi = '';
  if (k.jenis === 'perkiraan') {
    const cek = k.tanggal_cek ? `dicek ${tgl(k.tanggal_cek)}` : '';
    if (k.forecast) aksi = `<span class="muted small">Sudah tercatat di Perkiraan (${esc({ menunggu: 'menunggu dicek', terjadi: 'terjadi', tidak: 'tidak terjadi' }[k.forecast.status] || k.forecast.status)})</span>`;
    else if (owner && k.event) aksi = `<button type="button" class="btn ghost small-btn" data-vcatat="${k.id}">Catat ke Perkiraan</button>`;
    else if (owner) aksi = '<span class="muted small">Belum terhubung ke peristiwa, jadi belum bisa dicatat.</span>';
    if (cek) aksi = `<span class="muted small">${cek}</span> ${aksi}`;
  }
  const hapus = owner ? `<button type="button" class="linklike plainbtn danger small" data-vhapus="${k.id}" title="Hapus bila AI salah menangkap maksud pembicara">Hapus</button>` : '';
  return `<li class="vklaim ${VJENIS[k.jenis]?.kelas || ''}">
      <p>${esc(k.teks)} <span class="small">${vLinkMenit(k.url, k.detik)}</span></p>
      ${konteks}
      ${aksi || hapus ? `<div class="vaksi">${aksi}${hapus}</div>` : ''}
    </li>`;
}

function vKartuHtml(v) {
  const owner = state.owner;
  const grup = Object.keys(VJENIS)
    .map((j) => ({ j, list: v.klaim.filter((k) => k.jenis === j) }))
    .filter((g) => g.list.length)
    .map((g) => `<div class="vgrup"><h4>${VJENIS[g.j].ikon} ${VJENIS[g.j].label}</h4><ul>${g.list.map((k) => vKlaimHtml(k, v)).join('')}</ul></div>`)
    .join('');
  const tombol = owner && v.status !== 'baru'
    ? `<button type="button" class="btn ghost small-btn" data-vproses="${esc(v.video_id)}">${v.status === 'selesai' || v.status === 'tidak_relevan' ? 'Ringkas ulang' : 'Ringkas video ini'}</button>`
    : owner && v.status === 'baru'
      ? `<button type="button" class="btn ghost small-btn" data-vproses="${esc(v.video_id)}">${v.diminta ? 'Sedang diminta…' : 'Ringkas sekarang'}</button>`
      : '';
  return `<article class="vcard st-${esc(v.status)}">
      <div class="vtop"><span class="vstatus ${esc(v.status)}">${esc(VSTATUS[v.status] || v.status)}</span><span class="muted small">${esc(v.channel || '')} · ${tgl(v.tanggal)}</span></div>
      <h3><a href="${esc(safeUrl(v.url))}" target="_blank" rel="noopener noreferrer">${esc(v.judul)} ↗</a></h3>
      ${v.ringkasan ? `<p class="vringkas">${esc(v.ringkasan)}</p>` : ''}
      ${owner && v.alasan ? `<p class="muted small">${esc(v.alasan)}</p>` : ''}
      ${grup}
      ${v.status === 'selesai' && !v.klaim.length ? '<p class="muted small">Tidak ada pandangan makro yang bisa dicatat dari video ini.</p>' : ''}
      ${owner ? `<div class="vfoot">${tombol}${v.model ? `<span class="muted small">Gemini ${esc(v.model)}${v.token ? ` · ±${Math.round(v.token / 1000)} rb token` : ''}${v.diproses_at ? ` · ${waktu(v.diproses_at)}` : ''}</span>` : ''}</div>` : ''}
    </article>`;
}

function vStatusBoxHtml(d) {
  const p = d.pengaturan;
  if (!d.aktif) {
    return `<div class="empty"><strong>Fitur pandangan video belum aktif.</strong>
      Isi secret <b>GEMINI_API_KEY</b> di Cloudflare (Workers → peta-rantai-peristiwa → Settings → Variables and Secrets → Add, Type: Secret).
      Key gratis bisa dibuat di Google AI Studio. Setelah itu klik "Periksa channel sekarang" di sini.
      <p class="small" style="margin-top:8px">Channel pantauan: ${esc(p.channels.map((c) => c.nama || c.handle).join(', '))}.</p></div>`;
  }
  const ch = (d.channels || []).length
    ? d.channels.map((c) => `<li>${esc(c.nama || c.handle)} ${c.handle ? `<span class="muted">(${esc(c.handle)})</span>` : ''}: ${c.galat ? `<span class="bad">gagal: ${esc(c.galat)}</span>` : `${c.n} video di feed${c.baru ? `, ${c.baru} baru` : ''}`}</li>`).join('')
    : `<li class="muted">Belum diperiksa. Channel pantauan: ${esc(p.channels.map((c) => c.handle || c.nama).join(', '))}.</li>`;
  return `<div class="run-box vbox">
      <div>
        <p><b>Channel pantauan</b></p>
        <ul class="small vchannels">${ch}</ul>
        <p class="muted small">Feed dicek tiap ±${p.rss_jam} jam${d.rss_at ? ` · terakhir ${waktu(d.rss_at)}` : ''}. Diringkas hari ini: ${d.analisis_hari_ini} dari ${p.maks_harian} video (hanya ${p.menit} menit pertama, video ≤ ${p.hari} hari).</p>
        ${d.galat ? `<p class="small bad">Galat terakhir: ${esc(d.galat)}</p>` : ''}
        <p class="small" id="v-msg"></p>
      </div>
      <button type="button" class="btn primary" id="v-periksa">Periksa channel sekarang</button>
    </div>`;
}

async function renderVideo() {
  const d = await api('/api/video');
  videoState.aktif = Boolean(d.aktif);
  const f = videoState.filter;
  const cocok = (v) => f === 'semua' || (f === 'selesai' ? v.status === 'selesai' : v.status !== 'selesai');
  const list = d.videos.filter(cocok);
  const n = { semua: d.videos.length, selesai: d.videos.filter((v) => v.status === 'selesai').length };
  n.lain = n.semua - n.selesai;
  const chip = (id, label) => `<button type="button" class="fchip" data-vf="${id}" aria-pressed="${f === id}">${label} <span class="muted">${n[id]}</span></button>`;
  view.innerHTML = `
    <section class="section">
      <div class="section-head"><h2>Pandangan video</h2><span class="muted small">percobaan</span></div>
      <p class="lead">Pandangan analis dari video YouTube, diringkas AI (Gemini) lalu ditempel ke rantai sebagai catatan ▶. Pandangan <b>bukan peristiwa</b>: rantai tidak berubah, tidak ikut prioritas tinjauan, dan ini bukan saran beli/jual. Tonton menitnya untuk memastikan maksud pembicara.</p>
      ${state.owner ? vStatusBoxHtml(d) : ''}
    </section>
    ${d.aktif ? `
    <section class="section">
      ${state.owner ? `<div class="fchips" role="group" aria-label="Saring video">${chip('semua', 'Semua')}${chip('selesai', 'Sudah diringkas')}${chip('lain', 'Lainnya')}</div>` : ''}
      <div class="vlist">${list.length ? list.map(vKartuHtml).join('') : `<div class="empty"><strong>Belum ada video.</strong>${state.owner ? 'Klik "Periksa channel sekarang".' : 'Video muncul setelah pemilik mengaktifkan fitur ini.'}</div>`}</div>
    </section>` : ''}`;

  const pr = $('#v-periksa');
  if (pr) pr.addEventListener('click', async () => {
    pr.disabled = true;
    $('#v-msg').textContent = 'Memeriksa feed dan meringkas satu video… (bisa sampai ±1 menit)';
    try {
      const r = await api('/api/video/periksa', { method: 'POST' });
      $('#v-msg').textContent = vHasilText(r);
      setTimeout(() => go('video'), r.masihJalan ? 1500 : 600);
    } catch (e) {
      pr.disabled = false;
      $('#v-msg').textContent = e.message;
    }
  });
  view.querySelectorAll('[data-vf]').forEach((b) => b.addEventListener('click', () => { videoState.filter = b.dataset.vf; go('video'); }));
  view.querySelectorAll('[data-vopen]').forEach((b) => b.addEventListener('click', () => openEvent(Number(b.dataset.vopen))));
  view.querySelectorAll('[data-vproses]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    b.textContent = 'Meringkas… (±1 menit)';
    try {
      const r = await api(`/api/video/${encodeURIComponent(b.dataset.vproses)}/proses`, { method: 'POST' });
      toast(vHasilText(r));
      await videoLoadNotes(true);
      go('video');
    } catch (e) {
      b.disabled = false;
      toast(e.message);
    }
  }));
  view.querySelectorAll('[data-vcatat]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const r = await api(`/api/video/klaim/${b.dataset.vcatat}/catat`, { method: 'POST' });
      toast(r.sudah ? 'Perkiraan ini sudah ada di Perkiraan.' : r.lewat ? 'Dicatat. Tanggal ceknya sudah lewat, jadi AI mengeceknya dalam beberapa menit.' : 'Dicatat di Perkiraan.');
      loadStatus();
      go('video');
    } catch (e) {
      b.disabled = false;
      toast(e.message);
    }
  }));
  view.querySelectorAll('[data-vhapus]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Hapus pandangan ini? Gunakan bila AI salah menangkap maksud pembicara.')) return;
    b.disabled = true;
    try {
      await api(`/api/video/klaim/${b.dataset.vhapus}/hapus`, { method: 'POST' });
      await videoLoadNotes(true);
      go('video');
    } catch (e) {
      b.disabled = false;
      toast(e.message);
    }
  }));
}

function vHasilText(r) {
  if (!r) return '';
  if (r.masihJalan) return 'Masih diproses di latar belakang. Buka lagi tab ini sebentar lagi.';
  if (r.message && r.ok === false) return 'Gagal: ' + r.message;
  const a = r.analisis || r;
  const feed = r.feed ? `Feed diperiksa: ${r.feed.baru} video baru. ` : '';
  if (a.sibuk) return feed + 'Ada video lain yang sedang diringkas.';
  if (a.kuota) return feed + (a.message || 'Batas harian tercapai.');
  if (a.kosong) return feed + 'Tidak ada video yang menunggu diringkas.';
  if (a.ok === false) return feed + 'Gagal meringkas: ' + (a.message || '');
  if (a.video_id) return feed + (a.relevan === false ? 'Video diringkas: tidak membahas makro.' : `Video diringkas: ${a.klaim} pandangan dicatat.`);
  return feed || 'Selesai.';
}
