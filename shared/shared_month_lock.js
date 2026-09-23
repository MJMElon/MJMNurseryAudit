// shared_month_lock.js — one lock calendar for Delivery Orders, Approval
// Letters and Batch Record. Change one copy of this file, every page that
// includes it (<script src="../shared/shared_month_lock.js">) picks it up.
//
// A month auto-locks on the Nth of the following month, N being the
// "lock day" set in System Settings → Delivery Order, AL & Batch Record
// Lock (day 2 — the original hardcoded value — until anyone changes it).
// Changing the lock day only steers months from the point of change
// onward; months already past keep whichever day was in force for them
// at the time, so re-opening today's setting never rewrites how already
// -elapsed months got locked. This is `dayHistory`: each entry says "from
// this (year, month) onward, the lock day is this" and the most recent
// entry at or before a given month wins.
//
// A manual override beats the auto-lock computation entirely, in either
// direction: an admin can force a month open past its auto-lock date, or
// force one locked early. null/absent means "use the computed default" —
// same "access fails open" rule this system follows elsewhere: nobody has
// to visit this screen for a month to behave exactly as its default says.
(function (global) {
    let rows = [];
    let dayHistory = [];

    const DEFAULT_LOCK_DAY = 2;

    function sortDayHistory() {
        dayHistory.sort((a, b) => (a.effective_year - b.effective_year) || (a.effective_month - b.effective_month));
    }

    // The lock day in force for `year`/`month`'s own data — the latest
    // history entry whose effective point is at or before it, else the
    // system default.
    function autoLockDayFor(year, month) {
        const target = year * 12 + month;
        let day = DEFAULT_LOCK_DAY;
        for (const h of dayHistory) {
            if ((h.effective_year * 12 + h.effective_month) <= target) day = h.lock_day;
        }
        return day;
    }

    // The lock day currently in effect "as of right now" — what the day
    // selector next to Year shows, and the value a change is made against.
    function currentLockDay() {
        const now = new Date();
        return autoLockDayFor(now.getFullYear(), now.getMonth() + 1);
    }

    // month is 1-based (Jan=1). JS Date's 0-based month index for the
    // NEXT calendar month equals this month's own 1-based number, so
    // `new Date(year, month, day)` (month left as the 1-based value) lands
    // on the `day`th of the month after it — no +1/-1 juggling needed.
    function defaultAutoLockDate(year, month) {
        return new Date(year, month, autoLockDayFor(year, month));
    }

    async function load(supabase) {
        try {
            const [lockRes, dayRes] = await Promise.all([
                supabase.from('shared_month_locks').select('*'),
                supabase.from('shared_month_lock_day_settings').select('*')
            ]);
            if (lockRes.error) throw lockRes.error;
            if (dayRes.error) throw dayRes.error;
            rows = lockRes.data || [];
            dayHistory = dayRes.data || [];
            sortDayHistory();
        } catch (e) {
            // Table(s) not created yet, or a load error — same as no rows:
            // every month falls back to its computed default.
            rows = [];
            dayHistory = [];
        }
    }

    function rowFor(year, month) {
        return rows.find(r => r.year === year && r.month === month) || null;
    }

    function autoLockDateFor(year, month) {
        return defaultAutoLockDate(year, month);
    }

    function isMonthLocked(year, month) {
        const row = rowFor(year, month);
        if (row && row.manual_override !== null && row.manual_override !== undefined) return row.manual_override;
        return new Date() >= autoLockDateFor(year, month);
    }

    // The one function DO/AL/Batch Record actually call: is the record
    // dated `dateStr` (any parseable date/timestamp string) locked right
    // now? No date at all is never locked — there's nothing to place on
    // the calendar.
    function isDateLocked(dateStr) {
        if (!dateStr) return false;
        const d = new Date(dateStr);
        if (isNaN(d)) return false;
        return isMonthLocked(d.getFullYear(), d.getMonth() + 1);
    }

    async function setManualOverride(supabase, year, month, locked, updatedBy) {
        const { error } = await supabase.from('shared_month_locks')
            .upsert({ year, month, manual_override: locked, updated_at: new Date().toISOString(), updated_by: updatedBy || null }, { onConflict: 'year,month' });
        if (!error) await load(supabase);
        return error;
    }

    // Changes the lock day effective from "right now" onward. Writes/
    // updates the history entry for the CURRENT calendar month — if one
    // was already made this month, it's replaced rather than duplicated,
    // so flipping the selector twice in the same month doesn't leave two
    // competing entries. Earlier months keep whatever entry (or default)
    // already governed them.
    async function setLockDay(supabase, day, updatedBy) {
        const now = new Date();
        const effective_year = now.getFullYear();
        const effective_month = now.getMonth() + 1;
        const { error } = await supabase.from('shared_month_lock_day_settings')
            .upsert({ effective_year, effective_month, lock_day: day, updated_at: now.toISOString(), updated_by: updatedBy || null }, { onConflict: 'effective_year,effective_month' });
        if (!error) await load(supabase);
        return error;
    }

    global.MJMMonthLock = {
        load, isMonthLocked, isDateLocked, rowFor, autoLockDateFor, defaultAutoLockDate,
        autoLockDayFor, currentLockDay, setManualOverride, setLockDay
    };
})(window);
