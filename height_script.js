/* ================================================================
   MJM NURSERY — SEEDLING HEIGHT
   height_script.js — Supabase connected (bigint IDs)
   ================================================================ */
'use strict';

const NURSERY_PLOTS = {
  PN:   Array.from({length:52}, (_,i) => 'P'+String(i+1).padStart(2,'0')),
  BNN:  Array.from({length:14}, (_,i) => 'B'+String(i+1).padStart(2,'0')),
  UNN1: Array.from({length:18}, (_,i) => 'U'+String(i+1).padStart(2,'0')),
  UNN2: Array.from({length:20}, (_,i) => 'N'+String(i+1).padStart(2,'0'))
};
const NURSERY_LABELS = { PN:'PN', BNN:'BNN', UNN1:'UNN 1', UNN2:'UNN 2' };

let records=[], activeTab='PN', activeView='list';
let editMode=false, editId=null, detailId=null, deleteTarget=null;
let formState={nursery:'PN',s1:'',s2:'',s3:'',p1:null,p2:null,p3:null};
let toastTimer=null;

function pad(n){ return String(n).padStart(3,'0'); }
function todayISO(){ return new Date().toISOString().split('T')[0]; }
function fmtDate(iso){
  if(!iso) return '—';
  const [y,m,d]=(iso.split('T')[0]).split('-');
  return `${d} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m-1]} ${y}`;
}
function fmtDateTime(iso){
  if(!iso) return '—';
  return new Date(iso).toLocaleString('en-MY',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true});
}
function calcAvg(s1,s2,s3){
  const vals=[s1,s2,s3].map(v=>parseFloat(v)).filter(v=>!isNaN(v)&&v>0);
  if(!vals.length) return null;
  return (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1);
}
function nextRecordID(nursery){ return `HGT-${nursery}-${pad(records.filter(r=>r.nursery===nursery).length+1)}`; }
function showToast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),2600); }
function setLoading(on){ const o=document.getElementById('loading-overlay'); if(o) o.classList.toggle('hidden',!on); }
function setView(view){
  activeView=view;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  const el=document.getElementById('view-'+view); if(el) el.classList.add('active');
  document.getElementById('fab').classList.toggle('hidden',view!=='list');
  window.scrollTo(0,0);
}
function selectTab(nursery){
  activeTab=nursery;
  document.querySelectorAll('.tab-item').forEach(t=>t.classList.toggle('active',t.dataset.n===nursery));
  document.getElementById('topbar-nursery').textContent=NURSERY_LABELS[nursery];
  renderList(); setView('list');
}

async function loadRecords(){
  setLoading(true);
  try {
    const rows=await sb.select('height_records','select=*');
    records=rows.map(r=>({
      uid:String(r.id), id:r.record_id, nursery:r.nursery, plot:r.plot, batch:r.batch,
      s1:r.sample_1?.toString()||'', s2:r.sample_2?.toString()||'', s3:r.sample_3?.toString()||'',
      p1:r.photo_1_url, p2:r.photo_2_url, p3:r.photo_3_url,
      date:r.date, createdAt:r.created_at
    }));
    renderList();
  } catch(e){ showToast('⚠ Failed to load records'); console.error(e); }
  setLoading(false);
}

function renderList(){
  const recs=records.filter(r=>r.nursery===activeTab);
  document.getElementById('list-count').textContent=`${recs.length} record${recs.length!==1?'s':''}`;
  document.getElementById('list-heading').textContent=NURSERY_LABELS[activeTab];
  document.getElementById('stat-total').textContent=recs.length;
  const avgs=recs.map(r=>parseFloat(calcAvg(r.s1,r.s2,r.s3))).filter(v=>!isNaN(v));
  document.getElementById('stat-avg').textContent=avgs.length?(avgs.reduce((a,b)=>a+b,0)/avgs.length).toFixed(1):'—';
  document.getElementById('stat-max').textContent=avgs.length?Math.max(...avgs).toFixed(1):'—';
  document.querySelectorAll('.tab-item').forEach(t=>{
    const n=t.dataset.n, cnt=records.filter(r=>r.nursery===n).length;
    let badge=t.querySelector('.tab-badge');
    if(cnt>0){ if(!badge){badge=document.createElement('span');badge.className='tab-badge';t.appendChild(badge);} badge.textContent=cnt; }
    else if(badge) badge.remove();
  });
  const listEl=document.getElementById('records-list');
  if(!recs.length){ listEl.innerHTML=`<div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 24 24"><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg></div><h3>No height records yet</h3><p>Tap <strong>+</strong> to record seedling heights for ${NURSERY_LABELS[activeTab]}.</p></div>`; return; }
  listEl.innerHTML=recs.map(r=>{
    const avg=calcAvg(r.s1,r.s2,r.s3);
    const thumbs=[r.p1,r.p2,r.p3].map(p=>p?`<img src="${p}" alt="photo" />`:`<div class="thumb-placeholder"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/></svg></div>`).join('');
    return `<div class="record-item" onclick="openDetail('${r.uid}')">
      <div class="record-thumb-stack">${thumbs}</div>
      <div class="record-info">
        <div class="record-plot">${r.plot}${r.batch?` <span style="font-size:11px;color:var(--text3)">· ${r.batch}</span>`:''}</div>
        <div class="record-meta">${r.id} · ${fmtDateTime(r.createdAt)}</div>
        <div class="record-heights">
          ${r.s1?`<span class="height-pill">S1: ${r.s1} cm</span>`:'<span class="height-pill missing">S1: —</span>'}
          ${r.s2?`<span class="height-pill">S2: ${r.s2} cm</span>`:'<span class="height-pill missing">S2: —</span>'}
          ${r.s3?`<span class="height-pill">S3: ${r.s3} cm</span>`:'<span class="height-pill missing">S3: —</span>'}
          ${avg?`<span class="avg-pill">Avg: ${avg} cm</span>`:''}
        </div>
      </div>
      <div class="record-actions" onclick="event.stopPropagation()">
        <button class="icon-btn edit-btn" onclick="openEdit('${r.uid}')"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="icon-btn del-btn"  onclick="confirmDelete('${r.uid}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button>
      </div>
    </div>`;
  }).join('');
}

function openAddForm(){ editMode=false; editId=null; formState={nursery:activeTab,s1:'',s2:'',s3:'',p1:null,p2:null,p3:null}; populateForm(); setView('form'); document.getElementById('form-view-title').textContent=`New Record — ${NURSERY_LABELS[activeTab]}`; }
function openEdit(uid){ const rec=records.find(r=>r.uid===uid); if(!rec) return; editMode=true; editId=uid; formState={nursery:rec.nursery,s1:rec.s1,s2:rec.s2,s3:rec.s3,p1:rec.p1,p2:rec.p2,p3:rec.p3}; populateForm(rec); setView('form'); document.getElementById('form-view-title').textContent=`Edit — ${rec.id}`; }

function populateForm(rec){
  const id=editMode?rec.id:nextRecordID(formState.nursery);
  document.getElementById('f-id').value=id;
  document.getElementById('f-date').value=editMode?rec.date:todayISO();
  document.getElementById('form-view-id').textContent=id;
  const plotSel=document.getElementById('f-plot');
  plotSel.innerHTML='<option value="">— Select Plot —</option>';
  (NURSERY_PLOTS[formState.nursery]||[]).forEach(p=>{ const o=document.createElement('option'); o.value=p; o.textContent=p; if(rec&&rec.plot===p) o.selected=true; plotSel.appendChild(o); });
  document.getElementById('f-batch').value=rec?.batch||'';
  document.getElementById('f-s1').value=formState.s1||'';
  document.getElementById('f-s2').value=formState.s2||'';
  document.getElementById('f-s3').value=formState.s3||'';
  updateAvgDisplay();
  [1,2,3].forEach(n=>renderPhotoSlot(n,formState[`p${n}`]));
  const note=document.getElementById('photo-req-note');
  if(note){ note.classList.remove('error'); note.textContent='3 photos required (one per sample)'; }
}
function onHeightInput(sample,el){ formState[`s${sample}`]=el.value.trim(); updateAvgDisplay(); const fb=document.getElementById(`s${sample}-fb`); if(fb) fb.textContent=el.value&&!isNaN(parseFloat(el.value))&&parseFloat(el.value)>0?'✓':''; }
function updateAvgDisplay(){ const avg=calcAvg(formState.s1,formState.s2,formState.s3); const el=document.getElementById('avg-display'); if(el) el.textContent=avg||'—'; }
function renderPhotoSlot(n,src){
  const slot=document.getElementById(`photo-slot-${n}`); if(!slot) return;
  while(slot.firstChild) slot.removeChild(slot.firstChild);
  if(src){
    slot.classList.add('has-photo');
    const img=document.createElement('img'); img.src=src; img.alt=`S${n}`; slot.appendChild(img);
    const lbl=document.createElement('span'); lbl.className='detail-photo-num'; lbl.textContent=`S${n}`; slot.appendChild(lbl);
    const clr=document.createElement('button'); clr.className='photo-slot-clear'; clr.innerHTML='×'; clr.onclick=e=>{e.stopPropagation();clearPhotoSlot(n);}; slot.appendChild(clr);
  } else {
    slot.classList.remove('has-photo');
    const num=document.createElement('div'); num.className='photo-slot-num'; num.textContent=n;
    const icon=document.createElementNS('http://www.w3.org/2000/svg','svg'); icon.setAttribute('viewBox','0 0 24 24'); icon.innerHTML='<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M9 5l1.5-2h3L15 5"/>';
    const lbl=document.createElement('span'); lbl.className='photo-slot-label'; lbl.textContent=`Sample ${n}`;
    slot.appendChild(num); slot.appendChild(icon); slot.appendChild(lbl);
  }
}
function triggerPhotoUpload(n){ document.getElementById(`photo-input-${n}`).click(); }
function handlePhotoUpload(n,input){
  if(!input.files||!input.files[0]) return;
  const reader=new FileReader();
  reader.onload=e=>{ formState[`p${n}`]=e.target.result; renderPhotoSlot(n,e.target.result); const note=document.getElementById('photo-req-note'); if(formState.p1&&formState.p2&&formState.p3&&note){ note.classList.remove('error'); note.textContent='3 photos required (one per sample)'; } };
  reader.readAsDataURL(input.files[0]); input.value='';
}
function clearPhotoSlot(n){ formState[`p${n}`]=null; renderPhotoSlot(n,null); }

async function saveRecord(){
  const plot=document.getElementById('f-plot').value;
  const batch=document.getElementById('f-batch').value.trim();
  if(!plot){showToast('⚠ Please select a plot');return;}
  if(!formState.s1&&!formState.s2&&!formState.s3){showToast('⚠ Please enter at least one height');return;}
  if(!formState.p1||!formState.p2||!formState.p3){ const note=document.getElementById('photo-req-note'); if(note){note.classList.add('error');note.textContent='⚠ All 3 photos are required';} showToast('⚠ Please upload all 3 photos'); return; }
  setLoading(true);
  try {
    async function maybeUpload(photo,label){ if(photo&&photo.startsWith('data:')) return await sb.uploadPhoto('audit-photos',label,photo); return photo; }
    const [p1url,p2url,p3url]=await Promise.all([maybeUpload(formState.p1,`height_${plot}_s1`),maybeUpload(formState.p2,`height_${plot}_s2`),maybeUpload(formState.p3,`height_${plot}_s3`)]);
    const avg=calcAvg(formState.s1,formState.s2,formState.s3);
    const payload={ nursery:formState.nursery, plot, batch:batch||null, sample_1:formState.s1?parseFloat(formState.s1):null, sample_2:formState.s2?parseFloat(formState.s2):null, sample_3:formState.s3?parseFloat(formState.s3):null, avg_height:avg?parseFloat(avg):null, photo_1_url:p1url||null, photo_2_url:p2url||null, photo_3_url:p3url||null, date:todayISO() };
    if(editMode&&editId){ await sb.update('height_records',editId,payload); showToast('✓ Record updated'); }
    else { payload.record_id=nextRecordID(formState.nursery); await sb.insert('height_records',payload); showToast('✓ Record saved'); }
    await loadRecords(); setView('list');
  } catch(e){ showToast('⚠ Save failed'); console.error(e); setLoading(false); }
}
function cancelForm(){ setView('list'); }

function openDetail(uid){
  const rec=records.find(r=>r.uid===uid); if(!rec) return;
  detailId=uid;
  [1,2,3].forEach(n=>{
    const el=document.getElementById(`detail-p${n}`); if(!el) return; el.innerHTML='';
    if(rec[`p${n}`]){ const img=document.createElement('img'); img.src=rec[`p${n}`]; img.alt=`S${n}`; img.onclick=()=>openLightbox(rec[`p${n}`]); el.appendChild(img); const lbl=document.createElement('span'); lbl.className='detail-photo-num'; lbl.textContent=`S${n}`; el.appendChild(lbl); }
    else { const ph=document.createElement('div'); ph.className='detail-photo-empty'; ph.innerHTML=`<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/></svg>`; el.appendChild(ph); }
  });
  document.getElementById('detail-nursery-tag').textContent=NURSERY_LABELS[rec.nursery];
  document.getElementById('detail-id').textContent=rec.id;
  document.getElementById('detail-date').textContent=fmtDate(rec.date);
  document.getElementById('detail-plot').textContent=rec.plot;
  document.getElementById('detail-batch').textContent=rec.batch?`Batch: ${rec.batch}`:'';
  document.getElementById('detail-s1').textContent=rec.s1||'—';
  document.getElementById('detail-s2').textContent=rec.s2||'—';
  document.getElementById('detail-s3').textContent=rec.s3||'—';
  document.getElementById('detail-avg-val').textContent=calcAvg(rec.s1,rec.s2,rec.s3)||'—';
  setView('detail');
}
function closeDetail(){ setView('list'); }
function editFromDetail(){ if(detailId) openEdit(detailId); }
function openLightbox(src){ const lb=document.getElementById('lightbox'); document.getElementById('lightbox-img').src=src; lb.classList.add('open'); }
function closeLightbox(){ document.getElementById('lightbox').classList.remove('open'); }

function confirmDelete(uid){ deleteTarget=uid; document.getElementById('modal-overlay').classList.add('show'); }
function cancelDelete(){ deleteTarget=null; document.getElementById('modal-overlay').classList.remove('show'); }
async function doDelete(){
  if(!deleteTarget) return;
  document.getElementById('modal-overlay').classList.remove('show');
  setLoading(true);
  try { await sb.delete('height_records',deleteTarget); deleteTarget=null; await loadRecords(); showToast('Record deleted'); if(activeView==='detail') setView('list'); }
  catch(e){ showToast('⚠ Delete failed'); console.error(e); setLoading(false); }
}

function init(){
  const dateEl=document.getElementById('nav-today'); if(dateEl) dateEl.textContent=fmtDate(todayISO());
  document.getElementById('fab').addEventListener('click',openAddForm);
  document.getElementById('modal-overlay').addEventListener('click',e=>{ if(e.target===document.getElementById('modal-overlay')) cancelDelete(); });
  document.getElementById('lightbox').addEventListener('click',e=>{ if(e.target===document.getElementById('lightbox')) closeLightbox(); });
  selectTab('PN'); loadRecords();
}
document.addEventListener('DOMContentLoaded',init);