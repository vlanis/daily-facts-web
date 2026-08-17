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
  - The source topic is shown appended to the slot name — "Things —
    Animals" — but **only when it adds information**, which the owner's
    call resolved to two conditions, both required:
    - `pool > 1`, i.e. the slot chose between several topics. A
      single-topic slot would only restate itself ("Technology —
      Technology").
    - The topic's display label differs from the slot name. A multi-topic
      slot can still draw the topic it is named after — slot "Literature"
      drawing `literature` out of a pool of three — which is the same
      repetition arriving from the other direction.
    Topic ids are lowercase/underscored and unfit for a heading, so the
    UI maps them to display labels, falling back to a prettified id for
    any topic not in the map. Roughly a fifth of cards carry the suffix.
  - Do **not** display the `repeat` flag — that is operational metadata,
    not reading content.
- If `unresolved` is present and non-empty, this is operational
  information for the owner, not something to show the reader prominently
  — omit from the default view, or show only in a hidden/owner-only debug
  mode if one gets built.
- If `slots` is empty (a day with nothing scheduled), show a simple,
  unobtrusive empty state rather than a blank page.

## Markup allowed inside a fact

Fact text is plain text carrying three pieces of light markup, and no
others. This is a content-authoring contract as much as a rendering rule:
anything else an author writes appears verbatim.

| Written in the fact | Renders as | Used by |
| --- | --- | --- |
| `**term**` | `<strong>` | `english_words`, `urban_dictionary` |
| `*example*` | `<em>` | `english`, `english_words`, `urban_dictionary` |
| a bare `https://…` URL | `<a target="_blank" rel="noopener noreferrer">` | `painting` and other link-carrying topics |

Rules that keep this safe and predictable:

- **Nothing is ever assigned to `innerHTML`.** Elements are built with
  `createElement` and filled with `textContent`, so HTML written inside a
  fact — `<b>x</b>` — stays literal text and can never become part of the
  page. Any future markup must preserve this.
- **Bold is matched before italics**, otherwise the opening `**` of a bold
  run matches as an italic with an empty body.
- **An unpaired asterisk stays literal.** No attempt is made to guess.
- Trailing sentence punctuation is trimmed off a URL so a link at the end
  of a sentence doesn't swallow the full stop.

Adding a fourth kind of markup means updating the renderer *and* this
table; markup that renders in one topic but not another is the bug this
section exists to prevent.

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

### Asset cache busting

`index.html` references `styles.css?v=N` and `app.js?v=N`. **Bump `N` in
both whenever either file changes.** There is no build step to hash
filenames automatically, so the query string is the only thing that tells
a browser the asset is new.

This matters because the two halves of the page cache very differently.
`today.json` is fetched with a timestamp and `cache: "no-store"`, so the
day's content is always current — but the code rendering it is served by
GitHub Pages with `max-age=600`, and an iOS home-screen shortcut holds it
longer still. Forgetting the bump therefore produces the confusing case
of fresh facts rendered by stale code, which looks like the fix never
deployed. `index.html` itself needs no marker: it is the document being
requested, so it revalidates on its own.

## Error handling

If `today.json` fails to load or is malformed (e.g. the daily job hasn't
run yet on a brand-new deployment, or a run failed), show a simple,
non-alarming fallback message rather than a broken page or console-only
error.
