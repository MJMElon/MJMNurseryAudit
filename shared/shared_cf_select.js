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
/* The 260px is a FALLBACK only — placeMenu() writes a max-height off the
   room there actually is, and opens the menu UPWARDS where there is more
   room above. See placeMenu() for what that fixes. */
.cf-menu{position:absolute;left:0;top:calc(100% + 6px);min-width:100%;max-height:260px;box-sizing:border-box;overflow-y:auto;background:#fff;border:1px solid #e5e9f0;border-radius:14px;box-shadow:0 16px 32px -10px rgba(15,23,42,.18),0 4px 10px rgba(15,23,42,.06);padding:4px 0;z-index:2000;}
.cf-menu.cf-up{top:auto;bottom:calc(100% + 6px);}
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

    /* ── WHERE THE MENU GOES, AND HOW TALL IT IS ──────────────────────────
       The menu is position:absolute under the button, so EVERY scroller
       above it can cut it off, and a fixed one cuts it off for good.

       The office found it on the Transplanting form: the tray list opened
       downwards out of a card near the foot of the window, and the page
       scrolls inside `.modal-backdrop`, which is `position:fixed; inset:0`.
       So the tail of the menu hung below the window and there was no way
       to reach it — scrolling moves the BUTTON by the same amount, so the
       menu never comes up the screen, and at the end of the document it
       cannot move at all. With thirteen trays they could see four of them.
       A flat `max-height:260px` cannot help: the cut is below the window,
       not inside the menu.

       So the height is the room there ACTUALLY is, measured on open:

       - **The clip is every ancestor that clips, not just the window.** A
         menu inside a scrolling panel is cut at the PANEL, and a height
         measured off the window would hang out of it exactly as before.
       - **It opens upwards where there is more room above**, which is the
         only answer for a row at the very bottom — there is no amount of
         height that fits under it.
       - **It is re-measured while it is open.** The menu moves with the
         button on a scroll, so a height worked out once goes stale the
         moment anybody scrolls, and it would hang below the fold again.
       - **The 260px in the stylesheet stays as a fallback**, for a menu
         opened before this ever runs.                                    */
    const MENU_GAP = 6;     // the 6px the stylesheet leaves under the button
    const MENU_EDGE = 8;    // never flush against the edge it is cut at
    const MENU_MIN = 140;   // under about three rows, look for room above

    function clipBand(el) {
        /* The band the menu has to stay inside: the window, narrowed by
           every ancestor that clips its own overflow. BODY and HTML are
           skipped — a page whose scroller is a fixed overlay leaves the
           body at zero height, which would read as no room at all. */
        let top = 0, bottom = window.innerHeight;
        let n = el.parentElement;
        while (n && n !== document.body && n !== document.documentElement) {
            const cs = getComputedStyle(n);
            if (cs.overflowY !== 'visible' || cs.overflowX !== 'visible') {
                const r = n.getBoundingClientRect();
                if (r.height > 0) {
                    if (r.top > top) top = r.top;
                    if (r.bottom < bottom) bottom = r.bottom;
                }
            }
            n = n.parentElement;
        }
        return { top, bottom };
    }

    function placeMenu(wrap) {
        if (!wrap || !wrap.isConnected) return;
        const btn = wrap.querySelector('.cf-btn');
        const menu = wrap.querySelector('.cf-menu');
        if (!btn || !menu) return;
        const r = btn.getBoundingClientRect();
        const band = clipBand(wrap);
        /* A MENU WHOSE BUTTON HAS SCROLLED OUT OF SIGHT IS CLOSED. It is
           anchored to that button, so it goes on hanging where the button
           now is -- off the screen, or floating over a part of the page
           with nothing on it saying what it belongs to. */
        if (r.bottom <= band.top || r.top >= band.bottom) {
            menu.classList.add('hidden');
            btn.classList.remove('open');
            if (openWrap === wrap) openWrap = null;
            return;
        }
        const below = band.bottom - r.bottom - MENU_GAP - MENU_EDGE;
        const above = r.top - band.top - MENU_GAP - MENU_EDGE;
        const up = below < MENU_MIN && above > below;
        menu.classList.toggle('cf-up', up);
        menu.style.maxHeight = Math.max(80, Math.floor(up ? above : below)) + 'px';
    }

    let openWrap = null;

    function closeAllMenus(exceptWrap) {
        if (openWrap && openWrap !== exceptWrap) openWrap = null;
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

    // THE HIDE HAS TO SURVIVE THE PAGE RESTYLING ITS OWN SELECT.
    // Several pages colour a <select> by state and do it the blunt way --
    // `sel.className = 'lvl-select lvl-admin'` on the User Access drawer,
    // `select.className = 'input-style ... t3-dest-plot'` on Tab 3's
    // destination plot. An assignment to .className REPLACES the class
    // list, so it takes cf-native-hidden with it, and the browser's own
    // dropdown comes straight back BESIDE the button: two dropdowns on one
    // row, both live, and nothing says which is the real one.
    //
    // So the hide is an INLINE style, which a className assignment cannot
    // reach, and the class goes on beside it for anything keying off it.
    // The observer in skin() puts both back if a page rewrites the style
    // attribute wholesale as well. A page should not have to know this
    // skin exists -- that was the whole bargain of rolling it out as one
    // script tag.
    function hideNative(select) {
        if (!select.classList.contains('cf-native-hidden')) select.classList.add('cf-native-hidden');
        if (select.style.display !== 'none') select.style.display = 'none';
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
        // The wrap steps into the select's own slot in whatever row it was
        // in, so it has to carry the select's OWN flex sizing — a select
        // written as `class="input-style flex-1"` (every select in this
        // system) has flex-basis:0% from flex-1, which is what makes
        // width:100% on the real <select> harmless (flex-basis wins over
        // width once it isn't auto). The wrap has no such class, so its
        // flex-basis defaults to auto, which THEN falls back to its own
        // width:100% — i.e. 100% of the whole ROW, not of its own slot —
        // and a flex row shrinks that down against its siblings, taking
        // the shrink almost entirely out of THIS item since its claimed
        // basis so outweighs theirs. A select sized flex-1 (or any other
        // way) next to a flex-1 input showed as roughly a 95/5 split
        // instead of even — this is why. Reading the select's computed
        // flex-grow/shrink/basis before it is reparented and copying them
        // onto wrap reproduces exactly the sizing the select itself would
        // have had, whatever Tailwind width/flex classes a given page put
        // on it, so no page has to know this skin exists to get it right.
        const selFlex = getComputedStyle(select);
        wrap.style.flexGrow = selFlex.flexGrow;
        wrap.style.flexShrink = selFlex.flexShrink;
        wrap.style.flexBasis = selFlex.flexBasis;
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
            /* Measured on OPEN, never once at build time: the room under a
               row depends on where the page is scrolled to at that moment. */
            if (opening) { openWrap = wrap; placeMenu(wrap); }
            else openWrap = null;
        });

        select.parentNode.insertBefore(wrap, select);
        wrap.appendChild(select);
        hideNative(select);
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

        // And the hide has to survive the page restyling its own select --
        // see hideNative() above for what that costs when it does not.
        new MutationObserver(() => { hideNative(select); })
            .observe(select, { attributes: true, attributeFilter: ['class', 'style'] });
    }

    function skinAll(root) {
        (root || document).querySelectorAll('select').forEach(skin);
    }

    function init() {
        skinAll(document);
        /* The menu moves with its button, so a scroll ANYWHERE above it
           invalidates the height worked out when it opened. Captured, so a
           scroller inside the page counts and not only the window. */
        window.addEventListener('scroll', () => { if (openWrap) placeMenu(openWrap); }, true);
        window.addEventListener('resize', () => { if (openWrap) placeMenu(openWrap); });
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
