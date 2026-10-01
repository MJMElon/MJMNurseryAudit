/* ══════════════════════════════════════════════════════════════════════════
   A PERSON'S NAME, NOT THEIR EMAIL ADDRESS

   Every "by <person>" on a screen — who verified a sheet, who edited a row,
   who approved a calibration — is stored as an email, because that is what
   identifies an account. It should not be DISPLAYED as one: a payroll sheet
   signed "esther.wong.szeqi@mjmnursery.com" is harder to read than one
   signed "Esther Wong Sze Qi", and it puts a working address on every
   printed form that leaves the office.

   Names come from shared_profiles, read once per page. An email with no
   profile row falls back to the part before the @, which is a worse name
   but still a name. THE STORED ROW NEVER CHANGES — only the display.

   FAILS OPEN, like every other read in this system: a table that is not
   there, or a read that fails, leaves name() handing back what it was
   given. Nobody is stopped from reading a sheet because a lookup table
   was unavailable.

   SHARED RULE — operation_batch_detail.html carries its own copy as
   mjmWho()/mjmLoadNames(), written before this file existed. Same table,
   same fallback. Change one, change the other.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const byEmail = {};
  let loading = null;
  let ready = false;

  function load(supabase) {
    if (loading) return loading;
    if (!supabase) return Promise.resolve();
    loading = supabase.from('shared_profiles').select('email, full_name')
      .then(({ data, error }) => {
        if (error) return;
        (data || []).forEach(p => {
          if (p && p.email && p.full_name) {
            byEmail[String(p.email).trim().toLowerCase()] = String(p.full_name).trim();
          }
        });
        ready = true;
      }, () => {});
    return loading;
  }

  /* The name to show for a stored value. Anything that is not an email
     address is already a name and is handed straight back. */
  function name(v) {
    if (!v) return '';
    const s = String(v).trim();
    if (!s.includes('@')) return s;
    return byEmail[s.toLowerCase()] || s.split('@')[0];
  }

  global.MJMPeople = { load, name, ready: () => ready };
})(typeof window !== 'undefined' ? window : globalThis);
