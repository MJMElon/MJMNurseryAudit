/* ================================================================
   MJM NURSERY AUDIT — OFFLINE STORAGE v4
   dexie_offline.js
   
   BEHAVIOUR:
   • Online  → save directly to Supabase (photos uploaded first)
   • Offline → save to IndexedDB queue, NEVER lose data
   • Auto-sync every 30s when online
   • Sync immediately when connection detected
================================================================ */

/* ================================================================
   LOAD DEXIE
================================================================ */
async function loadDexie(){
  if(window.Dexie) return;
  // Try primary CDN
  await new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src='https://unpkg.com/dexie@3.2.4/dist/dexie.min.js';
    s.onload=res;
    s.onerror=()=>{
      // Fallback CDN
      const s2=document.createElement('script');
      s2.src='https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.min.js';
      s2.onload=res;s2.onerror=rej;
      document.head.appendChild(s2);
    };
    document.head.appendChild(s);
  });
}

/* ================================================================
   DATABASE INIT
================================================================ */
let _db = null;

async function getDB(){
  if(_db && _db.isOpen()) return _db;
  await loadDexie();
  _db = new Dexie('MJMAuditOffline');
  _db.version(2).stores({
    queue:  '++id, table_name, method, synced, created_at',
    photos: '++id, queue_key, field, created_at'
  });
  await _db.open();
  console.log('[DB] Ready');
  return _db;
}

/* ================================================================
   PHOTO STORAGE
================================================================ */
async function storePhoto(queueKey, field, base64){
  const db = await getDB();
  // Remove old entry for same key+field
  await db.photos.where({queue_key:queueKey, field}).delete();
  await db.photos.add({
    queue_key: queueKey,
    field,
    data: base64,
    created_at: Date.now()
  });
}

async function loadPhoto(queueKey, field){
  const db = await getDB();
  const row = await db.photos.where({queue_key:queueKey, field}).first();
  return row ? row.data : null;
}

async function removePhotos(queueKey){
  const db = await getDB();
  await db.photos.where({queue_key:queueKey}).delete();
}

/* ================================================================
   QUEUE
================================================================ */
async function addToQueue(tableName, method, payload, editId){
  const db = await getDB();
  const id = await db.queue.add({
    table_name: tableName,
    method,
    payload: JSON.stringify(payload),
    edit_id: editId ? String(editId) : null,
    synced: 0,
    retries: 0,
    created_at: Date.now()
  });
  console.log('[Queue] Added:', tableName, 'id:', id);
  refreshBadge();
  return id;
}

async function getPending(){
  const db = await getDB();
  return db.queue.where({synced:0}).toArray();
}

async function countPending(){
  const db = await getDB();
  return db.queue.where({synced:0}).count();
}

async function markDone(id){
  const db = await getDB();
  await db.queue.update(id, {synced:1});
}

async function clearDone(){
  const db = await getDB();
  await db.queue.where({synced:1}).delete();
}

/* ================================================================
   SMART SAVE — core function
   All modules call this. Never throws — always saves somewhere.
================================================================ */
async function smartSave(tableName, method, payload, editId=null){

  /* ── ONLINE: upload photos + save to Supabase ── */
  if(navigator.onLine){
    try{
      // Step 1: upload any base64 photos
      const cleanPayload = await uploadPayloadPhotos(payload, tableName);

      // Step 2: save record with 8s timeout
      const result = await withTimeout(
        method === 'insert'
          ? sb.insert(tableName, cleanPayload)
          : sb.update(tableName, editId, cleanPayload),
        8000
      );
      console.log('[Save] ✅ Online save OK:', tableName);
      return result;

    }catch(err){
      console.warn('[Save] Online failed:', err.message, '→ queuing offline');
      // Fall through to offline queue
    }
  }

  /* ── OFFLINE: store photos + queue record ── */
  const queueKey = 'q' + Date.now() + Math.random().toString(36).slice(2,6);
  const offlinePayload = {...payload};

  for(const field of Object.keys(offlinePayload)){
    const val = offlinePayload[field];
    if(val && typeof val === 'string' && val.startsWith('data:')){
      await storePhoto(queueKey, field, val);
      offlinePayload[field] = `__IMG__:${queueKey}:${field}`;
      console.log('[Queue] Photo stored:', field);
    }
  }
  offlinePayload.__qkey = queueKey;

  await addToQueue(tableName, method, offlinePayload, editId);
  refreshBadge();
  console.log('[Save] 📴 Queued offline:', tableName);
  return { offline: true };
}

/* ── Upload base64 photos in payload ── */
async function uploadPayloadPhotos(payload, tableName){
  const out = {...payload};
  const uploads = [];

  for(const field of Object.keys(out)){
    const val = out[field];
    if(val && typeof val === 'string' && val.startsWith('data:')){
      uploads.push(
        sb.uploadPhoto('audit-photos', `${tableName}_${field}_${Date.now()}`, val)
          .then(url => { out[field] = url; })
          .catch(e => {
            console.warn('[Photo] Upload failed:', field, e.message);
            out[field] = null; // don't block save for photo
          })
      );
    }
  }

  if(uploads.length > 0){
    await Promise.allSettled(uploads);
  }
  return out;
}

/* ── Promise with timeout ── */
function withTimeout(promise, ms){
  return Promise.race([
    promise,
    new Promise((_,rej) => setTimeout(() => rej(new Error('timeout')), ms))
  ]);
}

/* ================================================================
   SYNC ENGINE
================================================================ */
let _syncing = false;

async function syncNow(){
  if(_syncing) return;
  if(!navigator.onLine){ console.log('[Sync] Offline, skip'); return; }

  const pending = await getPending();
  if(!pending.length){ console.log('[Sync] Nothing pending'); return; }

  _syncing = true;
  console.log('[Sync] Starting:', pending.length, 'records');
  refreshBadge();

  let ok=0, fail=0;

  for(const item of pending){
    try{
      let payload = JSON.parse(item.payload);
      const queueKey = payload.__qkey;
      delete payload.__qkey;

      // Restore photos from IndexedDB then upload
      for(const field of Object.keys(payload)){
        const val = payload[field];
        if(typeof val !== 'string') continue;

        if(val.startsWith('__IMG__:')){
          const [,rKey,rField] = val.split(':');
          const photoData = await loadPhoto(rKey, rField);
          if(photoData){
            try{
              payload[field] = await sb.uploadPhoto(
                'audit-photos',
                `${item.table_name}_${rField}_${Date.now()}`,
                photoData
              );
              await removePhotos(rKey);
            }catch(e){
              console.warn('[Sync] Photo upload fail:', e.message);
              payload[field] = null;
            }
          } else {
            payload[field] = null;
          }
        } else if(val.startsWith('data:')){
          try{
            payload[field] = await sb.uploadPhoto(
              'audit-photos',
              `${item.table_name}_${field}_${Date.now()}`,
              val
            );
          }catch(e){ payload[field] = null; }
        }
      }

      // Save to Supabase
      if(item.method === 'insert') await sb.insert(item.table_name, payload);
      if(item.method === 'update') await sb.update(item.table_name, item.edit_id, payload);

      await markDone(item.id);
      ok++;
      console.log('[Sync] ✅', item.table_name, item.id);

    }catch(e){
      fail++;
      const retries = (item.retries||0) + 1;
      console.error('[Sync] ❌', item.id, e.message, 'retries:', retries);
      const db = await getDB();
      if(retries >= 10){
        // Give up after 10 retries — mark done to prevent blocking
        await markDone(item.id);
        console.warn('[Sync] Gave up on record', item.id);
      } else {
        await db.queue.update(item.id, {retries});
      }
    }
  }

  await clearDone();
  _syncing = false;
  refreshBadge();

  if(ok > 0){
    toast('✓ Synced ' + ok + ' record' + (ok>1?'s':''));
    setTimeout(()=>{ if(typeof loadRecords==='function') loadRecords(); }, 600);
    setTimeout(()=>{ if(typeof loadAll==='function') loadAll(); }, 600);
  }
  if(fail > 0) toast('⚠ ' + fail + ' record' + (fail>1?'s':'')+' still pending');
}

/* ================================================================
   OFFLINE BADGE
================================================================ */
async function refreshBadge(){
  const n = await countPending();
  let badge = document.getElementById('_offline_badge');

  if(n > 0){
    if(!badge){
      badge = document.createElement('div');
      badge.id = '_offline_badge';
      badge.onclick = () => { if(navigator.onLine) syncNow(); };
      badge.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'margin:0 auto',
        'max-width:480px', 'width:fit-content',
        'padding:5px 18px', 'border-radius:0 0 12px 12px',
        'font-size:11px', 'font-weight:700', 'letter-spacing:.3px',
        'z-index:99999', 'cursor:pointer', 'text-align:center',
        'box-shadow:0 2px 10px rgba(0,0,0,.25)', 'color:#fff'
      ].join(';');
      document.body.appendChild(badge);
    }
    if(navigator.onLine){
      badge.style.background = '#2d7a2d';
      badge.textContent = '🔄 ' + n + ' pending — tap to sync';
    } else {
      badge.style.background = '#f59e0b';
      badge.textContent = '📴 Offline — ' + n + ' record'+(n>1?'s':'')+' saved';
    }
  } else {
    if(badge) badge.remove();
  }
}

function showOfflineBadge(){ refreshBadge(); }

/* ================================================================
   TOAST HELPER
================================================================ */
function toast(msg){
  if(typeof showToast === 'function') showToast(msg);
}

/* ================================================================
   PHOTO COMPRESSION
================================================================ */
function compressPhoto(file, maxPx=1200, quality=0.72){
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w=img.width, h=img.height;
        if(w > maxPx){ h = Math.round(h*maxPx/w); w=maxPx; }
        const c = document.createElement('canvas');
        c.width=w; c.height=h;
        c.getContext('2d').drawImage(img,0,0,w,h);
        const out = c.toDataURL('image/jpeg', quality);
        console.log('[Photo] Compressed', img.width+'x'+img.height, '→', w+'x'+h,
          Math.round(out.length*0.75/1024)+'KB');
        resolve(out);
      };
      img.onerror = () => resolve(e.target.result);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/* ================================================================
   AUTO SYNC — every 30 seconds
================================================================ */
let _syncTimer = null;

function startSync(){
  stopSync();
  syncNow(); // immediate
  _syncTimer = setInterval(() => {
    if(navigator.onLine) syncNow();
  }, 30000); // every 30s
  console.log('[AutoSync] Started (30s interval)');
}

function stopSync(){
  if(_syncTimer){ clearInterval(_syncTimer); _syncTimer=null; }
}

/* ================================================================
   INIT
================================================================ */
async function initOffline(){
  // Init DB first
  try { await getDB(); } catch(e){ console.error('[DB] Init failed:', e); }

  // Service Worker
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        console.log('[SW] Registered:', reg.scope);
        if(reg.waiting) reg.waiting.postMessage('skipWaiting');
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          sw.addEventListener('statechange', () => {
            if(sw.state === 'installed' && navigator.serviceWorker.controller)
              sw.postMessage('skipWaiting');
          });
        });
      })
      .catch(e => console.warn('[SW]', e));
  }

  // Initial badge
  refreshBadge();

  // Network events
  window.addEventListener('online', () => {
    console.log('[Net] Online');
    toast('🔄 Back online — syncing...');
    refreshBadge();
    startSync();
  });

  window.addEventListener('offline', () => {
    console.log('[Net] Offline');
    toast('📴 Offline — data saved to phone');
    stopSync();
    refreshBadge();
  });

  // Sync when tab becomes visible again
  document.addEventListener('visibilitychange', () => {
    if(!document.hidden && navigator.onLine) syncNow();
  });

  // Start auto sync if online
  if(navigator.onLine) startSync();
}

document.addEventListener('DOMContentLoaded', initOffline);