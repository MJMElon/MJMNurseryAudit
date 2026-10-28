/* ══════════════════════════════════════════════════════════════════
   555 AUDITOR PORTAL — top-ribbon welcome name
   ══════════════════════════════════════════════════════════════════
   Small helper that fills in the "Welcome, <name>" text on the shared
   FC-style ribbon (see audit_ribbon.css). The ribbon is written in each
   page's static markup rather than injected, because the pages need to
   render before any script runs — this only patches the name in once
   the mjm_user object is available in localStorage.

   Kept as its own file so a page can drop the FC ribbon in with two
   lines: a stylesheet link and this script tag. Nothing else is
   required — the pill onclick handlers wire straight to whatever
   sign-out and language functions the page already defines.
   ══════════════════════════════════════════════════════════════════ */
(function(){
  function fill(){
    var el = document.getElementById('fcr-welcome');
    if (!el) return;
    var name = '';
    try {
      var u = JSON.parse(localStorage.getItem('mjm_user') || '{}');
      /* Prefer explicit `name`, fall back to full_name (main portal), then
         the email prefix — same order the audit login page uses. */
      name = u.name || u.full_name || (u.email && u.email.split('@')[0]) || '';
    } catch (e) {}
    if (!name) return;
    /* First two words at most, so a five-word Malay name does not push
       the pills off the row on a phone. */
    var short = name.split(' ').slice(0, 2).join(' ');
    el.textContent = 'Welcome, ' + short;
  }
  /* NOTHING LIVE CARRIES A BACK ARROW ANY MORE, so this is a no-op on
     every page that is actually served -- it returns on the first line
     when there is no anchor to aim. audit_home.html gave its arrow up
     when the office asked for the portal to be a page of its own, and
     audit_admin.html never had one in that cell; the only markup left
     is on audit_nursery_select.html, which redirects in its own head
     and never renders. The function stays because that forwarder could
     be un-cancelled, and because a rule is cheaper to keep than to work
     out again.

     What it does when there IS one: an admin came in through the
     Auditor Portal Manage page and expects to land back on it;
     everyone else came from the Nursery sector of the MJM AI hub and
     expects that. Set at run time rather than in the markup, because
     one page would serve both. */
  function aimBack(){
    var a = document.querySelector('.fcr-back');
    if (!a) return;
    var admin = false;
    try {
      admin = !!(window.MJMAuditLogin && MJMAuditLogin.isAdmin && MJMAuditLogin.isAdmin());
    } catch (e) {}
    var href  = admin ? 'audit_admin.html' : 'https://ai.mjmnursery.com/index.html#sector-nursery';
    var label = admin ? 'Back to Auditor Portal Manage' : 'Back to the Nursery sector';
    a.setAttribute('href', href);
    a.setAttribute('title', label);
    a.setAttribute('aria-label', label);
  }

  function start(){ fill(); aimBack(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
