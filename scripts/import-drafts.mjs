#!/usr/bin/env node
// Daily Facts — draft importer.
//
// Promotes approved facts from content/drafts/<topic>.jsonl into
// content/topics.json per specs/content-collection.md. This is the ONLY
// sanctioned way a draft reaches topics.json.
//
// Appends only: existing facts, their order, and their indices are never
// touched, so content/progress.json's positional cursors stay valid (see
// specs/data-model.md). Never reads or writes progress.json or schedule.json.
//
// Usage:
//   node scripts/import-drafts.mjs             # import approved drafts
//   node scripts/import-drafts.mjs --dry-run   # report only, write nothing
//
// Exits non-zero on any malformed draft line or bad draft filename, having
// written nothing at all — validation of every file completes before the
// first write. An empty (or absent) drafts directory is a valid no-op.

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = join(ROOT, "content");
const DRAFTS = join(CONTENT, "drafts");

const STATUSES = ["draft", "approved", "imported"];

// Same rule validate.mjs applies to topics.json keys — the draft filename
// becomes a topic key, so it has to satisfy it up front.
const TOPIC_ID = /^[a-z0-9_]+$/;

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
// Phase A — discover draft files
// ---------------------------------------------------------------------------

function findDraftFiles() {
  let names;
  try {
    names = readdirSync(DRAFTS);
  } catch {
    return []; // No drafts directory yet — nothing to import.
  }
  return names.filter((n) => n.endsWith(".jsonl")).sort();
}

// ---------------------------------------------------------------------------
// Phase B — parse + validate every line before anything is written
// ---------------------------------------------------------------------------

// Validates one parsed line against the schema in specs/content-collection.md.
// Returns an error string, or null if the line is fine.
function schemaError(obj) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return "line must be a JSON object";
  }
  if (typeof obj.fact !== "string" || obj.fact.trim() === "") {
    return 'missing/empty required string field "fact"';
  }
  if (!STATUSES.includes(obj.status)) {
    return `"status" must be one of ${STATUSES.join(" | ")}, got ` +
      `${JSON.stringify(obj.status)}`;
  }
  for (const field of ["source", "note"]) {
    if (field in obj && typeof obj[field] !== "string") {
      return `optional field "${field}" must be a string`;
    }
  }
  return null;
}

// Parses one draft file into { topic, file, lines }, where each line keeps its
// original text so unchanged lines can be re-emitted byte-identical.
// Throws on the first problem, naming file and 1-based line number.
function parseDraftFile(file) {
  const topic = file.slice(0, -".jsonl".length);
  if (!TOPIC_ID.test(topic)) {
    throw new Error(
      `${file}: filename is not a valid topic id ` +
        `(must be lowercase letters, digits, underscores)`,
    );
  }

  const text = readFileSync(join(DRAFTS, file), "utf8");
  const lines = text.split("\n").map((raw, i) => {
    const lineNo = i + 1;
    if (raw.trim() === "") return { raw, lineNo, obj: null };

    let obj;
    try {
      obj = JSON.parse(raw);
    } catch (err) {
      throw new Error(`${file}:${lineNo}: not valid JSON — ${err.message}`);
    }

    const problem = schemaError(obj);
    if (problem) throw new Error(`${file}:${lineNo}: ${problem}`);

    return { raw, lineNo, obj };
  });

  return { topic, file, lines };
}

// ---------------------------------------------------------------------------
// Phase C — plan the appends (pure; mutates only the in-memory topics object)
// ---------------------------------------------------------------------------

function planImport(drafts, topics) {
  const report = [];
  const newTopics = [];

  for (const draft of drafts) {
    const { topic } = draft;

    // Resolved on the first approved line only — a file holding nothing but
    // unreviewed drafts must not conjure an empty topic into topics.json.
    let facts = null;
    let seen = null;
    let appended = 0;
    let duplicates = 0;

    for (const line of draft.lines) {
      if (line.obj?.status !== "approved") continue;

      if (facts === null) {
        if (!topics[topic]) {
          topics[topic] = { facts: [] };
          newTopics.push(topic);
        }
        facts = topics[topic].facts;
        // Seeded with what's already published, then grown as we queue
        // appends, so two identical approved lines append exactly once.
        seen = new Set(facts);
      }

      const fact = line.obj.fact;
      if (seen.has(fact)) {
        duplicates += 1;
      } else {
        facts.push(fact); // append-only: always at the end
        seen.add(fact);
        appended += 1;
      }
      // A duplicate is still already published, which is what "imported" means.
      line.obj.status = "imported";
      line.changed = true;
    }

    draft.changed = draft.lines.some((l) => l.changed);
    report.push({ topic, appended, duplicates });
  }

  return { report, newTopics };
}

// Re-emits a draft file, keeping untouched lines byte-identical so the diff
// shows exactly the lines that were promoted.
function renderDraft(draft) {
  return draft.lines
    .map((l) => (l.changed ? JSON.stringify(l.obj) : l.raw))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  const dryRun = process.argv.slice(2).includes("--dry-run");

  const files = findDraftFiles();
  if (files.length === 0) {
    console.log("No draft files in content/drafts — nothing to import.");
    return;
  }

  // Phase B: validate everything up front. Any throw here exits non-zero with
  // no files written.
  const drafts = files.map(parseDraftFile);

  // Phase C
  const topicsPath = join(CONTENT, "topics.json");
  const topics = readJSON(topicsPath);
  const { report, newTopics } = planImport(drafts, topics);

  // ---- report --------------------------------------------------------------
  const totalAppended = report.reduce((n, r) => n + r.appended, 0);
  const totalDuplicates = report.reduce((n, r) => n + r.duplicates, 0);

  console.log(
    `Daily Facts draft import — ${files.length} draft file(s)` +
      (dryRun ? " [--dry-run]" : ""),
  );
  for (const r of report) {
    console.log(
      `  ${r.topic}: ${r.appended} appended, ${r.duplicates} duplicate(s) skipped`,
    );
  }
  console.log(
    `  total: ${totalAppended} appended, ${totalDuplicates} duplicate(s) skipped`,
  );
  if (newTopics.length > 0) {
    console.log(`  NEW TOPICS: ${newTopics.join(", ")}`);
    console.log(
      `    (a new topic is not served until a slot in schedule.json ` +
        `references it)`,
    );
  }

  if (dryRun) {
    console.log("\n--dry-run: no files written.");
    return;
  }

  // Phase D: write. topics.json first, then the draft status marks.
  if (totalAppended > 0 || newTopics.length > 0) {
    writeJSON(topicsPath, topics);
  }
  for (const draft of drafts) {
    if (draft.changed) {
      writeFileSync(join(DRAFTS, draft.file), renderDraft(draft));
    }
  }
}

try {
  main();
} catch (err) {
  // Draft files are hand-edited, so a bad line is an expected failure mode,
  // not a crash — report it the way validate.mjs reports content errors.
  console.error(`❌ ${err.message}`);
  console.error("\nNothing was imported. Fix the draft file and re-run.");
  process.exit(1);
}
