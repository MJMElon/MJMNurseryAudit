/* ══════════════════════════════════════════════════════════════════════
   NURSERY AUDIT — SYSTEM SETTING

   The second half of Settings (audit_user_access.html). User Access says
   who may do what; this says what the module asks for in the first place:

     • Rounds and schedule — how many times each audit runs in a month and
       on which days, per nursery scope. Add or remove rounds freely; a
       round is only a first and a last day.

     • Maintenance — not on a calendar. Its audits follow the work, so
       each work type carries the number of days an auditor has after the
       work was done. 0 means that work type raises no audit.

     • Batch ages — which ages, in whole months, are being audited. Tick
       the ages and the grids offer only the batches that match.

   Everything is stored in one JSON row (audit_settings) and read back by
   audit_settings.js, whose defaults are the behaviour that was hardcoded
   before this screen existed — so a database that has never been here
   behaves exactly as it always did.
   ══════════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {

  const SCOPE_LABEL = { MN: 'Main Nursery', PN: 'Pre Nursery' };
  const MOD_LABEL   = { plot: 'Plot Condition Audit', height: 'Seedling Height Audit', papan: 'Papan Tanda Audit' };
  const WT_LABEL    = {
    manuring: 'Manuring',
    weeding:  'Weeding',
    interrow: 'Interrow Spray',
    pd:       'P & D Spraying',
    other:    'Anything else'
  };
  const WT_NOTE = {
    pd: 'Left at 0 by default — pest and disease spraying is looked at in the plot condition audit.'
  };
  const MAX_AGE = 24;                       // 0…24 months of tick boxes

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* Working copy. Edited by the controls, written on Save. */
  let draft = null;
  let root  = null;
  let supa  = null;

  const html = `
<div id="ss-offline" class="hidden rounded-xl border border-rose-200 bg-rose-50 p-4">
  <div class="text-[12px] font-black text-rose-800 uppercase tracking-widest">The portal is not reading these settings</div>
  <p class="text-[12px] text-rose-800 mt-1.5 leading-relaxed">
    What is on this screen saves, but the auditor portal cannot read it back, so auditors
    still see the built-in schedule. Run <code class="font-bold">shared/create_audit_settings.sql</code>
    in the Supabase SQL Editor and reload this page.
  </p>
  <p id="ss-offline-why" class="text-[11px] text-rose-700 mt-2 font-mono break-all"></p>
</div>

<div class="card p-6 space-y-5">
  <div class="flex items-start justify-between gap-4 flex-wrap">
    <div>
      <h2 class="text-sm font-black text-slate-800 uppercase tracking-widest">Rounds &amp; Schedule</h2>
      <p class="text-[12px] text-slate-500 mt-1 leading-relaxed">
        How many times each audit runs in a month, and the days it is open.
        A round is a first and a last day — add as many as the work needs.
      </p>
    </div>
    <span id="ss-sched-note" class="text-[11px] font-bold text-slate-400"></span>
  </div>
  <div id="ss-schedule" class="space-y-5"></div>
</div>

<div class="card p-6 space-y-5">
  <div class="flex items-start justify-between gap-4 flex-wrap">
    <div>
      <h2 class="text-sm font-black text-slate-800 uppercase tracking-widest">Special Audits</h2>
      <p class="text-[12px] text-slate-500 mt-1 leading-relaxed">
        A one-off round, for when something happens between the scheduled ones.
        Pick the nursery, the day it has to be done by and the plots — it is on the
        auditor&rsquo;s To&nbsp;Do list the moment you save, and stays there until every
        plot is audited. It is a <strong>deadline, not a window</strong>, so nothing
        clears it but the work.
      </p>
    </div>
    <span id="ss-sp-note" class="text-[11px] font-bold text-slate-400"></span>
  </div>
  <div id="ss-special-list" class="space-y-2"></div>
</div>

<div class="card p-6 space-y-5">
  <div>
    <h2 class="text-sm font-black text-slate-800 uppercase tracking-widest">Maintenance Audit Window</h2>
    <p class="text-[12px] text-slate-500 mt-1 leading-relaxed">
      Maintenance is not on a calendar — its audits follow the work. For each type,
      how many days does an auditor have after the work was done?
      <strong>0 means that work raises no audit.</strong>
    </p>
  </div>
  <div id="ss-maint" class="grid grid-cols-1 sm:grid-cols-2 gap-3"></div>
</div>

<div class="card p-6 space-y-5">
  <div class="flex items-start justify-between gap-4 flex-wrap">
    <div>
      <h2 class="text-sm font-black text-slate-800 uppercase tracking-widest">Batch Age to Audit</h2>
      <p class="text-[12px] text-slate-500 mt-1 leading-relaxed">
        Tick the ages, in whole months, that are being audited. A batch's age is
        counted from the day it was planted — the same age the office's movement
        report prints. With nothing ticked no batch is offered, which is a way of
        pausing the audits rather than a mistake.
      </p>
    </div>
    <label class="flex items-center gap-2 text-[11px] font-black text-slate-600 uppercase tracking-widest whitespace-nowrap">
      <input type="checkbox" id="ss-age-all" class="w-4 h-4 accent-orange-500">
      All ages
    </label>
  </div>
  <div id="ss-ages" class="flex flex-wrap gap-2"></div>
</div>

<div class="flex flex-wrap items-center gap-3">
  <button id="ss-save" class="bg-orange-600 hover:bg-orange-700 text-white font-black text-[10px] uppercase tracking-widest px-6 py-3 rounded-xl">
    Save settings
  </button>
  <button id="ss-reset" class="bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-[10px] uppercase tracking-widest px-5 py-3 rounded-xl border border-slate-200">
    Back to defaults
  </button>
  <span id="ss-status" class="text-[11px] font-bold text-slate-500"></span>
</div>

<div class="card p-6 space-y-4">
  <div>
    <h2 class="text-sm font-black text-slate-800 uppercase tracking-widest">App &amp; Offline Copy</h2>
    <p class="text-[12px] text-slate-500 mt-1 leading-relaxed">
      This device keeps its own copy of the audit portal so it opens without a signal.
      If a screen looks out of date, update the copy here.
    </p>
  </div>
  <div class="rounded-xl border border-slate-200 bg-slate-50 divide-y divide-slate-200">
    <div class="flex items-center justify-between gap-4 px-4 py-3">
      <span class="text-[11px] font-black text-slate-500 uppercase tracking-widest">Copy on this device</span>
      <span id="sys-ver" class="text-[12px] font-bold text-slate-800 text-right break-all">Checking…</span>
    </div>
    <div class="flex items-center justify-between gap-4 px-4 py-3">
      <span class="text-[11px] font-black text-slate-500 uppercase tracking-widest">Offline pages held</span>
      <span id="sys-cached" class="text-[12px] font-bold text-slate-800">—</span>
    </div>
    <div class="flex items-center justify-between gap-4 px-4 py-3">
      <span class="text-[11px] font-black text-slate-500 uppercase tracking-widest">Connection</span>
      <span id="sys-online" class="text-[12px] font-bold text-slate-800">—</span>
    </div>
  </div>
  <div class="flex flex-wrap gap-3">
    <button id="sys-update" class="bg-slate-800 hover:bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest px-5 py-3 rounded-xl">
      Update the app now
    </button>
    <a href="audit_diagnostics.html" class="bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-[10px] uppercase tracking-widest px-5 py-3 rounded-xl border border-slate-200 no-underline">
      Open diagnostics
    </a>
  </div>
  <p class="text-[11px] text-slate-500 leading-relaxed">
    Updating clears the saved pages and reloads. Anything already recorded is safe —
    audits live in the database, and anything still waiting to sync stays queued on this device.
  </p>
</div>`;

  const $ = (id) => root.querySelector('#' + id);

  /* ── Rounds ─────────────────────────────────────────────────────── */
  function scheduleHtml() {
    return MJMAuditSettings.SCOPES.map(scope => `
      <div>
        <div class="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2">${esc(SCOPE_LABEL[scope])}</div>
        <div class="rounded-xl border border-slate-200 divide-y divide-slate-200 overflow-hidden">
          ${MJMAuditSettings.MODULES.map(mod => `
            <div class="p-4 bg-white">
              <div class="flex items-center justify-between gap-3 flex-wrap">
                <span class="font-black text-slate-800 text-[13px]">${esc(MOD_LABEL[mod])}</span>
                <span class="flex items-center gap-2">
                  <button class="ss-add text-[10px] font-black uppercase tracking-widest text-orange-700 bg-orange-50 border border-orange-200 rounded-full px-3 py-1.5"
                          data-scope="${scope}" data-mod="${mod}">+ Add round</button>
                  <button class="ss-sp-new text-[10px] font-black uppercase tracking-widest text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-3 py-1.5"
                          data-scope="${scope}" data-mod="${mod}"
                          title="A one-off audit, raised now">+ Special audit</button>
                </span>
              </div>
              <div class="mt-3 space-y-2" id="ss-rounds-${scope}-${mod}"></div>
            </div>`).join('')}
        </div>
      </div>`).join('');
  }

  function drawRounds() {
    MJMAuditSettings.SCOPES.forEach(scope => {
      MJMAuditSettings.MODULES.forEach(mod => {
        const box = $(`ss-rounds-${scope}-${mod}`);
        if (!box) return;
        const list = draft.schedule[scope][mod];
        box.innerHTML = list.length ? list.map((w, i) => `
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest w-16 shrink-0">Round ${i + 1}</span>
            <span class="text-[11px] font-bold text-slate-500">Day</span>
            <input type="number" min="1" max="31" value="${w[0]}" data-r="start" data-scope="${scope}" data-mod="${mod}" data-i="${i}"
                   class="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-bold text-center outline-none focus:border-orange-500">
            <span class="text-[11px] font-bold text-slate-500">to</span>
            <input type="number" min="1" max="31" value="${w[1]}" data-r="end" data-scope="${scope}" data-mod="${mod}" data-i="${i}"
                   class="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-bold text-center outline-none focus:border-orange-500">
            <button class="ss-del text-[10px] font-black uppercase tracking-widest text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-3 py-1.5"
                    data-scope="${scope}" data-mod="${mod}" data-i="${i}">Remove</button>
          </div>`).join('')
          : `<p class="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
               No round — this audit is not asked for in ${esc(SCOPE_LABEL[scope])}.
             </p>`;
      });
    });
    const n = MJMAuditSettings.SCOPES.reduce((s, sc) =>
      s + MJMAuditSettings.MODULES.reduce((k, m) => k + draft.schedule[sc][m].length, 0), 0);
    const note = $('ss-sched-note');
    if (note) note.textContent = n + ' round' + (n === 1 ? '' : 's') + ' in all';
  }

  /* ── Maintenance ────────────────────────────────────────────────── */
  function drawMaint() {
    $('ss-maint').innerHTML = MJMAuditSettings.WORKTYPES.map(wt => `
      <label class="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <span class="min-w-0">
          <span class="block font-black text-slate-800 text-[13px]">${esc(WT_LABEL[wt])}</span>
          ${WT_NOTE[wt] ? `<span class="block text-[11px] text-slate-500 mt-0.5 leading-snug">${esc(WT_NOTE[wt])}</span>` : ''}
        </span>
        <span class="flex items-center gap-2 shrink-0">
          <input type="number" min="0" max="365" value="${draft.maintenance[wt]}" data-wt="${wt}"
                 class="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-bold text-center outline-none focus:border-orange-500">
          <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">days</span>
        </span>
      </label>`).join('');
  }

  /* ── Ages ───────────────────────────────────────────────────────── */
  /* All ages is a shortcut, not a lock. Ticking it ticks every age;
     unticking one of them leaves the rest ticked and simply stops the
     set being "all". The stored value is still null for all, so nothing
     that reads the setting has to know about this. */
  const everyAge = () => Array.from({ length: MAX_AGE + 1 }, (_, m) => m);
  const pickedAges = () => new Set(draft.ages === null ? everyAge() : draft.ages);

  function drawAges() {
    const picked = pickedAges();
    $('ss-age-all').checked = picked.size === MAX_AGE + 1;
    $('ss-ages').innerHTML = Array.from({ length: MAX_AGE + 1 }, (_, m) => `
      <label class="ss-age inline-flex items-center gap-2 rounded-full border px-3 py-2 cursor-pointer ${
        picked.has(m) ? 'border-orange-300 bg-orange-50' : 'border-slate-200 bg-white'}">
        <input type="checkbox" data-age="${m}" ${picked.has(m) ? 'checked' : ''}
               class="w-4 h-4 accent-orange-500">
        <span class="text-[11px] font-black text-slate-700 whitespace-nowrap">${m} month${m === 1 ? '' : 's'}</span>
      </label>`).join('');
  }

  function draw() { drawRounds(); drawMaint(); drawAges(); }

  function status(msg, kind) {
    const el = $('ss-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'text-[11px] font-bold ' +
      (kind === 'err' ? 'text-rose-700' : kind === 'ok' ? 'text-emerald-700' : 'text-slate-500');
  }

  /* ── App & offline copy ─────────────────────────────────────────── */
  function mountApp() {
    const online = () => { const el = $('sys-online'); if (el) el.textContent = navigator.onLine ? 'Online' : 'Offline'; };
    online();
    window.addEventListener('online', online);
    window.addEventListener('offline', online);

    /* The version is the cache's own name — audit_sw.js opens one cache per
       build. Reading it back is how the device says which build it is
       actually serving, rather than which one the server has. */
    (async function () {
      const ver = $('sys-ver'), cached = $('sys-cached');
      try {
        if (!window.caches || !caches.keys) throw new Error('no cache API');
        const keys = (await caches.keys()).filter(k => k.indexOf('mjm-') === 0);
        if (ver) ver.textContent = keys.length ? keys.join(', ') : 'Not saved offline yet';
        if (cached) {
          if (!keys.length) { cached.textContent = '0 files'; return; }
          const all = await (await caches.open(keys[0])).keys();
          cached.textContent = all.length + ' file' + (all.length === 1 ? '' : 's');
        }
      } catch (_) {
        if (ver) ver.textContent = 'Not available on this browser';
        if (cached) cached.textContent = '—';
      }
    })();

    const btn = $('sys-update');
    if (btn) btn.addEventListener('click', async () => {
      if (!confirm('Update this device to the latest version?\n\nThe saved offline pages are cleared and the page reloads. Recorded audits are not affected.')) return;
      btn.disabled = true; btn.textContent = 'Updating…';
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister()));
        }
      } catch (_) { /* the caches matter more */ }
      try {
        if (window.caches && caches.keys) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
      } catch (_) {}
      location.replace(location.pathname + '?updated=' + Date.now());
    });
  }

  /* ── SPECIAL AUDITS ─────────────────────────────────────────────
     A one-off round. Everything above this is a monthly PATTERN; a
     special audit is one request with an absolute date, so it lives in
     its own table rather than in the settings JSON — a row can be
     withdrawn and still leave a record, which a key in a blob cannot.

     Withdrawing STAMPS cancelled_at rather than deleting. A request
     that was raised and then thought better of is a thing that
     happened, and the auditor may already have walked the plots. */
  const SP_TABLE = 'audit_special_audits';
  let specials = [];
  let spMissing = false;          // the table is not installed yet

  const todayISO = () => {
    /* Local, never toISOString(): that is the day before in Malaysia for
       the whole of the early morning, and this date decides which audits
       can answer the request. */
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
         + '-' + String(d.getDate()).padStart(2, '0');
  };
  const NUR_LABEL = { BNN: 'BNN', UNN1: 'UNN 1', UNN2: 'UNN 2', PN: 'PN' };
  const prettyDate = (v) => {
    const d = new Date(String(v).slice(0, 10) + 'T00:00:00');
    return isNaN(d) ? String(v)
      : d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  async function loadSpecials() {
    try {
      const res = await supa.from(SP_TABLE)
        .select('id,module,nursery,due_date,raised_on,all_plots,plots,note,created_by')
        .is('cancelled_at', null)
        .order('due_date', { ascending: true });
      if (res.error) throw res.error;
      specials = res.data || [];
      spMissing = false;
    } catch (e) {
      specials = [];
      spMissing = true;
      console.warn('[system-setting] special audits not read:', e.message || e);
    }
  }

  function drawSpecials() {
    const box = $('ss-special-list');
    if (!box) return;
    const note = $('ss-sp-note');
    if (note) note.textContent = spMissing ? 'table not installed'
      : specials.length + ' outstanding';

    if (spMissing) {
      box.innerHTML = `<p class="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        The special-audit table is not installed yet, so nothing can be raised.
        Run <code class="font-black">shared/RUN_ME_audit_special_audits.sql</code> in the
        Supabase SQL editor, then reload this page.</p>`;
      return;
    }
    if (!specials.length) {
      box.innerHTML = `<p class="text-[12px] font-bold text-slate-400">
        Nothing outstanding. Use <strong>+ Special audit</strong> above when one is needed.</p>`;
      return;
    }
    box.innerHTML = specials.map(r => {
      const late = String(r.due_date).slice(0, 10) < todayISO();
      const what = r.all_plots ? 'every plot'
        : ((r.plots || []).length + ' plot' + ((r.plots || []).length === 1 ? '' : 's'));
      return `
      <div class="flex items-center justify-between gap-3 flex-wrap rounded-xl border px-4 py-3 ${
        late ? 'border-rose-200 bg-rose-50' : 'border-violet-200 bg-violet-50'}">
        <div class="min-w-0">
          <div class="text-[13px] font-black text-slate-800">
            ${esc(MOD_LABEL[r.module] || r.module)}
            <span class="text-slate-500">· ${esc(NUR_LABEL[r.nursery] || r.nursery)}</span>
          </div>
          <div class="text-[11px] font-bold ${late ? 'text-rose-700' : 'text-violet-700'} mt-0.5">
            due ${esc(prettyDate(r.due_date))} · ${esc(what)}${late ? ' · overdue' : ''}
          </div>
          ${r.note ? `<div class="text-[11px] text-slate-500 mt-0.5">${esc(r.note)}</div>` : ''}
          ${r.all_plots ? '' : `<div class="text-[10px] font-bold text-slate-400 mt-1">${
            esc((r.plots || []).join(' · '))}</div>`}
        </div>
        <button class="ss-sp-drop text-[10px] font-black uppercase tracking-widest text-rose-700 bg-white border border-rose-200 rounded-full px-3 py-1.5"
                data-id="${r.id}">Withdraw</button>
      </div>`;
    }).join('');
  }

  /* The form. Built on demand and thrown away on close, so there is no
     half-filled dialog sitting in the DOM waiting to be reopened with
     last week's answers in it. */
  function openSpecialDialog(scope, mod) {
    const nurseries = MJMAuditSettings.nurseriesOf(scope);
    const wrap = document.createElement('div');
    wrap.id = 'ss-sp-dlg';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.55);'
                       + 'display:flex;align-items:center;justify-content:center;padding:16px';
    wrap.innerHTML = `
      <div style="background:#fff;border-radius:18px;max-width:560px;width:100%;
                  max-height:88vh;overflow:auto;padding:22px;
                  box-shadow:0 20px 60px rgba(15,23,42,.3)">
        <div class="text-sm font-black text-slate-800 uppercase tracking-widest">Special audit</div>
        <div class="text-[12px] text-slate-500 mt-1 mb-4">
          ${esc(MOD_LABEL[mod])} · ${esc(SCOPE_LABEL[scope])}
        </div>

        <label class="block text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1">Nursery</label>
        <select id="sp-nur" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold mb-4">
          ${nurseries.map(n => `<option value="${n}">${esc(NUR_LABEL[n] || n)}</option>`).join('')}
        </select>

        <label class="block text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1">Done by</label>
        <input id="sp-due" type="date" value="${todayISO()}" min="${todayISO()}"
               class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold mb-1">
        <p class="text-[11px] text-slate-400 mb-4">
          It shows on the To&nbsp;Do list straight away. This is the day it is due by,
          not the day it starts.
        </p>

        <label class="block text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1">Plots</label>
        <label class="flex items-center gap-2 text-[12px] font-bold text-slate-700 mb-2">
          <input id="sp-all" type="checkbox" class="w-4 h-4"> Every plot in the nursery
        </label>
        <div id="sp-plots" class="flex flex-wrap gap-1.5 mb-1"></div>
        <p id="sp-plots-note" class="text-[11px] text-slate-400 mb-4"></p>

        <label class="block text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1">Why (optional)</label>
        <input id="sp-note" type="text" maxlength="120" placeholder="Storm damage, pest report, HQ visit…"
               class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-5">

        <div class="flex items-center justify-end gap-2">
          <button id="sp-cancel" class="text-[10px] font-black uppercase tracking-widest text-slate-700 bg-slate-100 border border-slate-200 rounded-xl px-5 py-3">Cancel</button>
          <button id="sp-save" class="text-[10px] font-black uppercase tracking-widest text-white bg-violet-600 rounded-xl px-6 py-3">Raise it</button>
        </div>
        <p id="sp-err" class="text-[11px] font-bold text-rose-700 mt-3"></p>
      </div>`;
    document.body.appendChild(wrap);

    const q = (id) => wrap.querySelector('#' + id);
    const picked = new Set();

    function drawPlots() {
      const all = q('sp-all').checked;
      const list = MJMAuditSettings.plotsOf(q('sp-nur').value);
      q('sp-plots').style.display = all ? 'none' : '';
      q('sp-plots').innerHTML = all ? '' : list.map(p => `
        <button type="button" data-plot="${p}"
          class="sp-plot text-[11px] font-black rounded-full px-2.5 py-1 border ${
            picked.has(p) ? 'bg-violet-600 text-white border-violet-600'
                          : 'bg-white text-slate-600 border-slate-200'}">${p}</button>`).join('');
      q('sp-plots-note').textContent = all
        ? 'Every plot the nursery has work on, worked out when the auditor opens the list.'
        : (picked.size ? picked.size + ' picked' : 'Tap the plots that need walking.');
    }
    drawPlots();

    wrap.addEventListener('click', async (e) => {
      if (e.target === wrap || e.target.closest('#sp-cancel')) { wrap.remove(); return; }
      const chip = e.target.closest('.sp-plot');
      if (chip) {
        const p = chip.dataset.plot;
        if (picked.has(p)) picked.delete(p); else picked.add(p);
        drawPlots();
        return;
      }
      if (!e.target.closest('#sp-save')) return;

      const nursery = q('sp-nur').value;
      const due     = q('sp-due').value;
      const all     = q('sp-all').checked;
      const plots   = MJMAuditSettings.plotsOf(nursery).filter(p => picked.has(p));
      const err = (m) => { q('sp-err').textContent = m; };
      if (!due)                  return err('Pick the day it has to be done by.');
      if (due < todayISO())      return err('That day has gone. Pick today or later.');
      if (!all && !plots.length) return err('Pick at least one plot, or tick every plot.');

      const btn = q('sp-save');
      btn.disabled = true; btn.textContent = 'Saving…';
      err('');
      try {
        const me = (typeof MJMAccess !== 'undefined' && MJMAccess.user()) || null;
        const res = await supa.from(SP_TABLE).insert({
          module: mod, nursery: nursery, due_date: due,
          /* The day it was RAISED, which is what stops an audit from last
             month quietly answering a request made this morning. */
          raised_on: todayISO(),
          all_plots: all, plots: all ? [] : plots,
          note: q('sp-note').value.trim() || null,
          created_by: (me && (me.full_name || me.email)) || null
        });
        if (res.error) throw res.error;
        wrap.remove();
        await loadSpecials();
        drawSpecials();
        status('Raised. It is on the auditors To Do list now.', 'ok');
      } catch (ex) {
        btn.disabled = false; btn.textContent = 'Raise it';
        err('Could not save: ' + (ex.message || ex));
      }
    });
    wrap.addEventListener('change', (e) => {
      if (e.target.id === 'sp-all' || e.target.id === 'sp-nur') { picked.clear(); drawPlots(); }
    });
  }

  /* ── Mount ──────────────────────────────────────────────────────── */
  async function mount(el) {
    root = el;
    $('ss-schedule').innerHTML = scheduleHtml();
    mountApp();

    supa = supabase.createClient(SHARED_SUPA_URL, SHARED_SUPA_KEY);
    await MJMAuditSettings.load(supa);

    /* This screen reads through supabase-js; the portal reads through
       audit_supabase.js, which orders every request by created_at. A table
       missing that column answers this screen and refuses the portal — the
       two then disagree with nothing on screen to say so. Ask the portal's
       own question here, and say plainly when it comes back empty. */
    try {
      const probe = await supa.from('audit_settings')
        .select('data').eq('id', 1).order('created_at', { ascending: false });
      if (probe.error) throw probe.error;
    } catch (e) {
      const box = $('ss-offline'), why = $('ss-offline-why');
      if (box) box.classList.remove('hidden');
      if (why) why.textContent = e.message || String(e);
      console.warn('[system-setting] the portal cannot read this table:', e);
    }
    draft = MJMAuditSettings.normalise(MJMAuditSettings.current());
    draw();

    /* After the first draw rather than before it: the schedule is what
       somebody opened this screen for, and a slow or missing
       special-audit table must not hold it back. */
    await loadSpecials();
    drawSpecials();

    root.addEventListener('click', async (e) => {
      const sp = e.target.closest('.ss-sp-new');
      if (sp) {
        if (spMissing) {
          alert('The special-audit table is not installed yet.\n\n'
              + 'Run shared/RUN_ME_audit_special_audits.sql in the Supabase SQL '
              + 'editor, then reload this page.');
          return;
        }
        openSpecialDialog(sp.dataset.scope, sp.dataset.mod);
        return;
      }
      const drop = e.target.closest('.ss-sp-drop');
      if (drop) {
        const r = specials.find(x => String(x.id) === String(drop.dataset.id));
        if (!r) return;
        if (!confirm('Withdraw this special audit?\n\n'
                   + (MOD_LABEL[r.module] || r.module) + ' · '
                   + (NUR_LABEL[r.nursery] || r.nursery) + ', due ' + prettyDate(r.due_date)
                   + '\n\nIt leaves the auditors To Do list. The request is kept on '
                   + 'record rather than deleted, and any audit already done stays.')) return;
        drop.disabled = true;
        try {
          const me = (typeof MJMAccess !== 'undefined' && MJMAccess.user()) || null;
          const res = await supa.from(SP_TABLE)
            .update({ cancelled_at: new Date().toISOString(),
                      cancelled_by: (me && (me.full_name || me.email)) || null })
            .eq('id', r.id);
          if (res.error) throw res.error;
          await loadSpecials();
          drawSpecials();
          status('Withdrawn.', 'ok');
        } catch (ex) {
          drop.disabled = false;
          status('Could not withdraw: ' + (ex.message || ex), 'err');
        }
        return;
      }
      const add = e.target.closest('.ss-add');
      if (add) {
        const list = draft.schedule[add.dataset.scope][add.dataset.mod];
        // A new round starts as the whole month; narrowing it is one edit,
        // guessing a range nobody asked for is a wrong answer.
        list.push([1, 31]);
        drawRounds();
        return;
      }
      const del = e.target.closest('.ss-del');
      if (del) {
        draft.schedule[del.dataset.scope][del.dataset.mod].splice(+del.dataset.i, 1);
        drawRounds();
      }
    });

    root.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.r) {
        const w = draft.schedule[t.dataset.scope][t.dataset.mod][+t.dataset.i];
        const v = Math.min(31, Math.max(1, parseInt(t.value, 10) || 1));
        w[t.dataset.r === 'start' ? 0 : 1] = v;
        // Keeping them in order here means the auditor never sees a round
        // reading "day 20 to day 5" and wondering which the system believes.
        if (w[0] > w[1]) w.reverse();
        drawRounds();
        return;
      }
      if (t.dataset.wt) {
        draft.maintenance[t.dataset.wt] = Math.min(365, Math.max(0, parseInt(t.value, 10) || 0));
        return;
      }
      if (t.id === 'ss-age-all') {
        draft.ages = t.checked ? null : [];
        drawAges();
        return;
      }
      if (t.dataset.age != null) {
        const m = +t.dataset.age;
        const set = pickedAges();
        if (t.checked) set.add(m); else set.delete(m);
        // Back to every age → store null, so "all" keeps meaning all even
        // if the range is widened later.
        draft.ages = set.size === MAX_AGE + 1
          ? null
          : Array.from(set).sort((a, b) => a - b);
        drawAges();
      }
    });

    $('ss-reset').addEventListener('click', () => {
      if (!confirm('Put every setting back to the defaults?\n\nNothing is saved until you press Save settings.')) return;
      draft = MJMAuditSettings.defaults();
      draw();
      status('Defaults loaded — not saved yet.');
    });

    $('ss-save').addEventListener('click', async () => {
      const btn = $('ss-save');
      btn.disabled = true; btn.textContent = 'Saving…';
      status('');
      try {
        const me = (typeof MJMAccess !== 'undefined' && MJMAccess.user()) || null;
        await MJMAuditSettings.save(supa, draft, me && me.email);
        status('Saved. Auditors pick this up on their next refresh.', 'ok');
      } catch (err) {
        console.error(err);
        status('Could not save: ' + (err.message || err), 'err');
      }
      btn.disabled = false; btn.textContent = 'Save settings';
    });
  }

  global.AuditSystemSetting = { html, mount };
})(window);
