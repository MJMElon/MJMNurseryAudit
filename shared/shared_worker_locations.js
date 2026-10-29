/* ════════════════════════════════════════════════════════════════════════
   WORKER LOCATIONS — where a section sits on the ground

   A worker is filed under a SECTION (PN, BNN, UNN1, …). A section sits in a
   LOCATION — Pre Nursery, Main Nursery, Estate — and the Main Nursery is
   more than one nursery, which is the only reason this file exists: the
   grouping is a fact about the company, and it was written down in two
   places that could disagree.

       scan/scan_workers.html        the Team Board's column headings
       scan/scan_system_setting.html the Location card

   There used to be a NON_LOCATION here holding Driver — a section that was
   not a place. It is gone: the Team Board is about where people work, and a
   driver belongs to the nursery he drives for. Driver survives as a ROLE,
   which is what it always described.

   Both read it from here now. A nursery added in Operation → Settings turns
   up under the right heading on both without either being edited.

   Locations RECOGNISE their sections rather than listing them. Naming would
   mean a UNN 3 created next year standing on its own until somebody
   remembered this file; a pattern takes it in.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* A nursery's code is its name with the spaces taken out: "UNN 1" files
     as UNN1, a new "UNN 3" as UNN3. A transcription, not a guess — the
     nurseries are named as codes with a space in them. */
  function code(name) {
    return String(name || '').replace(/\s+/g, '').toUpperCase();
  }

  /* The Main Nursery takes BNN and UNN with or without a number after it,
     so BNN, UNN1, UNN2 today and a BNN2 or a UNN3 the day somebody adds
     one. It used to name BNN exactly, which was true for as long as there
     was one Batu Niah — a second would have landed under "Not in a
     location" on the Location card, with nothing saying why.
     UNE is not caught by it: the estate is UNE, not UNN.

     `maint` is WHETHER MAINTENANCE WORK IS DONE THERE, and it is a flag
     rather than a list of exceptions. The payroll used to ask "is this
     location not the estate", which is the shape of rule this system keeps
     getting caught by: it was right for exactly as long as the estate was
     the only place with no plots in it. Admin is the second, and a third
     added next year must not quietly become a nursery to be sprayed. */
  var LOCATIONS = [
    { key: 'pre',    name: 'Pre Nursery',  maint: true,
      match: function (c) { return c === 'PN'; } },
    { key: 'main',   name: 'Main Nursery', maint: true,
      match: function (c) { return /^(BNN|UNN)\d*$/.test(c); } },
    { key: 'estate', name: 'Estate',       maint: false,
      match: function (c) { return c === 'UNE'; } },
    /* The office, and anybody else who works for the company rather than at
       a nursery. Not a place with plots in it, so nobody filed here is on a
       maintenance sheet or a piece-rate claim — same standing as the estate,
       and for the same reason. It comes last because the board reads left to
       right from the seedlings outwards.

       IT IS CALLED OTHERS AND NOT ADMIN, because admin is a JOB. It was
       ADMIN for a day, which put a place and a role under one word: the
       Team Board now has an Admin ROW, and a column headed Admin beside it
       would have been the same word answering two questions.
       `shared/RUN_ME_worker_section_others.sql` moved the two people who
       were filed under the old code. */
    { key: 'others', name: 'Others',       maint: false,
      match: function (c) { return c === 'OTHERS'; } }
  ];

  /* The nursery sections the register has always used. operation_nurseries
     does not necessarily carry all of them, and a section missing while
     people are still filed under it is a hole in the register. */
  var KEEP_NURSERIES = [
    { code: 'PN',   name: 'PN — Pre Nursery'  },
    { code: 'BNN',  name: 'BNN — Batu Niah'   },
    { code: 'UNN1', name: 'UNN1 — Ulu Niah 1' },
    { code: 'UNN2', name: 'UNN2 — Ulu Niah 2' }
  ];

  /* The sections that are NOT nurseries, so operation_nurseries will never
     hand them over and every screen has to add them itself. The Team Board
     and the Location card each kept their own copy of that, which is to say
     each kept the word UNE written down separately — and adding Admin to
     one of them would have put a column on the board that the card reported
     as "Not in a location". One list, read by both. */
  var OFF_NURSERY = [
    { code: 'UNE',    name: 'UNE'    },
    { code: 'OTHERS', name: 'Others' }
  ];

  function locationOf(c) {
    for (var i = 0; i < LOCATIONS.length; i++) {
      if (LOCATIONS[i].match(c)) return LOCATIONS[i];
    }
    return null;
  }

  /* Sort the codes given into locations, in the order above, and hand back
     whatever matched none of them. Nothing is dropped: a caller that shows
     only the locations would hide a section, and a section nobody can see
     is one nobody fixes. */
  function group(codes) {
    var used = {}, out = LOCATIONS.map(function (loc) {
      var mine = codes.filter(function (c) {
        if (used[c] || !loc.match(c)) return false;
        used[c] = true;
        return true;
      });
      return { key: loc.key, name: loc.name, codes: mine };
    });
    return { locations: out, unplaced: codes.filter(function (c) { return !used[c]; }) };
  }

  /* Is maintenance work done in the section this code names?

     A code in NO location answers NO, which is what the payroll has always
     done with one and is deliberately kept: the claim offers a nursery to
     be ticked and signed, and offering one this file cannot place is
     offering a sheet nobody can reconcile. It shows on the Location card
     under "Not in a location" instead, which is where somebody can see it
     and say what it is. */
  function isMaintSection(c) {
    var loc = locationOf(c);
    return !!loc && loc.maint !== false;
  }

  global.MJMWorkerLocations = {
    code: code,
    locationOf: locationOf,
    isMaintSection: isMaintSection,
    group: group,
    LOCATIONS: LOCATIONS,
    KEEP_NURSERIES: KEEP_NURSERIES,
    OFF_NURSERY: OFF_NURSERY
  };
})(window);
