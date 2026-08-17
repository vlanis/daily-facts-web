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

  // Fact text carries three bits of light markup: bare URLs (a painting's image
  // link), **bold** around a defined term, and *italics* around a usage example
  // (english, english_words, urban_dictionary). All are rendered as real
  // elements; everything else becomes a text node. Nothing is ever assigned to
  // innerHTML, so markup inside a fact stays literal text and cannot become
  // part of the page.
  var URL_RE = /https?:\/\/[^\s<>"']+/g;
  var EMPHASIS_RE = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;

  // Appends plain text, promoting **…** to <strong> and *…* to <em>. The bold
  // branch is listed first so it wins at any given position — otherwise the
  // opening ** of a bold run would match as an italic with an empty body. An
  // unpaired asterisk matches neither branch and stays literal.
  function appendWithEmphasis(el, str) {
    var last = 0;
    var m;
    EMPHASIS_RE.lastIndex = 0;
    while ((m = EMPHASIS_RE.exec(str)) !== null) {
      if (m.index > last) {
        el.appendChild(document.createTextNode(str.slice(last, m.index)));
      }
      var bold = m[1] !== undefined;
      var node = document.createElement(bold ? "strong" : "em");
      node.textContent = bold ? m[1] : m[2];
      el.appendChild(node);
      last = m.index + m[0].length;
    }
    if (last < str.length) {
      el.appendChild(document.createTextNode(str.slice(last)));
    }
  }

  function appendFactText(el, text) {
    var str = String(text == null ? "" : text);
    var last = 0;
    var m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(str)) !== null) {
      if (m.index > last) {
        appendWithEmphasis(el, str.slice(last, m.index));
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
      appendWithEmphasis(el, str.slice(last));
    }
  }

  // Reader-facing labels for topic ids. Ids are lowercase/underscored by
  // construction (validate.mjs enforces it), which is fine for data but not for
  // a heading. A topic missing from this map falls back to a prettified id, so
  // adding a topic never breaks the page — it just reads a little plainer until
  // it gets an entry here.
  var TOPIC_NAMES = {
    ai: "AI",
    animals: "Animals",
    book_fantasy: "Fantasy Books",
    book_fiction: "Fiction Books",
    cars: "Cars",
    cartoon: "Cartoons",
    cooking: "Cooking",
    english: "English",
    english_words: "English Words",
    gardening: "Gardening",
    guinness: "Guinness World Records",
    history_ancient: "Ancient History",
    history_modern: "Modern History",
    history_ua: "Ukrainian History",
    holidays: "Holidays",
    japanese: "Japanese",
    kids: "Kids",
    legends_japan: "Japanese Legends",
    legends_ua: "Ukrainian Legends",
    legends_urban: "Urban Legends",
    legends_world: "World Legends",
    literature: "Literature",
    literature_modern: "Modern Literature",
    literature_ua: "Ukrainian Literature",
    medicine: "Medicine",
    movie: "Movies",
    painting: "Painting",
    phrase: "Phrases",
    popculture: "Popculture",
    popculture_modern: "Modern Popculture",
    porn: "Adult Industry",
    predictions: "Predictions",
    space: "Space",
    technology: "Technology",
    travel: "Travel",
    ukrainian_language: "Ukrainian Language",
    ukrainian_words: "Ukrainian Words",
    urban_dictionary: "Urban Dictionary",
    useless_facts: "Useless Facts",
    verse: "Verse",
    videogames: "Video Games",
  };

  function topicLabel(id) {
    if (Object.prototype.hasOwnProperty.call(TOPIC_NAMES, id)) {
      return TOPIC_NAMES[id];
    }
    return String(id || "")
      .split("_")
      .map(function (w) {
        return w ? w.charAt(0).toUpperCase() + w.slice(1) : w;
      })
      .join(" ");
  }

  function renderSlots(slots) {
    var frag = document.createDocumentFragment();
    slots.forEach(function (slot) {
      var card = document.createElement("article");
      card.className = "card";

      var name = document.createElement("h2");
      name.className = "slot-name";
      name.textContent = slot.slot;

      // Name the source topic only for slots that drew from a pool of several,
      // where it says something the slot name didn't. A single-topic slot would
      // just repeat itself ("Technology — Technology"). The label check catches
      // the same repetition from the other direction: a multi-topic slot can
      // still draw the topic it is named after ("Literature" drawing
      // `literature` out of a pool of three). Older today.json files predate
      // `pool` and simply don't get the suffix.
      var label = slot.topic ? topicLabel(slot.topic) : "";
      if (slot.pool > 1 && label && label !== slot.slot) {
        var topic = document.createElement("span");
        topic.className = "slot-topic";
        topic.textContent = " — " + label;
        name.appendChild(topic);
      }

      var fact = document.createElement("p");
      fact.className = "fact";
      appendFactText(fact, slot.fact);

      // Note: `repeat` is operational metadata and is intentionally not shown
      // to the reader (see specs/ui.md).
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
