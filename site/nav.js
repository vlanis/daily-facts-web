// Daily Facts — archive navigation helpers (pure; no DOM, no fetch).
// Loaded as a classic script before app.js, which reads window.DailyFactsNav.
// Also exported via module.exports so tests/nav.test.mjs can run it in Node.

(function (root) {
  "use strict";

  // "#YYYY-MM-DD" -> "YYYY-MM-DD" if it names a real calendar date, else null.
  function parseHash(hash) {
    var m = /^#(\d{4})-(\d{2})-(\d{2})$/.exec(hash || "");
    if (!m) return null;
    var y = Number(m[1]);
    var mo = Number(m[2]);
    var d = Number(m[3]);
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
      return null;
    }
    return m[1] + "-" + m[2] + "-" + m[3];
  }

  // Where ‹ and › lead from `current` (null = the Today view). ISO dates
  // compare correctly as strings. `next` is "today" when stepping forward
  // would reach or pass today's date, so the newest step always lands on
  // the live Today view rather than its archive copy.
  function neighbours(dates, current, todayDate) {
    var from = current || todayDate;
    var prev = null;
    var after = null;
    for (var i = 0; i < dates.length; i++) {
      if (dates[i] < from) prev = dates[i];
      else if (dates[i] > from && after === null) after = dates[i];
    }
    var next = null;
    if (current) next = after === null || after >= todayDate ? "today" : after;
    return { prev: prev, next: next };
  }

  var api = { parseHash: parseHash, neighbours: neighbours };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DailyFactsNav = api;
})(this);
