# Archive browsing + No-wrap exhaustion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the daily generator from wrapping exhausted topics back to fact 0, and let the reader step back through past days on the site.

**Architecture:** Generator changes live in `scripts/generate.mjs` (made importable so it can be unit-tested with `node:test`); it also writes a derived `site/archive/index.json`. The reader gets a tiny pure navigation helper (`site/nav.js`, testable in Node) and hash-based routing in `site/app.js`.

**Tech Stack:** Node ≥20 ESM scripts, `node --test` (built-in, no dependencies), vanilla ES5-style browser JS, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-11-26-no-wrap-on-exhaustion-design.md`, `docs/superpowers/specs/2026-11-26-archive-browsing-design.md`

## Global Constraints

- No new dependencies, no `package.json`; tests run with `node --test tests/`.
- Work on `develop`; `git fetch && git merge origin/main` before starting and before the final step. Never resolve a `progress.json` conflict in `develop`'s favour.
- Every commit: review the staged diff, then `touch .claude/.commit-reviewed` in a **separate** command (the hook checks before the command runs), then commit. Never push without asking the owner.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `progress.json` is edited by hand only in Task 2 (owner-approved migration), nowhere else.
- Reader never assigns to `innerHTML`; keep the existing text-node rendering.
- Bump `?v=5` → `?v=6` on both `styles.css` and `app.js` in `index.html`.
- `repeat` field is kept in output, always `false` for new days.

## Review Focus

1. Same topic in two slots on the day it runs out — second slot must pick another topic or be unresolved, never serve `undefined`. (Task 1 test)
2. Progress entry whose `next_index` exceeds `facts.length` — treated as exhausted, never an `undefined` fact. (Task 1 test)
3. URL hash equal to today's date, or garbage (`#foo`, `#2026-13-45`) — shows Today, not an error. (Task 4 test)
4. Date picked inside a gap (e.g. 2026-08-15) — calm "No facts for this day", arrows still usable. (Task 4 test for `neighbours` on a non-member date; Task 5 manual check)
5. `index.json` missing or fails to load — arrows/picker hidden, Today renders exactly as before. (Task 5 manual check)

---

### Task 1: No-wrap draw + automatic re-arm

**Files:**
- Modify: `scripts/generate.mjs` (`resolveSlot`, `generate`, `main`; guard entry point; add exports)
- Create: `tests/generate.test.mjs`
- Modify: `specs/generation-algorithm.md` (Step 2 items 1–4, Edge cases, Cycle handling), `specs/data-model.md` (meaning of `cycled`), `CLAUDE.md` decision #5

**Interfaces:**
- Produces: `export function generate({ date, weekday, topics, schedule, progress }) -> { today, progress, newlyCycled: string[], unresolved: string[], rearmed: string[] }`
- Produces: `export function rearmExhausted(topics, progress) -> string[]` — mutates `progress`, returns topic ids whose `cycled` was cleared.
- Entry point runs `main()` only when executed directly: `if (process.argv[1] === fileURLToPath(import.meta.url)) main();`

- [ ] **Step 1: Write failing tests** in `tests/generate.test.mjs` (`node:test` + `node:assert/strict`, fixtures built inline; schedule keyed on `weekday: "monday"`):
  - `last fact is served, then cursor parks at end`: topic `a` with 2 facts, progress `{a:{next_index:1,cycled:false}}` → slot gets facts[1]; `progress.a` deep-equals `{next_index:2,cycled:true}`; `newlyCycled` equals `["a"]`.
  - `exhausted topic is skipped within a pool`: slot topics `[a,b]`, `a` at `next_index:2` of 2 → every one of 20 runs (fresh clones) draws `b`; `repeat === false`.
  - `fully exhausted slot is unresolved`: only `a`, exhausted → `today.slots` is `[]`, `today.unresolved` equals `["S"]`, `progress.a.next_index === 2`.
  - `same topic twice on its last fact` (Review Focus 1): two slots both `[a]`, `a` at `next_index:1` of 2 → first slot gets facts[1], second is in `unresolved`; no slot has `fact === undefined`.
  - `next_index beyond length is exhausted` (Review Focus 2): `a` with 2 facts, `next_index:5` → slot unresolved.
  - `appended facts re-arm`: `a` has 3 facts, progress `{next_index:2,cycled:true}` → `rearmed` equals `["a"]`, slot gets facts[2], and `progress.a` ends `{next_index:3,cycled:true}` with `newlyCycled` `["a"]`.
  - `pinned slot untouched`: slot `{slot:"H",topics:["a"],index:0}` with `a` exhausted → served facts[0], `progress.a` unchanged.
- [ ] **Step 2: Run** `node --test tests/` — Expected: FAIL (`generate` not exported / main runs on import).
- [ ] **Step 3: Implement.** Exhausted = `(progress[t]?.next_index ?? 0) >= factsFor(topics,t).length`. Viable = non-exhausted topics (this also drops empty ones); none → `{ unresolved: slot }`. Advance `next_index = index + 1` with no wrap; on reaching length set `cycled = true` and add to `newlyCycled` only on the false→true transition. Remove the repeat fallback branch; emit `repeat: false`. `generate` calls `rearmExhausted` before resolving slots. In `main`, remove `rearmed` ids from `flags.cycled_topics` and log `  RE-ARMED (new facts): …` when non-empty; log line for cycled becomes `  NEWLY EXHAUSTED (add more facts): …`.
- [ ] **Step 4: Run** `node --test tests/` — Expected: all pass. Then `node scripts/generate.mjs --dry-run --date=2026-11-27` — Expected: prints slots, writes nothing (`git status` clean for `content/` and `site/`). Until Task 2 lands, the log will show `RE-ARMED` for `history_ua` and `english_words` (they're still wrapped) — expected, and the reason Task 1 and Task 2 must reach `main` together.
- [ ] **Step 5: Update the three spec/CLAUDE.md passages** to describe park-at-end, no repeats, unresolved-when-exhausted, auto re-arm.
- [ ] **Step 6: Commit** — `feat(generate): park exhausted topics at their end instead of wrapping`.

### Task 2: One-time cursor migration + validation

**Files:**
- Modify: `content/progress.json` (two entries only)
- Modify: `scripts/validate.mjs` (progress shape section, ~line 171)

**Interfaces:**
- Consumes: Task 1's exhaustion rule (`next_index === facts.length` is valid and means exhausted).

- [ ] **Step 1:** `git fetch && git merge origin/main` (pick up the latest nightly cursor).
- [ ] **Step 2:** Confirm both entries are still `history_ua {next_index:0,cycled:true}` (13 facts) and `english_words {next_index:1,cycled:true}` (26 facts). If either differs, stop and report to the owner.
- [ ] **Step 3:** Set `history_ua.next_index = 13`, `english_words.next_index = 26`; leave `cycled: true` and every other entry byte-identical (`git diff content/progress.json` shows exactly two changed lines).
- [ ] **Step 4:** In `validate.mjs`, add an error when a topic's `next_index > facts.length` (`=== length` is valid: exhausted). Run `node scripts/validate.mjs` — Expected: exit 0, no new errors.
- [ ] **Step 5:** Simulate 30 days on a scratch copy: a throwaway script that imports `generate`, loads the real content, loops dates 2026-11-27…2026-12-26 feeding `progress` forward. Expected: no `repeat: true`, no `english_words`/`history_ua` draws, no `undefined` facts. (Script lives in the scratchpad, not the repo.)
- [ ] **Step 6: Commit** — `content: park history_ua and english_words at their end`.

### Task 3: Archive index

**Files:**
- Modify: `scripts/generate.mjs` (new export, call in `main` after the archive write)
- Create: `site/archive/index.json` (generated once now)
- Modify: `tests/generate.test.mjs`
- Modify: `specs/data-model.md`, `specs/generation-algorithm.md` Output/Step 3 (mention `archive/index.json`)

**Interfaces:**
- Produces: `export function buildArchiveIndex(archiveDir: string) -> { dates: string[] }` — ascending `YYYY-MM-DD` names of `*.json` files matching `/^\d{4}-\d{2}-\d{2}\.json$/` (so `index.json` is excluded).
- File format consumed by Task 5: `{ "dates": ["2026-08-03", …] }`.

- [ ] **Step 1: Failing test** `buildArchiveIndex lists dated files sorted`: temp dir (`fs.mkdtempSync`) with `2026-08-05.json`, `2026-08-03.json`, `index.json`, `notes.txt` → deep-equals `{ dates: ["2026-08-03","2026-08-05"] }`.
- [ ] **Step 2: Run** `node --test tests/` — Expected: FAIL (not exported).
- [ ] **Step 3: Implement**; in `main` (non-dry-run only) write `site/archive/index.json` via `writeJSON` right after the day's archive file.
- [ ] **Step 4: Run tests** — PASS. Generate the initial file: `node -e 'import("./scripts/generate.mjs").then(m=>{const fs=require("fs");fs.writeFileSync("site/archive/index.json",JSON.stringify(m.buildArchiveIndex("site/archive"),null,2)+"\n")})'` — Expected: first date `2026-08-03`, last = newest archive file, no `2026-08-09`…`2026-08-24`.
- [ ] **Step 5: Update the two specs; commit** — `feat(generate): write archive/index.json`.

### Task 4: Navigation helper

**Files:**
- Create: `site/nav.js` (classic script: sets `window.DailyFactsNav`; also `module.exports` when `module` exists)
- Create: `tests/nav.test.mjs` (load via `createRequire(import.meta.url)("../site/nav.js")`)

**Interfaces:**
- Produces: `parseHash(hash: string) -> string | null` — returns `"YYYY-MM-DD"` only for a real calendar date (`#2026-02-30` → null), else null.
- Produces: `neighbours(dates: string[], current: string | null, todayDate: string) -> { prev: string | null, next: string | null }` — `current === null` means the Today view. `prev` = latest date in `dates` strictly before `current ?? todayDate`, else null. `next` = null on Today; otherwise earliest date in `dates` strictly after `current`, except that if that date is `>= todayDate` or none exists, `next` is the string `"today"`.

- [ ] **Step 1: Failing tests** (`dates = ["2026-08-03","2026-08-08","2026-08-25","2026-11-24","2026-11-25"]`, `todayDate = "2026-11-25"`):
  - `parseHash`: `"#2026-11-20"` → `"2026-11-20"`; `""`, `"#foo"`, `"#2026-13-45"`, `"#2026-02-30"` → null (Review Focus 3).
  - Today view: `neighbours(dates, null, today)` → `{prev:"2026-11-24", next:null}`.
  - Across the gap: `current "2026-08-25"` → `{prev:"2026-08-08", next:"2026-11-24"}`.
  - Day before today: `current "2026-11-24"` → `next:"today"`.
  - Oldest: `current "2026-08-03"` → `prev:null`.
  - Gap date not in list (Review Focus 4): `current "2026-08-15"` → `{prev:"2026-08-08", next:"2026-08-25"}`.
- [ ] **Step 2: Run** `node --test tests/` — FAIL (file missing).
- [ ] **Step 3: Implement** both functions (ES5 syntax, no build step).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(site): add archive navigation helper`.

### Task 5: Reader UI

**Files:**
- Modify: `site/index.html` (masthead: prev button, date heading wrapping a visually-transparent `<input type="date" id="date-picker">`, next button; `<a id="back-today" href="#" hidden>Back to today</a>`; `<script src="nav.js?v=6" defer>` before `app.js`; bump `?v=6`)
- Modify: `site/app.js` (routing + rendering), `site/styles.css` (arrow buttons ≥44px tap targets, transparent picker overlay, back link)
- Modify: `specs/ui.md` (archive view: from stretch goal to implemented, describe behaviour)

**Interfaces:**
- Consumes: `window.DailyFactsNav.parseHash`, `.neighbours` (Task 4); `archive/index.json` format (Task 3).

- [ ] **Step 1: Implement routing in `app.js`.** On load: fetch `today.json` (unchanged, no-store) and `archive/index.json` (no-store) in parallel; index failure → hide arrows/picker and behave as today (Review Focus 5). `route()` runs on load and `hashchange`: `parseHash(location.hash)`; null or equal to today's date → clear hash with `history.replaceState` and render Today; else fetch `archive/<date>.json` (default caching) and render; 404 or date not in index → clear slots, show status `"No facts for this day."` with arrows still set. Each render clears `#slots` and the status first. Arrows set `location.hash` (`"today"` → `location.hash = ""`). Picker: `min` = first index date, `max` = today's date, `value` = current date; `change` → set hash. Back link visible only on past days; on Today keep existing empty/failed messages exactly.
- [ ] **Step 2: Style** to match the existing calm masthead; arrows hidden via the `hidden` attribute when `prev`/`next` is null.
- [ ] **Step 3: Run** `node --test tests/` — PASS (no regressions). Serve locally: `python3 -m http.server -d site 8000`.
- [ ] **Step 4: Manual check** at 390px width (Chrome device mode or iPhone): Today shows ‹ only; ‹ walks back and skips 2026-08-09…08-24; › from yesterday returns to Today with a clean URL; browser back button retraces; `#2026-08-15` shows "No facts for this day."; `#foo` and `#<today>` show Today; tapping the date opens the native picker; renaming `archive/index.json` temporarily → no arrows, Today renders normally.
- [ ] **Step 5: Update `specs/ui.md`; commit** — `feat(site): browse past days from the archive`.

### Task 6: Wrap-up

- [ ] **Step 1:** `git fetch && git merge origin/main`; `node --test tests/`; `node scripts/validate.mjs`; `node scripts/generate.mjs --dry-run` — all clean.
- [ ] **Step 2:** Report to the owner and **ask** before pushing `develop` or merging into `main` (merging to `main` deploys the site and changes tonight's run).
