#!/usr/bin/env node
// Daily Facts — generation script.
//
// Resolves today's scheduled slots into concrete facts per
// specs/generation-algorithm.md, using the Europe/Kyiv local date per
// specs/automation.md. This is the ONLY process that mutates
// content/progress.json.
//
// Usage:
//   node scripts/generate.mjs                 # generate for today (Kyiv date)
//   node scripts/generate.mjs --date=2026-08-15   # generate for a specific date
//   node scripts/generate.mjs --dry-run       # compute + print, write nothing
//
// Exits non-zero only on hard errors (unreadable/invalid inputs). A day with
// no scheduled slots, or slots with no viable content, is a valid outcome and
// is surfaced in the output rather than treated as an error.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = join(ROOT, "content");
const SITE = join(ROOT, "site");

const WEEKDAYS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
];

// ---------------------------------------------------------------------------
// Date handling
// ---------------------------------------------------------------------------

// Returns { date: "YYYY-MM-DD", weekday: "monday" } for the given instant in
// Europe/Kyiv, using the runtime's timezone database (no hardcoded offset).
function kyivToday(now = new Date()) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // en-CA yields YYYY-MM-DD

  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Kyiv",
    weekday: "long",
  })
    .format(now)
    .toLowerCase();

  return { date, weekday };
}

// For an explicit --date override, derive the weekday from the calendar date
// itself (anchored at UTC noon to avoid any offset ambiguity).
function weekdayForDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) throw new Error(`--date must be YYYY-MM-DD, got: ${dateStr}`);
  const [, y, mo, d] = m.map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, 12));
  return WEEKDAYS[dt.getUTCDay()];
}

// ---------------------------------------------------------------------------
// IO helpers
// ---------------------------------------------------------------------------

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Failed to read/parse ${path}: ${err.message}`);
  }
}

function writeJSON(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Core algorithm
// ---------------------------------------------------------------------------

function pickUniform(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Resolves the ordered slot list for the day: weekday slots first, then any
// additive date-specific slots.
function resolveSlotList(schedule, weekday, date) {
  const weekdaySlots = schedule.weekdays?.[weekday] ?? [];
  const dateSlots = schedule.dates?.[date] ?? [];
  return [...weekdaySlots, ...dateSlots];
}

function factsFor(topics, topicId) {
  const facts = topics[topicId]?.facts;
  return Array.isArray(facts) ? facts : [];
}

// Resolves a single slot against the live in-memory progress state, mutating
// progress for the drawn topic. Returns { resolved } or { unresolved: slotName }.
function resolveSlot(slotDef, topics, progress, newlyCycled) {
  const { slot, topics: topicIds, index: pinned } = slotDef;

  // A pinned slot names one exact fact rather than drawing from the queue —
  // used by date-specific slots, where the fact has to match the calendar day
  // (a holiday on its actual date). It deliberately does NOT touch progress:
  // the fact is not part of the read queue, so a pinned slot can never shift
  // a cursor, and a missed run cannot desync anything. Safe because
  // topics.json is append-only, which makes an index permanent.
  if (pinned !== undefined) {
    const topic = topicIds[0];
    const fact = factsFor(topics, topic)[pinned];
    if (fact === undefined) return { unresolved: slot };
    return { resolved: { slot, topic, fact, repeat: false, pinned: true } };
  }

  const nonEmpty = topicIds.filter((t) => factsFor(topics, t).length > 0);
  if (nonEmpty.length === 0) {
    // No content at all for this slot — skip, but surface it.
    return { unresolved: slot };
  }

  const unCycledNonEmpty = nonEmpty.filter(
    (t) => progress[t]?.cycled !== true,
  );

  let topic;
  let repeat;
  if (unCycledNonEmpty.length > 0) {
    topic = pickUniform(unCycledNonEmpty);
    repeat = false;
  } else {
    // Every viable topic has already cycled — a repeat draw.
    topic = pickUniform(nonEmpty);
    repeat = true;
  }

  const facts = factsFor(topics, topic);
  const entry = progress[topic] ?? { next_index: 0, cycled: false };
  const index = entry.next_index ?? 0;
  const fact = facts[index];

  // Advance the cursor immediately so later slots this run see the update.
  let nextIndex = index + 1;
  let cycled = entry.cycled === true;
  if (nextIndex >= facts.length) {
    nextIndex = 0;
    if (!cycled) {
      cycled = true;
      newlyCycled.add(topic); // false -> true transition, recorded once
    }
  }
  progress[topic] = { next_index: nextIndex, cycled };

  return { resolved: { slot, topic, fact, repeat } };
}

function generate({ date, weekday, topics, schedule, progress }) {
  const slotList = resolveSlotList(schedule, weekday, date);
  const slots = [];
  const unresolved = [];
  const newlyCycled = new Set();

  for (const slotDef of slotList) {
    const result = resolveSlot(slotDef, topics, progress, newlyCycled);
    if (result.unresolved) unresolved.push(result.unresolved);
    else slots.push(result.resolved);
  }

  const today = { date, slots };
  if (unresolved.length > 0) today.unresolved = unresolved;

  return { today, progress, newlyCycled: [...newlyCycled], unresolved };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const dateArg = args.find((a) => a.startsWith("--date="))?.slice("--date=".length);
  const dryRun = args.includes("--dry-run");

  const { date, weekday } = dateArg
    ? { date: dateArg, weekday: weekdayForDate(dateArg) }
    : kyivToday();

  const topics = readJSON(join(CONTENT, "topics.json"));
  const schedule = readJSON(join(CONTENT, "schedule.json"));
  const progress = readJSON(join(CONTENT, "progress.json"));

  const { today, newlyCycled, unresolved } = generate({
    date,
    weekday,
    topics,
    schedule,
    progress,
  });

  // Merge newly cycled topics into flags.json (append-only, unique).
  const flagsPath = join(CONTENT, "flags.json");
  let flags;
  try {
    flags = readJSON(flagsPath);
  } catch {
    flags = { cycled_topics: [] };
  }
  const cycledSet = new Set(flags.cycled_topics ?? []);
  for (const t of newlyCycled) cycledSet.add(t);
  flags.cycled_topics = [...cycledSet];

  // Report to stdout (surfaces in the workflow log).
  console.log(`Daily Facts generation — ${date} (${weekday})`);
  console.log(`  slots resolved: ${today.slots.length}`);
  for (const s of today.slots) {
    console.log(`    [${s.slot}] <${s.topic}>${s.repeat ? " (repeat)" : ""}`);
  }
  if (unresolved.length > 0) {
    console.log(`  UNRESOLVED (no content): ${unresolved.join(", ")}`);
  }
  if (newlyCycled.length > 0) {
    console.log(`  NEWLY CYCLED (add more facts): ${newlyCycled.join(", ")}`);
  }

  if (dryRun) {
    console.log("\n--dry-run: no files written.\n");
    console.log(JSON.stringify(today, null, 2));
    return;
  }

  writeJSON(join(SITE, "today.json"), today);
  writeJSON(join(SITE, "archive", `${date}.json`), today);
  writeJSON(join(CONTENT, "progress.json"), progress);
  writeJSON(flagsPath, flags);
}

main();
