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

     The Main Nursery Movement Report's Balance column, as at the work date,
     less any 2nd culling that had happened by then.

       Balance = transplanted from PN + transfer in
               - sold - 3rd culled - transfer out + stock adjustment
               - 2nd culled

     The first line is MOVE_COLS.main in operation_reports.html, column for
     column. The second is this file's own, and is the difference between
     this number and the report's: the report leaves the 2nd culling out
     because it is Tab 6's running snapshot of a batch working through the
     3rd culling, but a worker spraying the plot the morning after a 2nd
     culling is spraying what is left, not what was there before it.

     THE PHONE'S BATCH LIST DOES NOT DO THIS. shared_plot_batch_balance is
     the report exactly, so the batches offered for a plot and the figure
     beside each match the report row for row. The two are different
     questions and the answers differ by the dead count; that is deliberate.

     Worked example — U1 batch 250, 100 transplanted, 2nd culled 10 Sep with
     5 dead, 25 sold on the 18th:
         work on  1 Sep → 100   nothing has happened yet
         work on 11 Sep →  95   the 5 dead are off
         work on 18 Sep →  70   and the 25 sold, the same day counting
         work on 28 Sep →  70   nothing since

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

  /* What one plot and batch is worth, up to a date. Every event already
     carries its own sign and the ones that take no part never became
     events, so this is a plain sum. */
  function liveCount(evs) {
    return evs.reduce((sum, e) => sum + signed(e.type, e.qty), 0);
  }

  /* The linked quantity for one work record.
     Returns null when it cannot be resolved (data not loaded, no plot, or the
     plot/batch has no movement at all) so the caller can fall back gracefully. */
  function linkedQty(plot, batchStr, tarikh) {
    if (!_ready || !_events || !plot) return null;
    const pk = plotKey(plot);
    if (!pk) return null;
    const wanted = batchList(batchStr);
    // No date keyed yet ("-") → stand at today, the plot's current standing count.
    const asOf = parseDate(tarikh);
    const cutoff = asOf == null ? Infinity : asOf;

    const per = {};
    for (const ev of _events) {
      if (ev.plotKey !== pk) continue;
      if (wanted.length && !wanted.includes(ev.batchKey)) continue;
      // Only movement up to the work date counts — anything dated later had
      // not happened yet, so those seedlings were still standing.
      if (ev.ms > cutoff) continue;
      (per[ev.batchKey] ||= { evs: [], label: ev.batch }).evs.push(ev);
    }
    Object.values(per).forEach(b => { b.closing = liveCount(b.evs); });

    const keys = Object.keys(per);
    if (!keys.length) return null;
    let raw = 0;
    keys.forEach(k => { raw += per[k].closing; });
    return {
      // NOT floored at zero: the movement report shows a negative balance
      // because it is a figure to look into, and a work record quoting 0 for
      // the same plot and batch would be quietly disagreeing with it.
      qty: Math.round(raw),
      raw: Math.round(raw),
      batches: keys.map(k => per[k].label),
      allBatches: wanted.length === 0,
      asOf: asOf == null ? null : tarikh
    };
  }

  /* Quantity shown for a record: a keyed value always wins; otherwise the
     linked one. */
  function recQty(r) {
    if (r && (r.qty === 0 || r.qty)) return { value: Number(r.qty), linked: false };
    const link = linkedQty(r && r.plot, r && r.batch, r && r.tarikh);
    if (!link) return { value: null, linked: false };
    return { value: link.qty, linked: true, info: link };
  }

  global.PlotMovement = {
    load, fetchAll,
    ready: () => _ready,
    error: () => _err,
    events: () => _events,
    parseDate, logDate, plotKey, batchKey, batchList,
    signed, liveCount, linkedQty, recQty
  };
})(window);
