'use strict';

const state = {
  pin: '',
  owner: false,
  status: null,
  tab: 'linimasa',
  chainId: null,
  withUsulan: false,
  filters: { tingkat: '', sektor: '', q: '', days: 30 },
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
function chips(list) {
  return list && list.length ? `<div class="chips">${list.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>` : '';
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
  const pending = state.status.counts?.links_pending || 0;
  const badge = $('#badge');
  badge.hidden = !(state.owner && pending);
  badge.textContent = pending;
}

$('#owner-btn').addEventListener('click', () => {
  if (state.owner) {
    state.pin = '';
    store('pin', '');
    loadStatus().then(() => go(state.tab === 'tinjau' ? 'linimasa' : state.tab));
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
  go('tinjau');
  toast('Mode pemilik aktif.');
});

// ---------- Navigasi ----------
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));

function go(tab, opts = {}) {
  if (tab === 'tinjau' && !state.owner) tab = 'linimasa';
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
      <div class="section-head"><h2>Usulan kaitan dari AI</h2><span class="muted small">${d.pending.length} menunggu keputusan Anda</span></div>
      <p class="lead">AI hanya mengusulkan. Kaitan baru muncul di Rantai dan terlihat penguji setelah Anda setujui.</p>
      <div id="proposals">${d.pending.length ? d.pending.map(proposalHtml).join('') : '<div class="empty"><strong>Tidak ada usulan yang menunggu.</strong>Usulan baru muncul setelah pembaruan berikutnya.</div>'}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Peristiwa dari pembaruan terakhir</h2><span class="muted small">${d.fresh.length} peristiwa</span></div>
      <p class="lead">Arsipkan peristiwa yang tidak relevan agar tidak ikut dikaitkan.</p>
      <div id="fresh">${d.fresh.length ? d.fresh.map((e) => freshHtml(e)).join('') : '<div class="empty">Belum ada peristiwa.</div>'}</div>
    </section>`;

  $('#run-btn').addEventListener('click', runNow);
  if (run && (run.status === 'antre' || run.status === 'berjalan')) waitForRun(run.id);
  view.querySelectorAll('[data-link-action]').forEach((b) => b.addEventListener('click', decideLink));
  view.querySelectorAll('[data-archive]').forEach((b) => b.addEventListener('click', archiveEvent));
  view.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openEvent(Number(b.dataset.open))));
}

function proposalHtml(p) {
  return `<article class="proposal" id="p-${p.id}">
    <div class="pair">
      <div class="end">${lvl(p.dari_tingkat)} <span class="muted small">${tgl(p.dari_tanggal)}</span><br><button class="linklike" style="background:none;border:0;padding:0;color:inherit;font:inherit;text-align:left;cursor:pointer" data-open="${p.dari_id}">${esc(p.dari_judul)}</button></div>
      <div class="arrow"><span aria-hidden="true">↓</span>${esc(p.jenis)}</div>
      <div class="end">${lvl(p.ke_tingkat)} <span class="muted small">${tgl(p.ke_tanggal)}</span><br><button class="linklike" style="background:none;border:0;padding:0;color:inherit;font:inherit;text-align:left;cursor:pointer" data-open="${p.ke_id}">${esc(p.ke_judul)}</button></div>
    </div>
    <p class="reason">${esc(p.alasan)}</p>
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
      ${chips(e.sektor)}
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
    toast(status === 'disetujui' ? 'Kaitan disetujui.' : 'Kaitan ditolak.');
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

// ---------- Linimasa ----------
async function renderLinimasa() {
  const f = state.filters;
  const s = state.status;
  const qs = new URLSearchParams({ days: f.days });
  if (f.tingkat) qs.set('tingkat', f.tingkat);
  if (f.sektor) qs.set('sektor', f.sektor);
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
      <select id="f-sektor" aria-label="Sektor"><option value="">Semua sektor</option>${s.sektor.map((x) => `<option ${x === f.sektor ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <select id="f-days" aria-label="Rentang waktu">${[7, 30, 90, 365].map((n) => `<option value="${n}" ${n === f.days ? 'selected' : ''}>${n === 365 ? '1 tahun' : n + ' hari'}</option>`).join('')}</select>
      <input type="search" id="f-q" placeholder="Cari peristiwa, mis. minyak" value="${esc(f.q)}" aria-label="Cari">
    </div>
    ${d.events.length ? [...groups].map(([day, evs]) => `
      <section class="day">
        <h2 class="day-label">${tgl(day, true)}</h2>
        ${evs.map(evHtml).join('')}
      </section>`).join('') : emptyTimeline()}`;

  view.querySelectorAll('[data-tingkat]').forEach((b) => b.addEventListener('click', () => { f.tingkat = b.dataset.tingkat; go('linimasa'); }));
  $('#f-sektor').addEventListener('change', (e) => { f.sektor = e.target.value; go('linimasa'); });
  $('#f-days').addEventListener('change', (e) => { f.days = Number(e.target.value); go('linimasa'); });
  let t;
  $('#f-q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value.trim(); go('linimasa'); setTimeout(() => { const i = $('#f-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 50); }, 400); });
  view.querySelectorAll('.ev[data-id]').forEach((el) => el.addEventListener('click', () => openEvent(Number(el.dataset.id))));
}

function emptyTimeline() {
  const f = state.filters;
  if (f.tingkat || f.sektor || f.q) return '<div class="empty"><strong>Tidak ada peristiwa yang cocok.</strong>Longgarkan filter atau perpanjang rentang waktu.</div>';
  return state.owner
    ? '<div class="empty"><strong>Belum ada peristiwa.</strong>Buka Tinjau lalu pilih "Ambil berita sekarang".</div>'
    : '<div class="empty"><strong>Belum ada peristiwa.</strong>Data muncul setelah pembaruan harian pukul 17.30 WIB.</div>';
}

function evHtml(e) {
  return `<button type="button" class="ev ${e.tingkat}" data-id="${e.id}">
    <div>
      <div class="ev-title">${esc(e.judul)}</div>
      <div class="ev-meta">${lvl(e.tingkat)}<span>${e.n_kaitan ? `${e.n_kaitan} kaitan` : 'belum ada kaitan'}</span><span>${e.n_sumber || 0} sumber</span></div>
      ${chips([...(e.sektor || []), ...(e.indikator || [])])}
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
      ${chips([...e.sektor, ...e.indikator])}
      <p style="margin-top:12px">${esc(e.ringkasan)}</p>
      <div class="row-end" style="justify-content:flex-start"><button type="button" class="btn primary" id="see-chain">Lihat rantainya</button>
      ${state.owner ? `<button type="button" class="btn ghost" id="archive-ev">${e.status === 'diarsip' ? 'Aktifkan lagi' : 'Arsipkan'}</button>` : ''}</div>
      ${e.dua_sisi ? `<div class="detail-block"><h3>Dua sisi pemberitaan</h3><p>${esc(e.dua_sisi)}</p></div>` : ''}
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
  if (!state.chainId) {
    const d = await api('/api/events?days=90');
    const linked = d.events.filter((e) => e.n_kaitan > 0).sort((a, b) => b.n_kaitan - a.n_kaitan).slice(0, 12);
    view.innerHTML = `
      <p class="lead">Pilih satu peristiwa untuk melihat apa penyebabnya dan ke mana dampaknya merambat.</p>
      ${linked.length ? `<h2 style="margin-bottom:12px">Peristiwa dengan kaitan terbanyak</h2>${linked.map(evHtml).join('')}` : '<div class="empty"><strong>Belum ada kaitan yang disetujui.</strong>Rantai terbentuk setelah usulan kaitan dari AI disetujui pemilik. Sementara itu, buka peristiwa mana pun dari Linimasa.</div>'}`;
    view.querySelectorAll('.ev[data-id]').forEach((el) => el.addEventListener('click', () => go('rantai', { chainId: Number(el.dataset.id) })));
    return;
  }
  const qs = state.withUsulan ? '?usulan=1' : '';
  const d = await api(`/api/chain/${state.chainId}${qs}`);
  const f = d.focus;
  const stop = (n) => n.event ? `<div class="stop ${n.event.tingkat}">
      <div class="stop-card">
        <button type="button" class="linklike" data-chain="${n.event.id}">${esc(n.event.judul)}</button>
        <div class="ev-meta">${lvl(n.event.tingkat)}<span>${tgl(n.event.tanggal)}</span></div>
        <p class="via"><b>${esc(n.link.jenis)}</b>${n.link.status === 'usulan' ? '<span class="usulan-tag">usulan</span>' : ''} · ${esc(n.link.alasan)}</p>
      </div></div>` : '';
  const upLevels = [...d.up].reverse();
  view.innerHTML = `
    <div class="section-head">
      <button type="button" class="btn ghost small-btn" id="chain-back">Pilih peristiwa lain</button>
      ${state.owner ? `<label class="small" style="margin:0;display:flex;gap:6px;align-items:center;font-weight:400"><input type="checkbox" id="with-usulan" ${state.withUsulan ? 'checked' : ''}> Tampilkan juga usulan AI</label>` : ''}
    </div>
    <div class="route">
      ${upLevels.length ? upLevels.map((lvlArr, i) => `<p class="stage-label">${i === upLevels.length - 1 ? 'Penyebab langsung' : `Penyebab ${upLevels.length - i} langkah sebelumnya`}</p>${lvlArr.map(stop).join('')}`).join('') : '<p class="stage-label">Belum ada penyebab yang tercatat</p>'}
      <p class="stage-label">Peristiwa yang dipilih</p>
      <div class="stop focus ${f.tingkat}"><div class="stop-card">
        <div class="ev-meta">${lvl(f.tingkat)}<span>${tgl(f.tanggal, true)}</span></div>
        <h2 style="margin-top:6px">${esc(f.judul)}</h2>
        <p style="margin-top:8px">${esc(f.ringkasan)}</p>
        ${chips([...f.sektor, ...f.indikator])}
        <div style="margin-top:10px"><button type="button" class="btn ghost small-btn" id="focus-detail">Sumber dan detail</button></div>
      </div></div>
      ${d.down.length ? d.down.map((lvlArr, i) => `<p class="stage-label">${i === 0 ? 'Dampak langsung' : `Dampak ${i + 1} langkah berikutnya`}</p>${lvlArr.map(stop).join('')}`).join('') : '<p class="stage-label">Belum ada dampak yang tercatat</p>'}
    </div>`;
  $('#chain-back').addEventListener('click', () => { state.chainId = null; go('rantai'); });
  $('#focus-detail').addEventListener('click', () => openEvent(f.id));
  const wu = $('#with-usulan');
  if (wu) wu.addEventListener('change', () => { state.withUsulan = wu.checked; go('rantai'); });
  view.querySelectorAll('[data-chain]').forEach((b) => b.addEventListener('click', () => go('rantai', { chainId: Number(b.dataset.chain), focus: true })));
}

// ---------- Sektor ----------
async function renderSektor() {
  const d = await api('/api/sectors?days=30');
  const max = Math.max(1, ...d.sectors.map((s) => s.global + s.lokal));
  const rows = [...d.sectors].sort((a, b) => b.global + b.lokal - (a.global + a.lokal));
  view.innerHTML = `
    <p class="lead">Jumlah peristiwa per sektor dalam 30 hari terakhir, dipisah global dan lokal. Pilih sektor untuk melihat peristiwanya.</p>
    <div class="legend small">${lvl('global')}${lvl('lokal')}</div>
    <table class="sector-table">
      <thead><tr><th scope="col">Sektor</th><th scope="col">Global / lokal</th><th scope="col">Terbaru</th></tr></thead>
      <tbody>${rows.map((s) => {
        const tot = s.global + s.lokal;
        return `<tr>
          <td><button type="button" data-sektor="${esc(s.sektor)}">${esc(s.sektor)}</button>
            <div class="bar" style="width:${Math.max(8, (tot / max) * 100)}%"><span class="g" style="flex:${s.global}"></span><span class="l" style="flex:${s.lokal}"></span></div></td>
          <td class="num">${s.global} / ${s.lokal}</td>
          <td>${s.terbaru ? `<span class="small">${esc(s.terbaru.judul)}</span><br><span class="muted small">${tgl(s.terbaru.tanggal)}</span>` : '<span class="muted small">Belum ada</span>'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  view.querySelectorAll('[data-sektor]').forEach((b) => b.addEventListener('click', () => {
    state.filters.sektor = b.dataset.sektor;
    state.filters.tingkat = '';
    go('linimasa');
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
      ${wait.length ? wait.map((f) => fc(f)).join('') : `<p class="muted">${state.owner ? 'Buka peristiwa, lalu pilih "Catat sebagai perkiraan" pada dampak yang mungkin terjadi.' : 'Belum ada perkiraan.'}</p>`}</section>
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
  go(valid.includes(tab) ? tab : state.owner ? 'tinjau' : 'linimasa');
})();
