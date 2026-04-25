/* ================================================================
   MJM NURSERY AUDIT — DEXIE OFFLINE STORAGE
   dexie_offline.js — IndexedDB via Dexie.js
   Auto-sync every 60 seconds when online
================================================================ */

/* --- Load Dexie from CDN --- */
const DEXIE_CDN = 'https://unpkg.com/dexie@3.2.4/dist/dexie.min.js';

async function loadDexie(){
  if(window.Dexie) return;
  await new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src=DEXIE_CDN;s.onload=res;s.onerror=rej;
    document.head.appendChild(s);
  });
}

/* ================================================================
   DATABASE SETUP
================================================================ */
let db = null;

async function initDB(){
  await loadDexie();
  db = new Dexie('MJMAuditDB');
  db.version(1).stores({
    pending_records: '++id, table_name, method, created_at, synced',
    photos:          '++id, record_key, slot, created_at'
  });
  await db.open();
  console.log('[Dexie] Database opened');
}

/* ================================================================
   PHOTO STORAGE — Store photos separately in IndexedDB
   Avoids localStorage 5MB limit
================================================================ */

/* Save photo blob/base64 to IndexedDB */
async function savePhotoOffline(recordKey, slot, base64Data){
  await initDB();
  // Remove existing photo for this slot
  await db.photos.where({record_key: recordKey, slot: String(slot)}).delete();
  const id = await db.photos.add({
    record_key: recordKey,
    slot:       String(slot),
    data:       base64Data,
    created_at: new Date().toISOString()
  });
  console.log('[Dexie] Photo saved — key:', recordKey, 'slot:', slot, 'id:', id);
  return id;
}

/* Get photo from IndexedDB */
async function getPhotoOffline(recordKey, slot){
  await initDB();
  const row = await db.photos.where({record_key: recordKey, slot: String(slot)}).first();
  return row ? row.data : null;
}

/* Delete photos for a record */
async function deletePhotosOffline(recordKey){
  await initDB();
  await db.photos.where({record_key: recordKey}).delete();
}

/* ================================================================
   RECORD QUEUE — Store pending saves
================================================================ */

async function queueRecord(tableName, method, payload, editId=null){
  await initDB();
  const id = await db.pending_records.add({
    table_name:  tableName,
    method:      method,
    payload:     JSON.stringify(payload),
    edit_id:     editId ? String(editId) : null,
    created_at:  new Date().toISOString(),
    synced:      0,
    retry_count: 0
  });
  console.log('[Dexie] Record queued — table:', tableName, 'id:', id);
  updateOfflineBadge();
  return id;
}

async function getPendingCount(){
  await initDB();
  return await db.pending_records.where({synced: 0}).count();
}

async function getAllPending(){
  await initDB();
  return await db.pending_records.where({synced: 0}).toArray();
}

async function markSynced(id){
  await initDB();
  await db.pending_records.update(id, {synced: 1});
}

async function deleteSynced(){
  await initDB();
  await db.pending_records.where({synced: 1}).delete();
}

/* ================================================================
   SMART SAVE — tries Supabase first, queues offline if fails
================================================================ */
async function smartSave(tableName, method, payload, editId=null){
  if(navigator.onLine){
    try{
      if(method === 'insert') return await sb.insert(tableName, payload);
      if(method === 'update') return await sb.update(tableName, editId, payload);
    }catch(e){
      console.warn('[SmartSave] Online save failed, queuing offline:', e.message);
    }
  }
  // Offline — extract photos and store separately
  const recordKey = 'pending_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  const payloadClean = {...payload};
  // Store any base64 photos in Dexie instead of in the payload
  for(const key of Object.keys(payloadClean)){
    if(payloadClean[key] && typeof payloadClean[key]==='string' && payloadClean[key].startsWith('data:')){
      await savePhotoOffline(recordKey, key, payloadClean[key]);
      payloadClean[key] = '__PHOTO__:' + recordKey + ':' + key;
    }
  }
  payloadClean._recordKey = recordKey;
  await queueRecord(tableName, method, payloadClean, editId);
  showOfflineBadge();
  return {offline: true, recordKey};
}

/* ================================================================
   SYNC ENGINE — uploads photos then records to Supabase
================================================================ */
let isSyncing = false;

async function syncAll(){
  if(isSyncing) return;
  if(!navigator.onLine) return;

  const pending = await getAllPending();
  if(!pending.length) return;

  isSyncing = true;
  console.log('[Sync] Starting sync of', pending.length, 'records...');

  let synced = 0, failed = 0;

  for(const rec of pending){
    try{
      let payload = JSON.parse(rec.payload);
      const recordKey = payload._recordKey;
      delete payload._recordKey;

      // Restore photos — upload to Supabase Storage
      for(const key of Object.keys(payload)){
        if(typeof payload[key]==='string' && payload[key].startsWith('__PHOTO__:')){
          const parts = payload[key].split(':');
          const rKey = parts[1];
          const slot = parts[2];
          const photoData = await getPhotoOffline(rKey, slot);
          if(photoData){
            // Upload photo to Supabase storage
            try{
              const uploadedUrl = await sb.uploadPhoto('audit-photos', slot + '_' + Date.now(), photoData);
              payload[key] = uploadedUrl;
              await deletePhotosOffline(rKey);
            }catch(uploadErr){
              console.warn('[Sync] Photo upload failed:', uploadErr);
              payload[key] = null; // Save record without photo rather than fail
            }
          } else {
            payload[key] = null;
          }
        }
      }

      // Save record to Supabase
      if(rec.method === 'insert') await sb.insert(rec.table_name, payload);
      if(rec.method === 'update') await sb.update(rec.table_name, rec.edit_id, payload);

      await markSynced(rec.id);
      synced++;
    }catch(e){
      failed++;
      console.error('[Sync] Failed for record', rec.id, ':', e.message);
      // Increment retry count
      await db.pending_records.update(rec.id, {retry_count: (rec.retry_count||0) + 1});
    }
  }

  // Clean up synced records
  await deleteSynced();

  isSyncing = false;
  updateOfflineBadge();

  if(synced > 0){
    console.log('[Sync] Synced', synced, 'records');
    if(typeof showToast === 'function') showToast('✓ Synced ' + synced + ' offline record' + (synced>1?'s':''));
    // Reload data in active module
    if(typeof loadRecords === 'function')  loadRecords();
    if(typeof loadAll     === 'function')  loadAll();
  }
  if(failed > 0){
    console.warn('[Sync] Failed to sync', failed, 'records');
    if(typeof showToast === 'function') showToast('⚠ ' + failed + ' record' + (failed>1?'s':'')+' failed to sync');
  }
}

/* ================================================================
   OFFLINE BADGE UI
================================================================ */
async function updateOfflineBadge(){
  const n = await getPendingCount();
  let badge = document.getElementById('offline-badge');
  if(n > 0){
    if(!badge){
      badge = document.createElement('div');
      badge.id = 'offline-badge';
      badge.style.cssText = [
        'position:fixed','top:0','left:50%','transform:translateX(-50%)',
        'background:#f59e0b','color:#fff','font-size:11px','font-weight:700',
        'padding:4px 16px','border-radius:0 0 10px 10px','z-index:99999',
        'letter-spacing:.4px','white-space:nowrap','box-shadow:0 2px 8px rgba(0,0,0,.2)'
      ].join(';');
      document.body.appendChild(badge);
    }
    const status = navigator.onLine ? '🔄 Syncing...' : '📴 Offline';
    badge.textContent = status + ' — ' + n + ' record' + (n>1?'s':'') + ' pending';
    badge.style.background = navigator.onLine ? '#3d9c3d' : '#f59e0b';
  } else {
    if(badge) badge.remove();
  }
}

function showOfflineBadge(){updateOfflineBadge();}

/* ================================================================
   AUTO SYNC — every 60 seconds when online
================================================================ */
let syncInterval = null;

function startAutoSync(){
  // Sync immediately on first call
  syncAll();
  // Then every 60 seconds
  if(syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(()=>{
    if(navigator.onLine){
      console.log('[AutoSync] Checking for pending records...');
      syncAll();
    }
  }, 60 * 1000);
  console.log('[AutoSync] Started — checking every 60 seconds');
}

/* ================================================================
   INIT
================================================================ */
async function initOffline(){
  // Init Dexie DB
  await initDB();

  // Register Service Worker
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        console.log('[SW] Registered:', reg.scope);
        if(reg.waiting) reg.waiting.postMessage('skipWaiting');
        reg.addEventListener('updatefound', ()=>{
          const sw = reg.installing;
          sw.addEventListener('statechange', ()=>{
            if(sw.state==='installed' && navigator.serviceWorker.controller)
              sw.postMessage('skipWaiting');
          });
        });
      })
      .catch(e => console.warn('[SW] Registration failed:', e));
  }

  // Show badge if pending records
  updateOfflineBadge();

  // Online — start auto sync
  window.addEventListener('online', ()=>{
    console.log('[Offline] Back online!');
    if(typeof showToast==='function') showToast('🔄 Back online — syncing...');
    updateOfflineBadge();
    syncAll();
    startAutoSync();
  });

  // Offline
  window.addEventListener('offline', ()=>{
    console.log('[Offline] Gone offline');
    if(typeof showToast==='function') showToast('📴 Offline — records will sync when connected');
    updateOfflineBadge();
    if(syncInterval) clearInterval(syncInterval);
  });

  // Start auto sync if already online
  if(navigator.onLine) startAutoSync();
  else updateOfflineBadge();
}

document.addEventListener('DOMContentLoaded', initOffline);