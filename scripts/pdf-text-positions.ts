#!/usr/bin/env bun
/**
 * Dump every text element in a PDF with its bounding box.
 * Uses pdftohtml (poppler-utils) to extract positioned text as XML.
 * Output is designed for LLM consumption: one line per text span,
 * with [left,top,right,bottom] coordinates in PDF points (top-left origin).
 *
 * Underscore runs (________) indicate fill-in blanks.
 * Replacement characters (garbled glyphs) indicate checkboxes.
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

for (const page of xml.matchAll(/<page number="(\d+)"[^>]*height="(\d+)" width="(\d+)">(.*?)<\/page>/gs)) {
  const [, num, h, w, body] = page;
  console.log(`\n=== page ${num} ${w}×${h} ===`);
  for (const m of body.matchAll(
    /<text top="(\d+)" left="(\d+)" width="(\d+)" height="(\d+)" font="\d+">(.*?)<\/text>/gs
  )) {
    const text = m[5].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    if (!text.trim()) continue;
    const bbox = `[${m[2]},${m[1]},${+m[2] + +m[3]},${+m[1] + +m[4]}]`;

    // Inline heuristic annotations
    const hints: string[] = [];
    if (/_{3,}\s*\/\s*_{3,}/.test(text)) hints.push("← date segments: fill each slot individually");
    if (/\ufffd|□/.test(text) || (text.replace(/<[^>]+>/g, "").trim().length <= 2 && /[\ufffd\u25a1\u2610\u2612]/.test(text)))
      hints.push("← checkbox");
    if (/_{10,}/.test(text) && !/\//.test(text)) hints.push(`← fill area (${+m[3]}pt wide)`);
    if (/\ufffd/.test(text) && text.length > 3) hints.push("← garbled glyphs may be checkboxes");

    console.log(`${bbox} ${text}${hints.length ? "  " + hints.join("; ") : ""}`);
  }
}
