/* ══════════════════════════════════════════════════════════════════════════
   PAIRING THE FIELD'S WORK TO THE OFFICE'S SCHEDULE

   A worker records a morning on the phone; the office has a row for that job
   on that plot this month. Putting the two together is the whole link between
   what was done and what gets paid, and it is not a straight join — the two
   sides identify the same job differently.

   THE ROUND is where they disagree. The office reads it off the front of its
   own chemical ("Round 2: Manzate …"); the phone sends the week its board was
   showing. Those agree only when the office schedules one round per week, and
   it often does not — a plot with a single P & D round worked in week two has
   the office saying 1 and the phone saying 2.

   THE CHEMICAL is the better fact, and the second way in: it is what the job
   IS, where the round is only what the office calls it. Manzate is Manzate
   whichever week the phone was showing. It cannot attach work to a job the
   office never scheduled, which is what makes it safe to fall back on — and
   it is used only where the chemical picks out exactly ONE office row, because
   two rows with the same chemical on the same plot cannot say which of them a
   record belongs to, and guessing puts a worker's capacity on the wrong round.

   WHY THIS IS A SHARED FILE. Two screens need this answer: the Work
   Maintenance Worker Record, which ticks the workers and fills in the dates,
   and the payroll module's salary claim, which prices them. The claim used to
   read only the ticks the Worker Record had SAVED, so field work paid nothing
   until somebody opened the office page for that month — and when the saving
   itself failed, it paid nothing at all. Now both derive the same credits from
   the same records with the same rule, so the claim is right whether or not
   anybody has been to the office screen.

   Everything here is pure: it takes rows and gives back an answer. Reading the
   rows, ticking them and saving them stays with the page that does it.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* What the phone calls a job → what the office calls it. A record that
     carries its own `jenis` uses that; this is for the older ones that do
     not. */
  const JENIS = {
    pd:       'Penyemburan racun kulat dan serangga',
    manuring: 'Membaja',
    weeding:  'Merumput',
    interrow: 'Meracun rumput secara selingan'
  };

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const plotKey = (v) => String(v == null ? '' : v).trim().toUpperCase().replace(/[^0-9A-Z]/g, '');

  /* A chemical, compared the way a person would compare it: the round label
     off the front, then letters and digits only.

       "Round 1: Manzate 50gm + Bond 15mL"  →  MANZATE50GMBOND15ML
       "Manzate 50gm + Bond 15mL"           →  the same

     The round comes off because it is the thing that disagrees. */
  function chemKey(s) {
    return String(s == null ? '' : s)
      .replace(/^\s*Round\s+\d+\s*:/i, '')
      .replace(/[^a-z0-9]/gi, '')
      .toUpperCase();
  }

  /* The round the office wrote on the front of its chemical, or 0. */
  function recRound(racun) {
    const m = /^\s*Round\s+(\d+)\s*:/i.exec(String(racun || ''));
    return m ? parseInt(m[1], 10) : 0;
  }

  /* THE CALENDAR WEEK A SCHEDULED ROW BELONGS TO, off the SLOT it came from.

     The round LABEL used to be the week number, so reading "Round 3" off the
     chemical told you both which round it was and which week it sat in. It no
     longer does: a round is now numbered by its position among the weeks the
     schedule actually uses, so a nursery spraying in weeks 1 and 3 has a
     Round 1 and a Round 2.

     The week is still the week, and it is in the slot — pd|W3|P|B1,
     wd|R3|B1, mn|2|0|B2, ir|2|0|B1 — which nothing on the screen can edit.
     Pairing a field record to an office row is a question about the WEEK the
     work was done in, so it asks this and not the label.

     A row with no slot is somebody's own, has no week, and falls back to its
     label, which is the best guess available and what it has always done. */
  function srcWeek(src) {
    const parts = String(src || '').split('|');
    const tag = parts[0], a = parts[1] || '';
    if (tag === 'pd' || tag === 'wd') {            // 'W3' / 'R3'
      const n = parseInt(a.replace(/[^0-9]/g, ''), 10);
      return n >= 1 && n <= 4 ? n : 0;
    }
    if (tag === 'mn' || tag === 'ir') {            // 0-based slot index
      const n = parseInt(a, 10);
      return (n >= 0 && n <= 3) ? n + 1 : 0;
    }
    return 0;
  }

  /* The week to pair a row on: its slot's, else whatever its label says. */
  const rowWeek = (r) => srcWeek(r && r._src) || recRound(r && r.racun);

  /* Which seven-day block of the month a date falls in — the 29th on is the
     4th, the same way the schedule's last round runs to the end of the month. */
  function weekOfDate(iso) {
    const day = parseInt(String(iso || '').slice(8, 10), 10);
    return day ? Math.min(4, Math.ceil(day / 7)) : 0;
  }

  function isoMonthLabel(iso) {
    const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
    return m ? `${MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}` : '';
  }

  const fieldKey     = (jenis, plot, week) => `${jenis}||${plotKey(plot)}||${week}`;
  const fieldChemKey = (jenis, plot, chem) => `${jenis}||${plotKey(plot)}||${chemKey(chem)}`;

  /* WHO A FIELD RECORD CREDITS THE WORK TO.

     `worked_by` is the conductor keying a job for somebody whose phone was
     broken, or naming the crew who did it; empty means the person who reported
     it did it themselves. Both are read, because a job three workers each
     saved from their own phone has worked_by empty on all three, and crediting
     nobody for a morning three people spent is worse than crediting the wrong
     person — it is silent. */
  function credits(f) {
    const raw = String((f && f.worked_by) || '').trim()
             || String((f && f.reported_by) || '').trim();
    return raw.split(',').map(x => x.trim()).filter(Boolean);
  }

  const uniq = (xs) => [...new Set(xs.filter(Boolean))];

  /* What a group of records for one job comes to. The QUANTITY is the newest
     record's and not the sum: three workers on one job each report the plot
     they worked, and adding them would treble it. */
  function summarise(list) {
    const newest = list.reduce((best, f) => {
      if (!best) return f;
      const a = String(f.work_date || ''), b = String(best.work_date || '');
      return (a > b || (a === b && (f.id || 0) > (best.id || 0))) ? f : best;
    }, null);
    return {
      list,
      ids:     list.map(f => f.id),
      dates:   uniq(list.map(f => f.work_date)).sort(),
      batches: uniq(list.flatMap(f => String(f.batch_name || '').split(',').map(x => x.trim()))),
      workers: uniq(list.flatMap(credits)),
      qty:     newest ? newest.qty : null
    };
  }

  /* The field's answer for each (job, plot, round) of one month, and beside it
     the same records filed by (job, plot, CHEMICAL).

     `extend` lets a caller add to each group — the office hangs the GPS tracks
     off it — without this file having to know about it. */
  function index(fieldRecords, monthLbl, extend) {
    const groups = {}, byChem = {};
    (fieldRecords || []).forEach(f => {
      const jenis = f.jenis || JENIS[f.work_type];
      if (!jenis) return;
      if ((f.schedule_month || isoMonthLabel(f.work_date)) !== monthLbl) return;
      const week = f.week_no || weekOfDate(f.work_date);
      if (!week) return;
      const k = fieldKey(jenis, f.plot_name, week);
      (groups[k] || (groups[k] = [])).push(f);
      // Only where the phone actually recorded a chemical. A record without
      // one has nothing to be matched on and keeps the round as its only route.
      if (chemKey(f.chemical)) {
        const c = fieldChemKey(jenis, f.plot_name, f.chemical);
        (byChem[c] || (byChem[c] = [])).push(f);
      }
    });
    const wrap = (list) => {
      const g = summarise(list);
      return extend ? Object.assign(g, extend(list, g)) : g;
    };
    const idx = {};
    Object.keys(groups).forEach(k => { idx[k] = wrap(groups[k]); });
    const chem = {};
    Object.keys(byChem).forEach(k => { chem[k] = wrap(byChem[k]); });
    idx.__byChem = chem;
    return idx;
  }

  /* WHICH OFFICE ROW EACH GROUP LANDS ON.

     `records` are the office's work records, already narrowed to one nursery.
     Returns, for every record that the field answered:

        pairs   recordId → the group, and the key it was found by
        used    the keys that found a row
        chemRows  how many office rows carry each chemical, per job and plot —
                  the ambiguity guard, kept so a caller can see it

     The order is the office's: the round first, then the chemical, and the
     chemical only where it picks out one row. A row somebody has CHECKED is
     skipped, because Checked means the office has settled it and a later sync
     must not move it. */
  function pair(records, idx, opts) {
    const skipChecked = !opts || opts.skipChecked !== false;
    const chemRows = {};
    (records || []).forEach(r => {
      const c = fieldChemKey(r.jenis, r.plot, r.racun);
      chemRows[c] = (chemRows[c] || 0) + 1;
    });
    const pairs = {}, used = new Set();
    (records || []).forEach(r => {
      if (skipChecked && r.checked) return;
      const week = rowWeek(r);
      let key = week ? fieldKey(r.jenis, r.plot, week) : null;
      let g = key ? idx[key] : null;
      if (!g) {
        const ck = fieldChemKey(r.jenis, r.plot, r.racun);
        if (chemKey(r.racun) && chemRows[ck] === 1) {
          const byChem = idx.__byChem || {};
          if (byChem[ck] && !used.has(ck)) { g = byChem[ck]; key = ck; }
        }
      }
      if (!g) return;
      used.add(key);
      pairs[r.id] = { group: g, key };
    });
    return { pairs, used, chemRows };
  }

  /* recordId → the names the field credited, for a caller that only wants to
     know who to pay. `resolve` turns a credited name into the column/row name
     the caller holds (matching on letters and digits, usually), and anything
     it cannot place is collected in `unmatched` rather than dropped. */
  function creditsByRecord(records, idx, resolve) {
    const { pairs } = pair(records, idx);
    const out = {}, unmatched = new Set(), noTaker = {};
    Object.keys(pairs).forEach(id => {
      const names = pairs[id].group.workers || [];
      const hits = [], missed = [];
      names.forEach(n => {
        const got = resolve ? resolve(n) : n;
        if (got) hits.push(got); else { unmatched.add(n); missed.push(n); }
      });
      if (hits.length) out[id] = uniq(hits);
      /* The field answered for this row and NOBODY it named could take the
         work. Kept per record, not just as one list, so a caller can say
         which job went unpaid rather than only which names were lost. */
      else if (missed.length) noTaker[id] = uniq(missed);
    });
    return { credits: out, unmatched: [...unmatched].sort(), noTaker };
  }

  /* Names compared the way people compare them: letters and digits, upper
     case. "Ali B. Hassan" and "Ali b Hassan" are one worker to everybody
     except a string comparison. */
  const nameKey = (v) => String(v == null ? '' : v).replace(/[^a-z0-9]/gi, '').toUpperCase();
  function nameResolver(names) {
    const by = new Map();
    (names || []).forEach(n => { const k = nameKey(n); if (k && !by.has(k)) by.set(k, n); });
    return (n) => by.get(nameKey(n)) || null;
  }

  global.MJMMaintField = {
    JENIS, plotKey, chemKey, recRound, srcWeek, rowWeek, weekOfDate, isoMonthLabel,
    fieldKey, fieldChemKey, credits, summarise, index, pair, creditsByRecord,
    nameKey, nameResolver
  };
})(typeof window !== 'undefined' ? window : globalThis);
