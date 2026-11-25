import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const VALIDATE = fileURLToPath(new URL("../scripts/validate.mjs", import.meta.url));

function runWithProgress(nextIndex) {
  const dir = mkdtempSync(join(tmpdir(), "dailyfacts-validate-"));
  writeFileSync(join(dir, "topics.json"), JSON.stringify({ a: { facts: ["x", "y"] } }));
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const weekdays = Object.fromEntries(days.map((d) => [d, [{ slot: "S", topics: ["a"] }]]));
  writeFileSync(join(dir, "schedule.json"), JSON.stringify({ weekdays }));
  writeFileSync(join(dir, "progress.json"), JSON.stringify({ a: { next_index: nextIndex, cycled: true } }));
  return spawnSync(process.execPath, [VALIDATE], {
    env: { ...process.env, DAILYFACTS_CONTENT_DIR: dir },
    encoding: "utf8",
  });
}

test("next_index equal to fact count is valid (exhausted)", () => {
  const r = runWithProgress(2);
  assert.equal(r.status, 0, r.stderr);
});

test("next_index beyond fact count is an error", () => {
  const r = runWithProgress(3);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /next_index 3 is beyond its 2 facts/);
});
