# Spec: Data Model & Storage

## Overview

All state is plain JSON, committed to the repo. There is no database and no
runtime backend. This file defines the schema and invariants for every file
under `/content/`, plus the generated output files.

## `content/topics.json`

Per-topic, append-only lists of facts.

```json
{
  "space": {
    "facts": [
      "The first fact ever added to this topic.",
      "The second fact added to this topic."
    ]
  },
  "literature": {
    "facts": ["..."]
  }
}
```

**Rules:**
- Keys are topic ids: lowercase, no spaces (`space`, `ai`, `cooking`).
- `facts` is an ordered array. Order is meaningful — it is the read queue.
- New facts are only ever **appended**. Never insert, reorder, or delete
  existing entries. (Deleting would shift indices out from under
  `progress.json`'s cursors — see below.)
- If a fact genuinely needs to be corrected, edit the string in place rather
  than removing/re-adding it, to preserve its index.
- A topic referenced anywhere in `schedule.json` must exist here, even if
  its `facts` array is currently empty (empty is valid; see generation
  algorithm's handling of empty topics).

## `content/schedule.json`

Defines which slots exist on which days.

```json
{
  "weekdays": {
    "monday": [
      { "slot": "Literature", "topics": ["literature"] },
      { "slot": "Other", "topics": ["ai", "space", "cooking", "cars", "gardening"] }
    ],
    "tuesday": [ ... ],
    "wednesday": [ ... ],
    "thursday": [ ... ],
    "friday": [ ... ],
    "saturday": [ ... ],
    "sunday": [ ... ]
  },
  "dates": {
    "2026-08-15": [
      { "slot": "Anniversary", "topics": ["travel"] }
    ]
  }
}
```

**Rules:**
- `weekdays` must have all seven keys, each an array of slot definitions
  (an empty array is valid — a day with no slots).
- Each slot definition has a `slot` name (display label, not required to be
  unique across the whole file, but should be unique *within* a single
  day's resolved slot list) and a `topics` array of one or more topic ids.
- A slot definition may carry an optional `index`, which **pins** it to one
  exact fact instead of drawing from the queue:
  ```json
  { "slot": "Свято", "topics": ["holidays"], "index": 20 }
  ```
  A pinned slot must name exactly one topic, and the index must be within
  that topic's `facts` array. It exists for date-specific slots where the
  fact has to match the calendar day — a holiday on its actual date, which a
  positional cursor cannot express.
- **A pinned draw never touches `progress.json`.** The fact is not part of
  the read queue, so pinning cannot advance or reorder a cursor, and a missed
  run cannot desync anything. This is only safe because `facts` is
  append-only: an index, once assigned, refers to the same fact forever.
- `dates` entries are **additive**: on a matching calendar date, these
  slots are generated *in addition to* that date's normal weekday slots,
  never in place of them.
- Date keys come in two forms, both interpreted in Europe/Kyiv local date
  terms (see `specs/automation.md` for how "today's date" is determined):
  - **`MM-DD`** — recurring: fires on that day **every year**. This is the
    normal form for an annual fixture such as a holiday.
  - **`YYYY-MM-DD`** — fires once, on that specific day. Use it for a
    year-specific occasion, or for a festival whose date moves between years
    (lunar calendars, "the last Monday of May"), which a recurring key
    cannot express.
  Both may match the same day; like everything under `dates` they are
  additive, and the recurring entry is resolved first.
  Note that `02-29` as a recurring key only fires in leap years.

## `content/progress.json`

The single source of truth for what has been served. Everything else in
the system is either derived from this or additive to it.

```json
{
  "space": { "next_index": 8, "cycled": false },
  "literature": { "next_index": 42, "cycled": true }
}
```

**Rules:**
- One entry per topic that has ever been drawn from. A topic not yet drawn
  from may be absent (treat as `{ next_index: 0, cycled: false }`).
- `next_index`: the index into `topics[topic].facts` that the *next* draw
  from this topic will use.
- `cycled`: set to `true` the first time a draw wraps `next_index` back to
  `0` because it reached the end of the facts array. Never reset to
  `false` automatically — only a manual edit (e.g. after adding enough new
  content that the owner wants to re-arm the flag) changes it back.
- This file is only ever written by the daily generation job. Nothing else
  in the system mutates it.

## Generated output

### `site/today.json`

Snapshot of the current day's resolved slots, written by the daily job.
This is the **only** file the static site reads at runtime.

```json
{
  "date": "2026-08-02",
  "slots": [
    { "slot": "Literature", "topic": "literature", "fact": "...", "repeat": false, "pool": 1 },
    { "slot": "Other", "topic": "space", "fact": "...", "repeat": false, "pool": 5 }
  ]
}
```

`repeat: true` marks a draw that happened after every topic in that slot's
list had already cycled (see `specs/generation-algorithm.md`).

`pool` is how many topics the slot was **configured** to choose between —
`schedule.json`'s `topics` length — not how many were viable on the day.
The UI uses it to decide whether naming the drawn topic tells the reader
anything (see `specs/ui.md`); a pinned slot always reports `1`. It is
written by the generation job and is informational only: nothing reads it
back, so archived files predating the field stay valid.

### `site/archive/YYYY-MM-DD.json`

Optional but recommended: a permanent copy of each day's `today.json`,
named by date, so history isn't lost when `today.json` is overwritten the
next day. Enables a future "past facts" browse view at near-zero cost now.

### Cycle flags / alerts

See `specs/automation.md` for how topic cycling is surfaced to the owner
(flags file vs. GitHub Issue).

## Invariants to preserve

1. `progress.json` cursors are only ever valid relative to the *current*
   contents of `topics.json`. Because facts are append-only, this holds
   permanently — a cursor recorded today stays correct even after 500 more
   facts are added to that topic later.
2. Nothing other than the daily job writes `progress.json`. If this
   invariant is ever broken (e.g. a manual edit), it must be a deliberate,
   understood action — not something the site or another script does
   incidentally.
3. `topics.json`, `schedule.json`, and `progress.json` are portable as-is:
   each maps trivially onto database tables (topic → row, fact → row with
   an index, progress → row per topic) if this ever migrates off flat
   files. No redesign is needed to move host later.

## Deferred: "confirmed read" tracking

Explicitly out of scope for the GitHub Pages implementation, because a
static site cannot write back to the repo without exposing write
credentials in the browser. "Served" (captured in `progress.json` and the
archive) is the tracked signal instead.

If this is added later on a host with a real backend, it is a **new,
independent field** — e.g. a `read_log` keyed by date + slot — added
alongside `progress.json`, not a replacement for it. No existing file
changes shape. This is why the migration is expected to be lossless: the
new backend imports `topics.json` and `progress.json` verbatim and starts
layering read-tracking on top.
