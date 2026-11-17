/* ══════════════════════════════════════════════════════════════════════════
   THE AUDITOR PORTAL'S ONE PLOT LIST — AND IT COMES FROM SEEDLING STOCK

   A plot is added in ONE place: Seedling Stock Management → System Settings →
   Add Plot, which inserts a row into `shared_plots`. That is the office's own
   answer to "what plots are there", and the Work Maintenance schedule, the
   salary claim, the FC Portal's PALMS and maintenance boards and the Nelos
   case log all read it.

   THE AUDIT MODULE DID NOT. Five files carried the four ranges written out —
   P01-P52, B01-B14, U01-U18, N01-N20 — and nothing else:

     audit_script.js          the Plot Condition grid and its plot dropdown
     audit_height_script.js   the Seedling Height grid and its dropdown
     audit_papan_script.js    the Papan Tanda batch form
     audit_pending.js         the home board's plot order and plot list
     audit_home.html          _PLOT_NUR, which nursery a plot is in

   So a plot added in the office appeared on every other screen in the
   company and on NONE of the auditor's. There was nothing on screen to say
   one was missing either: the grid simply drew the plots it had always drawn,
   which is the shape of fault this repository keeps finding — a figure that
   is silent is indistinguishable from a figure that is right.

   The live case is the same one `shared_maint_plots.js` and
   `audit_maintenance_script.js` were each written for: a "-R" plot, made by
   a 3rd-culling transfer and in no hardcoded list anywhere, and a plot past
   the end of a range (B15, U19).

   ── WHAT THIS FILE IS ─────────────────────────────────────────────────────

   ONE list for the whole module, read by all five of those files. It does
   NOT read `shared_plots` itself: `shared/shared_maint_plots.js` is where
   that read lives for the whole office repository, and a second copy of it
   is how two screens come to disagree about which plots exist. This file is
   the audit module's view of that list, and it adds exactly two things the
   shared one cannot know about:

   1. THE PADDED SPELLING. The audit module has always written a plot as
      'B01'; `shared_plots` holds whatever the office typed, usually 'B1'.
      Every saved audit, every grid key and every deep link in this module is
      in the padded form, so the padded form is what this list holds and
      `canon()` is the one way in. Handing the module the office's spelling
      instead would silently orphan every audit ever saved.

   2. THE RANGES AS THE FALLBACK, which they were the FLOOR for a day. The
      office asked for the other half the same afternoon — *"i deleted a
      plot, make it remove from all modules too"* — and the floor was exactly
      what stopped the ✕ on the settings page doing anything: B14 was offered
      whether or not `shared_plots` had a row for it.

      So the LIST is Seedling Stock's answer where the office has keyed one,
      and the range answers for a nursery they have not. `MJMMaintPlots
      .offered()` is the whole of that rule and this file keeps no second
      copy of it. Three things hold it up:

        - a read that FAILS changes nothing, which is the fail-open rule
          every other gate here follows. An empty plot list is a module
          nobody can use, and a plot picker that went blank because a table
          could not be read is worse than one that is a plot short.
        - it is asked PER NURSERY. A nursery Seedling Stock holds no plot for
          keeps its whole range, because an absent answer is nobody having
          been asked — and the Pre Nursery is counted in TRAYS, so a global
          test would wipe P01 to P52 off every grid in the module.
        - a plot added in the office appears everywhere in the module, and a
          plot deleted leaves it.

      WHAT IT COSTS, said plainly: this module has no saved-rows rule of its
      own, so a plot the office deletes is off the auditor's grid and its
      dropdown at once. The AUDITS are not touched — they are rows of
      `audit_plot_audits` and the like, and `byPlot()` goes on placing them,
      which is what the next paragraph is about.

   ── THE LIVE OBJECTS ──────────────────────────────────────────────────────

   `all()` and `byPlot()` hand back the SAME objects every time, and `load()`
   fills them IN PLACE. That is what makes this a four-line change in each of
   the five files rather than a rewrite of every reader: a grid that reads
   `NURSERY_PLOTS[tab]` on each draw picks up a plot that arrived after the
   first draw, and a lookup that reads `PLOT_TO_NURSERY[p]` does too.

   It also means nothing may SNAPSHOT them at script load. The reverse
   lookups each of those files used to build with an IIFE at the top of the
   file are exactly that, and they are why this file owns `byPlot()`.

   ══════════════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {

  /* The four ranges the audit module has always drawn. PADDED, for the
     reason above. */
  function pad(letter, n) {
    const out = [];
    for (let i = 1; i <= n; i++) out.push(letter + String(i).padStart(2, '0'));
    return out;
  }

  const NURSERIES = ['PN', 'BNN', 'UNN1', 'UNN2'];

  const LIST = {
    PN:   pad('P', 52),
    BNN:  pad('B', 14),
    UNN1: pad('U', 18),
    UNN2: pad('N', 20)
  };

  /* Plot code → nursery, keyed by BOTH the padded ('B01') and the unpadded
     ('B1') spelling, so a lookup off the operation ledger or off a saved
     record resolves without a canonicalise-then-look-up two-step. This is
     the map the five files each used to build for themselves. */
  const BY_PLOT = {};

  /* Letters and digits, upper-cased — the same comparison every other
     crossing of this boundary uses, so "B 4", "b4" and "B04" are one plot. */
  const key = (v) => String(v == null ? '' : v).replace(/[^a-z0-9]/gi, '').toUpperCase();

  /* 'B1' → 'B01', keeping the '-R' of a transfer plot. A name that is not
     letters-then-digits — 'PLOT-A', say, which the settings page will take —
     is handed back trimmed and upper-cased rather than mangled.

     SHARED RULE: this is _canonicalPlot in audit_script.js and
     audit_height_script.js, canonPlot in audit_pending.js and _canonPlot in
     audit_home.html, which now all read it from here. */
  function canon(raw) {
    const s = String(raw == null ? '' : raw).trim().toUpperCase();
    const m = s.match(/^([A-Z]+)(\d+)(-R)?$/);
    return m ? m[1] + m[2].padStart(2, '0') + (m[3] || '') : s;
  }

  /* The ranges, kept apart from LIST so that LIST can be REPLACED by the
     office's answer and the placing map below can still carry them. */
  const RANGES = {};
  NURSERIES.forEach(n => { RANGES[n] = LIST[n].slice(); });

  /* B10 sorts after B2, not before it — the same comparison every other
     plot picker in the portal uses. */
  const order = (a, b) => String(a).localeCompare(String(b), undefined,
                                                  { numeric: true, sensitivity: 'base' });

  /* THE LIST IS SET IN PLACE, never reassigned, because `all()` hands the
     same object out to five files and two of them hold an ARRAY off it.
     Emptying and refilling each array is what lets a plot DISAPPEAR from a
     grid already drawn, which is the whole of what the office asked for. */
  function setList(nursery, plots) {
    const arr = LIST[nursery];
    if (!arr) return;
    const seen = new Set();
    const keep = [];
    plots.forEach(p => {
      const code = canon(p);
      const k = key(code);
      if (!k || seen.has(k)) return;
      seen.add(k); keep.push(code);
    });
    keep.sort(order);
    arr.length = 0;
    arr.push.apply(arr, keep);
  }

  /* The same question asked on letters and digits alone, for a plot keyed
     with a stray space — 'B 15'. canon() cannot help there: its pattern is
     letters-then-digits and 'B 15' does not match it, so it hands the
     string back as it found it. Only nurseryOf() consults this, and only
     after the two spellings above have both missed. */
  const BY_KEY = {};

  /* THE PLACING MAP CARRIES THE RANGES AS WELL AS THE LIST, and that
     asymmetry is deliberate: a plot the office DELETED is off every grid
     and dropdown, and a saved audit or a maintenance record still naming it
     must go on resolving to its nursery. Taking a plot off the pickers must
     not take last month's work off the claim, or off the board that owes an
     audit for it. `shared_maint_plots.js` says the same of its own
     `index()`. */
  function reindex() {
    [BY_PLOT, BY_KEY].forEach(m => Object.keys(m).forEach(k => { delete m[k]; }));
    NURSERIES.forEach(n => {
      const seen = new Set();
      [RANGES[n], LIST[n]].forEach(src => (src || []).forEach(p => {
        if (seen.has(p)) return;
        seen.add(p);
        BY_PLOT[p] = n;
        const stripped = p.replace(/^([A-Z]+)0+(\d)/, '$1$2');
        if (stripped !== p) BY_PLOT[stripped] = n;
        BY_KEY[key(p)] = n;
        BY_KEY[key(stripped)] = n;
      }));
    });
  }
  reindex();

  /* MJMMaintPlots wants a supabase-js client and the audit pages have their
     own thin one. Two methods is the whole of what it asks for.

     This shim is the one in audit_maintenance_script.js, which was the first
     file in this module to read the shared list; that file now reads this
     one, so there is one shim and not two. */
  function shim() {
    if (typeof sb === 'undefined' || !sb || typeof sb.select !== 'function') return null;
    return {
      from(table) {
        return {
          select(cols) {
            return sb.select(table, 'select=' + String(cols).replace(/\s+/g, ''))
                     .then(rows => ({ data: rows || [] }), error => ({ error }));
          }
        };
      }
    };
  }

  let _promise = null;
  let _ready   = false;
  let _added   = [];          // ['BNN|B15', …] — what Seedling Stock added
  let _gone    = [];          // ['BNN|B14', …] — what the office has deleted

  /* Idempotent: every one of the five callers may ask, and the read happens
     once per page. Never rejects — a module that cannot read the office's
     plot list still has the four ranges, which is where it was. */
  function load() {
    if (_promise) return _promise;
    _promise = (async function () {
      try {
        /* OFFLINE SENDS NOTHING. Two requests to the service worker's own
           synthetic 503 answer nothing and cost a round trip each on a
           nursery signal; the four ranges are the right answer with no
           line, the same way every offline cache in this module works. */
        if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return;
        const client = shim();
        if (!client || typeof MJMMaintPlots === 'undefined') {
          /* Not an error worth a warning on a page that does not load the
             shared file — it simply keeps the ranges. */
          return;
        }
        /* `offer` is the office's list where they have keyed one and the
           range where they have not — MJMMaintPlots.offered is the whole of
           that rule and this file does not keep a second copy of it. */
        const got = await MJMMaintPlots.loadLists(client);
        NURSERIES.forEach(n => {
          const was = new Set(LIST[n].map(key));
          setList(n, (got.offer && got.offer[n]) || RANGES[n]);
          const now = new Set(LIST[n].map(key));
          LIST[n].forEach(p => { if (!was.has(key(p))) _added.push(n + '|' + p); });
          RANGES[n].forEach(p => { if (!now.has(key(p))) _gone.push(n + '|' + p); });
        });
        reindex();
      } catch (e) {
        console.warn('[audit-plots] Seedling Stock plot list unavailable, '
                   + 'using the built-in ranges', e);
      } finally {
        _ready = true;
      }
    })();
    return _promise;
  }

  global.MJMAuditPlots = {
    NURSERIES: NURSERIES.slice(),
    all:    () => LIST,            // LIVE — filled in place by load()
    byPlot: () => BY_PLOT,         // LIVE — ditto
    list:   (n) => (LIST[n] || []).slice(),
    nurseryOf: (p) => BY_PLOT[p] || BY_PLOT[canon(p)] || BY_KEY[key(p)] || null,
    canon, key, load,
    ready:  () => _ready,
    /* What Seedling Stock added that the ranges did not have, and what it
       has TAKEN AWAY, as 'BNN|B15'. Nothing on a screen reads either;
       they are here so that "the office added B15 and the auditor cannot
       see it", and "we deleted B14 and it is still there", are both
       answerable from the console on the phone it is happening on — which
       is the one place a check written here cannot reach. */
    added:  () => _added.slice(),
    gone:   () => _gone.slice(),
    ranges: (n) => (RANGES[n] || []).slice()
  };

})(typeof window !== 'undefined' ? window : globalThis);
