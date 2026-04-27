/* ================================================================
   MJM NURSERY AUDIT — DEXIE OFFLINE STORAGE v2
   dexie_offline.js
   - Online: save directly to Supabase
   - Offline / unstable: queue to IndexedDB, auto-sync every 60s
================================================================ */

/* --- Load Dexie from CDN --- */
async function loadDexie(){
  if(window.Dexie) return;
  await new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src='https://unpkg.com/dexie@3.2.4/dist/dexie.min.js';
    s.onload=res;s.onerror=rej;
    document.head.appendChild(s);
  });
}

/* ================================================================
   DATABASE
================================================================ */
let db=null;

async function initDB(){
  if(db) return;
  await loadDexie();
  db=new Dexie('MJMAuditDB');
  db.version(1).stores({
    pending_records:'++id,table_name,method,created_at,synced',
    photos:'++id,record_key,slot,created_at'
  });
  await db.open();
}

/* ================================================================
   PHOTO STORAGE
================================================================ */
async function savePhotoOffline(recordKey,slot,base64){
  await initDB();
  await db.photos.where({record_key:recordKey,slot:String(slot)}).delete();
  return await db.photos.add({record_key:recordKey,slot:String(slot),data:base64,created_at:new Date().toISOString()});
}
async function getPhotoOffline(recordKey,slot){
  await initDB();
  const row=await db.photos.where({record_key:recordKey,slot:String(slot)}).first();
  return row?row.data:null;
}
async function deletePhotosOffline(recordKey){
  await initDB();
  await db.photos.where({record_key:recordKey}).delete();
}

/* ================================================================
   RECORD QUEUE
================================================================ */
async function queueRecord(tableName,method,payload,editId=null){
  await initDB();
  const id=await db.pending_records.add({
    table_name:tableName,method,
    payload:JSON.stringify(payload),
    edit_id:editId?String(editId):null,
    created_at:new Date().toISOString(),
    synced:0,retry_count:0
  });
  updateOfflineBadge();
  return id;
}
async function getPendingCount(){
  await initDB();
  return await db.pending_records.where({synced:0}).count();
}
async function getAllPending(){
  await initDB();
  return await db.pending_records.where({synced:0}).toArray();
}
async function markSynced(id){
  await initDB();
  await db.pending_records.update(id,{synced:1});
}
async function deleteSynced(){
  await initDB();
  await db.pending_records.where({synced:1}).delete();
}

/* ================================================================
   SMART SAVE
   - If online: try Supabase directly (5s timeout)
   - If offline OR Supabase fails: queue to IndexedDB
================================================================ */
async function smartSave(tableName,method,payload,editId=null){

  /* Try direct Supabase save if online */
  if(navigator.onLine){
    try{
      // 8 second timeout — if line is unstable, fall through to queue
      const result = await Promise.race([
        method==='insert' ? sb.insert(tableName,payload) : sb.update(tableName,editId,payload),
        new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),8000))
      ]);
      return result; // ✅ Saved directly
    }catch(e){
      console.warn('[SmartSave] Direct save failed ('+e.message+'), queuing offline...');
      // Fall through to queue below
    }
  }

  /* Queue offline — extract photos into IndexedDB */
  const recordKey='pending_'+Date.now()+'_'+Math.random().toString(36).slice(2);
  const payloadClean={...payload};

  for(const key of Object.keys(payloadClean)){
    const val=payloadClean[key];
    if(val && typeof val==='string' && val.startsWith('data:')){
      await savePhotoOffline(recordKey,key,val);
      payloadClean[key]='__PHOTO__:'+recordKey+':'+key;
    }
  }
  payloadClean._recordKey=recordKey;

  await queueRecord(tableName,method,payloadClean,editId);
  showOfflineBadge();
  return {offline:true,recordKey};
}

/* ================================================================
   SYNC ENGINE
================================================================ */
let isSyncing=false;

async function syncAll(){
  if(isSyncing) return;
  if(!navigator.onLine) return;

  const pending=await getAllPending();
  if(!pending.length) return;

  isSyncing=true;
  console.log('[Sync] Syncing',pending.length,'records...');
  let synced=0, failed=0;

  for(const rec of pending){
    try{
      let payload=JSON.parse(rec.payload);
      const recordKey=payload._recordKey;
      delete payload._recordKey;

      /* Upload photos */
      for(const key of Object.keys(payload)){
        const val=payload[key];
        if(typeof val!=='string') continue;

        if(val.startsWith('__PHOTO__:')){
          const parts=val.split(':');
          const photoData=await getPhotoOffline(parts[1],parts[2]);
          if(photoData){
            try{
              payload[key]=await sb.uploadPhoto('audit-photos',parts[2]+'_'+Date.now(),photoData);
              await deletePhotosOffline(parts[1]);
            }catch(e){
              console.warn('[Sync] Photo upload failed:',e.message);
              payload[key]=null;
            }
          } else {
            payload[key]=null;
          }
        } else if(val.startsWith('data:')){
          try{
            payload[key]=await sb.uploadPhoto('audit-photos',key+'_'+Date.now(),val);
          }catch(e){
            payload[key]=null;
          }
        }
      }

      /* Save record */
      if(rec.method==='insert') await sb.insert(rec.table_name,payload);
      if(rec.method==='update') await sb.update(rec.table_name,rec.edit_id,payload);

      await markSynced(rec.id);
      synced++;

    }catch(e){
      failed++;
      console.error('[Sync] Failed:',rec.table_name,e.message);
      const retries=(rec.retry_count||0)+1;
      if(retries>=5){
        console.warn('[Sync] Giving up on record',rec.id);
        await markSynced(rec.id);
      } else {
        await db.pending_records.update(rec.id,{retry_count:retries});
      }
    }
  }

  await deleteSynced();
  isSyncing=false;
  updateOfflineBadge();

  if(synced>0){
    console.log('[Sync] Synced',synced,'records');
    if(typeof showToast==='function') showToast('✓ Synced '+synced+' record'+(synced>1?'s':''));
    if(typeof loadRecords==='function') loadRecords();
    if(typeof loadAll==='function') loadAll();
  }
  if(failed>0 && typeof showToast==='function'){
    showToast('⚠ '+failed+' record'+(failed>1?'s':'')+' failed to sync');
  }
}

/* ================================================================
   OFFLINE BADGE
================================================================ */
async function updateOfflineBadge(){
  const n=await getPendingCount();
  let badge=document.getElementById('offline-badge');
  if(n>0){
    if(!badge){
      badge=document.createElement('div');
      badge.id='offline-badge';
      badge.style.cssText='position:fixed;top:0;left:50%;transform:translateX(-50%);font-size:11px;font-weight:700;padding:5px 16px;border-radius:0 0 10px 10px;z-index:99999;letter-spacing:.4px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.2)';
      document.body.appendChild(badge);
    }
    if(navigator.onLine){
      badge.style.background='#3d9c3d';
      badge.textContent='🔄 Syncing '+n+' record'+(n>1?'s':'')+'...';
    } else {
      badge.style.background='#f59e0b';
      badge.textContent='📴 Offline — '+n+' record'+(n>1?'s':'')+' pending';
    }
  } else {
    if(badge) badge.remove();
  }
}
function showOfflineBadge(){updateOfflineBadge();}

/* ================================================================
   PHOTO COMPRESSION
================================================================ */
function compressPhoto(file,maxWidth=1200,quality=0.75){
  return new Promise((resolve)=>{
    const reader=new FileReader();
    reader.onload=e=>{
      const img=new Image();
      img.onload=()=>{
        const canvas=document.createElement('canvas');
        let w=img.width,h=img.height;
        if(w>maxWidth){h=Math.round(h*maxWidth/w);w=maxWidth;}
        canvas.width=w;canvas.height=h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        resolve(canvas.toDataURL('image/jpeg',quality));
      };
      img.onerror=()=>resolve(e.target.result);
      img.src=e.target.result;
    };
    reader.onerror=()=>resolve(null);
    reader.readAsDataURL(file);
  });
}

/* ================================================================
   AUTO SYNC — every 60 seconds
================================================================ */
let syncInterval=null;

function startAutoSync(){
  syncAll(); // Sync immediately
  if(syncInterval) clearInterval(syncInterval);
  syncInterval=setInterval(()=>{
    if(navigator.onLine) syncAll();
  },60*1000);
}

/* ================================================================
   INIT
================================================================ */
async function initOffline(){
  await initDB();

  // Register Service Worker
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js')
      .then(reg=>{
        if(reg.waiting) reg.waiting.postMessage('skipWaiting');
        reg.addEventListener('updatefound',()=>{
          const sw=reg.installing;
          sw.addEventListener('statechange',()=>{
            if(sw.state==='installed'&&navigator.serviceWorker.controller)
              sw.postMessage('skipWaiting');
          });
        });
      })
      .catch(e=>console.warn('[SW] Failed:',e));
  }

  updateOfflineBadge();

  // Online — start auto sync
  window.addEventListener('online',()=>{
    console.log('[Offline] Back online');
    if(typeof showToast==='function') showToast('🔄 Back online — syncing...');
    updateOfflineBadge();
    startAutoSync();
  });

  // Tab regained focus — try syncing immediately
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden && navigator.onLine) syncAll();
  });

  // Offline
  window.addEventListener('offline',()=>{
    console.log('[Offline] Gone offline');
    if(typeof showToast==='function') showToast('📴 Offline — records will sync when connected');
    if(syncInterval) clearInterval(syncInterval);
    updateOfflineBadge();
  });

  if(navigator.onLine) startAutoSync();
}

document.addEventListener('DOMContentLoaded',initOffline);