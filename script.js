/* ================================================================
   MJM NURSERY — PLOT CONDITION AUDIT
   script.js — Supabase connected
================================================================ */
'use strict';

const NURSERY_PLOTS = {
  PN:   Array.from({length:52}, (_,i)=>'P'+String(i+1).padStart(2,'0')),
  BNN:  Array.from({length:14}, (_,i)=>'B'+String(i+1).padStart(2,'0')),
  UNN1: Array.from({length:18}, (_,i)=>'U'+String(i+1).padStart(2,'0')),
  UNN2: Array.from({length:20}, (_,i)=>'N'+String(i+1).padStart(2,'0'))
};
const NURSERY_LABELS = {PN:'PN',BNN:'BNN',UNN1:'UNN 1',UNN2:'UNN 2'};
const WARNA_BG  = {'1':'#1e3d0f','2':'#2d6a1f','3':'#5a8a2a','4':'#b5a800','5':'#d4c200'};
const WARNA_LBL = {'1':'Very Green','2':'Green','3':'Light Green','4':'Yellowish','5':'Very Yellow'};

let records=[], activeTab='PN', activeView='list';
let editMode=false, editId=null, detailId=null, deleteTarget=null;
let formState={nursery:'PN',ulat:null,tikus:null,bintik:null,warna:null,photo:null};
let toastTimer=null;

function pad(n){return String(n).padStart(3,'0');}
function todayISO(){return new Date().toISOString().split('T')[0];}
function fmtDate(iso){
  if(!iso)return'—';
  const s=iso.split('T')[0].split('-');
  return s[2]+' '+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+s[1]-1]+' '+s[0];
}
function fmtDT(iso){
  if(!iso)return'—';
  return new Date(iso).toLocaleString('en-MY',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true});
}
function nextID(nursery){return 'AUD-'+nursery+'-'+pad(records.filter(r=>r.nursery===nursery).length+1);}
function chipClass(v){return v==='Banyak'?'mc-b':v==='Sedikit'?'mc-s':'mc-t';}

function showToast(msg){
  const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2600);
}
function setLoading(on){
  const o=document.getElementById('loading-overlay');
  if(o)on?o.classList.remove('hidden'):o.classList.add('hidden');
}
function setView(v){
  activeView=v;
  document.querySelectorAll('.view').forEach(el=>el.classList.remove('active'));
  const el=document.getElementById('view-'+v);if(el)el.classList.add('active');
  const fab=document.getElementById('fab');if(fab)fab.classList.toggle('hidden',v!=='list');
  window.scrollTo(0,0);
}
function selectTab(nursery){
  activeTab=nursery;
  document.querySelectorAll('.tab-item').forEach(t=>t.classList.toggle('active',t.dataset.n===nursery));
  document.getElementById('topbar-nursery').textContent=NURSERY_LABELS[nursery];
  renderList();
  renderAlertStrip();
  setView('list');
}

/* --- LOAD --- */
async function loadRecords(){
  setLoading(true);
  try{
    const rows=await sb.select('plot_audits','select=*');
    records=rows.map(r=>({
      uid:String(r.id),id:r.audit_id,nursery:r.nursery,plot:r.plot,
      batch:r.batch,ulat:r.pest,tikus:r.tikus,bintik:r.disease,
      warna:r.warna_daun,photo:r.photo_url,date:r.date,createdAt:r.created_at
    }));
    renderList();
    renderAlertStrip();
  }catch(e){showToast('⚠ Failed to load');console.error(e);}
  setLoading(false);
}

/* --- ALERT STRIP --- */
function renderAlertStrip(){
  const strip=document.getElementById('alert-strip');if(!strip)return;
  const recs=records.filter(r=>r.nursery===activeTab);

  // Get latest record per plot
  const latestPerPlot={};
  recs.forEach(r=>{
    if(!latestPerPlot[r.plot]||r.createdAt>latestPerPlot[r.plot].createdAt)
      latestPerPlot[r.plot]=r;
  });
  const latest=Object.values(latestPerPlot);

  const ratPlots    = latest.filter(r=>r.tikus==='Banyak'||r.tikus==='Sedikit');
  const pestPlots   = latest.filter(r=>r.ulat==='Banyak');
  const yellowPlots = latest.filter(r=>r.warna==='5');

  if(!ratPlots.length&&!pestPlots.length&&!yellowPlots.length){
    strip.innerHTML='';return;
  }

  let html='<div style="margin-bottom:12px">';
  html+='<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#6b8a6b;margin-bottom:8px">⚠ Alerts — '+NURSERY_LABELS[activeTab]+'</div>';

  function alertRow(icon,label,plots,badgeColor){
    return `<div style="background:#fff;border:1px solid #dde8dd;border-radius:12px;margin-bottom:6px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer" onclick="this.parentElement.classList.toggle('open')">
        <span style="font-size:16px">${icon}</span>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:700;color:#182018">${label}</div>
          <div style="font-size:11px;color:#6b8a6b">${plots.length} plot${plots.length>1?'s':''} affected</div>
        </div>
        <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:${badgeColor.bg};color:${badgeColor.text}">${plots.length}</span>
      </div>
      <div class="alert-plots" style="display:none;padding:0 12px 10px;flex-wrap:wrap;gap:5px">
        ${plots.map(r=>`<span style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;background:#f4f6f4;border:1px solid #dde8dd;color:#3d5c3d">${r.plot}</span>`).join('')}
      </div>
    </div>`;
  }

  // Toggle open/close for each alert row
  if(ratPlots.length)    html+=alertRow('🐀','Animal Infestation',ratPlots,{bg:'#fff1f1',text:'#b91c1c'});
  if(pestPlots.length)   html+=alertRow('🐛','Pest Infestation',pestPlots,{bg:'#fff7ed',text:'#c2410c'});
  if(yellowPlots.length) html+=alertRow('🍂','Yellow Leaves',yellowPlots,{bg:'#fefce8',text:'#854d0e'});
  html+='</div>';

  strip.innerHTML=html;

  // Add toggle functionality
  strip.querySelectorAll('[onclick]').forEach(el=>{
    el.addEventListener('click',function(){
      const plotsDiv=this.parentElement.querySelector('.alert-plots');
      if(plotsDiv){
        plotsDiv.style.display=plotsDiv.style.display==='flex'?'none':'flex';
      }
    });
  });
}

/* --- RENDER LIST --- */
function renderList(){
  const recs=records.filter(r=>r.nursery===activeTab);
  document.getElementById('list-count').textContent=recs.length+' record'+(recs.length!==1?'s':'');
  document.getElementById('list-heading').textContent='Plot Condition Audit — '+NURSERY_LABELS[activeTab];

  document.querySelectorAll('.tab-item').forEach(t=>{
    const cnt=records.filter(r=>r.nursery===t.dataset.n).length;
    let b=t.querySelector('.tab-badge');
    if(cnt>0){if(!b){b=document.createElement('span');b.className='tab-badge';t.appendChild(b);}b.textContent=cnt;}
    else if(b)b.remove();
  });

  const el=document.getElementById('records-list');
  if(!recs.length){
    el.innerHTML='<div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg></div><h3>No audits yet</h3><p>Tap <strong>+</strong> to add the first audit for '+NURSERY_LABELS[activeTab]+'.</p></div>';
    return;
  }
  el.innerHTML=recs.map(r=>`
    <div class="record-item" onclick="openDetail('${r.uid}')">
      ${r.photo
        ?`<img class="record-thumb" src="${r.photo}" alt="plot" onclick="event.stopPropagation();openLightbox('${r.photo}')"/>`
        :`<div class="record-thumb-placeholder"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/></svg></div>`}
      <div class="record-info">
        <div class="record-plot">${r.plot}</div>
        <div class="record-meta">${r.id} · ${fmtDT(r.createdAt)}</div>
        <div class="record-chips">
          <span class="mini-chip ${chipClass(r.ulat)}">Pest:${r.ulat}</span>
          <span class="mini-chip ${chipClass(r.tikus)}">Animal:${r.tikus}</span>
          <span class="mini-chip ${chipClass(r.bintik)}">Disease:${r.bintik}</span>
          <span class="mc-w mini-chip" style="background:${WARNA_BG[r.warna]||'#888'}">Leaf ${r.warna}</span>
        </div>
      </div>
      <div class="record-actions" onclick="event.stopPropagation()">
        <button class="icon-btn edit-btn" onclick="openEdit('${r.uid}')"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="icon-btn del-btn"  onclick="confirmDelete('${r.uid}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button>
      </div>
    </div>`).join('');
}

/* --- FORM --- */
function openAddForm(){
  editMode=false;editId=null;
  formState={nursery:activeTab,ulat:null,tikus:null,bintik:null,warna:null,photo:null};
  populateForm();setView('form');
  document.getElementById('form-view-title').textContent='New Audit — '+NURSERY_LABELS[activeTab];
}
function openEdit(uid){
  const r=records.find(x=>x.uid===uid);if(!r)return;
  editMode=true;editId=uid;
  formState={nursery:r.nursery,ulat:r.ulat,tikus:r.tikus,bintik:r.bintik,warna:r.warna,photo:r.photo};
  populateForm(r);setView('form');
  document.getElementById('form-view-title').textContent='Edit — '+r.id;
}
function populateForm(r){
  const id=editMode?r.id:nextID(formState.nursery);
  document.getElementById('f-id').value=id;
  document.getElementById('f-date').value=editMode?r.date:todayISO();
  document.getElementById('form-view-id').textContent=id;
  const ps=document.getElementById('f-plot');
  ps.innerHTML='<option value="">— Select Plot —</option>';
  NURSERY_PLOTS[formState.nursery].forEach(p=>{
    const o=document.createElement('option');o.value=p;o.textContent=p;
    if(r&&r.plot===p)o.selected=true;ps.appendChild(o);
  });
  document.getElementById('f-batch').value=r?r.batch||'':'';
  const TRI={'Banyak':'sel-b','Sedikit':'sel-s','Tidak Ada':'sel-t'};
  ['ulat','tikus','bintik'].forEach(f=>{
    const grp=document.getElementById('f-'+f+'-grp');
    grp.querySelectorAll('.tri-btn').forEach(b=>b.className='tri-btn');
    if(formState[f]){const btn=[...grp.querySelectorAll('.tri-btn')].find(b=>b.dataset.val===formState[f]);if(btn)btn.classList.add(TRI[formState[f]]);}
  });
  document.querySelectorAll('.warna-btn').forEach(b=>b.classList.toggle('active',b.dataset.v===formState.warna));
  if(formState.photo){
    document.getElementById('f-photo-img').src=formState.photo;
    document.getElementById('photo-drop').style.display='none';
    document.getElementById('photo-preview').style.display='block';
  }else{
    document.getElementById('photo-drop').style.display='block';
    document.getElementById('photo-preview').style.display='none';
    document.getElementById('f-photo-img').src='';
    document.getElementById('photo-input').value='';
  }
}
const TRI_CLASS={'Banyak':'sel-b','Sedikit':'sel-s','Tidak Ada':'sel-t'};
function pickTri(field,val,el){
  document.getElementById('f-'+field+'-grp').querySelectorAll('.tri-btn').forEach(b=>b.className='tri-btn');
  el.classList.add(TRI_CLASS[val]);formState[field]=val;
}
function pickWarna(el){
  document.querySelectorAll('.warna-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');formState.warna=el.dataset.v;
}
function handlePhoto(input){
  if(!input.files||!input.files[0])return;
  const reader=new FileReader();
  reader.onload=e=>{
    formState.photo=e.target.result;
    document.getElementById('f-photo-img').src=e.target.result;
    document.getElementById('photo-drop').style.display='none';
    document.getElementById('photo-preview').style.display='block';
  };
  reader.readAsDataURL(input.files[0]);
}
function clearPhoto(e){
  if(e)e.stopPropagation();formState.photo=null;
  document.getElementById('f-photo-img').src='';
  document.getElementById('photo-drop').style.display='block';
  document.getElementById('photo-preview').style.display='none';
  document.getElementById('photo-input').value='';
}
function cancelForm(){setView('list');}

/* --- SAVE --- */
async function saveRecord(){
  const plot=document.getElementById('f-plot').value;
  const batch=document.getElementById('f-batch').value.trim();
  if(!plot)          {showToast('⚠ Please select a plot');return;}
  if(!batch)         {showToast('⚠ Please enter batch number');return;}
  if(!formState.ulat)  {showToast('⚠ Please select Pest Infestation level');return;}
  if(!formState.tikus) {showToast('⚠ Please select Animal Infestation level');return;}
  if(!formState.bintik){showToast('⚠ Please select Disease Infestation level');return;}
  if(!formState.warna) {showToast('⚠ Please select Leaf Condition');return;}
  if(!formState.photo) {showToast('⚠ Please upload a photo');return;}

  setLoading(true);
  try{
    let photoUrl=formState.photo;
    if(photoUrl&&photoUrl.startsWith('data:'))
      photoUrl=await sb.uploadPhoto('audit-photos','plot_'+plot+'_'+Date.now(),photoUrl);
    const payload={
      nursery:formState.nursery,plot,batch:batch,
      pest:formState.ulat,tikus:formState.tikus,disease:formState.bintik,
      warna_daun:formState.warna,photo_url:photoUrl||null,date:todayISO()
    };
    if(editMode&&editId){await sb.update('plot_audits',editId,payload);showToast('✓ Record updated');}
    else{payload.audit_id=nextID(formState.nursery);await sb.insert('plot_audits',payload);showToast('✓ Record saved');}
    await loadRecords();setView('list');
  }catch(e){showToast('⚠ Save failed');console.error(e);setLoading(false);}
}

/* --- DETAIL --- */
function openDetail(uid){
  const r=records.find(x=>x.uid===uid);if(!r)return;
  detailId=uid;
  const heroImg=document.getElementById('detail-hero-img');
  const heroPh=document.getElementById('detail-hero-placeholder');
  if(r.photo){heroImg.src=r.photo;heroImg.style.display='block';heroPh.style.display='none';}
  else{heroImg.style.display='none';heroPh.style.display='flex';}
  document.getElementById('detail-nursery-tag').textContent=NURSERY_LABELS[r.nursery];
  document.getElementById('detail-id').textContent=r.id;
  document.getElementById('detail-date').textContent=fmtDate(r.date);
  document.getElementById('detail-plot').textContent=r.plot;
  document.getElementById('detail-batch').textContent=r.batch?'Batch: '+r.batch:'';
  [['detail-ulat-val','ulat'],['detail-tikus-val','tikus'],['detail-bintik-val','bintik']].forEach(([elId,field])=>{
    const el=document.getElementById(elId);
    el.textContent=r[field]||'—';
    el.className='detail-cell-val '+(r[field]==='Banyak'?'val-b':r[field]==='Sedikit'?'val-s':'val-t');
  });
  const wb=document.getElementById('detail-warna-box');
  wb.style.background=WARNA_BG[r.warna]||'#888';
  document.getElementById('detail-warna-label').textContent='Leaf Condition — '+(WARNA_LBL[r.warna]||'—');
  document.getElementById('detail-warna-desc').textContent='Ranking '+r.warna+' of 5';
  setView('detail');
}
function closeDetail(){setView('list');}
function editFromDetail(){if(detailId)openEdit(detailId);}

/* --- LIGHTBOX --- */
function openLightbox(src){
  const lb=document.getElementById('lightbox');
  document.getElementById('lightbox-img').src=src;
  lb.classList.add('open');
}
function closeLightbox(){document.getElementById('lightbox').classList.remove('open');}

/* --- DELETE --- */
function confirmDelete(uid){deleteTarget=uid;document.getElementById('modal-overlay').classList.add('show');}
function cancelDelete(){deleteTarget=null;document.getElementById('modal-overlay').classList.remove('show');}
async function doDelete(){
  if(!deleteTarget)return;
  document.getElementById('modal-overlay').classList.remove('show');
  setLoading(true);
  try{
    await sb.delete('plot_audits',deleteTarget);deleteTarget=null;
    await loadRecords();showToast('Record deleted');
    if(activeView==='detail')setView('list');
  }catch(e){showToast('⚠ Delete failed');console.error(e);setLoading(false);}
}

/* --- INIT --- */
function init(){
  const d=document.getElementById('nav-today');if(d)d.textContent=fmtDate(todayISO());
  document.getElementById('fab').addEventListener('click',openAddForm);
  document.getElementById('modal-overlay').addEventListener('click',e=>{
    if(e.target===document.getElementById('modal-overlay'))cancelDelete();
  });
  document.getElementById('lightbox').addEventListener('click',e=>{
    if(e.target===document.getElementById('lightbox'))closeLightbox();
  });
  selectTab('PN');
  loadRecords();
}
document.addEventListener('DOMContentLoaded',init);