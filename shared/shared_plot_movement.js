/* ══════════════════════════════════════════════════════════════════════════
   PLOT MOVEMENT — the one place that answers "how many were standing on
   plot X, batch Y, on date Z?"

   The Nursery Movement Report, the Work Maintenance record list and the
   Payroll salary claim all quote that number. They used to work it out
   separately, and the payroll one did not work it out at all — it read the
   keyed qty and showed a dash when there was none, so every worker earned
   RM 0.00 on a plot the maintenance sheet had ticked.

   One module, one answer. Load it once per page:

       await PlotMovement.load(_supabase);
       PlotMovement.recQty(record).value

   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* Same date resolution the batch report needs: it saves most movement rows
     without transaction_date and puts the keyed date in the remark instead. */
  const RE_MV_DATE = /(?:Cull)?Date:\s*(\d{4}-\d{2}-\d{2})/i;
  function logDate(l) {
    if (l.transaction_date) return String(l.transaction_date).slice(0, 10);
    const m = l.remark ? String(l.remark).match(RE_MV_DATE) : null;
    if (m) return m[1];
    return l.created_at ? String(l.created_at).slice(0, 10) : null;
  }

  /* Tarikh is now stored as YYYY-MM-DD (the date picker's own format), but older
     records hold "09-03-2026", "20 apr 2026" or "-" for work not yet done, so all
     of those still have to read. */
  function parseDate(s) {
    const str = String(s == null ? '' : s).trim();
    if (!str || str === '-') return null;
    let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    m = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
    const d = new Date(str);
    if (isNaN(d)) return null;
    // Text like "20 apr 2026" parses in LOCAL time; pin it to UTC midnight so a
    // round-trip through the picker can never slip to the day before.
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }

  const plotKey  = v => String(v == null ? '' : v).trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
  const batchKey = v => String(v == null ? '' : v).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  function batchList(s) {
    return String(s == null ? '' : s).split(/[,;/|]+/).map(batchKey).filter(Boolean);
  }

  /* ── WHAT A WORK RECORD'S PLOT AND BATCH IS WORTH ───────────────────────

     THE SUMMARY REPORT'S BALANCE, for the same plot, the same batches and
     the same date. The office asked for it in one line — *"我要link这个
     summary report"* — and it is the report they reconcile against, so
     this file is that report asked one plot at a time rather than a second
     answer beside it.

       Balance = transplanted from PN + transfer in
               - sold - 3rd culled - transfer out + stock adjustment
               - 2nd culled, UNLESS the same plot and batch already carries
                 an evidenced 3rd culling

     The first line is MOVE_COLS.main in operation_reports.html, column for
     column. The last is MOVE_COLS.main2 and netOfRow()'s own condition,
     and the condition is the whole of what was wrong here before: a 3rd
     culling ALREADY INCLUDES the seedlings 2nd culled on the way to it
     (the Batch Report's own rule — cull2 "is inside cull3"), so a figure
     that takes both off takes one loss off twice. On a plot 2nd culled and
     then 3rd culled this file read LOWER than the report it claims to be,
     by exactly the 2nd culling, and the piece-rate money read low with it.

     The bucket the condition is asked of is the PLOT AND BATCH, which is
     what `per` below is, because that is the bucket the report asks it of
     (`e.place + SEP + e.batch` in buildMovementSection).

     Worked example — U1 batch 250, 100 transplanted, 2nd culled 10 Sep with
     5 dead, 25 sold on the 18th, 3rd culled 60 on the 24th and flown:
         work on  1 Sep → 100   nothing has happened yet
         work on 11 Sep →  95   the 5 dead are off
         work on 18 Sep →  70   and the 25 sold, the same day counting
         work on 25 Sep →  15   the 60 third culled, and the 5 dead are back
                                IN — they are inside that 60

     THE PHONE SENDS NONE OF THIS, and it no longer reaches a cell.
     shared_plot_batch_balance counts neither culling, so the figure a
     maintenance record carries from a handset is a third answer again; the
     office asked for it out — *"link的capacity完全不要管手机送进来的"* — and
     applyFieldRecords stopped filling the quantity from it. The batches
     ticked still fill the batch cell, which is a field observation and is
     what this figure is then asked about.

     Two columns carry the report's own condition, applied where the events
     are built because both need the remark: a 3rd culling counts only once
     the drone map has been keyed (MapQty:) — until the plot has been flown
     the figure is a claim — and a stock calibration only once [APPROVED …].

     Stock_Calibration is already signed when it reaches here — a Found is
     positive, a Stolen negative — so it is returned as given rather than
     forced in a direction. */
  function signed(type, qty) {
    const q = Number(qty || 0);
    switch (type) {
      case 'Transplanted':
      // One 3rd-culling transfer log describes two sides; the event builder
      // splits it so the plot it arrived at gains and the one it left loses.
      case 'Cull3_Transfer_In':
        return Math.abs(q);
      case '3rd_Culling': case '2nd_Culling': case 'Sold':
      case 'Cull3_Transfer_Out':
        return -Math.abs(q);
      case 'Stock_Calibration':
        return q;
      default: return 0;
    }
  }

  let _events = null;      // [{plotKey, batchKey, batch, type, qty, ms}]
  let _ready  = false;
  let _err    = null;
  let _inFlight = null;

  /* Supabase caps one request at 1000 rows; the ledger is well past that. */
  async function fetchAll(build, pageSize = 1000) {
    const all = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await build().range(from, from + pageSize - 1);
      if (error) return { data: null, error };
      all.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return { data: all, error: null };
  }

  /* Pulled once per page load; the ledger is far too big to re-read per row.
     Calling it again while the first call is still running joins that one
     rather than starting a second. */
  function load(supabase) {
    if (_inFlight) return _inFlight;
    _inFlight = _load(supabase).finally(() => { _inFlight = null; });
    return _inFlight;
  }

  async function _load(supabase) {
    if (!supabase) return;
    try {
      const [logsRes, dosRes] = await Promise.all([
        fetchAll(() => supabase.from('shared_inventory_logs')
          .select('transaction_type, transaction_date, created_at, remark, plot_name, batch_name, quantity_change')
          .in('transaction_type', ['Transplanted', '2nd_Culling', '3rd_Culling',
              // A transfer plot (-R) is filled entirely by these. Without them
              // such a plot has no movement at all, and every quantity on it
              // reads as a dash.
              'Cull3_Transfer', 'Stock_Calibration'])
          .order('id', { ascending: true })),
        // Sold comes from the customer DO system, exactly as the report does it.
        fetchAll(() => supabase.from('shared_do_records')
          .select('delivery_date, status, remark, plot_1, qty_1, batch_1, plot_2, qty_2, batch_2, plot_3, qty_3, batch_3, plot_4, qty_4, batch_4, plot_5, qty_5, batch_5')
          .order('id', { ascending: true }))
      ]);
      if (logsRes.error) throw logsRes.error;

      const evs = [];
      const EVIDENCED = /MapQty:\s*\d+/;
      const APPROVED  = /\[APPROVED by [^\]]+ on [^\]]+\]/;
      (logsRes.data || []).forEach(l => {
        const t = l.transaction_type;
        // A 3rd culling nobody has flown yet is a claim, not a deduction —
        // the report leaves the batch standing, and so does this.
        if (t === '3rd_Culling' && !EVIDENCED.test(l.remark || '')) return;
        // A pending adjustment has not been ruled on and moves no figure
        // anywhere else in the system.
        if (t === 'Stock_Calibration' && !APPROVED.test(l.remark || '')) return;
        const ms = parseDate(logDate(l));
        if (ms == null) return;
        evs.push({
          plotKey:  plotKey(l.plot_name),
          batchKey: batchKey(l.batch_name),
          batch:    l.batch_name || '—',
          type:     t === 'Cull3_Transfer' ? 'Cull3_Transfer_In' : t,
          qty:      Number(l.quantity_change || 0),
          ms
        });
      });
      // The other side of every transfer: plot_name above is where the
      // seedlings landed, and the remark says which plot they left.
      (logsRes.data || []).forEach(l => {
        if (l.transaction_type !== 'Cull3_Transfer') return;
        const from = (l.remark || '').match(/From:\s*\[([^\]|]+)\|/);
        if (!from) return;
        const ms = parseDate(logDate(l));
        if (ms == null) return;
        evs.push({
          plotKey:  plotKey(from[1]),
          batchKey: batchKey(l.batch_name),
          batch:    l.batch_name || '—',
          type:     'Cull3_Transfer_Out',
          qty:      Math.abs(Number(l.quantity_change || 0)),
          ms
        });
      });
      // Which plot-batch rows the ledger actually has. The movement report only
      // counts a delivery order against one of these, so a batch mistyped on a
      // D/O cannot subtract from a plot; this has to agree with it or the two
      // screens quote different numbers for the same plot.
      const real = new Set(evs.filter(e => e.plotKey && e.batchKey)
                              .map(e => `${e.plotKey}${e.batchKey}`));
      ((dosRes && dosRes.data) || []).forEach(d => {
        if (d.status === 'Cancelled' || (d.remark && d.remark.includes('[CANCELLED]'))) return;
        const ms = parseDate(d.delivery_date);
        if (ms == null) return;
        for (let i = 1; i <= 5; i++) {
          const qty = Number(d[`qty_${i}`] || 0);
          if (!qty) continue;
          const pk = plotKey(d[`plot_${i}`]);
          const bk = batchKey(d[`batch_${i}`]);
          if (!real.has(`${pk}${bk}`)) continue;
          evs.push({
            plotKey: pk, batchKey: bk,
            batch: d[`batch_${i}`] || '—',
            type:  'Sold',
            qty, ms
          });
        }
      });
      _events = evs;
      _ready  = true;
      _err    = null;
    } catch (e) {
      _err = e.message || String(e);
      console.warn('[movement] load failed:', _err);
    }
  }

  /* ── INTERROW SPRAYING COUNTS WHAT WAS THERE BEFORE THE 2ND CULLING ─────

     Every other job is paid on what is standing: spraying P & D, manuring and
     weeding all happen TO the seedlings, so a batch 2nd culled the week before
     is that many fewer to treat.

     Interrow spraying is not done to the seedlings. It is the ground BETWEEN
     the rows, and a 2nd culling takes the dead seedling out of a polybag that
     is still sitting exactly where it was — same rows, same gaps, same walk,
     same spray. So the quantity for an interrow row is the one BEFORE the 2nd
     culling comes off, and the office has been keying it over by hand on every
     interrow row of every plot.

     It is the quantity, so it is also the piece-rate money: this is read by
     the Work Maintenance list, the Worker Record capacity totals and the
     payroll salary claim alike, which is why the rule lives here rather than
     in any one of them.

     A BATCH KEYED ON THE ROW STILL DECIDES, interrow included. Interrow is
     usually the whole plot — the worker walks the lot in one go — and leaving
     the batch cell empty is how that is said, because empty has always meant
     every batch standing there. But somebody who writes a batch on the row
     has answered the question, and this does not overrule them: the rule
     above is about the 2nd culling and nothing else.

     The maintenance list writes "Meracun rumput secara selingan"; anything
     carrying the word interrow is the same job under another spelling. The job
     is read off the record's JENIS and never off its chemical: the chemical
     changes round to round — Monex one round, something else the next — and
     says nothing about which job it is. */
  function isInterrow(jenis) {
    const s = String(jenis == null ? '' : jenis).toLowerCase();
    return s.indexOf('rumput secara selingan') >= 0 || s.indexOf('interrow') >= 0;
  }

  /* How a record's quantity is to be counted. One place, so the quantity, the
     batch names and every caller agree. */
  function qtyOpts(r) {
    return { keepCull2: isInterrow(r && (r.jenis || r.work_type)),
             exclBal:   !!(r && r.exclBal) };
  }

  /* ── A BALANCE LEFT BEHIND A TRANSFER IS THE CULLED BALANCE ─────────────
     A 3rd-culling transfer moves the good seedlings of a batch onto a -R
     plot. What that batch still shows on the plot it LEFT is what is about
     to be culled, and the link went on quoting it as capacity — so a plot
     near culling paid the workers for seedlings nobody was keeping.

     Only the office can tell whether a given round of work was done before
     the culling or after it, so it is a CHOICE on the row, never a rule:
     `exclBal` on the record ("Exclude balance"). Off, the figure is what it
     always was. On, every batch that has had a Cull3_Transfer out of this
     plot by the work date contributes nothing; the other batches standing on
     the plot are untouched. `culledBal` is that balance, returned whether or
     not it is excluded, so a screen can offer the choice only where there is
     one to make. */

  /* A 3RD CULLING SUPERSEDES THE 2ND, and this is the one place that says
     so. It is netOfRow()'s `superseded` in operation_reports.html, asked of
     one plot-and-batch bucket's events instead of one row's columns: a 3rd
     culling already includes the seedlings 2nd culled on the way to it, so
     taking the 2nd off as well takes one loss off twice.

     An unevidenced 3rd culling never became an event (see _load), so this
     cannot be satisfied by a claim nobody has flown — which is the same
     condition the report's own cull3 column carries. */
  function cull2Superseded(evs) {
    return (evs || []).some(e => e.type === '3rd_Culling'
                              && Math.abs(Number(e.qty || 0)) > 0);
  }

  /* What one plot and batch is worth, up to a date. Every event already
     carries its own sign and the ones that take no part never became
     events, so this is a plain sum.

     Two things keep the 2nd culling standing, for two unrelated reasons:
     opts.keepCull2 because interrow sprays the ground and not the seedlings
     (see isInterrow above), and a 3rd culling because it already contains
     it (see cull2Superseded). */
  function liveCount(evs, opts) {
    const keep2 = !!(opts && opts.keepCull2);
    const skip2 = keep2 || cull2Superseded(evs);
    return evs.reduce((sum, e) => {
      if (skip2 && e.type === '2nd_Culling') return sum;
      return sum + signed(e.type, e.qty);
    }, 0);
  }

  /* The linked quantity for one work record.
     Returns null when it cannot be resolved (data not loaded, no plot, or the
     plot/batch has no movement at all) so the caller can fall back gracefully. */
  function linkedQty(plot, batchStr, tarikh, opts) {
    if (!_ready || !_events || !plot) return null;
    const pk = plotKey(plot);
    if (!pk) return null;
    const wanted = batchList(batchStr);
    // No date keyed yet ("-") → stand at today, the plot's current standing count.
    const asOf = parseDate(tarikh);
    const cutoff = asOf == null ? Infinity : asOf;

    const per = {};
    /* A 2ND CULLING THE CUT-OFF LEFT OUT, counted rather than dropped in
       silence. The office looked at a P & D row and said the 2nd culling was
       not being considered — and a figure that has had nothing taken off
       reads exactly like a figure with no culling to take off. The two are
       different facts and only one of them is a question.

       This is NOT in the arithmetic and must not be: a culling dated after
       the day somebody sprayed had not happened when they sprayed, and the
       seedlings were standing. It is here so a screen can SAY so. */
    let cull2Later = 0, laterOn = null;
    const leftBy = new Set();   // batches transferred OUT of this plot by the cut-off
    for (const ev of _events) {
      if (ev.plotKey !== pk) continue;
      if (wanted.length && !wanted.includes(ev.batchKey)) continue;
      // Only movement up to the work date counts — anything dated later had
      // not happened yet, so those seedlings were still standing.
      if (ev.ms > cutoff) {
        if (ev.type === '2nd_Culling') {
          cull2Later += Math.abs(Number(ev.qty || 0));
          // The EARLIEST one left out, which is the next thing that would
          // move this figure if the work date were a day later.
          if (laterOn == null || ev.ms < laterOn) laterOn = ev.ms;
        }
        continue;
      }
      if (ev.type === 'Cull3_Transfer_Out') leftBy.add(ev.batchKey);
      (per[ev.batchKey] ||= { evs: [], label: ev.batch }).evs.push(ev);
    }
    const keep2 = !!(opts && opts.keepCull2);
    Object.values(per).forEach(b => { b.closing = liveCount(b.evs, opts); });

    const allKeys = Object.keys(per);
    if (!allKeys.length) return null;
    let culledBal = 0;
    allKeys.forEach(k => { if (leftBy.has(k)) culledBal += Math.max(0, per[k].closing); });
    const excl = !!(opts && opts.exclBal) && culledBal > 0;
    const keys = excl ? allKeys.filter(k => !leftBy.has(k)) : allKeys;
    /* ASKED PER BUCKET, never over the plot as a whole, because the
       supersede rule is per plot-and-batch: a plot with one batch 3rd
       culled and one not has some of its 2nd culling taken off and some of
       it standing, and a screen saying "taken off" about all of it would be
       wrong about half. cull2Off and cull2Inside are therefore the two
       halves of cull2 and add up to it. */
    let raw = 0, cull2 = 0, cull2Off = 0, cull2Inside = 0, cull3 = 0;
    keys.forEach(k => {
      raw += per[k].closing;
      let c2 = 0, c3 = 0;
      per[k].evs.forEach(e => {
        if (e.type === '2nd_Culling') c2 += Math.abs(Number(e.qty || 0));
        if (e.type === '3rd_Culling') c3 += Math.abs(Number(e.qty || 0));
      });
      cull2 += c2;
      cull3 += c3;
      if (keep2) return;                             // interrow keeps it all
      if (cull2Superseded(per[k].evs)) cull2Inside += c2;
      else                             cull2Off    += c2;
    });
    return {
      // NOT floored at zero: the movement report shows a negative balance
      // because it is a figure to look into, and a work record quoting 0 for
      // the same plot and batch would be quietly disagreeing with it.
      qty: Math.round(raw),
      raw: Math.round(raw),
      batches: keys.map(k => per[k].label).sort((a, b) => String(a).localeCompare(String(b), 'en', { numeric: true })),
      allBatches: wanted.length === 0,
      asOf: asOf == null ? null : tarikh,
      /* How much 2nd culling this figure is carrying, and whether it was left
         standing — so a screen can say WHY an interrow row reads higher than
         the P & D row beside it on the same plot and the same day. */
      cull2: Math.round(cull2),
      keptCull2: keep2 && cull2 > 0,
      /* Taken off this figure. Stated rather than left to be inferred from
         a number nobody can check. */
      cull2Off: Math.round(cull2Off),
      /* And the half that was NOT, because the 3rd culling it is inside has
         already taken it off. A figure with nothing deducted and a figure
         with a deduction that would have been double are the same number on
         screen, which is how the first version of this rule went unnoticed
         for as long as it did. */
      cull2Inside: Math.round(cull2Inside),
      cull3: Math.round(cull3),
      /* And the one the date left out — see the loop above. `cull2LaterOn`
         is the day it is dated, as YYYY-MM-DD, so the screen can name it. */
      cull2Later: Math.round(cull2Later),
      cull2LaterOn: laterOn == null ? null : new Date(laterOn).toISOString().slice(0, 10),
      /* The balance left behind a transfer out — see "the culled balance"
         above — and whether this figure has it taken off. */
      culledBal: Math.round(culledBal),
      culledBatches: allKeys.filter(k => leftBy.has(k)).map(k => per[k].label),
      exclBal: excl
    };
  }

  /* Quantity shown for a record: a keyed value always wins; otherwise the
     linked one.

     The work type is read off the record here rather than asked for, so every
     caller — the maintenance list, the capacity totals, the salary claim —
     gets the interrow rule without having to know it exists. */
  /* ── CHECKED FREEZES THE FIGURE ──────────────────────────────────────

     A linked quantity is a live sum of the batch ledger: a sale, a 3rd
     culling, a stock adjustment on that plot all move it, and they move it
     on rows that were settled months ago. Checked means the office has gone
     through the row and agreed it. After that the figure must stop being a
     formula and become a number — otherwise what was signed off is not what
     anybody reads later, and the piece-rate money moves with it.

     So checking a row writes what it was reading at that moment into
     qtyFrozen, and unchecking throws it away and the link comes back. The
     order is: a figure the office KEYED, then the frozen one, then the link.
     Keyed still wins, because that was always somebody's own answer.

     batchFrozen does the same for the batch names, which are drawn from the
     same ledger and would otherwise go on changing under a settled row. */
  function recQty(r) {
    if (r && (r.qty === 0 || r.qty)) return { value: Number(r.qty), linked: false };
    if (r && r.qtyFrozen != null && r.qtyFrozen !== '')
      return { value: Number(r.qtyFrozen), linked: false, frozen: true };
    const link = linkedQty(r && r.plot, r && r.batch, r && r.tarikh, qtyOpts(r));
    if (!link) return { value: null, linked: false };
    return { value: link.qty, linked: true, info: link };
  }

  /* What to write into a row being checked, and nothing at all for a row
     whose figure is already the office's own or cannot be resolved. Returns
     the fields to set, so the caller does not have to know the names. */
  function freezeFor(r) {
    const out = {};
    if (!r) return out;
    if (!(r.qty === 0 || r.qty)) {
      const link = linkedQty(r.plot, r.batch, r.tarikh, qtyOpts(r));
      if (link && link.qty != null) out.qtyFrozen = link.qty;
    }
    if (!String(r.batch || '').trim()) {
      const b = recBatches(r);
      if (b && b.linked && b.value) out.batchFrozen = b.value;
    }
    return out;
  }

  /* WHICH BATCHES A RECORD COVERS.

     An empty batch cell is not "unknown", it is EVERY batch standing on that
     plot that day — that is what leaving it blank has always meant, and it is
     what the quantity beside it is already counting. So the names are answered
     from the ledger instead of drawn as a dash, which read as nobody knowing
     while the answer sat in the batch report.

     Keyed wins, exactly as the quantity does — for every job, interrow
     included. */
  function recBatches(r) {
    const keyed = String((r && r.batch) || '').trim();
    if (keyed) return { value: keyed, linked: false };
    const frozen = String((r && r.batchFrozen) || '').trim();
    if (frozen) return { value: frozen, linked: false, frozen: true };
    const link = linkedQty(r && r.plot, r && r.batch, r && r.tarikh, qtyOpts(r));
    if (!link || !link.batches.length) return { value: keyed, linked: false };
    const shown = link.batches.filter(b => b && b !== '—').join(', ');
    if (!shown) return { value: keyed, linked: false };
    return { value: shown, linked: shown !== keyed, info: link };
  }

  global.PlotMovement = {
    load, fetchAll,
    ready: () => _ready,
    error: () => _err,
    events: () => _events,
    parseDate, logDate, plotKey, batchKey, batchList,
    signed, liveCount, cull2Superseded, linkedQty, recQty, recBatches, freezeFor,
    isInterrow, qtyOpts
  };
})(window);
