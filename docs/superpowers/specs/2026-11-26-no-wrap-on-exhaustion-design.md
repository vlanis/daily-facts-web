# No wrap on exhaustion — design

Date: 2026-11-26 · Size: small change · Status: approved 2026-11-26

## Intent

When a topic runs out of unread facts, the job must not loop back to fact 0.
Today it wraps (`next_index = 0`, `cycled = true`) and serves repeats, so
facts appended later sit behind a full re-serve of the old ones and the
cursor has to be re-armed by hand (commit `991f28b`, 24 topics). With the
cursor parked at the end instead, appended facts are picked up automatically
— which is what "append-only, cursors never need recomputing" was meant to
guarantee.

## Goals

- An exhausted topic is never drawn from again until new facts are appended.
- Appended facts are served next, with no manual progress edits.
- The owner is still alerted (once) when a topic runs out.

## Non-goals / anti-goals

- No repeats of any kind. Rereading old facts is what the archive view is for
  (see `2026-11-26-archive-browsing-design.md`).
- Pinned (date-specific `index`) slots are unchanged.

## Approaches considered

- **Exhausted slot shows nothing** — chosen by the owner. If every topic in a
  slot is exhausted, that slot is left off the day's page.
- Serve a random old fact marked as a repeat, without moving the cursor —
  rejected; repeats aren't wanted now that past days can be reread.

## Design (changes to `specs/generation-algorithm.md` Step 2 / `generate.mjs`)

- **Exhausted** = `next_index >= facts.length` (derived, not stored).
- **Topic pick:** choose uniformly at random among the slot's topics that are
  *not exhausted* (this also excludes empty topics). The old "fall back to
  the full list as a repeat" branch is removed.
- **No viable topic:** the slot is omitted from `slots` and listed in
  `unresolved` (existing mechanism, already surfaced in the job log). The
  page already ignores `unresolved`, so the slot simply doesn't appear. If
  every slot is unresolved the page shows its existing "Nothing scheduled
  today" message.
- **Advance:** `next_index = index + 1`, no wrap. If it reaches
  `facts.length`, set `cycled = true` and record a newly-exhausted alert
  (same `flags.json` channel as today).
- **Re-arm automatically (my call):** at the start of a run, any topic with
  `cycled: true` but `next_index < facts.length` (new facts were appended)
  gets `cycled = false` and is removed from `flags.json`, so its next
  exhaustion alerts again. This replaces the manual re-arm done in `991f28b`.
- `repeat` stays in the output schema (old archive files have it) but is
  always `false` for new days.
- `cycled` keeps its name in `progress.json` for compatibility; its meaning
  becomes "exhausted, waiting for new facts". Update `specs/data-model.md`,
  `specs/generation-algorithm.md` (Step 2, edge cases, cycle handling) and
  CLAUDE.md decision #5.

## One-time migration (approved by owner 2026-11-26 — `progress.json` is job-owned)

Audit on 2026-11-26 (archive from 2026-08-25 onward vs. cursors): every
other topic's cursor is exact — facts `0..next_index-1` served once, none
skipped. Only the two still-wrapped topics need moving to their end:

| Topic | now | after |
|---|---|---|
| `history_ua` (13 facts) | `next_index: 0, cycled: true` | `next_index: 13, cycled: true` |
| `english_words` (26 facts) | `next_index: 1, cycled: true` | `next_index: 26, cycled: true` |

Both sit in pools with unread topics (English: `english`; History:
`history_ancient`, `history_modern`), so no slot goes empty as a result.

## Verification

- Unit/dry-run: a topic at its last fact → served, then excluded next day;
  slot with all topics exhausted → in `unresolved`, absent from `slots`;
  appending facts to an exhausted topic → next run serves the first new one
  and clears `cycled`.
- Multi-day simulation shows 0 repeats.
