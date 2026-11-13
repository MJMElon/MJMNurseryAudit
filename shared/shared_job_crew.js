/* ════════════════════════════════════════════════════════════════════════
   WHO IS ON EACH JOB — the worker list a Worker Activity sheet is drawn from

   A Worker Activity sheet has a column per worker. Those columns used to be
   ONE answer per nursery: the nursery's general workers off the payroll
   register, the same list for P & D, Manuring, Weeding, Interrow, Loading
   and Transplanting. The office asked for it to be a SETTING —

     "I drag the BNN-Worker to PxD part. So the worker activity for pxd
      worker name list will show all BNN worker name."

   — so a job can be given more people than the nursery's own general
   workers (its Field Conductor, the UNE crew that comes over to spray),
   or fewer.

   A GROUP IS A CELL OF THE NURSERY TEAM BOARD: a section and a role,
   "BNN|General Worker". That is the unit the office already sees and
   already drags people between, so a group here means exactly what the
   board shows in that cell, and moving a person on the board moves them
   here with nothing re-keyed.

   ONLY THE GROUPS ARE STORED, NEVER THE NAMES. A name list would have to
   be kept in step with the register by hand, which is how a worker hired
   in December ends up on no sheet.

   AN ABSENT ANSWER IS NOBODY HAVING BEEN ASKED. A (nursery, job) with
   nothing keyed reads exactly what it read before this existed — the
   caller keeps its own list for that case and this file is not asked.

   SHARED RULE. Read by nursery_ops/plot_maintenance_script.js (the sheet)
   and npayroll/npayroll_script.js (the claim that prices the sheet). Two
   readers answering differently is one plot divided among different
   numbers of people on the sheet and on the claim, so both come here.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var PREFIX = 'job_crew:';
  /* The jobs whose columns come off the register. Seed Planting keeps a
     hand-picked list of its own and Culling Monitoring pays named people
     off its own rule, so neither is in it. */
  var JOBS = ['pd', 'manuring', 'weeding', 'interrow', 'loading_seedlings', 'transplanting'];

  /* The Team Board's rows, in its order and with its words. A third copy:
     BOARD_ROLES in scan/scan_workers.html is the original. Change one,
     change the other. */
  var ROLES = [
    { key: 'Estate Manager',            label: 'Estate Manager' },
    { key: 'Admin',                     label: 'Admin' },
    { key: 'Field Conductor',           label: 'FC' },
    { key: 'Assistant Field Conductor', label: 'Assistant FC' },
    { key: 'Water Pump Operator',       label: 'Water Pump Operator' },
    { key: 'General Worker',            label: 'Workers' },
    { key: 'Gardener',                  label: 'Gardener' },
    { key: 'Driver',                    label: 'Driver' }
  ];
  var GENERAL = 'General Worker';
  var DEFAULT = 'default';

  function key(x) { return String(x == null ? '' : x).replace(/[^a-z0-9]/gi, '').toUpperCase(); }
  function roleOf(r) { return String((r && (r.role || r.job_title)) || '').trim(); }

  function group(section, role) { return key(section) + '|' + role; }
  function splitGroup(g) {
    var s = String(g || ''), i = s.indexOf('|');
    if (i <= 0) return null;
    var section = key(s.slice(0, i)), role = s.slice(i + 1).trim();
    var hit = ROLES.filter(function (x) { return x.key.toLowerCase() === role.toLowerCase(); })[0];
    return (section && hit) ? { section: section, role: hit.key } : null;
  }
  function roleLabel(role) {
    var hit = ROLES.filter(function (x) { return x.key === role; })[0];
    return hit ? hit.label : role;
  }

  function configKey(nursery, job) { return PREFIX + key(nursery) + ':' + job; }

  /* What is stored: the groups, comma separated. An EMPTY string is an
     answer (nobody), which is different from no row at all (not asked). */
  function parse(txt) {
    var seen = {}, out = [];
    String(txt == null ? '' : txt).split(',').forEach(function (p) {
      var g = splitGroup(p);
      if (!g) return;
      var k = group(g.section, g.role);
      if (seen[k]) return;
      seen[k] = 1; out.push(k);
    });
    return out;
  }
  function serialise(list) { return parse((list || []).join(',')).join(','); }

  /* nops_maint_config rows → { 'BNN:pd': ['BNN|General Worker', …] },
     holding ONLY what is keyed. */
  function readConfig(rows) {
    var out = {};
    (rows || []).forEach(function (r) {
      var k = String((r && r.key) || '');
      if (k.indexOf(PREFIX) !== 0) return;
      var rest = k.slice(PREFIX.length), i = rest.indexOf(':');
      if (i <= 0) return;
      var n = key(rest.slice(0, i)), job = rest.slice(i + 1);
      if (JOBS.indexOf(job) < 0) return;
      /* DEFAULT is a cell somebody saved as it stood — written so a save
         never has to delete a row, and read as nobody having been asked. */
      if (String(r.txt_value == null ? '' : r.txt_value).trim().toLowerCase() === DEFAULT) return;
      out[n + ':' + job] = parse(r.txt_value);
    });
    return out;
  }

  /* THE REGISTER ROWS ONE GROUP STANDS FOR.

     Workers is the page's OWN general-worker rule, handed in, not a role
     test — the per-worker switch and the unlabelled-nursery fallback are
     part of what "Workers" has always meant on these sheets, and a second
     reading of it here would make "BNN · Workers" a different list from
     the one BNN's sheet showed yesterday. Every other row is the role,
     exactly, which is how the board files it.

     Leavers are returned too: whether somebody belongs on a month is the
     caller's month rule, asked after this. */
  function rowsOf(register, g, opts) {
    var grp = typeof g === 'string' ? splitGroup(g) : g;
    if (!grp) return [];
    var secOf = (opts && opts.sectionKey) || function (r) { return key(r.section) || key(r.nursery); };
    var mine = (register || []).filter(function (r) {
      return secOf(r) === grp.section && String((r && r.full_name) || '').trim();
    });
    if (grp.role === GENERAL) {
      var named = mine.some(function (r) {
        return r.active !== false && /^general\s*worker$|pekerja am|buruh am/i.test(roleOf(r));
      });
      var isGen = opts && opts.isGeneral;
      return mine.filter(function (r) {
        var asIfHere = Object.assign({}, r, { active: true });
        return isGen ? isGen(asIfHere, named) : /^general\s*worker$/i.test(roleOf(r));
      });
    }
    var want = grp.role.toLowerCase();
    return mine.filter(function (r) { return roleOf(r).toLowerCase() === want; });
  }

  /* Every group's rows together: one row per NAME (a person in two groups
     is one column, never two), sorted the way the sheets always have been. */
  function crewRows(register, groups, opts) {
    var seen = {}, out = [];
    (groups || []).forEach(function (g) {
      rowsOf(register, g, opts).forEach(function (r) {
        var k = String(r.full_name).trim().toLowerCase();
        if (seen[k]) return;
        seen[k] = 1; out.push(r);
      });
    });
    return out.sort(function (a, b) { return String(a.full_name).localeCompare(String(b.full_name)); });
  }

  /* The cells of the board somebody could drag: every section the register
     files people under, crossed with every role, where the cell holds at
     least one person who is still here. */
  function groupsOnRegister(register, opts) {
    var secOf = (opts && opts.sectionKey) || function (r) { return key(r.section) || key(r.nursery); };
    var sections = [];
    (register || []).forEach(function (r) {
      var s = secOf(r);
      if (s && sections.indexOf(s) < 0) sections.push(s);
    });
    var out = [];
    sections.forEach(function (s) {
      ROLES.forEach(function (role) {
        var rows = rowsOf(register, { section: s, role: role.key }, opts)
          .filter(function (r) { return r.active !== false; });
        if (rows.length) out.push({ group: group(s, role.key), section: s, role: role.key, count: rows.length });
      });
    });
    return out;
  }

  global.MJMJobCrew = {
    PREFIX: PREFIX, JOBS: JOBS, ROLES: ROLES, GENERAL: GENERAL, DEFAULT: DEFAULT,
    key: key, group: group, splitGroup: splitGroup, roleLabel: roleLabel,
    configKey: configKey, parse: parse, serialise: serialise, readConfig: readConfig,
    rowsOf: rowsOf, crewRows: crewRows, groupsOnRegister: groupsOnRegister
  };
})(typeof window !== 'undefined' ? window : globalThis);
