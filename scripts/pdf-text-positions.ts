#!/usr/bin/env bun
/**
 * Dump every text element in a PDF with its bounding box, font size, and style.
 * Uses pdftohtml (poppler-utils) to extract positioned text as XML.
 * Output is designed for LLM consumption: one line per text span,
 * with [left,top,right,bottom] coordinates in PDF points (top-left origin).
 *
 * Requires: pdftohtml (apt install poppler-utils)
 * Usage: bun pdf-text-positions.ts <path-to-pdf>
 */
import { $ } from "bun";

const file = Bun.argv[2];
if (!file) {
  console.error("Usage: bun pdf-text-positions.ts <pdf-file>");
  process.exit(1);
}

const xml = await $`pdftohtml -xml -zoom 1 -stdout ${file}`.text();

// Parse font specs: id → size
const fonts = new Map<string, number>();
for (const m of xml.matchAll(/<fontspec id="(\d+)" size="(\d+)"[^>]*>/g)) {
  fonts.set(m[1], +m[2]);
}

for (const page of xml.matchAll(/<page number="(\d+)"[^>]*height="(\d+)" width="(\d+)">(.*?)<\/page>/gs)) {
  const [, num, h, w, body] = page;
  console.log(`\n=== page ${num} ${w}×${h} ===`);
  for (const m of body.matchAll(
    /<text top="(\d+)" left="(\d+)" width="(\d+)" height="(\d+)" font="(\d+)">(.*?)<\/text>/gs
  )) {
    const raw = m[6];
    const text = raw.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    if (!text.trim()) continue;

    const size = fonts.get(m[5]) ?? "?";
    const bold = raw.includes("<b>") ? "b" : "";
    const italic = raw.includes("<i>") ? "i" : "";
    const style = bold + italic;
    const tag = style ? ` {${style}}` : "";

    console.log(`[${m[2]},${m[1]},${+m[2] + +m[3]},${+m[1] + +m[4]}] ${size}pt${tag} ${text}`);
  }
}
