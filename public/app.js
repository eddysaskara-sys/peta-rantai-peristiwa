'use strict';

const state = {
  pin: '',
  owner: false,
  status: null,
  tab: 'rantai',
  chainId: null,
  withUsulan: false,
  rantaiKel: '',
  filters: { tingkat: '', kelompok: '', q: '', days: 30 },
  fcFilter: 'semua',
  fcOpen: new Set(),
  guideMode: '',
};

const $ = (sel) => document.querySelector(sel);
const view = $('#view');

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function safeUrl(u) {
  return /^https?:\/\//i.test(u || '') ? u : '#';
}
function tgl(d, withDay) {
  if (!d) return '';
  const [y, m, dd] = d.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, dd));
  const s = `${dd} ${BULAN[m - 1]} ${y}`;
  return withDay ? `${HARI[date.getUTCDay()]}, ${s}` : s;
}
function waktu(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' WIB';
}
function lvl(t) {
  return `<span class="lvl ${t === 'global' ? 'global' : 'lokal'}">${t === 'global' ? 'Global' : 'Lokal'}</span>`;
}
function chips(list, extra = '') {
  const items = (list || []).map((s) => `<span class="chip">${esc(s)}</span>`).join('') + extra;
  return items ? `<div class="chips">${items}</div>` : '';
}
function kelNama(id) {
  return (state.status?.kelompok || []).find((k) => k.id === id)?.nama || id;
}
// Label ⚖️: media Indonesia dan internasional menyorot sudut berbeda.
function duaSisiTag(ev) {
  return ev && ev.dua_sisi ? '<span class="chip sisi" title="Media Indonesia dan internasional menyorot sudut berbeda">⚖️ Sudut berbeda</span>' : '';
}
// Chip kelompok sektor (tebal) + indikator.
function evChips(e) {
  const kel = (e.kelompok || []).map((k) => `<span class="chip kel">${esc(kelNama(k))}</span>`).join('');
  const ind = (e.indikator || []).map((s) => `<span class="chip">${esc(s)}</span>`).join('');
  return kel || ind || e.dua_sisi ? `<div class="chips">${kel}${ind}${duaSisiTag(e)}</div>` : '';
}

function store(key, val) {
  try {
    if (val) sessionStorage.setItem(key, val);
    else sessionStorage.removeItem(key);
  } catch (e) { /* penyimpanan tidak tersedia */ }
}
function load(key) {
  try { return sessionStorage.getItem(key) || ''; } catch (e) { return ''; }
}
// Penanda yang bertahan antar kunjungan (mis. panduan sudah dilihat). Aman bila penyimpanan diblokir.
function keep(key, val) {
  try { localStorage.setItem(key, val); } catch (e) { /* abaikan */ }
}
function kept(key) {
  try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
}

async function api(path, opts = {}) {
  const headers = { 'content-type': 'application/json' };
  if (state.pin) headers['x-pin'] = state.pin;
  const res = await fetch(path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  let data = {};
  try { data = await res.json(); } catch (e) { /* bukan JSON */ }
  if (!res.ok && !('ok' in data)) throw new Error(data.error || `Gagal memuat (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

// ---------- Status & masuk ----------
async function loadStatus() {
  state.status = await api('/api/status');
  state.owner = state.status.owner;
  if (state.pin && !state.owner) {
    state.pin = '';
    store('pin', '');
  }
  document.querySelectorAll('.owner-only').forEach((el) => (el.hidden = !state.owner));
  $('#owner-btn').textContent = state.owner ? 'Keluar dari mode pemilik' : 'Masuk sebagai pemilik';
  const r = state.status.lastRun;
  $('#last-update').textContent = !r
    ? 'Belum pernah diperbarui'
    : r.status === 'antre' || r.status === 'berjalan'
      ? 'Pembaruan sedang diproses'
      : `Diperbarui ${waktu(r.finished_at || r.started_at)}${r.status === 'gagal' ? ' (gagal)' : ''}`;
  const sisa = state.status.tinjau?.sisa || 0;
  const badge = $('#badge');
  badge.hidden = !(state.owner && sisa);
  badge.textContent = sisa;
  const perlu = state.status.counts?.forecasts_due || 0;
  const bfc = $('#badge-fc');
  bfc.hidden = !(state.owner && perlu);
  bfc.textContent = perlu;
  bfc.title = 'Perkiraan yang perlu keputusan Anda';
}

$('#owner-btn').addEventListener('click', () => {
  if (state.owner) {
    state.pin = '';
    store('pin', '');
    loadStatus().then(() => go(state.tab === 'tinjau' ? 'rantai' : state.tab));
    toast('Anda keluar dari mode pemilik.');
    return;
  }
  $('#pin-error').hidden = true;
  $('#pin-input').value = '';
  $('#pin-dialog').showModal();
});
$('#pin-cancel').addEventListener('click', () => $('#pin-dialog').close());
$('#pin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = $('#pin-input').value.trim();
  const res = await fetch('/api/login', { method: 'POST', headers: { 'x-pin': pin } });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    $('#pin-error').textContent = d.error || 'PIN salah.';
    $('#pin-error').hidden = false;
    return;
  }
  state.pin = pin;
  store('pin', pin);
  $('#pin-dialog').close();
  await loadStatus();
  go(state.status.tinjau?.sisa ? 'tinjau' : 'rantai');
  toast('Mode pemilik aktif.');
});

// ---------- Navigasi ----------
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));

function go(tab, opts = {}) {
  if (tab === 'tinjau' && !state.owner) tab = 'rantai';
  state.tab = tab;
  if (opts.chainId) state.chainId = opts.chainId;
  document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
  const hash = tab === 'rantai' && state.chainId ? `#rantai/${state.chainId}` : `#${tab}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
  const fn = { tinjau: renderTinjau, linimasa: renderLinimasa, rantai: renderRantai, sektor: renderSektor, perkiraan: renderPerkiraan, panduan: renderPanduan }[tab];
  view.innerHTML = '<p class="loading">Memuat…</p>';
  fn().catch((e) => (view.innerHTML = `<div class="empty"><strong>Tidak bisa memuat bagian ini.</strong>${esc(e.message)}</div>`));
  if (opts.focus) view.focus();
}

// ---------- Tinjau (pemilik) ----------
async function renderTinjau() {
  const d = await api('/api/review');
  const run = d.lastRun;
  const runInfo = run && (run.status === 'antre' || run.status === 'berjalan')
    ? 'Pembaruan sedang diproses.'
    : run
    ? `Pembaruan terakhir ${waktu(run.started_at)}: ${run.status === 'gagal' ? 'gagal' : `${run.n_articles} berita baru, ${run.n_events} peristiwa, ${run.n_links} usulan kaitan`}.`
    : 'Belum ada pembaruan. Ambil berita pertama sekarang.';
  const aiUsed = state.status?.counts?.ai_calls || 0;
  view.innerHTML = `
    <section class="section">
      <div class="section-head"><h2>Tinjauan malam ini</h2><span class="muted small" id="quota">${quotaText(d)}</span></div>
      <p class="lead">Maksimal ${d.maks} usulan per malam, diurutkan menurut prioritas: berdampak ke Indonesia, menyambung rantai lama, sebabnya dari tanggal yang lebih awal, dan sektor yang sedang bergerak tidak biasa. Usulan lain tidak hilang; besok ikut bersaing lagi.</p>
      <div id="proposals">${proposalsBody(d)}</div>
      ${scanBoxHtml(d.lastScan)}
    </section>

    ${pulseHtml(d.signals, true)}

    <section class="section">
      <div class="run-box">
        <div>
          <p>${esc(runInfo)}</p>
          <p class="muted small">Pembaruan otomatis setiap hari pukul 17.30 WIB. Kuota AI hari ini: ${aiUsed} dari ${state.status.aiLimit} panggilan.</p>
          ${run && run.note ? `<details class="small muted"><summary>Catatan pembaruan</summary><pre style="white-space:pre-wrap">${esc(run.note)}</pre></details>` : ''}
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <label class="small" for="run-days" style="margin:0">Rentang</label>
          <select id="run-days"><option value="1">1 hari terakhir</option><option value="3">3 hari terakhir</option><option value="7">7 hari terakhir</option></select>
          <button class="btn primary" id="run-btn" type="button">Ambil berita sekarang</button>
        </div>
      </div>
      <p id="run-msg" class="muted small" style="margin-top:8px"></p>
      ${cekSumberHtml(d.cekSumber)}
    </section>

    <section class="section">
      <div class="section-head"><h2>Peristiwa dari pembaruan terakhir</h2><span class="muted small">${d.fresh.length} peristiwa</span></div>
      <p class="lead">Arsipkan peristiwa yang tidak relevan agar tidak ikut dikaitkan.</p>
      <div id="fresh">${d.fresh.length ? d.fresh.map((e) => freshHtml(e)).join('') : '<div class="empty">Belum ada peristiwa.</div>'}</div>
    </section>

    ${riwayatHtml(d)}`;

  state.review = d;
  $('#run-btn').addEventListener('click', runNow);
  $('#scan-btn').addEventListener('click', async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true;
    try {
      await api('/api/kaitan/cari', { method: 'POST' });
      b.textContent = 'Masuk antrean…';
      $('#scan-msg').textContent = 'AI memindai semua peristiwa paling lambat 5 menit lagi. Usulan baru masuk ke daftar tinjauan di atas; buka lagi Tinjau untuk melihatnya.';
    } catch (e) {
      b.disabled = false;
      toast(e.message);
    }
  });
  bindRiwayat(d);
  $('#cs-btn').addEventListener('click', async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true;
    try {
      await api('/api/sumber/cek', { method: 'POST' });
      b.textContent = 'Masuk antrean…';
      $('#cs-msg').textContent = 'Sumber diperiksa paling lambat 5 menit lagi, tanpa memakai kuota AI. Buka lagi bagian ini untuk melihat hasilnya.';
    } catch (e) {
      b.disabled = false;
      toast(e.message);
    }
  });
  if (run && (run.status === 'antre' || run.status === 'berjalan')) waitForRun(run.id);
  view.querySelectorAll('[data-link-action]').forEach((b) => b.addEventListener('click', decideLink));
  view.querySelectorAll('[data-archive]').forEach((b) => b.addEventListener('click', archiveEvent));
  view.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openEvent(Number(b.dataset.open))));
}

function quotaText(d) {
  return `${d.sudah} dari ${d.maks} sudah diputuskan`;
}

function proposalsBody(d) {
  if (d.pending.length) return d.pending.map(proposalHtml).join('');
  if (d.slot === 0) {
    return `<div class="empty"><strong>Tinjauan malam ini selesai.</strong>${d.menunggu ? `${d.menunggu} usulan lain menunggu dan ikut bersaing lagi besok.` : 'Tidak ada usulan lain yang menunggu.'}</div>`;
  }
  return '<div class="empty"><strong>Tidak ada usulan yang menunggu.</strong>Usulan baru muncul setelah pembaruan berikutnya.</div>';
}

function proposalHtml(p, riwayat = false) {
  const endBtn = (id, judul) => `<button class="linklike plainbtn" type="button" data-open="${id}">${esc(judul)}</button>`;
  const sisi = (txt) => (txt ? ' <span class="chip sisi" title="Media Indonesia dan internasional menyorot sudut berbeda">⚖️</span>' : '');
  return `<article class="proposal" id="p-${p.id}">
    <div class="prio"><span class="prio-score" aria-label="Prioritas ${p.skor} dari ${SKOR_MAKS}">Prioritas ${p.skor}/${SKOR_MAKS}</span>
      ${(p.kelompok_nama || []).map((k) => `<span class="chip kel">${esc(k)}</span>`).join('')}</div>
    <div class="pair">
      <div class="end">${lvl(p.dari_tingkat)} <span class="muted small">${tgl(p.dari_tanggal)}</span>${sisi(p.dari_dua_sisi)}<br>${endBtn(p.dari_id, p.dari_judul)}</div>
      <div class="arrow"><span aria-hidden="true">↓</span>${esc(p.jenis)}</div>
      <div class="end">${lvl(p.ke_tingkat)} <span class="muted small">${tgl(p.ke_tanggal)}</span>${sisi(p.ke_dua_sisi)}<br>${endBtn(p.ke_id, p.ke_judul)}</div>
    </div>
    <p class="reason">${esc(p.alasan)}</p>
    ${p.alasan_prioritas && p.alasan_prioritas.length
      ? `<ul class="why">${p.alasan_prioritas.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`
      : `<p class="why-none muted small">${riwayat ? 'Tidak memenuhi kriteria prioritas.' : 'Tidak memenuhi kriteria prioritas; tampil karena slot malam ini masih ada.'}</p>`}
    <div class="proposal-actions">
      <span class="conf">Keyakinan AI ${Math.round((p.keyakinan || 0) * 100)}%</span>
      <span style="display:flex;gap:8px">
        <button class="btn no" type="button" data-link-action="ditolak" data-id="${p.id}"${riwayat ? ' data-riwayat="1"' : ''}>Tolak</button>
        <button class="btn ok" type="button" data-link-action="disetujui" data-id="${p.id}"${riwayat ? ' data-riwayat="1"' : ''}>Setujui</button>
      </span>
    </div>
  </article>`;
}

function freshHtml(e) {
  return `<div class="ev ${e.tingkat}" style="cursor:default">
    <div>
      <div class="ev-title"><button type="button" style="background:none;border:0;padding:0;color:inherit;font:inherit;text-align:left;cursor:pointer" data-open="${e.id}">${esc(e.judul)}</button></div>
      <div class="ev-meta">${lvl(e.tingkat)}<span>${tgl(e.tanggal)}</span><span>${e.n_sumber || 0} sumber</span></div>
      ${evChips(e)}
      <div style="margin-top:8px"><button class="btn ghost small-btn" type="button" data-archive="${e.id}">Arsipkan</button></div>
    </div>
  </div>`;
}

// ---------- Cari kaitan terbesar ----------
const SKOR_MAKS = 4;
function scanBoxHtml(run) {
  let info = 'Belum pernah dijalankan.';
  if (run) {
    if (run.status === 'antre' || run.status === 'berjalan') info = 'Sedang diproses.';
    else if (run.status === 'gagal') info = `Terakhir ${waktu(run.finished_at || run.started_at)}: gagal (${esc((run.note || '').split('\n').pop())}).`;
    else info = `Terakhir ${waktu(run.finished_at)}: ${run.n_events} peristiwa dipindai, ${run.n_links} usulan kaitan baru.`;
  }
  const sejak = state.status.sejak ? ` sejak ${tgl(state.status.sejak)}` : '';
  return `<div class="scan-box">
      <div>
        <p><b>Cari kaitan terbesar</b></p>
        <p class="small muted">AI memeriksa semua peristiwa${sejak} dan mencari kaitan sebab-akibat terkuat yang belum tercatat, termasuk sebab dari tanggal jauh sebelumnya. Berjalan otomatis sekali sehari setelah pembaruan pertama hari itu.</p>
        <p class="small" id="scan-msg">${info}</p>
      </div>
      <button class="btn ghost" id="scan-btn" type="button"${run && (run.status === 'antre' || run.status === 'berjalan') ? ' disabled' : ''}>Cari sekarang</button>
    </div>`;
}

// ---------- Cek sumber berita (tanpa AI) ----------
function cekSumberHtml(run) {
  const head = `<div class="cs-row"><button class="btn ghost small-btn" id="cs-btn" type="button">Cek sumber berita</button>
    <span class="muted small" id="cs-msg">Memeriksa setiap media dan topik: berapa judul yang didapat dan mana yang gagal. Tidak memakai kuota AI.</span></div>`;
  if (!run) return head;
  if (run.status === 'antre' || run.status === 'berjalan') return head.replace('id="cs-msg">', 'id="cs-msg">Pemeriksaan sumber sedang diproses. ');
  const note = run.note || '';
  const ok = [];
  const gagal = [];
  note.split('\n').forEach((line) => {
    if (line.startsWith('Berita per sumber: ')) line.slice(19).split(', ').forEach((x) => x && ok.push(x));
    if (line.startsWith('Sumber gagal: ')) gagal.push(line.slice(14));
  });
  const kosong = ok.filter((x) => / 0$/.test(x));
  const isi = ok.filter((x) => !/ 0$/.test(x));
  const harga = (note.split('\n').find((l) => l.startsWith('Harga pasar:')) || '').replace('Harga pasar: ', '');
  return `${head}
    <details class="cs-result"><summary>Hasil cek sumber ${waktu(run.finished_at || run.started_at)}: ${isi.length} sumber berisi, ${kosong.length} kosong, ${gagal.length} gagal</summary>
      ${gagal.length ? `<p class="small"><b>Gagal</b></p><ul class="cs-list bad">${gagal.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${kosong.length ? `<p class="small"><b>Tersambung tetapi kosong</b></p><ul class="cs-list">${kosong.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <p class="small"><b>Berhasil</b></p><ul class="cs-list">${isi.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      ${harga ? `<p class="small" style="margin-top:8px"><b>Data harga:</b> ${esc(harga)}</p>` : ''}
    </details>`;
}

// ---------- Usulan kaitan lain + ambil berita tanggal lampau ----------
function riwayatHtml(d) {
  const st = d.riwayatStatus;
  const today = state.status.today;
  const r = d.riwayat || { pending: [], total: 0 };
  const jalan = st ? st.antre + st.berjalan : 0;
  const prog = st
    ? `<p class="small">Terakhir: ${st.selesai} dari ${st.total} giliran selesai (${tgl(st.mulai)} – ${tgl(st.sampai)}).${st.gagal ? ` ${st.gagal} giliran gagal; tekan "Ambil" lagi untuk mengulanginya.` : ''}${jalan ? ` ${jalan} giliran menunggu dan diproses bertahap selama kuota AI hari ini cukup.` : ''}</p>`
    : '';
  const list = r.pending.length
    ? `<section class="section" id="riwayat">
        <div class="section-head"><h2>Usulan kaitan lain (${r.total})</h2><span class="muted small">Di luar jatah ${d.maks} per malam</span></div>
        ${rwChecklistHtml(r)}
      </section>`
    : '';
  return `${list}
    <section class="section">
      <details class="cs-result"${jalan ? ' open' : ''}>
        <summary>Ambil berita tanggal lampau</summary>
        <p class="small muted" style="margin:8px 0">Untuk tanggal yang terlewat, mis. saat pembaruan gagal. Berita diambil dari arsip Google News (paling jauh 60 hari) lalu diproses seperti pembaruan biasa.</p>
        ${prog}
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
          <label class="small" for="rw-mulai" style="margin:0">Mulai</label>
          <input type="date" id="rw-mulai" value="${st?.mulai || today.slice(0, 8) + '01'}" max="${today}">
          <button class="btn ghost small-btn" id="rw-btn" type="button">Ambil</button>
        </div>
        <p id="rw-msg" class="muted small" style="margin-top:8px"></p>
      </details>
    </section>`;
}

// ---------- Setujui sekaligus (usulan di luar antrean malam) ----------
const rwPct = (x) => Math.round((x || 0) * 100);

function rwChecklistHtml(r) {
  const batas = state.status.riwayatCentang ?? 0.6;
  const n = r.pending.length;
  const nYakin = r.pending.filter((p) => (p.keyakinan || 0) >= batas).length;
  const nSambung = r.pending.filter((p) => p.lama).length;
  const row = (p) => {
    const yakin = (p.keyakinan || 0) >= batas;
    const label = `Pilih kaitan: ${p.dari_judul} ${p.jenis} ${p.ke_judul}`;
    return `<li class="rw-row${yakin ? ' on' : ''}">
      <input type="checkbox" data-rwid="${p.id}" data-yakin="${yakin ? 1 : 0}" data-sambung="${p.lama ? 1 : 0}" aria-label="${esc(label)}" ${yakin ? 'checked' : ''}>
      <div class="rw-body">
        <div class="rw-pair">
          <span>${lvl(p.dari_tingkat)} <span class="muted small">${tgl(p.dari_tanggal)}</span><br><button type="button" class="linklike plainbtn" data-open="${p.dari_id}">${esc(p.dari_judul)}</button></span>
          <span class="rw-arrow" aria-hidden="true">→</span>
          <span>${lvl(p.ke_tingkat)} <span class="muted small">${tgl(p.ke_tanggal)}</span><br><button type="button" class="linklike plainbtn" data-open="${p.ke_id}">${esc(p.ke_judul)}</button></span>
        </div>
        <p class="small rw-why"><b>${esc(p.jenis)}</b> · ${esc(p.alasan)}</p>
        <div class="chips"><span class="chip conf${yakin ? ' hi' : ''}">Keyakinan AI ${rwPct(p.keyakinan)}%</span>${p.lama ? '<span class="chip kel">Menyambung rantai</span>' : ''}${p.indonesia ? '<span class="chip">Berdampak ke Indonesia</span>' : ''}</div>
      </div>
    </li>`;
  };
  return `<p class="lead">Usulan kaitan di luar antrean malam. Periksa daftar ini, hapus centang pada kaitan yang tidak cocok, lalu setujui sekaligus. Usulan dengan keyakinan AI ≥ ${rwPct(batas)}% sudah tercentang. Klik judul peristiwa untuk membaca beritanya. Yang tidak dicentang tetap menunggu, kecuali Anda menolaknya.</p>
    <div class="rw-tools" role="group" aria-label="Centang cepat">
      <span class="small muted">Centang:</span>
      <button type="button" class="fchip" data-rwpick="yakin">Keyakinan ≥ ${rwPct(batas)}% <span class="muted">${nYakin}</span></button>
      <button type="button" class="fchip" data-rwpick="sambung">Menyambung rantai <span class="muted">${nSambung}</span></button>
      <button type="button" class="fchip" data-rwpick="semua">Semua <span class="muted">${n}</span></button>
      <button type="button" class="fchip" data-rwpick="kosong">Kosongkan</button>
    </div>
    <ul class="rw-list">${r.pending.map(row).join('')}</ul>
    <div class="rw-bar">
      <span id="rw-sel" class="small"></span>
      <span class="rw-actions">
        <button type="button" class="btn ghost small-btn danger" id="rw-reject"></button>
        <button type="button" class="btn primary" id="rw-approve"></button>
      </span>
    </div>`;
}

function bindRwChecklist(d) {
  const boxes = [...view.querySelectorAll('[data-rwid]')];
  if (!boxes.length) return;
  const approve = $('#rw-approve');
  const reject = $('#rw-reject');
  const sync = () => {
    const on = boxes.filter((b) => b.checked).length;
    const off = boxes.length - on;
    boxes.forEach((b) => b.closest('.rw-row').classList.toggle('on', b.checked));
    $('#rw-sel').textContent = `${on} dari ${boxes.length} dicentang`;
    approve.textContent = on ? `Setujui ${on} kaitan` : 'Setujui yang dicentang';
    approve.disabled = !on;
    reject.textContent = `Tolak ${off} yang tidak dicentang`;
    reject.disabled = !off;
  };
  boxes.forEach((b) => b.addEventListener('change', sync));
  view.querySelectorAll('[data-rwpick]').forEach((btn) => btn.addEventListener('click', () => {
    const k = btn.dataset.rwpick;
    boxes.forEach((b) => (b.checked = k === 'semua' || (k === 'yakin' && b.dataset.yakin === '1') || (k === 'sambung' && b.dataset.sambung === '1')));
    sync();
  }));
  const send = async (payload, pesan) => {
    approve.disabled = reject.disabled = true;
    try {
      const r = await api('/api/links/riwayat', { method: 'POST', body: JSON.stringify(payload) });
      toast(pesan(r));
      await loadStatus();
      await renderTinjau();
      const sec = $('#riwayat');
      if (sec) sec.scrollIntoView({ block: 'start' });
    } catch (e) {
      toast(e.message);
      sync();
    }
  };
  approve.addEventListener('click', () => {
    const ids = boxes.filter((b) => b.checked).map((b) => Number(b.dataset.rwid));
    send({ setujui: ids }, (r) => `${r.disetujui} kaitan disetujui dan sudah tampil di Rantai.`);
  });
  reject.addEventListener('click', () => {
    const ids = boxes.filter((b) => !b.checked).map((b) => Number(b.dataset.rwid));
    if (!confirm(`Tolak ${ids.length} usulan yang tidak dicentang? Usulan yang ditolak tidak akan tampil lagi.`)) return;
    send({ tolak: ids }, (r) => `${r.ditolak} usulan ditolak.`);
  });
  sync();
}

function bindRiwayat(d) {
  $('#rw-btn').addEventListener('click', async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true;
    try {
      const r = await api('/api/riwayat', { method: 'POST', body: JSON.stringify({ mulai: $('#rw-mulai').value }) });
      if (!r.ok) throw new Error(r.message || 'Gagal.');
      $('#rw-msg').textContent = r.jendela
        ? `${r.jendela} giliran masuk antrean (${tgl(r.mulai)} – ${tgl(r.sampai)}). Hasilnya muncul bertahap di Linimasa.`
        : `Tanggal ${tgl(r.mulai)} – ${tgl(r.sampai)} sudah terisi atau sedang antre.`;
    } catch (e) {
      $('#rw-msg').textContent = e.message;
    }
    b.disabled = false;
  });
  bindRwChecklist(d);
}

let pollTimer;
async function runNow() {
  const btn = $('#run-btn');
  btn.disabled = true;
  btn.textContent = 'Masuk antrean…';
  try {
    const r = await api('/api/run', { method: 'POST', body: JSON.stringify({ days: Number($('#run-days').value) }) });
    if (!r.ok) throw new Error(r.message || 'Pembaruan gagal.');
    waitForRun(r.runId);
  } catch (e) {
    $('#run-msg').textContent = 'Pembaruan gagal: ' + e.message;
    btn.disabled = false;
    btn.textContent = 'Ambil berita sekarang';
  }
}

/** Pantau pembaruan yang antre sampai selesai, lalu muat ulang Tinjau. */
function waitForRun(runId) {
  clearInterval(pollTimer);
  const started = Date.now();
  const show = (run) => {
    const msg = $('#run-msg');
    const btn = $('#run-btn');
    if (!msg || !btn) return;
    btn.disabled = true;
    btn.textContent = run && run.status === 'berjalan' ? 'Sedang diproses…' : 'Menunggu giliran…';
    msg.textContent = run && run.status === 'berjalan'
      ? 'Mengambil berita dari media lokal dan internasional, lalu AI menyusun peristiwa dan kaitannya (±1–2 menit).'
      : 'Permintaan tercatat. Cloudflare memprosesnya paling lambat 5 menit lagi. Halaman ini akan memperbarui sendiri; boleh juga ditutup.';
  };
  show({ status: 'antre' });
  pollTimer = setInterval(async () => {
    try {
      await loadStatus();
      const run = state.status.lastRun;
      if (!run || run.id !== runId) return;
      if (run.status === 'selesai' || run.status === 'gagal') {
        clearInterval(pollTimer);
        toast(run.status === 'selesai' ? `Selesai: ${run.n_events} peristiwa baru, ${run.n_links} usulan kaitan.` : 'Pembaruan gagal. Lihat catatan pembaruan.');
        if (state.tab === 'tinjau') go('tinjau');
      } else {
        show(run);
      }
      if (Date.now() - started > 15 * 60000) clearInterval(pollTimer);
    } catch (e) { /* coba lagi pada putaran berikutnya */ }
  }, 15000);
}

async function decideLink(e) {
  const b = e.currentTarget;
  const id = b.dataset.id;
  const status = b.dataset.linkAction;
  b.disabled = true;
  try {
    await api(`/api/links/${id}`, { method: 'POST', body: JSON.stringify({ status }) });
    $(`#p-${id}`).remove();
    const d = state.review;
    if (d) {
      d.pending = d.pending.filter((p) => String(p.id) !== String(id));
      d.sudah += 1;
      d.slot = Math.max(0, d.slot - 1);
      $('#quota').textContent = quotaText(d);
      if (!d.pending.length) $('#proposals').innerHTML = proposalsBody(d);
    }
    toast(status === 'disetujui' ? 'Kaitan disetujui dan tampil di Rantai.' : 'Kaitan ditolak.');
    loadStatus();
  } catch (err) {
    b.disabled = false;
    toast(err.message);
  }
}

async function archiveEvent(e) {
  const b = e.currentTarget;
  b.disabled = true;
  try {
    await api(`/api/events/${b.dataset.archive}`, { method: 'POST', body: JSON.stringify({ status: 'diarsip' }) });
    b.closest('.ev').remove();
    toast('Peristiwa diarsipkan.');
  } catch (err) {
    b.disabled = false;
    toast(err.message);
  }
}

// ---------- Sektor bergerak (label, tanpa grafik) ----------
const METODE = { harga: 'harga', berita: 'berita', 'kurang-data': 'belum cukup data' };
function pulseHtml(signals, inReview) {
  if (!signals || !signals.length) return '';
  const hot = signals.filter((s) => s.bergerak);
  const calm = signals.filter((s) => !s.bergerak);
  const row = (s) => `<li class="${s.bergerak ? 'hot' : ''}"><b>${esc(s.nama)}</b><span>${esc(s.label)}</span><span class="metode">${METODE[s.metode] || s.metode}</span></li>`;
  return `<section class="section pulse">
    <div class="section-head"><h2>Sektor bergerak</h2><span class="muted small">${inReview ? 'Dasar poin prioritas di atas' : 'Berubah otomatis mengikuti pasar'}</span></div>
    ${hot.length ? `<ul class="pulse-list">${hot.map(row).join('')}</ul>` : '<p class="muted">Tidak ada kelompok yang bergerak tidak biasa pada data terakhir.</p>'}
    ${calm.length ? `<details class="pulse-calm"><summary>${calm.length} kelompok lain tenang atau datanya belum cukup</summary><ul class="pulse-list">${calm.map(row).join('')}</ul></details>` : ''}
  </section>`;
}

// ---------- Linimasa ----------
async function renderLinimasa() {
  const f = state.filters;
  const s = state.status;
  const qs = new URLSearchParams({ days: f.days });
  if (f.tingkat) qs.set('tingkat', f.tingkat);
  if (f.kelompok) qs.set('kelompok', f.kelompok);
  if (f.q) qs.set('q', f.q);
  const d = await api('/api/events?' + qs);
  const groups = new Map();
  d.events.forEach((e) => {
    if (!groups.has(e.tanggal)) groups.set(e.tanggal, []);
    groups.get(e.tanggal).push(e);
  });
  const seg = (val, label) => `<button type="button" data-tingkat="${val}" aria-pressed="${f.tingkat === val}">${label}</button>`;
  view.innerHTML = `
    <div class="filters">
      <div class="seg" role="group" aria-label="Tingkat">${seg('', 'Semua')}${seg('global', 'Global')}${seg('lokal', 'Lokal')}</div>
      <select id="f-kel" aria-label="Kelompok sektor"><option value="">Semua kelompok sektor</option>${s.kelompok.map((k) => `<option value="${k.id}" ${k.id === f.kelompok ? 'selected' : ''}>${esc(k.nama)}</option>`).join('')}</select>
      <select id="f-days" aria-label="Rentang waktu">${[7, 30, 90, 365].map((n) => `<option value="${n}" ${n === f.days ? 'selected' : ''}>${n === 365 ? '1 tahun' : n + ' hari'}</option>`).join('')}</select>
      <input type="search" id="f-q" placeholder="Cari peristiwa, mis. minyak" value="${esc(f.q)}" aria-label="Cari">
    </div>
    ${d.events.length ? [...groups].map(([day, evs]) => `
      <section class="day">
        <h2 class="day-label">${tgl(day, true)}</h2>
        ${evs.map(evHtml).join('')}
      </section>`).join('') : emptyTimeline()}`;

  view.querySelectorAll('[data-tingkat]').forEach((b) => b.addEventListener('click', () => { f.tingkat = b.dataset.tingkat; go('linimasa'); }));
  $('#f-kel').addEventListener('change', (e) => { f.kelompok = e.target.value; go('linimasa'); });
  $('#f-days').addEventListener('change', (e) => { f.days = Number(e.target.value); go('linimasa'); });
  let t;
  $('#f-q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value.trim(); go('linimasa'); setTimeout(() => { const i = $('#f-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 50); }, 400); });
  view.querySelectorAll('.ev[data-id]').forEach((el) => el.addEventListener('click', () => openEvent(Number(el.dataset.id))));
}

function emptyTimeline() {
  const f = state.filters;
  if (f.tingkat || f.kelompok || f.q) return '<div class="empty"><strong>Tidak ada peristiwa yang cocok.</strong>Longgarkan filter atau perpanjang rentang waktu.</div>';
  return state.owner
    ? '<div class="empty"><strong>Belum ada peristiwa.</strong>Buka Tinjau lalu pilih "Ambil berita sekarang".</div>'
    : '<div class="empty"><strong>Belum ada peristiwa.</strong>Data muncul setelah pembaruan harian pukul 17.30 WIB.</div>';
}

function evHtml(e) {
  return `<button type="button" class="ev ${e.tingkat}" data-id="${e.id}">
    <div>
      <div class="ev-title">${esc(e.judul)}</div>
      <div class="ev-meta">${lvl(e.tingkat)}<span>${e.n_kaitan ? `${e.n_kaitan} kaitan` : 'belum ada kaitan'}</span><span>${e.n_sumber || 0} sumber</span></div>
      ${evChips(e)}
    </div>
  </button>`;
}

// ---------- Detail peristiwa ----------
async function openEvent(id) {
  const drawer = $('#drawer');
  const bodyEl = $('#drawer-body');
  bodyEl.innerHTML = '<p class="loading">Memuat…</p>';
  drawer.hidden = false;
  $('#drawer-close').focus();
  try {
    const d = await api(`/api/events/${id}`);
    const e = d.event;
    const linkItem = (l) => {
      const keluar = l.dari_id === id;
      const otherId = keluar ? l.ke_id : l.dari_id;
      const otherJudul = keluar ? l.ke_judul : l.dari_judul;
      return `<li class="hyp"><span class="muted small">${keluar ? 'Berdampak ke' : 'Dipengaruhi oleh'} · ${esc(l.jenis)}${l.status === 'usulan' ? '<span class="usulan-tag">usulan</span>' : ''}</span><br>
        <button type="button" data-open="${otherId}" style="background:none;border:0;padding:0;color:inherit;font:600 1rem var(--body);text-align:left;cursor:pointer;text-decoration:underline">${esc(otherJudul)}</button>
        <p class="small muted">${esc(l.alasan)}</p></li>`;
    };
    bodyEl.innerHTML = `
      <p>${lvl(e.tingkat)} <span class="muted small">${tgl(e.tanggal, true)}</span></p>
      <h2 id="drawer-title" style="margin-top:8px">${esc(e.judul)}</h2>
      ${evChips(e)}
      ${e.sektor.length ? `<p class="muted small" style="margin-top:6px">Sektor rinci: ${esc(e.sektor.join(', '))}</p>` : ''}
      <p style="margin-top:12px">${esc(e.ringkasan)}</p>
      <div class="row-end" style="justify-content:flex-start"><button type="button" class="btn primary" id="see-chain">Lihat rantainya</button>
      ${state.owner ? `<button type="button" class="btn ghost" id="archive-ev">${e.status === 'diarsip' ? 'Aktifkan lagi' : 'Arsipkan'}</button>` : ''}</div>
      ${e.dua_sisi ? `<div class="detail-block sisi-block"><h3>⚖️ Dua sisi pemberitaan</h3><p>${esc(e.dua_sisi)}</p><p class="muted small" style="margin-top:6px">Bandingkan sendiri lewat sumber media Indonesia dan internasional di bawah.</p></div>` : ''}
      <div class="detail-block"><h3>Kaitan</h3>${d.links.length ? `<ul class="plain">${d.links.map(linkItem).join('')}</ul>` : '<p class="muted">Belum ada kaitan yang disetujui.</p>'}</div>
      ${e.dampak.length ? `<div class="detail-block"><h3>Dampak yang mungkin terjadi</h3><p class="muted small" style="margin-bottom:8px">Hipotesis AI, bukan kepastian.</p>
        ${e.dampak.map((h, i) => `<div class="hyp"><p>${esc(h.teks)}</p><p class="muted small">Perkiraan dalam ±${h.hari} hari</p>${state.owner ? hypBtn(d.forecasts.some((f) => f.teks === h.teks), `data-hyp="${i}"`) : ''}</div>`).join('')}</div>` : ''}
      ${d.forecasts.length ? `<div class="detail-block"><h3>Perkiraan tercatat</h3>${d.forecasts.map((f) => `<div class="hyp"><p>${esc(f.teks)}</p><p class="muted small">Dicek ${tgl(f.tanggal_cek)} · ${statusFc(f)}</p></div>`).join('')}<button type="button" class="btn ghost small-btn" id="to-fc">Buka di Perkiraan</button></div>` : ''}
      <div class="detail-block"><h3>Sumber berita</h3><ul class="plain sources">${d.articles.map((a) => `<li><a href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a><br><span class="src">${esc(a.source)} · ${a.origin === 'lokal' ? 'media Indonesia' : 'media internasional'}${a.published_at ? ' · ' + waktu(a.published_at) : ''}</span></li>`).join('')}</ul></div>`;
    $('#see-chain').addEventListener('click', () => { closeDrawer(); go('rantai', { chainId: id, focus: true }); });
    bodyEl.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openEvent(Number(b.dataset.open))));
    const arch = $('#archive-ev');
    if (arch) arch.addEventListener('click', async () => {
      await api(`/api/events/${id}`, { method: 'POST', body: JSON.stringify({ status: e.status === 'diarsip' ? 'aktif' : 'diarsip' }) });
      toast(e.status === 'diarsip' ? 'Peristiwa diaktifkan lagi.' : 'Peristiwa diarsipkan.');
      closeDrawer();
      go(state.tab);
    });
    bodyEl.querySelectorAll('[data-hyp]').forEach((b) => b.addEventListener('click', async () => {
      const h = e.dampak[Number(b.dataset.hyp)];
      await saveHyp(b, { event_id: id, teks: h.teks, hari: h.hari });
    }));
    const toFc = $('#to-fc');
    if (toFc) toFc.addEventListener('click', () => { closeDrawer(); go('perkiraan'); });
  } catch (err) {
    bodyEl.innerHTML = `<div class="empty"><strong>Tidak bisa membuka peristiwa.</strong>${esc(err.message)}</div>`;
  }
}

function closeDrawer() {
  $('#drawer').hidden = true;
}
$('#drawer-close').addEventListener('click', closeDrawer);
$('#drawer').addEventListener('click', (e) => { if (e.target.id === 'drawer') closeDrawer(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#drawer').hidden) closeDrawer(); });

// ---------- Rantai ----------
async function renderRantai() {
  if (!state.chainId) return renderRantaiUtama();
  const qs = state.withUsulan ? '?usulan=1' : '';
  const d = await api(`/api/chain/${state.chainId}${qs}`);
  const f = d.focus;
  const stop = (n) => n.event ? `<div class="stop ${n.event.tingkat}">
      <div class="stop-card">
        <button type="button" class="linklike" data-chain="${n.event.id}">${esc(n.event.judul)}</button>
        <div class="ev-meta">${lvl(n.event.tingkat)}<span>${tgl(n.event.tanggal)}</span>${duaSisiTag(n.event)}</div>
        <p class="via"><b>${esc(n.link.jenis)}</b>${n.link.status === 'usulan' ? '<span class="usulan-tag">usulan</span>' : ''} · ${esc(n.link.alasan)}</p>
      </div></div>` : '';
  const upLevels = [...d.up].reverse();
  view.innerHTML = `
    <div class="section-head">
      <button type="button" class="btn ghost small-btn" id="chain-back">← Semua rantai</button>
      ${state.owner ? `<label class="small" style="margin:0;display:flex;gap:6px;align-items:center;font-weight:400"><input type="checkbox" id="with-usulan" ${state.withUsulan ? 'checked' : ''}> Tampilkan juga usulan AI</label>` : ''}
    </div>
    <div class="route">
      ${upLevels.length ? upLevels.map((lvlArr, i) => `<p class="stage-label">${i === upLevels.length - 1 ? 'Penyebab langsung' : `Penyebab ${upLevels.length - i} langkah sebelumnya`}</p>${lvlArr.map(stop).join('')}`).join('') : '<p class="stage-label">Belum ada penyebab yang tercatat</p>'}
      <p class="stage-label">Peristiwa yang dipilih</p>
      <div class="stop focus ${f.tingkat}"><div class="stop-card">
        <div class="ev-meta">${lvl(f.tingkat)}<span>${tgl(f.tanggal, true)}</span></div>
        <h2 style="margin-top:6px">${esc(f.judul)}</h2>
        <p style="margin-top:8px">${esc(f.ringkasan)}</p>
        ${evChips(f)}
        <div style="margin-top:10px"><button type="button" class="btn ghost small-btn" id="focus-detail">Sumber dan detail</button></div>
      </div></div>
      ${d.down.length ? d.down.map((lvlArr, i) => `<p class="stage-label">${i === 0 ? 'Dampak langsung' : `Dampak ${i + 1} langkah berikutnya`}</p>${lvlArr.map(stop).join('')}`).join('') : '<p class="stage-label">Belum ada dampak yang tercatat</p>'}
    </div>
    ${chainForecastHtml(f, d)}`;
  bindChainForecast(f, d);
  $('#chain-back').addEventListener('click', () => { state.chainId = null; go('rantai'); });
  $('#focus-detail').addEventListener('click', () => openEvent(f.id));
  const wu = $('#with-usulan');
  if (wu) wu.addEventListener('change', () => { state.withUsulan = wu.checked; go('rantai'); });
  view.querySelectorAll('[data-chain]').forEach((b) => b.addEventListener('click', () => go('rantai', { chainId: Number(b.dataset.chain), focus: true })));
}

// Layar utama: rantai yang sudah disetujui, bisa disaring per kelompok sektor.
async function renderRantaiUtama() {
  const kel = state.rantaiKel;
  const d = await api('/api/chains?days=90' + (kel ? '&kelompok=' + encodeURIComponent(kel) : ''));
  const st = state.status;
  const t = st.tinjau;
  const banner = state.owner && t
    ? (t.sisa
      ? `<div class="banner"><p><b>${t.sisa} usulan kaitan</b> menunggu keputusan Anda malam ini (${t.sudah}/${t.maks} sudah).</p><button type="button" class="btn primary" id="go-tinjau">Tinjau sekarang</button></div>`
      : `<div class="banner calm"><p>Tinjauan malam ini selesai (${t.sudah}/${t.maks}).${t.kolam ? ` ${t.kolam} usulan lain bersaing lagi besok.` : ''}</p></div>`)
    : '';
  const kelBtn = (id, nama) => `<button type="button" class="fchip" data-kel="${id}" aria-pressed="${kel === id}">${esc(nama)}</button>`;
  const baru = !state.owner && !kept('panduan-dilihat')
    ? `<div class="banner hint" id="hint"><p><b>Baru pertama kali di sini?</b> Baca Panduan singkat (± 2 menit) untuk tahu cara membaca rantai dan perkiraan.</p>
        <span style="display:flex;gap:8px"><button type="button" class="btn ghost small-btn" id="hint-close">Tutup</button><button type="button" class="btn primary small-btn" id="hint-open">Buka Panduan</button></span></div>`
    : '';
  const riw = state.owner && t && t.riwayat
    ? `<p class="muted small" style="margin:-12px 0 20px">Ada juga ${t.riwayat} usulan kaitan lain yang bisa disetujui sekaligus. <button type="button" class="linklike plainbtn" id="go-riwayat">Buka di Tinjau</button></p>`
    : '';
  view.innerHTML = `
    ${baru}
    ${banner}
    ${riw}
    <div class="section-head"><h2>Rantai sebab-akibat</h2><span class="muted small">${d.total} rantai · 90 hari terakhir</span></div>
    <p class="lead">Setiap rantai berawal dari penyebab paling awal. Pilih satu untuk melihat seluruh perambatannya.</p>
    <div class="fchips" role="group" aria-label="Saring per kelompok sektor">${kelBtn('', 'Semua')}${st.kelompok.map((k) => kelBtn(k.id, k.nama)).join('')}</div>
    <div class="chains">${d.chains.length ? d.chains.map(chainCardHtml).join('') : emptyChains(kel)}</div>
    ${pulseHtml(st.signals, false)}`;
  const gt = $('#go-tinjau');
  if (gt) gt.addEventListener('click', () => go('tinjau'));
  const gr = $('#go-riwayat');
  if (gr) gr.addEventListener('click', async () => {
    go('tinjau');
    for (let i = 0; i < 40 && !$('#riwayat'); i++) await new Promise((r) => setTimeout(r, 100));
    const sec = $('#riwayat');
    if (sec) sec.scrollIntoView({ block: 'start' });
  });
  const ho = $('#hint-open');
  if (ho) {
    ho.addEventListener('click', () => go('panduan'));
    $('#hint-close').addEventListener('click', () => { keep('panduan-dilihat', '1'); $('#hint').remove(); });
  }
  view.querySelectorAll('[data-kel]').forEach((b) => b.addEventListener('click', () => { state.rantaiKel = b.dataset.kel; go('rantai'); }));
  view.querySelectorAll('[data-akar]').forEach((b) => b.addEventListener('click', () => go('rantai', { chainId: Number(b.dataset.akar), focus: true })));
}

function emptyChains(kel) {
  if (kel) return `<div class="empty"><strong>Belum ada rantai di kelompok ${esc(kelNama(kel))}.</strong>Pilih "Semua" atau kelompok lain.</div>`;
  return `<div class="empty"><strong>Belum ada kaitan yang disetujui.</strong>${state.owner ? 'Rantai terbentuk setelah Anda menyetujui usulan di Tinjau.' : 'Rantai muncul setelah pemilik menyetujui usulan kaitan dari AI.'} Sementara itu, buka peristiwa dari Linimasa.</div>`;
}

function chainCardHtml(c) {
  const MAX = 4;
  const steps = c.jalur.slice(0, MAX);
  const lebih = c.jalur.length - steps.length;
  const lain = c.n_peristiwa - c.jalur.length;
  return `<button type="button" class="chain" data-akar="${c.akar}">
    <ol class="chain-steps">
      ${steps.map((s) => `<li class="${s.event.tingkat}">${s.link ? `<span class="jenis">${esc(s.link.jenis)}</span>` : ''}<span class="t">${esc(s.event.judul)}</span></li>`).join('')}
      ${lebih > 0 ? `<li class="more">… ${lebih} langkah lagi</li>` : ''}
    </ol>
    <div class="ev-meta"><span>${c.n_peristiwa} peristiwa · ${c.n_kaitan} kaitan</span><span>terbaru ${tgl(c.terbaru)}</span>${lain > 0 ? `<span>${lain} cabang lain</span>` : ''}</div>
    <div class="chips">${c.kelompok.map((k) => `<span class="chip kel">${esc(kelNama(k))}</span>`).join('')}${c.dua_sisi ? '<span class="chip sisi">⚖️ Sudut berbeda</span>' : ''}</div>
  </button>`;
}

// Tombol "catat sebagai perkiraan"; nonaktif bila hipotesis itu sudah tercatat.
function hypBtn(sudah, attr) {
  return sudah
    ? '<button type="button" class="btn ghost small-btn" disabled style="margin-top:6px">Sudah tercatat di Perkiraan</button>'
    : `<button type="button" class="btn ghost small-btn" ${attr} style="margin-top:6px">Catat sebagai perkiraan</button>`;
}

async function saveHyp(b, payload) {
  b.disabled = true;
  try {
    const r = await api('/api/forecasts', { method: 'POST', body: JSON.stringify(payload) });
    b.textContent = 'Sudah tercatat di Perkiraan';
    toast(r.sudah ? 'Perkiraan ini sudah ada di Perkiraan.' : 'Perkiraan dicatat dan otomatis masuk kelompoknya.');
    loadStatus();
  } catch (e) {
    b.disabled = false;
    toast(e.message);
  }
}

// ---------- Perkiraan dari rantai ----------
// Peristiwa yang dipakai sebagai titik berangkat perkiraan: fokus dan semua dampaknya.
function chainNodes(f, d) {
  const seen = new Set([f.id]);
  const list = [f];
  d.down.flat().forEach((n) => {
    if (n.event && !seen.has(n.event.id)) {
      seen.add(n.event.id);
      list.push(n.event);
    }
  });
  return list;
}

function chainForecastHtml(f, d) {
  const nodes = chainNodes(f, d);
  const hyps = nodes.flatMap((ev) => (ev.dampak || []).map((h) => ({ ev, h })));
  const options = nodes.map((ev) => `<option value="${ev.id}">${esc(ev.judul)}</option>`).join('');
  const sudah = (x) => (d.tercatat || []).some((t) => t.event_id === x.ev.id && t.teks === x.h.teks);
  return `
    <section class="section" id="chain-forecast">
      <div class="section-head"><h2>Perkiraan dari rantai ini</h2></div>
      <p class="lead">Lanjutkan rantainya: apa dampak berikutnya yang Anda perkirakan? Catat sekarang; perkiraan otomatis masuk kelompok sektornya di tab Perkiraan, dicek AI saat tanggal ceknya tiba, lalu Anda yang memutuskan.</p>
      ${hyps.length
        ? hyps.map((x, i) => `<div class="hyp">
            <p>${esc(x.h.teks)}</p>
            <p class="muted small">Hipotesis AI dari: ${esc(x.ev.judul)}, perkiraan dalam ±${x.h.hari} hari</p>
            ${state.owner ? hypBtn(sudah(x), `data-chyp="${i}"`) : ''}
          </div>`).join('')
        : '<p class="muted">AI belum memberi hipotesis dampak untuk peristiwa di rantai ini.</p>'}
      ${state.owner ? `
        <form id="own-fc" class="hyp" style="margin-top:16px">
          <h3>Tulis perkiraan sendiri</h3>
          <label for="fc-from">Berangkat dari peristiwa</label>
          <select id="fc-from" style="width:100%">${options}</select>
          <label for="fc-text">Perkiraan Anda</label>
          <textarea id="fc-text" rows="3" style="width:100%" placeholder="Contoh: harga BBM nonsubsidi naik dalam sebulan" required></textarea>
          <label for="fc-days">Dicek dalam</label>
          <select id="fc-days"><option value="7">7 hari</option><option value="14">14 hari</option><option value="30" selected>30 hari</option><option value="60">60 hari</option><option value="90">90 hari</option></select>
          <div class="row-end" style="justify-content:flex-start"><button type="submit" class="btn primary">Catat perkiraan</button></div>
        </form>` : ''}
    </section>`;
}

function bindChainForecast(f, d) {
  const nodes = chainNodes(f, d);
  const hyps = nodes.flatMap((ev) => (ev.dampak || []).map((h) => ({ ev, h })));
  view.querySelectorAll('[data-chyp]').forEach((b) => b.addEventListener('click', async () => {
    const x = hyps[Number(b.dataset.chyp)];
    await saveHyp(b, { event_id: x.ev.id, teks: x.h.teks, hari: x.h.hari });
  }));
  const form = $('#own-fc');
  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const teks = $('#fc-text').value.trim();
    if (!teks) return;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const r = await api('/api/forecasts', { method: 'POST', body: JSON.stringify({ event_id: Number($('#fc-from').value), teks, hari: Number($('#fc-days').value) }) });
      $('#fc-text').value = '';
      toast(r.sudah ? 'Perkiraan ini sudah ada di Perkiraan.' : 'Perkiraan dicatat. Lihat di tab Perkiraan.');
    } catch (err) {
      toast(err.message);
    }
    btn.disabled = false;
  });
}

// ---------- Sektor (6 kelompok) ----------
async function renderSektor() {
  const d = await api('/api/sectors?days=30');
  const max = Math.max(1, ...d.kelompok.map((s) => s.global + s.lokal));
  const rows = [...d.kelompok].sort((a, b) => Number(b.signal?.bergerak) - Number(a.signal?.bergerak) || b.global + b.lokal - (a.global + a.lokal));
  view.innerHTML = `
    <p class="lead">Enam kelompok sektor dalam 30 hari terakhir. Kolom "Pergerakan" menunjukkan kelompok mana yang sedang bergerak tidak biasa dan dari data apa; ini yang menentukan prioritas tinjauan.</p>
    <div class="legend small">${lvl('global')}${lvl('lokal')}</div>
    <table class="sector-table">
      <thead><tr><th scope="col">Kelompok</th><th scope="col">Global / lokal</th><th scope="col">Pergerakan</th></tr></thead>
      <tbody>${rows.map((s) => {
        const tot = s.global + s.lokal;
        const rinci = Object.entries(s.rinci).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ');
        const sig = s.signal;
        return `<tr class="${sig && sig.bergerak ? 'hot' : ''}">
          <td><button type="button" data-kelompok="${s.id}">${esc(s.nama)}</button>
            <div class="bar" style="width:${Math.max(8, (tot / max) * 100)}%"><span class="g" style="flex:${s.global}"></span><span class="l" style="flex:${s.lokal}"></span></div>
            ${rinci ? `<div class="muted small" style="margin-top:4px">${esc(rinci)}</div>` : ''}
            ${s.terbaru ? `<div class="small" style="margin-top:4px">Terbaru: ${esc(s.terbaru.judul)} <span class="muted">(${tgl(s.terbaru.tanggal)})</span></div>` : ''}</td>
          <td class="num">${s.global} / ${s.lokal}</td>
          <td>${sig ? `<span class="small">${sig.bergerak ? '<b>Bergerak</b> · ' : ''}${esc(sig.label)}</span><br><span class="muted small">dari ${METODE[sig.metode] || sig.metode}</span>` : ''}
            ${s.catatan ? `<br><span class="muted small">${esc(s.catatan)}</span>` : ''}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>
    ${d.lintas ? `<p class="muted small" style="margin-top:12px">${d.lintas} peristiwa hanya berlabel geopolitik atau iklim dan tidak masuk kelompok mana pun.</p>` : ''}`;
  view.querySelectorAll('[data-kelompok]').forEach((b) => b.addEventListener('click', () => {
    state.rantaiKel = b.dataset.kelompok;
    state.chainId = null;
    go('rantai');
  }));
}

// ---------- Perkiraan (dikelompokkan, dengan saran AI) ----------
const FC_LABEL = { perlu: 'Perlu keputusan', menunggu: 'Menunggu', terjadi: 'Terjadi', tidak: 'Tidak terjadi' };
const SARAN_LABEL = { terjadi: 'Sudah terjadi', tidak: 'Tidak terjadi', belum: 'Belum ada bukti yang cukup', gagal: 'Pengecekan gagal' };

function fcState(f) {
  return f.status === 'menunggu' ? (f.perlu ? 'perlu' : 'menunggu') : f.status;
}
function statusFc(f) {
  if (typeof f === 'string') return { menunggu: 'menunggu dicek', terjadi: 'terjadi', tidak: 'tidak terjadi' }[f] || f;
  const base = { perlu: 'perlu keputusan pemilik', menunggu: 'menunggu dicek', terjadi: 'terjadi', tidak: 'tidak terjadi' }[fcState(f)];
  return f.saran && f.status === 'menunggu' ? `${base} · saran AI: ${SARAN_LABEL[f.saran.status].toLowerCase()}` : base;
}
function fcMatch(f, filter) {
  if (filter === 'perlu') return f.perlu;
  if (filter === 'menunggu') return f.status === 'menunggu' && !f.perlu;
  if (filter === 'selesai') return f.status !== 'menunggu';
  return true;
}
function fcSort(a, b) {
  const rank = { perlu: 0, menunggu: 1, terjadi: 2, tidak: 2 };
  return rank[fcState(a)] - rank[fcState(b)]
    || (a.status === 'menunggu' ? a.tanggal_cek.localeCompare(b.tanggal_cek) : String(b.diputuskan_at || '').localeCompare(String(a.diputuskan_at || '')))
    || a.id - b.id;
}
const persen = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '–');

function buktiHtml(s) {
  const b = s.bukti || {};
  const berita = b.berita || [];
  const dipakai = new Set((b.dipakai || []).map(Number));
  const item = (a) => `<li><a href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener noreferrer">${esc(a.judul)}</a> <span class="src">${esc(a.sumber)}${a.tanggal ? ' · ' + tgl(a.tanggal) : ''}</span></li>`;
  const utama = berita.filter((_, i) => dipakai.has(i + 1));
  const lain = berita.filter((_, i) => !dipakai.has(i + 1));
  return `${(b.harga || []).length ? `<ul class="bukti harga">${b.harga.map((h) => `<li>📈 ${esc(h)}</li>`).join('')}</ul>` : ''}
    ${utama.length ? `<p class="small" style="margin-top:6px"><b>Bukti yang dipakai AI</b></p><ul class="bukti">${utama.map(item).join('')}</ul>` : ''}
    ${lain.length ? `<details class="small"><summary>${lain.length} berita lain yang ikut diperiksa</summary><ul class="bukti">${lain.map(item).join('')}</ul></details>` : ''}
    ${!berita.length && !(b.harga || []).length ? '<p class="muted small">Tidak ada berita atau data harga yang cocok sejak tanggal dasar.</p>' : ''}`;
}

function saranHtml(f) {
  if (f.antre) return '<div class="saran wait"><p>🤖 <b>Menunggu pengecekan AI.</b> Diproses paling lambat 5 menit lagi.</p></div>';
  const s = f.saran;
  if (!s) return '';
  const final = f.status !== 'menunggu';
  const conf = s.keyakinan != null && ['terjadi', 'tidak'].includes(s.status) ? ` · keyakinan ${Math.round(s.keyakinan * 100)}%` : '';
  const catatan = !final && ['terjadi', 'tidak'].includes(s.status)
    ? `<p class="muted small" style="margin-top:6px">${state.owner ? 'Saran ini belum final. Periksa buktinya (atau cek sendiri), lalu putuskan.' : 'Saran ini menunggu konfirmasi pemilik.'}</p>`
    : '';
  return `<details class="saran ${s.status}" ${final ? '' : 'open'}>
      <summary>🤖 <b>Saran AI: ${SARAN_LABEL[s.status] || s.status}</b>${conf} <span class="muted small">· dicek ${waktu(s.at)}</span></summary>
      ${s.alasan ? `<p class="small" style="margin-top:6px">${esc(s.alasan)}</p>` : ''}
      ${buktiHtml(s)}
      ${catatan}
    </details>`;
}

function keputusanHtml(f) {
  if (f.status === 'menunggu') return '';
  const s = f.saran && ['terjadi', 'tidak'].includes(f.saran.status) ? f.saran.status : null;
  const cara = f.diputuskan_dengan === 'saran-ai' ? 'menyetujui saran AI' : s ? (s === f.status ? 'cek manual, sama dengan saran AI' : 'cek manual, berbeda dari saran AI') : 'cek manual';
  return `<p class="muted small" style="margin-top:6px">Diputuskan pemilik${f.diputuskan_at ? ' ' + tgl(f.diputuskan_at.slice(0, 10)) : ''} · ${cara}${f.catatan ? ' · ' + esc(f.catatan) : ''}</p>`;
}

function fcActionsHtml(f) {
  const lawan = { terjadi: 'tidak', tidak: 'terjadi' };
  const btn = (cls, st, dengan, label) => `<button type="button" class="btn ${cls} small-btn" data-dec="${st}" data-dengan="${dengan}" data-id="${f.id}">${label}</button>`;
  const cek = `<a class="btn ghost small-btn" href="${esc(safeUrl(f.cari))}" target="_blank" rel="noopener noreferrer" title="Cari berita terkait di Google News, di tab baru">Cek sendiri ↗</a>`;
  const hapus = `<button type="button" class="btn ghost small-btn danger" data-del="${f.id}">Hapus</button>`;
  if (f.status !== 'menunggu') {
    return `<div class="fc-actions"><button type="button" class="btn ghost small-btn" data-dec="menunggu" data-dengan="" data-id="${f.id}">Batalkan keputusan</button>${hapus}</div>`;
  }
  const s = f.saran && ['terjadi', 'tidak'].includes(f.saran.status) ? f.saran.status : null;
  const putus = s
    ? btn('primary', s, 'saran-ai', `Setujui saran: ${FC_LABEL[s]}`) + btn(s === 'terjadi' ? 'no' : 'ok', lawan[s], 'manual', `Bukan, tandai ${FC_LABEL[lawan[s]].toLowerCase()}`)
    : btn('ok', 'terjadi', 'manual', 'Terjadi') + btn('no', 'tidak', 'manual', 'Tidak terjadi');
  const minta = f.antre ? '' : `<button type="button" class="btn ghost small-btn" data-cek="${f.id}">${f.saran ? 'Cek ulang dengan AI' : 'Minta saran AI'}</button>`;
  return `<div class="fc-actions">${putus}${minta}${cek}${hapus}</div>`;
}

function fcItemHtml(f) {
  const st = fcState(f);
  return `<article class="fc ${st}" id="fc-${f.id}">
    <div class="fc-top"><span class="fc-badge ${st}">${FC_LABEL[st]}</span><span class="muted small">dicek ${tgl(f.tanggal_cek)}</span></div>
    <p class="fc-text">${esc(f.teks)}</p>
    <p class="muted small" style="margin-top:4px">Dari: <button type="button" class="linklike plainbtn" data-open="${f.event_id}">${esc(f.event_judul)}</button>${f.event_tanggal ? ` (${tgl(f.event_tanggal)})` : ''}</p>
    ${saranHtml(f)}
    ${keputusanHtml(f)}
    ${state.owner ? fcActionsHtml(f) : ''}
  </article>`;
}

async function renderPerkiraan() {
  const d = await api('/api/forecasts');
  const r = d.ringkasan;
  const filter = state.fcFilter;
  const list = d.forecasts.filter((f) => fcMatch(f, filter));
  const groups = d.kelompok
    .map((k) => ({ ...k, all: d.forecasts.filter((f) => f.kelompok === k.id), items: list.filter((f) => f.kelompok === k.id).sort(fcSort) }))
    .filter((g) => g.items.length);
  const counts = { semua: r.total, perlu: r.perlu, menunggu: r.menunggu, selesai: r.selesai };
  const chip = (id, label) => `<button type="button" class="fchip" data-fcf="${id}" aria-pressed="${filter === id}">${label} <span class="muted">${counts[id]}</span></button>`;
  const groupHtml = (g) => {
    const perlu = g.all.filter((f) => f.perlu).length;
    const sel = g.all.filter((f) => f.status !== 'menunggu');
    const hit = sel.filter((f) => f.status === 'terjadi').length;
    const open = perlu || filter !== 'semua' || state.fcOpen.has(g.id) || groups.length === 1;
    return `<details class="fc-group" data-kel="${g.id}" ${open ? 'open' : ''}>
      <summary><span class="g-name">${esc(g.nama)}</span>
        <span class="g-meta">${g.all.length} perkiraan${perlu ? ` · <b class="g-hot">${perlu} perlu keputusan</b>` : ''}${sel.length ? ` · terbukti ${hit}/${sel.length}` : ''}</span></summary>
      <div class="g-body">${g.items.map(fcItemHtml).join('')}</div>
    </details>`;
  };
  view.innerHTML = `
    <p class="lead">Perkiraan dampak yang dicatat dari peristiwa, dikelompokkan otomatis menurut sektor yang dibicarakan. AI membantu mengecek apakah perkiraan sudah terjadi, tetapi keputusan akhir selalu di tangan pemilik.</p>
    <div class="fc-summary">
      <div class="stat"><span class="num">${persen(r.terjadi, r.selesai)}</span><span>ketepatan · ${r.terjadi} dari ${r.selesai} terbukti</span></div>
      <div class="stat"><span class="num">${r.banding ? `${r.sepakat}/${r.banding}` : '–'}</span><span>AI sependapat dengan keputusan pemilik</span></div>
      <div class="stat${r.perlu ? ' hot' : ''}"><span class="num">${r.perlu}</span><span>perlu keputusan</span></div>
      <div class="stat"><span class="num">${r.menunggu}</span><span>menunggu tanggal cek</span></div>
    </div>
    <div class="fchips" role="group" aria-label="Saring perkiraan">${chip('semua', 'Semua')}${chip('perlu', 'Perlu keputusan')}${chip('menunggu', 'Menunggu')}${chip('selesai', 'Selesai')}</div>
    ${groups.length ? groups.map(groupHtml).join('') : `<div class="empty"><strong>${filter === 'semua' ? 'Belum ada perkiraan.' : 'Tidak ada perkiraan di saringan ini.'}</strong>${filter === 'semua' ? (state.owner ? 'Buka tab Rantai, pilih satu peristiwa, lalu catat perkiraan di bagian "Perkiraan dari rantai ini".' : 'Perkiraan muncul setelah pemilik mencatatnya.') : 'Pilih "Semua" untuk melihat seluruh perkiraan.'}</div>`}`;

  view.querySelectorAll('[data-fcf]').forEach((b) => b.addEventListener('click', () => { state.fcFilter = b.dataset.fcf; go('perkiraan'); }));
  view.querySelectorAll('.fc-group').forEach((el) => el.addEventListener('toggle', () => {
    if (el.open) state.fcOpen.add(el.dataset.kel);
    else state.fcOpen.delete(el.dataset.kel);
  }));
  view.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openEvent(Number(b.dataset.open))));
  view.querySelectorAll('[data-dec]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await api(`/api/forecasts/${b.dataset.id}`, { method: 'POST', body: JSON.stringify({ status: b.dataset.dec, dengan: b.dataset.dengan }) });
      toast({ terjadi: 'Ditandai terjadi.', tidak: 'Ditandai tidak terjadi.', menunggu: 'Keputusan dibatalkan.' }[b.dataset.dec]);
      await loadStatus();
      go('perkiraan');
    } catch (e) {
      b.disabled = false;
      toast(e.message);
    }
  }));
  view.querySelectorAll('[data-cek]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await api(`/api/forecasts/${b.dataset.cek}/cek`, { method: 'POST' });
      toast('Masuk antrean pengecekan AI (paling lambat 5 menit).');
      go('perkiraan');
    } catch (e) {
      b.disabled = false;
      toast(e.message);
    }
  }));
  view.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Hapus perkiraan ini? Tindakan ini tidak bisa dibatalkan.')) return;
    b.disabled = true;
    try {
      await api(`/api/forecasts/${b.dataset.del}/hapus`, { method: 'POST' });
      toast('Perkiraan dihapus.');
      await loadStatus();
      go('perkiraan');
    } catch (e) {
      b.disabled = false;
      toast(e.message);
    }
  }));
}

// ---------- Panduan ----------
function renderPanduan() {
  keep('panduan-dilihat', '1');
  const mode = state.guideMode || (state.owner ? 'pemilik' : 'pengunjung');
  const st = state.status;
  const src = st.sumber || {};
  const tab = (id, label) => `<button type="button" data-guide="${id}" aria-pressed="${mode === id}">${label}</button>`;
  view.innerHTML = `
    <section class="guide">
      <h2>Panduan</h2>
      <p class="lead" style="margin-top:8px">Aplikasi ini adalah <b>peta sebab-akibat</b>: ia menunjukkan bagaimana satu kejadian, misalnya konflik di jalur kapal minyak, merambat menjadi kejadian lain sampai ke Indonesia, misalnya harga BBM atau nilai rupiah. Ini alat bantu berpikir, <b>bukan saran beli atau jual</b>.</p>
      <div class="seg" role="group" aria-label="Pilih panduan">${tab('pengunjung', 'Untuk pengunjung (tanpa PIN)')}${tab('pemilik', 'Untuk pemilik (dengan PIN)')}</div>
      <div class="guide-body">${mode === 'pemilik' ? panduanPemilik() : panduanPengunjung(src, st.sejak)}</div>
    </section>`;
  view.querySelectorAll('[data-guide]').forEach((b) => b.addEventListener('click', () => { state.guideMode = b.dataset.guide; renderPanduan(); }));
  view.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => go(b.dataset.goto)));
  return Promise.resolve();
}

function panduanPengunjung(src, sejak) {
  const goto = (tab, label) => `<button type="button" class="linklike plainbtn" data-goto="${tab}">${label}</button>`;
  return `
    <div class="guide-card">
      <h3>Mulai dalam 3 langkah</h3>
      <ol class="steps">
        <li>Buka ${goto('rantai', '<b>Rantai</b>')}. Setiap kartu adalah satu rantai: baris paling atas adalah <b>penyebab paling awal</b>, baris di bawahnya adalah akibatnya. Klik kartu untuk melihat rantai lengkapnya.</li>
        <li>Di layar rantai, klik <b>Sumber dan detail</b> untuk membaca berita aslinya. Setiap peristiwa punya tautan ke media sumbernya, jadi Anda bisa memeriksanya sendiri.</li>
        <li>Buka ${goto('perkiraan', '<b>Perkiraan</b>')} untuk melihat apa yang diperkirakan terjadi berikutnya, dan mana yang sudah terbukti.</li>
      </ol>
    </div>
    <div class="guide-card">
      <h3>Arti tanda-tanda</h3>
      <dl class="legend-list">
        <dt>${lvl('global')} / ${lvl('lokal')}</dt><dd>Kejadian di luar Indonesia (global) atau di Indonesia (lokal).</dd>
        <dt>menyebabkan</dt><dd>Kejadian pertama menimbulkan kejadian berikutnya.</dd>
        <dt>memperkuat</dt><dd>Kejadian pertama membuat kejadian berikutnya makin besar.</dd>
        <dt>meredam</dt><dd>Kejadian pertama mengurangi dampak kejadian berikutnya.</dd>
        <dt>memicu respons</dt><dd>Kejadian pertama membuat pihak lain bereaksi, misalnya pemerintah atau bank sentral mengambil kebijakan.</dd>
        <dt><span class="chip kel">Energi</span></dt><dd>Kelompok sektor yang terdampak. Ada 6 kelompok: Pangan & Agribisnis, Energi, Tambang & Mineral, Industri & Konsumsi, Keuangan & Moneter, Perdagangan & Logistik.</dd>
        <dt><span class="chip sisi">⚖️ Sudut berbeda</span></dt><dd>Media Indonesia dan media internasional menyoroti hal yang berbeda dari kejadian yang sama.</dd>
        <dt>Bergerak</dt><dd>Kelompok sektor yang hari ini bergerak tidak seperti biasanya, dilihat dari harga atau lonjakan berita.</dd>
        <dt>🤖 Saran AI</dt><dd>Hasil pengecekan otomatis apakah sebuah perkiraan sudah terjadi. Belum final sampai pemilik memutuskan.</dd>
      </dl>
    </div>
    <div class="guide-card">
      <h3>Isi setiap menu</h3>
      <dl class="legend-list">
        <dt>${goto('rantai', 'Rantai')}</dt><dd>Layar utama. Rantai sebab-akibat yang sudah diperiksa pemilik. Bisa disaring per kelompok sektor.</dd>
        <dt>${goto('linimasa', 'Linimasa')}</dt><dd>Semua peristiwa per tanggal, termasuk yang belum masuk rantai. Bisa dicari, misalnya "minyak".</dd>
        <dt>${goto('sektor', 'Sektor')}</dt><dd>Ringkasan 6 kelompok sektor dalam 30 hari terakhir, dan kelompok mana yang sedang bergerak.</dd>
        <dt>${goto('perkiraan', 'Perkiraan')}</dt><dd>Perkiraan dampak, dikelompokkan per sektor. Pakai saringan "Perlu keputusan", "Menunggu", atau "Selesai". Angka ketepatan menunjukkan berapa perkiraan yang terbukti.</dd>
      </dl>
    </div>
    <div class="guide-card">
      <h3>Yang perlu diketahui</h3>
      <ul class="steps">
        <li>Anda hanya bisa melihat. Tidak ada tombol yang bisa mengubah data, jadi silakan klik apa saja.</li>
        <li>Data diperbarui otomatis setiap hari pukul 17.30 WIB.</li>
        <li>Peristiwa disusun AI dari judul berita, jadi bisa keliru. Selalu cek sumber aslinya.</li>
        <li>Kaitan sebab-akibat baru tampil di Rantai setelah disetujui pemilik.</li>
        <li>Bila halaman tidak terbuka dari jaringan tertentu, aktifkan DNS Cloudflare 1.1.1.1 di perangkat Anda.</li>
      </ul>
    </div>
    <div class="guide-card">
      <h3>Istilah singkat</h3>
      <dl class="legend-list">
        <dt>BI Rate</dt><dd>Suku bunga acuan Bank Indonesia. Naik-turunnya memengaruhi bunga kredit dan nilai rupiah.</dd>
        <dt>The Fed</dt><dd>Bank sentral Amerika Serikat. Kebijakannya memengaruhi arus dana ke negara berkembang, termasuk Indonesia.</dd>
        <dt>Brent</dt><dd>Harga minyak mentah acuan dunia.</dd>
        <dt>IHSG</dt><dd>Indeks harga saham gabungan di Bursa Efek Indonesia.</dd>
        <dt>USD/IDR</dt><dd>Kurs rupiah terhadap dolar AS. Angka naik berarti rupiah melemah.</dd>
        <dt>Inflasi</dt><dd>Kenaikan harga barang dan jasa secara umum.</dd>
      </dl>
    </div>
    <div class="guide-card">
      <h3>Dari mana datanya</h3>
      <ul class="steps">
        ${sejak ? `<li><b>Cakupan:</b> peristiwa tercatat sejak ${tgl(sejak)} dan diperbarui setiap hari pukul 17.30 WIB.</li>` : ''}
        <li><b>Berita:</b> ${src.rss_lokal || 0} feed media Indonesia dan ${src.rss_internasional || 0} feed media internasional (${esc((src.media_rss || []).join(', '))}), ditambah ${(src.topik_id || 0) + (src.topik_en || 0)} topik pencarian Google News yang menjangkau puluhan media lain.</li>
        <li><b>Harga:</b> ${(src.harga || []).map((h) => `${esc(h.nama)} (${esc(h.sumber)})`).join('; ')}. Harga hanya dipakai di belakang layar untuk menentukan sektor yang bergerak dan sebagai bukti perkiraan.</li>
        <li><b>AI:</b> Cloudflare Workers AI (kuota gratis) menyusun peristiwa, mengusulkan kaitan, dan memberi saran pengecekan perkiraan.</li>
      </ul>
    </div>`;
}

function panduanPemilik() {
  const goto = (tab, label) => `<button type="button" class="linklike plainbtn" data-goto="${tab}">${label}</button>`;
  return `
    <div class="guide-card">
      <h3>Masuk dan keluar</h3>
      <ul class="steps">
        <li>Klik <b>Masuk sebagai pemilik</b> di kanan atas, lalu masukkan PIN. Menu ${goto('tinjau', '<b>Tinjau</b>')} akan muncul.</li>
        <li>PIN hanya diingat selama tab browser terbuka. Klik <b>Keluar dari mode pemilik</b> bila memakai perangkat bersama.</li>
        <li>Jangan bagikan PIN. Penguji cukup membuka aplikasi tanpa PIN.</li>
      </ul>
    </div>
    <div class="guide-card">
      <h3>Rutinitas malam (± 10 menit)</h3>
      <ol class="steps">
        <li>Buka ${goto('tinjau', '<b>Tinjau</b>')}. Angka di samping tulisan Tinjau adalah jumlah usulan yang menunggu.</li>
        <li>Untuk setiap usulan kaitan, baca alasannya dan "mengapa diprioritaskan". Bila ragu, klik judul peristiwa untuk membaca beritanya. Lalu pilih <b>Setujui</b> (masuk ke Rantai) atau <b>Tolak</b>. Maksimal 15 keputusan per malam; usulan lain tidak hilang dan ikut bersaing besok. Usulan yang sebabnya dari tanggal jauh sebelumnya ditandai "Sebab dari N hari sebelumnya".</li>
        <li>Di bagian "Peristiwa dari pembaruan terakhir", klik <b>Arsipkan</b> untuk peristiwa yang tidak relevan agar tidak ikut dikaitkan.</li>
        <li>Buka ${goto('perkiraan', '<b>Perkiraan</b>')} dan pilih saringan <b>Perlu keputusan</b> (angka di samping tulisan Perkiraan). Baca saran AI dan buktinya, lalu putuskan.</li>
      </ol>
    </div>
    <div class="guide-card">
      <h3>Mencatat perkiraan</h3>
      <ul class="steps">
        <li>Dari ${goto('rantai', 'Rantai')}: buka satu rantai, lalu di bagian "Perkiraan dari rantai ini" klik <b>Catat sebagai perkiraan</b> pada hipotesis AI, atau tulis perkiraan Anda sendiri beserta jangka waktu ceknya.</li>
        <li>Bisa juga dari panel detail peristiwa (klik judul peristiwa di mana saja).</li>
        <li>Perkiraan <b>otomatis masuk kelompok sektornya</b> berdasarkan isi kalimatnya, misalnya perkiraan tentang rupiah masuk Keuangan & Moneter. Perkiraan yang sama tidak akan tercatat dua kali.</li>
        <li>Perkiraan yang salah ketik bisa dihapus lewat tombol <b>Hapus</b>.</li>
      </ul>
    </div>
    <div class="guide-card">
      <h3>Pengecekan perkiraan semi-otomatis</h3>
      <ol class="steps">
        <li><b>AI mengumpulkan bukti:</b> berita yang sudah tersimpan, pencarian Google News sejak tanggal peristiwa, dan perubahan harga terkait (kurs, emas, Brent).</li>
        <li><b>AI memberi saran:</b> "sudah terjadi", "tidak terjadi", atau "belum ada bukti yang cukup", lengkap dengan alasan dan tautan buktinya. AI tidak pernah mengubah status perkiraan sendiri.</li>
        <li><b>Anda mengecek paralel:</b> buka tautan bukti, atau klik <b>Cek sendiri ↗</b> untuk mencari berita terkait di Google News.</li>
        <li><b>Anda memutuskan:</b> klik <b>Setujui saran</b> bila setuju, atau tandai sebaliknya bila tidak. Keputusan bisa dibatalkan. Angka "AI sependapat" menunjukkan seberapa sering saran AI cocok dengan keputusan Anda.</li>
      </ol>
      <p class="muted small" style="margin-top:8px">Kapan AI mengecek: otomatis saat tanggal cek tiba, seminggu sekali untuk perkiraan lain (siapa tahu sudah terjadi lebih awal), atau kapan saja lewat tombol <b>Minta saran AI</b>. Pengecekan berjalan di latar belakang tiap ±5 menit.</p>
    </div>
    <div class="guide-card">
      <h3>Tombol lain di Tinjau</h3>
      <dl class="legend-list">
        <dt>Ambil berita sekarang</dt><dd>Pembaruan di luar jadwal 17.30 WIB. Masuk antrean dan diproses paling lambat 5 menit kemudian.</dd>
        <dt>Cek sumber berita</dt><dd>Memeriksa setiap media dan topik: berapa judul yang didapat dan mana yang gagal. Tidak memakai kuota AI.</dd>
        <dt>Cari kaitan terbesar</dt><dd>AI memindai semua peristiwa (bukan hanya yang baru) untuk mencari kaitan sebab-akibat terkuat yang belum tercatat, termasuk sebab dari beberapa minggu sebelumnya. Berjalan otomatis sekali sehari; tombol <b>Cari sekarang</b> untuk menjalankannya kapan saja. Hasilnya masuk daftar tinjauan.</dd>
        <dt>Ambil berita tanggal lampau</dt><dd>Untuk tanggal yang terlewat, mis. saat pembaruan gagal. Pilih tanggal mulai (paling jauh 60 hari); berita diambil dari arsip Google News dan diproses seperti pembaruan biasa.</dd>
        <dt>Usulan kaitan lain</dt><dd>Usulan di luar antrean malam tampil sebagai daftar centang. Yang keyakinan AI-nya tinggi sudah tercentang; hapus centang yang tidak cocok, lalu klik <b>Setujui</b> sekali. Kaitan yang disetujui langsung masuk ke Rantai.</dd>
      </dl>
    </div>
    <div class="guide-card">
      <h3>Batas yang perlu diingat</h3>
      <ul class="steps">
        <li>Kuota AI gratis: ${st_ai()} panggilan per hari. Pengambilan berita tanggal lampau dan pengecekan perkiraan otomatis berhenti lebih dulu agar pembaruan harian tetap berjalan; sisanya dilanjutkan besok.</li>
        <li>Pengunjung tidak bisa mengubah apa pun; semua tombol pemilik membutuhkan PIN.</li>
      </ul>
    </div>`;
}
function st_ai() {
  return state.status?.aiLimit || 40;
}

// ---------- Mulai ----------
(async function start() {
  state.pin = load('pin');
  try {
    await loadStatus();
  } catch (e) {
    view.innerHTML = `<div class="empty"><strong>Tidak bisa terhubung ke server.</strong>${esc(e.message)}</div>`;
    return;
  }
  const h = location.hash.replace('#', '');
  const [tab, id] = h.split('/');
  if (tab === 'rantai' && id) state.chainId = Number(id);
  const valid = ['tinjau', 'linimasa', 'rantai', 'sektor', 'perkiraan', 'panduan'];
  go(valid.includes(tab) ? tab : 'rantai');
})();
