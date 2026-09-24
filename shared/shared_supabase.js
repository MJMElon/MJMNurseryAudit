/* ================================================================
   MJM AI POWERED SYSTEM — SHARED SUPABASE CONFIG
   shared/shared_supabase.js
   Single source of truth for Supabase URL and key.
   Import this file in all modules.
   ================================================================ */

const SHARED_SUPA_URL = 'https://kibqjztozokohqmhqqqf.supabase.co';
const SHARED_SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpYnFqenRvem9rb2hxbWhxcXFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzQzNjIsImV4cCI6MjA4OTgxMDM2Mn0.J7qJUZhWXYf5b9oey4wXJkjdi66jomEMw_NeV9NWF7M';

/* Usage in any module:
   <script src="../shared/shared_supabase.js"></script>
   const _supabase = supabase.createClient(SHARED_SUPA_URL, SHARED_SUPA_KEY);
*/

/* "Sept" → "Sep" everywhere a date is formatted with the short month
   name — same patch as shared_nelos_dock.js (see the comment there for
   why), added here too for the pages that load this file but not that
   dock. The guard keeps a page loading both from wrapping twice. */
(function () {
  if (Date.prototype._mjmSeptPatched) return;
  Date.prototype._mjmSeptPatched = true;
  const _toLocaleDateString = Date.prototype.toLocaleDateString;
  Date.prototype.toLocaleDateString = function (...args) {
    return _toLocaleDateString.apply(this, args).replace(/Sept\b/g, 'Sep');
  };
  const _toLocaleString = Date.prototype.toLocaleString;
  Date.prototype.toLocaleString = function (...args) {
    return _toLocaleString.apply(this, args).replace(/Sept\b/g, 'Sep');
  };
})();
