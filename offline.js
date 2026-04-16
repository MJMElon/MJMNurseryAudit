/* ================================================================
   MJM NURSERY AUDIT — OFFLINE HELPER
   offline.js — IndexedDB queue + auto-sync
================================================================ */
const DB_NAME = 'mjm_offline';
const DB_VER  = 1;
const STORE   = 'pending_records';

/* --- Open DB --- */
function openDB(){
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, {keyPath:'localId', autoIncrement:true});
      }
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

/* --- Save a pending record to IndexedDB --- */
async function saveOffline(table, method, payload, localId=null){
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    const st = tx.objectStore(STORE);
    const record = { table, method, payload, savedAt: new Date().toISOString() };
    if(localId) record.localId = localId;
    const req = st.add(record);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

/* --- Get all pending records --- */
async function getPendingRecords(){
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

/* --- Delete a synced record --- */
async function deletePendingRecord(localId){
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(localId);
    req.onsuccess = () => res();
    req.onerror   = () => rej(req.error);
  });
}

/* --- Count pending records --- */
async function countPending(){
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

/* ================================================================
   SMART SAVE — tries Supabase first, falls back to IndexedDB
================================================================ */
async function smartSave(table, method, payload, editId=null){
  if(navigator.onLine){
    try{
      if(method==='insert') return await sb.insert(table, payload);
      if(method==='update') return await sb.update(table, editId, payload);
    }catch(e){
      // Network error — save offline
      console.warn('Online but save failed, queuing offline:', e);
    }
  }
  // Save to IndexedDB queue
  await saveOffline(table, method, {...payload, _editId: editId});
  showOfflineBadge();
  return {offline: true};
}

/* ================================================================
   AUTO SYNC — runs when connection restored
================================================================ */
async function syncPending(){
  const pending = await getPendingRecords();
  if(!pending.length) return;

  let synced = 0, failed = 0;
  for(const rec of pending){
    try{
      const {_editId, ...payload} = rec.payload;
      if(rec.method==='insert') await sb.insert(rec.table, payload);
      if(rec.method==='update') await sb.update(rec.table, _editId, payload);
      await deletePendingRecord(rec.localId);
      synced++;
    }catch(e){
      failed++;
      console.error('Sync failed for record:', rec, e);
    }
  }
  updateOfflineBadge();
  if(synced > 0){
    if(typeof showToast === 'function')
      showToast(`✓ Synced ${synced} offline record${synced>1?'s':''}`);
    if(typeof loadRecords === 'function') loadRecords();
    if(typeof loadAll === 'function') loadAll();
  }
  if(failed > 0 && typeof showToast === 'function')
    showToast(`⚠ ${failed} record${failed>1?'s':''} failed to sync`);
}

/* ================================================================
   OFFLINE BADGE UI
================================================================ */
function showOfflineBadge(){
  let badge = document.getElementById('offline-badge');
  if(!badge){
    badge = document.createElement('div');
    badge.id = 'offline-badge';
    badge.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);background:#f59e0b;color:#fff;font-size:11px;font-weight:700;padding:4px 16px;border-radius:0 0 10px 10px;z-index:99999;letter-spacing:.5px';
    document.body.appendChild(badge);
  }
  countPending().then(n => {
    badge.textContent = n > 0 ? `📴 OFFLINE — ${n} record${n>1?'s':''} pending sync` : '';
    badge.style.display = n > 0 ? 'block' : 'none';
  });
}
async function updateOfflineBadge(){
  const n = await countPending();
  const badge = document.getElementById('offline-badge');
  if(badge){
    badge.textContent = n > 0 ? `📴 OFFLINE — ${n} record${n>1?'s':''} pending sync` : '';
    badge.style.display = n > 0 ? 'block' : 'none';
  }
}

/* ================================================================
   INIT — register online/offline listeners
================================================================ */
function initOffline(){
  // Register service worker
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW reg failed:', e));
  }

  // Show badge if pending records exist
  updateOfflineBadge();

  // Auto-sync when back online
  window.addEventListener('online', () => {
    console.log('Back online — syncing...');
    if(typeof showToast === 'function') showToast('🔄 Back online — syncing...');
    setTimeout(syncPending, 1000);
  });

  // Update badge when offline
  window.addEventListener('offline', () => {
    if(typeof showToast === 'function') showToast('📴 You are offline — records will sync later');
    showOfflineBadge();
  });
}

// Run on load
document.addEventListener('DOMContentLoaded', initOffline);