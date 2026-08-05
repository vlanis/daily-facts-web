// Daily Facts — static reader.
// Loads site/today.json (the only runtime data source) and renders it.
// No backend calls, no write-backs. See specs/ui.md.

(function () {
  "use strict";

  var slotsEl = document.getElementById("slots");
  var dateEl = document.getElementById("date");
  var statusEl = document.getElementById("status");

  function showStatus(message) {
    statusEl.textContent = message;
    statusEl.hidden = false;
  }

  // Render a date-only "YYYY-MM-DD" as e.g. "Monday, 3 August 2026" without
  // timezone drift (construct a local date from the parts, not Date.parse).
  function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return iso || "";
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    try {
      return d.toLocaleDateString(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    } catch (e) {
      return iso;
    }
  }

  // Bare URLs in fact text (e.g. a painting's image link) should be tappable.
  // Everything is appended as text nodes or as an anchor whose href and label
  // are set via properties, so fact content is never parsed as HTML.
  var URL_RE = /https?:\/\/[^\s<>"']+/g;

  function appendFactText(el, text) {
    var str = String(text == null ? "" : text);
    var last = 0;
    var m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(str)) !== null) {
      if (m.index > last) {
        el.appendChild(document.createTextNode(str.slice(last, m.index)));
      }
      // Don't swallow sentence punctuation that happens to follow the URL.
      var href = m[0].replace(/[.,;:!?)\]]+$/, "");
      var a = document.createElement("a");
      a.href = href;
      a.textContent = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      el.appendChild(a);
      last = m.index + href.length;
    }
    if (last < str.length) {
      el.appendChild(document.createTextNode(str.slice(last)));
    }
  }

  function renderSlots(slots) {
    var frag = document.createDocumentFragment();
    slots.forEach(function (slot) {
      var card = document.createElement("article");
      card.className = "card";

      var name = document.createElement("h2");
      name.className = "slot-name";
      name.textContent = slot.slot;

      var fact = document.createElement("p");
      fact.className = "fact";
      appendFactText(fact, slot.fact);

      // Note: `repeat` and `topic` are operational metadata and are
      // intentionally not shown to the reader (see specs/ui.md).
      card.appendChild(name);
      card.appendChild(fact);
      frag.appendChild(card);
    });
    slotsEl.appendChild(frag);
  }

  function render(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.slots)) {
      throw new Error("malformed today.json");
    }
    dateEl.textContent = formatDate(data.date);

    if (data.slots.length === 0) {
      showStatus("Nothing scheduled today. Check back tomorrow.");
      return;
    }
    renderSlots(data.slots);
  }

  // Cache-bust so a freshly generated today.json is picked up promptly.
  fetch("today.json?_=" + Date.now(), { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(render)
    .catch(function () {
      dateEl.textContent = "Today";
      showStatus("Today's facts aren't ready yet. Please check back soon.");
    });
})();
