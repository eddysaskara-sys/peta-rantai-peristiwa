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
  const fn = { tinjau: renderTinjau, linimasa: renderLinimasa, rantai: renderRantai, sektor: renderSektor, perkiraan: renderPerkiraan }[tab];
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
      <p class="lead">Maksimal ${d.maks} usulan per malam, diurutkan menurut prioritas: berdampak ke Indonesia, menyambung rantai lama, dan sektor yang sedang bergerak tidak biasa. Usulan lain tidak hilang; besok ikut bersaing lagi.</p>
      <div id="proposals">${proposalsBody(d)}</div>
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
    </section>

    <section class="section">
      <div class="section-head"><h2>Peristiwa dari pembaruan terakhir</h2><span class="muted small">${d.fresh.length} peristiwa</span></div>
      <p class="lead">Arsipkan peristiwa yang tidak relevan agar tidak ikut dikaitkan.</p>
      <div id="fresh">${d.fresh.length ? d.fresh.map((e) => freshHtml(e)).join('') : '<div class="empty">Belum ada peristiwa.</div>'}</div>
    </section>`;

  state.review = d;
  $('#run-btn').addEventListener('click', runNow);
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

function proposalHtml(p) {
  const endBtn = (id, judul) => `<button class="linklike plainbtn" type="button" data-open="${id}">${esc(judul)}</button>`;
  const sisi = (txt) => (txt ? ' <span class="chip sisi" title="Media Indonesia dan internasional menyorot sudut berbeda">⚖️</span>' : '');
  return `<article class="proposal" id="p-${p.id}">
    <div class="prio"><span class="prio-score" aria-label="Prioritas ${p.skor} dari 3">Prioritas ${p.skor}/3</span>
      ${(p.kelompok_nama || []).map((k) => `<span class="chip kel">${esc(k)}</span>`).join('')}</div>
    <div class="pair">
      <div class="end">${lvl(p.dari_tingkat)} <span class="muted small">${tgl(p.dari_tanggal)}</span>${sisi(p.dari_dua_sisi)}<br>${endBtn(p.dari_id, p.dari_judul)}</div>
      <div class="arrow"><span aria-hidden="true">↓</span>${esc(p.jenis)}</div>
      <div class="end">${lvl(p.ke_tingkat)} <span class="muted small">${tgl(p.ke_tanggal)}</span>${sisi(p.ke_dua_sisi)}<br>${endBtn(p.ke_id, p.ke_judul)}</div>
    </div>
    <p class="reason">${esc(p.alasan)}</p>
    ${p.alasan_prioritas && p.alasan_prioritas.length
      ? `<ul class="why">${p.alasan_prioritas.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`
      : '<p class="why-none muted small">Tidak memenuhi kriteria prioritas; tampil karena slot malam ini masih ada.</p>'}
    <div class="proposal-actions">
      <span class="conf">Keyakinan AI ${Math.round((p.keyakinan || 0) * 100)}%</span>
      <span style="display:flex;gap:8px">
        <button class="btn no" type="button" data-link-action="ditolak" data-id="${p.id}">Tolak</button>
        <button class="btn ok" type="button" data-link-action="disetujui" data-id="${p.id}">Setujui</button>
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
        ${e.dampak.map((h, i) => `<div class="hyp"><p>${esc(h.teks)}</p><p class="muted small">Perkiraan dalam ±${h.hari} hari</p>${state.owner ? `<button type="button" class="btn ghost small-btn" data-hyp="${i}" style="margin-top:6px">Catat sebagai perkiraan</button>` : ''}</div>`).join('')}</div>` : ''}
      ${d.forecasts.length ? `<div class="detail-block"><h3>Perkiraan tercatat</h3>${d.forecasts.map((f) => `<div class="hyp"><p>${esc(f.teks)}</p><p class="muted small">Dicek ${tgl(f.tanggal_cek)} · ${statusFc(f.status)}</p></div>`).join('')}</div>` : ''}
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
      b.disabled = true;
      await api('/api/forecasts', { method: 'POST', body: JSON.stringify({ event_id: id, teks: h.teks, hari: h.hari }) });
      b.textContent = 'Tercatat di Perkiraan';
      toast('Perkiraan dicatat.');
    }));
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
  view.innerHTML = `
    ${banner}
    <div class="section-head"><h2>Rantai sebab-akibat</h2><span class="muted small">${d.total} rantai · 90 hari terakhir</span></div>
    <p class="lead">Setiap rantai berawal dari penyebab paling awal. Pilih satu untuk melihat seluruh perambatannya.</p>
    <div class="fchips" role="group" aria-label="Saring per kelompok sektor">${kelBtn('', 'Semua')}${st.kelompok.map((k) => kelBtn(k.id, k.nama)).join('')}</div>
    <div class="chains">${d.chains.length ? d.chains.map(chainCardHtml).join('') : emptyChains(kel)}</div>
    ${pulseHtml(st.signals, false)}`;
  const gt = $('#go-tinjau');
  if (gt) gt.addEventListener('click', () => go('tinjau'));
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
  return `
    <section class="section" id="chain-forecast">
      <div class="section-head"><h2>Perkiraan dari rantai ini</h2></div>
      <p class="lead">Lanjutkan rantainya: apa dampak berikutnya yang Anda perkirakan? Catat sekarang, lalu tandai terjadi atau tidak di tab Perkiraan saat tanggal ceknya tiba.</p>
      ${hyps.length
        ? hyps.map((x, i) => `<div class="hyp">
            <p>${esc(x.h.teks)}</p>
            <p class="muted small">Hipotesis AI dari: ${esc(x.ev.judul)}, perkiraan dalam ±${x.h.hari} hari</p>
            ${state.owner ? `<button type="button" class="btn ghost small-btn" data-chyp="${i}" style="margin-top:6px">Catat sebagai perkiraan</button>` : ''}
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
    b.disabled = true;
    try {
      await api('/api/forecasts', { method: 'POST', body: JSON.stringify({ event_id: x.ev.id, teks: x.h.teks, hari: x.h.hari }) });
      b.textContent = 'Tercatat di Perkiraan';
      toast('Perkiraan dicatat.');
    } catch (e) {
      b.disabled = false;
      toast(e.message);
    }
  }));
  const form = $('#own-fc');
  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const teks = $('#fc-text').value.trim();
    if (!teks) return;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await api('/api/forecasts', { method: 'POST', body: JSON.stringify({ event_id: Number($('#fc-from').value), teks, hari: Number($('#fc-days').value) }) });
      $('#fc-text').value = '';
      toast('Perkiraan dicatat. Lihat di tab Perkiraan.');
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

// ---------- Perkiraan ----------
function statusFc(s) {
  return { menunggu: 'menunggu dicek', terjadi: 'terjadi', tidak: 'tidak terjadi' }[s] || s;
}

async function renderPerkiraan() {
  const d = await api('/api/forecasts');
  const today = d.today;
  const due = d.forecasts.filter((f) => f.status === 'menunggu' && f.tanggal_cek <= today);
  const wait = d.forecasts.filter((f) => f.status === 'menunggu' && f.tanggal_cek > today);
  const done = d.forecasts.filter((f) => f.status !== 'menunggu');
  const hit = done.filter((f) => f.status === 'terjadi').length;
  const fc = (f, isDue) => `<div class="fc ${isDue ? 'due' : ''}">
      <p>${esc(f.teks)}</p>
      <p class="muted small" style="margin-top:4px">Dari: <button type="button" data-open="${f.event_id}" style="background:none;border:0;padding:0;color:inherit;font:inherit;cursor:pointer;text-decoration:underline">${esc(f.event_judul)}</button> · dicek ${tgl(f.tanggal_cek)} · ${statusFc(f.status)}</p>
      ${state.owner && f.status === 'menunggu' ? `<div class="fc-actions"><button type="button" class="btn ok small-btn" data-fc="${f.id}" data-st="terjadi">Terjadi</button><button type="button" class="btn no small-btn" data-fc="${f.id}" data-st="tidak">Tidak terjadi</button></div>` : ''}
    </div>`;
  view.innerHTML = `
    <p class="lead">Perkiraan dampak yang dicatat dari peristiwa. Saat tanggal ceknya tiba, tandai terjadi atau tidak untuk melihat seberapa tepat penalaran kita.</p>
    <section class="section">
      <div class="section-head"><h2>Ketepatan</h2></div>
      ${done.length ? `<p><span class="score">${Math.round((hit / done.length) * 100)}%</span> <span class="muted">${hit} dari ${done.length} perkiraan terbukti</span></p>` : '<p class="muted">Belum ada perkiraan yang selesai dicek.</p>'}
    </section>
    <section class="section"><div class="section-head"><h2>Waktunya dicek</h2><span class="muted small">${due.length}</span></div>
      ${due.length ? due.map((f) => fc(f, true)).join('') : '<p class="muted">Tidak ada yang jatuh tempo.</p>'}</section>
    <section class="section"><div class="section-head"><h2>Menunggu</h2><span class="muted small">${wait.length}</span></div>
      ${wait.length ? wait.map((f) => fc(f)).join('') : `<p class="muted">${state.owner ? 'Buka tab Rantai, pilih satu peristiwa, lalu catat perkiraan di bagian "Perkiraan dari rantai ini". Bisa juga dari panel detail peristiwa.' : 'Belum ada perkiraan.'}</p>`}</section>
    ${done.length ? `<section class="section"><div class="section-head"><h2>Selesai</h2></div>${done.map((f) => fc(f)).join('')}</section>` : ''}`;
  view.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openEvent(Number(b.dataset.open))));
  view.querySelectorAll('[data-fc]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    await api(`/api/forecasts/${b.dataset.fc}`, { method: 'POST', body: JSON.stringify({ status: b.dataset.st }) });
    toast(b.dataset.st === 'terjadi' ? 'Ditandai terjadi.' : 'Ditandai tidak terjadi.');
    go('perkiraan');
  }));
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
  const valid = ['tinjau', 'linimasa', 'rantai', 'sektor', 'perkiraan'];
  go(valid.includes(tab) ? tab : 'rantai');
})();
