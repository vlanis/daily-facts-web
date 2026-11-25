import { test } from "node:test";
import assert from "node:assert/strict";

import { generate } from "../scripts/generate.mjs";

const DATE = "2026-11-30";
const WEEKDAY = "monday";

// topics: { id: nFacts }, slots: [[slotName, [topicIds], pinnedIndex?]]
function fixture(topicSizes, slots, progress) {
  const topics = {};
  for (const [id, n] of Object.entries(topicSizes)) {
    topics[id] = { facts: Array.from({ length: n }, (_, i) => `${id}-${i}`) };
  }
  const schedule = {
    weekdays: {
      [WEEKDAY]: slots.map(([slot, ids, index]) =>
        index === undefined ? { slot, topics: ids } : { slot, topics: ids, index },
      ),
    },
  };
  return { date: DATE, weekday: WEEKDAY, topics, schedule, progress: structuredClone(progress) };
}

test("last fact is served, then cursor parks at end", () => {
  const r = generate(fixture({ a: 2 }, [["S", ["a"]]], { a: { next_index: 1, cycled: false } }));
  assert.equal(r.today.slots[0].fact, "a-1");
  assert.deepEqual(r.progress.a, { next_index: 2, cycled: true });
  assert.deepEqual(r.newlyCycled, ["a"]);
});

test("exhausted topic is skipped within a pool", () => {
  for (let i = 0; i < 20; i++) {
    const r = generate(
      fixture({ a: 2, b: 5 }, [["S", ["a", "b"]]], {
        a: { next_index: 2, cycled: true },
        b: { next_index: 0, cycled: false },
      }),
    );
    assert.equal(r.today.slots[0].topic, "b");
    assert.equal(r.today.slots[0].repeat, false);
  }
});

test("fully exhausted slot is unresolved", () => {
  const r = generate(fixture({ a: 2 }, [["S", ["a"]]], { a: { next_index: 2, cycled: true } }));
  assert.deepEqual(r.today.slots, []);
  assert.deepEqual(r.today.unresolved, ["S"]);
  assert.equal(r.progress.a.next_index, 2);
});

test("same topic twice on its last fact", () => {
  const r = generate(
    fixture({ a: 2 }, [["S1", ["a"]], ["S2", ["a"]]], { a: { next_index: 1, cycled: false } }),
  );
  assert.equal(r.today.slots.length, 1);
  assert.equal(r.today.slots[0].fact, "a-1");
  assert.deepEqual(r.today.unresolved, ["S2"]);
  assert.ok(r.today.slots.every((s) => s.fact !== undefined));
});

test("next_index beyond length is exhausted", () => {
  const r = generate(fixture({ a: 2 }, [["S", ["a"]]], { a: { next_index: 5, cycled: false } }));
  assert.deepEqual(r.today.slots, []);
  assert.deepEqual(r.today.unresolved, ["S"]);
});

test("appended facts re-arm", () => {
  const r = generate(fixture({ a: 3 }, [["S", ["a"]]], { a: { next_index: 2, cycled: true } }));
  assert.deepEqual(r.rearmed, ["a"]);
  assert.equal(r.today.slots[0].fact, "a-2");
  assert.deepEqual(r.progress.a, { next_index: 3, cycled: true });
  assert.deepEqual(r.newlyCycled, ["a"]);
});

test("pinned slot untouched", () => {
  const r = generate(fixture({ a: 2 }, [["H", ["a"], 0]], { a: { next_index: 2, cycled: true } }));
  assert.equal(r.today.slots[0].fact, "a-0");
  assert.deepEqual(r.progress.a, { next_index: 2, cycled: true });
});

test("buildArchiveIndex lists dated files sorted", async () => {
  const { buildArchiveIndex } = await import("../scripts/generate.mjs");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "dailyfacts-archive-"));
  for (const f of ["2026-08-05.json", "2026-08-03.json", "index.json", "notes.txt"]) {
    writeFileSync(join(dir, f), "{}");
  }
  assert.deepEqual(buildArchiveIndex(dir), { dates: ["2026-08-03", "2026-08-05"] });
});
