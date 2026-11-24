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

  /* ── A PLOT AND A BATCH ARE KEYED THE WAY THE SUMMARY REPORT KEYS THEM ──

     This file IS the Summary Report asked about one work record, so the two
     have to place a delivery order line on the same plot and the same batch
     or they quote different numbers for the same plot. The `real` set in
     _load says in its own words that it exists to stop exactly that, and it
     did not: the keys underneath it were blunter than the report's.

     THE OFFICE FOUND IT ON B14-R. The batch report showed 35 of batch 232
     sold on two notes — 30 on DO 03357 and 5 on DO 03364 — and the link
     counted 5, so a plot the lorry had emptied went on reading 30 standing
     and 30 of capacity was being paid on ground with nothing in it. DO
     03357 had "232 (B13)" typed into its batch field, the origin plot in
     brackets, and the old rule only dropped punctuation: it read that as
     batch "232B13", which matches nothing. operation_reports.html met this
     on this very plot and fixed it — _mvBatchKey there carries the same
     case in its own comment — and this file never got the fix.

     So: a note is split off FIRST (or "232 (B13)" reads as batch 13, which
     is the trap that comment names), then the trailing digits are the
     batch, exactly as the Batch Record identifies one.

     IT IS STRICTLY MORE FORGIVING, NEVER LESS, and that is what the
     fallback is for. A name with no trailing digits at all — "24D" — is no
     batch to the report and matches nothing there; here it would take a
     batch that matched itself perfectly well yesterday off every plot, so
     it keeps the old key. Nothing that matched before stops matching.

     The plot is read the report way too, in the same ORDER: a leading
     "Plot:" comes off BEFORE the note is split, or "PLOT: U15" reads as
     plot "PLOT". A line reading "U15 (UPB PREMIER HYBRID)" is plot U15 on
     the report and was "U15UPBPREMIERHYBRID" here. The dash is still
     dropped, so B14-R and B14 stay two different plots. */
  const noNote   = v => String(v == null ? '' : v).trim().split(/[\s(,\[]/)[0];
  const rawBatch = v => String(v == null ? '' : v).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  const plotKey  = v => noNote(String(v == null ? '' : v).trim().toUpperCase()
                                .replace(/^PLOT\s*:?\s*/, '')).replace(/[^0-9A-Z]/g, '');
  const batchKey = v => {
    const m = /(\d+)$/.exec(noNote(v).replace(/[^0-9A-Za-z]+$/, ''));
    return m ? String(parseInt(m[1], 10)) : rawBatch(v);
  };
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

  /* AN EVIDENCED 3RD CULLING ON THIS PLOT AND BATCH. One fact, and TWO
     different questions turn on it, which is why it is written once here
     and asked under two names below. An unevidenced 3rd culling never
     became an event at all (see _load), so neither question can be
     satisfied by a claim nobody has flown — the same condition the
     report's own cull3 column carries.

     AND AN UNFLOWN CULLING WAS TRIED AS AN ANSWER TO THE GROUND, ON THE
     OFFICE OWN 统统, AND THE CHECK REVERSED IT. The reasoning looked
     sound: the drone map gates the FIGURE, so the row itself could answer
     whether the plot had been culled, and until then the batch was named
     AND its whole pre-culling balance counted. Built, tested, and then
     `shared/CHECK_why_a_finished_batch_is_still_linked.sql` was run on the
     real ledger: **85 work records, about 72,900 seedlings of capacity,
     and 44 of them to NOUGHT** — N2 4,962 to 0, N17 1,896 to 0, U9 916 to
     0 — and B5 off its own reconciled 6,515. Those are workers who walked
     a plot being paid for nothing.

     THE CAUSE IS THE ORDER OF THE WORK, which the same run showed: 74
     plot-and-batch pairs carry a 3rd culling row with NO map and NO
     figure, so Tab 6 rows are routinely opened and keyed WELL BEFORE the
     plot is flown. In that world an unflown culling is not an answer about
     the ground, it is a row halfway through being filled in — and the rule
     would have zeroed capacity for the weeks in between.

     AND IT ANSWERED NOTHING: the row the office was asking about, B4 on 4
     Nov, has FOUR batches with no 3rd culling in the ledger at all. So the
     rule moved 72,900 seedlings elsewhere and left their own screen as it
     was. Do not re-add it without running that check first. */
  function hasCull3(evs) {
    return (evs || []).some(e => e.type === '3rd_Culling'
                              && Math.abs(Number(e.qty || 0)) > 0);
  }

  /* A 3RD CULLING SUPERSEDES THE 2ND, and this is the one place that says
     so. It is netOfRow()'s `superseded` in operation_reports.html, asked of
     one plot-and-batch bucket's events instead of one row's columns: a 3rd
     culling already includes the seedlings 2nd culled on the way to it, so
     taking the 2nd off as well takes one loss off twice. */
  function cull2Superseded(evs) { return hasCull3(evs); }

  /* ── A BATCH WHOSE 3RD CULLING IS DONE IS GONE FROM THE PLOT ───────────

     The office, over an Interrow Spraying row on B14 still linking batches
     234 and 262: *"已经结束了3rd culling了的batch就不要再link了 除了plot-R
     3rd culling后 main plot不会有那个batch了 最多只会去p-R"*.

     That is a fact about the GROUND and not about the arithmetic. A 3rd
     culling is the batch leaving the main plot: the good seedlings go to
     the -R plot and the rest are culled, so once it has happened there is
     nothing of that batch standing there to spray, manure or weed. Whatever
     balance the ledger still shows for it is a figure, not seedlings — and
     the link was quoting it as CAPACITY, which is the piece-rate money.

     So a bucket this answers yes to contributes NOTHING: not to the
     quantity, and not to the batch names beside it. It is dropped rather
     than counted at nought, so the names stop being offered too, which is
     the half the office asked for by name — *就不要再link了*.

     "FINISHED", NEVER "NEAR". The office drew that line themselves, and it
     is the whole of why this is a rule where the Include / Exclude balance
     choice beside it is not:

       a transfer out and NO 3rd culling keyed — the batch is on its way out
         and what is left on the plot is about to be culled. Only the office
         knows whether a round was walked before the culling or after, so
         that stays a CHOICE on the row (`exclBal`, and the section above).

       an evidenced 3rd culling — it has happened. There is nothing left to
         decide, and no round walked after it treated that batch.

     THE -R EXCEPTION FALLS OUT rather than being a second condition, which
     is why there is no -R test anywhere in this file. The question is asked
     of one PLOT AND BATCH: on a -R plot that batch arrived by
     Cull3_Transfer_In and carries no 3rd culling of its own, so it is not
     gone and reads exactly as it always did. The day the -R plot is itself
     3rd culled the batch really has gone from it too, and a written-out
     exemption would have gone on counting seedlings nobody kept.

     IT IS CUT AT THE WORK DATE like everything else here, so a round dated
     BEFORE the culling still counts the batch in full — the seedlings were
     standing when somebody sprayed them.

     WHAT IT COSTS, and it is named rather than buried: a figure moves on
     every unchecked row of a plot whose batch has been 3rd culled, in any
     month. Nothing settled moves — a Checked row froze its figure the day
     it was agreed (`qtyFrozen`) and a verified claim holds its own snapshot
     — which is why this carries no month gate of its own.
     `shared/CHECK_what_the_3rd_culling_rule_moves.sql` names every row that
     does move, before anybody reloads the page. */
  function cull3Done(evs) { return hasCull3(evs); }

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

    /* Every batch whose 3rd culling is keyed and flown by the work date is
       off this plot — see cull3Done. Taken out FIRST, so what is left is
       what is standing, and the Include / Exclude balance choice below is
       only ever asked about a batch that really is still there. */
    const gone = new Set(allKeys.filter(k => cull3Done(per[k].evs)));
    const here = allKeys.filter(k => !gone.has(k));
    let goneQty = 0;
    gone.forEach(k => { goneQty += per[k].closing; });

    /* AND A BATCH WITH NOTHING STANDING IS NOT ON THE PLOT EITHER.

       The office put the two screens side by side: B6-R on 6 Nov linked
       *"225, 227, 228, 233, 234, 238, 240, 242, 244, 247"* and the Summary
       Report for the same plot and the same day lists **228, 234, 242, 244,
       247** — *"B6-R 在6/11并没有225"*. The five extra all had movement on
       that plot at some point and NOTHING LEFT by the work date.

       A bucket was named for having an EVENT, not for having seedlings. So
       a batch that arrived and then went — sold, transplanted on, culled —
       was offered for ever afterwards, and on a -R plot, which is populated
       entirely by transfers in and emptied again, that is most of them.

       NOUGHT OR BELOW, and the office said so in one line when the first
       version kept the negatives and named them: *"小过负数也不要出现 只要
       过了3rd cull统统不要出现"*. The argument for keeping one was that the
       Summary Report draws a negative because it is a figure to look into,
       so a work record that stopped naming the batch would be disagreeing
       with the report about the very row somebody has to go and fix. The
       office overruled it with the consequence in front of them: this is
       the CAPACITY column, which is what somebody is paid off, and a plot
       that owes nothing has nothing to spray whatever the ledger says.

       NOUGHT COSTS THE FIGURE NOTHING AND A NEGATIVE DOES NOT. A bucket
       closing at nought adds nought, so `qty` is the same number before and
       after and only the names move. A bucket closing BELOW nought is
       adding a negative to `raw`, which is deliberately not floored (see
       `qty` below) — so dropping it RAISES the figure by exactly that much.
       `shared/CHECK_which_batches_leave_the_link.sql` names every record it
       moves and by how much, which is the only honest way to ship this.

       AND INTERROW ANSWERS DIFFERENTLY, which falls out rather than being a
       second rule: `closing` is `liveCount` with this row's own options, so
       a batch whose 2nd culling takes it to nought is EMPTY for the other
       three jobs and still STANDING for interrow — which is the whole of
       what keepCull2 says, the polybags being where they were. */
    const empty = new Set(here.filter(k => per[k].closing <= 0));
    const standing = here.filter(k => !empty.has(k));

    let culledBal = 0;
    standing.forEach(k => { if (leftBy.has(k)) culledBal += Math.max(0, per[k].closing); });
    const excl = !!(opts && opts.exclBal) && culledBal > 0;
    const keys = excl ? standing.filter(k => !leftBy.has(k)) : standing;
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
      culledBatches: standing.filter(k => leftBy.has(k)).map(k => per[k].label),
      exclBal: excl,
      /* The batches this plot no longer holds, and what the ledger still
         showed for them — COUNTED AND NAMED rather than dropped in silence,
         because a figure that has had a batch taken out of it and a figure
         that never had one are the same number on screen. The cell says it;
         nothing prices it. */
      goneBatches: gone.size
        ? allKeys.filter(k => gone.has(k)).map(k => per[k].label)
            .sort((a, b) => String(a).localeCompare(String(b), 'en', { numeric: true }))
        : [],
      goneQty: Math.round(goneQty),
      /* The batches that had movement on this plot and nothing left standing
         by the work date — see the empty rule above. They are NOT a figure:
         each one adds nought, so there is nothing for a screen to price or
         to explain away. The names are here so the one case that needs a
         sentence can have one. */
      emptyBatches: empty.size
        ? here.filter(k => empty.has(k)).map(k => per[k].label)
            .sort((a, b) => String(a).localeCompare(String(b), 'en', { numeric: true }))
        : [],
      /* Nothing of this plot is standing any more: every batch it had has
         been 3rd culled. The quantity really is nought, which is a different
         statement from "could not be worked out" and has to read as one. */
      allGone: gone.size > 0 && !standing.length,
      /* The same sentence for the other way a plot empties — everything that
         was here has gone without a 3rd culling of its own. Asked only where
         NO batch was culled, so the harder fact above keeps the cell when
         both are true. */
      allEmpty: !gone.size && empty.size > 0 && !standing.length
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
    /* THE BATCH NAMES, and they are written for a KEYED batch too. The
       office: *"人为打的=link的batch的话,checked了也要长这样"* — a batch
       somebody typed that IS the report's own answer is the report's own
       answer, and once the row is settled it has to read like one, or they
       are back to checking a cell that has already been agreed.

       THE ONLY WAY TO SAY THAT WITHOUT RE-READING THE LEDGER UNDER A
       SETTLED ROW is to write down what the report said at the moment it
       was checked, which is what this field has always been for. A keyed
       batch that did NOT agree writes nothing and stays the row left to
       check, which is the whole of what that column is read down for.

       ASKED OFF THE LINK AND NOT THROUGH recBatches, because that one
       short-circuits on a checked row by design — and freezeCheckedRows
       calls this over rows that are ALREADY checked, so a reader that
       returns early there could never repair one. */
    const keyedB = String(r.batch || '').trim();
    const lk = linkedQty(r.plot, '', r.tarikh, qtyOpts(r));
    const shown = lk ? (lk.batches || []).filter(b => b && b !== '—').join(', ') : '';
    if (shown && (!keyedB || batchesAgree(keyedB, shown))) out.batchFrozen = shown;
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
  /* ── A KEYED BATCH THAT AGREES WITH THE LEDGER SAYS SO ─────────────────

     The office asked for the mark to mean one more thing — *"如果FC填的
     batch/人为填的batch=本来用link的话的batch 那就show link的icon 这样的话
     我就只需要查没有link的icon的部分"* — and the reason is the sentence
     after it: they go down that column looking for what to check, and a
     keyed batch that matches the batch report is not a row anybody needs to
     open. Unmarked used to mean "somebody typed this"; it now means
     "somebody typed this AND it is not what the report says", which is the
     only version of the column worth reading down.

     THE KEYED VALUE IS STILL WHAT IS SHOWN AND WHAT DECIDES. Nothing is
     rewritten: a batch somebody typed is their answer, it is what the
     quantity beside it is counted over, and `agrees` only ever changes the
     mark on it. The comparison is on the batch KEYS as a SET — letters and
     digits, like every other key here — so "234, 262", "262,234" and
     "262 / 234" are one answer and a stray space cannot send the office to
     a row that is perfectly correct. */
  function batchesAgree(a, b) {
    const ka = [...new Set(batchList(a))].sort();
    const kb = [...new Set(batchList(b))].sort();
    return ka.length > 0 && ka.length === kb.length && ka.every((v, i) => v === kb[i]);
  }

  function recBatches(r) {
    const keyed = String((r && r.batch) || '').trim();
    const frozen = String((r && r.batchFrozen) || '').trim();
    /* HELD AT THE CHECK — and a batch somebody TYPED is held too, where
       what they typed is what the report said on the day the row was
       checked. It reads exactly like one the link filled in, because that
       is what it is; only the hover says a person keyed it. The KEYED
       spelling is what is shown, because that is what somebody wrote. */
    if (frozen && (!keyed || batchesAgree(keyed, frozen)))
      return { value: keyed || frozen, linked: false, frozen: true, agrees: !!keyed };
    /* A CHECKED ROW IS SETTLED AND DOES NOT ASK THE LEDGER AGAIN, not even
       for a mark. Checked is what stops a figure being a formula, and a row
       that went green today and grew a 🔗 next week because a batch moved
       would be exactly the thing that rule exists to stop. */
    if (keyed && r && r.checked) return { value: keyed, linked: false };
    /* Asked with NO batch, so the answer is every batch the ledger has
       standing on that plot — which is the list a keyed one is compared
       against. Passing the keyed value in would only ever hand it back. */
    const link = linkedQty(r && r.plot, '', r && r.tarikh, qtyOpts(r));
    const shown = link ? link.batches.filter(b => b && b !== '—').join(', ') : '';
    if (keyed) {
      /* A KEYED ANSWER THAT DISAGREES CARRIES NOTHING — no mark and no link
         to describe it with. The cell wears nothing either, because on this
         screen the ABSENCE is what the office reads down the column for, so
         a field here would only ever feed a sentence that must not be on
         the screen. */
      return shown && batchesAgree(keyed, shown)
        ? { value: keyed, linked: true, agrees: true, info: link }
        : { value: keyed, linked: false };
    }
    /* No batch keyed and none to name. `info` rides along all the same, so
       a cell can tell "this plot has been 3rd culled" from "the ledger has
       nothing here", which are the same dash otherwise. */
    if (!shown) return { value: keyed, linked: false, info: link || null };
    return { value: shown, linked: true, info: link };
  }

  global.PlotMovement = {
    load, fetchAll,
    ready: () => _ready,
    error: () => _err,
    events: () => _events,
    parseDate, logDate, plotKey, batchKey, batchList,
    signed, liveCount, cull2Superseded, cull3Done, linkedQty, recQty, recBatches, freezeFor,
    isInterrow, qtyOpts
  };
})(window);
