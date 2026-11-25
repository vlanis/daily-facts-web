import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { parseHash, neighbours } = createRequire(import.meta.url)("../site/nav.js");

const dates = ["2026-08-03", "2026-08-08", "2026-08-25", "2026-11-24", "2026-11-25"];
const today = "2026-11-25";

test("parseHash accepts a real date", () => {
  assert.equal(parseHash("#2026-11-20"), "2026-11-20");
});

test("parseHash rejects empty, junk and impossible dates", () => {
  for (const h of ["", "#", "#foo", "#2026-13-45", "#2026-02-30", "#2026-11-20x"]) {
    assert.equal(parseHash(h), null, h);
  }
});

test("today view: prev is yesterday, no next", () => {
  assert.deepEqual(neighbours(dates, null, today), { prev: "2026-11-24", next: null });
});

test("across the gap", () => {
  assert.deepEqual(neighbours(dates, "2026-08-25", today), { prev: "2026-08-08", next: "2026-11-24" });
});

test("day before today: next is today", () => {
  assert.equal(neighbours(dates, "2026-11-24", today).next, "today");
});

test("oldest day: no prev", () => {
  assert.equal(neighbours(dates, "2026-08-03", today).prev, null);
});

test("gap date not in list", () => {
  assert.deepEqual(neighbours(dates, "2026-08-15", today), { prev: "2026-08-08", next: "2026-08-25" });
});

test("newest archived day not yet today: next is today", () => {
  // index.json may lag a day behind today.json; stepping forward still lands on Today.
  assert.equal(neighbours(["2026-11-23", "2026-11-24"], "2026-11-24", today).next, "today");
});
