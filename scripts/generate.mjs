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
//
// A `dates` key is either "MM-DD", which fires on that day every year, or
// "YYYY-MM-DD", which fires once. Both are additive and both can match the
// same day — the recurring entry carries an annual fixture like a holiday,
// while the dated one covers a year-specific occasion or a festival whose
// date moves (lunar calendars, "last Monday of May").
function resolveSlotList(schedule, weekday, date) {
  const weekdaySlots = schedule.weekdays?.[weekday] ?? [];
  const dates = schedule.dates ?? {};
  const annualSlots = dates[date.slice(5)] ?? []; // "YYYY-MM-DD" -> "MM-DD"
  const dateSlots = dates[date] ?? [];
  return [...weekdaySlots, ...annualSlots, ...dateSlots];
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
    return {
      resolved: { slot, topic, fact, repeat: false, pinned: true, pool: 1 },
    };
  }

  // Only topics with unread facts are drawable. An exhausted topic is never
  // re-served: its cursor stays parked at the end, so facts appended later are
  // the next ones it serves. Empty topics count as exhausted too.
  const viable = topicIds.filter((t) => !isExhausted(topics, progress, t));
  if (viable.length === 0) {
    // Nothing unread anywhere in this slot — leave it off the day, but
    // surface it.
    return { unresolved: slot };
  }

  const topic = pickUniform(viable);
  const facts = factsFor(topics, topic);
  const entry = progress[topic] ?? { next_index: 0, cycled: false };
  const index = entry.next_index ?? 0;
  const fact = facts[index];

  // Advance the cursor immediately so later slots this run see the update.
  // No wrap: reaching the end marks the topic exhausted (`cycled`).
  const nextIndex = index + 1;
  let cycled = entry.cycled === true;
  if (nextIndex >= facts.length && !cycled) {
    cycled = true;
    newlyCycled.add(topic); // false -> true transition, recorded once
  }
  progress[topic] = { next_index: nextIndex, cycled };

  // `pool` is how many topics the slot was configured to choose between, not
  // how many were viable today. The UI shows the drawn topic only when the pool
  // is larger than one, i.e. only when knowing the source tells the reader
  // something the slot name didn't already. `repeat` is always false now that
  // exhausted topics are never re-served; it stays for archive compatibility.
  return { resolved: { slot, topic, fact, repeat: false, pool: topicIds.length } };
}

function isExhausted(topics, progress, topicId) {
  return (progress[topicId]?.next_index ?? 0) >= factsFor(topics, topicId).length;
}

// A topic flagged `cycled` whose cursor is behind its fact count has had new
// facts appended since it ran out. Clear the flag so it is drawable again and
// its next exhaustion alerts again. Mutates progress; returns re-armed ids.
export function rearmExhausted(topics, progress) {
  const rearmed = [];
  for (const [id, entry] of Object.entries(progress)) {
    if (entry?.cycled === true && !isExhausted(topics, progress, id)) {
      progress[id] = { ...entry, cycled: false };
      rearmed.push(id);
    }
  }
  return rearmed;
}

export function generate({ date, weekday, topics, schedule, progress }) {
  const rearmed = rearmExhausted(topics, progress);
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

  return { today, progress, newlyCycled: [...newlyCycled], unresolved, rearmed };
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

  const { today, newlyCycled, unresolved, rearmed } = generate({
    date,
    weekday,
    topics,
    schedule,
    progress,
  });

  // Merge newly exhausted topics into flags.json (unique), and drop re-armed
  // ones so their next exhaustion is flagged again.
  const flagsPath = join(CONTENT, "flags.json");
  let flags;
  try {
    flags = readJSON(flagsPath);
  } catch {
    flags = { cycled_topics: [] };
  }
  const cycledSet = new Set(flags.cycled_topics ?? []);
  for (const t of rearmed) cycledSet.delete(t);
  for (const t of newlyCycled) cycledSet.add(t);
  flags.cycled_topics = [...cycledSet];

  // Report to stdout (surfaces in the workflow log).
  console.log(`Daily Facts generation — ${date} (${weekday})`);
  console.log(`  slots resolved: ${today.slots.length}`);
  for (const s of today.slots) {
    console.log(`    [${s.slot}] <${s.topic}>`);
  }
  if (unresolved.length > 0) {
    console.log(`  UNRESOLVED (nothing unread): ${unresolved.join(", ")}`);
  }
  if (rearmed.length > 0) {
    console.log(`  RE-ARMED (new facts): ${rearmed.join(", ")}`);
  }
  if (newlyCycled.length > 0) {
    console.log(`  NEWLY EXHAUSTED (add more facts): ${newlyCycled.join(", ")}`);
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

// Run only when executed directly, so tests can import generate().
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
