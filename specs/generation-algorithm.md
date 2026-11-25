# Spec: Daily Generation Algorithm

## Purpose

Defines exactly how "today's slots" are resolved into concrete facts. This
runs once per day, inside the GitHub Actions job described in
`specs/automation.md`, and is the only process allowed to mutate
`content/progress.json`.

## Inputs

- `content/topics.json`
- `content/schedule.json`
- `content/progress.json`
- The current date, as a Kyiv-local calendar date (see
  `specs/automation.md` for how this is computed)

## Output

- `site/today.json` (overwritten)
- `site/archive/<date>.json` (new file, one per day)
- Updated `content/progress.json`, committed back to the repo
- Any cycle alerts (see "Cycle handling" below)

## Step 1: Resolve today's slot list

1. Determine today's weekday name (e.g. `"monday"`) and full date
   (`YYYY-MM-DD"`) from the Kyiv-local date.
2. Start with `schedule.json.weekdays[<weekday>]`.
3. Append any matching `dates` entries (additive — see
   `specs/data-model.md`). Two key forms are checked, recurring first:
   `schedule.json.dates[<MM-DD>]`, which fires every year, then
   `schedule.json.dates[<YYYY-MM-DD>]`, which fires once. Both may match
   the same day.
4. The result is an ordered list of `{ slot, topics }` pairs to resolve,
   in the order they appear (weekday slots first, then any date-specific
   ones).

If the resolved list is empty, `today.json` is written with an empty
`slots` array. This is valid (a day with nothing scheduled).

## Step 1b: Re-arm topics that received new facts

Before resolving slots, any topic with `cycled: true` whose `next_index` is
now below its fact count (facts were appended since it ran out) gets
`cycled` set back to `false`, and is removed from `content/flags.json`
so its next exhaustion is flagged again. This is automatic; nobody edits
`progress.json` to re-arm a topic.

## Step 2: Resolve each slot, in order, sequentially

Slots are processed **one at a time, in list order**, and each draw
immediately updates the in-memory progress state before the next slot is
resolved. This is what prevents the same fact being served twice on the
same day, even if two slots share a topic.

For each slot `{ slot, topics }`:

0. **If the slot carries an `index`, it is pinned.** Serve
   `topics[<the one topic>].facts[index]` directly and stop — no random
   pick, no cursor read, and crucially **no cursor write**. If that index is
   out of range, record the slot as unresolved rather than serving
   `undefined`. Pinned slots exist for date-specific entries where the fact
   must match the calendar day (see `specs/data-model.md`); because they stay
   out of the read queue entirely, a missed run cannot desync them, and the
   same fact is served every time that date comes round.
1. **Filter to topics with unread facts.** A topic is **exhausted** when
   `progress[topic].next_index >= length(topics[topic].facts)` (a missing
   progress entry counts as `next_index: 0`, so an empty topic is
   exhausted too). Build the subset of the slot's topics that are not
   exhausted.
2. **Pick the topic to draw from:**
   - If that subset is non-empty, pick one topic uniformly at random from
     it.
   - Otherwise there is nothing unread anywhere in the slot: skip the slot
     and record it as unresolved (see "Edge cases" below). There are no
     repeat draws — an exhausted topic is never re-served, and past days
     stay readable in the archive. `repeat` is therefore always `false`
     in new output; the field is kept so older archive files stay valid.
3. **Draw the fact:**
   - `index = progress[topic].next_index` (default `0` if absent)
   - `fact = topics[topic].facts[index]`
4. **Advance the cursor:**
   - `next_index = index + 1`
   - No wrap. If `next_index >= length(topics[topic].facts)`, the cursor
     stays parked at the end and `cycled` is set to `true` (the topic is
     exhausted). Facts appended later sit exactly at that cursor, so they
     are the next ones served — no cursor ever needs recomputing.
   - Write these back into the in-memory progress state immediately, so
     subsequent slots in the same run see the update.
5. **Record the result:** `{ slot, topic, fact, repeat, pool }` appended to
   today's output, where `pool` is the number of topics the slot listed in
   `schedule.json` (not the filtered count from step 1 — it describes how
   the slot was configured, not what survived filtering). A pinned slot
   reports `pool: 1`. See `specs/data-model.md`.

## Step 3: Write outputs

- `site/today.json`: `{ date, slots: [...] }` as defined in
  `specs/data-model.md`.
- `site/archive/<date>.json`: identical content, permanent copy.
- `content/progress.json`: the fully updated progress state from Step 2.
- Commit all three in a single commit (see `specs/automation.md`).

## Edge cases

- **Slot with no viable topic (every topic exhausted or empty):** omit from `today.json`'s
  `slots` array, but include it in a separate `unresolved` array in the
  same file (or in the cycle-alert channel) so it's visible rather than
  silently missing:
  ```json
  { "date": "...", "slots": [...], "unresolved": ["Literature"] }
  ```
- **A topic listed in a slot but missing from `topics.json` entirely:**
  treat as empty for the purposes of this run; this should also be caught
  by content validation (see `specs/content-management.md`) so it ideally
  never reaches the generation step.
- **Same topic appears in two different slots the same day:** allowed and
  expected (e.g. a dedicated "Literature" slot and an "Other" pool that
  includes literature). Sequential processing (Step 2) guarantees the
  second draw gets the next fact in queue, never a duplicate.
- **A slot's topic list becomes fully exhausted:** the slot is left off
  every day's page (and listed in `unresolved`) until new facts are
  appended to at least one of its topics. This is expected, visible
  behavior, not an error state.

## Cycle handling / alerting

Whenever Step 2 sets `cycled` from `false` to `true` for a topic during a
run (the topic just served its last fact), record that transition. At the end of the run, if any topics newly
cycled, surface it — see `specs/automation.md` for the mechanism
(flags file vs. GitHub Issue). This should happen once per transition, not
repeat on every subsequent run while the topic remains cycled.
