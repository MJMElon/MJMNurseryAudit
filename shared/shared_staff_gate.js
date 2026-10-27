/* ================================================================
   MJM AI POWERED SYSTEM — THE STAFF GATE
   shared/shared_staff_gate.js

   "Make the AI system, the admin portal, FC portal or whatever portal,
   all staff system. Customer only can see sales web and customer
   portal."

   A Sales Web customer is an ordinary Supabase login whose
   shared_profiles row says user_type = 'customer'. Same project, same
   auth, same password box — so nothing stopped one signing in here, and
   several doors then failed OPEN on top of it: a profile that could not
   be read, or came back empty, was treated as "full access" and every
   tile was drawn. This file is the one rule every door asks, so the
   answer cannot differ from one page to the next.

   THE RULE, asked on sign-in and on every page load with a session:

     read    shared_profiles (user_type, role, permissions) for the caller
     CUSTOMER   (read OK, user_type 'customer')  → sign out, forget what
                this device cached about them, show ONLY the refusal
     PENDING    (read OK, no row, or no staff access) → the caller's own
                Pending Access behaviour; nothing of the app is drawn
     STAFF      (read OK, staff access) → in, as before
     READ FAILED (a returned {error} is a failure, the same as a throw)
                → the last profile THIS DEVICE was given for THIS USER ID,
                if there is one (offline nurseries are the normal case);
                with none, UNKNOWN: the session is kept, nothing is drawn,
                and the page says it could not check, with a Retry.

   An unknown profile is NEVER full access. A pending one is never a tile.

   Row-level security in the database is still what decides what anybody
   can read or write. This is the screen agreeing with it, so a customer
   is told plainly where to go instead of being shown an empty building.

   Loaded as a plain script, no dependencies, BEFORE shared_access.js on
   every page that has it, and on every page with a door of its own (the
   hub, mobile/, audit/). shared_access.js asks it when it is there and
   falls back to sending a customer to the hub when it is not, so a page
   cached from before this file existed still ends up refused.
================================================================ */
(function (global) {
  'use strict';

  var CUSTOMER_MESSAGE = 'This is the MJM Nursery staff system. Customer accounts cannot sign in here. Please use the MJM Nursery shop at https://www.mjmnursery.com';
  var UNREACHABLE_MESSAGE = 'We could not check your account just now. Please check your connection and try again.';

  /* Survives the redirects a sign out sets off. Pages listen for
     SIGNED_OUT and go somewhere else; whichever page they land on loads
     this file and shows the refusal again, rather than a bare login that
     reads as "try a different password". Per tab, and cleared by the
     "staff account" button or a staff sign-in. */
  var REFUSED_FLAG = 'mjm_customer_refused';

  var COLUMNS = 'user_type, role, permissions';
  var READ_TIMEOUT_MS = 15000;

  /* Where this file was loaded from, so the refusal can offer the hub
     sign-in from any folder. A page can name its own door instead
     (window.MJM_SIGN_IN_URL) — the audit portal does. */
  var _hubUrl = (function () {
    try {
      var s = global.document && global.document.currentScript;
      if (s && s.src) return s.src.replace(/shared\/shared_staff_gate\.js.*$/, 'index.html');
    } catch (e) {}
    return '/index.html';
  })();

  function isCustomer(profile) {
    return !!profile && String(profile.user_type || '').trim().toLowerCase() === 'customer';
  }

  /* STAFF ACCESS — the hub's own test (hasOpsAccess in index.html, moved
     here) and shared_access.js's whole-system gate, which also counts a
     ticked function under any <module>_actions. One definition, so the hub
     and a module page cannot disagree about who is staff.

     No profile is NOT staff. It used to be, on the hub, on the argument
     that an RLS-filtered read could strand an admin on Pending — but that
     same shortcut is what let any login with no row (or an unreadable one)
     see every tile. */
  var STAFF_LEVELS = ['admin', 'normal', 'view', 'edit', 'manage', 'read', 'write', 'full', 'staff'];
  function hasStaffAccess(profile) {
    if (!profile || isCustomer(profile)) return false;
    var p = profile.permissions || {};
    if (p.manage_users || p.can_verify_operation) return true;
    if (p.modules && typeof p.modules === 'object') {
      for (var k in p.modules) {
        if (STAFF_LEVELS.indexOf(String(p.modules[k]).toLowerCase()) !== -1) return true;
      }
    }
    for (var key in p) {
      if (!/_actions$/.test(key) || !p[key] || typeof p[key] !== 'object') continue;
      for (var page in p[key]) {
        var acts = p[key][page];
        if (!acts || typeof acts !== 'object') continue;
        for (var a in acts) if (acts[a] === true) return true;
      }
    }
    return false;
  }

  /* ── WHAT THIS DEVICE REMEMBERS ──────────────────────────────────────
     mjm_perm_last__<uid> is written by the hub and shared_access.js on
     every good read; mjm_user by the hub and the audit sign-in. Either
     will do, but only for the SAME user id — a shared office phone must
     not hand one person's answer to the next. */
  function _lastKey(uid) { return 'mjm_perm_last__' + uid; }

  function lastKnown(uid) {
    if (!uid) return null;
    try {
      var rec = JSON.parse(global.localStorage.getItem(_lastKey(uid)) || 'null');
      if (rec && rec.data && typeof rec.data === 'object') return rec.data;
    } catch (e) {}
    try {
      var u = JSON.parse(global.localStorage.getItem('mjm_user') || 'null');
      if (u && u.id && String(u.id) === String(uid)) return u;
    } catch (e) {}
    return null;
  }

  /* Merged into what is there, so a narrow read here does not throw away
     the full profile the hub stored (name, phone) for an offline start. */
  function remember(uid, profile) {
    if (!uid || !profile || isCustomer(profile)) return;
    try {
      var old = null;
      try { old = JSON.parse(global.localStorage.getItem(_lastKey(uid)) || 'null'); } catch (e) {}
      var data = {};
      var k;
      if (old && old.data && typeof old.data === 'object') for (k in old.data) data[k] = old.data[k];
      for (k in profile) data[k] = profile[k];
      global.localStorage.setItem(_lastKey(uid), JSON.stringify({ ts: Date.now(), data: data }));
    } catch (e) { /* private mode / quota */ }
  }

  /* Everything this app keeps about who is signed in. The training
     progress ('mjm-users') and the sector order are not about the person
     and stay. */
  function forget() {
    try {
      var ls = global.localStorage;
      Object.keys(ls).forEach(function (k) {
        if (k === 'mjm_user' || k === 'mjm-user' ||
            k.indexOf('mjm_perm_last__') === 0 ||
            /^sb-.+-auth-token$/.test(k)) ls.removeItem(k);
      });
    } catch (e) {}
    try {
      var ss = global.sessionStorage;
      Object.keys(ss).forEach(function (k) {
        if (k === 'mjm_session_active' || k === 'mjm_user_email' || k === 'mjm_user_name' ||
            k.indexOf('mjm_profile_cache__') === 0) ss.removeItem(k);
      });
    } catch (e) {}
  }

  function _withTimeout(p, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('Timed out reading the profile')); }, ms);
      Promise.resolve(p).then(function (v) { clearTimeout(t); resolve(v); },
                              function (e) { clearTimeout(t); reject(e); });
    });
  }

  /* { ok:true, profile|null } or { ok:false, error }. A returned {error}
     is a failure exactly like a throw — the places that only caught
     throws are how a refused read came to count as a pass. */
  function readProfile(supa, uid, columns) {
    try {
      var q = supa.from('shared_profiles').select(columns || COLUMNS).eq('id', uid);
      var p = typeof q.maybeSingle === 'function' ? q.maybeSingle() : q.single();
      return _withTimeout(p, READ_TIMEOUT_MS).then(function (res) {
        if (!res) return { ok: false, error: new Error('No answer from the profile read') };
        if (res.error) {
          // .single() on no row — that is an answer, not a failure.
          if (res.error.code === 'PGRST116') return { ok: true, profile: null };
          return { ok: false, error: res.error };
        }
        return { ok: true, profile: res.data || null };
      }, function (e) { return { ok: false, error: e }; });
    } catch (e) {
      return Promise.resolve({ ok: false, error: e });
    }
  }

  /* The rule, with no side effects. status is one of
     'customer' | 'staff' | 'pending' | 'unknown'. */
  function classify(read, uid) {
    if (read && read.ok) {
      var pr = read.profile;
      if (isCustomer(pr)) return { status: 'customer', profile: pr, fromCache: false };
      return { status: hasStaffAccess(pr) ? 'staff' : 'pending', profile: pr || null, fromCache: false };
    }
    var last = lastKnown(uid);
    if (last) {
      if (isCustomer(last)) return { status: 'customer', profile: last, fromCache: true };
      return { status: hasStaffAccess(last) ? 'staff' : 'pending', profile: last, fromCache: true,
               error: read && read.error };
    }
    return { status: 'unknown', profile: null, fromCache: false, error: read && read.error };
  }

  function check(supa, uid, opts) {
    opts = opts || {};
    return readProfile(supa, uid, opts.columns).then(function (read) {
      if (read.ok && read.profile) remember(uid, read.profile);
      return classify(read, uid);
    });
  }

  /* ── WHAT IS SHOWN ───────────────────────────────────────────────────
     A full-screen panel, and everything else on the page hidden by a
     rule on <html> — so a page that goes on drawing after this (a list
     that was already loading, the Nelos dock) draws into nothing. */
  var STYLE =
    'html.mjm-gated body > *:not(#mjm-staff-gate){display:none !important}' +
    '#mjm-staff-gate{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;' +
    'justify-content:center;padding:16px;background:#0f172a;font-family:system-ui,-apple-system,' +
    '"Segoe UI",Roboto,sans-serif}' +
    '#mjm-staff-gate .g-card{max-width:420px;width:100%;background:#020617;border:1px solid #334155;' +
    'border-radius:18px;padding:26px 22px;text-align:center;color:#e2e8f0}' +
    '#mjm-staff-gate .g-msg{font-size:15px;line-height:1.6;margin:0 0 18px;font-weight:600}' +
    '#mjm-staff-gate button{font:inherit;font-size:12px;font-weight:800;letter-spacing:.12em;' +
    'text-transform:uppercase;padding:10px 18px;border-radius:9999px;cursor:pointer;' +
    'background:rgba(16,185,129,.12);border:1px solid rgba(16,185,129,.5);color:#6ee7b7}' +
    '#mjm-staff-gate button.g-quiet{background:transparent;border-color:#334155;color:#94a3b8}';

  function _whenBody(fn) {
    if (global.document.body) { fn(); return; }
    global.document.addEventListener('DOMContentLoaded', fn);
  }

  function _render(kind, message, button) {
    _whenBody(function () {
      var d = global.document;
      if (!d.getElementById('mjm-staff-gate-style')) {
        var st = d.createElement('style');
        st.id = 'mjm-staff-gate-style';
        st.textContent = STYLE;
        (d.head || d.documentElement).appendChild(st);
      }
      d.documentElement.classList.add('mjm-gated');
      var box = d.getElementById('mjm-staff-gate');
      if (!box) {
        box = d.createElement('div');
        box.id = 'mjm-staff-gate';
        box.setAttribute('role', 'alertdialog');
        d.body.appendChild(box);
      }
      box.setAttribute('data-kind', kind);
      box.innerHTML = '';
      var card = d.createElement('div');
      card.className = 'g-card';
      var p = d.createElement('p');
      p.className = 'g-msg';
      p.id = 'mjm-staff-gate-msg';
      p.textContent = message;
      card.appendChild(p);
      if (button) {
        var b = d.createElement('button');
        b.type = 'button';
        b.id = button.id;
        if (button.quiet) b.className = 'g-quiet';
        b.textContent = button.label;
        b.addEventListener('click', button.onClick);
        card.appendChild(b);
      }
      box.appendChild(card);
    });
  }

  function hide() {
    try {
      var d = global.document;
      d.documentElement.classList.remove('mjm-gated');
      var box = d.getElementById('mjm-staff-gate');
      if (box) box.remove();
    } catch (e) {}
  }

  function _flag(on) {
    try {
      if (on) global.sessionStorage.setItem(REFUSED_FLAG, '1');
      else global.sessionStorage.removeItem(REFUSED_FLAG);
    } catch (e) {}
  }
  function wasRefused() {
    try { return global.sessionStorage.getItem(REFUSED_FLAG) === '1'; } catch (e) { return false; }
  }

  function showRefused() {
    _render('customer', CUSTOMER_MESSAGE, {
      id: 'mjm-staff-gate-other', label: 'Sign in with a staff account', quiet: true,
      onClick: function () {
        _flag(false);
        global.location.href = global.MJM_SIGN_IN_URL || _hubUrl;
      }
    });
  }

  /* The session is KEPT — a dropped line is not a reason to sign anybody
     out, and Retry with signal is all it takes. */
  function showUnreachable(onRetry) {
    _render('unknown', UNREACHABLE_MESSAGE, {
      id: 'mjm-staff-gate-retry', label: 'Retry',
      onClick: function () {
        if (typeof onRetry === 'function') { hide(); onRetry(); }
        else global.location.reload();
      }
    });
  }

  /* Refuse a customer: the panel first (so nothing else is ever shown),
     then forget, then sign out. Local scope, raced against a timeout, the
     way every sign-out on these pages is — the navigator lock has stalled
     a full sign-out before. */
  function refuseCustomer(supa) {
    _flag(true);
    showRefused();
    forget();
    var out = Promise.resolve();
    try {
      if (supa && supa.auth && typeof supa.auth.signOut === 'function') {
        out = Promise.race([
          Promise.resolve(supa.auth.signOut({ scope: 'local' })).catch(function () {}),
          new Promise(function (r) { setTimeout(r, 1500); })
        ]);
      }
    } catch (e) {}
    return out.then(function () { forget(); }, function () { forget(); });
  }

  /* The whole rule for a page with a session. Acts on CUSTOMER and
     UNKNOWN; PENDING is handed back for the page to show its own notice.
     opts: columns (the hub reads '*'), onRetry, quietUnknown. */
  function enforce(supa, session, opts) {
    opts = opts || {};
    if (!session || !session.user || !session.user.id) {
      return Promise.resolve({ status: 'signed_out', profile: null });
    }
    return check(supa, session.user.id, opts).then(function (r) {
      if (r.status === 'customer') return refuseCustomer(supa).then(function () { return r; });
      if (r.status === 'unknown' && !opts.quietUnknown) showUnreachable(opts.onRetry);
      if (r.status === 'staff') _flag(false);
      return r;
    });
  }

  // A refusal earlier in this tab follows the person to whatever page the
  // sign out sent them to.
  if (wasRefused()) showRefused();

  global.MJMStaffGate = {
    CUSTOMER_MESSAGE: CUSTOMER_MESSAGE,
    UNREACHABLE_MESSAGE: UNREACHABLE_MESSAGE,
    REFUSED_FLAG: REFUSED_FLAG,
    COLUMNS: COLUMNS,
    isCustomer: isCustomer,
    hasStaffAccess: hasStaffAccess,
    lastKnown: lastKnown,
    remember: remember,
    forget: forget,
    readProfile: readProfile,
    classify: classify,
    check: check,
    enforce: enforce,
    refuseCustomer: refuseCustomer,
    showRefused: showRefused,
    showUnreachable: showUnreachable,
    markRefused: function () { _flag(true); },
    wasRefused: wasRefused,
    hide: hide
  };
})(window);
