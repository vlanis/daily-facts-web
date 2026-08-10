#!/usr/bin/env node
// Daily Facts — content validation.
//
// Cheap guardrails against typos that would silently break the daily
// generation job, per specs/content-management.md. Run locally before
// committing content changes, and/or as a CI check on PRs touching content.
//
// Usage:  node scripts/validate.mjs
//
// Exit code 0 if no errors (warnings allowed), 1 if any errors.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = join(ROOT, "content");

const WEEKDAY_KEYS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
];

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

function loadJSON(name) {
  const path = join(CONTENT, name);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    err(`${name}: not valid JSON / unreadable — ${e.message}`);
    return null;
  }
}

const topics = loadJSON("topics.json");
const schedule = loadJSON("schedule.json");
const progress = loadJSON("progress.json");

// ---- topics.json shape + duplicate-fact lint --------------------------------
const topicIds = new Set();
if (topics && typeof topics === "object") {
  for (const [id, def] of Object.entries(topics)) {
    topicIds.add(id);
    if (!/^[a-z0-9_]+$/.test(id)) {
      warn(`topics.json: topic id "${id}" is not lowercase/no-spaces`);
    }
    if (!def || !Array.isArray(def.facts)) {
      err(`topics.json: topic "${id}" must have a "facts" array`);
      continue;
    }
    const seen = new Map();
    def.facts.forEach((fact, i) => {
      if (typeof fact !== "string") {
        err(`topics.json: topic "${id}" fact #${i} is not a string`);
        return;
      }
      if (seen.has(fact)) {
        warn(
          `topics.json: topic "${id}" has a duplicate fact at indices ` +
            `${seen.get(fact)} and ${i}`,
        );
      } else {
        seen.set(fact, i);
      }
    });
  }
} else if (topics !== null) {
  err("topics.json: top level must be an object of topic ids");
}

// ---- schedule.json shape + reference integrity ------------------------------
function checkSlotArray(slots, where) {
  if (!Array.isArray(slots)) {
    err(`schedule.json: ${where} must be an array of slot definitions`);
    return;
  }
  const namesThisDay = new Set();
  for (const [i, s] of slots.entries()) {
    const at = `${where}[${i}]`;
    if (!s || typeof s.slot !== "string" || s.slot.length === 0) {
      err(`schedule.json: ${at} must have a non-empty "slot" name`);
    } else {
      if (namesThisDay.has(s.slot)) {
        warn(`schedule.json: ${where} has duplicate slot name "${s.slot}"`);
      }
      namesThisDay.add(s.slot);
    }
    if (!Array.isArray(s?.topics) || s.topics.length === 0) {
      err(`schedule.json: ${at} ("${s?.slot ?? "?"}") has an empty topics list`);
      continue;
    }
    for (const t of s.topics) {
      if (!topicIds.has(t)) {
        err(
          `schedule.json: ${at} ("${s.slot}") references unknown topic "${t}" ` +
            `(not present in topics.json)`,
        );
      }
    }

    // A pinned slot serves one exact fact by index instead of drawing from the
    // queue. Check it hard: a bad index would otherwise surface only as a
    // silently unresolved slot on the day it fires, which could be months away.
    if ("index" in s) {
      const i = s.index;
      if (!Number.isInteger(i) || i < 0) {
        err(`schedule.json: ${at} ("${s.slot}") has a non-integer/negative index`);
      } else if (s.topics.length !== 1) {
        err(
          `schedule.json: ${at} ("${s.slot}") pins index ${i} but lists ` +
            `${s.topics.length} topics — a pinned slot must name exactly one`,
        );
      } else {
        const facts = topics?.[s.topics[0]]?.facts;
        if (Array.isArray(facts) && i >= facts.length) {
          err(
            `schedule.json: ${at} ("${s.slot}") pins index ${i} but topic ` +
              `"${s.topics[0]}" has only ${facts.length} fact(s)`,
          );
        }
      }
    }
  }
}

if (schedule && typeof schedule === "object") {
  if (!schedule.weekdays || typeof schedule.weekdays !== "object") {
    err('schedule.json: missing "weekdays" object');
  } else {
    for (const key of WEEKDAY_KEYS) {
      if (!(key in schedule.weekdays)) {
        err(`schedule.json: weekdays is missing "${key}"`);
      } else {
        checkSlotArray(schedule.weekdays[key], `weekdays.${key}`);
      }
    }
    for (const key of Object.keys(schedule.weekdays)) {
      if (!WEEKDAY_KEYS.includes(key)) {
        warn(`schedule.json: unexpected weekday key "${key}"`);
      }
    }
  }
  if (schedule.dates && typeof schedule.dates === "object") {
    for (const [date, slots] of Object.entries(schedule.dates)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        err(`schedule.json: dates key "${date}" is not YYYY-MM-DD`);
      }
      checkSlotArray(slots, `dates.${date}`);
    }
  }
} else if (schedule !== null) {
  err("schedule.json: top level must be an object");
}

// ---- progress.json shape ----------------------------------------------------
if (progress && typeof progress === "object" && !Array.isArray(progress)) {
  for (const [id, entry] of Object.entries(progress)) {
    if (typeof entry?.next_index !== "number" || entry.next_index < 0) {
      err(`progress.json: topic "${id}" has invalid next_index`);
    }
    if (typeof entry?.cycled !== "boolean") {
      err(`progress.json: topic "${id}" has non-boolean cycled`);
    }
    if (!topicIds.has(id)) {
      warn(`progress.json: topic "${id}" has no matching entry in topics.json`);
    }
  }
} else if (progress !== null) {
  err("progress.json: top level must be an object");
}

// ---- report -----------------------------------------------------------------
for (const w of warnings) console.warn(`⚠️  ${w}`);
for (const e of errors) console.error(`❌ ${e}`);

if (errors.length === 0) {
  console.log(
    `✅ content valid` +
      (warnings.length ? ` (${warnings.length} warning(s))` : ""),
  );
  process.exit(0);
} else {
  console.error(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(1);
}
