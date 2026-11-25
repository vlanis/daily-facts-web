import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../site/index.html", import.meta.url), "utf8");

// Until app.js has worked out where each arrow leads, both must start
// invisible and inert — otherwise they flash on every page load.
for (const id of ["prev", "next"]) {
  test(`#${id} arrow starts off and disabled`, () => {
    const tag = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0];
    assert.ok(tag, `no #${id} button`);
    assert.match(tag, /class="[^"]*\bis-off\b[^"]*"/);
    assert.match(tag, /\bdisabled\b/);
  });
}
