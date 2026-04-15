/* ================================================================
   MJM NURSERY — PAPAN TANDA AUDIT SYSTEM
   papan_script.js  —  Supabase connected
   ================================================================ */

'use strict';

const NURSERY_PLOTS = {
  PN:   Array.from({length:52}, (_,i) => 'P'+String(i+1).padStart(2,'0')),
  BNN:  Array.from({length:14}, (_,i) => 'B'+String(i+1).padStart(2,'0')),
  UNN1: Array.from({length:18}, (_,i) => 'U'+String(i+1).padStart(2,'0')),
  UNN2: Array.from({length:20}, (_,i) => 'N'+String(i+1).padStart(2,'0'))
};
const NURSERY_LABELS = { PN:'PN', BNN:'BNN', UNN1:'UNN 1', UNN2:'UNN 2' };
const BREEDS = ['Tenera DxP','Compact Tenera','Ganoderma-Tolerant','MPOB Dami','Sime Darby','Felda','Other'];

let batches      = [];
let audits       = [];
let activeTab    = 'audit';
let activeView   = 'list';
let editMode     = false;
let editId       = null;
let detailId     = null;
let deleteTarget = null;
let deleteType   = null;
let auditFormBatchId = null;
let formState    = { nursery:'PN', plot:'', batch:'', breed:'', datePlanted:'', dateTransplant:'', dateMature:'', qtyTransplant:'', presence:null, infoCorrect:null, condition:null, remarks:'', photo:null };
let toastTimer   = null;

/* ---------------------------------------------------------------- HELPERS */
function pad(n)     { return String(n).padStart(3,'0'); }
function todayISO() { return new Date().toISOString().split('T')[0]; }
function fmtDate(iso) {
  if (!iso) return '—';
  const [y,m,d] = iso.split('-');
  const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d} ${MON[+m-1]} ${y}`;
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-MY',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true});
}
function getAuditForBatch(batchUid) { return audits.find(a => a.batchUid===batchUid)||null; }
function overallStatus(audit) {
  if (!audit) return 'pending';
  const vals=[audit.presence,audit.infoCorrect,audit.condition];
  if (vals.includes('Tiada')||vals.includes('Rosak')||vals.includes('Teruk')) return 'fail';
  if (vals.includes('Salah')||vals.includes('Damaged')) return 'issue';
  return 'pass';
}
function statusBadgeClass(s) { return {pending:'badge-pending',pass:'badge-pass',issue:'badge-issue',fail:'badge-fail'}[s]||'badge-pending'; }
function statusLabel(s)      { return {pending:'Pending',pass:'Pass',issue:'Issues',fail:'Fail'}[s]||'Pending'; }
function valClass(val) {
  if (!val||val==='—') return '';
  if (['Ada','Betul','Baik'].includes(val)) return 'val-ok';
  if (['Rosak','Damaged'].includes(val))   return 'val-warn';
  return 'val-bad';
}
function chipClass(val) {
  if (!val) return 'cc-na';
  if (['Ada','Betul','Baik'].includes(val)) return 'cc-ok';
  if (['Rosak','Damaged'].includes(val))   return 'cc-warn';
  return 'cc-bad';
}
function nextBatchID()  { return `BTH-${pad(batches.length+1)}`; }
function nextAuditID()  { return `PTA-${pad(audits.length+1)}`; }

/* ---------------------------------------------------------------- TOAST */
function showToast(msg) {
  const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),2600);
}

/* ---------------------------------------------------------------- LOADING */
function setLoading(on) {
  const overlay=document.getElementById('loading-overlay');
  if (overlay) overlay.classList.toggle('hidden',!on);
}

/* ---------------------------------------------------------------- VIEW */
function setView(view) {
  activeView=view;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  const el=document.getElementById('view-'+view); if (el) el.classList.add('active');
  const fab=document.getElementById('fab');
  fab.classList.toggle('hidden', !(view==='list' && activeTab==='batch'));
  window.scrollTo(0,0);
}

/* ---------------------------------------------------------------- TABS */
function selectTab(tab) {
  activeTab=tab;
  document.querySelectorAll('.tab-item').forEach(t=>t.classList.toggle('active',t.dataset.t===tab));
  document.getElementById('audit-list-wrap').classList.toggle('hidden',tab!=='audit');
  document.getElementById('batch-list-wrap').classList.toggle('hidden',tab!=='batch');
  const fab=document.getElementById('fab');
  fab.classList.toggle('hidden', tab!=='batch');
  updateStats();
}

/* ---------------------------------------------------------------- STATS */
function updateStats() {
  document.getElementById('stat-batches').textContent = batches.length;
  const pending = batches.filter(b=>!getAuditForBatch(b.uid)).length;
  const passed  = batches.filter(b=>{ const a=getAuditForBatch(b.uid); return a&&overallStatus(a)==='pass'; }).length;
  document.getElementById('stat-pending').textContent = pending;
  document.getElementById('stat-pass').textContent    = passed;
  const auditTab = document.querySelector('[data-t="audit"]');
  let badge = auditTab.querySelector('.tab-badge');
  if (pending>0) {
    if (!badge) { badge=document.createElement('span'); badge.className='tab-badge'; auditTab.appendChild(badge); }
    badge.textContent=pending;
  } else if (badge) badge.remove();
}

/* ---------------------------------------------------------------- LOAD */
async function loadAll() {
  setLoading(true);
  try {
    const [bRows, aRows] = await Promise.all([
      sb.select('batches','select=*'),
      sb.select('papan_audits','select=*')
    ]);
    batches = bRows.map(r=>({
      uid:r.id, id:r.batch_id, nursery:r.nursery, plot:r.plot,
      batch:r.batch_no, breed:r.breed, qtyTransplant:r.qty_transplant?.toString()||'',
      datePlanted:r.date_planted||'', dateTransplant:r.date_transplant||'', dateMature:r.date_mature||'',
      createdAt:r.created_at
    }));
    audits = aRows.map(r=>({
      uid:r.id, id:r.audit_id, batchUid:r.batch_uuid,
      nursery:r.nursery, plot:r.plot, batch:r.batch_no,
      presence:r.presence, infoCorrect:r.info_correct, condition:r.condition,
      remarks:r.remarks||'', photo:r.photo_url,
      date:r.date, createdAt:r.created_at
    }));
    renderBatchList(); renderAuditList(); updateStats();
  } catch(e) { showToast('⚠ Failed to load data'); console.error(e); }
  setLoading(false);
}

/* ---------------------------------------------------------------- BATCH LIST */
function renderBatchList() {
  const listEl=document.getElementById('batch-list');
  document.getElementById('batch-count').textContent=`${batches.length} batch${batches.length!==1?'es':''}`;
  if (!batches.length) {
    listEl.innerHTML=`<div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div><h3>No batches yet</h3><p>Tap <strong>+</strong> to register a new transplant batch.</p></div>`;
    return;
  }
  listEl.innerHTML = batches.map(b => {
    const audit=getAuditForBatch(b.uid); const status=overallStatus(audit);
    return `<div class="batch-item">
      <div class="batch-item-top">
        <span class="batch-nursery-tag">${NURSERY_LABELS[b.nursery]}</span>
        <span class="batch-id">${b.id}</span>
        <span class="audit-status-badge ${statusBadgeClass(status)}">${statusLabel(status)}</span>
        <span class="batch-date">${fmtDate(b.dateTransplant)}</span>
      </div>
      <div class="batch-plot">${b.plot}</div>
      <div class="batch-breed">${b.breed} · Qty: ${b.qtyTransplant||'—'}</div>
      <div class="batch-meta-row">
        <span class="batch-meta-chip">Planted: ${fmtDate(b.datePlanted)}</span>
        <span class="batch-meta-chip">Transplant: ${fmtDate(b.dateTransplant)}</span>
        <span class="batch-meta-chip">Mature: ${fmtDate(b.dateMature)}</span>
      </div>
      <div class="batch-actions">
        <button class="icon-btn edit-btn" onclick="openEditBatch('${b.uid}')"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="icon-btn del-btn" onclick="confirmDelete('${b.uid}','batch')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button>
      </div>
    </div>`;
  }).join('');
}

/* ---------------------------------------------------------------- AUDIT LIST */
function renderAuditList() {
  const listEl=document.getElementById('audit-list');
  document.getElementById('audit-count').textContent=`${batches.length} plot${batches.length!==1?'s':''}`;
  if (!batches.length) {
    listEl.innerHTML=`<div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 12h6M9 15h4"/></svg></div><h3>No plots to audit yet</h3><p>Register a batch in the <strong>Batch Info</strong> tab first.</p></div>`;
    return;
  }
  const sorted=[...batches].sort((a,b)=>{
    const as=overallStatus(getAuditForBatch(a.uid)), bs=overallStatus(getAuditForBatch(b.uid));
    if (as==='pending'&&bs!=='pending') return -1;
    if (bs==='pending'&&as!=='pending') return 1;
    return (b.dateTransplant||'').localeCompare(a.dateTransplant||'');
  });
  listEl.innerHTML=sorted.map(b=>{
    const audit=getAuditForBatch(b.uid); const status=overallStatus(audit);
    const checkChips=audit?`<div class="audit-checks">
      <span class="check-chip ${chipClass(audit.presence)}">Kehadiran: ${audit.presence}</span>
      <span class="check-chip ${chipClass(audit.infoCorrect)}">Maklumat: ${audit.infoCorrect}</span>
      <span class="check-chip ${chipClass(audit.condition)}">Keadaan: ${audit.condition}</span>
    </div>`:'';
    const actions=audit
      ?`<div class="audit-item-actions"><button class="btn-view-audit" onclick="openDetail('${audit.uid}')">View</button><button class="btn-audit-now" style="background:var(--g600)" onclick="openAuditForm('${b.uid}',true,'${audit.uid}')">Re-audit</button></div>`
      :`<div class="audit-item-actions"><button class="btn-audit-now" onclick="openAuditForm('${b.uid}',false,null)">Audit Now</button></div>`;
    return `<div class="audit-item status-${status}">
      <div class="audit-item-top">
        <span class="audit-nursery-tag">${NURSERY_LABELS[b.nursery]}</span>
        <span class="audit-status-badge ${statusBadgeClass(status)}">${statusLabel(status)}</span>
        <span class="audit-item-date">${audit?fmtDate(audit.date):fmtDate(b.dateTransplant)}</span>
      </div>
      <div class="audit-plot">${b.plot}</div>
      <div class="audit-batch">Batch: ${b.batch} · ${b.breed}</div>
      ${checkChips}${actions}
    </div>`;
  }).join('');
}

/* ---------------------------------------------------------------- BATCH FORM */
function openAddBatch() {
  editMode=false; editId=null;
  formState={...formState, nursery:'PN',plot:'',batch:'',breed:'',datePlanted:'',dateTransplant:'',dateMature:'',qtyTransplant:''};
  populateBatchForm(); setView('batch-form');
  document.getElementById('batch-form-title').textContent='New Batch';
  document.getElementById('batch-form-id').textContent=nextBatchID();
}
function openEditBatch(uid) {
  const b=batches.find(x=>x.uid===uid); if (!b) return;
  editMode=true; editId=uid;
  formState={...formState,nursery:b.nursery,plot:b.plot,batch:b.batch,breed:b.breed,datePlanted:b.datePlanted,dateTransplant:b.dateTransplant,dateMature:b.dateMature,qtyTransplant:b.qtyTransplant};
  populateBatchForm(b); setView('batch-form');
  document.getElementById('batch-form-title').textContent=`Edit — ${b.id}`;
  document.getElementById('batch-form-id').textContent=b.id;
}
function populateBatchForm(b) {
  document.querySelectorAll('.nursery-tab').forEach(t=>t.classList.toggle('active',t.dataset.n===formState.nursery));
  const plotSel=document.getElementById('bf-plot');
  plotSel.innerHTML='<option value="">— Select —</option>';
  (NURSERY_PLOTS[formState.nursery]||[]).forEach(p=>{
    const o=document.createElement('option'); o.value=p; o.textContent=p;
    if (b&&b.plot===p) o.selected=true; plotSel.appendChild(o);
  });
  const breedSel=document.getElementById('bf-breed');
  breedSel.innerHTML='<option value="">— Select Breed —</option>';
  BREEDS.forEach(br=>{ const o=document.createElement('option'); o.value=br; o.textContent=br; if (b&&b.breed===br) o.selected=true; breedSel.appendChild(o); });
  document.getElementById('bf-batch').value=formState.batch||'';
  document.getElementById('bf-qty').value=formState.qtyTransplant||'';
  document.getElementById('bf-date-planted').value=formState.datePlanted||'';
  document.getElementById('bf-date-transplant').value=formState.dateTransplant||'';
  document.getElementById('bf-date-mature').value=formState.dateMature||'';
}
function selectBatchNursery(el) {
  document.querySelectorAll('.nursery-tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active'); formState.nursery=el.dataset.n;
  const plotSel=document.getElementById('bf-plot');
  plotSel.innerHTML='<option value="">— Select —</option>';
  (NURSERY_PLOTS[formState.nursery]||[]).forEach(p=>{ const o=document.createElement('option'); o.value=p; o.textContent=p; plotSel.appendChild(o); });
}
async function saveBatch() {
  const plot=document.getElementById('bf-plot').value;
  const batch=document.getElementById('bf-batch').value.trim();
  const breed=document.getElementById('bf-breed').value;
  const qty=document.getElementById('bf-qty').value.trim();
  const dp=document.getElementById('bf-date-planted').value;
  const dt=document.getElementById('bf-date-transplant').value;
  const dm=document.getElementById('bf-date-mature').value;
  if (!plot)  { showToast('⚠ Please select a plot'); return; }
  if (!batch) { showToast('⚠ Please enter batch number'); return; }
  if (!breed) { showToast('⚠ Please select a breed'); return; }
  if (!dt)    { showToast('⚠ Please enter transplant date'); return; }
  setLoading(true);
  try {
    const payload={ nursery:formState.nursery, plot, batch_no:batch, breed, qty_transplant:qty?parseInt(qty):null, date_planted:dp||null, date_transplant:dt, date_mature:dm||null };
    if (editMode&&editId) {
      await sb.update('batches',editId,payload); showToast('✓ Batch updated');
    } else {
      payload.batch_id=nextBatchID();
      await sb.insert('batches',payload); showToast('✓ Batch saved — audit list updated');
    }
    await loadAll(); setView('list'); selectTab('batch');
  } catch(e) { showToast('⚠ Save failed'); console.error(e); setLoading(false); }
}

/* ---------------------------------------------------------------- AUDIT FORM */
function openAuditForm(batchUid, isEdit, existingAuditUid) {
  auditFormBatchId=batchUid;
  const b=batches.find(x=>x.uid===batchUid); if (!b) return;
  if (isEdit&&existingAuditUid) {
    const ex=audits.find(a=>a.uid===existingAuditUid);
    editMode=true; editId=existingAuditUid;
    formState={...formState, presence:ex?.presence||null, infoCorrect:ex?.infoCorrect||null, condition:ex?.condition||null, remarks:ex?.remarks||'', photo:ex?.photo||null };
  } else {
    editMode=false; editId=null;
    formState={...formState, presence:null,infoCorrect:null,condition:null,remarks:'',photo:null};
  }
  document.getElementById('banner-plot').textContent=b.plot;
  document.getElementById('banner-batch').textContent=b.batch;
  document.getElementById('banner-breed').textContent=b.breed;
  document.getElementById('banner-qty').textContent=b.qtyTransplant||'—';
  document.getElementById('banner-dt').textContent=fmtDate(b.dateTransplant);
  document.getElementById('banner-dp').textContent=fmtDate(b.datePlanted);
  document.getElementById('banner-dm').textContent=fmtDate(b.dateMature);
  document.getElementById('banner-nursery').textContent=NURSERY_LABELS[b.nursery];
  document.getElementById('audit-form-id').textContent=editMode?editId:nextAuditID();
  document.getElementById('audit-form-title').textContent=`Audit — ${b.plot}`;
  ['presence','info','cond'].forEach(f=>{
    const grp=document.getElementById(`f-${f}-grp`);
    if (grp) grp.querySelectorAll('.tri-btn').forEach(b=>b.className='tri-btn');
  });
  if (formState.presence)    { const btn=document.querySelector(`#f-presence-grp [data-val="${formState.presence}"]`);    if (btn) btn.classList.add(getTriClass(formState.presence)); }
  if (formState.infoCorrect) { const btn=document.querySelector(`#f-info-grp [data-val="${formState.infoCorrect}"]`);     if (btn) btn.classList.add(getTriClass(formState.infoCorrect)); }
  if (formState.condition)   { const btn=document.querySelector(`#f-cond-grp [data-val="${formState.condition}"]`);       if (btn) btn.classList.add(getTriClass(formState.condition)); }
  document.getElementById('f-remarks').value=formState.remarks||'';
  if (formState.photo) {
    document.getElementById('papan-photo-img').src=formState.photo;
    document.getElementById('papan-photo-drop').style.display='none';
    document.getElementById('papan-photo-preview').style.display='block';
  } else {
    document.getElementById('papan-photo-drop').style.display='block';
    document.getElementById('papan-photo-preview').style.display='none';
    document.getElementById('papan-photo-img').src='';
  }
  setView('audit-form');
}
function getTriClass(val) {
  if (['Ada','Betul','Baik'].includes(val))   return 'sel-ok';
  if (['Rosak','Damaged'].includes(val))      return 'sel-warn';
  return 'sel-bad';
}
function pickTri(field,val,el) {
  document.getElementById(`f-${field}-grp`).querySelectorAll('.tri-btn').forEach(b=>b.className='tri-btn');
  el.classList.add(getTriClass(val));
  if (field==='presence') formState.presence=val;
  if (field==='info')     formState.infoCorrect=val;
  if (field==='cond')     formState.condition=val;
}
function handlePhoto(input) {
  if (!input.files||!input.files[0]) return;
  const reader=new FileReader();
  reader.onload=e=>{ formState.photo=e.target.result; document.getElementById('papan-photo-img').src=e.target.result; document.getElementById('papan-photo-drop').style.display='none'; document.getElementById('papan-photo-preview').style.display='block'; };
  reader.readAsDataURL(input.files[0]); input.value='';
}
function clearPhoto(e) {
  if (e) e.stopPropagation();
  formState.photo=null;
  document.getElementById('papan-photo-drop').style.display='block';
  document.getElementById('papan-photo-preview').style.display='none';
  document.getElementById('papan-photo-img').src='';
  document.getElementById('papan-photo-input').value='';
}
async function saveAudit() {
  if (!formState.presence)    { showToast('⚠ Please select Kehadiran'); return; }
  if (!formState.infoCorrect) { showToast('⚠ Please select Maklumat'); return; }
  if (!formState.condition)   { showToast('⚠ Please select Keadaan'); return; }
  const b=batches.find(x=>x.uid===auditFormBatchId); if (!b) return;
  const remarks=document.getElementById('f-remarks').value.trim();
  setLoading(true);
  try {
    let photoUrl=formState.photo;
    if (photoUrl&&photoUrl.startsWith('data:')) photoUrl=await sb.uploadPhoto('audit-photos',`papan_${b.plot}`,photoUrl);
    const payload={ batch_uuid:auditFormBatchId, nursery:b.nursery, plot:b.plot, batch_no:b.batch, presence:formState.presence, info_correct:formState.infoCorrect, condition:formState.condition, remarks:remarks||null, photo_url:photoUrl||null, date:todayISO() };
    if (editMode&&editId) {
      await sb.update('papan_audits',editId,payload); showToast('✓ Audit updated');
    } else {
      payload.audit_id=nextAuditID();
      await sb.insert('papan_audits',payload); showToast('✓ Audit recorded');
    }
    await loadAll(); setView('list'); selectTab('audit');
  } catch(e) { showToast('⚠ Save failed'); console.error(e); setLoading(false); }
}

/* ---------------------------------------------------------------- DETAIL */
function openDetail(auditUid) {
  const audit=audits.find(a=>a.uid===auditUid); if (!audit) return;
  detailId=auditUid;
  const b=batches.find(x=>x.uid===audit.batchUid);
  const heroImg=document.getElementById('detail-hero-img'); const heroPh=document.getElementById('detail-hero-placeholder');
  if (audit.photo) { heroImg.src=audit.photo; heroImg.style.display='block'; heroPh.style.display='none'; }
  else             { heroImg.style.display='none'; heroPh.style.display='flex'; }
  document.getElementById('detail-nursery-tag').textContent=NURSERY_LABELS[audit.nursery];
  document.getElementById('detail-id').textContent=audit.id;
  document.getElementById('detail-date').textContent=fmtDate(audit.date);
  document.getElementById('detail-plot').textContent=audit.plot;
  document.getElementById('detail-sub').textContent=`Batch: ${audit.batch}${b?' · '+b.breed:''}`;
  const pv=document.getElementById('detail-presence-val'); pv.textContent=audit.presence||'—'; pv.className='detail-check-val '+valClass(audit.presence);
  const iv=document.getElementById('detail-info-val');     iv.textContent=audit.infoCorrect||'—'; iv.className='detail-check-val '+valClass(audit.infoCorrect);
  const cv=document.getElementById('detail-cond-val');     cv.textContent=audit.condition||'—';  cv.className='detail-check-val '+valClass(audit.condition);
  document.getElementById('detail-remarks').textContent=audit.remarks||'No remarks.';
  if (b) {
    document.getElementById('detail-batch-info').innerHTML=`
      <div class="bbg-row"><span class="bbg-label">Plot:</span><span class="bbg-val">${b.plot}</span></div>
      <div class="bbg-row"><span class="bbg-label">Breed:</span><span class="bbg-val">${b.breed}</span></div>
      <div class="bbg-row"><span class="bbg-label">Qty:</span><span class="bbg-val">${b.qtyTransplant||'—'}</span></div>
      <div class="bbg-row"><span class="bbg-label">Transplant:</span><span class="bbg-val">${fmtDate(b.dateTransplant)}</span></div>
      <div class="bbg-row"><span class="bbg-label">Planted:</span><span class="bbg-val">${fmtDate(b.datePlanted)}</span></div>
      <div class="bbg-row"><span class="bbg-label">Mature:</span><span class="bbg-val">${fmtDate(b.dateMature)}</span></div>`;
  }
  setView('detail');
}
function closeDetail()    { setView('list'); selectTab('audit'); }
function editFromDetail() { const audit=audits.find(a=>a.uid===detailId); if (audit) openAuditForm(audit.batchUid,true,audit.uid); }

/* ---------------------------------------------------------------- DELETE */
function confirmDelete(uid,type) { deleteTarget=uid; deleteType=type; document.getElementById('modal-overlay').classList.add('show'); }
function cancelDelete()          { deleteTarget=null; deleteType=null; document.getElementById('modal-overlay').classList.remove('show'); }
async function doDelete() {
  if (!deleteTarget) return;
  document.getElementById('modal-overlay').classList.remove('show');
  setLoading(true);
  try {
    if (deleteType==='batch') {
      // delete associated audit first
      const linkedAudit=audits.find(a=>a.batchUid===deleteTarget);
      if (linkedAudit) await sb.delete('papan_audits',linkedAudit.uid);
      await sb.delete('batches',deleteTarget);
      showToast('Batch and audit deleted');
    } else {
      await sb.delete('papan_audits',deleteTarget);
      showToast('Audit deleted');
    }
    deleteTarget=null; deleteType=null;
    await loadAll();
    if (activeView==='detail') { setView('list'); selectTab('audit'); }
  } catch(e) { showToast('⚠ Delete failed'); console.error(e); setLoading(false); }
}

/* ---------------------------------------------------------------- INIT */
function init() {
  const dateEl=document.getElementById('nav-today');
  if (dateEl) dateEl.textContent=fmtDate(todayISO());
  document.getElementById('fab').addEventListener('click',openAddBatch);
  document.getElementById('modal-overlay').addEventListener('click',e=>{ if (e.target===document.getElementById('modal-overlay')) cancelDelete(); });
  selectTab('audit');
  setView('list');
  loadAll();
}
document.addEventListener('DOMContentLoaded',init);