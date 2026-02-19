#!/usr/bin/env bun
/**
 * Fill a flat (non-fillable) PDF form with text and checkmarks.
 * 
 * The LLM provides approximate [x,y] positions (top-left origin, PDF points).
 * This script nudges text fills to avoid overlapping existing text/lines,
 * choosing a consistent direction (right, down, or up) across all text fills.
 * Checkboxes are placed exactly at the given coordinates (no nudging).
 *
 * Input: JSON on stdin with the structure:
 * {
 *   "inputPdf": "/tmp/form.pdf",
 *   "outputPdf": "/tmp/form-filled.pdf",
 *   "fills": [
 *     { "text": "Jane Doe", "x": 130, "y": 119, "page": 1 },
 *     { "text": "01/01/1990", "x": 490, "y": 119, "page": 1, "fontSize": 11 },
 *     { "check": true, "x": 50, "y": 365, "page": 1 },
 *     { "image": "/tmp/signature.png", "x": 100, "y": 500, "width": 150, "height": 40, "page": 3 }
 *   ]
 * }
 *
 * Fill types:
 *   text fill:  { "text": "value", "x": N, "y": N, "page": N, "fontSize": N }
 *               Draws text. Position is nudged to avoid overlapping existing content.
 *               fontSize defaults to 10.
 *   checkbox:   { "check": true, "x": N, "y": N, "page": N }
 *               Draws an X mark. Placed exactly at the given position (no nudging).
 *   image:      { "image": "/path/to/img.png", "x": N, "y": N, "width": N, "height": N, "page": N }
 *               Embeds a PNG or JPEG image (e.g. signature). Placed exactly at given position.
 *               width/height default to image's natural dimensions.
 *
 * Coordinates: PDF points, top-left origin (matching pdf-text-positions.ts output).
 * page: 1-based, defaults to 1.
 *
 * Nudging strategy for text fills:
 *   1. Extracts existing text bboxes (pdftohtml) and drawn lines (pymupdf) as obstacles.
 *   2. For "right" direction: also tries all y-values within the overlapping box,
 *      so fills land on the same row even if the exact y is blocked.
 *   3. Scores each direction (right/down/up) across ALL text fills jointly.
 *   4. Picks the direction that works for the most fills (consistent placement).
 *   5. Falls back to other directions per-fill if the primary direction fails.
 *
 * Requires: pdftohtml (apt install poppler-utils), pdf-lib
 * Optional: pymupdf (for drawn line detection, improves overlap avoidance)
 *
 * Usage: echo '{ ... }' | bun scripts/fill-form.ts
 *        bun scripts/fill-form.ts < fills.json
 */

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: echo '{"inputPdf":..., "outputPdf":..., "fills":[...]}' | bun scripts/fill-form.ts

Fill a flat (non-fillable) PDF form with text and checkmarks.

Input (JSON on stdin):
  inputPdf   Path to the input PDF
  outputPdf  Path to write the filled PDF
  fills      Array of fill objects:

  Text fill:  { "text": "value", "x": 130, "y": 119, "page": 1, "fontSize": 10 }
              Position is approximate — the script nudges to avoid overlapping
              existing text and drawn lines. fontSize defaults to 10.

  Checkbox:   { "check": true, "x": 50, "y": 365, "page": 1 }
              Draws an X mark exactly at the given position (no nudging).

  Image:      { "image": "/path/to/img.png", "x": 100, "y": 500, "width": 150, "height": 40, "page": 3 }
              Embeds a PNG or JPEG (e.g. signature). No nudging.
              width/height default to image's natural dimensions.

Coordinates are in PDF points, top-left origin (matching pdf-text-positions.ts).
Page is 1-based, defaults to 1.

The script jointly optimizes text placement direction (right/down/up) across
all text fills for consistent positioning. Checkboxes are independent.

Output: JSON with { outputPdf, fills } on stdout. Diagnostics on stderr.

Requires: pdftohtml (poppler-utils)
Optional: pymupdf (python) for drawn line obstacle detection`);
  process.exit(0);
}
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { $ } from "bun";

// --- Parse input ---
const input = JSON.parse(await Bun.stdin.text());
const { inputPdf, outputPdf, fills } = input as {
  inputPdf: string;
  outputPdf: string;
  fills: Array<{
    text?: string;
    check?: boolean;
    image?: string;
    x: number;
    y: number;
    page?: number;
    fontSize?: number;
    width?: number;
    height?: number;
  }>;
};

// --- Extract existing text bounding boxes from PDF ---
interface TextBox {
  x0: number; y0: number; x1: number; y1: number;
  page: number;
}

const xml = await $`pdftohtml -xml -zoom 1 -stdout ${inputPdf}`.text();
const existingBoxes: TextBox[] = [];

for (const pageMatch of xml.matchAll(
  /<page number="(\d+)"[^>]*>(.*?)<\/page>/gs
)) {
  const pageNum = +pageMatch[1];
  for (const m of pageMatch[2].matchAll(
    /<text top="(\d+)" left="(\d+)" width="(\d+)" height="(\d+)"[^>]*>.*?<\/text>/gs
  )) {
    existingBoxes.push({
      x0: +m[2], y0: +m[1],
      x1: +m[2] + +m[3], y1: +m[1] + +m[4],
      page: pageNum,
    });
  }
}

// --- Extract drawn lines as obstacles (pure JS via pdfjs-dist) ---
try {
  const { getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfDoc = await getDocument(inputPdf).promise;
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const ops = await page.getOperatorList();
    const vp = page.getViewport({ scale: 1 });
    const ctmStack: number[][] = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    for (let j = 0; j < ops.fnArray.length; j++) {
      const fn = ops.fnArray[j], args = ops.argsArray[j];
      if (fn === OPS.save) ctmStack.push([...ctm]);
      else if (fn === OPS.restore) ctm = ctmStack.pop() ?? [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.transform) {
        const [a, b, c, d, e, f] = args, [A, B, C, D, E, F] = ctm;
        ctm = [A*a+C*b, B*a+D*b, A*c+C*d, B*c+D*d, A*e+C*f+E, B*e+D*f+F];
      } else if (fn === OPS.constructPath) {
        const mm = args[2];
        if (!mm) continue;
        const tx0 = ctm[0]*mm[0]+ctm[2]*mm[1]+ctm[4], ty0 = ctm[1]*mm[0]+ctm[3]*mm[1]+ctm[5];
        const tx1 = ctm[0]*mm[2]+ctm[2]*mm[3]+ctm[4], ty1 = ctm[1]*mm[2]+ctm[3]*mm[3]+ctm[5];
        const w = Math.abs(tx1 - tx0), h = Math.abs(ty1 - ty0);
        const top = vp.height - Math.max(ty0, ty1), bottom = vp.height - Math.min(ty0, ty1);
        const left = Math.min(tx0, tx1), right = Math.max(tx0, tx1);
        if (h < 3 && w > 20) {
          existingBoxes.push({ x0: Math.round(left), y0: Math.round(top), x1: Math.round(right), y1: Math.round(top + 2), page: i });
        } else if (w < 3 && h > 20) {
          existingBoxes.push({ x0: Math.round(left), y0: Math.round(top), x1: Math.round(left + 2), y1: Math.round(bottom), page: i });
        }
      }
    }
  }
} catch (e) {
  console.error("NOTE: could not extract drawn lines:", (e as Error).message);
}
function hasOverlap(
  x: number, y: number, w: number, h: number, page: number, pad = 2
): boolean {
  for (const b of existingBoxes) {
    if (b.page !== page) continue;
    if (x - pad < b.x1 && x + w + pad > b.x0 && y - pad < b.y1 && y + h + pad > b.y0)
      return true;
  }
  return false;
}

type Direction = "right" | "down" | "up";
const SEARCH_LIMITS: Record<Direction, { maxD: number; step: (d: number) => [number, number] }> = {
  right: { maxD: 200, step: (d) => [d, 0] },
  down:  { maxD: 40,  step: (d) => [0, d] },
  up:    { maxD: 40,  step: (d) => [0, -d] },
};

// Find the vertical range of the box(es) the anchor overlaps with
function overlappingYRange(
  x: number, y: number, w: number, h: number, page: number
): [number, number] {
  let minY = y, maxY = y + h;
  for (const b of existingBoxes) {
    if (b.page !== page) continue;
    if (x < b.x1 && x + w > b.x0 && y < b.y1 && y + h > b.y0) {
      minY = Math.min(minY, b.y0);
      maxY = Math.max(maxY, b.y1);
    }
  }
  return [minY, maxY];
}

// Try nudging in a single direction; returns position or null if it doesn't fit.
// For "right": also try all y-values within the overlapping box's vertical range,
// so we can find clear space on the same row even if the exact y is blocked.
function tryDirection(
  x: number, y: number, w: number, h: number, page: number, dir: Direction, pageW: number
): { x: number; y: number } | null {
  if (!hasOverlap(x, y, w, h, page)) return { x, y };

  if (dir === "right") {
    const [yMin, yMax] = overlappingYRange(x, y, w, h, page);
    // Try all y-values in the box range, sorted by distance from original y
    const yOptions: number[] = [];
    for (let ty = Math.floor(yMin); ty <= Math.ceil(yMax - h); ty++) {
      yOptions.push(ty);
    }
    yOptions.sort((a, b) => Math.abs(a - y) - Math.abs(b - y));

    for (const ty of yOptions) {
      for (let dx = 0; dx <= 200; dx++) {
        const nx = x + dx;
        if (nx + w > pageW) break;
        if (!hasOverlap(nx, ty, w, h, page)) return { x: nx, y: ty };
      }
    }
    return null;
  }

  const { maxD, step } = SEARCH_LIMITS[dir];
  for (let d = 1; d <= maxD; d++) {
    const [dx, dy] = step(d);
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx + w > pageW) continue;
    if (!hasOverlap(nx, ny, w, h, page)) return { x: nx, y: ny };
  }
  return null;
}

// Jointly decide direction: try all fills with each direction, pick the one
// that succeeds for the most fills, then per-fill fallback for stragglers.
function resolveAllPositions(
  fillSpecs: Array<{ x: number; y: number; w: number; h: number; page: number; pageW: number }>
): Array<{ x: number; y: number }> {
  const directions: Direction[] = ["right", "down", "up"];

  // Score each direction: how many fills succeed?
  const dirResults = new Map<Direction, Array<{ x: number; y: number } | null>>();
  for (const dir of directions) {
    dirResults.set(dir, fillSpecs.map(f => tryDirection(f.x, f.y, f.w, f.h, f.page, dir, f.pageW)));
  }
  const dirScores = directions.map(dir => ({
    dir,
    successes: dirResults.get(dir)!.filter(r => r !== null).length,
  }));
  dirScores.sort((a, b) => b.successes - a.successes);
  const bestDir = dirScores[0].dir;
  console.error(`Chose primary direction: ${bestDir} (${dirScores.map(d => `${d.dir}=${d.successes}`).join(", ")})`);

  const bestResults = dirResults.get(bestDir)!;
  const results: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < fillSpecs.length; i++) {
    const f = fillSpecs[i];
    let pos = bestResults[i];
    // Fallback: try other directions if primary didn't work
    if (!pos) {
      for (const fallback of directions) {
        if (fallback === bestDir) continue;
        pos = tryDirection(f.x, f.y, f.w, f.h, f.page, fallback, f.pageW);
        if (pos) break;
      }
    }
    if (pos && (pos.x !== f.x || pos.y !== f.y)) {
      console.error(`Nudged [${f.x},${f.y}] → [${pos.x},${pos.y}] on page ${f.page}`);
    }
    if (!pos) {
      console.error(`WARNING: no overlap-free position for fill at [${f.x},${f.y}] on page ${f.page}`);
      pos = { x: f.x, y: f.y };
    }
    results.push(pos);
    // Add placed fill to obstacles so subsequent direction probes account for it
    existingBoxes.push({ x0: pos.x, y0: pos.y, x1: pos.x + f.w, y1: pos.y + f.h, page: f.page });
  }
  return results;
}

// --- Compute fill dimensions and resolve positions jointly ---
const pdfBytes = await Bun.file(inputPdf).arrayBuffer();
const doc = await PDFDocument.load(pdfBytes);
const font = await doc.embedFont(StandardFonts.Helvetica);
const INK = rgb(0, 0, 0.6);

// Separate text fills (joint direction) from checkboxes (nearest neighbor)
const textIndices: number[] = [];
const textSpecs: Array<{ x: number; y: number; w: number; h: number; page: number; pageW: number }> = [];

for (let i = 0; i < fills.length; i++) {
  const fill = fills[i];
  const pageIdx = (fill.page ?? 1) - 1;
  const page = doc.getPages()[pageIdx];
  const { width: W } = page?.getSize() ?? { width: 612 };
  const fontSize = fill.fontSize ?? 10;
  if (!fill.check && fill.text) {
    const w = font.widthOfTextAtSize(fill.text, fontSize);
    textSpecs.push({ x: fill.x, y: fill.y, w, h: fontSize, page: fill.page ?? 1, pageW: W });
    textIndices.push(i);
  }
}

const textPositions = resolveAllPositions(textSpecs);

// Build final positions: text from joint optimization, checks from nearest neighbor
const positions: Array<{ x: number; y: number }> = new Array(fills.length);
let ti = 0;
for (let i = 0; i < fills.length; i++) {
  const fill = fills[i];
  if (fill.check) {
    positions[i] = { x: fill.x, y: fill.y };
  } else if (fill.image) {
    positions[i] = { x: fill.x, y: fill.y };
  } else {
    positions[i] = textPositions[ti++];
  }
}

// --- Generate creation script and fill the PDF ---
const scriptLines: string[] = [
  `#!/usr/bin/env bun`,
  `// Auto-generated by fill-form.ts — edit positions below and re-run to adjust`,
  `import { PDFDocument, StandardFonts, rgb } from "pdf-lib";`,
  ``,
  `const pdfBytes = await Bun.file(${JSON.stringify(inputPdf)}).arrayBuffer();`,
  `const doc = await PDFDocument.load(pdfBytes);`,
  `const font = await doc.embedFont(StandardFonts.Helvetica);`,
  `const INK = rgb(0, 0, 0.6);`,
  `const pages = doc.getPages();`,
  ``,
];

// Collect page heights needed
const pageHeights = new Map<number, number>();

for (let i = 0; i < fills.length; i++) {
  const fill = fills[i];
  const pos = positions[i];
  const pageIdx = (fill.page ?? 1) - 1;
  const page = doc.getPages()[pageIdx];
  if (!page) {
    console.error(`WARNING: page ${fill.page} does not exist, skipping`);
    continue;
  }
  const { height: H } = page.getSize();
  pageHeights.set(pageIdx, H);
  const fontSize = fill.fontSize ?? 10;
  const pgRef = `pages[${pageIdx}]`;

  if (fill.check) {
    const cx = pos.x + 4;
    const cy = H - pos.y - 4;
    const s = 3.5;
    for (const [dx1, dy1, dx2, dy2] of [[-s, -s, s, s], [-s, s, s, -s]]) {
      page.drawLine({
        start: { x: cx + dx1, y: cy + dy1 },
        end: { x: cx + dx2, y: cy + dy2 },
        thickness: 1.5, color: INK,
      });
    }
    scriptLines.push(`// Checkbox at [${pos.x},${pos.y}] on page ${fill.page ?? 1}`);
    scriptLines.push(`{ const cx = ${cx}, cy = ${cy.toFixed(1)}, s = 3.5;`);
    scriptLines.push(`  for (const [dx1,dy1,dx2,dy2] of [[-s,-s,s,s],[-s,s,s,-s]])`);
    scriptLines.push(`    ${pgRef}.drawLine({ start:{x:cx+dx1,y:cy+dy1}, end:{x:cx+dx2,y:cy+dy2}, thickness:1.5, color:INK }); }`);
  } else if (fill.text) {
    page.drawText(fill.text, {
      x: pos.x,
      y: H - pos.y - fontSize,
      size: fontSize, font, color: INK,
    });
    const nudgeNote = (pos.x !== fill.x || pos.y !== fill.y) ? ` (nudged from [${fill.x},${fill.y}])` : ``;
    scriptLines.push(`${pgRef}.drawText(${JSON.stringify(fill.text)}, { x: ${pos.x}, y: ${(H - pos.y - fontSize).toFixed(1)}, size: ${fontSize}, font, color: INK }); // [${pos.x},${pos.y}]${nudgeNote}`);
  } else if (fill.image) {
    const imgBytes = await Bun.file(fill.image).arrayBuffer();
    const isPng = fill.image.toLowerCase().endsWith(".png");
    const img = isPng ? await doc.embedPng(imgBytes) : await doc.embedJpg(imgBytes);
    const w = fill.width ?? img.width;
    const h = fill.height ?? img.height;
    page.drawImage(img, {
      x: pos.x,
      y: H - pos.y - h,
      width: w,
      height: h,
    });
    scriptLines.push(`{ const img = await doc.embed${isPng ? "Png" : "Jpg"}(await Bun.file(${JSON.stringify(fill.image)}).arrayBuffer());`);
    scriptLines.push(`  ${pgRef}.drawImage(img, { x: ${pos.x}, y: ${(H - pos.y - h).toFixed(1)}, width: ${w}, height: ${h} }); }`);
  }
}

scriptLines.push(``);
scriptLines.push(`await Bun.write(${JSON.stringify(outputPdf)}, await doc.save());`);

const saved = await doc.save();
await Bun.write(outputPdf, saved);

const scriptPath = outputPdf + ".creation-script.ts";
await Bun.write(scriptPath, scriptLines.join("\n") + "\n");
console.error(`Wrote creation script to ${scriptPath}`);
console.log(scriptLines.join("\n"));
