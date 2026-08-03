# Spec: Content Management

## Purpose

Defines how the project owner adds/edits facts, topics, and schedule
entries over time, and what guardrails keep those edits from silently
corrupting `progress.json`'s cursors or breaking generation.

This tooling is for the owner only — it is not hosted on the public site
(see `specs/ui.md`'s non-goals).

## Editing surface

All content edits happen directly against the repo's `content/*.json`
files — via a normal git workflow (edit, commit, push/PR), optionally
assisted by a small local script. There is no hosted admin UI.

## Common editing operations

### Add facts to an existing topic
Append new strings to the end of `topics[topic].facts` in
`content/topics.json`. Never insert earlier in the array or remove
existing entries (see `specs/data-model.md`'s append-only rule).

### Add a new topic
1. Add a new key under `topics.json` with a `facts` array.
2. Reference it from one or more slots in `schedule.json` wherever it
   should be eligible to be drawn.
3. No `progress.json` entry is needed upfront — the generation algorithm
   treats a missing entry as `{ next_index: 0, cycled: false }`.

### Adjust the schedule
Edit `schedule.json` directly — add/remove/rename slots per weekday, or
add a `dates` entry for a specific day. This never touches
`topics.json` or `progress.json`, so it cannot affect what's already been
served; it only changes what gets pulled going forward.

### Re-arm a cycled topic
`progress.json`'s `cycled: true` is sticky by design (see
`specs/generation-algorithm.md`). After adding enough new facts to a
topic that the owner wants it treated as "fresh" again, manually set that
topic's `cycled` back to `false` in `content/progress.json`. This is the
one field in that file expected to be hand-edited occasionally; everything
else in it is machine-managed.

## Recommended validation (script or CI check)

Not required for a working system, but cheap and worth having given how
easy it is to silently break the generation job with a typo:

- `schedule.json` references only topic ids that exist in `topics.json`.
- No slot definition has an empty `topics` array.
- `topics.json` facts arrays contain no exact-duplicate strings within the
  same topic (catches copy-paste mistakes; not a hard requirement, just a
  lint).
- Valid JSON / valid against the shapes defined in
  `specs/data-model.md`.

Suggested implementation: a small script runnable locally before
committing, and optionally the same script run as a GitHub Actions check
on pull requests that touch `content/*.json` — separate from the daily
generation workflow in `specs/automation.md`.

## What NOT to hand-edit

- `site/today.json` and `site/archive/*.json` — fully generated, edits
  will be overwritten by the next run.
- `progress.json`'s `next_index` values — hand-editing these can cause a
  fact to be skipped or re-served; the only field in this file meant for
  manual edits is `cycled` (see above).
