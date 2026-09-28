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

  /* nursery → [plot], base plus whatever loadCustom() returned. */
  function merged(custom) {
    const out = base();
    Object.keys(custom || {}).forEach(n => {
      if (!out[n]) out[n] = [];
      (custom[n] || []).forEach(p => { if (!out[n].includes(p)) out[n].push(p); });
    });
    return out;
  }

  /* plot key → nursery, built once and handed back for repeated lookups. */
  function index(custom) {
    const by = merged(custom);
    const map = {};
    Object.keys(by).forEach(n => by[n].forEach(p => { map[plotKey(p)] = n; }));
    return map;
  }

  function nurseryOfPlot(plot, idx) {
    return (idx || {})[plotKey(plot)] || null;
  }

  global.MJMMaintPlots = { NURSERIES, base, merged, index, nurseryOfPlot, plotKey, loadCustom };
})(typeof window !== 'undefined' ? window : globalThis);
