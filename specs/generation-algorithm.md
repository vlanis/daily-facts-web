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
3. If `schedule.json.dates[<date>]` exists, append those slot definitions
   to the list (additive — see `specs/data-model.md`).
4. The result is an ordered list of `{ slot, topics }` pairs to resolve,
   in the order they appear (weekday slots first, then any date-specific
   ones).

If the resolved list is empty, `today.json` is written with an empty
`slots` array. This is valid (a day with nothing scheduled).

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
1. **Filter to un-cycled topics.** From `topics`, build the subset where
   `progress[topic].cycled` is `false` (or the topic has no progress entry
   yet, which counts as not cycled).
   - Also exclude any topic whose `facts` array in `topics.json` is
     currently empty — it has nothing to draw regardless of cycled state.
2. **Pick the topic to draw from:**
   - If the filtered (un-cycled, non-empty) subset is non-empty, pick one
     topic uniformly at random from it. This draw is **not** a repeat.
   - Otherwise, fall back to the full `topics` list, excluding only
     currently-empty topics. Pick one uniformly at random. This draw
     **is** a repeat (`repeat: true` in the output).
   - If every topic in the slot's list has an empty `facts` array (no
     content at all for this slot), skip the slot entirely and record it
     as unresolved (see "Edge cases" below) rather than erroring the whole
     run.
3. **Draw the fact:**
   - `index = progress[topic].next_index` (default `0` if absent)
   - `fact = topics[topic].facts[index]`
4. **Advance the cursor:**
   - `next_index = index + 1`
   - If `next_index >= length(topics[topic].facts)`: wrap `next_index` to
     `0` and set `cycled = true`.
   - Otherwise leave `cycled` as-is (do not clear a previously-set `true`
     — cycling is sticky until manually reset).
   - Write these back into the in-memory progress state immediately, so
     subsequent slots in the same run see the update.
5. **Record the result:** `{ slot, topic, fact, repeat }` appended to
   today's output.

## Step 3: Write outputs

- `site/today.json`: `{ date, slots: [...] }` as defined in
  `specs/data-model.md`.
- `site/archive/<date>.json`: identical content, permanent copy.
- `content/progress.json`: the fully updated progress state from Step 2.
- Commit all three in a single commit (see `specs/automation.md`).

## Edge cases

- **Slot with no viable topic (all empty):** omit from `today.json`'s
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
- **A slot's topic list becomes fully cycled:** every future draw from
  that slot is a `repeat: true` draw until new facts are added to at least
  one of its topics. This is expected, visible behavior, not an error
  state.

## Cycle handling / alerting

Whenever Step 2 sets `cycled` from `false` to `true` for a topic during a
run, record that transition. At the end of the run, if any topics newly
cycled, surface it — see `specs/automation.md` for the mechanism
(flags file vs. GitHub Issue). This should happen once per transition, not
repeat on every subsequent run while the topic remains cycled.
