/* ══════════════════════════════════════════════════════════════════════════
   WHEN A PAYROLL MONTH STOPS BEING EDITABLE

   Two answers, to two different questions.

   VERIFICATION is per sheet. Somebody with the Verify tick says "this one is
   checked and right" — Work Maintenance for BNN, Transplanting for UNN 1 —
   and that sheet locks the moment they do. It is the normal way a month
   closes: sheet by sheet, by the person who checked it, with their name and
   the time against it.

   THE MONTH LOCK is the whole module at once, on a calendar. Every sheet of
   that month, verified or not. It auto-locks on the Nth of the following
   month and can be forced open or shut by hand by somebody with Lock
   Controls. It is the backstop, and the only thing that can re-open a month
   whose sheets have been verified.

   ITS OWN TABLES, on purpose. shared_month_lock.js governs Delivery Orders,
   Approval Letters and the Batch Record off shared_month_locks, and the two
   must move separately: closing September's payroll cannot close September's
   delivery orders, and re-opening a delivery order in October cannot re-open
   a payroll that has already been paid. The calendar arithmetic here is that
   file's, deliberately — same rules, same shape, different tables — so
   somebody who has read one already knows this one.

   FAILS OPEN. A table that is not there yet, or a read that fails, leaves
   every month on its computed default and nothing verified. Nobody is locked
   out of a payroll by a load error, which is the same rule the rest of this
   system follows for access.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const DEFAULT_LOCK_DAY = 2;

  let locks = [];      // mjmnpayroll_month_locks
  let days  = [];      // mjmnpayroll_lock_days
  let vers  = [];      // mjmnpayroll_verifications
  let ready = false;

  /* The lock day in force for a month's own data: the latest history entry
     whose effective point is at or before it, else the system default. A day
     set today must not rewrite how an already-elapsed month got locked. */
  function lockDayFor(year, month) {
    const target = year * 12 + month;
    let day = DEFAULT_LOCK_DAY;
    days.slice()
        .sort((a, b) => (a.effective_year - b.effective_year) || (a.effective_month - b.effective_month))
        .forEach(h => { if ((h.effective_year * 12 + h.effective_month) <= target) day = h.lock_day; });
    return day;
  }

  /* What the day selector shows: the day in force as of right now. */
  function currentLockDay() {
    const n = new Date();
    return lockDayFor(n.getFullYear(), n.getMonth() + 1);
  }

  /* month is 1-based. JS Date's 0-based index for the NEXT calendar month
     equals this month's own 1-based number, so leaving it as-is lands on the
     day-th of the month after it with no juggling. */
  function autoLockDateFor(year, month) {
    return new Date(year, month, lockDayFor(year, month));
  }

  const lockRow = (year, month) =>
    locks.find(r => r.year === year && r.month === month) || null;

  function isMonthLocked(year, month) {
    /* Nothing loaded, nothing locks. The computed default says a month locks
       on the Nth of the next one, and applying that while the tables are
       UNREADABLE locks every elapsed month with no way back: Lock Controls
       cannot write an override it cannot read, so the override that would
       re-open it can never be saved. That is the one thing the header of
       this file promises will not happen. Once the tables are there this
       changes nothing — ready() is true before the first paint. */
    if (!ready) return false;
    const row = lockRow(year, month);
    if (row && row.manual_override !== null && row.manual_override !== undefined) {
      return !!row.manual_override;
    }
    return new Date() >= autoLockDateFor(year, month);
  }

  /* The payroll works in "YYYY-MM" throughout, so that is what everything
     here takes. */
  function splitMonth(ym) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
    return m ? { year: +m[1], month: +m[2] } : null;
  }
  function isMonthLockedStr(ym) {
    const p = splitMonth(ym);
    return p ? isMonthLocked(p.year, p.month) : false;
  }

  /* ── Verification ────────────────────────────────────────────────────── */

  /* A scope is the nursery or section the sheet was showing. Compared on
     letters and digits, the way every nursery name is compared in this
     system: the claim keys on UNN1 and the register says "UNN 1". */
  const scopeKey = (v) => String(v == null ? '' : v).replace(/[^a-z0-9]/gi, '').toUpperCase();

  /* The verification that closes this sheet, if there is one.

     An EMPTY scope on a saved row means the whole sheet — every section of
     it — because that is what the picker says when it is left on "All
     sections", and somebody verifying with it left there is verifying the
     lot. So a row for the exact section closes that section, and a row with
     no scope closes all of them. The other way round is not true: verifying
     BNN says nothing about UNN 1. */
  function verificationOf(ym, sheet, scope) {
    const want = scopeKey(scope);
    return vers.find(v => v.month === ym && v.sheet === sheet
                       && (scopeKey(v.scope) === want || scopeKey(v.scope) === '')) || null;
  }

  /* Is this sheet closed? Either its month is locked outright, or this sheet
     has been verified. */
  function isSheetLocked(ym, sheet, scope) {
    return isMonthLockedStr(ym) || !!verificationOf(ym, sheet, scope);
  }

  /* Why, in the order that decides it — so a screen can say which of the two
     is holding it rather than only that it is shut. */
  function lockReason(ym, sheet, scope) {
    if (isMonthLockedStr(ym)) return { kind: 'month' };
    const v = verificationOf(ym, sheet, scope);
    if (v) return { kind: 'verified', by: v.verified_by || '', at: v.verified_at || '' };
    return null;
  }

  /* ── Reading and writing ─────────────────────────────────────────────── */

  async function load(supabase) {
    if (!supabase) return;
    try {
      const [l, d, v] = await Promise.all([
        supabase.from('mjmnpayroll_month_locks').select('*'),
        supabase.from('mjmnpayroll_lock_days').select('*'),
        supabase.from('mjmnpayroll_verifications').select('*')
      ]);
      if (l.error || d.error || v.error) throw (l.error || d.error || v.error);
      locks = l.data || []; days = d.data || []; vers = v.data || [];
      ready = true;
    } catch (e) {
      // Not set up yet, or a read that failed. Every month on its computed
      // default, nothing verified — see the header: this fails open.
      locks = []; days = []; vers = [];
      ready = false;
    }
  }

  /* ── WHEN, ACCORDING TO WHOM ────────────────────────────────────────────
     No timestamp is sent from here, on purpose. These rows say when a payroll
     month was closed and when a sheet was signed off, and a figure taken from
     the BROWSER's clock is only as right as that device is — a phone an hour
     out stamps a verification an hour out, and nothing downstream can tell.
     The database stamps them instead, from one clock, in
     RUN_ME_npayroll_lock_stamps.sql. On an upsert that lands on an existing
     row a column DEFAULT does not fire, which is why that file uses a trigger
     rather than relying on the defaults the tables already carry. */
  async function setManualOverride(supabase, year, month, locked, who) {
    const { error } = await supabase.from('mjmnpayroll_month_locks')
      .upsert({ year, month, manual_override: locked, updated_by: who || null },
              { onConflict: 'year,month' });
    if (!error) await load(supabase);
    return error;
  }

  async function setManualOverrideForYear(supabase, year, locked, who) {
    const rows = [];
    for (let month = 1; month <= 12; month++) {
      rows.push({ year, month, manual_override: locked, updated_by: who || null });
    }
    const { error } = await supabase.from('mjmnpayroll_month_locks')
      .upsert(rows, { onConflict: 'year,month' });
    if (!error) await load(supabase);
    return error;
  }

  /* "Lock All" is NOT an override of true on all twelve — that would freeze
     months whose own auto-lock date has not happened yet, which is the
     "write today's default into a saved row" mistake this system warns
     against everywhere else. It clears the override back to the computed
     default, which already means "locked if its date has passed". */
  async function clearManualOverrideForYear(supabase, year, who) {
    const rows = [];
    for (let month = 1; month <= 12; month++) {
      rows.push({ year, month, manual_override: null, updated_by: who || null });
    }
    const { error } = await supabase.from('mjmnpayroll_month_locks')
      .upsert(rows, { onConflict: 'year,month' });
    if (!error) await load(supabase);
    return error;
  }

  /* Effective from now onward. Written against the CURRENT calendar month, so
     changing it twice in one month replaces rather than duplicates, and every
     earlier month keeps whatever already governed it. */
  async function setLockDay(supabase, day, who) {
    /* WHICH month it takes effect from is still the browser's date, and has
       to be: it is the month the person is sitting in, not a database fact.
       WHEN it was set is the database's. */
    const n = new Date();
    const { error } = await supabase.from('mjmnpayroll_lock_days')
      .upsert({ effective_year: n.getFullYear(), effective_month: n.getMonth() + 1,
                lock_day: day, updated_by: who || null },
              { onConflict: 'effective_year,effective_month' });
    if (!error) await load(supabase);
    return error;
  }

  async function verify(supabase, ym, sheet, scope, who) {
    const { error } = await supabase.from('mjmnpayroll_verifications')
      .upsert({ month: ym, sheet, scope: scope || '', verified_by: who || null },
              { onConflict: 'month,sheet,scope' });
    if (!error) await load(supabase);
    return error;
  }

  /* Taking a verification off is not "unverify" as a normal step — it is what
     Lock Controls does when a month has to be re-opened, and the screen asks
     for that permission before calling it. */
  async function unverify(supabase, ym, sheet, scope) {
    const { error } = await supabase.from('mjmnpayroll_verifications')
      .delete().eq('month', ym).eq('sheet', sheet).eq('scope', scope || '');
    if (!error) await load(supabase);
    return error;
  }

  /* Every verification of one month, for the Lock Controls screen to list
     what re-opening it would undo. */
  function verificationsFor(ym) {
    return vers.filter(v => v.month === ym);
  }

  global.MJMPayrollLock = {
    load, ready: () => ready,
    lockDayFor, currentLockDay, autoLockDateFor, lockRow,
    isMonthLocked, isMonthLockedStr, splitMonth,
    verificationOf, verificationsFor, isSheetLocked, lockReason,
    setManualOverride, setManualOverrideForYear, clearManualOverrideForYear,
    setLockDay, verify, unverify
  };
})(typeof window !== 'undefined' ? window : globalThis);
