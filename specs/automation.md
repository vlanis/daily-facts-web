# Spec: Automation (GitHub Actions)

## Purpose

Defines the scheduled job that runs the generation algorithm daily, how
"today's date" is determined, how results are committed, and how cycle
alerts are surfaced. This is the only automated write path in the system.

## Branches

`main` is production. It is the repository's **default branch**, which is
what makes the daily job work at all: GitHub only runs `schedule:`
triggers on the default branch, so whichever branch is default is the one
that generates facts. `deploy-pages.yml` also publishes from `main`.

`develop` is the working branch. Content and code changes are made there
and merged into `main` to release.

**The sync is two-way, and that is the part worth remembering.** The daily
job commits `progress.json`, `today.json` and a new archive entry straight
to `main` every night, so `main` moves ahead on its own without anyone
touching it. Consequences:

- Before starting work on `develop`, merge `main` into it. Otherwise the
  release merge conflicts on `progress.json`, which both sides will have
  changed.
- Never resolve such a conflict by taking `develop`'s copy of
  `progress.json`. `main`'s is the live cursor state; overwriting it
  re-serves facts that were already published. See `specs/data-model.md`.
- A release is `develop` -> `main`. Pull `main` first; the push will be
  rejected otherwise, since the bot has almost certainly moved it.

`validate-content.yml` runs on pull requests, so a `develop` -> `main` PR
is checked before it can break a night's generation.

## Workflow trigger

A single daily `schedule` cron trigger, approximating midnight in
Europe/Kyiv:

```yaml
on:
  schedule:
    - cron: '0 22 * * *'   # ~00:00 Kyiv time (UTC+2 standard time)
  workflow_dispatch: {}     # manual re-run, for testing/recovery
```

**Explicitly accepted, not engineered around:**
- During EEST (UTC+3, roughly late March–late October) this runs at
  ~01:00 Kyiv time instead of 00:00 — a fixed ~1 hour drift.
- GitHub Actions scheduled triggers are not guaranteed to fire at the
  exact minute and can be delayed, especially under platform load.

Neither of these needs handling in the workflow logic. No timezone
library, no "did I already run today" polling check — one cron line is
sufficient given these are accepted tolerances.

`workflow_dispatch` is included so a run can be triggered manually (e.g.
to test a schedule/content change, or recover from a rare missed run)
without waiting for the next scheduled trigger.

## What "today" means inside the job

The job computes the current date in the `Europe/Kyiv` timezone (not
server/UTC date) once, at the start of the run, and uses that single value
throughout — for choosing the weekday's slots, checking `dates` overrides,
and naming the archive file. Use the runtime's timezone-aware date
handling (e.g. a proper timezone library/API) rather than a hardcoded
UTC+2/UTC+3 offset, so this stays correct without maintenance.

## Job steps

1. Checkout the repo.
2. Set up the runtime (language/tooling per implementation choice).
3. Run the generation script (`scripts/generate.*`), which:
   - Reads `content/topics.json`, `content/schedule.json`,
     `content/progress.json`.
   - Computes today's Kyiv-local date.
   - Runs the algorithm in `specs/generation-algorithm.md`.
   - Writes `site/today.json`, `site/archive/<date>.json`, updates
     `content/progress.json`.
   - If any topic newly cycled this run, writes/updates a cycle alert
     (see below).
4. Commit changed files with a clear message, e.g.
   `chore: generate facts for 2026-08-02`.
   - Use a bot identity for the commit author (standard
     `github-actions[bot]` pattern) — no personal token needed for this,
     the workflow's default `GITHUB_TOKEN` with `contents: write`
     permission is sufficient.
5. Push directly to the default branch. (No PR needed — this is a fully
   trusted, deterministic automated write; keeping it simple is fine given
   the low stakes.)

## Permissions

```yaml
permissions:
  contents: write
  issues: write   # only needed if using the GitHub Issue alert mechanism
```

Scoped to the workflow's built-in token — no personal access token, no
secret to manage.

## Cycle alerting

Two viable mechanisms; pick one during implementation:

**Option 1 — Flags file (simpler):**
The script maintains `content/flags.json`, e.g.
```json
{ "cycled_topics": ["space"] }
```
appended to (not overwritten) whenever a new topic cycles. The owner
checks this file manually/occasionally. No extra permissions needed.

**Option 2 — GitHub Issue (more visible):**
On a newly-cycled topic, the script opens a GitHub Issue (or comments on a
standing "Content Status" issue) noting which topic ran out and when. This
surfaces as a normal GitHub notification, which is easy to notice without
remembering to check a file. Requires `issues: write` permission.

Recommendation: start with Option 1 for simplicity; upgrade to Option 2 if
flags in a file prove easy to forget to check.

## Idempotency / recovery notes

If a scheduled run fails (network blip, transient error) with no run at
all that day, there's no self-healing built in per the "no need to target
midnight precisely" decision — a missed day just means no `today.json`
update for that day. Recovery is a manual `workflow_dispatch` trigger.
This is acceptable given the low stakes of the content.

## What this workflow does *not* do

- No write path from the public site back into the repo (see
  `specs/data-model.md`'s "Deferred: confirmed read tracking").
- No content validation on push to `content/*.json` in this spec — see
  `specs/content-management.md` for whether/how that's added separately.
