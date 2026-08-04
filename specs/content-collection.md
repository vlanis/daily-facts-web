# Spec: Content Collection (drafting → topics.json)

## Purpose

Defines how facts are **collected and drafted in bulk** — typically with an
AI agent gathering facts per a query — and how approved drafts are promoted
into `content/topics.json` without ever violating its append-only, positional
invariants.

This is distinct from `specs/content-management.md`, which covers small,
direct hand-edits to `content/*.json`. Content collection is the staged
pipeline that feeds the *same* `topics.json`; both end at the same
append-only store.

## Why a separate drafting layer

`topics.json` is append-only and **positional**: `progress.json`'s
`next_index` cursors point at array offsets, so a published fact's index must
never change (see `specs/data-model.md`). That makes `topics.json` a poor
place to *collect* facts, because collection is inherently mutable — you
reword, reorder, dedupe, re-topic, and cut weak entries.

The drafts layer is the editable staging area that `topics.json` deliberately
is not. A fact is freely mutable while a draft; it becomes frozen only when it
"graduates" into `topics.json` — and it graduates only by being **appended**.

## Storage: per-topic JSONL

Drafts live in the repo, one file per topic:

```
content/drafts/<topic>.jsonl
```

- **The filename is the topic id.** `content/drafts/space.jsonl` holds space
  facts. The topic id must be lowercase, no spaces (same rule as
  `topics.json` keys and `schedule.json` references). There is **no** `topic`
  field inside the lines — the file *is* the topic, so there's nothing to
  keep in sync.
- **Format is JSONL:** one JSON object per line, UTF-8. Blank lines are
  ignored. Each non-blank line must be valid JSON on its own — this is what
  makes appends safe and diffs one-fact-per-line, and it sidesteps CSV's
  comma/quote escaping fragility for fact text full of commas, quotes, and
  characters like "Misérables".

### Line schema

```json
{ "fact": "A day on Venus is longer than its year: 243 Earth days to rotate, 225 to orbit.", "source": "NASA", "status": "approved" }
```

| Field    | Required | Meaning |
|----------|----------|---------|
| `fact`   | yes      | The exact, final wording. The importer copies this **verbatim** into `topics.json`, so it must be reader-ready and self-contained (no "see above"). |
| `status` | yes      | Lifecycle: `draft` → `approved` → `imported` (see below). |
| `source` | no       | Provenance / verification note. Collection metadata only — **never** copied into `topics.json`. |
| `note`   | no       | Free-text working note (e.g. "double-check date"). Collection metadata only. |

Only `fact` ever crosses into `topics.json`. Everything else is drafting
metadata that dies at the bridge.

### Draft-file rules

- Drafts are **fully mutable**: edit wording, reorder lines, delete a line,
  split into a different topic file — all fine, because nothing positional
  depends on drafts. (This is the opposite of `topics.json`.)
- No duplicate `fact` strings within a topic file (the importer dedupes
  anyway, but keep drafts clean).
- Drafts are committed to the repo (versioned and reviewable) — they are not
  gitignored.

## Lifecycle: draft → approved → imported

- **`draft`** — collected but not yet vetted. Ignored by the importer.
- **`approved`** — reviewed and cleared to publish. The importer promotes
  these.
- **`imported`** — the importer has appended this fact to `topics.json`. Set
  by the importer, not by hand. Signals "already published; don't re-review."

## The bridge: `scripts/import-drafts.mjs` (importer contract)

The importer is the **only** sanctioned way a draft reaches `topics.json`
(mirroring how only the daily job writes `progress.json`). Contract:

**Inputs:** all `content/drafts/*.jsonl`, plus current `content/topics.json`.

**Behaviour:**
1. For each draft file, derive the topic id from the filename.
2. Parse each line as JSON. A malformed line is a **hard error** naming the
   file and line number — fail fast, do not skip silently (consistent with
   `generate.mjs` / `validate.mjs`).
3. For each line with `status == "approved"`:
   - If the topic key is absent from `topics.json`, create it with an empty
     `facts` array.
   - If the `fact` string is **not already present** in that topic's `facts`
     (exact-string match), **append it to the end**. Never insert earlier,
     reorder, or remove existing entries.
   - Mark the draft line `status: "imported"` (rewrite the draft file).
4. Write `topics.json` (2-space indent, trailing newline).

**Invariants:**
- **Append-only into `topics.json`.** Existing entries and their indices are
  never touched, so `progress.json` cursors stay valid (see
  `specs/data-model.md`).
- **Idempotent.** Re-running promotes nothing already imported, and the
  exact-string dedupe is a second safety net if `status` drifts.
- **Never touches `progress.json` or `schedule.json`.**

**Output / reporting:** print per-topic counts of appended facts, skipped
duplicates, and any **newly created topics** — with a reminder that a new
topic is not served until it's referenced by a slot in `schedule.json`.

## End-to-end workflow

1. The collecting agent appends facts to the right `content/drafts/<topic>.jsonl`,
   one object per line, `status: "draft"` (or `"approved"` if already vetted),
   filling `source` for verification.
2. Review drafts; set vetted lines to `status: "approved"`.
3. `node scripts/import-drafts.mjs` — appends approved facts to `topics.json`
   and marks those draft lines `imported`.
4. If new topics were created, add them to one or more slots in
   `schedule.json` so they can actually be drawn.
5. `node scripts/validate.mjs` — confirms schedule references resolve, no
   empty slot topic lists, no duplicate facts, valid shapes.
6. Commit the `content/` changes.

## Guidance for the collecting agent

- Write the `fact` as final, self-contained reader copy — it goes to the site
  verbatim.
- Append to the **per-topic** file; keep each fact on its own line as one JSON
  object. Don't rewrite the whole file — append.
- Fill `source` so facts can be verified before approval; prefer `draft`
  status unless explicitly told a batch is pre-vetted.
- Avoid duplicates: a fact already present in the topic's draft file **or** in
  `content/topics.json` should not be re-added.
- **Never** edit `content/topics.json`, `content/progress.json`, or
  `content/schedule.json` directly — the importer owns promotion into
  `topics.json`, and the other two are out of scope for collection.
