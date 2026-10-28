/* ════════════ THE CULLING INCENTIVE — ONE RULE, TWO PAGES ════════════
   A plot that went from Saringan Anak Bibit to the end of Transplanting in
   15 days or fewer earns an incentive, and the office set who gets it:

     - Rousell Wayne and Florence, RM 20 for EVERY such plot, whichever
       nursery it is in;
     - each nursery's Field Conductor, RM 50 for every such plot in THEIR
       OWN nursery — Lalu Aenal for BNN, Akbar for UNN 1, Azhar for UNN 2.

   WHERE IT LIVES. The office asked for it to be worked on Worker Activity →
   Culling Incentive (nursery_ops_maintenance.html), the same place every
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
  const TARGET_DAYS = (global.MJMPalms && global.MJMPalms.TARGET_DAYS) || 15;

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
    return { state: days <= TARGET_DAYS ? 'ok' : 'slow', start, end, days };
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

  global.MJMCullIncentive = {
    RULE, NURSERIES, TARGET_DAYS, key, sectionOf, sectionOfPlot, logDate, isReplant,
    indexTransplanted, runOf, plots, whoEarns, loadOverrides, loadChecks
  };
})(typeof window !== 'undefined' ? window : globalThis);
