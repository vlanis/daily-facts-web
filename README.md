# Daily Facts

A personal, zero-cost static website that shows a curated set of "interesting
facts" each day, grouped into named slots (e.g. "Literature", "Other"), pulled
from topic-based content pools. It replaces a manual Google Calendar workflow
with a purpose-built site and a proper content pipeline — no backend, no
database, no hosting bill.

Primary reader: one person, on an iPhone, checking in roughly daily.

## How it works

The system is split into two halves that never write to each other at runtime:

- **A daily generation job** (GitHub Actions, one cron run per day) decides
  today's facts per the schedule and the generation algorithm, writes a static
  `site/today.json` plus a dated archive entry, updates the read cursors in
  `content/progress.json`, and commits the result back to the repo.
- **A purely static site** (GitHub Pages) that reads `site/today.json` at load
  time and renders it. No auth, no backend calls, no client-side write-backs.

All state is plain JSON committed to the repo. `content/progress.json` is the
single source of truth for what has already been served; everything else is
derived from or additive to it. Facts are append-only per topic, so read
cursors never need recomputing as content grows.

## Repo layout

```
content/
  topics.json      # per-topic fact lists (append-only)
  schedule.json    # weekday slots + date-specific additional slots
  progress.json    # per-topic read cursor + cycled flag (source of truth)
  flags.json       # cycle alerts (which topics have run out of fresh facts)
site/
  index.html       # static reader (mobile-first)
  app.js
  styles.css
  today.json       # generated: current day's resolved slots
  archive/         # generated: YYYY-MM-DD.json per-day history
scripts/
  generate.mjs     # daily generation logic (run by the workflow / locally)
  validate.mjs     # content validation (schedule refs, empty slots, JSON)
.github/workflows/
  daily-generate.yml
CLAUDE.md          # full project overview + design decisions
specs/             # per-area specifications (source of truth for detail)
```

## Running locally

The generation and validation scripts are plain Node.js (no dependencies):

```bash
node scripts/validate.mjs      # check content files are well-formed
node scripts/generate.mjs      # generate today's facts (uses Europe/Kyiv date)
```

`generate.mjs` accepts an optional `--date=YYYY-MM-DD` override for testing a
specific day without waiting for the scheduled trigger.

## Where the detail lives

This README is just an orientation page. The authoritative detail is in:

- [`CLAUDE.md`](CLAUDE.md) — project overview and every architectural decision
  (and why).
- [`specs/`](specs/) — per-area specs, each readable in isolation:
  `data-model.md`, `generation-algorithm.md`, `automation.md`, `ui.md`,
  `content-management.md`.
