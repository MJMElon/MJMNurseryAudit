# MJM Nursery Audit — audit.mjmnursery.com

This repository serves **<https://audit.mjmnursery.com>**, the 555 Auditor
Portal's own front door. The pages under `audit/` (plus `shared/*.js`) are a
**machine-written mirror** of
[`MJMElon/mjm-ai-system`](https://github.com/MJMElon/mjm-ai-system) →
`audit/`, which remains the one and only place the audit app is developed.

## Do not edit the app here

Any change made to `audit/` or `shared/` in this repository is overwritten by
the next sync. **Edit in `mjm-ai-system/audit/`** (and bump `VER` in
`audit_sw.js` when JS or CSS change); the mirror follows.

## How the mirror stays fresh

`.github/workflows/sync_audit_mirror.yml` copies `audit/` and `shared/*.js`
from `mjm-ai-system` and commits only when something changed.

- **On a schedule** — hourly.
- **On demand** — Actions tab → *sync audit mirror* → *Run workflow*, for when
  an edit must go live now.

GitHub pauses scheduled workflows after ~60 days without a commit in this
repository. If audit.mjmnursery.com ever falls behind ai.mjmnursery.com,
open the Actions tab: re-enable the workflow if GitHub disabled it, and run
it once by hand.

## What each part is

| Path | What |
|---|---|
| `CNAME` | binds audit.mjmnursery.com to this repository's GitHub Pages |
| `index.html` | on audit.mjmnursery.com: straight into `audit/audit_index.html`, address bar stays put. On mjmelon.github.io: the retired-app teardown (below) |
| `audit/` | the mirrored live app — the same files as `mjm-ai-system/audit/` |
| `shared/` | the mirrored `shared_*.js` the audit pages load as `../shared/…` |
| `home.html`, `report.html`, … | legacy: this repository was the ORIGINAL audit app until April 2026, and phones that installed that PWA from mjmelon.github.io still hold its service worker and offline cache. These pages unregister it, clear its caches and forward to audit.mjmnursery.com. Keep them |
| `legacy/` | untouched April 2026 snapshot, archive only, nothing serves it |

## History

The app was born here, was frozen in April 2026, moved into
`mjm-ai-system/audit/` in June 2026, and this repository spent a while as
pure redirects. Since September 2026 it serves the mirror above so that the
audit portal has its own domain. The full pre-move history is in this
repository's git log.
