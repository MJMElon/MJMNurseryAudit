/* ═══ IS THIS BATCH FINISHED? ═══════════════════════════════════════════════

   ONE answer, for every list that asks.

   It used to be two. The Batch Record list asked whether every plot the
   batch reached had been 3rd culled, proofed against its drone map and
   signed off. Life of Seedlings asked whether its own arithmetic came to
   nought. Those are different questions, and they gave different answers —
   a batch could sit in Completed on one screen and Active on the other,
   which is how a batch ends up on one list and not the other and nobody
   can say which list is wrong.

   The office asked for them to agree, and the Batch Record's is the one
   that wins: it is the question the nursery actually asks ("is there
   anything left standing out there, and has somebody checked?"), it is the
   one the 3rd Culling tab's own ring is drawn from, and it does not move
   when a sale or a calibration is keyed months later.

   ── THE RULE ──────────────────────────────────────────────────────────────

   A batch is COMPLETED when every plot it used has nothing left standing in
   it, somebody has signed each of them off, and nothing is in dispute.

   WHICH PLOTS IT USED is every plot a Transplanted or Transplanted_DoubleTone
   log names, plus every plot a Cull3_Transfer landed in.

     Premium Care transplants are excluded, because premium is a holding
     tray that the 3rd Culling report does not list — a premium-ONLY plot
     could never receive a record and would block the batch for ever. A plot
     that also took a main or d-tone transplant still counts, through that
     row.

     A transfer ADDS the plot it landed in rather than vetoing the batch.
     Any Cull3_Transfer at all used to keep a batch Active for ever, which
     was true when a transferred-into plot had nowhere to record its
     culling. A "-R" plot is a row on the P-R Culling tab now, with its own
     drone-map quantity and culled date. This is why batch 225 stayed Active
     with its 3rd Culling report reading 6 of 6 done.

   NOTHING LEFT STANDING is, per plot:

         3rd culled  −  drone map qty  =  0

     One subtraction, and it covers both ways a plot gets there without
     naming them separately. N18-R had 131 to cull and the drone map counted
     131: 131 − 131 = 0, done. A plot whose seedlings were all SOLD has
     nothing to cull: 0 − 0 = 0, done, with no map to attach and no date to
     give — which is why demanding paperwork of it kept batch 225 in Active
     for a job nobody could do. A missing map counts as 0, so a plot with
     500 to cull and no map is 500 short and holds the batch.

     A NOUGHT HAS TO BE A REAL NOUGHT. "culled − map = 0" is satisfied just
     as well by a row that says nothing at all, and a plot nobody has
     touched then looks exactly like a plot all sold out — which swept
     batches into Completed that had barely started. So where the cull is
     nought the row must SAY so: a saved 3rd Culling record carries its
     arithmetic in the remark ("Remaining Balance: 0"). A cull above nought
     needs no such proof; the figure is the proof.

     This asks the FIELD question, not the keying one. The 3rd Culling tab's
     own "N/M Plots Done" counts how much typing is left and still wants a
     culled date; this asks whether the batch is finished on the ground.

   AND SIGNED OFF. A plot whose 3rd Culling is keyed is not therefore
   finished — somebody still has to check it. A sign-off comes two ways and
   either counts: one signature over the whole tab in
   operation_batch_verifications, or a Row_Verification log per row keyed
   `cull_3::<PLOT>|<dest>`. Only the PLOT is matched: which dest type the tab
   merged the row under has nothing to do with whether the plot was looked
   at. Without this, unverifying a plot took the tab off 100% and left the
   batch sitting in Completed, saying the opposite.

   AND NOTHING IN DISPUTE. An open Review_Rejection means HQ sent a report
   tab back for amendment; the row is deleted when the rejection is cleared
   or the tab re-verified, so a row still there is still open. Such a batch
   is reported held rather than completed, so the row can say WHICH question
   is open instead of reading as one that still has counting to do.

   A PENDING ADJUSTMENT does NOT hold a batch, and held every finished one
   for a while. An adjustment nobody has approved moves no figure — the rule
   everywhere else — so a batch whose plots all reconcile reconciles with or
   without it. A real VARIANCE still holds the batch and is caught where it
   shows: the coverage test needs every plot's 3rd culled to equal its
   drone-map count, so a plot that does not tally is not covered.

   …EXCEPT A STALE DRONE-MAP FLAG. A gap between the cull and the map is
   settled by an ADJUSTMENT, not by re-keying the cull: the office accepts
   the explanation, raises a calibration for the difference and approves it,
   and the two sides tally. The 3rd Culling row does not move when that
   happens — it still reads 500 against a MapQty of 540 — so the AUTOMATIC
   rejection saveTab6 raised over the gap sits there until somebody happens
   to open Tab 6 and press Save, over a question answered days ago.

   So a rejection that saveTab6 wrote itself (plot_name 'cull_3', remark
   beginning "3rd Culling map qty") is ignored once the batch's plots tally
   WITH the approved adjustments counted. Which adjustments reach the 3rd
   Culling is ADJUST_APPLIES_TO's rule in operation_batch_detail.html: one
   filed on the 3rd Culling and one filed on Transplanting, because both are
   measuring what is standing in the plot. Change one, change the other.

   A rejection a PERSON sent back stands until a person clears it, whatever
   the figures say — only the automatic one is ignored. And the coverage
   test itself is untouched: it still wants the cull and the map to agree on
   their own, so an adjustment settles the FLAG and never the count.

   ── CALLING IT ────────────────────────────────────────────────────────────

   Pure: rows in, answer out, no database and no DOM. Pass the ledger rows
   each list already has.

   Life of Seedlings passes rows CUT AT ITS "AS AT" DATE, and passes the
   signatures UNCUT — a line dated after the As At has not happened yet,
   while "has anybody checked this" is a question about now. That is the
   same split every other As At rule on that report follows.

   The file is loaded by operation_batch_record.html and
   operation_reports.html. Change the rule here and both move together;
   there is deliberately nowhere else to change it. */
(function (root) {
  'use strict';

  var PLOT = function (p) { return String(p == null ? '' : p).trim().toUpperCase(); };
  var RE_MAP_QTY   = /MapQty:\s*(\d+)/;
  var RE_NIL       = /Remaining Balance:\s*0\b/;
  var RE_DEST_TYPE = /DestType:\s*(main|premium|doubletone)/;
  var RE_CULL3_KEY = /^cull_3::(.+)$/;
  var RE_REPORT     = /Report:\s*([^.]+?)\s*\./i;
  var RE_PLOT_NAMED = /Plot:\s*([^.]+?)\s*\./i;

  /* input = {
       transplants:        [{ batch_name, plot_name, transaction_type }]
       transfers:          [{ batch_name, plot_name }]
       cull3:              [{ batch_name, plot_name, quantity_change, remark }]
       rowVerifications:   [{ batch_name, plot_name }]   plot_name = '<stage>::<key>'
       stageVerifications: [{ batch_name, stage }]
       rejections:         [{ batch_name, plot_name, remark }]
       calibrations:       [{ batch_name, plot_name, quantity_change, remark }]
     }
     → { completed: Set(batch), heldByIssue: { batch: reason },
         expected: { batch: Set(PLOT) },
         openRejections: [ the rejection rows that are still open ] } */
  function compute(input) {
    var inp = input || {};
    var expected = {};

    (inp.transplants || []).forEach(function (r) {
      if (!r || !r.batch_name) return;
      if (r.transaction_type === 'Transplanted_Premium') return;
      var p = PLOT(r.plot_name);
      if (!p) return;
      (expected[r.batch_name] = expected[r.batch_name] || new Set()).add(p);
    });
    (inp.transfers || []).forEach(function (r) {
      if (!r || !r.batch_name) return;
      var p = PLOT(r.plot_name);
      if (!p) return;
      (expected[r.batch_name] = expected[r.batch_name] || new Set()).add(p);
    });

    /* Which plots have a record that PROVES nothing is left standing.
       A row written before DestType was stamped covers one slot for its
       plot rather than naming which, so those are counted instead. */
    var keyed = {}, legacy = {};
    (inp.cull3 || []).forEach(function (r) {
      if (!r || !r.batch_name) return;
      var culled = Number(r.quantity_change) || 0;
      var m = r.remark ? String(r.remark).match(RE_MAP_QTY) : null;
      var mapQty = m ? parseInt(m[1], 10) : 0;
      if (culled - mapQty !== 0) return;
      if (culled === 0 && !(r.remark && RE_NIL.test(String(r.remark)))) return;
      var p = PLOT(r.plot_name);
      if (!p) return;
      if (r.remark && RE_DEST_TYPE.test(String(r.remark))) {
        (keyed[r.batch_name] = keyed[r.batch_name] || new Set()).add(p);
      } else {
        var map = (legacy[r.batch_name] = legacy[r.batch_name] || new Map());
        map.set(p, (map.get(p) || 0) + 1);
      }
    });

    var rowSigned = {};
    (inp.rowVerifications || []).forEach(function (r) {
      if (!r || !r.batch_name || !r.plot_name) return;
      var m = RE_CULL3_KEY.exec(String(r.plot_name));
      if (!m) return;
      var p = PLOT(String(m[1]).split('|')[0]);
      if (!p) return;
      (rowSigned[r.batch_name] = rowSigned[r.batch_name] || new Set()).add(p);
    });
    var stageSigned = new Set();
    (inp.stageVerifications || []).forEach(function (r) {
      if (r && r.stage === 'cull_3' && r.batch_name) stageSigned.add(r.batch_name);
    });

    /* Approved adjustments that reach the 3rd Culling, per batch and plot.
       The plot an adjustment names in its remark wins over the row's own. */
    var adjKey = function (b, p) { return String(b || '') + '\u0001' + PLOT(p); };
    var cull3Adj = {};
    (inp.calibrations || []).forEach(function (r) {
      var remark = (r && r.remark) || '';
      if (remark.indexOf('[APPROVED by') < 0) return;
      var rep = String((remark.match(RE_REPORT) || [])[1] || '').trim().toLowerCase();
      if (rep !== '3rd culling' && rep !== 'transplanting') return;
      var named = String((remark.match(RE_PLOT_NAMED) || [])[1] || '').trim();
      var plot = named || r.plot_name || '';
      if (!plot) return;
      var k = adjKey(r.batch_name, plot);
      cull3Adj[k] = (cull3Adj[k] || 0) + (Number(r.quantity_change) || 0);
    });
    /* Nothing left to answer on a row: no map keyed at all, or the figures
       agree once the approved adjustments are counted. */
    var tallies = function (r) {
      var m = (r.remark || '').match(RE_MAP_QTY);
      if (!m) return true;
      var adj = cull3Adj[adjKey(r.batch_name, r.plot_name)] || 0;
      return (Number(r.quantity_change) || 0) + adj === parseInt(m[1], 10);
    };
    var stillMismatched = new Set();
    (inp.cull3 || []).forEach(function (r) {
      if (r && r.batch_name && !tallies(r)) stillMismatched.add(r.batch_name);
    });
    var staleMapFlag = function (r) {
      return String(r.plot_name || '') === 'cull_3'
        && String(r.remark || '').indexOf('3rd Culling map qty') === 0
        && !stillMismatched.has(r.batch_name);
    };
    var openRejections = (inp.rejections || []).filter(function (r) {
      return r && !staleMapFlag(r);
    });
    var openRejection = new Set();
    openRejections.forEach(function (r) {
      if (r.batch_name) openRejection.add(r.batch_name);
    });

    var completed = new Set();
    var heldByIssue = {};
    Object.keys(expected).forEach(function (batch) {
      var need = expected[batch];
      if (!need || !need.size) return;
      var k = keyed[batch] || new Set();
      var leg = new Map(legacy[batch] || []);
      var signed = rowSigned[batch] || new Set();
      var whole = stageSigned.has(batch);
      var allCovered = true;
      need.forEach(function (key) {
        if (!allCovered) return;
        var plot = key.split('|')[0];
        if (!whole && !signed.has(plot)) { allCovered = false; return; }
        if (k.has(key)) return;
        var n = leg.get(plot) || 0;
        if (n > 0) { leg.set(plot, n - 1); return; }
        allCovered = false;
      });
      if (!allCovered) return;
      if (openRejection.has(batch)) {
        heldByIssue[batch] = 'To do — a report is waiting on somebody';
        return;
      }
      completed.add(batch);
    });

    /* Handed back because the To Check list asks the same question of one
       row: a gap somebody has ANSWERED and nobody has checked leaves that
       list the same way it leaves the To Do List, once the adjustment that
       settles it is approved. One test, both lists. */
    return { completed: completed, heldByIssue: heldByIssue, expected: expected,
             openRejections: openRejections, cull3Tallies: tallies };
  }

  var api = { compute: compute, plotKey: PLOT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MJMBatchCompleted = api;
})(typeof window !== 'undefined' ? window : globalThis);
