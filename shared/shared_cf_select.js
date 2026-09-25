// shared_cf_select.js — skins every <select> on the page as this system's
// custom "cf-*" dropdown (a button showing the current value + chevron,
// opening a floating rounded menu with a checkmark on the active option)
// instead of the browser's own native popup. Rules shared with the
// Barcode_Counter repo — see its own copy of this file.
//
// The <select> itself is never removed. It's hidden (display:none) but
// stays in the DOM as the real source of truth: its .value/.selectedIndex
// still work, and picking a cf-opt sets them and dispatches a real
// 'change' event (bubbles:true) — so every page's existing
// onchange="..." attribute, addEventListener('change', ...), or code that
// just reads select.value later keeps working completely unchanged. This
// is the only reason a system-wide swap is safe to do as "add one script
// tag" rather than "rewrite every page's dropdown by hand".
//
// Three things make it track a select it doesn't fully control:
//  - Picking select.value or select.selectedIndex from other code (some
//    pages set a default via `sel.value = x` without a UI interaction) is
//    caught by wrapping those two properties so any set re-syncs the
//    button label — see makeReactive().
//  - Its <option>s changing later (many selects here are repopulated via
//    `select.innerHTML = getXOptionsHTML()` well after page load — trays,
//    plots, batches, breeds) is caught by a MutationObserver on each
//    select's own childList, which rebuilds the menu.
//  - A brand new <select> appearing later (a table row added at runtime)
//    is caught by one page-wide MutationObserver watching for added
//    nodes, including nested ones.
//
// Opt a select out with class="cf-skip" — kept fully native. Nothing in
// this system needs that today (zero <select multiple>/[size] exist), but
// the escape hatch costs nothing.
(function () {
    if (window.MJMCfSelect) return; // already loaded, e.g. two script tags on one page

    const STYLE_ID = 'mjm-cf-select-style';
    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
/* No width here — see skin() below for why. */
.cf-wrap{position:relative;display:inline-block;}
.cf-btn{display:flex;align-items:center;gap:8px;justify-content:space-between;text-align:left;font-size:13px;font-weight:600;color:#1a150d;background:#fff;border:1.5px solid #e2d9c8;border-radius:12px;padding:10px 12px;cursor:pointer;transition:border-color .15s,box-shadow .15s;font-family:inherit;line-height:1.3;}
.cf-btn:hover{border-color:#b9ac95;}
.cf-btn.open{border-color:var(--cf-accent,#4a7a2e);box-shadow:0 0 0 3px var(--cf-accent-soft,rgba(74,122,46,.15));}
.cf-btn:disabled{background:#f4f1ea;color:#9c8f7a;cursor:not-allowed;}
.cf-btn-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.cf-chevron{width:12px;height:12px;color:#9c8f7a;transition:transform .15s;flex-shrink:0;}
.cf-btn.open .cf-chevron{transform:rotate(180deg);}
.cf-menu{position:absolute;left:0;top:calc(100% + 6px);min-width:100%;max-height:260px;overflow-y:auto;background:#fff;border:1px solid #e5e9f0;border-radius:14px;box-shadow:0 16px 32px -10px rgba(15,23,42,.18),0 4px 10px rgba(15,23,42,.06);padding:4px 0;z-index:2000;}
.cf-menu::-webkit-scrollbar{width:6px;}
.cf-menu::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px;}
.cf-opt{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;text-align:left;font-size:13px;font-weight:600;color:#1a150d;background:#fff;border:none;border-bottom:1px solid #f4f1ea;padding:10px 14px;cursor:pointer;transition:background .12s,color .12s;font-family:inherit;white-space:nowrap;}
.cf-opt:last-child{border-bottom:none;}
.cf-opt:hover:not(:disabled){background:#f8f6f0;}
.cf-opt.active{color:var(--cf-accent,#4a7a2e);font-weight:800;}
.cf-opt.active::after{content:'\\2713';font-size:13px;font-weight:900;color:var(--cf-accent,#4a7a2e);flex-shrink:0;}
.cf-opt:disabled{color:#c7bfae;cursor:not-allowed;}
.cf-opt-empty{padding:14px 16px;font-size:12px;color:#9c8f7a;text-align:center;}
select.cf-native-hidden{display:none!important;}
/* Pages that wrapped their <select> in a ".select-wrapper" for the old
   appearance:none + CSS-triangle arrow (see e.g. operation_batch_detail.html)
   still have that wrapper — cf-wrap just nests inside it now — so its own
   arrow needs suppressing or it'd draw a second one next to cf-btn's own
   chevron. :has() beats the plain ".select-wrapper::after" rule on
   specificity regardless of which file defined it or in what order. */
.select-wrapper:has(.cf-wrap)::after{display:none!important;}
/* Menu visibility never depends on Tailwind's own .hidden utility being
   present/loaded — this toggles it directly rather than trusting an
   external stylesheet to define that class. */
.cf-menu.hidden{display:none!important;}
`;
        document.head.appendChild(style);
    }

    function closeAllMenus(exceptWrap) {
        document.querySelectorAll('.cf-wrap').forEach(wrap => {
            if (wrap === exceptWrap) return;
            wrap.querySelector('.cf-menu')?.classList.add('hidden');
            wrap.querySelector('.cf-btn')?.classList.remove('open');
        });
    }
    document.addEventListener('click', (e) => {
        const openWrap = e.target.closest('.cf-wrap');
        if (openWrap && openWrap.querySelector('.cf-btn')?.contains(e.target) && !e.target.closest('.cf-menu')) return; // toggle() below handles its own wrap
        if (!e.target.closest('.cf-menu')) closeAllMenus(null);
    });

    function labelFor(select) {
        const opt = select.options[select.selectedIndex];
        return opt ? opt.text : (select.options.length ? '' : '—');
    }

    function buildMenu(select, menu) {
        menu.innerHTML = '';
        if (!select.options.length) {
            const empty = document.createElement('div');
            empty.className = 'cf-opt-empty';
            empty.textContent = 'No options';
            menu.appendChild(empty);
            return;
        }
        [...select.options].forEach((opt, idx) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'cf-opt' + (opt.selected ? ' active' : '');
            btn.textContent = opt.text;
            if (opt.disabled) btn.disabled = true;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                select.selectedIndex = idx; // goes through the reactive setter below
                select.dispatchEvent(new Event('change', { bubbles: true }));
                syncButton(select);
                closeAllMenus(null);
            });
            menu.appendChild(btn);
        });
    }

    function syncButton(select) {
        const wrap = select._cfWrap;
        if (!wrap) return;
        const label = wrap.querySelector('.cf-btn-label');
        if (label) label.textContent = labelFor(select);
        wrap.querySelectorAll('.cf-opt').forEach((el, idx) => {
            el.classList.toggle('active', idx === select.selectedIndex);
        });
        wrap.querySelector('.cf-btn').disabled = select.disabled;
    }

    // Selects here get their .value/.selectedIndex set directly by other
    // code (a report's default date, a form reset, …) with no guarantee a
    // 'change' event follows. Wrapping the property is what keeps the
    // button's label honest without every one of those call sites having
    // to know this skin exists.
    function makeReactive(select) {
        if (select._cfReactive) return;
        select._cfReactive = true;
        const proto = HTMLSelectElement.prototype;
        const valueDesc = Object.getOwnPropertyDescriptor(proto, 'value');
        const idxDesc = Object.getOwnPropertyDescriptor(proto, 'selectedIndex');
        Object.defineProperty(select, 'value', {
            configurable: true,
            get() { return valueDesc.get.call(select); },
            set(v) { valueDesc.set.call(select, v); syncButton(select); }
        });
        Object.defineProperty(select, 'selectedIndex', {
            configurable: true,
            get() { return idxDesc.get.call(select); },
            set(v) { idxDesc.set.call(select, v); syncButton(select); }
        });
    }

    function skin(select) {
        if (select._cfWrap || select.classList.contains('cf-skip')) return;
        ensureStyle();

        const wrap = document.createElement('div');
        wrap.className = 'cf-wrap';
        // width:100% inline, not in the shared .cf-wrap/.cf-btn class rule —
        // several pages already had their OWN hand-built .cf-* dropdown
        // (same class names) with its own width (operation_booking.html's
        // AL filter is md:w-48, a fixed 192px). A width in the shared class
        // rule has equal specificity to that page's own .cf-btn rule, and
        // since this stylesheet loads after the page's own <style>, it won
        // every time regardless of the page's own width class — which is
        // exactly what stretched that button to fill its row. Setting it
        // inline instead only touches the elements THIS function creates,
        // so a page's own pre-existing cf-* widget keeps its own sizing.
        wrap.style.width = '100%';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cf-btn';
        btn.style.width = '100%';
        btn.disabled = select.disabled;
        btn.innerHTML = `<span class="cf-btn-label"></span>
<svg class="cf-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 7l5 5 5-5"/></svg>`;
        const menu = document.createElement('div');
        menu.className = 'cf-menu hidden';

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (btn.disabled) return;
            const opening = menu.classList.contains('hidden');
            closeAllMenus(wrap);
            menu.classList.toggle('hidden', !opening);
            btn.classList.toggle('open', opening);
        });

        select.parentNode.insertBefore(wrap, select);
        wrap.appendChild(select);
        select.classList.add('cf-native-hidden');
        wrap.appendChild(btn);
        wrap.appendChild(menu);
        select._cfWrap = wrap;

        buildMenu(select, menu);
        makeReactive(select);
        syncButton(select);

        // The page's own code repopulates this select's <option>s later
        // (breed/plot/tray/batch pickers all do) — rebuild the menu when
        // that happens instead of going stale.
        new MutationObserver(() => { buildMenu(select, menu); syncButton(select); })
            .observe(select, { childList: true });

        // A disabled/enabled toggle on the select (common on dependent
        // dropdowns) should reach the button too.
        new MutationObserver(() => { btn.disabled = select.disabled; })
            .observe(select, { attributes: true, attributeFilter: ['disabled'] });
    }

    function skinAll(root) {
        (root || document).querySelectorAll('select').forEach(skin);
    }

    function init() {
        skinAll(document);
        new MutationObserver((mutations) => {
            for (const m of mutations) {
                m.addedNodes.forEach(node => {
                    if (node.nodeType !== 1) return;
                    if (node.tagName === 'SELECT') skin(node);
                    else if (node.querySelectorAll) skinAll(node);
                });
            }
        }).observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.MJMCfSelect = { skin, skinAll };
})();
