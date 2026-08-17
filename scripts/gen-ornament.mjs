#!/usr/bin/env node
// Daily Facts — regenerates site/ornament.svg, the decorative rushnyk band
// shown in the side gutters on wide screens (see specs/ui.md).
//
// The motif is authored as a character grid below rather than as SVG, because
// the output is ~37 <rect> elements that nothing can sensibly hand-edit. To
// change the pattern, edit GRID and re-run.
//
// Usage:  node scripts/gen-ornament.mjs

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "site", "ornament.svg");

const UNIT = 10;

// An eight-pointed star (ruzha / Alatyr), the commonest rushnyk motif, then a
// small open diamond as a separator. The band repeats on this whole block, so
// the last row is deliberately blank to space the tiles apart.
const GRID = [
  "....X....",
  "X...X...X",
  ".X..X..X.",
  "..X.X.X..",
  "XXXXXXXXX",
  "..X.X.X..",
  ".X..X..X.",
  "X...X...X",
  "....X....",
  ".........",
  "....X....",
  "...X.X...",
  "..X...X..",
  "...X.X...",
  "....X....",
  ".........",
];

const cols = GRID[0].length;
if (GRID.some((row) => row.length !== cols)) {
  console.error("❌ every GRID row must be the same length");
  process.exit(1);
}

const width = cols * UNIT;
const height = GRID.length * UNIT;

const rects = [];
GRID.forEach((row, y) => {
  [...row].forEach((cell, x) => {
    if (cell !== "X") return;
    rects.push(
      `<rect x="${x * UNIT}" y="${y * UNIT}" width="${UNIT}" height="${UNIT}"/>`,
    );
  });
});

// Solid black on purpose: this file is consumed as a CSS mask, so only its
// alpha channel is read. The visible colour comes from background-color in
// styles.css, which is what lets one asset follow both themes.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="#000">
${rects.map((r) => `  ${r}`).join("\n")}
</svg>
`;

writeFileSync(OUT, svg);
console.log(
  `✅ site/ornament.svg — ${width}×${height}, ${rects.length} cells, ${svg.length} bytes`,
);
