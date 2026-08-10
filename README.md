# MJM Nursery Audit — retired

**The audit app is no longer developed here.** It lives in the portal:

- **Live app:** <https://ai.mjmnursery.com/audit/audit_home.html>
- **Source:** [`MJMElon/mjm-ai-system`](https://github.com/MJMElon/mjm-ai-system) → `audit/`

Every page left in this repository is a redirect to the live app. They also
unregister the old service worker and clear its caches, so phones that
installed the old PWA stop opening the retired copy offline.

## Why

There were two audit codebases. This one was frozen in April 2026; the copy in
`mjm-ai-system/audit/` was imported from it in June 2026 and has been the live,
maintained version ever since — it is the one the portal links to and the one
connected to Supabase. Keeping both meant edits could land in a copy nobody was
serving.

## Where things went

| Was here | Now |
|---|---|
| `index.html` (login) | `mjm-ai-system/audit/audit_index.html` |
| `home.html` | `mjm-ai-system/audit/audit_home.html` |
| `plot_audit.html` | `mjm-ai-system/audit/audit_plot_audit.html` |
| `height_index.html` | `mjm-ai-system/audit/audit_height_index.html` |
| `papan_index.html` | `mjm-ai-system/audit/audit_papan_index.html` |
| `maintenance_index.html` | `mjm-ai-system/audit/audit_maintenance_index.html` |
| `report.html` | `mjm-ai-system/audit/audit_report.html` |
| `script.js`, `styles.css`, `lang.js`, `supabase.js`, `dexie_offline.js`, … | same names under `mjm-ai-system/audit/`, prefixed `audit_` |

`legacy/` is the untouched April snapshot taken during the React migration prep
and is kept as an archive. Nothing serves it. The full history of the deleted
files is still in this repository's git history.

## Making a change

Open `mjm-ai-system`, edit under `audit/`, and bump `VER` in `audit/audit_sw.js`
— the service worker serves JS and CSS cache-first, so without a version bump
installed phones keep the old files.
