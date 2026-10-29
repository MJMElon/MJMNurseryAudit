/* ════════════ CULLING MONITORING — ONE RULE, TWO PAGES ════════════
   A plot that went from Saringan Anak Bibit to the end of Transplanting in
   15 days or fewer earns an incentive, and the office set who gets it:

     - Rousell Wayne and Florence, RM 20 for EVERY such plot, whichever
       nursery it is in;
     - each nursery's Field Conductor, RM 50 for every such plot in THEIR
       OWN nursery — Lalu Aenal for BNN, Akbar for UNN 1, Azhar for UNN 2.

   WHERE IT LIVES. The office asked for it to be worked on Worker Activity →
   Culling Monitoring (nursery_ops_maintenance.html), the same place every
   other piece of field work is gone through and Checked — and for the money
   to be on the payroll and nowhere else:

     Worker Activity  which plots, how long, which days, who earns it, and
                      the Check that agrees it.
     Nursery Payroll  the RM, off the CHECKED plots only.

   So the timing is here, in one copy both pages read. The payroll's own copy
   of it was taken out the day this moved; two pages timing one run is how a
   plot is fast on one and slow on the other.

   Which plots are asked about is the LEDGER's answer: every plot with a
   `Transplanted` row dated in the month, the date read the way the
   Transplanting Report reads it. How long the plot took is PALMS's answer,
   and it is the Motion Study's own measure — the plot's cycle, from the
   first day of Saringan to the last day Transplanting was closed
   (MJMPalms.cyclesOf, diffDays, <= TARGET_DAYS).

   THE LATEST RUN. The run that counts is the newest one whose Saringan had
   started by the end of the month — so a month already paid does not change
   its answer when the plot starts its next intake. A split plot ("B2#A",
   "B2#B") is timed as one plot: its areas' latest runs, from the earliest
   Saringan to the last Transplanting.

   BY HAND. mjmnpayroll_cull_incentive_overrides, ONE record per plot per
   month: `add` counts the plot whatever PALMS says, `remove` leaves it out.

   CHECKED. nops_cull_incentive_checks, ONE record per plot per month, and it
   carries what the row READ when it was agreed — the dates and the days —
   so a PALMS correction made after the office signed does not move money it
   already agreed. Same rule as qtyFrozen on the maintenance rows: Checked
   stops a figure being a formula. Unchecking clears the tick and the plot
   goes back to the live answer.

   No -R plot, by PALMS's own MJMPalms.isReplantPlot. */
(function (global) {
  'use strict';

  const RULE = {
    everyPlot: [
      { name: 'Rousell Wayne', rm: 20 },
      { name: 'Florence',      rm: 20 }
    ],
    ownNursery: [
      { name: 'Lalu Aenal', nursery: 'BNN',  rm: 50 },
      { name: 'Akbar',      nursery: 'UNN1', rm: 50 },
      { name: 'Azhar',      nursery: 'UNN2', rm: 50 }
    ]
  };
  const NURSERIES = RULE.ownNursery.map(p => p.nursery);
  const P = () => global.MJMPalms || null;
  /* READ LIVE OFF PALMS, never captured. It used to be taken once at load
     — `(global.MJMPalms && …TARGET_DAYS) || 15` — which quietly made the
     load ORDER decide the answer: a page that read this file before PALMS
     timed every plot against a fallback 15 while the Motion Study beside it
     used whatever PALMS said. Now there is one number and no order to get
     wrong, and it follows the office changing it without being told. */
  const _target = () => {
    const t = global.MJMPalms && global.MJMPalms.TARGET_DAYS;
    return Number.isFinite(Number(t)) && Number(t) > 0 ? Number(t) : 15;
  };

  /* Letters and digits, uppercase — nurseryKey / plotKey, the house rule. */
  const key = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');

  /* BNN / UNN1 / UNN2, or '' for a nursery this incentive does not pay. */
  function sectionOf(nursery) {
    const k = key(nursery);
    return NURSERIES.find(n => n === k) || '';
  }
  function sectionOfPlot(plot) {
    const p = P();
    return p && p.nurseryOfPlot ? sectionOf(p.nurseryOfPlot(plot)) : '';
  }

  /* WHEN a ledger row happened. SHARED RULE — _logDate() in
     operation/operation_reports.html and logDate() in the FC Portal
     transplantData.js. Change one, change the others. */
  function logDate(l) {
    if (l && l.transaction_date) return String(l.transaction_date).slice(0, 10);
    const m = l && l.remark ? String(l.remark).match(/(?:Cull)?Date:\s*(\d{4}-\d{2}-\d{2})/i) : null;
    if (m) return m[1];
    return l && l.created_at ? String(l.created_at).slice(0, 10) : '';
  }

  function isReplant(plot) {
    const p = P();
    if (p && p.isReplantPlot) return p.isReplantPlot(plot);
    return /-R\d*$/i.test(String(plot == null ? '' : plot).split('#')[0].trim());
  }

  /* Plain `Transplanted` only: the other two go into the Premium Care and
     Double Tone TRAYS, and a tray has no Saringan to Transplanting run. */
  function indexTransplanted(ledgerRows) {
    const tp = {};
    (ledgerRows || []).forEach(l => {
      if (l.transaction_type !== 'Transplanted') return;
      const pk = key(l.plot_name), d = logDate(l);
      if (pk && d) (tp[pk] || (tp[pk] = { plot: String(l.plot_name).trim(), dates: [] })).dates.push(d);
    });
    return tp;
  }

  /* A stage number, by NAME — the office keeps the stage list. */
  function actN(word, fallback) {
    const p = P();
    for (let n = 1; n <= 40; n++) {
      const a = p.actByN(n);
      if (a && key(a.name).indexOf(word) !== -1) return n;
    }
    return fallback;
  }

  /* The latest Saringan → Transplanting run of one plot, as at the month. */
  function runOf(palms, plot, monthEnd) {
    const p = P();
    if (!palms || !p) return { state: 'unread' };
    const want = key(plot);
    const keys = Object.keys(palms).filter(k => key(p.plotOf(k)) === want);
    const lo = p.FIRST_ACT || 1, hi = actN('TRANSPLANT', 9);
    const runs = [];
    keys.forEach(k => {
      let latest = null;
      p.cyclesOf(palms[k]).forEach(cy => {
        const starts = cy.entries.filter(e => e.actN === lo).map(e => e.start).sort();
        if (!starts.length || starts[0] > monthEnd) return;
        const ends = cy.entries.filter(e => e.actN === hi && e.end).map(e => e.end).sort();
        const run = { start: starts[0], end: ends.length ? ends[ends.length - 1] : null };
        if (!latest || run.start > latest.start) latest = run;
      });
      if (latest) runs.push(latest);
    });
    if (!runs.length) return { state: 'none' };
    const start = runs.map(r => r.start).sort()[0];
    if (runs.some(r => !r.end)) return { state: 'open', start };
    const end = runs.map(r => r.end).sort().pop();
    const days = p.diffDays(start, end);
    return { state: days <= _target() ? 'ok' : 'slow', start, end, days };
  }

  /* Every plot transplanted in the month, timed, with what was done to it by
     hand and whether it has been Checked.

       o.transplanted  indexTransplanted(...) — every month
       o.palms         MJMPalms logs by unit, or null when unread
       o.overrides     this month's by-hand records
       o.checks        this month's Checked records
       o.ym            'YYYY-MM'
       o.section       '' for every nursery, or BNN / UNN1 / UNN2

     Each row: plot, section, dates (ledger, this month), state, start, end,
     days, override, counts (it qualifies or was counted by hand), check (the
     record, when it carries a tick), and `paid` — counted AND checked. A
     checked row reads the dates and days it was agreed on. */
  function plots(o) {
    const ym = o.ym, monthEnd = ym + '-31';
    const rows = Object.values(o.transplanted || {})
      .map(p => ({ plot: p.plot, dates: [...new Set(p.dates.filter(d => d.slice(0, 7) === ym))].sort(),
                   section: sectionOfPlot(p.plot) }))
      .filter(p => p.dates.length && !isReplant(p.plot))
      .map(p => Object.assign(p, runOf(o.palms, p.plot, monthEnd)));

    (o.overrides || []).filter(x => x.month === ym).forEach(x => {
      if (isReplant(x.plot)) return;       // a -R plot is never on it, by hand or not
      const k = key(x.plot);
      let r = rows.find(y => key(y.plot) === k);
      if (!r) {
        if (x.action !== 'add') return;    // nothing to take out
        const start = x.saringan_date || null, end = x.transplant_date || null;
        r = { plot: String(x.plot).trim(), dates: end ? [end] : [], manual: true,
              section: sectionOf(x.section) || sectionOfPlot(x.plot),
              state: 'manual', start, end,
              days: start && end && P() ? P().diffDays(start, end) : null };
        rows.push(r);
      }
      r.override = x;
    });

    rows.forEach(r => {
      r.counts = r.override ? r.override.action === 'add' : r.state === 'ok';
      const c = (o.checks || []).find(x => x.month === ym && key(x.plot) === key(r.plot) && x.checked_at);
      r.check = c || null;
      if (c) {
        // What was agreed is what is paid — see CHECKED above.
        r.live = { start: r.start, end: r.end, days: r.days };
        r.start = c.saringan_date || r.start;
        r.end = c.transplant_date || r.end;
        r.days = c.days != null ? Number(c.days) : r.days;
        if (c.section) r.section = sectionOf(c.section) || r.section;
      }
      r.paid = !!(r.counts && r.check);
    });

    return rows
      .filter(r => !o.section || r.section === o.section)
      .sort((a, b) => String(a.plot).localeCompare(String(b.plot),
                        undefined, { numeric: true, sensitivity: 'base' }));
  }

  /* Who earns a plot: the two who earn every plot, and the Field Conductor
     of the plot's own nursery. Names only — the money is the payroll's. */
  function whoEarns(section) {
    return RULE.everyPlot.map(p => p.name)
      .concat(RULE.ownNursery.filter(p => p.nursery === section).map(p => p.name));
  }

  async function loadOverrides(supa, ym) {
    const res = await supa.from('mjmnpayroll_cull_incentive_overrides')
      .select('id, month, plot, action, section, saringan_date, transplant_date, remark, created_by, created_at')
      .eq('month', ym).then(r => r, e => ({ error: e }));
    if (res && res.error) return { ready: false, rows: [], error: res.error };
    return { ready: true, rows: (res && res.data) || [] };
  }

  async function loadChecks(supa, ym) {
    const res = await supa.from('nops_cull_incentive_checks')
      .select('id, month, plot, section, saringan_date, transplant_date, days, checked_at, checked_by')
      .eq('month', ym).then(r => r, e => ({ error: e }));
    if (res && res.error) return { ready: false, rows: [], error: res.error };
    return { ready: true, rows: (res && res.data) || [] };
  }

  /* ── WHO IS PAID, AND HOW MUCH, IS THE OFFICE'S NOW ──────────────────
     The rule above is the one that was fixed in this file, and it stays as
     the FALLBACK. The live one is two tables the office keys on Settings
     (shared/RUN_ME_cull_monitoring_rule.sql), and `loadRule` brings it in.

     IT FAILS OPEN, and that is the whole shape of it. A database that has
     not had the file run, an RLS refusal, a dropped connection — any of
     them leaves the built-in rule in place and every plot pays exactly what
     it paid before. A claim that went to NOUGHT because a read failed would
     be the worst possible way for this to break, and it is the one the
     plain `|| []` would have given.

     SO EVERY READER HAS TO SAY WHICH RULE IT IS ON. `ruleSource()` answers
     `office` or `built-in`, and a screen pricing work off the built-in list
     while the office believes it has set the rates is the "a gate that is
     missing is said LOUDER" rule, one table along.

     THE ARRAYS ARE FILLED IN PLACE, never reassigned. `NURSERIES` is
     derived from `RULE.ownNursery` and both are exported by reference, so a
     caller that took a reference before the load — which is every caller,
     the module being read at the top of the page — would go on holding the
     built-in list for ever. */
  /* ONE NAME, ONE REGISTER ROW — and this is the ONLY copy of that rule.
     The names on this rule are short ("Florence", "Akbar") and the register
     spells them out ("Florence Anak Jugah", "Akbar Cahaya"), so an exact
     match alone marks five people as strangers to a register that can place
     every one of them. Exact first, then every word of the rule name
     appearing in the register name, and a name claimed by TWO rows resolves
     to NEITHER — picking one moves somebody money that is not theirs.

     The payroll claim's `cullWorker` is what used to carry this and now
     calls it, so the dropdown on Settings offers the row the claim will
     actually pay. Two copies would be a name the office picked and a name
     the claim could not find. */
  const _words = s => String(s == null ? '' : s).toUpperCase()
    .split(/[^A-Z0-9]+/).filter(Boolean);
  function resolveName(name, list, nameOf) {
    const of = nameOf || (x => (x && x.full_name) || x);
    const rows = (list || []).filter(Boolean);
    const exact = rows.filter(w => key(of(w)) === key(name));
    if (exact.length === 1) return { row: exact[0], clash: [] };
    const want = _words(name);
    if (!want.length) return { row: null, clash: [] };
    const hits = rows.filter(w => { const t = _words(of(w)); return want.every(x => t.includes(x)); });
    if (hits.length === 1) return { row: hits[0], clash: [] };
    return { row: null, clash: hits.map(of) };
  }

  let _ruleSource = 'built-in';
  let _ruleError = null;
  /* What the last load was ABOUT, and every row it saw — the Settings
     card edits history and needs the rows it is editing, not only the
     ones in force. */
  let _ruleMonth = null, _ruleRows = [], _ruleRates = [];
  const ruleSource = () => _ruleSource;
  const ruleError = () => _ruleError;

  function _fillInPlace(arr, rows) { arr.length = 0; rows.forEach(r => arr.push(r)); }

  /* THE RULE IS ASKED FOR A MONTH, because a price changed today must not
     move what last month came to. The office: *"我什么时候改的价钱 是不会
     影响以前的月份的 例如我10月改RM50变40 9月份的还是RM50"*.

       the price   the NEWEST rate row for that kind whose from_month is not
                   after the month being asked about.
       the people  every row whose from_month is not after the month and
                   whose until_month is empty or AFTER it.

     Months are YYYY-MM, which is what both screens already use and what
     lets a plain text comparison answer which came first. */
  function _rateFor(rows, kind, ym) {
    let best = null;
    (rows || []).forEach(r => {
      if (r.kind !== kind || String(r.from_month || '') > ym) return;
      if (!best || String(r.from_month || '') > String(best.from_month || '')) best = r;
    });
    return best ? Number(best.rm) : null;
  }
  function _inMonth(r, ym) {
    return String(r.from_month || '') <= ym
        && (!r.until_month || String(r.until_month) > ym);
  }

  async function loadRule(supa, ym) {
    if (!supa) return { ready: false, source: _ruleSource };
    /* No month is TODAY's, which is what the Settings card is editing and
       what a caller with nothing in particular in mind means. */
    const month = ym || (() => { const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); })();
    const ask = (t, cols) => supa.from(t).select(cols).then(r => r, e => ({ error: e }));
    const [rate, people] = await Promise.all([
      ask('nops_cull_monitoring_rate', 'id, kind, from_month, rm'),
      ask('nops_cull_monitoring_people',
          'id, kind, nursery, worker_id, worker_name, from_month, until_month')
    ]);
    const bad = (rate && rate.error) || (people && people.error);
    if (bad) {
      _ruleSource = 'built-in'; _ruleError = bad;
      return { ready: false, source: _ruleSource, error: bad };
    }
    const rateRows = (rate && rate.data) || [];
    const allPeople = (people && people.data) || [];
    const live = allPeople.filter(r => r && _inMonth(r, month));

    /* A rule with NOBODY on it for this month is not a rule somebody keyed,
       it is a table that has not been filled in — and reading it as "pay
       nobody" is the nought this whole function exists to avoid. */
    if (!live.length) {
      _ruleSource = 'built-in'; _ruleError = null;
      return { ready: true, source: _ruleSource, empty: true, month };
    }
    const admRm = _rateFor(rateRows, 'admin', month);
    const fcRm  = _rateFor(rateRows, 'fc', month);
    /* The target rides in the same table and is handed straight to PALMS,
       which owns it — so the Motion Study and this are one number and
       cannot disagree. */
    const tgt = _rateFor(rateRows, 'target', month);
    if (tgt != null && global.MJMPalms && global.MJMPalms.setTargetDays) {
      global.MJMPalms.setTargetDays(tgt);
    }
    const mk = (r, rm, nursery) => ({ id: r.id, name: r.worker_name, workerId: r.worker_id,
      from: r.from_month, until: r.until_month || null, rm,
      ...(nursery === undefined ? {} : { nursery }) });
    _fillInPlace(RULE.everyPlot, live.filter(r => r.kind === 'admin')
      .map(r => mk(r, admRm == null ? 20 : admRm)));
    _fillInPlace(RULE.ownNursery, live.filter(r => r.kind === 'fc')
      .map(r => mk(r, fcRm == null ? 50 : fcRm, sectionOf(r.nursery) || key(r.nursery))));
    /* Rebuilt because a nursery is only on this list while somebody is paid
       on it, and the office can take the last Field Conductor off one. */
    _fillInPlace(NURSERIES, [...new Set(RULE.ownNursery.map(p => p.nursery))]);
    _ruleSource = 'office'; _ruleError = null;
    _ruleMonth = month; _ruleRows = allPeople; _ruleRates = rateRows;
    return { ready: true, source: _ruleSource, month, rate: { admin: admRm, fc: fcRm } };
  }


  global.MJMCullIncentive = {
    RULE, NURSERIES, key, sectionOf, sectionOfPlot, logDate, isReplant,
    /* PALMS owns it; this is the same number, not a second one. */
    get TARGET_DAYS() { return _target(); },
    indexTransplanted, runOf, plots, whoEarns, loadOverrides, loadChecks,
    loadRule, ruleSource, ruleError, resolveName,
    ruleMonth: () => _ruleMonth, ruleRows: () => _ruleRows, ruleRates: () => _ruleRates
  };
})(typeof window !== 'undefined' ? window : globalThis);
