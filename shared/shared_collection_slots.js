/* COLLECTION TIME SLOTS — the ONE place that says which hours a collection
   can be booked in, and how much one hour can take.

   Set on Seedling Stock Management -> System Settings -> Collection Time
   Slot, stored as the single row of shared_collection_slot_settings
   (shared/RUN_ME_collection_slot_settings.sql), and read by every booking
   screen through this file — so changing it there changes the slots here.

   Two rules, both the house ones:

   - AN ABSENT OR UNREADABLE ROW IS NOBODY HAVING BEEN ASKED. The defaults
     below are EXACTLY what was written into the pages before this setting
     existed (8 AM - 5 PM weekdays, 8 AM - 12 PM Saturday, Sunday closed,
     350 seedlings an hour, 600 a slot), so a database without the table
     books exactly as it always has.
   - A DATE OVERRIDE STILL WINS. shared_date_overrides opens, closes or
     re-hours ONE day; this is the default for every day nobody overrode.

   A slot is one hour, labelled by its start: hours(dow) for 8 to 17 is
   [8 .. 16], the 8-9 slot through the 4-5 slot.

   LUNCH is one break for every open day, OFF until somebody sets it (both
   hours empty), so a database that predates it books exactly as before.
   Its hours are taken out of hours(dow), and crossesLunch() refuses a
   booking that would run INTO it: one booking of several hours is one
   lorry being loaded, and the gang is not there at lunch. A day whose
   open hours do not reach the break (a Saturday closing at 12 with lunch
   at 12) simply has no lunch. */
(function (g) {
  'use strict';

  var TABLE = 'shared_collection_slot_settings';
  var DEFAULTS = Object.freeze({
    weekday_open: 8, weekday_close: 17,
    sat_open: 8, sat_close: 12,
    rate_per_hour: 350,       // seedlings one booking loads in an hour
    max_load_per_hour: 600,   // seedlings all bookings together may load in one hour
    lunch_start: null,        // no lunch break until somebody sets one
    lunch_end: null
  });
  var LUNCH_KEYS = { lunch_start: 1, lunch_end: 1 };

  var cur = Object.assign({}, DEFAULTS);
  var state = { source: 'default', error: null, row: null };

  function intIn(v, lo, hi) {
    var n = Number(v);
    return (isFinite(n) && Math.floor(n) === n && n >= lo && n <= hi) ? n : null;
  }

  /* What is wrong with a candidate setting, in words, or '' when nothing
     is. The settings page refuses to save while this says anything, and
     a stored row that fails it is not applied — a weekday that opens at
     the hour it closes is a week nobody can book. */
  function problem(s) {
    s = s || {};
    var wo = intIn(s.weekday_open, 0, 23), wc = intIn(s.weekday_close, 1, 24);
    var so = intIn(s.sat_open, 0, 23),     sc = intIn(s.sat_close, 1, 24);
    if (wo === null || wc === null) return 'Monday to Friday needs an opening and a closing hour.';
    if (wc <= wo) return 'Monday to Friday must close after it opens.';
    if (so === null || sc === null) return 'Saturday needs an opening and a closing hour.';
    if (sc <= so) return 'Saturday must close after it opens.';
    if (!(Number(s.rate_per_hour) > 0)) return 'Seedlings loaded per hour must be more than 0.';
    if (!(Number(s.max_load_per_hour) > 0)) return 'Maximum seedlings per hour slot must be more than 0.';
    var ls = s.lunch_start, le = s.lunch_end;
    var lsSet = !(ls === null || ls === undefined || ls === ''), leSet = !(le === null || le === undefined || le === '');
    if (lsSet || leSet) {
      var lo = intIn(ls, 0, 23), lc = intIn(le, 1, 24);
      if (lo === null || lc === null) return 'Lunch needs a start and an end, or neither.';
      if (lc <= lo) return 'Lunch must end after it starts.';
    }
    return '';
  }

  /* A lunch hour left empty is NULL and stays NULL: Number(null) is 0,
     which would be a break at midnight rather than no break at all. A
     row from before the lunch columns has no such key either, which is
     the same answer. */
  function val(k, v) {
    if (LUNCH_KEYS[k]) return (v === null || v === undefined || v === '') ? null : Number(v);
    return Number(v);
  }

  function apply(row) {
    if (!row || problem(row)) return false;
    Object.keys(DEFAULTS).forEach(function (k) { cur[k] = val(k, row[k]); });
    return true;
  }

  async function load(supa) {
    state.error = null;
    try {
      var r = await supa.from(TABLE).select('*').eq('id', 1).maybeSingle();
      if (r.error) { state.error = r.error; return get(); }
      state.row = r.data || null;
      state.source = apply(r.data) ? 'saved' : 'default';
    } catch (e) { state.error = e; }
    return get();
  }

  async function save(supa, s, who) {
    var why = problem(s);
    if (why) return { error: { message: why } };
    var row = { id: 1, updated_at: new Date().toISOString(), updated_by: who || null };
    Object.keys(DEFAULTS).forEach(function (k) { row[k] = val(k, s[k]); });
    var r = await supa.from(TABLE).upsert(row, { onConflict: 'id' }).select().maybeSingle();
    /* A database that has the table and not yet the lunch columns refuses
       the whole row over them. With no lunch set there is nothing to lose
       by leaving them off, so the hours still save. With a lunch set the
       refusal stands, and the page names the file to run. */
    if (r.error && row.lunch_start === null && row.lunch_end === null &&
        /lunch_(start|end)/.test(String(r.error.message || ''))) {
      delete row.lunch_start; delete row.lunch_end;
      r = await supa.from(TABLE).upsert(row, { onConflict: 'id' }).select().maybeSingle();
    }
    if (!r.error) { state.row = r.data || row; state.source = 'saved'; apply(row); }
    return r;
  }

  function range(a, b) { var out = []; for (var h = a; h < b; h++) out.push(h); return out; }
  function lunch() {
    return (cur.lunch_start === null || cur.lunch_end === null) ? null
      : { start: cur.lunch_start, end: cur.lunch_end };
  }
  function isLunch(h) { var L = lunch(); return !!L && h >= L.start && h < L.end; }
  /* A booking from startH to endH (end exclusive) touches the break. */
  function crossesLunch(startH, endH) {
    var L = lunch();
    return !!L && startH < L.end && endH > L.start;
  }
  function withoutLunch(hs) { return hs.filter(function (h) { return !isLunch(h); }); }

  /* The slots of a day of the week (0 Sunday .. 6 Saturday). Sunday is
     closed, as it has always been. */
  function hours(dow) {
    if (dow === 0) return [];
    return withoutLunch(dow === 6 ? range(cur.sat_open, cur.sat_close) : range(cur.weekday_open, cur.weekday_close));
  }
  function closing(dow) {
    if (dow === 0) return 0;
    return dow === 6 ? cur.sat_close : cur.weekday_close;
  }
  function opening(dow) {
    if (dow === 0) return 0;
    return dow === 6 ? cur.sat_open : cur.weekday_open;
  }

  function get() { return Object.assign({}, cur); }

  g.MJMCollectionSlots = {
    TABLE: TABLE, DEFAULTS: DEFAULTS,
    load: load, save: save, get: get, problem: problem,
    hours: hours, opening: opening, closing: closing,
    lunch: lunch, isLunch: isLunch, crossesLunch: crossesLunch, withoutLunch: withoutLunch,
    source: function () { return state.source; },
    error: function () { return state.error; },
    row: function () { return state.row; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
