# Daily Facts — Project Overview

## What this is

A personal, static website that shows a curated set of "interesting facts" each
day, grouped into named slots (e.g. "Literature", "Other"), pulled from
topic-based content pools. It replaces a manual Google Calendar workflow with
a purpose-built site and a proper content pipeline, while staying on
free infrastructure with no backend.

Primary reader: one person, on an iPhone, checking the site roughly daily.
Primary content maintainer: the project owner, editing content via the repo.

## Goals

- Cleaner, purpose-built UI than a calendar-event hack.
- Multiple facts per day, grouped into named slots, each slot pulling from
  one or more topics.
- Content can be extended (new facts, new topics) at any time without
  resetting what's already been read/served.
- Schedule (which topics feed which slots, on which days) is editable
  independently of content.
- Zero-cost hosting, no server to run.

## Non-goals (for now)

- No "confirmed read" tracking — see `specs/data-model.md` for why this is
  deliberately deferred, and how it can be added later without a redesign.
- No user accounts, no multi-reader support.
- No CMS UI hosted on the public site — content editing happens in the repo.

## Architecture at a glance

- **Hosting:** GitHub Pages (static site) + GitHub Actions (scheduled job).
- **Content & state:** plain JSON files committed to the repo. No database.
- **Generation:** a scheduled GitHub Actions workflow runs once a day,
  decides today's facts per the schedule + generation algorithm, writes a
  static `today.json` (and an archive log entry), and commits the result.
- **Site:** a purely static page that reads `today.json` at load time.
  No client-side write-backs, no auth, no backend calls of any kind.

This split means the site itself is trivial and can't break the data; all
the interesting logic lives in the daily generation job, which is the only
thing that ever mutates state.

## Repo structure (target)

```
/content/
  topics.json      # per-topic fact lists (append-only)
  schedule.json     # weekday slots + date-specific additional slots
  progress.json      # per-topic read cursor + cycled flag (source of truth)
/site/
  index.html / app.js / today.json  # static reader
  archive/YYYY-MM-DD.json            # optional per-day history
/scripts/
  generate.*        # daily generation logic, run by the workflow
/.github/workflows/
  daily-generate.yml
CLAUDE.md
specs/
  data-model.md
  generation-algorithm.md
  automation.md
  ui.md
  content-management.md
```

## Key design decisions (and why)

1. **`progress.json` is the single source of truth for "what's been served."**
   Everything else (`today.json`, archive logs, UI) is derived from or
   additive to it. Nothing infers progress by re-scanning history. This is
   what makes future migration to a real backend safe — see
   `specs/data-model.md`.

2. **Facts are append-only, per topic.** New content is always added to the
   end of a topic's fact list. Existing cursor positions (`next_index`)
   therefore never need to be recomputed when content grows.

3. **Slots, not topics, are the unit of daily schedule.** A slot has a name
   and a list of eligible topics; the generation algorithm resolves "which
   topic, which fact" at run time. This is what allows a slot like "Other"
   to pull from a pool of topics.

4. **Unread-preferring draw, not pure random.** Within a slot's topic list,
   topics that haven't exhausted their fact list are preferred over ones
   that have already cycled, so a slot doesn't keep re-serving repeats from
   one burned-through topic while others sit unused. Full rules in
   `specs/generation-algorithm.md`.

5. **Cycling is tracked and flagged, not silently looped.** When a topic
   runs out of unread facts, it wraps to index 0 and sets `cycled: true`,
   and the workflow surfaces this so the owner knows to add more content.

6. **Additional per-date slots are additive, not overriding.** A specific
   calendar date can add extra slots on top of that weekday's normal
   schedule (e.g. an anniversary), never replace it.

7. **No "confirmed read" tracking on GitHub Pages.** A static site can't
   write back to the repo without exposing write credentials in the
   browser, which is unnecessary fragility for what this app needs.
   "Served" (already tracked via `progress.json` and the archive log) is
   the operative signal. See `specs/data-model.md` for the migration path
   if this changes later.

8. **Scheduling is a plain daily cron, not a timezone-aware polling job.**
   The workflow runs once a day at a fixed UTC time approximating midnight
   in Kyiv. Drift from DST (~1 hour) and normal GitHub Actions scheduling
   slack are accepted, not engineered around.

## How to use the spec files

Each file in `specs/` is meant to be readable and buildable in isolation.
When implementing, work spec-by-spec rather than the whole system at once:
`data-model.md` first (it's the foundation everything else depends on),
then `generation-algorithm.md`, then `automation.md` and `ui.md` in
either order, and `content-management.md` last since it's tooling around
an already-working core.
