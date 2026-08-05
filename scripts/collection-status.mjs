#!/usr/bin/env node
// Daily Facts — collection progress.
//
// Answers "where did fact collection stop?" purely from disk, by counting
// lines in content/drafts/*.jsonl against the targets in
// content/collection-targets.json. Nothing is inferred from memory or history,
// so this is the command to run first when resuming an interrupted collection
// session (see specs/content-collection.md).
//
// Read-only: never writes anything.
//
// Usage:
//   node scripts/collection-status.mjs            # topics still short of target
//   node scripts/collection-status.mjs --all      # every topic, including done
//
// Exit code is always 0 — an incomplete collection is a normal state, not an
// error. Malformed draft lines are reported here but only import-drafts.mjs
// treats them as fatal.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = join(ROOT, "content");
const DRAFTS = join(CONTENT, "drafts");

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Failed to read/parse ${path}: ${err.message}`);
  }
}

// Counts lines by status in one draft file. Unparseable lines are counted
// separately rather than thrown, so a broken line never hides overall progress.
function countDraft(topic) {
  let text;
  try {
    text = readFileSync(join(DRAFTS, `${topic}.jsonl`), "utf8");
  } catch {
    return { total: 0, draft: 0, approved: 0, imported: 0, bad: 0 };
  }

  const counts = { total: 0, draft: 0, approved: 0, imported: 0, bad: 0 };
  for (const raw of text.split("\n")) {
    if (raw.trim() === "") continue;
    counts.total += 1;
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      counts.bad += 1;
      continue;
    }
    if (obj?.status in counts) counts[obj.status] += 1;
    else counts.bad += 1;
  }
  return counts;
}

function main() {
  const showAll = process.argv.slice(2).includes("--all");

  const manifest = readJSON(join(CONTENT, "collection-targets.json"));
  const topics = manifest.topics ?? {};

  let published = {};
  try {
    published = readJSON(join(CONTENT, "topics.json"));
  } catch {
    // topics.json is optional context here, not required to report progress.
  }

  const rows = [];
  let totalDrafted = 0;
  let totalTarget = 0;
  let totalRemaining = 0;
  let totalBad = 0;

  for (const [topic, def] of Object.entries(topics)) {
    const c = countDraft(topic);
    const target = def.wave_q1 ?? 0;
    const remaining = Math.max(0, target - c.total);

    totalDrafted += c.total;
    totalTarget += target;
    totalRemaining += remaining;
    totalBad += c.bad;

    rows.push({
      topic,
      parked: def.parked === true,
      lang: def.lang ?? "uk",
      target,
      ...c,
      remaining,
      inTopics: published[topic]?.facts?.length ?? 0,
    });
  }

  // Biggest shortfall first — that's the next thing worth working on.
  rows.sort((a, b) => b.remaining - a.remaining || b.target - a.target);

  const shown = showAll ? rows : rows.filter((r) => r.remaining > 0);

  console.log("Daily Facts collection status");
  console.log("");
  if (shown.length === 0) {
    console.log("  🎉 every topic has met its wave target.");
  } else {
    console.log(
      "  topic                 lang  drafted  target  todo   appr  imp  live",
    );
    for (const r of shown) {
      console.log(
        "  " +
          (r.topic + (r.parked ? " (parked)" : "")).padEnd(22) +
          r.lang.padEnd(6) +
          String(r.total).padStart(7) +
          String(r.target).padStart(8) +
          String(r.remaining).padStart(6) +
          String(r.approved).padStart(7) +
          String(r.imported).padStart(5) +
          String(r.inTopics).padStart(6) +
          (r.bad > 0 ? `   ⚠️  ${r.bad} unparseable` : ""),
      );
    }
  }

  console.log("");
  console.log(
    `  ${totalDrafted}/${totalTarget} facts drafted — ${totalRemaining} to go` +
      (totalBad > 0 ? `, ${totalBad} unparseable line(s)` : ""),
  );

  // Surface draft files with no manifest entry — most likely a typo'd filename,
  // which import-drafts.mjs would happily turn into a brand-new topic.
  try {
    const orphans = readdirSync(DRAFTS)
      .filter((n) => n.endsWith(".jsonl"))
      .map((n) => n.slice(0, -".jsonl".length))
      .filter((t) => !(t in topics));
    if (orphans.length > 0) {
      console.log("");
      console.log(`  ⚠️  draft files with no manifest entry: ${orphans.join(", ")}`);
    }
  } catch {
    // No drafts directory yet — nothing to cross-check.
  }

  const next = rows.find((r) => r.remaining > 0 && !r.parked);
  if (next) {
    console.log("");
    console.log(`  next up: ${next.topic} (${next.remaining} more)`);
  }
}

main();
