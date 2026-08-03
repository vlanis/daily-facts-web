# Spec: Web Page UI

## Purpose

Defines the static site that displays today's facts. This is intentionally
the simplest layer in the system — it reads one JSON file and renders it.
No backend calls, no auth, no write-back, no client-side state that
matters beyond the current page view.

## Primary user & context

One reader, on an iPhone, checking in roughly daily. Design for a quick,
pleasant glance — not a dashboard, not a power-user tool.

## Data dependency

The page loads `site/today.json` (same-origin static file, produced by the
daily job per `specs/automation.md` / `specs/data-model.md`) on page load.
That's the only data source. No other file under `content/` or `site/` is
fetched by the client at runtime.

## Core screen: Today

- Render `date` from `today.json` in a friendly format.
- Render each entry in `slots` as a card/section:
  - Slot name (e.g. "Literature") as a small label/heading.
  - The fact text as the primary content.
  - Do **not** display the `repeat` flag or `topic` id to the reader by
    default — those are operational metadata, not reading content. (Fine
    to expose `topic` subtly, e.g. a small tag, if it adds to the
    reading experience — owner's call during implementation, not a hard
    requirement.)
- If `unresolved` is present and non-empty, this is operational
  information for the owner, not something to show the reader prominently
  — omit from the default view, or show only in a hidden/owner-only debug
  mode if one gets built.
- If `slots` is empty (a day with nothing scheduled), show a simple,
  unobtrusive empty state rather than a blank page.

## Non-goals for the core screen

- No "mark as read" interaction (see `specs/data-model.md` — deferred).
- No editing of any kind.
- No topic/schedule browsing UI — that's a repo-editing concern, see
  `specs/content-management.md`.

## Optional stretch: Archive / past facts view

Since `site/archive/<date>.json` is produced daily at near-zero marginal
cost, a simple "browse past days" view is a natural low-cost addition:
a date picker or simple list linking to each archived day, rendered with
the same card layout as Today. Not required for v1; flag as a fast-follow
rather than blocking initial launch.

## Visual design

- Mobile-first; the primary and possibly only viewport that matters is a
  phone screen. Keep layout simple enough that no separate mobile
  treatment is needed.
- Clean and calm — this is a "read a nice fact" moment, not a data-dense
  UI. Favor generous spacing and legible type over density.
- No requirement for a design system or component library; a single
  static HTML page with its own CSS is sufficient given the scope.

## Adding to iPhone Home Screen

Since this is meant to be checked routinely, the site should behave
reasonably when added to the Home Screen via Safari's "Add to Home
Screen" (sensible `<title>`, a simple icon/`apple-touch-icon`, and
`viewport` meta tag). This isn't a PWA requirement in the strict sense
(no offline support, no service worker needed) — just enough for a decent
icon and launch experience.

## Tech approach

No framework required — a single static HTML page with vanilla JS
`fetch('today.json')` and simple templating is sufficient for this scope,
and keeps GitHub Pages hosting trivial (no build step needed). A build
step (bundler, framework) is not precluded if preferred, but should be
treated as a deliberate choice, not a default, given the actual
complexity of what's being rendered.

## Error handling

If `today.json` fails to load or is malformed (e.g. the daily job hasn't
run yet on a brand-new deployment, or a run failed), show a simple,
non-alarming fallback message rather than a broken page or console-only
error.
