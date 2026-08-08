#!/usr/bin/env node
// Daily Facts — apply review decisions.
//
// Reads the ticked checkboxes in content/review/*.md and writes them back as
// `status` values in content/drafts/*.jsonl. The other half of
// scripts/review-export.mjs.
//
//   [x] -> approved      [ ] -> draft      [~] -> imported (locked, untouched)
//
// Safety:
// - Each review doc records a fingerprint of the draft file it came from. If
//   the draft has changed since export, line numbers may have shifted, so the
//   whole run aborts and asks you to re-export. Nothing is written.
// - Parked topics can never be approved here, whatever the checkbox says.
// - Already-imported lines are never modified — those facts are published.
//
// Usage:
//   node scripts/review-apply.mjs             # apply all review files
//   node scripts/review-apply.mjs --dry-run   # report only, write nothing
//
// Exits non-zero on a stale or malformed review file, having written nothing.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = join(ROOT, "content");
const DRAFTS = join(CONTENT, "drafts");
const REVIEW = join(CONTENT, "review");

const HEADER =
  /^<!--\s*daily-facts-review v1 topic=(\S+) entries=(\d+) fingerprint=(\w+)\s*-->/;
const ITEM = /^- \[([ x~])\]\s+\*\*(\d+)\.\*\*\s+(.*)$/;

function fingerprint(text) {
  return createHash("sha1").update(text).digest("hex").slice(0, 12);
}

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Failed to read/parse ${path}: ${err.message}`);
  }
}

// Parses one review doc into { topic, fingerprint, decisions }. Throws on a
// missing/malformed header — that means the file was not produced by
// review-export.mjs and cannot be trusted to address lines correctly.
function parseReview(file) {
  const text = readFileSync(join(REVIEW, file), "utf8");
  const lines = text.split("\n");

  const m = HEADER.exec(lines[0] ?? "");
  if (!m) {
    throw new Error(
      `${file}: missing review header — regenerate it with review-export.mjs`,
    );
  }
  const [, topic, , fp] = m;

  const decisions = [];
  for (const raw of lines) {
    const item = ITEM.exec(raw);
    if (!item) continue;
    decisions.push({ box: item[1], line: Number(item[2]) });
  }
  return { file, topic, fingerprint: fp, decisions };
}

function main() {
  const dryRun = process.argv.slice(2).includes("--dry-run");

  let files;
  try {
    files = readdirSync(REVIEW).filter(
      (n) => n.endsWith(".md") && n !== "README.md",
    );
  } catch {
    console.log(
      "No content/review directory — run scripts/review-export.mjs first.",
    );
    return;
  }
  if (files.length === 0) {
    console.log("No review files found. Run scripts/review-export.mjs first.");
    return;
  }

  const manifest = readJSON(join(CONTENT, "collection-targets.json"));
  const topics = manifest.topics ?? {};

  // ---- Phase 1: parse and validate everything before writing anything -------
  const plans = [];
  for (const file of files.sort()) {
    const review = parseReview(file);
    const draftPath = join(DRAFTS, `${review.topic}.jsonl`);

    let draftText;
    try {
      draftText = readFileSync(draftPath, "utf8");
    } catch {
      throw new Error(
        `${file}: no draft file content/drafts/${review.topic}.jsonl`,
      );
    }

    if (fingerprint(draftText) !== review.fingerprint) {
      throw new Error(
        `${file}: the draft file has changed since this review was exported, ` +
          `so its line numbers may no longer match.\n` +
          `   Re-run: node scripts/review-export.mjs ${review.topic}\n` +
          `   (any ticks already applied are preserved; unapplied ticks are lost)`,
      );
    }

    plans.push({ ...review, draftPath, draftText });
  }

  // ---- Phase 2: compute changes -------------------------------------------
  const report = [];
  for (const plan of plans) {
    const parked = topics[plan.topic]?.parked === true;
    const lines = plan.draftText.split("\n");

    let approved = 0;
    let unapproved = 0;
    let blocked = 0;
    let changed = false;

    for (const d of plan.decisions) {
      const raw = lines[d.line - 1];
      if (raw === undefined || raw.trim() === "") continue;

      const obj = JSON.parse(raw);
      if (obj.status === "imported") continue; // published — never touched
      if (d.box === "~") continue;

      const want = d.box === "x" ? "approved" : "draft";

      if (want === "approved" && parked) {
        blocked += 1;
        continue; // a parked topic is never approvable, whatever the box says
      }
      if (obj.status === want) continue;

      if (want === "approved") approved += 1;
      else unapproved += 1;

      obj.status = want;
      lines[d.line - 1] = JSON.stringify(obj);
      changed = true;
    }

    plan.newText = lines.join("\n");
    plan.changed = changed;
    report.push({ topic: plan.topic, approved, unapproved, blocked, parked });
  }

  // ---- Phase 3: write ------------------------------------------------------
  if (!dryRun) {
    for (const plan of plans) {
      if (!plan.changed) continue;
      writeFileSync(plan.draftPath, plan.newText);

      // Refresh the review doc's fingerprint to match the draft we just wrote.
      // Its checkboxes already describe the new state — that is what we applied
      // — so only the fingerprint is stale. Without this, every apply would
      // invalidate its own review files and force a full re-export before the
      // next pass.
      const reviewPath = join(REVIEW, plan.file);
      const text = readFileSync(reviewPath, "utf8");
      writeFileSync(
        reviewPath,
        text.replace(
          /(<!--\s*daily-facts-review v1 topic=\S+ entries=\d+ fingerprint=)\w+/,
          `$1${fingerprint(plan.newText)}`,
        ),
      );
    }
  }

  // ---- report --------------------------------------------------------------
  const touched = report.filter(
    (r) => r.approved || r.unapproved || r.blocked,
  );
  console.log(
    `Applying review decisions${dryRun ? " [--dry-run]" : ""} — ` +
      `${files.length} review file(s)`,
  );
  if (touched.length === 0) {
    console.log("  nothing to change — drafts already match the review files.");
  }
  for (const r of touched) {
    const bits = [];
    if (r.approved) bits.push(`${r.approved} approved`);
    if (r.unapproved) bits.push(`${r.unapproved} back to draft`);
    if (r.blocked) bits.push(`${r.blocked} BLOCKED (topic is parked)`);
    console.log(`  ${r.topic}: ${bits.join(", ")}`);
  }

  const totalApproved = report.reduce((n, r) => n + r.approved, 0);
  const totalBlocked = report.reduce((n, r) => n + r.blocked, 0);
  console.log("");
  console.log(`  ${totalApproved} newly approved`);
  if (totalBlocked > 0) {
    console.log(
      `  ${totalBlocked} tick(s) ignored in parked topics — those facts cannot ` +
        `be published until the date mechanism is designed.`,
    );
  }
  if (dryRun) {
    console.log("\n--dry-run: no files written.");
  } else if (totalApproved > 0) {
    console.log("\nNext: node scripts/import-drafts.mjs --dry-run");
  }
}

try {
  main();
} catch (err) {
  console.error(`❌ ${err.message}`);
  console.error("\nNothing was changed.");
  process.exit(1);
}
