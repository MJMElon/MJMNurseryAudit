/* =====================================================================
   WHAT IS STANDING IN EACH TRAY

   One rule, two screens. The batch report uses it to decide how much may
   still be planted into a tray on the form in front of you; the batch
   list's Tray Status tab uses it to show the same trays from the other
   side — how full each one is and whose seedlings are in it.

   It lived inside operation_batch_detail.html's initDetail and was about
   to be copied into operation_batch_record.html. A copied rule is two
   rules the moment somebody fixes one of them, and a tray reading 1,200
   vacant on one page and 2,560 on the other is exactly the kind of thing
   nobody notices until a planting is refused.

   Nothing here touches the network or the DOM: hand it rows, get maps
   back. That is what makes it testable without the database.
   ===================================================================== */
(function (global) {
    'use strict';

    // A tray holds what Settings says it holds. Before that field existed
    // every tray was assumed to be 2,560, so a tray with no size keeps that
    // figure rather than reading as having no room at all.
    const DEFAULT_CAPACITY = 2560;

    function capacityOf(tray) {
        const n = Number(tray && tray.total_vacant);
        return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAPACITY;
    }

    /* Which tray a transplant log LEFT. The destination is plot_name; the
       source is written into the remark when the movement is saved.

       This is the SAME pattern the batch report's saved-transplant table
       parses for its Source Tray column (operation_batch_detail.html —
       change one, change the other). It used to ask for "from tray [X]",
       the exact wording today's save writes, and older logs word it
       differently: the screen showed P6 in the Source Tray column while
       this read nothing at all, so P6's holes never came back. Whatever
       the table can read, this reads. */
    function sourceTrayOf(log) {
        const m = String((log && log.remark) || '').match(/tray \[([^\]]+)\]/i);
        return m ? m[1].trim() : '';
    }

    /**
     * compute({ trays, planted, transplanted, cull1 })
     *
     *   trays         operation_trays rows        (tray_name, nursery_name, total_vacant)
     *   planted       Planted logs                (plot_name IS the tray, batch_name, quantity_change)
     *   transplanted  Transplanted / _Premium / _DoubleTone logs, WITH remark
     *   cull1         1st_Culling logs            (plot_name IS the tray)
     *
     * → { capacity, occupied, vacant, usage, byBatch, rows }
     */
    function compute(input) {
        const trays        = (input && input.trays)        || [];
        const planted      = (input && input.planted)      || [];
        const transplanted = (input && input.transplanted) || [];
        const cull1        = (input && input.cull1)        || [];

        const trayNames = new Set(trays.map(t => t.tray_name));

        /* ── What went in and what came out ──────────────────────────────
           Every movement is counted twice: once against the BATCH, which
           is the authority on how many seedlings it still has standing in
           pre-nursery, and once against the TRAY, which says where they
           are standing. The two are kept apart on purpose — see below. */
        const insByBatch = {};          // batch → total that entered a tray
        const outsByBatch = {};         // batch → total that left pre-nursery
        const netByTrayBatch = {};      // tray → batch → in − out, trays we know

        const addBatch = (map, batch, qty) => { if (batch) map[batch] = (map[batch] || 0) + qty; };
        const addTray = (tray, batch, qty) => {
            if (!trayNames.has(tray) || !batch) return;
            (netByTrayBatch[tray] = netByTrayBatch[tray] || {})[batch] =
                (netByTrayBatch[tray][batch] || 0) + qty;
        };

        // Planted — plot_name IS the tray.
        planted.forEach(l => {
            const qty = Math.abs(l.quantity_change || 0);
            if (!trayNames.has(l.plot_name)) return;
            addBatch(insByBatch, l.batch_name, qty);
            addTray(l.plot_name, l.batch_name, qty);
        });

        // 1st Culling — plot_name IS the tray, and they leave for good.
        cull1.forEach(l => {
            const qty = Math.abs(l.quantity_change || 0);
            addBatch(outsByBatch, l.batch_name, qty);
            addTray(l.plot_name, l.batch_name, -qty);
        });

        /* Transplanting — the seedlings leave a tray whatever the remark
           says. The remark names WHICH tray; the row itself proves that
           they went. Premium Care and Double-Tone are trays of their own,
           so a movement into one of those arrives in a tray. */
        transplanted.forEach(l => {
            const qty = Math.abs(l.quantity_change || 0);
            addBatch(outsByBatch, l.batch_name, qty);
            const src = sourceTrayOf(l);
            if (src) addTray(src, l.batch_name, -qty);
            if (trayNames.has(l.plot_name)) {
                addBatch(insByBatch, l.batch_name, qty);
                addTray(l.plot_name, l.batch_name, qty);
            }
        });

        /* ── A TRAY HOLDS NO MORE THAN THE BATCH STILL HAS ───────────────
           Transplant 2,727 out of P6 and P6 gives back 2,727 the moment
           the record is saved. It did not, and trays P4–P7 sat occupied on
           a batch that had been emptied into the field a year earlier,
           because the only thing emptying a tray was a remark worded the
           way today's save words it. Older rows say it differently, and
           some say nothing at all.

           So the batch's own arithmetic decides, not the wording:

               standing = everything that entered its trays
                        − everything that left pre-nursery

           A batch that has moved it all out is standing at nought and
           holds no tray, whatever any remark does or does not say. The
           remark only decides WHICH of its trays the remainder is in — and
           where it cannot, the shortfall comes off its trays anyway, so
           the nursery's free holes are right even when one tray's share of
           them is a guess. */
        const held = {};   // tray → batch → seedlings actually standing there
        const batches = new Set(Object.keys(insByBatch).concat(Object.keys(outsByBatch)));
        batches.forEach(batch => {
            const standing = Math.max(0, (insByBatch[batch] || 0) - (outsByBatch[batch] || 0));
            const mine = [];
            Object.keys(netByTrayBatch).forEach(tray => {
                const n = netByTrayBatch[tray][batch] || 0;
                if (n > 0) mine.push({ tray: tray, qty: n });
            });
            let sum = mine.reduce((s, r) => s + r.qty, 0);
            if (sum > standing) {
                // Take the difference off, largest tray first, so the parts
                // add up to the whole the batch says it has.
                let over = sum - standing;
                mine.sort((a, b) => b.qty - a.qty);
                for (const r of mine) {
                    if (over <= 0) break;
                    const cut = Math.min(r.qty, over);
                    r.qty -= cut; over -= cut;
                }
            }
            mine.forEach(r => {
                if (r.qty <= 0) return;
                (held[r.tray] = held[r.tray] || {})[batch] = r.qty;
            });
        });

        const capacity = {}, occupied = {}, vacant = {}, usage = {}, byBatch = {};
        const rows = [];
        trays.forEach(t => {
            const name = t.tray_name;
            const cap = capacityOf(t);
            capacity[name] = cap;

            const split = Object.keys(held[name] || {})
                .map(b => ({ batch: b, qty: held[name][b] }))
                .sort((a, b) => b.qty - a.qty || String(a.batch).localeCompare(String(b.batch)));
            let inUse = Math.min(cap, split.reduce((s, r) => s + r.qty, 0));

            // Whoever has the most in it is "the" batch holding the tray, for
            // the screens that can only name one.
            const occupier = split.length ? split[0].batch : '';

            byBatch[name]   = split;
            usage[name]     = occupier;
            occupied[name]  = { batch: occupier, qty: inUse };
            vacant[name]    = Math.max(0, cap - inUse);

            rows.push({
                tray: name,
                nursery: t.nursery_name || '',
                capacity: cap,
                occupied: inUse,
                vacant: vacant[name],
                batch: occupier,
                batches: split
            });
        });

        rows.sort((a, b) =>
            (a.nursery || '').localeCompare(b.nursery || '')
            || (a.tray || '').localeCompare(b.tray || '', undefined, { numeric: true, sensitivity: 'base' }));

        return { capacity, occupied, vacant, usage, byBatch, rows };
    }

    global.MJMTrayStock = { DEFAULT_CAPACITY, capacityOf, sourceTrayOf, compute };
})(typeof window !== 'undefined' ? window : globalThis);
