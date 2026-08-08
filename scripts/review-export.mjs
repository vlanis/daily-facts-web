#!/usr/bin/env node
// Daily Facts — draft review export.
//
// Renders content/drafts/*.jsonl into readable Markdown checklists under
// content/review/, one file per topic. Tick a box to approve a fact, then run
// scripts/review-apply.mjs to write those decisions back into the JSONL.
//
// The pair is a round trip: export reflects current status (an approved line
// comes back pre-ticked), so re-exporting never loses your marks.
//
// Facts are written on a single line, deliberately un-wrapped. Editors and
// GitHub soft-wrap them for reading, and keeping one line per fact is what
// makes reading the decisions back exact rather than best-effort.
//
// Usage:
//   node scripts/review-export.mjs            # export every topic
//   node scripts/review-export.mjs space ai   # export only these topics
//
// Read-only with respect to content/drafts and content/topics.json — it only
// ever writes under content/review/.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = join(ROOT, "content");
const DRAFTS = join(CONTENT, "drafts");
const REVIEW = join(CONTENT, "review");

// Identifies which draft file a review doc came from, and detects the draft
// having changed since export — in which case line numbers may have shifted
// and the decisions can no longer be applied safely.
export function fingerprint(text) {
  return createHash("sha1").update(text).digest("hex").slice(0, 12);
}

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Failed to read/parse ${path}: ${err.message}`);
  }
}

// Parses one draft file into { text, entries }, keeping each entry's 1-based
// line number so the review doc and the JSONL stay addressable by line.
function readDraft(topic) {
  const text = readFileSync(join(DRAFTS, `${topic}.jsonl`), "utf8");
  const entries = [];
  text.split("\n").forEach((raw, i) => {
    if (raw.trim() === "") return;
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      throw new Error(
        `${topic}.jsonl:${i + 1}: not valid JSON — fix it before exporting`,
      );
    }
    entries.push({ line: i + 1, ...obj });
  });
  return { text, entries };
}

function renderTopic(topic, def, draft) {
  const { entries, text } = draft;
  const approved = entries.filter((e) => e.status === "approved").length;
  const imported = entries.filter((e) => e.status === "imported").length;
  const parked = def.parked === true;

  const out = [];
  out.push(
    `<!-- daily-facts-review v1 topic=${topic} entries=${entries.length} ` +
      `fingerprint=${fingerprint(text)} -->`,
  );
  out.push(`# ${topic}`);
  out.push("");
  if (def.brief) out.push(`*${def.brief}*`);
  out.push("");
  out.push(
    `**${entries.length} facts · ${approved} approved · ${imported} imported · ` +
      `target ${def.wave_q1 ?? "—"} · lang ${def.lang ?? "uk"}**`,
  );
  out.push("");

  if (parked) {
    out.push(
      "> ⛔ **This topic is parked — do not approve.** Its facts are tied to " +
        "calendar dates, which the generation engine cannot match. " +
        "`review-apply.mjs` will refuse to approve anything here.",
    );
    out.push("");
  }
  if (def.constraint) {
    out.push(`> ℹ️ ${def.constraint}`);
    out.push("");
  }

  out.push(
    "Tick `- [ ]` → `- [x]` to approve. Unticking an approved fact sends it " +
      "back to draft. Lines marked `[~]` are already imported and are locked.",
  );
  out.push("");
  out.push("Then run: `node scripts/review-apply.mjs`");
  out.push("");
  out.push("---");
  out.push("");

  for (const e of entries) {
    const box =
      e.status === "imported" ? "~" : e.status === "approved" ? "x" : " ";
    out.push(`- [${box}] **${e.line}.** ${e.fact}`);
    if (e.source) out.push(`  <br>↳ *${e.source}*`);
    if (e.note) out.push(`  <br>↳ ⚠️ **${e.note}**`);
    out.push("");
  }

  return out.join("\n");
}

function main() {
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--"));

  const manifest = readJSON(join(CONTENT, "collection-targets.json"));
  const topics = manifest.topics ?? {};

  const available = new Set(
    readdirSync(DRAFTS)
      .filter((n) => n.endsWith(".jsonl"))
      .map((n) => n.slice(0, -".jsonl".length)),
  );

  const list = (wanted.length ? wanted : Object.keys(topics)).filter((t) => {
    if (!available.has(t)) {
      if (wanted.length) console.warn(`⚠️  no draft file for "${t}" — skipped`);
      return false;
    }
    return true;
  });

  mkdirSync(REVIEW, { recursive: true });

  const index = [];
  let total = 0;
  let totalApproved = 0;

  for (const topic of list) {
    const def = topics[topic] ?? {};
    const draft = readDraft(topic);
    writeFileSync(
      join(REVIEW, `${topic}.md`),
      renderTopic(topic, def, draft) + "\n",
    );

    const approved = draft.entries.filter((e) => e.status === "approved").length;
    total += draft.entries.length;
    totalApproved += approved;
    index.push({
      topic,
      count: draft.entries.length,
      approved,
      parked: def.parked === true,
    });
    console.log(
      `  ${topic.padEnd(20)} ${String(draft.entries.length).padStart(3)} facts` +
        `  ${String(approved).padStart(3)} approved` +
        (def.parked ? "   ⛔ parked" : ""),
    );
  }

  // Index page, so the review has an obvious front door.
  const idx = [];
  idx.push("# Draft review");
  idx.push("");
  idx.push(
    `**${totalApproved} of ${total} facts approved** across ${index.length} topics.`,
  );
  idx.push("");
  idx.push("Tick boxes in a topic file, then run `node scripts/review-apply.mjs`.");
  idx.push("");
  idx.push("| topic | facts | approved | |");
  idx.push("|---|---:|---:|---|");
  for (const r of index) {
    idx.push(
      `| [${r.topic}](${r.topic}.md) | ${r.count} | ${r.approved} | ` +
        `${r.parked ? "⛔ parked — do not approve" : ""} |`,
    );
  }
  idx.push("");
  idx.push(
    "_Generated by `scripts/review-export.mjs`. Re-running is safe: current " +
      "statuses are re-rendered, so approvals already applied come back ticked._",
  );
  writeFileSync(join(REVIEW, "README.md"), idx.join("\n") + "\n");

  console.log("");
  console.log(
    `Wrote ${index.length} file(s) to content/review/ — ` +
      `${totalApproved}/${total} approved. Start at content/review/README.md`,
  );
}

main();
