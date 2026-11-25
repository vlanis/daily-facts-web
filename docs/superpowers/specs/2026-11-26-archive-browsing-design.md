# Archive browsing — design

Date: 2026-11-26 · Size: small change · Status: approved 2026-11-26

## Intent

Let the reader re-view facts from past days on the same site. Read-only:
no "mark as read", favourites or other write-backs. This is the "Archive /
past facts view" stretch goal from `specs/ui.md`.

## Goals

- Step back/forward one day at a time from the Today view.
- Jump to any past day quickly.
- A specific day has its own URL (bookmarkable, iPhone back button works).

## Non-goals / anti-goals

- No new hosting, backend or database: GitHub Pages + `site/archive/*.json`
  (already committed nightly and already deployed) is the storage.
- No separate list/calendar page.
- Must not change how today's view loads or behaves when no day is selected.
- Must never touch `progress.json` or the generation algorithm's choices.

## Approaches considered

- **A. Prev/next arrows around the date + tap date for a picker** — chosen.
  Fits a once-a-day reader who mostly steps back a day or two; the picker
  covers long jumps.
- B. Date picker only — simpler, but stepping back one day takes several taps.
- C. Separate "Past days" list page — good for skimming, but a second screen
  and an ever-growing list.

## Design

**Data — `site/archive/index.json`**
- `generate.mjs` writes it on every non-dry run, after the day's archive file:
  `{ "dates": ["2026-08-03", …, "2026-11-25"] }`, sorted ascending, built by
  listing `site/archive/*.json` (excluding `index.json` itself). Rebuilding
  from the directory each run means it self-heals and needs no separate
  backfill — the first run after deploy creates it. (Also generate it once
  by hand in the implementing commit so the feature works before the next
  nightly run.)
- Already covered by the workflow's `git add site/archive`.
- Gaps (e.g. 2026-08-09…08-24, before launch) are simply absent.

**Page — `site/index.html`, `site/app.js`, `site/styles.css`**
```
   ‹   Tuesday, 24 November 2026   ›
   [same fact cards as today]
```
- Routing by URL hash: no hash → Today (`today.json`, exactly as now);
  `#YYYY-MM-DD` → `archive/<date>.json`. A `hashchange` listener re-renders,
  so browser back/forward works. A hash equal to today's date is treated as
  Today (hash cleared).
- `index.json` is fetched `no-store` (like `today.json`); per-day archive
  files can use normal caching — they never change.
- ‹ goes to the previous date in `index.json`; › to the next, or back to
  Today from the newest archived day. › is hidden on Today; ‹ is hidden on
  the oldest date. Arrows skip gaps automatically.
- Tapping the date opens the native iOS date picker (`<input type="date">`
  overlaid on the heading, `min` = first date, `max` = today). Picking a day
  that isn't in the index shows a calm "No facts for this day" message with
  the arrows still usable.
- When viewing a past day, a small "Back to today" link appears under the
  date.
- Missing `index.json` (or fetch failure): arrows/picker hidden, Today works
  as before — the feature degrades away rather than breaking the page.
- Bump the `?v=` cache-busting marker on `styles.css` and `app.js`.

**Specs to update:** `specs/ui.md` (archive view no longer a stretch),
`specs/data-model.md` / `specs/generation-algorithm.md` (mention
`archive/index.json`).

## Left to the builder

Exact arrow styling, tap-target sizes (≥44px), and the empty-day wording —
consistent with the existing calm visual style.
