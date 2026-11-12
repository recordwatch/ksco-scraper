# Kitsap Jail Roster — Project Context

## Standing rules (read first, every session)
1. Always paste the full, real diff. Never a summary.
2. Never commit until Alexa replies "commit".
3. Any field claiming a county value (release time, reason, status) must be backed by a value that actually parses. Otherwise label it detected or unverified.
4. Test edge cases and list them: blank, unparseable, small populations, reappearance, rebuild/error pages.
5. Flag anything uncertain instead of deciding silently.
6. After any data backfill, wait for the next scrape run and confirm the counts survived.
7. Keep the "Pending verification" section below current and check it first every session.

Hard constraints: no deleting or rewriting stored data and no schema changes without approval. Row counts identical before and after. Before/after numbers for anything that changes a published stat. Report first, fix second, one or two steps at a time.

Fix once, check siblings: Clallam and Whatcom came from the same template. Grep them for the readJSON fallback, build-before-commit, firstSeen durations and repeatBookers names before closing those fixes.

## Pending verification
- **A1/A2 (merged in PR #3, 2026-11-05):** `readState` exits on a missing or unparseable `roster.json`/`change_log.json`; data is committed before the build; deploy is a separate job. After merge: confirm the first run goes green, data commit lands, Pages deploys, and `change_log.json` row count is unchanged.
- **A3 (merged in PR #2, 2026-10-26):** feed release times now parsed as Pacific. Records from before 2026-10-26 are still 7–8 h early. No backfill done. Check a sample against the XML feed / detail pages before proposing one.
- **Midnight "24:xx" dates (frontend fixed in PR #5, 2026-11-06; confirmed on iPhone):** 62 stored values (59 `releasedAt` 04/29–10/25, 3 `firstSeen` 05/07) write midnight as hour 24. `frontend/src/dates.js` reads them as 00:xx same date. Still open: `stats.js` can't parse them server-side; the stored values are unchanged (fold into the backfill); the same-date reading isn't checked against the county.
- **Detail pages survive release?** Reported, not checked by hand.
- **Inmate IDs alphanumeric?** Regex accepts digits only (`scrapers/kitsap.js`). Check a real detail page.
- **Receipt font on the live site** (`url('/fonts/...')` under the Pages subpath).
- **Pages source setting** must be gh-pages branch / GitHub Actions, never "main".

## What it is
A public jail roster monitor for Kitsap County, WA. Scrapes the sheriff's site every 30 minutes, tracks bookings and releases, and displays them on a public website.

## URLs
- **Live site:** https://recordwatch.github.io/ksco-scraper/
- **GitHub repo:** https://github.com/recordwatch/ksco-scraper
- **Source data:** Kitsap County Sheriff's Office public roster

## Architecture
- **Scraper:** `scrape.js` — standalone Node.js script, runs via GitHub Actions cron every 30 min
- **Frontend:** React + Vite, served as static files on GitHub Pages (`gh-pages` branch)
- **Data storage:** JSON files committed to git in `data/` — no server, no database
- **Hosting cost:** $0 (moved off Railway May 2026)

## Key files
- `scrape.js` — scraper (extracted from server.js, also writes stats.json + status.json)
- `server.js` — old Express server (kept for reference, no longer running)
- `scrapers/kitsap.js` — actual scraping logic (Cheerio/axios, HTML not PDF)
- `stats.js` — all stat aggregation functions
- `utils.js` — `nowPST()` timestamp helper (uses hourCycle h23 to avoid midnight 24:xx bug)
- `data/change_log.json` — full history of all bookings/releases since Mar 24 2026
- `data/roster.json` — current roster state
- `data/stats.json` — precomputed stats (regenerated each scrape)
- `data/status.json` — {inCustody, lastUpdated}
- `.github/workflows/scrape.yml` — GitHub Actions workflow (scrape + build + deploy)
- `frontend/src/App.jsx` — React app, HashRouter, fetches from ./data/*.json static files
- `frontend/vite.config.js` — base: './' for GitHub Pages compatibility

## Data format
- `change_log.json` is an array of booking entries, newest first
- Each entry has: bookingNumber, name, status (in_custody/released), firstSeen, releasedAt, charges[], age, sex, race, height, weight, etc.
- `firstSeen` format: "MM/DD/YYYY, HH:MM:SS" (PST)

## Related project
- **Mason County Jail Roster** — separate repo, still on Railway (~$0.87/mo), PDF-based scraper, much more complex. Repo: https://github.com/recordwatch/mason-jail-roster. Live at https://alexasroster.com
