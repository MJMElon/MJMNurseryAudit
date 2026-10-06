/* ══════════════════════════════════════════════════════════════════════════
   A WORKER IS THE REGISTER ROW, NOT THE NAME ON IT

   The Worker Record stores its ticks keyed by NAME —
   nops_maint_payroll.data is { recordId: { "Andi Rosmini": 1 } } — because
   that is what a column header is. Then somebody corrects a name on the
   payroll register and every tick ever made under the old spelling is
   orphaned: the sheet has no column for it, the capacity drops out of the
   totals, and the salary claim stops paying it. Nothing is deleted and
   nothing says a word.

   It has happened: "Fauzan" was registered first and later corrected to
   "Muhamad Fauzan". Same person, same register row, same id — the office
   edited the row rather than making a second one. But every tick saved
   before the correction still says "Fauzan", so his earlier months read as
   a different worker who no longer exists.

   THE REGISTER ROW IS THE PERSON. mjmnpayroll_workers.id is a BIGSERIAL and
   an edit keeps it, whatever is done to the name, the PIN, the bank account
   or the role. So the row carries the names it has ever been known by —
   previous_names, appended by a database trigger so it is recorded no matter
   WHICH screen does the editing, including a hand edit in Supabase — and any
   of those names resolves to that row.

   Two things to know:

   · MATCHING IS ON LETTERS AND DIGITS, UPPERCASE, the same rule every other
     crossing of this boundary uses (nurseryKey / plotKey). "Lalu Aenal
     mashuri" and "Lalu Aenal Mashuri" were always one person; this only adds
     the names the register itself remembers.

   · A NAME THAT RESOLVES TO TWO ROWS RESOLVES TO NEITHER. If two people have
     genuinely shared a spelling, picking one would move somebody's money to
     somebody else. It is left unresolved and shows on the sheet as a name
     with no column, which is the thing the office needs to see.

   Used by the Work Maintenance page and by the payroll salary claim. It is
   one file rather than a rule written twice, because the two dividing one
   plot's quantity among different numbers of people is exactly the fault
   this is here to stop.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* Same key as everywhere else this boundary is crossed. It cannot merge two
     different people: two names differing by a letter or a digit give
     different keys. */
  const nameKey = (v) => String(v == null ? '' : v).replace(/[^a-z0-9]/gi, '').toUpperCase();

  /* Every name a register row has ever been known by. previous_names may be a
     JSONB array, a Postgres text[] handed over as an array, or absent on a
     database that has not had the migration yet — all three read. */
  function namesOf(row) {
    const out = [];
    if (!row) return out;
    const cur = String(row.full_name == null ? '' : row.full_name).trim();
    if (cur) out.push(cur);
    const prev = row.previous_names;
    if (Array.isArray(prev)) {
      prev.forEach((p) => {
        const s = String(p == null ? '' : p).trim();
        if (s) out.push(s);
      });
    }
    return out;
  }

  /* name key -> the register row, for every name every row has ever had.
     A key claimed by more than one ROW is dropped: see the note above. */
  function index(rows) {
    const byKey = new Map();
    const clash = new Set();
    (rows || []).forEach((row) => {
      if (!row) return;
      const seen = new Set();
      namesOf(row).forEach((n) => {
        const k = nameKey(n);
        if (!k || seen.has(k)) return;
        seen.add(k);
        const had = byKey.get(k);
        // The same row under two spellings is still one row, not a clash.
        if (had && had.id !== row.id) { clash.add(k); return; }
        byKey.set(k, row);
      });
    });
    clash.forEach((k) => byKey.delete(k));
    return byKey;
  }

  /* What this name is called TODAY. Anything the register cannot place comes
     back exactly as it went in, so an unknown name is still shown and still
     reported rather than quietly becoming somebody else. */
  function canonical(idx, name) {
    const row = idx && idx.get(nameKey(name));
    if (!row) return String(name == null ? '' : name).trim();
    return String(row.full_name == null ? '' : row.full_name).trim();
  }

  /* Rewrite one record's tick cell so its keys are today's names.

     MERGING MATTERS: a row can carry BOTH "Fauzan" and "Muhamad Fauzan" if
     somebody re-ticked it after the rename. They are one person and must
     become one tick, not two — two would divide the plot among one more
     worker than did the work and quietly cut everybody else's share.

     A tick made on this page is 1 and a tick from the field is 'field'; where
     the two meet, the HAND one wins, because applyFieldRecords already treats
     any hand tick on a row as the answer. */
  function canonicalCells(idx, cells) {
    const out = {};
    Object.keys(cells || {}).forEach((name) => {
      const v = cells[name];
      if (!v) return;
      const to = canonical(idx, name) || name;
      if (!(to in out)) { out[to] = v; return; }
      if (out[to] === 'field' && v !== 'field') out[to] = v;
    });
    return out;
  }

  /* The whole store for one sheet: { recordId: { worker: 1 } }.
     Returns a NEW object and says whether anything actually moved, so a
     caller can decide to save rather than writing on every page load. */
  function canonicalStore(idx, store) {
    const out = {};
    let moved = 0;
    Object.keys(store || {}).forEach((recId) => {
      const before = store[recId] || {};
      const after = canonicalCells(idx, before);
      const a = Object.keys(before).sort().join('|');
      const b = Object.keys(after).sort().join('|');
      if (a !== b) moved++;
      out[recId] = after;
    });
    return { store: out, moved };
  }

  global.MJMMaintWorkers = { nameKey, namesOf, index, canonical, canonicalCells, canonicalStore };
})(typeof window !== 'undefined' ? window : globalThis);
