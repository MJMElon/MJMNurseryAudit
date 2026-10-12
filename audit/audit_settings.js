/* ══════════════════════════════════════════════════════════════════════
   NURSERY AUDIT — SETTINGS

   One place that answers three questions the audit module used to answer
   with constants buried in audit_home.html:

     1. How many rounds does each audit have, and on which days?
     2. How long after work is done may a maintenance audit be recorded?
     3. Which batch ages are being audited at all?

   Set on Settings → System Setting (audit_user_access.html), stored as one
   JSON row in audit_settings, read here by every page that needs them.

   DEFAULTS ARE THE OLD BEHAVIOUR
   Every default below is exactly what the module did before it was
   settable, so a database without the audit_settings table — or with an
   empty one — behaves as it always has. Nothing here is allowed to fail
   loudly: a settings read that goes wrong falls back to the defaults and
   the auditor's day carries on.

   USAGE
     await MJMAuditSettings.load();          // once, early
     MJMAuditSettings.windows('MN', 'plot')  // → [[10,10],[20,20],[30,30]]
     MJMAuditSettings.maintDays('interrow')  // → 5   (0 = not audited)
     MJMAuditSettings.ages()                 // → [1,2,9,10] or null for all
     MJMAuditSettings.ageAllowed(7)          // → false
   ══════════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {

  /* The schedule as it stood when it was hardcoded — MN_SET and PN_SET in
     audit_home.html. Each pair is one round: [first day, last day]. */
  const DEFAULT_SCHEDULE = {
    MN: { plot: [[10, 10], [20, 20], [30, 30]], height: [[1, 5], [15, 20]], papan: [[1, 31]] },
    PN: { plot: [[20, 25]],                      height: [[20, 25]],        papan: [[1, 31]] }
  };

  /* Days after the work was done. WT_WINDOW in audit_home.html, plus the
     two it decided by omission: anything else got 3, and P & D was skipped
     because it is audited as part of the plot condition audit. 0 means the
     work type raises no audit at all. */
  const DEFAULT_MAINT = { manuring: 3, weeding: 3, interrow: 5, other: 3, pd: 0 };

  const MODULES   = ['plot', 'height', 'papan'];
  const SCOPES    = ['MN', 'PN'];
  const WORKTYPES = ['manuring', 'weeding', 'interrow', 'pd', 'other'];

  let data   = null;     // what the database holds, once read
  let loaded = false;
  let inFlight = null;
  /* Why the last read failed, if it did. Falling back to the defaults is the
     right thing to do on a phone in the field, but it is the wrong thing to
     do silently on the screen where the settings are edited: the board would
     keep the old schedule while the editor showed the new one, with nothing
     to say which is in force. */
  let lastError = null;

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const clone = (v) => JSON.parse(JSON.stringify(v));

  /* A round is two days of the month, in order, inside 1–31. Anything that
     cannot be read as that is dropped rather than guessed at — a malformed
     round would otherwise become a window that never opens.

     A list that is there but empty is a real answer: "this audit is not
     asked for here". Only an absent list falls back to the default, so
     switching an audit off stays switched off. */
  function cleanWindows(raw, fallback) {
    if (!Array.isArray(raw)) return clone(fallback);
    const out = [];
    raw.forEach(w => {
      if (!Array.isArray(w) || w.length < 2) return;
      let a = parseInt(w[0], 10), b = parseInt(w[1], 10);
      if (!isFinite(a) || !isFinite(b)) return;
      a = clamp(a, 1, 31); b = clamp(b, 1, 31);
      out.push(a <= b ? [a, b] : [b, a]);
    });
    return out;
  }

  function normalise(raw) {
    const src = (raw && typeof raw === 'object') ? raw : {};
    const out = { schedule: {}, maintenance: {}, ages: null };

    SCOPES.forEach(scope => {
      const got = (src.schedule && src.schedule[scope]) || {};
      out.schedule[scope] = {};
      MODULES.forEach(mod => {
        out.schedule[scope][mod] = cleanWindows(got[mod], DEFAULT_SCHEDULE[scope][mod]);
      });
    });

    WORKTYPES.forEach(wt => {
      const n = parseInt((src.maintenance || {})[wt], 10);
      out.maintenance[wt] = isFinite(n) ? clamp(n, 0, 365) : DEFAULT_MAINT[wt];
    });

    /* null (or absent) means every age, which is what the module did
       before ages could be picked. An empty list is a real answer and
       means nothing is being audited — it is left as it was keyed rather
       than quietly turned back into "all". */
    if (Array.isArray(src.ages)) {
      const seen = new Set();
      out.ages = src.ages
        .map(a => parseInt(a, 10))
        .filter(a => isFinite(a) && a >= 0 && a <= 120 && !seen.has(a) && seen.add(a))
        .sort((a, b) => a - b);
    }
    return out;
  }

  function defaults() { return normalise({}); }

  /* Read once per page. A second caller while the first is still in the
     air joins it rather than starting another. */
  function load(supa) {
    if (loaded) return Promise.resolve(data);
    if (inFlight) return inFlight;
    inFlight = _load(supa).finally(() => { inFlight = null; });
    return inFlight;
  }

  async function _load(supa) {
    try {
      let row = null;
      if (supa && supa.from) {
        const res = await supa.from('audit_settings').select('data').eq('id', 1).maybeSingle();
        if (res.error) throw res.error;
        row = res.data;
      } else if (typeof sb !== 'undefined' && sb && typeof sb.select === 'function') {
        /* audit_supabase.js's thin REST helper, which the audit pages carry.
           Reached by the bare name on purpose: that file declares it with
           `const sb`, and a top-level const is NOT a property of window. This
           used to test global.sb, found undefined, and fell through to the
           defaults without a request, a message or an error — so the portal
           quietly kept the built-in schedule while the Settings screen showed
           the saved one. */
        const rows = await sb.select('audit_settings', 'select=data&id=eq.1');
        row = (rows && rows[0]) || null;
      } else {
        throw new Error('no way to read audit_settings on this page — '
                      + 'load it after audit_supabase.js, or pass a supabase client');
      }
      data = normalise(row && row.data);
      lastError = null;
    } catch (e) {
      lastError = (e && (e.message || String(e))) || 'unknown error';
      console.warn('[audit-settings] using defaults:', lastError);
      data = defaults();
    }
    loaded = true;
    try { localStorage.setItem('mjm_audit_settings', JSON.stringify(data)); } catch (_) {}
    return data;
  }

  /* What the last successful read saw, for a page opened offline. Falls
     back to the defaults, so this never returns nothing. */
  function current() {
    if (data) return data;
    try {
      const cached = JSON.parse(localStorage.getItem('mjm_audit_settings') || 'null');
      if (cached) { data = normalise(cached); return data; }
    } catch (_) {}
    data = defaults();
    return data;
  }

  const windows = (scope, mod) => {
    const s = current().schedule[scope === 'PN' ? 'PN' : 'MN'];
    return clone((s && s[mod]) || []);
  };
  const maintDays = (wt) => {
    const m = current().maintenance;
    const n = m[wt];
    return isFinite(n) ? n : (isFinite(m.other) ? m.other : 3);
  };
  const ages = () => {
    const a = current().ages;
    return a === null ? null : a.slice();
  };
  const ageAllowed = (months) => {
    const a = current().ages;
    if (a === null) return true;                 // every age
    const n = parseInt(months, 10);
    if (!isFinite(n)) return true;               // age unknown → do not hide it
    return a.indexOf(n) !== -1;
  };

  /* Whole months between a planting date and today — the same age the
     office's movement report prints, so an auditor and the office are
     never looking at two different numbers for one batch. */
  function ageMonths(planted, on) {
    if (!planted) return null;
    const d = (planted instanceof Date) ? planted : new Date(String(planted).slice(0, 10));
    if (isNaN(d)) return null;
    const now = on ? new Date(on) : new Date();
    let n = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (now.getDate() < d.getDate()) n -= 1;
    return n < 0 ? 0 : n;
  }

  async function save(supa, next, who) {
    const clean = normalise(next);
    const { error } = await supa.from('audit_settings')
      .update({ data: clean, updated_at: new Date().toISOString(), updated_by: who || null })
      .eq('id', 1);
    if (error) throw error;
    data = clean;
    loaded = true;
    try { localStorage.setItem('mjm_audit_settings', JSON.stringify(clean)); } catch (_) {}
    return clean;
  }

  /* ── WHICH ROUND IS BEING ASKED FOR RIGHT NOW ──────────────────────
     A module page used to mark a batch green the moment it had ANY audit
     against it, ever: `const done = !!audit`. So a batch audited once in
     round 2 read as done in round 3, and in every round after it, for
     ever. The auditor opened the plot, saw three green cards, and the
     to-do list went on asking for that plot with nothing on the plot
     page to say which batch it meant. The to-do list was right; the
     plot page was the one not saying enough.

     This is the range the to-do list is asking about: the LATEST window
     whose first day has arrived, searched back through the months, with
     the upper bound running to today once the window has closed — the
     same rule as winRange() in audit_home.html, for the same reason. An
     overdue round is cleared by the work, not by the calendar.

     A day in a window is clamped to the real last day of the month, so
     "the 30th" lands in February rather than vanishing.

     Returns null when the module has no rounds at all, which is how
     "we do not run that audit here" is said — the caller then falls
     back to asking whether there is any audit, which is what every
     page did before this existed. */
  function currentWindow(scope, mod, todayISO) {
    const wins = windows(scope, mod);
    if (!wins.length) return null;
    const today = String(todayISO || '').slice(0, 10);
    if (today.length !== 10) return null;
    const y0 = Number(today.slice(0, 4)), m0 = Number(today.slice(5, 7)) - 1;
    const iso = (y, m, d) => y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const lastDay = (y, m) => new Date(y, m + 1, 0).getDate();

    /* Back far enough to find a round even on a module whose only window
       is early in the month and a nursery nobody has been to since. */
    for (let back = 0; back < 13; back++) {
      const d = new Date(y0, m0 - back, 1);
      const y = d.getFullYear(), m = d.getMonth(), last = lastDay(y, m);
      for (let i = wins.length - 1; i >= 0; i--) {
        const w = wins[i];
        const startISO = iso(y, m, Math.min(w[0], last));
        const endISO   = iso(y, m, Math.min(w[1], last));
        if (startISO > today) continue;          // has not opened yet
        return { fromISO: startISO,
                 toISO:   endISO >= today ? endISO : today,
                 round:   wins.length > 1 ? (i + 1) : 0,
                 rounds:  wins.length,
                 dueISO:  endISO };
      }
    }
    return null;
  }

  /* ── WHICH ROUND AN AUDIT ANSWERED, AND WHETHER IT WAS LATE ───────
     A record dated 1 October is not an October audit. The round that
     was open on the 1st was September round 3 -- its window was the
     30th, and it stays open until somebody does the work, which is the
     whole of the overdue rule. So the record IS the 30 Sep audit; the
     auditor was simply a day late with it.

     Nothing said so. The card printed "01 Oct 2026" and the reader was
     left to work out which round that answered, which is the same
     arithmetic that made the board look wrong in the first place.

     It is the same question currentWindow already answers, asked on the
     DAY OF THE AUDIT rather than on today -- so there is one rule and
     not two. `late` is the audit landing after that window closed. */
  function roundOf(scope, mod, dateISO) {
    const d = String(dateISO || '').slice(0, 10);
    if (d.length !== 10) return null;
    const w = currentWindow(scope, mod, d);
    if (!w) return null;
    return { round: w.round, rounds: w.rounds, dueISO: w.dueISO, late: d > w.dueISO };
  }

  global.MJMAuditSettings = {
    load, save, current, defaults, normalise,
    error: () => lastError,
    windows, currentWindow, roundOf, maintDays, ages, ageAllowed, ageMonths,
    MODULES, SCOPES, WORKTYPES,
    DEFAULT_SCHEDULE, DEFAULT_MAINT
  };
})(window);
