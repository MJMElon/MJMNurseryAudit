/* ================================================================
   MJM NURSERY — PLOT CONDITION AUDIT
   script.js  —  Supabase connected
   ================================================================ */

'use strict';

const NURSERY_PLOTS = {
  PN:   Array.from({length:52}, (_,i) => 'P' + String(i+1).padStart(2,'0')),
  BNN:  Array.from({length:14}, (_,i) => 'B' + String(i+1).padStart(2,'0')),
  UNN1: Array.from({length:18}, (_,i) => 'U' + String(i+1).padStart(2,'0')),
  UNN2: Array.from({length:20}, (_,i) => 'N' + String(i+1).padStart(2,'0'))
};
const NURSERY_LABELS = { PN:'PN', BNN:'BNN', UNN1:'UNN 1', UNN2:'UNN 2' };
const WARNA_BG = { '1':'#1a4d1a','2':'#2d7a2d','3':'#5aab5a','4':'#93c955','5':'#c8d648' };

let records     = [];
let counters    = { PN:1, BNN:1, UNN1:1, UNN2:1 };
let activeTab   = 'PN';
let activeView  = 'list';
let editMode    = false;
let editId      = null;   // Supabase UUID
let detailId    = null;
let deleteTarget= null;

let formState = { nursery:'PN', ulat:null, tikus:null, bintik:null, warna:null, photo:null };
let toastTimer  = null;
let isLoading   = false;

/* ---------------------------------------------------------------- HELPERS */
function pad(n)     { return String(n).padStart(3,'0'); }
function todayISO() { return new Date().toISOString().split('T')[0]; }
function fmtDate(iso) {
  if (!iso) return '—';
  const [y,m,d] = iso.split('-');
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d} ${MON[+m-1]} ${y}`;
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-MY', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true });
}
function nextAuditID(nursery) {
  const existing = records.filter(r => r.nursery === nursery);
  return `AUD-${nursery}-${pad(existing.length + 1)}`;
}
function chipClass(val) {
  if (val==='Banyak')  return 'mc-b';
  if (val==='Sedikit') return 'mc-s';
  return 'mc-t';
}

/* ---------------------------------------------------------------- TOAST */
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------------------------------------------------------------- LOADING */
function setLoading(on) {
  isLoading = on;
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.classList.toggle('hidden', !on);
}

/* ---------------------------------------------------------------- VIEW */
function setView(view) {
  activeView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById('view-' + view);
  if (el) el.classList.add('active');
  document.getElementById('fab').classList.toggle('hidden', view !== 'list');
  window.scrollTo(0, 0);
}

/* ---------------------------------------------------------------- TABS */
function selectTab(nursery) {
  activeTab = nursery;
  document.querySelectorAll('.tab-item').forEach(t => t.classList.toggle('active', t.dataset.n === nursery));
  document.getElementById('topbar-nursery').textContent = NURSERY_LABELS[nursery];
  renderList();
  setView('list');
}

/* ---------------------------------------------------------------- LOAD FROM SUPABASE */
async function loadRecords() {
  setLoading(true);
  try {
    const rows = await sb.select('plot_audits', 'select=*');
    records = rows.map(r => ({
      uid:     r.id,
      id:      r.audit_id,
      nursery: r.nursery,
      plot:    r.plot,
      batch:   r.batch,
      ulat:    r.pest,
      tikus:   r.tikus,
      bintik:  r.disease,
      warna:   r.warna_daun,
      photo:   r.photo_url,
      date:    r.date,
      createdAt: r.created_at
    }));
    renderList();
  } catch(e) {
    showToast('⚠ Failed to load records'); console.error(e);
  }
  setLoading(false);
}

/* ---------------------------------------------------------------- RENDER LIST */
function renderList() {
  const recs   = records.filter(r => r.nursery === activeTab);
  const listEl = document.getElementById('records-list');
  document.getElementById('list-count').textContent = `${recs.length} record${recs.length !== 1?'s':''}`;
  document.getElementById('list-heading').textContent = NURSERY_LABELS[activeTab];
  document.getElementById('stat-total').textContent = recs.length;
  const banyak = recs.filter(r => r.ulat==='Banyak'||r.tikus==='Banyak'||r.bintik==='Banyak').length;
  document.getElementById('stat-alert').textContent = banyak;
  document.getElementById('stat-ok').textContent    = recs.length - banyak;

  document.querySelectorAll('.tab-item').forEach(t => {
    const n = t.dataset.n;
    const cnt = records.filter(r => r.nursery === n).length;
    let badge = t.querySelector('.tab-badge');
    if (cnt > 0) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'tab-badge'; t.appendChild(badge); }
      badge.textContent = cnt;
    } else if (badge) badge.remove();
  });

  if (!recs.length) {
    listEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg></div><h3>No audits yet</h3><p>Tap <strong>+</strong> to add the first audit for ${NURSERY_LABELS[activeTab]}.</p></div>`;
    return;
  }

  listEl.innerHTML = recs.map(r => `
    <div class="record-item" onclick="openDetail('${r.uid}')">
      ${r.photo ? `<img class="record-thumb" src="${r.photo}" alt="plot" />` : `<div class="record-thumb-placeholder"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/></svg></div>`}
      <div class="record-info">
        <div class="record-plot">${r.plot}</div>
        <div class="record-meta">${r.id} · ${fmtDateTime(r.createdAt)}</div>
        <div class="record-chips">
          <span class="mini-chip ${chipClass(r.ulat)}">Pest:${r.ulat}</span>
          <span class="mini-chip ${chipClass(r.tikus)}">Tikus:${r.tikus}</span>
          <span class="mini-chip ${chipClass(r.bintik)}">Dis:${r.bintik}</span>
          <span class="mc-w mini-chip" style="background:${WARNA_BG[r.warna]||'#888'}">W${r.warna}</span>
        </div>
      </div>
      <div class="record-actions" onclick="event.stopPropagation()">
        <button class="icon-btn edit-btn" onclick="openEdit('${r.uid}')"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="icon-btn del-btn" onclick="confirmDelete('${r.uid}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button>
      </div>
    </div>`).join('');
}

/* ---------------------------------------------------------------- FORM */
function openAddForm() {
  editMode = false; editId = null;
  formState = { nursery: activeTab, ulat:null, tikus:null, bintik:null, warna:null, photo:null };
  populateForm();
  setView('form');
  document.getElementById('form-view-title').textContent = `New Audit — ${NURSERY_LABELS[activeTab]}`;
}

function openEdit(uid) {
  const rec = records.find(r => r.uid === uid);
  if (!rec) return;
  editMode = true; editId = uid;
  formState = { nursery:rec.nursery, ulat:rec.ulat, tikus:rec.tikus, bintik:rec.bintik, warna:rec.warna, photo:rec.photo };
  populateForm(rec);
  setView('form');
  document.getElementById('form-view-title').textContent = `Edit — ${rec.id}`;
}

function populateForm(rec) {
  const id = editMode ? rec.id : nextAuditID(formState.nursery);
  document.getElementById('f-id').value   = id;
  document.getElementById('f-date').value = editMode ? rec.date : todayISO();
  document.getElementById('form-view-id').textContent = id;

  const plotSel = document.getElementById('f-plot');
  plotSel.innerHTML = '<option value="">— Select Plot —</option>';
  (NURSERY_PLOTS[formState.nursery]||[]).forEach(p => {
    const o = document.createElement('option'); o.value = p; o.textContent = p;
    if (rec && rec.plot === p) o.selected = true;
    plotSel.appendChild(o);
  });
  document.getElementById('f-batch').value = rec?.batch || '';

  const TRI = { 'Banyak':'sel-b','Sedikit':'sel-s','Tidak Ada':'sel-t' };
  ['ulat','tikus','bintik'].forEach(f => {
    const grp = document.getElementById(`f-${f}-grp`);
    grp.querySelectorAll('.tri-btn').forEach(b => b.className='tri-btn');
    if (formState[f]) {
      const btn = [...grp.querySelectorAll('.tri-btn')].find(b => b.dataset.val === formState[f]);
      if (btn) btn.classList.add(TRI[formState[f]]);
    }
  });
  document.querySelectorAll('.warna-btn').forEach(b => b.classList.toggle('active', b.dataset.v === formState.warna));

  if (formState.photo) {
    document.getElementById('f-photo-img').src = formState.photo;
    document.getElementById('photo-drop').style.display    = 'none';
    document.getElementById('photo-preview').style.display = 'block';
  } else {
    document.getElementById('photo-drop').style.display    = 'block';
    document.getElementById('photo-preview').style.display = 'none';
    document.getElementById('f-photo-img').src = '';
    document.getElementById('photo-input').value = '';
  }
}

const TRI_CLASS = { 'Banyak':'sel-b','Sedikit':'sel-s','Tidak Ada':'sel-t' };
function pickTri(field, val, el) {
  document.getElementById(`f-${field}-grp`).querySelectorAll('.tri-btn').forEach(b => b.className='tri-btn');
  el.classList.add(TRI_CLASS[val]); formState[field] = val;
}
function pickWarna(el) {
  document.querySelectorAll('.warna-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active'); formState.warna = el.dataset.v;
}
function handlePhoto(input) {
  if (!input.files||!input.files[0]) return;
  const reader = new FileReader();
  reader.onload = e => {
    formState.photo = e.target.result;
    document.getElementById('f-photo-img').src = e.target.result;
    document.getElementById('photo-drop').style.display    = 'none';
    document.getElementById('photo-preview').style.display = 'block';
  };
  reader.readAsDataURL(input.files[0]);
}
function clearPhoto(e) {
  if (e) e.stopPropagation();
  formState.photo = null;
  document.getElementById('f-photo-img').src = '';
  document.getElementById('photo-drop').style.display    = 'block';
  document.getElementById('photo-preview').style.display = 'none';
  document.getElementById('photo-input').value = '';
}

/* ---------------------------------------------------------------- SAVE */
async function saveRecord() {
  const plot  = document.getElementById('f-plot').value;
  const batch = document.getElementById('f-batch').value.trim();
  if (!plot)             { showToast('⚠ Please select a plot'); return; }
  if (!formState.ulat)   { showToast('⚠ Please select Pest level'); return; }
  if (!formState.tikus)  { showToast('⚠ Please select Tikus level'); return; }
  if (!formState.bintik) { showToast('⚠ Please select Disease level'); return; }
  if (!formState.warna)  { showToast('⚠ Please select Warna Daun'); return; }

  setLoading(true);
  try {
    // Upload photo if it's a new base64 image
    let photoUrl = formState.photo;
    if (photoUrl && photoUrl.startsWith('data:')) {
      photoUrl = await sb.uploadPhoto('audit-photos', `plot_${plot}`, photoUrl);
    }

    const payload = {
      nursery:   formState.nursery,
      plot,
      batch:     batch || null,
      pest:      formState.ulat,
      tikus:     formState.tikus,
      disease:   formState.bintik,
      warna_daun:formState.warna,
      photo_url: photoUrl || null,
      date:      todayISO()
    };

    if (editMode && editId) {
      await sb.update('plot_audits', editId, payload);
      showToast('✓ Record updated');
    } else {
      payload.audit_id = nextAuditID(formState.nursery);
      await sb.insert('plot_audits', payload);
      showToast('✓ Record saved');
    }

    await loadRecords();
    setView('list');
  } catch(e) {
    showToast('⚠ Save failed — check connection'); console.error(e);
    setLoading(false);
  }
}

function cancelForm() { setView('list'); }

/* ---------------------------------------------------------------- DETAIL */
function openDetail(uid) {
  const rec = records.find(r => r.uid === uid);
  if (!rec) return;
  detailId = uid;
  const heroImg = document.getElementById('detail-hero-img');
  const heroPh  = document.getElementById('detail-hero-placeholder');
  if (rec.photo) { heroImg.src = rec.photo; heroImg.style.display='block'; heroPh.style.display='none'; }
  else           { heroImg.style.display='none'; heroPh.style.display='flex'; }

  document.getElementById('detail-nursery-tag').textContent = NURSERY_LABELS[rec.nursery];
  document.getElementById('detail-id').textContent          = rec.id;
  document.getElementById('detail-date').textContent        = fmtDate(rec.date);
  document.getElementById('detail-plot').textContent        = rec.plot;
  document.getElementById('detail-batch').textContent       = rec.batch ? `Batch: ${rec.batch}` : '';

  [['detail-ulat-val','ulat'],['detail-tikus-val','tikus'],['detail-bintik-val','bintik']].forEach(([elId,field]) => {
    const el = document.getElementById(elId);
    el.textContent = rec[field];
    el.className   = 'detail-cell-val ' + (rec[field]==='Banyak'?'val-b':rec[field]==='Sedikit'?'val-s':'val-t');
  });
  const warna = document.getElementById('detail-warna-box');
  warna.style.background = WARNA_BG[rec.warna] || '#888';
  document.getElementById('detail-warna-label').textContent = `Warna Daun ${rec.warna}`;
  setView('detail');
}
function closeDetail()    { setView('list'); }
function editFromDetail() { if (detailId) openEdit(detailId); }

/* ---------------------------------------------------------------- DELETE */
function confirmDelete(uid) { deleteTarget = uid; document.getElementById('modal-overlay').classList.add('show'); }
function cancelDelete()     { deleteTarget = null; document.getElementById('modal-overlay').classList.remove('show'); }
async function doDelete() {
  if (!deleteTarget) return;
  document.getElementById('modal-overlay').classList.remove('show');
  setLoading(true);
  try {
    await sb.delete('plot_audits', deleteTarget);
    deleteTarget = null;
    await loadRecords();
    showToast('Record deleted');
    if (activeView === 'detail') setView('list');
  } catch(e) { showToast('⚠ Delete failed'); console.error(e); setLoading(false); }
}

/* ---------------------------------------------------------------- INIT */
function init() {
  const dateEl = document.getElementById('nav-today');
  if (dateEl) dateEl.textContent = fmtDate(todayISO());
  document.getElementById('fab').addEventListener('click', openAddForm);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) cancelDelete();
  });
  selectTab('PN');
  loadRecords();
}
document.addEventListener('DOMContentLoaded', init);