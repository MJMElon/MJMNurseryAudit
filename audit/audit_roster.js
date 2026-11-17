/* ══════════════════════════════════════════════════════════════════════════
   WHICH BATCHES STAND ON A PLOT — AND IT IS THE MOVEMENT REPORT THAT SAYS

   The office, over the two audit module cards: *"for the nursery audit's
   plot condition audit and seedling height audit's plot and batch link to
   the summary report (main nursery movement report). So if the plot shown
   in the report, it will shown for audit too."*

   ── WHAT WAS WRONG ────────────────────────────────────────────────────────

   Both modules built their roster from the LIFE-STAGE LOGS and nothing
   else — `Planted` for a pre-nursery tray, `Transplanted*` for a main plot —
   and then used `shared_plot_batch_balance` only as a GATE, to grey out a
   batch that had since gone.

   `shared_plot_batch_balance` IS the Main Nursery Movement Report. Its own
   file says so in its first line, and it is MOVE_COLS.main column for
   column:

       Balance = transplanted from PN + transfer in
               - sold - 3rd culled - transfer out + stock adjustment

   So the GATE was already the report and the ROSTER was not, and the two do
   not cover the same ground. **A batch that arrived on a plot by TRANSFER
   has no `Transplanted` log at all** — it arrives as a `Cull3_Transfer`,
   which is the report's *Transfer In* column — so it was in the report, had
   a perfectly good balance row sitting in `balanceByPB`, and was on NO
   audit grid, because nothing had ever put it in `plotBatches` for the gate
   to be asked about.

   **THAT IS EVERY "-R" PLOT IN THE COMPANY.** A replant plot is made by a
   3rd-culling transfer and is populated by nothing else, so the seedlings
   standing in it could be read off the Summary Report and could not be
   audited. The office could see the plot on the grid — `audit_plots.js`
   offers it — with no batch under it and nothing saying why.

   ── WHAT IT IS NOW ────────────────────────────────────────────────────────

   The view is a ROSTER SOURCE as well as the gate. Anything the report
   shows as standing is on the grid, by construction rather than by a second
   rule that has to be kept in step with it — which is the whole of what the
   office asked for.

   Four things in it:

   - **IT IS PURELY ADDITIVE.** The two log sources and `audit_batches` are
     read exactly as before and merged FIRST, so every batch on a grid today
     is on it tomorrow, keeping its breed and its planted date — the view
     carries neither. The report only ever ADDS what the logs could not see.
   - **qty > 0, never `closing !== 0`.** The report draws a row that closed
     at nought if it moved during the period — it is a movement report, and
     that row is the month's history. The audit asks a different question:
     is there something standing in this plot to look at. Nothing standing
     is nothing to audit, which is the judgement `isBatchNotRequired` has
     always made, so a row the report keeps for its history does not become
     a task.
   - **THE PRE NURSERY IS UNTOUCHED.** The view is the MAIN nursery movement
     and holds no PN row — `RUN_ME_plot_batch_balance_fix.sql` says so in
     its own words. PN keeps its `Planted` logs, which are the only thing
     that has ever placed a tray.
   - **A PLOT THAT PLACES NOWHERE IS LEFT OUT**, the same as every other
     source here: `nurseryOf` is asked, and a plot under no nursery cannot
     be drawn on a grid that has four tabs. It is COUNTED, so `?debug` and
     the console line can say how many rather than the roster quietly being
     short.

   ── WHY THIS FILE EXISTS AT ALL ───────────────────────────────────────────

   The roster, the log list and the not-required rule were each written out
   TWICE, once per module, and were already drifting: the two load their
   logs with slightly different column lists. A rule in two copies is the
   fault this repository has a heading about, and the fix above would have
   been the eleventh thing to write down twice. It is pure — it takes rows
   and hands back rows, reaches no database and touches no screen — so the
   test drives the REAL one rather than a restatement.

   IT IS A HARD DEPENDENCY, like `audit_plots.js` beside it: both module
   scripts read it at their TOP LEVEL, so a page that cannot fetch it does
   not half-work, it half-EVALUATES. `audit_sw.js` precaches it and both
   pages load it BEFORE the script that reads it.
   ══════════════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {

  /* THE LIFE STAGES THAT PLACE A BATCH, as one list because two lists is two
     rosters. Both modules used to spell this into their own PostgREST query.

       Planted                 seeds went into a PN tray (P01-P52)
       Transplanted            seedlings went into a main plot
       Transplanted_Premium    …into the Premium Care tray
       Transplanted_DoubleTone …into the Double Tone tray

     The last two are deliberately kept even though the Movement Report gives
     them no main-plot column: they are how a tray gets its roster, and a row
     of theirs that names a main plot is gated out by the balance exactly as
     it always was. */
  const LOG_TYPES = ['Planted', 'Transplanted',
                     'Transplanted_Premium', 'Transplanted_DoubleTone'];

  /* The PostgREST filter both modules send, so neither can quietly ask a
     different question from the other. */
  const LOG_FILTER = 'transaction_type=in.(' + LOG_TYPES.join(',') + ')';

  const txt = (v) => String(v == null ? '' : v).trim();

  /* ── THE ROSTER ───────────────────────────────────────────────────────────
     Takes the rows each module has already fetched and hands back the two
     things both of them keep: the (nursery, plot, batch) triples and the
     plot|batch balance map.

     ORDER IS THE WHOLE CONTRACT. The logs go in first because they are the
     only source carrying a breed and a planted date; `audit_batches` next;
     the report LAST, so it can only ever add a pair the first two missed and
     can never overwrite one of their rows with a blank breed. */
  function build(opts) {
    const o            = opts || {};
    const canon        = o.canon      || ((v) => txt(v).toUpperCase());
    const nurseryOf    = o.nurseryOf  || (() => null);
    const breedOf      = o.breedOf    || (() => '');
    const dateOf       = o.dateOf     || (() => '');

    const plotBatches  = [];
    const seen         = new Set();
    let   fromBalance  = 0;     // pairs ONLY the report knew about
    let   unplaced     = 0;     // report pairs whose plot is under no nursery

    const add = (plot, batch, breed, planted) => {
      const p = canon(plot);
      const b = txt(batch);
      if (!p || !b) return false;
      const nursery = nurseryOf(p);
      if (!nursery) return false;
      const key = nursery + '|' + p + '|' + b;
      if (seen.has(key)) return false;
      seen.add(key);
      plotBatches.push({ nursery, plot: p, batch: b,
                         breed: breed || breedOf(b) || '',
                         planted: planted || '' });
      return true;
    };

    (o.logs || []).forEach(l => {
      if (!l) return;
      add(l.plot_name, l.batch_name, l.breed_name, dateOf(l));
    });

    /* audit_batches carries a `nursery` of its own, and it is deliberately
       NOT read: the plot is re-placed through nurseryOf so a stale label
       cannot push a plot onto the wrong grid. */
    (o.auditBatches || []).forEach(r => {
      if (!r) return;
      add(r.plot, r.batch_no, r.breed, '');
    });

    /* THE MOVEMENT REPORT. Only what is STANDING — see the header. */
    const balanceByPB = {};
    (o.balance || []).forEach(r => {
      if (!r) return;
      const p = canon(r.plot_name);
      const b = txt(r.batch_name);
      if (!p || !b) return;
      balanceByPB[p + '|' + b] = Number(r.qty || 0);

      if (Number(r.qty || 0) <= 0) return;
      if (!nurseryOf(p)) { unplaced++; return; }
      if (add(p, b, '', '')) fromBalance++;
    });

    return { plotBatches, balanceByPB, fromBalance, unplaced };
  }

  /* ── THE GATE ─────────────────────────────────────────────────────────────
     Missing key OR nothing standing → the batch is out and the audit is Not
     Required. Written once; it was identical in both modules.

     IT FAILS OPEN on an empty map, which is the rule every gate in this
     module follows: a balance read that was refused must not take every task
     off an auditor who was working a minute ago. */
  function notRequired(balanceByPB, canon, plot, batch) {
    const map = balanceByPB || {};
    if (!Object.keys(map).length) return false;
    const key = (canon ? canon(plot) : txt(plot).toUpperCase()) + '|' + txt(batch);
    const qty = map[key];
    return qty === undefined || qty <= 0;
  }

  global.MJMAuditRoster = { LOG_TYPES, LOG_FILTER, build, notRequired };

})(typeof window !== 'undefined' ? window : globalThis);
