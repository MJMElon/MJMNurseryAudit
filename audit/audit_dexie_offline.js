/* BUILD: 2026-10-08b */
/* ================================================================
   MJM NURSERY AUDIT — OFFLINE STORAGE v5
   dexie_offline.js

   RULES:
   1. Online  → save to Supabase directly. If fails → queue.
   2. Offline → queue immediately. Never lose data.
   3. Auto-sync every 30s when online.
   4. smartSave NEVER throws — always returns {offline:true} or result.
================================================================ */

/* "Sept" → "Sep" everywhere a date is formatted with the short month
   name — same patch as shared/shared_nelos_dock.js (see the comment
   there for why), added here too since audit_index.html loads this file
   without either of the two shared scripts that normally carry the
   patch. The guard keeps a page loading more than one of these from
   wrapping twice. */
(function () {
  if (Date.prototype._mjmSeptPatched) return;
  Date.prototype._mjmSeptPatched = true;
  const _toLocaleDateString = Date.prototype.toLocaleDateString;
  Date.prototype.toLocaleDateString = function (...args) {
    return _toLocaleDateString.apply(this, args).replace(/Sept\b/g, 'Sep');
  };
  const _toLocaleString = Date.prototype.toLocaleString;
  Date.prototype.toLocaleString = function (...args) {
    return _toLocaleString.apply(this, args).replace(/Sept\b/g, 'Sep');
  };
})();

/* ── Load Dexie (local first, CDN fallback) ── */
async function loadDexie(){
  if(window.Dexie) return;
  await new Promise((res, rej) => {
    const tryLoad = (src, next) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = next || rej;
      document.head.appendChild(s);
    };
    tryLoad('./audit_dexie.min.js', () =>
      tryLoad('https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.min.js')
    );
  });
}

/* ── DB ── */
let _db = null;
async function getDB(){
  if(_db && _db.isOpen()) return _db;
  await loadDexie();
  _db = new Dexie('MJMAuditV5');
  _db.version(1).stores({
    queue:  '++id, synced, created_at',
    photos: '++id, qkey, field'
  });
  await _db.open();
  return _db;
}

/* ── Photo storage ── */
async function storePhoto(qkey, field, data){
  const db = await getDB();
  await db.photos.where({qkey, field}).delete();
  await db.photos.add({qkey, field, data, created_at: Date.now()});
}
async function loadPhoto(qkey, field){
  const db = await getDB();
  const r = await db.photos.where({qkey, field}).first();
  return r ? r.data : null;
}
async function removePhotos(qkey){
  const db = await getDB();
  await db.photos.where({qkey}).delete();
}

/* ── Queue ── */
async function enqueue(table, method, payload, editId){
  const db = await getDB();
  const id = await db.queue.add({
    table, method,
    payload: JSON.stringify(payload),
    edit_id: editId ? String(editId) : null,
    synced: 0, retries: 0,
    created_at: Date.now()
  });
  refreshBadge();
  return id;
}
/* Queued and still worth retrying. Blocked rows are excluded so a
   permanently-refused record does not make every sync report a failure
   forever — but it stays in the table, and stays in the badge. */
async function getPending(){
  const db = await getDB();
  const rows = await db.queue.where({synced:0}).sortBy('created_at');
  return rows.filter(r => !r.blocked);
}
async function countPending(){
  return (await getPending()).length;
}

/* Parked: the server refused these and will keep refusing until
   something is fixed on its side. */
async function getBlocked(){
  const db = await getDB();
  const rows = await db.queue.where({synced:0}).sortBy('created_at');
  return rows.filter(r => r.blocked);
}
async function countBlocked(){
  return (await getBlocked()).length;
}

/* Un-park everything and try again — what to call once the RLS policy
   or the missing profile has been sorted out. */
async function retryBlocked(){
  const db = await getDB();
  const rows = await getBlocked();
  for(const r of rows){
    await db.queue.update(r.id, {blocked:0, retries:0, last_error:null});
  }
  console.log('[Sync] Un-parked', rows.length, 'record(s)');
  refreshBadge();
  if(rows.length && navigator.onLine) await syncNow();
  return rows.length;
}
window.retryBlocked = retryBlocked;

/* Drop stuck records permanently — the escape hatch for the audit
   whose linked batch or task no longer exists on the server. Retrying
   would just fail again with the same 23503, so the sensible action
   is discarding. Called from the badge tap when only blocked rows
   are left in the queue. */
async function discardBlocked(){
  const db = await getDB();
  const rows = await getBlocked();
  const ids  = rows.map(r => r.id);
  if(ids.length) await db.queue.bulkDelete(ids);
  console.log('[Sync] Discarded', ids.length, 'blocked record(s)');
  refreshBadge();
  return ids.length;
}
window.discardBlocked = discardBlocked;

/* There WAS an auto-drop here that DELETED any blocked record parked
   longer than five minutes, on every page load and before every sync. It
   was meant to stop the badge nagging about something transient.

   What it actually deleted was completed audits. The sync loop below says
   it plainly — "a permanently-refused record is exactly the one worth
   keeping: fix the permission and it still needs to go up" — and then
   this threw it away five minutes later, silently, with nothing on screen
   to say a plot's audit had ever existed.

   The badge nagging is the correct behaviour for work that has not
   reached the server. It stops when the record syncs, or when somebody
   reads the reason and decides to let it go — which the badge tap now
   actually offers, having never once managed to before.

   Nothing replaces it. A record leaves this queue by succeeding, or by
   being discarded on purpose. */
async function setDone(id){
  const db = await getDB();
  await db.queue.update(id, {synced:1});
}
async function clearDone(){
  const db = await getDB();
  await db.queue.where({synced:1}).delete();
}

/* ── Photo upload helper ── */
async function uploadPhoto(table, field, base64){
  const name = `${table}_${field}_${Date.now()}`;
  return await sb.uploadPhoto('audit-photos', name, base64);
}

/* Write an uploaded photo url into the queued payload, so the record
   stops depending on a photo that is about to be deleted from the phone.
   The local item is updated too, so a retry within the same sweep sees
   it. */
async function _rememberPhotoUrl(item, field, url){
  try{
    const db = await getDB();
    const p  = JSON.parse(item.payload);
    p[field] = url;
    item.payload = JSON.stringify(p);
    await db.queue.update(item.id, {payload: item.payload});
  }catch(e){
    console.warn('[Sync] could not write the photo url back:', e.message);
  }
}

/* ── Timeout wrapper ──
   The timer is cleared when the work wins the race. It was not, which on
   a sweep of sixty-nine records left sixty-nine live timers behind,
   each still holding its closure for forty-five seconds after the thing
   it was watching had finished. */
function withTimeout(p, ms){
  let t;
  return Promise.race([
    Promise.resolve(p).finally(()=>clearTimeout(t)),
    new Promise((_,r)=>{ t = setTimeout(()=>r(new Error('timeout '+ms+'ms')), ms); })
  ]);
}

/* ================================================================
   ERROR READING

   sb throws `Supabase error 403: {"code":"42501","details":null,...}`.
   The toast used to print the first 110 characters of that, which on a
   phone is the status and the opening brace — the table name and the
   reason are past the cut. A whole afternoon can go by looking at
   "1 failed to sync: 403: {"code":"42501","details":null,"hint":null".

   So: pull the code out of the JSON and say what it means in words.
   The raw body still goes to the console for anyone who wants it.
================================================================ */
function parseSbError(e){
  const raw = (e && e.message ? e.message : String(e));
  const m   = raw.match(/^Supabase error (\d+):\s*([\s\S]*)$/);
  const out = { status: m ? Number(m[1]) : 0, code:'', message:'', raw };
  if(!m) return out;
  try{
    const body = JSON.parse(m[2]);
    out.code    = body.code    || '';
    out.message = body.message || '';
    out.hint    = body.hint    || '';
  }catch(err){
    out.message = m[2].slice(0, 200);
  }
  return out;
}

/* True when retrying is pointless — the server has made a decision that
   another attempt will not change. These must never be discarded: the
   record is still good, it is the permission or the linked row that is
   wrong, and both are fixable without the auditor re-keying anything. */
function isPermanentError(p){
  return p.code === '42501'        // RLS refused the row
      || p.code === '23503'        // referenced row missing
      || p.status === 401
      || p.status === 403;
}

/* Plain-language reason, short enough to survive a toast. */
function describeSbError(e){
  const p = parseSbError(e);

  if(p.code === '42501' || p.status === 403){
    // Recover the table name the truncated toast used to hide.
    const t = (p.message.match(/table "([^"]+)"/) || [])[1];
    return 'Not allowed to save' + (t ? ' to ' + t : '') +
           '. Your login lacks database permission (RLS) — ask an admin; '
         + 'the record is kept on this phone.';
  }
  if(p.status === 401 || /JWT|token/i.test(p.message)){
    return 'Login expired. Sign in again — the record is kept on this phone.';
  }
  if(/photo upload rejected/i.test(p.raw)){
    // sb records the storage reason; without it this is just "failed".
    const why = (typeof sb !== 'undefined' && sb.lastPhotoError) || '';
    return 'Photo did not upload'
         + (/not found|404/i.test(why) ? ' — the audit-photos bucket is missing' : '')
         + (/403|row-level|policy/i.test(why) ? ' — storage permission refused it' : '')
         + '. The record and photo are kept on this phone.';
  }
  if(p.code === '23505') return 'Already saved (duplicate record).';
  if(p.code === '23503') return 'A linked record (batch or task) is missing.';
  if(/timeout/i.test(p.raw)) return 'Server did not answer in time — will retry.';

  return (p.message || p.raw).slice(0, 140);
}

/* ================================================================
   SMART SAVE
================================================================ */
async function smartSave(table, method, payload, editId=null){

  /* Online path */
  if(navigator.onLine){
    try{
      /* Upload photos first (15s total timeout) */
      const clean = {...payload};
      const photoUploads = [];
      for(const f of Object.keys(clean)){
        const v = clean[f];
        if(v && typeof v==='string' && v.startsWith('data:')){
          /* A failed upload used to become clean[f] = null and the record
             saved anyway — photo-less, silently, on a form that marks the
             photo required. Fail the online save instead: the catch below
             queues it, the photo is kept in IndexedDB, and the sync retries
             it. Slower, but the photo survives. */
          photoUploads.push(
            uploadPhoto(table, f, v).then(url => {
              if(!url) throw new Error('photo upload rejected for '+f);
              clean[f] = url;
            })
          );
        }
      }
      if(photoUploads.length) await withTimeout(Promise.all(photoUploads), 15000);

      /* Save record (8s timeout) */
      const result = await withTimeout(
        method==='insert' ? sb.insert(table, clean) : sb.update(table, editId, clean),
        8000
      );
      console.log('[SmartSave] ✅ Saved online:', table);
      return result;

    }catch(e){
      console.warn('[SmartSave] Online failed:', e.message, '→ queuing');
      /* Fall through to queue */
    }
  }

  /* Offline path — store photos in IndexedDB */
  try{
    const qkey = 'q'+Date.now()+Math.random().toString(36).slice(2,6);
    const stored = {...payload};
    for(const f of Object.keys(stored)){
      const v = stored[f];
      if(v && typeof v==='string' && v.startsWith('data:')){
        try{
          await storePhoto(qkey, f, v);
          stored[f] = `__IMG__:${qkey}:${f}`;
        }catch(e){
          stored[f] = null;
        }
      }
    }
    stored.__qkey = qkey;
    await enqueue(table, method, stored, editId);
    console.log('[SmartSave] 📴 Queued:', table);
    refreshBadge();
    return {offline: true};
  }catch(e){
    console.error('[SmartSave] Queue failed:', e.message);
    return {offline: true}; // never throw
  }
}

/* ================================================================
   SYNC
================================================================ */
let _syncing = false;
/* When the sweep that owns the flag started. A sweep cannot outlive
   CEILING because every call inside it is now wrapped in a timeout, so a
   flag older than that belongs to a sweep that will never come back --
   from the version of this file that wrapped none of them, still sitting
   in a phone cache. Without this, those phones stay frozen until somebody
   clears site data: _syncing is set, so the 30s timer returns at once,
   every tap answers "already syncing", and a reload sets it again on the
   same stalled upload. */
let _syncStartedAt = 0;
const SYNC_CEILING_MS = 10 * 60 * 1000;

/* What the banner says while a sweep is in flight. A badge that reads
   the same number for four minutes is, on a phone, indistinguishable
   from one that has stopped -- which is the whole of what was reported.
   null when no sweep is running. */
let _syncProgress = null;

/* A sweep that stops answering must not stop the queue. smartSave has
   always wrapped its upload and its insert in a timeout; the sweep
   wrapped neither, so one stalled upload on a weak signal held the
   for-loop on item one for ever and the other sixty-eight were never
   tried -- which is why none of them had reached the five-try park. The
   photo gets longer because it is the bigger body of the two. */
const UPLOAD_TIMEOUT_MS = 45000;
const INSERT_TIMEOUT_MS = 20000;

/* manual=true is a person tapping the Sync button, not the 30s timer
   or the 'online' event. The two silent early-returns below (already
   syncing, offline, nothing pending) are correct behaviour either way
   — the difference is only whether a tap that lands on one of them
   gets told so. A button that sometimes does nothing with no
   explanation reads as broken; the 30s poll doing the same thing
   quietly is what "automatic" is supposed to look like. */
async function syncNow(manual){
  if(_syncing){
    /* Taking over is safe: the abandoned sweep marks an item done only
       after the server has taken it, so the worst the two can do is try
       the same record twice -- and a second insert of a row already
       there comes back 23505, which this loop already retires quietly. */
    if(_syncStartedAt && (Date.now() - _syncStartedAt) > SYNC_CEILING_MS){
      console.warn('[Sync] Previous sweep never came back after',
                   Math.round((Date.now()-_syncStartedAt)/1000), 's - taking over');
      _syncing = false;
    } else {
      console.log('[Sync] Already running');
      if(manual) showToast('🔄 Already syncing…');
      return;
    }
  }
  if(!navigator.onLine){
    console.log('[Sync] No network');
    if(manual) showToast('📴 You\'re offline — records stay saved on this phone and sync automatically once you\'re back online.');
    return;
  }

  const pending = await getPending();
  if(!pending.length){
    /* Online with nothing waiting IS a successful sync — everything this
       phone recorded is on the server. The pill's stamp says so. */
    stampSyncOk();
    renderSyncPill();
    if(manual) showToast('✓ Already up to date — nothing to sync.');
    return;
  }

  _syncing = true;
  _syncStartedAt = Date.now();
  console.log('[Sync] Starting:', pending.length, 'pending');

  let ok=0, fail=0, lastErr='';

  try{
  _syncProgress = {done:0, total:pending.length};
  refreshBadge();

  for(const item of pending){
    try{
      let p = JSON.parse(item.payload);
      const qkey = p.__qkey;
      delete p.__qkey;

      /* Restore photos */
      for(const f of Object.keys(p)){
        const v = p[f];
        if(typeof v!=='string') continue;
        if(v.startsWith('__IMG__:')){
          const [,rKey,rField] = v.split(':');
          const data = await loadPhoto(rKey, rField);
          if(data){
            /* removePhotos() used to run whether or not the upload worked,
               because uploadPhoto returns null on failure rather than
               throwing — so a rejected upload deleted the only copy of the
               photo. Delete the local one only once it is safely uploaded,
               and let a failure abort the item so it retries with the photo
               still in hand. */
            const url = await withTimeout(uploadPhoto(item.table, rField, data), UPLOAD_TIMEOUT_MS);
            if(!url) throw new Error('photo upload rejected for '+rField);
            p[f] = url;
            /* The url goes into the QUEUE ROW before the photo leaves the
               phone, and before the insert that may still refuse. It used
               to live only in this local p: the photo was deleted, the
               insert failed, and the row went back to the queue still
               saying __IMG__. The next sweep looked for a photo that was
               no longer there, read null, and saved the audit photo-less
               -- on a form that makes the photo compulsory, with nothing
               on screen to say a picture had ever been taken. */
            await _rememberPhotoUrl(item, f, url);
            await removePhotos(rKey);
          } else { p[f]=null; }
        } else if(v.startsWith('data:')){
          const url = await withTimeout(uploadPhoto(item.table, f, v), UPLOAD_TIMEOUT_MS);
          if(!url) throw new Error('photo upload rejected for '+f);
          p[f] = url;
          await _rememberPhotoUrl(item, f, url);
        }
      }

      /* Save */
      if(item.method==='insert') await withTimeout(sb.insert(item.table, p), INSERT_TIMEOUT_MS);
      else await withTimeout(sb.update(item.table, item.edit_id, p), INSERT_TIMEOUT_MS);

      await setDone(item.id);
      ok++;
      console.log('[Sync] ✅ Done:', item.table, item.id);

    }catch(e){
      const p = parseSbError(e);

      /* A duplicate key means the row reached the table on an earlier
         attempt and only the acknowledgement was lost. It is saved.
         Counting that as a failure leaves a record in the queue that can
         never succeed, so retire it quietly. */
      if(p.code === '23505'){
        await setDone(item.id);
        ok++;
        console.log('[Sync] ✅ Already present:', item.table, item.id);
        continue;
      }

      fail++;
      lastErr  = describeSbError(e);
      const retries = (item.retries||0)+1;
      console.error('[Sync] ❌', item.id, item.table, 'try:', retries, p.raw);
      const db = await getDB();

      /* "Gave up" used to mean setDone(), and setDone() is followed by
         clearDone(), which DELETES. So a record the server kept
         refusing was erased after five tries — with auto-sync at 30s,
         about two and a half minutes from the first failure, silently.
         A permanently-refused record is exactly the one worth keeping:
         fix the permission and it still needs to go up.

         Park it instead. Blocked rows stop being retried, stay in the
         queue, and show in the badge until they sync or are dropped
         on purpose. */
      if(isPermanentError(p)){
        await db.queue.update(item.id, {
          retries, blocked: 1, last_error: lastErr, blocked_at: Date.now()
        });
        console.warn('[Sync] Parked (needs a fix server-side):', item.id, item.table);
      } else if(retries >= 5){
        await db.queue.update(item.id, {
          retries, blocked: 1, last_error: lastErr, blocked_at: Date.now()
        });
        console.warn('[Sync] Parked after 5 tries:', item.id, item.table);
      } else {
        await db.queue.update(item.id, {retries});
      }
    }
    /* After the item, whichever way it went. Sixty-nine audits with a
       photo each is minutes of work; the number has to come down while
       it happens or the person watching has no way to tell this apart
       from the thing they reported. */
    _syncProgress.done++;
    refreshBadge();
  }

  await clearDone();
  }finally{
    /* clearDone and refreshBadge sit outside every try in the loop. One
       of them throwing used to leave the flag set, and a set flag is a
       phone that never syncs again -- no timer, no tap, no reload. */
    _syncing = false;
    _syncStartedAt = 0;
    _syncProgress = null;
  }
  refreshBadge();
  if(fail===0) stampSyncOk();
  renderSyncPill();

  if(ok>0){
    showToast('✓ Synced '+ok+' record'+(ok>1?'s':''));
    setTimeout(()=>{ if(typeof loadRecords==='function') loadRecords(); }, 500);
    setTimeout(()=>{ if(typeof loadAll==='function') loadAll(); }, 500);
  }
  /* Show why, not just that. The reason is almost always a rejection from
     Supabase (duplicate id, missing batch/task, RLS), not the network — and
     tapping again will never fix it, so the reason has to reach the phone. */
  if(fail>0) showToast('⚠ '+fail+' failed to sync — '+(lastErr||'unknown error'), 7000);

  /* A record parked earlier is invisible while anything is still
     waiting: the badge only offers its reason when NOTHING is pending,
     and the tap goes to the sync instead. So a phone reading
     "69 pending (1 stuck)" never says what the one is -- and that one is
     a finished audit of a real plot. Say it at the foot of a clean
     sweep, when there is nothing else competing for the toast. */
  if(fail===0 && ok>0){
    const parked = await getBlocked();
    if(parked.length){
      showToast('⚠ '+parked.length+' record'+(parked.length>1?'s':'')+' still stuck — '
              + (parked[0].last_error || 'reason not recorded'), 8000);
    }
  }
}

/* ================================================================
   SYNC PILL — the visible button, and the last time a sync WORKED

   The top badge only exists while something is pending or stuck; this
   sits at the foot of every signed-in page all the time, so an auditor
   about to walk out of coverage can press one thing and read when the
   phone was last fully squared with the server. The stamp only moves on
   a sweep that came back clean (or found nothing waiting while online),
   so the time it shows can be trusted the way it reads. Same card, same
   rule, on the FC and Admin portal dashboards.
================================================================ */
const SYNC_STAMP_KEY = 'mjm_audit_last_sync_v1';
function stampSyncOk(){
  try{ localStorage.setItem(SYNC_STAMP_KEY, JSON.stringify({at: Date.now()})); }catch(e){}
}
function lastSyncAt(){
  try{ const s = JSON.parse(localStorage.getItem(SYNC_STAMP_KEY)); return (s && s.at) || null; }catch(e){ return null; }
}
function fmtSyncWhen(at){
  try{
    return new Date(at).toLocaleString(undefined, {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'});
  }catch(e){ return ''; }
}
function renderSyncPill(){
  try{
    // Not on the login page — a pill about a signed-in phone's queue has
    // nothing to say to somebody who has not signed in.
    if(!localStorage.getItem('mjm_user')){
      const gone = document.getElementById('_sync_pill');
      if(gone) gone.remove();
      return;
    }
    let p = document.getElementById('_sync_pill');
    if(!p){
      p = document.createElement('button');
      p.id = '_sync_pill';
      p.style.cssText = 'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:9998;'+
        'padding:8px 16px;border-radius:9999px;border:none;font-size:11px;font-weight:800;'+
        'letter-spacing:.04em;color:#fff;background:rgba(31,122,69,.92);'+
        'box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer;font-family:inherit';
      p.onclick = async ()=>{
        if(!navigator.onLine){
          showToast('📴 Offline — sync needs a line. Saved records send themselves when it returns.');
          return;
        }
        showToast('🔄 Syncing…', 1500);
        await syncNow();
        renderSyncPill();
        if((await countPending())===0) showToast('✓ Synced');
      };
      document.body.appendChild(p);
    }
    const at = lastSyncAt();
    p.textContent = '🔄 Sync' + (at ? ' · ✓ '+fmtSyncWhen(at) : ' · not yet');
    p.style.background = navigator.onLine ? 'rgba(31,122,69,.92)' : 'rgba(120,120,120,.85)';
  }catch(e){}
}

/* ================================================================
   BADGE
================================================================ */
/* This is the Sync button. It used to only exist while something was
   queued — tap-to-sync, then vanish once the queue drained — which
   meant there was never a way to ASK for a sync on demand: nothing to
   tap when the queue was already empty, and no visible control at all
   on a page that happened to have nothing pending yet. It is a
   permanent fixture now, in every state, so "trigger a sync manually
   at any time" has something to press regardless of whether anything
   is actually waiting. */
async function refreshBadge(){
  try{
    const n       = await countPending();
    const blocked = await countBlocked();
    let b = document.getElementById('_offl_badge');
    if(!b){
      b = document.createElement('div');
      b.id = '_offl_badge';
      b.setAttribute('role','button');
      b.setAttribute('tabindex','0');
      b.onclick = async ()=>{
        const blk = await countBlocked();
        const pen = await countPending();
        /* Stuck-only badge → the queue holds records the server keeps
           refusing (RLS, a missing batch, an expired login). The auditor
           needs the REASON first; nothing else they can do is useful
           without it.

           `pen === 0`, not `pen === blk`. getPending() excludes blocked
           rows, so pending can never equal blocked once anything is
           parked — this read `0 === 2` and was false every time the badge
           said "tap to clear". The tap fell through to retryBlocked(),
           which un-parked the records, re-sent them, got the same refusal
           and parked them again with a fresh blocked_at. The banner came
           straight back, no dialog, no reason, and the 5-minute stale
           sweep never fired because every tap reset its clock. Tapping
           harder was the one thing that guaranteed it would not clear.

           The badge's own test above is `blocked>0 && n===0`. This is
           the same question and must be asked the same way. */
        if(blk > 0 && pen === 0){
          const why    = (await getBlocked())[0];
          const reason = (why && why.last_error) ? why.last_error : 'sync failed';
          const noun   = blk+' record'+(blk>1?'s':'');
          /* Try again FIRST. Once an admin has fixed the permission or
             restored the linked row, re-sending is all that is wanted —
             and these are somebody's completed audits, so the button that
             throws them away is not the one under your thumb. */
          const msg    = noun+' could not be sent to the server.\n\n'
                       + 'Reason: '+reason+'\n\n'
                       + 'OK — try sending again now.\n'
                       + 'Cancel — other options, including deleting them.';
          if(confirm(msg)){
            showToast('🔄 Trying again…', 1500);
            await retryBlocked();
            // retryBlocked syncs; whatever comes back has already toasted
            // its own reason. Say so plainly when nothing changed.
            if(await countBlocked()) showToast('Still stuck — the reason above has not been fixed yet.', 6000);
            return;
          }
          /* Before the delete, the way to SEE what is here. Diagnostics
             reads the outbox out of this phone and names every record
             and its reason — which is the thing somebody needs in front
             of them before throwing a finished audit away. */
          if(confirm('Open Diagnostics to see exactly what is waiting and why?\n\n'
                   + 'OK — open it.\n'
                   + 'Cancel — go on to deleting them.')){
            location.href = 'audit_diagnostics.html';
            return;
          }
          /* Deleting a completed audit is behind its own question, and
             says what it costs. */
          if(confirm('Delete '+noun+' permanently?\n\n'
                   + 'The work recorded in '+(blk>1?'them':'it')+' will be lost and '
                   + 'the plot'+(blk>1?'s':'')+' will show as not audited. '
                   + 'This cannot be undone.')){
            await discardBlocked();
            showToast('Deleted '+noun);
          }
          return;
        }
        if(!navigator.onLine){ syncNow(true); return; }   // shows the offline toast
        if(blk) await retryBlocked();
        else await syncNow(true);
      };
      b.onkeydown = e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); b.click(); } };
      b.style.cssText = 'position:fixed;top:0;left:0;right:0;margin:0 auto;width:fit-content;max-width:480px;padding:5px 18px;border-radius:0 0 12px 12px;font-size:11px;font-weight:700;z-index:99999;cursor:pointer;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.3);text-align:center;transition:background .15s';
      document.body.appendChild(b);
    }
    /* Sits under the cannot-save warning when there is one. A record
       waiting to go up matters; a login that can never send it matters
       more, and the two must not be drawn on top of each other. */
    const warn = document.getElementById('_save_check_bar');
    b.style.top = warn ? (warn.offsetHeight + 'px') : '0';
    if(blocked>0 && n===0){
      // Nothing is going to happen on its own — say so, and prompt the
      // tap that surfaces the confirm dialog (reason + Delete option).
      b.style.background = '#b91c1c';
      b.textContent = '⚠ '+blocked+' record'+(blocked>1?'s':'')+' stuck — tap to clear';
    } else if(n>0){
      b.style.background = navigator.onLine ? '#2d7a2d' : '#f59e0b';
      b.textContent = !navigator.onLine
        ? '📴 Offline — '+n+' record'+(n>1?'s':'')+' saved locally'
        : _syncProgress
          /* Mid-sweep. Each of these carries a photo, so a sweep is
             minutes long and the count only falls as each one lands. */
          ? '🔄 Sending '+(_syncProgress.done+1)+' of '+_syncProgress.total+'…'
          : '🔄 '+n+' pending — tap to sync now'
            + (blocked ? ' ('+blocked+' stuck)' : '');
    } else if(navigator.onLine){
      // Idle: everything is already synced. Quiet on purpose — this is
      // not a state anyone needs to react to — but still there, still
      // the same tap target, so a sync can be asked for even when
      // nothing is known to be waiting.
      b.style.background = '#f4f7f4';
      b.style.color = '#3d5c3d';
      b.style.boxShadow = '0 1px 4px rgba(0,0,0,.12)';
      b.textContent = '✓ Synced — tap to check for updates';
    } else {
      b.style.background = '#64748b';
      b.style.color = '#fff';
      b.style.boxShadow = '0 2px 8px rgba(0,0,0,.3)';
      b.textContent = '📴 Offline — tap Sync when you\'re back online';
    }
  }catch(e){}
}
function showOfflineBadge(){ refreshBadge(); }

/* ================================================================
   ASK BEFORE THE WORK, NOT AFTER IT

   Twice in one week an auditor filled in a day of audits and only then
   found out the database would not take them — seventy of them on one
   phone, and nobody in the office knew for days, because the only thing
   that ever asked the question was the save itself.

   So the phone asks at sign in. audit_can_i_save() answers per table by
   reading the real policy out of the catalogue
   (shared/RUN_ME_audit_save_check.sql), and if the answer is no this bar
   says so before the first form is opened.

   It FAILS OPEN, for the same reason everything else here does: a null
   answer is the function not being there or the network being out, not a
   refusal, and a check that cannot run must never take the module away
   from somebody who was working fine a minute ago. Only an explicit no
   from the database puts the bar up.
================================================================ */
const SAVE_CHECK_KEY = 'mjm_audit_save_check_v1';

function _saveCheckBar(refused){
  let b = document.getElementById('_save_check_bar');
  if(!refused || !refused.length){ if(b){ b.remove(); refreshBadge(); } return; }
  if(!b){
    b = document.createElement('div');
    b.id = '_save_check_bar';
    b.setAttribute('role','alert');
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99998;padding:9px 14px;'
      + 'background:#b91c1c;color:#fff;font-size:12px;font-weight:700;line-height:1.45;'
      + 'text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.35);cursor:pointer';
    /* Tapping goes where the detail is, rather than opening a dialog that
       repeats the one sentence already on screen. */
    b.onclick = ()=>{ location.href = 'audit_diagnostics.html'; };
    document.body.appendChild(b);
  }
  /* The whole module, or one kind of audit: these read very differently
     to somebody about to start a round, so they are said differently. */
  const all = refused.length >= 6;
  b.textContent = '⚠ This login cannot save '
    + (all ? 'audits' : refused.map(r => _AUDIT_LABEL[r.tbl] || r.tbl).join(', '))
    + ' — tell the office BEFORE you start. Nothing you record will reach the server. Tap for details.';
  /* The queue badge lives at the top of the screen too. This one must not
     be the one that gets covered, so the badge moves under it. */
  refreshBadge();
}

const _AUDIT_LABEL = {
  audit_plot_audits:        'plot condition audits',
  audit_height_records:     'seedling height audits',
  audit_papan_audits:       'papan tanda audits',
  audit_batches:            'batch audits',
  audit_maintenance_tasks:  'maintenance tasks',
  audit_maintenance_audits: 'maintenance audits'
};

async function checkCanSave(){
  /* Nobody signed in has nothing to be told. */
  if(!localStorage.getItem('mjm_user')) { _saveCheckBar(null); return null; }
  if(!navigator.onLine){
    /* Offline is the normal state in a nursery and says nothing about
       permission. Show the last answer if it was a no, so a conductor who
       was told yesterday is still told today. */
    try{
      const last = JSON.parse(localStorage.getItem(SAVE_CHECK_KEY) || 'null');
      if(last && last.refused && last.refused.length) _saveCheckBar(last.refused);
    }catch(e){}
    return null;
  }
  let rows = null;
  try{ rows = await withTimeout(sb.canISave(), 10000); }catch(e){ rows = null; }
  if(!rows){
    /* Could not be answered. Not a no — leave whatever is on screen alone
       and do not store an answer we do not have. */
    console.log('[SaveCheck] no answer — failing open');
    return null;
  }
  const refused = rows.filter(r => r && r.ok === false);
  try{ localStorage.setItem(SAVE_CHECK_KEY, JSON.stringify({at:Date.now(), refused})); }catch(e){}
  if(refused.length){
    console.warn('[SaveCheck] this login cannot save:',
                 refused.map(r => r.tbl + ' (' + (r.why||'') + ')').join('; '));
  } else {
    console.log('[SaveCheck] ✅ every audit table will take a row from this login');
  }
  _saveCheckBar(refused);
  return refused;
}
window.checkCanSave = checkCanSave;

/* ================================================================
   TOAST
================================================================ */
/* ms is generous for failures: a reason worth printing is a reason worth
   leaving on screen long enough to read, and these run two lines now. */
function showToast(msg, ms){
  // Use page's showToast if available
  if(window._pageShowToast) { window._pageShowToast(msg, ms); return; }
  const t = document.getElementById('toast');
  if(t){ t.textContent=msg; t.classList.add('show');
         clearTimeout(t._hide);
         t._hide = setTimeout(()=>t.classList.remove('show'), ms || 2800); }
}

/* ================================================================
   CAMERA HELPER
================================================================ */
function openCamera(inputId){
  const inp = document.getElementById(inputId);
  if(!inp) return;
  inp.setAttribute('capture','environment');
  inp.accept='image/*';
  inp.click();
  setTimeout(()=>inp.removeAttribute('capture'), 500);
}

/* ================================================================
   PHOTO COMPRESSION
================================================================ */
function compressPhoto(file, maxPx=1200, quality=0.72){
  return new Promise(resolve=>{
    const r=new FileReader();
    r.onload=e=>{
      const img=new Image();
      img.onload=()=>{
        let w=img.width,h=img.height;
        if(w>maxPx){h=Math.round(h*maxPx/w);w=maxPx;}
        const c=document.createElement('canvas');
        c.width=w;c.height=h;
        c.getContext('2d').drawImage(img,0,0,w,h);
        resolve(c.toDataURL('image/jpeg',quality));
      };
      img.onerror=()=>resolve(e.target.result);
      img.src=e.target.result;
    };
    r.onerror=()=>resolve(null);
    r.readAsDataURL(file);
  });
}

/* ================================================================
   AUTO SYNC — every 30s
================================================================ */
let _timer=null;
function startSync(){
  if(_timer) clearInterval(_timer);
  syncNow();
  _timer=setInterval(()=>{ if(navigator.onLine) syncNow(); },30000);
  console.log('[AutoSync] Started');
}
function stopSync(){
  if(_timer){ clearInterval(_timer); _timer=null; }
}

/* ================================================================
   INIT
================================================================ */
async function initOffline(){
  try{ await getDB(); }catch(e){ console.error('[DB] Failed:', e); }

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./audit_sw.js')
      .then(reg=>{
        reg.update();
        if(reg.waiting) reg.waiting.postMessage('skipWaiting');
        reg.addEventListener('updatefound',()=>{
          const sw=reg.installing;
          sw.addEventListener('statechange',()=>{
            if(sw.state==='installed'&&navigator.serviceWorker.controller)
              sw.postMessage('skipWaiting');
          });
        });
      }).catch(e=>console.warn('[SW]',e));
  }

  // A banner carried over from a previous session is a record still
  // waiting to go up, so it is shown, not swept.
  refreshBadge();
  renderSyncPill();
  /* Not awaited: a slow answer must not hold up the page an auditor is
     trying to open. */
  checkCanSave();

  window.addEventListener('online',()=>{
    console.log('[Net] Online');
    showToast('🔄 Back online — syncing...');
    refreshBadge();
    renderSyncPill();
    checkCanSave();
    startSync();
  });
  window.addEventListener('offline',()=>{
    console.log('[Net] Offline');
    showToast('📴 Offline — records saved to phone');
    stopSync();
    refreshBadge();
    renderSyncPill();
  });
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden && navigator.onLine) syncNow();
  });

  if(navigator.onLine) startSync();
}

document.addEventListener('DOMContentLoaded', initOffline);