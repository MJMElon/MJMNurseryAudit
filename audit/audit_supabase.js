/* BUILD: 2026-10-22b */
/* ================================================================
   MJM NURSERY — SUPABASE SHARED CONFIG
   supabase.js
   ================================================================ */

const SUPA_URL = 'https://kibqjztozokohqmhqqqf.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpYnFqenRvem9rb2hxbWhxcXFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzQzNjIsImV4cCI6MjA4OTgxMDM2Mn0.J7qJUZhWXYf5b9oey4wXJkjdi66jomEMw_NeV9NWF7M';

/* ================================================================
   SIGNING IN TO THE DATABASE

   Every request used to go out with the anon key, so Postgres saw the
   role `anon` no matter who was logged in. The only policies on the
   audit_* tables are audit_module_read / audit_module_write, both
   "TO authenticated" (shared/migration_rls_hardening.sql), and both call
   _mjm_has_module(), which needs auth.uid(). As anon there is no uid, so
   SELECT was filtered down to zero rows — silently, because RLS filters
   rather than errors — and INSERT was refused, which is what parked
   records in the offline queue forever.

   The login already stores a real session; this just uses it. Falls back
   to the anon key when there is no session (first run, offline login),
   which is no worse than before.
================================================================ */
const SUPA_REF = SUPA_URL.replace(/^https:\/\//, '').split('.')[0];
const AUTH_STORAGE_KEY = `sb-${SUPA_REF}-auth-token`;

function storedSession() {
  try { return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || 'null'); }
  catch (e) { return null; }
}

let _refreshing = null;

/* The signed-in user's access token, refreshed if it has aged out.
   Returns null when there is no usable session — never throws. */
async function accessToken() {
  const s = storedSession();
  if (!s || !s.access_token) return null;

  // 60s of slack so a token does not expire mid-request.
  const expiresAt = (s.expires_at || 0) * 1000;
  if (!expiresAt || expiresAt - Date.now() > 60000) return s.access_token;
  if (!s.refresh_token) return null;

  // Only one refresh in flight; the rest of the page waits on the same one.
  if (!_refreshing) {
    _refreshing = fetch(`${SUPA_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'apikey': SUPA_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    })
      .then(r => r.ok ? r.json() : null)
      .then(fresh => {
        if (!fresh || !fresh.access_token) return null;
        // Write it back in the shape supabase-js stores, so the login page's
        // client picks up the same session.
        const next = Object.assign({}, s, fresh);
        next.expires_at = fresh.expires_at ||
          Math.floor(Date.now() / 1000) + (fresh.expires_in || 3600);
        try { localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(next)); } catch (e) {}
        return next.access_token;
      })
      .catch(() => null)          // offline, or the refresh token is spent
      .finally(() => { _refreshing = null; });
  }
  return _refreshing;
}

/* ================================================================
   WHO MAY DELETE

   Deleting an audit record is admin-only. This lives here, once, because
   every audit page loads this file — four copies of the same rule is how
   plot ended up with no gate at all while papan had one.

   This only decides what the screen offers. It is trivially bypassable
   from the console, so the real gate is the RLS delete policy on the
   audit_* tables (shared/migration_audit_admin_delete.sql). Keep both.
================================================================ */
/* ================================================================
   PAGE ACCESS

   audit_user_access.html has always written audit_actions.<page> and
   audit_pages.<page> into shared_profiles, but nothing in the audit
   module ever read them — the pages gated on the role string in
   mjm_user instead. So unticking "Audit Report" for an auditor saved
   correctly and changed nothing they could see. Two access systems for
   one module; this is the audit side finally reading the portal's.

   Inferred from the filename so there is one gate rather than one per
   page. Keys match the `pages` list in audit_user_access.html.
================================================================ */
const AUDIT_PAGE_KEYS = {
  'audit_plot_audit.html':        'plot_audit',
  'audit_height_index.html':      'height',
  'audit_papan_index.html':       'papan',
  'audit_maintenance_index.html': 'maintenance',
  'audit_report.html':            'report'
};

function canOpenAuditPage(page) {
  try {
    const u = JSON.parse(localStorage.getItem('mjm_user') || '{}');
    const p = u.permissions || {};
    // audit_actions is authoritative; audit_pages mirrors it.
    const acts = p.audit_actions && p.audit_actions[page];
    /* `view` MISSING is not `view` false. Module Assess Control lists Record a new
       audit and Edit and delete past audits for each page, so a saved row
       can easily read { record:true, edit:false } with no `view` key in
       it at all — and `!!acts.view` then denied the page to somebody the
       office had just granted. Every module card vanished and the only
       tile left on screen was the one not covered by this map.
       Access fails OPEN here the way it does everywhere else: an absent
       answer is nobody has been asked, and only an explicit false is a
       no. */
    if (acts && acts.view === false) return false;
    if (acts && acts.view === true)  return true;
    if (acts) return true;
    const lvl = p.audit_pages && p.audit_pages[page];
    if (lvl) return lvl !== 'none';
    // Nothing configured for this user: unchanged behaviour, everything open.
    // Deliberately not gated on modules.audit — most auditors have never had
    // that set, and using it here would lock out the whole team at once.
    return true;
  } catch (e) { return true; }
}

/* ================================================================
   WHAT THEY MAY DO INSIDE A PAGE

   Module Assess Control has listed "Record a new audit" and "Edit & delete past
   audits" against each of the four modules since that screen was
   written, and NOTHING HAS EVER READ THEM. Unticking Edit for an
   auditor saved cleanly, showed as set on both screens that offer it,
   and that auditor went on editing and deleting — which is the exact
   fault the `view` half of this file was written to correct, one level
   down. Putting the same two ticks on a second screen (Nursery 555 Team ->
   Module Assess Control -> Auditor Portal) is what made it worth closing.

   Three things about the shape, and the first is the whole reason this
   is not simply a check at the save:

   IT IS ASKED BEFORE THE WORK, NOT AFTER IT. A permission tested when
   the Save button is pressed is tested at the end of an audit somebody
   has already walked a plot to fill in — the same mistake as the save
   that was the only thing asking whether a login could save at all.
   So the FORM refuses to open, and the save asks again because a
   button drawn before a permission changed is still on the screen.

   DELETE IS ITS OWN TICK, and it used to be half of Edit. Correcting
   a figure somebody keyed and removing the morning it was recorded for
   are different acts with different consequences, and the office asked
   for them apart. It is asked BESIDE the admin test rather than
   instead of it — an admin the office has unticked cannot delete
   either, and a non-admin never could.

   A ROW SAVED BEFORE THE SPLIT ANSWERED THE OLD TICK. It carries
   `edit` and no `delete`, so ACTION_FALLBACK reads the old answer
   rather than inventing one: an auditor the office had closed editing
   for stays closed for deleting too, and one they had opened keeps
   both until somebody saves that row again. Reading the absent key as
   off would take away access nobody removed; reading it as on would
   hand back a deletion the office had deliberately closed. The same
   line is in shared_module_access.js and in scan_user_access.html, the
   two screens that WRITE it — all three have to agree or a screen
   draws one answer and the app obeys another.

   AND IT FAILS OPEN, like everything else here. No entry for the page
   is nobody having been asked; an action key that is absent is the
   same. Only an explicit false is a no. A revoked page closes every
   action inside it, because there is nothing left to do on it.
================================================================ */
/* An action split out of an older one, and the key to read when a saved
   row predates the split. */
const ACTION_FALLBACK = { delete: 'edit' };

function canAuditAction(action, page) {
  const key = page || currentAuditPageKey();
  if (!key) return true;                      // a page this map does not cover
  if (!canOpenAuditPage(key)) return false;
  try {
    const u = JSON.parse(localStorage.getItem('mjm_user') || '{}');
    const acts = (u.permissions || {}).audit_actions;
    const entry = acts && acts[key];
    if (!entry || typeof entry !== 'object') return true;
    const asked = (!(action in entry) && ACTION_FALLBACK[action]) || action;
    return entry[asked] !== false;
  } catch (e) { return true; }
}

/* The click-time guard. Says WHY and where it is set, because a button
   that does nothing is read as a broken app and reported as one. The
   toast is the module's own, so it speaks whichever language the
   auditor has chosen; `say` is passed in rather than looked up here
   because this file knows nothing of the language table. */
function requireAuditAction(action, say) {
  if (canAuditAction(action)) return true;
  try { if (typeof say === 'function') say(); } catch (e) {}
  return false;
}

/* Pull the current permissions down so a revoked page stops working on the
   next page load rather than at the next login. */
async function refreshAuditPermissions() {
  try {
    if (!navigator.onLine) return false;
    const u = JSON.parse(localStorage.getItem('mjm_user') || '{}');
    if (!u.id) return false;
    const rows = await sbFetch(
      `shared_profiles?select=permissions,role,user_type&id=eq.${encodeURIComponent(u.id)}`);
    if (!rows || !rows.length) return false;
    /* A Sales Web customer is not an auditor, whatever the phone had cached
       — refused here on the fresh answer, the same rule the sign-in and
       requireSignIn() ask (shared/shared_staff_gate.js). */
    if (window.MJMAuditLogin && MJMAuditLogin.isCustomerUser &&
        MJMAuditLogin.isCustomerUser(rows[0])) {
      MJMAuditLogin.refuseCustomer();
      return false;
    }
    u.permissions = rows[0].permissions || null;
    if (rows[0].role) u.role = rows[0].role;
    u.user_type = rows[0].user_type || null;
    localStorage.setItem('mjm_user', JSON.stringify(u));
    return true;
  } catch (e) { return false; }
}

/* Send them back to the menu and explain there, rather than blanking the page
   under a half-initialised script. */
function denyAuditPage(page) {
  location.replace('audit_home.html#no-access=' + encodeURIComponent(page));
}

/* The other end of that redirect. Lives here so audit_home needs no changes. */
function showNoAccessNotice() {
  const m = /#no-access=([\w-]+)/.exec(location.hash || '');
  if (!m) return;
  history.replaceState(null, '', location.pathname);   // don't re-fire on reload
  const b = document.createElement('div');
  b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99998;padding:11px 16px;' +
    'background:#b45309;color:#fff;font-size:12.5px;font-weight:600;text-align:center;' +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;cursor:pointer";
  b.textContent = '🔒 You no longer have access to that page. Ask an admin to switch it ' +
                  'back on in Module Assess Control.';
  b.onclick = () => b.remove();
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 9000);
}

/* Hide links to pages this user may not open, so the menu matches reality. */
function hideDeniedAuditLinks() {
  Object.keys(AUDIT_PAGE_KEYS).forEach(file => {
    if (canOpenAuditPage(AUDIT_PAGE_KEYS[file])) return;
    document.querySelectorAll('a[href*="' + file + '"]').forEach(a => {
      a.style.display = 'none';
    });
  });
}

function currentAuditPageKey() {
  return AUDIT_PAGE_KEYS[(location.pathname.split('/').pop() || '').toLowerCase()];
}

/* Runs while the document is still parsing — this file is loaded above each
   page's own script — so a page we already know is off limits redirects
   before anything of it is built. */
(function denyEarly() {
  const page = currentAuditPageKey();
  if (page && !canOpenAuditPage(page)) denyAuditPage(page);
})();

async function applyAuditAccess() {
  const page = currentAuditPageKey();
  showNoAccessNotice();
  hideDeniedAuditLinks();

  // Confirm against the server, in case it changed since they last signed in.
  if (await refreshAuditPermissions()) {
    if (page && !canOpenAuditPage(page)) { denyAuditPage(page); return; }
    hideDeniedAuditLinks();
  }

  /* Anything drawn from the cached permissions — the admin-only Back End
     link, say — was decided before this refresh landed, so a role changed
     in Module Assess Control would not show until the load after next. Tell the page
     the fresh answer is in. */
  document.dispatchEvent(new Event('mjm-audit-access-ready'));
}
document.addEventListener('DOMContentLoaded', applyAuditAccess);

/* A signed-in user whose session has lapsed falls back to the anon key, and
   anon reads come back empty rather than failing — the screen would just say
   "no records" again. Say so instead. */
async function warnIfSessionLapsed() {
  try {
    if (!navigator.onLine) return;                       // offline is expected
    if (!localStorage.getItem('mjm_user')) return;       // not signed in at all
    if (await accessToken()) return;                     // all good
    if (document.getElementById('_sess_warn')) return;

    const b = document.createElement('div');
    b.id = '_sess_warn';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99998;padding:9px 14px;' +
      'background:#b45309;color:#fff;font-size:12px;font-weight:700;text-align:center;cursor:pointer';
    b.textContent = '⚠ Session expired — tap to sign in again, or records will not load';
    b.onclick = () => {
      window.location.href = window.MJMAuditLogin ? MJMAuditLogin.url() : 'audit_index.html';
    };
    document.body.appendChild(b);

    /* It is position:fixed with nothing making room for it, so it sat on top
       of the header — covering the sign-in route on the very page telling you
       to sign in. Push the page down by however tall it actually is; it wraps
       to two lines on a narrow phone, so measure rather than assume. */
    const makeRoom = () => { document.body.style.paddingTop = b.offsetHeight + 'px'; };
    makeRoom();
    window.addEventListener('resize', makeRoom);
  } catch (e) {}
}
document.addEventListener('DOMContentLoaded', warnIfSessionLapsed);

function isAuditAdmin() {
  try {
    // The portal's own answer, when the page has the shared layer loaded.
    if (typeof MJMAccess !== 'undefined' && MJMAccess.isAdminOf) {
      if (MJMAccess.isAdminOf('audit')) return true;
    }
    const u = JSON.parse(localStorage.getItem('mjm_user') || '{}');

    // Same permissions blob the portal uses, cached at login so this still
    // works with no signal.
    const mod = u.permissions && u.permissions.modules && u.permissions.modules.audit;
    if (mod === 'admin') return true;

    // If the audit module has an explicit level (normal, none, …) that answer
    // is authoritative — a Normal auditor whose PROFILE role happens to be
    // 'admin' for another module must NOT be promoted to audit admin by the
    // legacy fallback below. Only fall through when nothing is set at all.
    if (mod !== undefined && mod !== null && mod !== '') return false;

    // Fallback for accounts that predate permissions: audit_role wins over
    // role, matching how audit_home.html picks a role.
    const role = (u.audit_role || u.role || '').toLowerCase();
    return role === 'admin' || role === 'administrator';
  } catch (e) { return false; }
}

async function sbFetch(path, options = {}) {
  const url = `${SUPA_URL}/rest/v1/${path}`;
  const token = await accessToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${token || SUPA_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || 'return=representation',
      ...(options.range ? { 'Range-Unit': 'items', 'Range': options.range } : {}),
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase error ${res.status}: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

/* ── TABLES/VIEWS THAT DON'T HAVE created_at ──
   select() below used to try `order=created_at.desc` on every single call
   and only fall back after PostgREST rejected it — a full failed round
   trip, every time, forever, for any table that will never have that
   column. shared_plot_batch_balance is a VIEW aggregating the inventory
   ledger; there is no single "created_at" a balance row could have, so
   this was never going to stop failing. It is read on audit_height_script
   .js, audit_pending.js and audit_script.js — most audit page loads hit
   it more than once.

   Learned once per table, then skipped for the rest of the session AND
   remembered in localStorage so the NEXT page load doesn't pay for the
   failed request either. Preseeded with the ones already proven bad, so
   the very first deploy after this fix benefits immediately rather than
   re-learning them one failed request at a time. */
const _NO_CREATED_AT_KEY = 'mjm_sb_no_created_at';
const _noCreatedAt = (function () {
  const seed = ['shared_plot_batch_balance'];
  try {
    const stored = JSON.parse(localStorage.getItem(_NO_CREATED_AT_KEY) || '[]');
    return new Set([...seed, ...stored]);
  } catch (e) { return new Set(seed); }
})();
function _rememberNoCreatedAt(table) {
  _noCreatedAt.add(table);
  try { localStorage.setItem(_NO_CREATED_AT_KEY, JSON.stringify([..._noCreatedAt])); }
  catch (e) {}
}

/* ── AND THE SAME MEMORY FOR `id`, WHICH IS THE TIEBREAKER ──
   A read is paged (see below), and PAGING A NON-UNIQUE ORDER IS UNSTABLE
   BY CONSTRUCTION. `created_at.desc` alone leaves rows written in the same
   millisecond in no defined order, and the two pages are two separate
   requests: the database is free to answer the tie one way for page one
   and the other way for page two. A row can then come back TWICE, which
   the de-dupe catches, and -- the half that cannot be caught -- another
   row is SKIPPED, silently, for ever.

   That is not rare here. A phone pushes a plot batch by batch in ONE
   insert and the audit board's section close writes a dozen rows in one
   go, so a run of rows sharing `created_at` to the microsecond sitting
   across the 1,000-row boundary is the ordinary case rather than the
   unlucky one.

   And a SKIPPED audit row is not a cosmetic loss. The auditor board asks
   one question of that table -- `select=task_id`, is this task audited --
   so a task id that falls through the boundary reads as NOT AUDITED, and
   its plot comes back onto the To Do list over work somebody has already
   done or an admin has already closed.

   So the order carries a UNIQUE tiebreaker. `created_at.desc,id.desc`
   leaves "newest first" exactly as it was and makes the sequence total,
   which is the only thing that makes a page boundary mean anything. A
   table with no `id` is remembered the same way one with no `created_at`
   is, and pays for the failed attempt once. */
const _NO_ID_KEY = 'mjm_sb_no_id';
const _noId = (function () {
  try {
    return new Set(JSON.parse(localStorage.getItem(_NO_ID_KEY) || '[]'));
  } catch (e) { return new Set(); }
})();
function _rememberNoId(table) {
  _noId.add(table);
  try { localStorage.setItem(_NO_ID_KEY, JSON.stringify([..._noId])); }
  catch (e) {}
}
/* The order clause this table can actually be read with. Empty where the
   table has neither column, which is where this reader was. */
function _orderFor(table) {
  const parts = [];
  if (!_noCreatedAt.has(table)) parts.push('created_at.desc');
  if (!_noId.has(table))        parts.push('id.desc');
  return parts.length ? '&order=' + parts.join(',') : '';
}

/* ── A READ OVER 1,000 ROWS CAME BACK CUT, AND SAID NOTHING ──
   PostgREST answers at most `db-max-rows` rows and Supabase sets that to
   1,000. There is no error and no flag on the body: the read simply ends,
   and the caller gets a short list that looks exactly like a short month.

   The Monthly Audit Report is where it showed. October held 1,783
   maintenance audits and the report drew **1,000** of them — a figure the
   office read as the month's work. 783 records, on no report, with
   nothing anywhere saying so.

   So every select PAGES. It asks for `PAGE` rows at a time through the
   Range header and stops when a page comes back short, which is the only
   signal there is that the end has been reached.

   Three things in it:

   - **A FULL LAST PAGE IS NOT THE END.** A table holding exactly 2,000
     rows answers the second page full, so the loop has to ask a third
     time and get nothing. Stopping on a full page would lose a round
     number of rows, which is the same fault one page along.
   - **THE ROWS ARE DE-DUPED ON `id`.** `order=created_at.desc` leaves
     rows written in the same millisecond in no defined order — a phone
     pushes a plot batch by batch in ONE insert — so the same row can
     answer on two pages while another is skipped. The skip cannot be
     repaired from here, but a row counted twice can, and it is the one
     that would double a figure. A table with no `id` is left as it comes.
   - **IT STOPS AT `MAX_PAGES` AND SAYS SO.** A loop with no ceiling on a
     read that keeps answering full is a page that hangs for ever. 50
     pages is 50,000 rows, far past anything this module asks for, and
     reaching it is logged as the fault it would be. */
const SB_PAGE = 1000;
const SB_MAX_PAGES = 50;

async function sbSelectAll(path) {
  const out = [];
  const seen = new Set();
  let dropped = 0;
  for (let page = 0; page < SB_MAX_PAGES; page++) {
    const from = page * SB_PAGE;
    const rows = await sbFetch(path, { range: from + '-' + (from + SB_PAGE - 1) });
    if (!Array.isArray(rows)) return rows;
    for (const r of rows) {
      const id = r && r.id;
      if (id === undefined || id === null) { out.push(r); continue; }
      if (seen.has(id)) { dropped++; continue; }
      seen.add(id);
      out.push(r);
    }
    /* Short page is the end. A FULL one never is, even if it is the last
       row in the table -- the next ask is what says so. */
    if (rows.length < SB_PAGE) {
      if (dropped) console.warn('[sb] ' + dropped + ' repeated row(s) dropped while paging', path);
      return out;
    }
  }
  console.warn('[sb] stopped at ' + (SB_MAX_PAGES * SB_PAGE) + ' rows -- the read is still answering full pages', path);
  return out;
}

const sb = {
  async select(table, query = '') {
    /* A LADDER, not two ifs. Some audit tables were made by hand and have
       no created_at; a view may have no id. PostgREST rejects the WHOLE
       read with a 400 on the order clause, which reaches the screen as an
       empty list — indistinguishable from "no records" — so each column
       that is not there is dropped, remembered, and asked for again. Two
       columns is at most two retries, and the third ask is the unordered
       one, which cannot fail on an order clause it does not carry. */
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await sbSelectAll(`${table}?${query}${_orderFor(table)}`);
      } catch (e) {
        const msg = String((e && e.message) || '');
        if (!/42703|does not exist/i.test(msg)) throw e;
        if (/created_at/.test(msg) && !_noCreatedAt.has(table)) {
          console.warn('[sb] no created_at on', table, '— dropping it from the order');
          _rememberNoCreatedAt(table);
          continue;
        }
        if (/\bid\b/.test(msg) && !_noId.has(table)) {
          console.warn('[sb] no id on', table, '— dropping it from the order');
          _rememberNoId(table);
          continue;
        }
        throw e;
      }
    }
    return await sbSelectAll(`${table}?${query}`);
  },
  /* Can this login save at all? Asked at sign in, before an auditor
     spends a day filling in forms the database is going to refuse.

     It answers per table, reading the real policy out of the catalogue —
     shared/RUN_ME_audit_save_check.sql installs it. A null answer means
     the function is not there or could not be reached, and that is NOT a
     no: access fails open here the way it does everywhere else in this
     system, so a check that cannot run never takes the module away from
     somebody who was working fine a minute ago. */
  async canISave() {
    try {
      const token = await accessToken();
      const res = await fetch(`${SUPA_URL}/rest/v1/rpc/audit_can_i_save`, {
        method: 'POST',
        headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${token || SUPA_KEY}`,
                   'Content-Type': 'application/json' },
        body: '{}'
      });
      if (!res.ok) return null;
      const rows = await res.json();
      return Array.isArray(rows) ? rows : null;
    } catch (e) { return null; }
  },
  async insert(table, data) {
    return sbFetch(table, { method: 'POST', body: JSON.stringify(data), prefer: 'return=representation' });
  },
  async update(table, id, data) {
    return sbFetch(`${table}?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=representation' });
  },
  async delete(table, id) {
    return sbFetch(`${table}?id=eq.${id}`, { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
  },
  /* `exact` means the CALLER owns the path and this function adds nothing
     to it. See the note on the path below for why that matters. */
  async uploadPhoto(bucket, filename, base64dataUrl, exact) {
    if (!base64dataUrl || !base64dataUrl.startsWith('data:')) return base64dataUrl;
    const [meta, data] = base64dataUrl.split(',');
    const mime = meta.match(/:(.*?);/)[1];
    const binary = atob(data);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    const blob = new Blob([arr], { type: mime });
    const ext  = mime.split('/')[1] || 'jpg';
    /* THE CLOCK IS THE FALLBACK AND NEVER THE RULE.

       A path ending in Date.now() is a NEW FILE on every attempt, and
       that is the whole of how one press of Save left the office seven
       pictures of one plot -- the name could not help being different,
       so nothing about sending the same photo twice could ever be
       recognised as sending the same photo twice.

       A caller that knows which PRESS the picture belongs to passes
       `exact` and owns the path outright. The x-upsert below then makes
       a second upload of that press write the SAME object, so no retry
       anywhere -- the sweep, a timeout that actually landed, a race
       nobody has thought of yet -- can make a second file.

       A caller with no press id keeps the clock, which is what it has
       always relied on to avoid writing over somebody else. */
    const path = exact ? `${filename}.${ext}` : `${filename}_${Date.now()}.${ext}`;
    const token = await accessToken();   // storage policies are per-role too
    const res = await fetch(`${SUPA_URL}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST',
      headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${token || SUPA_KEY}`, 'Content-Type': mime, 'x-upsert': 'true' },
      body: blob
    });
    if (!res.ok) {
      /* Returning null here meant the reason died in the console: a missing
         audit-photos bucket and a storage policy refusing the write looked
         identical to the caller. Keep returning null so existing callers
         behave, but record why so the toast can say it. */
      const body = await res.text();
      console.error('Photo upload failed', res.status, body);
      sb.lastPhotoError = 'Photo upload failed ' + res.status + ': ' + body.slice(0, 120);
      return null;
    }
    sb.lastPhotoError = null;
    return `${SUPA_URL}/storage/v1/object/public/${bucket}/${path}`;
  }
};