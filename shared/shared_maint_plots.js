/* ══════════════════════════════════════════════════════════════════════════
   WHICH NURSERY A PLOT BELONGS TO

   The Work Maintenance schedule draws a row per plot; the salary claim has to
   put each of those rows back under the nursery it came from, because a work
   record names its plot and nothing else. Both pages therefore need the same
   plot list — and until this file they each kept their own copy of it.

   THEY HAD DRIFTED, and silently. The claim's copy had UNN 2 as V1-V40 while
   the schedule has always drawn it as N1-N20, so every UNN 2 work record
   matched no nursery at all: its capacity was dropped on the floor and the
   claim showed a page of dashes that looked exactly like a quiet month. Its
   UNN 1 ran to U40 where the schedule stops at U18 — harmless, but it is the
   same mistake pointing the other way.

   And neither copy knew about a plot added by hand. "Add Row" on a schedule
   writes to nops_maint_custom_plots; the schedule merges those in on load and
   the claim never read the table, so work on a hand-added plot paid nothing.

   So: ONE list, here, read by both. The schedule takes its rows from base()
   and the claim resolves its records with nurseryOfPlot(). Custom plots are
   loaded with loadCustom() and merged the same way on both sides.

   Plot names are compared on LETTERS AND DIGITS, upper-cased — the same rule
   every other crossing of this boundary uses. "B 4", "b4" and "B4" are one
   plot; a plot keyed with a stray space is not a plot that pays nothing.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* The plots each nursery is drawn with. This is the list the Work
     Maintenance schedule has always used; it is here rather than there so the
     salary claim reads the same one. */
  const BASE = {
    PN:   ['P01','P02','P03','P04','P05','P06','P07','P08','P09','P10',
           'P11','P12','P13','P14','P15','P16','P17','P18','P19','P20',
           'P21','P22','P23','P24','P25','P26','P27','P28','P29','P30',
           'P31','P32','P33','P34','P35','P36','P37','P38','P39','P40',
           'P41','P42','P43','P44','P45','P46','P47','P48','P49','P50',
           'P51','P52'],
    BNN:  ['B1','B2','B3','B4','B5','B6','B7',
           'B8','B9','B10','B11','B12','B13','B14'],
    UNN1: ['U1','U2','U3','U4','U5','U6','U7','U8','U9',
           'U10','U11','U12','U13','U14','U15','U16','U17','U18'],
    UNN2: ['N1','N2','N3','N4','N5','N6','N7','N8','N9','N10',
           'N11','N12','N13','N14','N15','N16','N17','N18','N19','N20']
  };

  const NURSERIES = Object.keys(BASE);

  /* A fresh copy every time. The schedule pushes hand-added plots onto its
     own lists, and handing it the shared arrays would let one page's edit
     reach into the other's. */
  function base() {
    const out = {};
    NURSERIES.forEach(n => { out[n] = BASE[n].slice(); });
    return out;
  }

  const plotKey = (v) => String(v == null ? '' : v).replace(/[^a-z0-9]/gi, '').toUpperCase();

  /* Read the plots somebody added by hand. Soft: a table that is not there, or
     a read that fails, gives back nothing rather than taking the caller down —
     the base list is still the right answer for every plot but those. */
  async function loadCustom(sb) {
    const out = {};
    if (!sb) return out;
    const res = await sb.from('nops_maint_custom_plots').select('nursery, plot')
      .then(r => r, e => ({ error: e }));
    if (res.error) return out;
    (res.data || []).forEach(r => {
      if (!r || !r.nursery || !r.plot) return;
      (out[r.nursery] || (out[r.nursery] = [])).push(r.plot);
    });
    return out;
  }

  /* THE TRANSFER PLOTS, AND EVERY OTHER PLOT SEEDLING STOCK KNOWS.

     A "-R" plot is made by a 3rd-culling transfer and is in no hardcoded list
     anywhere. The schedule grew ways to draw one -- a capacity keyed against
     it, or rows of its own -- and the SALARY CLAIM never did. So a
     maintenance record on B3-R resolved to no nursery at all, landed on the
     orphan list, and its capacity paid nobody: the same shape as the UNN 2
     bug above, pointing at a different set of plots.

     shared_plots is where the office says which nursery a plot is in, and is
     the same table the Setting page's capacity grid is built from. The
     nursery is named there the way Seedling Stock spells it -- "UNN 1" with
     the space -- so it is matched on letters and digits, like everything else
     that crosses this boundary.

     Soft, for the same reason loadCustom is: a table that cannot be read
     gives back nothing rather than taking the claim down. */
  async function loadStock(sb) {
    return (await loadStockStrict(sb)).by;
  }

  /* THE SAME READ, SAYING WHETHER IT ANSWERED.

     `loadStock` cannot tell "the read failed" from "the read was fine and
     this nursery has no plots keyed", because both come back as nothing —
     and the difference is now the whole of whether a plot the office
     DELETED disappears or the built-in range stands. See `offered` below.

     `ok` is false only for a read that was refused or threw. `by` is what
     came back, and `keyed` is the nurseries the office has actually said
     something about. */
  async function loadStockStrict(sb) {
    const by = {};
    if (!sb) return { by, ok: false, keyed: [] };
    const res = await sb.from('shared_plots').select('nursery_name, plot_name')
      .then(r => r, e => ({ error: e }));
    if (res.error) return { by, ok: false, keyed: [] };
    const byKey = {};
    NURSERIES.forEach(n => { byKey[plotKey(n)] = n; });
    (res.data || []).forEach(r => {
      const n = byKey[plotKey(r && r.nursery_name)];
      const p = String((r && r.plot_name) || '').trim();
      if (!n || !p) return;
      (by[n] || (by[n] = [])).push(p);
    });
    return { by, ok: true, keyed: Object.keys(by) };
  }

  /* Both at once. Either one failing still gives back what the other found,
     because half a plot list is better than none and the base list is still
     right for every plot but these. */
  async function loadAll(sb) {
    const [custom, stock] = await Promise.all([loadCustom(sb), loadStock(sb)]);
    const out = {};
    [custom, stock].forEach(src => Object.keys(src).forEach(n => {
      (out[n] || (out[n] = [])).push(...src[n]);
    }));
    return out;
  }

  /* nursery → [plot], base plus whatever was loaded.
     Deduped on LETTERS AND DIGITS, not on the string: Seedling Stock and a
     hand-added plot can spell the same plot two ways, and "B 4" twice is one
     plot drawn twice. */
  function merged(custom) {
    const out = base();
    const seen = {};
    Object.keys(out).forEach(n => {
      seen[n] = new Set(out[n].map(plotKey));
    });
    Object.keys(custom || {}).forEach(n => {
      if (!out[n]) { out[n] = []; seen[n] = new Set(); }
      (custom[n] || []).forEach(p => {
        const k = plotKey(p);
        if (!k || seen[n].has(k)) return;
        out[n].push(p); seen[n].add(k);
      });
    });
    return out;
  }

  /* ══ WHAT IS OFFERED, which is not the same question as what can be PLACED
     ═══════════════════════════════════════════════════════════════════════

     A plot is added AND DELETED in one place: Seedling Stock Management →
     System Settings. The office: *"i deleted a plot, make it remove from all
     modules too. i added a plot, make it add for all modules too."*

     The adding half was already true — the four built-in ranges were the
     FLOOR and `shared_plots` was added on top. **That floor is exactly what
     stopped a deletion biting**: B14 was offered whether or not the office
     still had a row for it.

     SO THE OFFICE'S LIST WINS, PER NURSERY. For a nursery the office has
     keyed, that list IS the list — delete B14 there and it is gone from
     every grid, dropdown and schedule row in the company. Three things keep
     that from being a cliff, and each is a way it would otherwise go wrong:

     1. A READ THAT FAILED CHANGES NOTHING (`ok` false). The ranges stand,
        exactly as before. An empty plot picker is a module nobody can use,
        and a grid that went blank because a table could not be read is far
        worse than one that is a plot short. This is the fail-open rule every
        gate here follows, and it is why `loadStockStrict` exists at all.
     2. ASKED PER NURSERY, NEVER ONCE FOR ALL FOUR. The PRE NURSERY is
        counted in TRAYS, so `shared_plots` may hold no PN row at all — and
        a single global test would then wipe P01 to P52 off every screen in
        the system. A nursery the office has said NOTHING about keeps its
        range: an absent answer is nobody having been asked, which is the
        oldest rule in this file.
     3. IT IS THE LIST ONLY, NEVER THE PLACING. `index()` below still builds
        off the ranges as well, so a maintenance record keyed on a plot that
        has since been deleted STILL RESOLVES to its nursery and still pays.
        Taking a plot off the pickers must not take last month's work off the
        claim — that is the orphan-list fault this file opens with, and it
        would be money.

     WHAT IT COSTS, and `shared/CHECK_which_plots_each_module_offers.sql` is
     what measures it: every plot in a built-in range that the office has NOT
     keyed now DISAPPEARS. Run that check before trusting this — if it names
     a plot nobody deleted, that plot was never keyed in Seedling Stock, and
     the answer is to add it there. */
  function offered(loaded) {
    const stock  = (loaded && loaded.stock)  || {};
    const custom = (loaded && loaded.custom) || {};
    const ok     = !!(loaded && loaded.ok);
    const out = {};
    NURSERIES.forEach(n => {
      const keyed = ok && Array.isArray(stock[n]) && stock[n].length;
      out[n] = keyed ? stock[n].slice() : BASE[n].slice();
    });
    /* A plot added by hand on a schedule is the office saying it exists by
       another route, so it is still appended — and it is deduped against
       whichever list won above. */
    const seen = {};
    Object.keys(out).forEach(n => { seen[n] = new Set(out[n].map(plotKey)); });
    Object.keys(custom).forEach(n => {
      if (!out[n]) { out[n] = []; seen[n] = new Set(); }
      (custom[n] || []).forEach(p => {
        const k = plotKey(p);
        if (!k || seen[n].has(k)) return;
        out[n].push(p); seen[n].add(k);
      });
    });
    NURSERIES.forEach(n => out[n].sort(plotOrder));
    return out;
  }

  /* B10 after B9, and B3-R behind B3 — letters, then the number AS A NUMBER,
     then whatever follows it. The built-in ranges are already in that order,
     so this moves nothing that was already right. */
  function plotOrder(a, b) {
    return String(a).localeCompare(String(b), undefined,
                                   { numeric: true, sensitivity: 'base' });
  }

  /* BOTH ANSWERS FROM ONE READ, which is what every caller actually wants:
     `offer` is the list to put on a screen and `place` is the map that says
     which nursery a plot is in. Two reads would be two answers. */
  async function loadLists(sb) {
    const [custom, stock] = await Promise.all([loadCustom(sb), loadStockStrict(sb)]);
    const loaded = { custom, stock: stock.by, ok: stock.ok };
    return {
      offer: offered(loaded),
      place: index(loadedFlat(custom, stock.by)),
      stockOk: stock.ok,
      keyed: stock.keyed
    };
  }

  function loadedFlat(custom, stock) {
    const out = {};
    [custom || {}, stock || {}].forEach(src => Object.keys(src).forEach(n => {
      (out[n] || (out[n] = [])).push(...src[n]);
    }));
    return out;
  }

  /* plot key → nursery, built once and handed back for repeated lookups.
     RANGES INCLUDED, deliberately — see `offered` above: a record keyed on a
     plot the office has since deleted has to go on resolving, or deleting a
     plot takes last month's work off the salary claim. */
  function index(custom) {
    const by = merged(custom);
    const map = {};
    Object.keys(by).forEach(n => by[n].forEach(p => { map[plotKey(p)] = n; }));
    return map;
  }

  function nurseryOfPlot(plot, idx) {
    return (idx || {})[plotKey(plot)] || null;
  }

  /* WHICH GANG IS PAID FOR LOADING A DO. worked_by_by_nursery is keyed by
     the GANG: the DO Signing app ticks a nursery list of workers, and every
     other nursery can be opened under it by hand, because a UNN 1 gang
     regularly loads seedlings off a UNN 2 plot. The Loading Seedlings sheet
     and the claim then asked only the PLOT nursery, so such a DO was on the
     UNN 2 sheet with nobody ticked and on no UNN 1 sheet at all: carried and
     paid to nobody. October 2026 had two of them, DO-NPGCE401 and
     DO-0HVUL302, 700 seedlings off N16.

     The rule, per item line of the DO:
     - the gang of the nursery the plot is in, if that gang is ticked;
     - otherwise the gangs that ARE ticked, the line divided equally between
       them, so a line is never paid twice;
     - otherwise (nobody ticked anywhere) the plot nursery, so an unticked
       DO still shows on its own sheet as a question to answer.
     Where the plot nursery gang is ticked nothing moves -- where the
     seedlings were is still who carried them, unless they say otherwise.

     ownerQty(d) is the plot side, [{nursery, qty}] per line, built by the
     caller with its own plot index, so the one rule serves both screens.
     SHARED: nursery_ops Loading Seedlings sheet and the npayroll claim. */
  function doLoaderQty(d, nursery, lines) {
    const by = (d && d.worked_by_by_nursery) || {};
    const ticked = Object.keys(by).filter(k => Array.isArray(by[k]) && by[k].length);
    let qty = 0;
    (lines || []).forEach(({ nursery: owner, qty: q }) => {
      if (!q) return;
      if (owner && ticked.includes(owner)) { if (owner === nursery) qty += q; return; }
      if (ticked.length) { if (ticked.includes(nursery)) qty += q / ticked.length; return; }
      if (owner === nursery) qty += q;
    });
    return qty;
  }

  global.MJMMaintPlots = { NURSERIES, base, merged, index, nurseryOfPlot, plotKey,
                           loadCustom, loadStock, loadStockStrict, loadAll,
                           loadLists, offered, plotOrder, doLoaderQty };
})(typeof window !== 'undefined' ? window : globalThis);
