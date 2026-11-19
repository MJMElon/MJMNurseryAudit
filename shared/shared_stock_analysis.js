/* ════════════════════════════════════════════════════════════════════════
   DO WE HAVE STOCK? — the Stock Analysis Dashboard's rule, written down

   Seedling Sales Control → Inventory Map → Stock Analysis Dashboard
   answers it on screen, and the MJM AI System MCP (the boss's AI agent,
   supabase/functions/mjm-mcp) answers it over the wire. Two answers to
   one question is how a screen and an agent come to disagree, so both
   read THIS file:

   - classify()      the page hands it the Monthly Maturity rows it has
                     already built; the agent hands it buildStockRows().
                     Available stock = the Plot Balance of every row
                     matured by the end of this month, or whose latest
                     height audit is 1.5 m or more. Culled, Sold Out and
                     Closed rows hold nothing to sell. A row counts once.
   - buildStockRows() the Monthly Maturity Allocation built from the raw
                     ledger, month rows AND Plot-R rows, the way
                     loadMaturity() in operation/operation_stock_sales.js
                     builds them. Change one, change the other —
                     tests/the_mcp_reads_the_dashboard.cjs drives this file
                     and the REAL page over one ledger and compares.
   - orderBalances() what every customer order still owes, the way
                     loadCustomerOrders() works it out (AL qty less DOs,
                     cancelled or closed AL nought, one row per order).
   - openOrders()    the Pending Collection card's rule: cash orders not
                     yet paid and cancelled orders are not owed.

   SHARED RULE, TWO COPIES: this file and
   supabase/functions/_shared/stock_analysis.js, byte for byte, because an
   Edge Function bundles only what is under supabase/functions. The test
   compares the two.

   PURE: rows in, figures out. No database, no screen.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var CULL = 0.9;
  var HEIGHT_CM = 150;              // 1.5 m
  var RE_LOG_DATE = /(?:Cull)?Date:\s*(\d{4}-\d{2}-\d{2})/i;

  function logDate(l) {
    if (l.transaction_date) return String(l.transaction_date).slice(0, 10);
    var m = l.remark ? String(l.remark).match(RE_LOG_DATE) : null;
    if (m) return m[1];
    return l.created_at ? String(l.created_at).slice(0, 10) : null;
  }
  function monthKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function normBatch(v) {
    return String(v == null ? '' : v).trim().toUpperCase()
      .replace(/^BATCH\s*:?\s*/, '').split(/[\s(,\[]/)[0].replace(/[^0-9A-Z]/g, '');
  }
  function normPlot(v) {
    return String(v == null ? '' : v).trim().toUpperCase()
      .replace(/^PLOT\s*:?\s*/, '').split(/[\s(,\[]/)[0].replace(/[^0-9A-Z]/g, '');
  }
  function normOrder(v) { return String(v || '').trim().toUpperCase().replace(/[^0-9A-Z]/g, ''); }

  /* The height audit spells a plot B01 and the ledger B1 — one plot. */
  function heightPlotKey(raw) {
    var s = String(raw == null ? '' : raw).trim().toUpperCase();
    var m = s.match(/^([A-Z]+)(\d+)(-R)?$/);
    if (!m) return s;
    return m[1] + m[2].padStart(2, '0') + (m[3] || '');
  }
  function heightKey(plot, batch) {
    return heightPlotKey(plot) + '|' + String(batch == null ? '' : batch).trim().toUpperCase();
  }
  /* Every seedling measured on a batch's LATEST audit day, averaged. */
  function latestHeights(rows) {
    var latest = {}, out = {};
    (rows || []).forEach(function (r) {
      if (!r.plot || !r.batch || !r.date) return;
      var k = heightKey(r.plot, r.batch), d = String(r.date);
      if (!latest[k] || d > latest[k]) latest[k] = d;
    });
    (rows || []).forEach(function (r) {
      if (!r.plot || !r.batch) return;
      var k = heightKey(r.plot, r.batch);
      if (!latest[k] || String(r.date || '') !== latest[k]) return;
      var cur = out[k] || (out[k] = { date: latest[k], samples: [], avg: null, n: 0 });
      [r.sample_1, r.sample_2, r.sample_3].forEach(function (v) {
        var n = Number(v);
        if (isFinite(n) && n > 0) cur.samples.push(n);
      });
    });
    Object.keys(out).forEach(function (k) {
      var h = out[k];
      h.n = h.samples.length;
      h.avg = h.n ? h.samples.reduce(function (s, v) { return s + v; }, 0) / h.n : null;
    });
    return out;
  }

  /* One row's balance — matRowFigures in the page. */
  function figures(r) {
    var collected = r.doDeducted || 0;
    var culledQty = r.culledQty || 0;
    var otherDed = culledQty + (r.transferredOut || 0);
    var fullBalance = r.afterCulling + (r.transferredIn || 0) - collected - otherDed;
    var culled = culledQty > 0 && fullBalance <= 0;
    var rawBalance = r.isPR ? fullBalance : r.afterCulling - collected;
    var plotBalance = culled ? 0 : rawBalance;
    var soldOut = !culled && plotBalance <= 0;
    return { collected: collected, culled: culled, plotBalance: plotBalance, soldOut: soldOut };
  }

  /* The Monthly Maturity Allocation off the raw ledger, month rows and
     Plot-R rows — loadMaturity() in the page. */
  function buildStockRows(src) {
    var batchBreed = {};
    (src.seeds || []).forEach(function (b) { if (b.batch_name && b.breed_name) batchBreed[b.batch_name] = b.breed_name; });
    var plotNursery = {}, prefixNursery = {};
    (src.plots || []).forEach(function (p) {
      if (!p.plot_name || !p.nursery_name) return;
      if (/^[A-Za-z]+\d+$/.test(String(p.nursery_name).trim())) return;
      plotNursery[p.plot_name] = p.nursery_name;
      var pre = (p.plot_name.match(/^[A-Za-z]+/) || [])[0];
      if (pre) prefixNursery[pre] = p.nursery_name;
    });
    function location(plot) {
      if (!plot) return '—';
      if (plotNursery[plot]) return plotNursery[plot];
      var pre = (plot.match(/^[A-Za-z]+/) || [])[0];
      return pre && prefixNursery[pre] ? prefixNursery[pre] : '—';
    }
    function group(list, isPR) {
      var g = {}, order = [];
      list.forEach(function (l) {
        var eff = logDate(l);
        var k = (l.batch_name || '') + '||' + (l.plot_name || '');
        if (!g[k]) { g[k] = { batch: l.batch_name, plot: l.plot_name, breed: l.breed_name, qty: 0, firstDate: eff }; order.push(k); }
        g[k].qty += (l.quantity_change || 0);
        if (eff < g[k].firstDate) g[k].firstDate = eff;
        if (!g[k].breed && l.breed_name) g[k].breed = l.breed_name;
      });
      return order.map(function (k) {
        var x = g[k], t = new Date(x.firstDate);
        var m = isPR ? t : (function () { var d = new Date(t); d.setMonth(d.getMonth() + 9); return d; })();
        return { key: k, batch: x.batch, plot: x.plot, breed: x.breed || batchBreed[x.batch] || '—',
          location: location(x.plot), qty: x.qty, afterCulling: isPR ? x.qty : Math.round(x.qty * CULL),
          doDeducted: 0, transplantDate: t, matureDate: m, isPR: !!isPR };
      });
    }
    var mat = group(src.transplants || [], false);
    var matKeys = {};
    mat.forEach(function (g) { matKeys[g.key] = 1; });
    var xferIn = {}, prList = [];
    (src.transfers || []).forEach(function (l) {
      var k = (l.batch_name || '') + '||' + (l.plot_name || '');
      if (matKeys[k]) xferIn[k] = (xferIn[k] || 0) + (l.quantity_change || 0);
      else prList.push(l);
    });
    var pr = group(prList, true);
    var batchMature = {};
    mat.forEach(function (g) { if (!batchMature[g.batch] || g.matureDate < batchMature[g.batch]) batchMature[g.batch] = g.matureDate; });
    pr.forEach(function (g) { if (batchMature[g.batch]) g.matureDate = batchMature[g.batch]; });
    var rows = mat.concat(pr);

    // DOs: each line comes off its own batch and plot, earliest row wins.
    var byNorm = {};
    rows.forEach(function (g) {
      var nk = normBatch(g.batch) + '||' + normPlot(g.plot);
      if (!byNorm[nk] || g.transplantDate < byNorm[nk].transplantDate) byNorm[nk] = g;
    });
    (src.dos || []).forEach(function (d) {
      if (d.status === 'Cancelled' || (d.remark && String(d.remark).indexOf('[CANCELLED]') >= 0)) return;
      var filled = 0, i;
      for (i = 1; i <= 5; i++) if (normPlot(d['plot_' + i])) filled++;
      for (i = 1; i <= 5; i++) {
        var pk = normPlot(d['plot_' + i]);
        if (!pk) continue;
        var q = Number(d['qty_' + i] || 0);
        if (!q && filled === 1) q = Number(d.total_qty || 0);
        if (!q) continue;
        var t = byNorm[normBatch(d['batch_' + i]) + '||' + pk];
        if (t) t.doDeducted += q;
      }
    });

    // 3rd culling counts only with a drone qty AND signed off; a sign-off
    // read that failed waives the signature half (rowVer === null).
    var verOK = src.rowVer !== null && src.rowVer !== undefined;
    var rowSigned = {}, tabSigned = {}, counted = {}, movedOut = {};
    (src.rowVer || []).forEach(function (v) {
      var key = String(v.plot_name || '');
      if (key.indexOf('cull_3::') !== 0) return;
      var rest = key.slice(8), bar = rest.indexOf('|');
      var head = (bar < 0 ? rest : rest.slice(0, bar)).trim().toUpperCase();
      if (head) rowSigned[(v.batch_name || '') + '::' + head] = 1;
    });
    (src.tabVer || []).forEach(function (v) { if (v && v.stage === 'cull_3') tabSigned[v.batch_name || ''] = 1; });
    (src.cull3 || []).forEach(function (r) {
      if (!/MapQty:\s*\d/i.test(r.remark || '')) return;
      var b = r.batch_name || '', pu = String(r.plot_name || '').trim().toUpperCase();
      if (verOK && !(tabSigned[b] || rowSigned[b + '::' + pu])) return;
      var k = b + '||' + (r.plot_name || '');
      counted[k] = (counted[k] || 0) + (r.quantity_change || 0);
    });
    (src.transfers || []).forEach(function (r) {
      var m = r.remark ? String(r.remark).match(/From:\s*\[([^|\]]+)\|/) : null;
      if (!m || !m[1].trim()) return;
      var k = (r.batch_name || '') + '||' + m[1].trim();
      movedOut[k] = (movedOut[k] || 0) + (r.quantity_change || 0);
    });
    var status = {};
    (src.allocations || []).forEach(function (a) {
      status[(a.batch_name || '') + '||' + (a.plot_name || '')] = a.plot_status || 'no_status';
    });
    rows.forEach(function (g) {
      g.culledQty = counted[g.key] || 0;
      g.transferredOut = movedOut[g.key] || 0;
      g.transferredIn = xferIn[g.key] || 0;
      g.figures = figures(g);
      g.status = status[g.key] || 'no_status';
    });
    return rows;
  }

  /* Available stock. rows: { plot, batch, breed, location, matureDate,
     status, figures:{plotBalance,culled,soldOut} }. */
  function classify(rows, opts) {
    opts = opts || {};
    var now = opts.now || new Date();
    var heights = opts.heights || {};
    var thisMonth = monthKey(now);
    var nextMonth = monthKey(new Date(now.getFullYear(), now.getMonth() + 1, 1));
    var avail = [], nextMature = [];
    (rows || []).forEach(function (r) {
      var f = r.figures || {};
      if (f.culled || f.soldOut || r.status === 'finished') return;
      var bal = Math.max(0, f.plotBalance || 0);
      if (!bal) return;
      var h = heights[heightKey(r.plot, r.batch)];
      var tall = !!(h && h.avg != null && h.avg >= HEIGHT_CM);
      var mk = monthKey(r.matureDate);
      var row = { plot: r.plot, batch: r.batch, breed: r.breed, location: r.location,
        matureDate: r.matureDate, height: h && h.avg != null ? h.avg : null,
        heightDate: h ? h.date : null, balance: bal };
      if (mk <= thisMonth) { row.why = 'matured'; avail.push(row); }
      else if (tall) { row.why = 'tall'; avail.push(row); }
      else if (mk === nextMonth) { row.why = 'next'; nextMature.push(row); }
    });
    var byDate = function (a, b) { return (a.matureDate - b.matureDate) || String(a.plot).localeCompare(String(b.plot)); };
    avail.sort(byDate); nextMature.sort(byDate);
    var sum = function (l) { return l.reduce(function (s, r) { return s + r.balance; }, 0); };
    var matured = sum(avail.filter(function (r) { return r.why === 'matured'; }));
    var tall = sum(avail.filter(function (r) { return r.why === 'tall'; }));
    return { avail: avail, nextMature: nextMature, matured: matured, tall: tall,
      available: matured + tall, nextNew: sum(nextMature) };
  }

  /* What every order still owes — loadCustomerOrders() in the page. */
  function orderBalances(src) {
    var dos = (src.dos || []).filter(function (d) { return String(d.status || '').toLowerCase() !== 'cancelled'; });
    var doByAl = {};
    dos.forEach(function (d) {
      if (!d.al_number || /^CAL-/i.test(String(d.do_number || ''))) return;
      doByAl[d.al_number] = (doByAl[d.al_number] || 0) + (Number(d.total_qty) || 0);
    });
    var alBy = {};
    (src.alRows || []).forEach(function (a) {
      var k = normOrder(a.order_number);
      if (!k) return;
      var cur = alBy[k];
      if (!cur || (Number(a.balance_quantity) || 0) > (Number(cur.balance_quantity) || 0)) alBy[k] = a;
    });
    var items = {};
    (src.items || []).forEach(function (it) { items[it.order_id] = (items[it.order_id] || 0) + (it.quantity || 0); });
    var coll = {}, haveColl = src.collections && src.collections.length;
    if (haveColl) src.collections.forEach(function (c) {
      if (!c.collected_at) return;
      coll[c.order_id] = (coll[c.order_id] || 0) + (c.collected_qty || 0);
    });
    var list = (src.orders || []).map(function (o) {
      var total = items[o.id] || 0;
      var collected = haveColl ? (coll[o.id] || 0) : ((o.collected_qty && o.collected_at) ? o.collected_qty : 0);
      var balance = total - collected;
      var al = alBy[normOrder(o.order_number)];
      var cancelled = false;
      if (al) {
        cancelled = al.status === 'Cancelled' || /\[CANCELLED\]/i.test(String(al.remark || ''));
        var closed = !cancelled && (al.status === 'Closed' || /\[CLOSED\]/i.test(String(al.remark || '')));
        var q = Number(al.quantity_ordered);
        if (!isNaN(q)) total = q;
        balance = total - (doByAl[al.al_number] || 0);
        if (cancelled || closed) balance = 0;
      }
      return { id: o.id, orderNumber: o.order_number, alNumber: al ? al.al_number : null,
        customer: o.billing_name || o.customer_name, rawStatus: o.status,
        paymentMethod: o.payment_terms || 'cash', totalQty: total, balance: balance,
        created: o.created_at ? new Date(o.created_at).getTime() : 0 };
    });
    var byNorm = {};
    list.forEach(function (o) { var k = normOrder(o.orderNumber) || ('id:' + o.id); (byNorm[k] = byNorm[k] || []).push(o); });
    return Object.keys(byNorm).map(function (k) {
      var g = byNorm[k].sort(function (a, b) { return b.created - a.created; });
      return g[0];
    });
  }

  /* The key an order is unticked under on the Actual Order window. */
  function orderKey(o) { return normOrder(o.orderNumber) || ('id:' + o.id); }

  /* Still owed and counted: not cash-unpaid, not cancelled, a balance
     left, and not unticked by the office. */
  function openOrders(orders, excludedKeys) {
    var ex = excludedKeys || {};
    return (orders || []).filter(function (o) {
      var isCash = (o.paymentMethod || 'cash') === 'cash';
      var unpaid = o.rawStatus === 'Pending Payment' || o.derivedStatus === 'Pending Payment';
      if (isCash && unpaid) return false;
      if (o.rawStatus === 'Cancelled') return false;
      if ((Number(o.balance) || 0) <= 0) return false;
      return !ex[orderKey(o)];
    });
  }

  global.MJMStockAnalysis = {
    HEIGHT_CM: HEIGHT_CM, logDate: logDate, monthKey: monthKey,
    heightKey: heightKey, latestHeights: latestHeights, figures: figures,
    buildStockRows: buildStockRows, classify: classify,
    orderBalances: orderBalances, orderKey: orderKey, openOrders: openOrders
  };
})(typeof window !== 'undefined' ? window : globalThis);
