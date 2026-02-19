#!/usr/bin/env bun
/**
 * Simple Markdown to PDF converter using jsPDF
 * 
 * Usage: bun scripts/md-to-pdf.ts input.md [output.pdf]
 */

import { jsPDF } from "jspdf";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const LINE_HEIGHT = 14;

class MdPdf {
  private doc: jsPDF;
  private y = MARGIN;
  private basePath: string;

  constructor(basePath: string) {
    this.doc = new jsPDF({ unit: "pt", format: "letter" });
    this.basePath = basePath;
  }

  private newPageIfNeeded(need: number) {
    if (this.y + need > PAGE_HEIGHT - MARGIN) {
      this.doc.addPage();
      this.y = MARGIN;
    }
  }

  private font(bold = false, italic = false, size = 10) {
    const style = bold && italic ? "bolditalic" : bold ? "bold" : italic ? "italic" : "normal";
    this.doc.setFont("helvetica", style);
    this.doc.setFontSize(size);
  }

  // Clean HTML entities and normalize text
  private clean(str: string): string {
    return str
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1");
  }

  private text(str: string, x: number, maxW: number): number {
    const clean = this.clean(str);
    const lines = this.doc.splitTextToSize(clean, maxW);
    for (const line of lines) {
      this.newPageIfNeeded(LINE_HEIGHT);
      this.doc.text(line, x, this.y);
      this.y += LINE_HEIGHT;
    }
    return lines.length;
  }

  private loadImage(src: string): string | null {
    if (src.startsWith("data:")) return src;
    const p = resolve(this.basePath, src);
    if (!existsSync(p)) return null;
    const ext = src.split(".").pop()?.toLowerCase() || "png";
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
    return `data:${mime};base64,${readFileSync(p).toString("base64")}`;
  }

  render(md: string) {
    const lines = md.split("\n");
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Empty line = small gap
      if (!line.trim()) { this.y += 6; i++; continue; }

      // H1
      if (line.startsWith("# ")) {
        this.y += 12;
        this.font(true, false, 18);
        const clean = this.clean(line.slice(2));
        const wrapped = this.doc.splitTextToSize(clean, CONTENT_WIDTH);
        for (const wl of wrapped) {
          this.newPageIfNeeded(22);
          this.doc.text(wl, MARGIN, this.y);
          this.y += 22; // More line height for H1
        }
        this.y += 4;
        i++; continue;
      }

      // H2
      if (line.startsWith("## ")) {
        this.y += 8;
        this.font(true, false, 14);
        const clean = this.clean(line.slice(3));
        const wrapped = this.doc.splitTextToSize(clean, CONTENT_WIDTH);
        for (const wl of wrapped) {
          this.newPageIfNeeded(18);
          this.doc.text(wl, MARGIN, this.y);
          this.y += 18;
        }
        this.y += 2;
        i++; continue;
      }

      // H3
      if (line.startsWith("### ")) {
        this.y += 6;
        this.font(true, false, 12);
        const clean = this.clean(line.slice(4));
        const wrapped = this.doc.splitTextToSize(clean, CONTENT_WIDTH);
        for (const wl of wrapped) {
          this.newPageIfNeeded(16);
          this.doc.text(wl, MARGIN, this.y);
          this.y += 16;
        }
        i++; continue;
      }

      // HR
      if (/^-{3,}$/.test(line) || /^\*{3,}$/.test(line)) {
        this.y += 6;
        this.newPageIfNeeded(10);
        this.doc.setDrawColor(200);
        this.doc.line(MARGIN, this.y, PAGE_WIDTH - MARGIN, this.y);
        this.y += 10;
        i++; continue;
      }

      // Blockquote - collect all lines first, then render
      if (line.startsWith("> ")) {
        const qLines: string[] = [];
        while (i < lines.length && lines[i].startsWith("> ")) {
          qLines.push(lines[i].slice(2));
          i++;
        }
        
        // Calculate wrapped text first
        this.font(false, true, 10);
        const qText = this.clean(qLines.join(" "));
        const wrapped = this.doc.splitTextToSize(qText, CONTENT_WIDTH - 20);
        const totalHeight = wrapped.length * LINE_HEIGHT + 10;
        
        // Check if we need a new page for the whole block
        this.newPageIfNeeded(Math.min(totalHeight, PAGE_HEIGHT - MARGIN * 2));
        
        const startY = this.y;
        
        // Render text first
        for (const wl of wrapped) {
          this.newPageIfNeeded(LINE_HEIGHT);
          this.doc.text(wl, MARGIN + 10, this.y);
          this.y += LINE_HEIGHT;
        }
        
        // Draw background and border only on starting page portion
        const endY = this.y;
        // Only draw if we didn't cross pages
        if (endY > startY) {
          this.doc.setFillColor(248, 248, 248);
          this.doc.rect(MARGIN, startY - 12, CONTENT_WIDTH, endY - startY + 8, "F");
          this.doc.setDrawColor(180);
          this.doc.line(MARGIN, startY - 12, MARGIN, endY - 4);
          
          // Re-render text on top of background
          this.font(false, true, 10);
          let ty = startY;
          for (const wl of wrapped) {
            this.doc.text(wl, MARGIN + 10, ty);
            ty += LINE_HEIGHT;
          }
        }
        
        this.y += 6;
        continue;
      }

      // Image
      const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (imgMatch) {
        const src = this.loadImage(imgMatch[2]);
        if (src) {
          try {
            this.newPageIfNeeded(60);
            this.doc.addImage(src, MARGIN, this.y, 180, 50);
            this.y += 60;
          } catch {}
        }
        i++; continue;
      }

      // Table
      if (line.startsWith("|")) {
        const rows: string[][] = [];
        while (i < lines.length && lines[i].startsWith("|")) {
          const cells = lines[i].split("|").slice(1, -1).map(c => this.clean(c.trim()));
          if (!cells.every(c => /^[-:]+$/.test(c))) rows.push(cells);
          i++;
        }
        if (rows.length) {
          const cols = rows[0].length;
          const colW = CONTENT_WIDTH / cols;
          this.font(false, false, 9);
          for (let ri = 0; ri < rows.length; ri++) {
            this.newPageIfNeeded(18);
            if (ri === 0) {
              this.doc.setFillColor(240, 240, 240);
              this.doc.rect(MARGIN, this.y - 10, CONTENT_WIDTH, 16, "F");
              this.font(true, false, 9);
            } else {
              this.font(false, false, 9);
            }
            for (let ci = 0; ci < rows[ri].length; ci++) {
              this.doc.text(rows[ri][ci], MARGIN + ci * colW + 4, this.y);
            }
            this.doc.setDrawColor(220);
            this.doc.line(MARGIN, this.y + 4, PAGE_WIDTH - MARGIN, this.y + 4);
            this.y += 16;
          }
          this.y += 6;
        }
        continue;
      }

      // Checkbox list
      if (line.match(/^[-*]\s+\[[ xX]\]/)) {
        while (i < lines.length && lines[i].match(/^[-*]\s+\[[ xX]\]/)) {
          const m = lines[i].match(/^[-*]\s+\[([ xX])\]\s*(.*)$/);
          if (m) {
            this.newPageIfNeeded(LINE_HEIGHT);
            this.font(false, false, 10);
            const box = m[1].toLowerCase() === "x" ? "[X]" : "[ ]";
            this.doc.text(box + "  " + this.clean(m[2]), MARGIN, this.y);
            this.y += LINE_HEIGHT;
          }
          i++;
        }
        this.y += 4;
        continue;
      }

      // Bullet list
      if (line.match(/^[-*]\s+[^\[]/)) {
        while (i < lines.length && lines[i].match(/^[-*]\s+[^\[]/)) {
          this.newPageIfNeeded(LINE_HEIGHT);
          this.font(false, false, 10);
          const txt = this.clean(lines[i].replace(/^[-*]\s+/, ""));
          this.doc.text("•  " + txt, MARGIN, this.y);
          this.y += LINE_HEIGHT;
          i++;
        }
        this.y += 4;
        continue;
      }

      // Numbered list
      if (line.match(/^\d+\.\s/)) {
        let n = 1;
        while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
          this.newPageIfNeeded(LINE_HEIGHT);
          this.font(false, false, 10);
          const txt = this.clean(lines[i].replace(/^\d+\.\s+/, ""));
          this.doc.text(`${n}.  ${txt}`, MARGIN, this.y);
          this.y += LINE_HEIGHT;
          i++; n++;
        }
        this.y += 4;
        continue;
      }

      // Paragraph
      this.font(false, false, 10);
      this.text(line, MARGIN, CONTENT_WIDTH);
      i++;
    }
  }

  save(out: string) {
    writeFileSync(out, Buffer.from(this.doc.output("arraybuffer")));
    console.log(`Generated: ${out}`);
  }
}

const args = process.argv.slice(2);
if (args.length < 1) { console.log("Usage: bun md-to-pdf.ts <input.md> [output.pdf]"); process.exit(1); }
const input = args[0];
const output = args[1] || input.replace(/\.md$/, ".pdf");
if (!existsSync(input)) { console.error(`Not found: ${input}`); process.exit(1); }

const r = new MdPdf(dirname(resolve(input)));
r.render(readFileSync(input, "utf-8"));
r.save(output);
