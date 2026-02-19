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

// Bounds violation tracking
export class BoundsError extends Error {
  constructor(message: string, public details: BoundsViolation) {
    super(message);
    this.name = "BoundsError";
  }
}

export interface BoundsViolation {
  type: "horizontal_overflow" | "vertical_overflow" | "page_overflow" | "negative_position";
  context: string;
  expected: { min: number; max: number };
  actual: number;
  content?: string;
}

export interface RenderOptions {
  strict?: boolean;  // If true, throw on bounds violations (default: true)
  onViolation?: (v: BoundsViolation) => void;  // Callback for violations
}

export class MdPdf {
  private doc: jsPDF;
  private y = MARGIN;
  private basePath: string;
  private strict: boolean;
  private violations: BoundsViolation[] = [];
  private onViolation?: (v: BoundsViolation) => void;
  private currentPage = 1;

  constructor(basePath: string, options: RenderOptions = {}) {
    this.doc = new jsPDF({ unit: "pt", format: "letter" });
    this.basePath = basePath;
    this.strict = options.strict !== false; // default true
    this.onViolation = options.onViolation;
  }

  getViolations(): BoundsViolation[] {
    return this.violations;
  }

  private recordViolation(v: BoundsViolation) {
    this.violations.push(v);
    if (this.onViolation) this.onViolation(v);
    if (this.strict) {
      throw new BoundsError(
        `${v.type}: ${v.context} (expected ${v.expected.min}-${v.expected.max}, got ${v.actual})`,
        v
      );
    }
  }

  private checkHorizontal(x: number, width: number, context: string, content?: string) {
    const rightEdge = x + width;
    const maxRight = PAGE_WIDTH - MARGIN;
    if (x < MARGIN) {
      this.recordViolation({
        type: "horizontal_overflow",
        context: `${context} - left edge before margin`,
        expected: { min: MARGIN, max: maxRight },
        actual: x,
        content,
      });
    }
    if (rightEdge > maxRight) {
      this.recordViolation({
        type: "horizontal_overflow",
        context: `${context} - right edge past margin`,
        expected: { min: MARGIN, max: maxRight },
        actual: rightEdge,
        content,
      });
    }
  }

  private checkVertical(y: number, context: string) {
    if (y < MARGIN) {
      this.recordViolation({
        type: "negative_position",
        context,
        expected: { min: MARGIN, max: PAGE_HEIGHT - MARGIN },
        actual: y,
      });
    }
    if (y > PAGE_HEIGHT - MARGIN) {
      this.recordViolation({
        type: "vertical_overflow",
        context: `${context} on page ${this.currentPage}`,
        expected: { min: MARGIN, max: PAGE_HEIGHT - MARGIN },
        actual: y,
      });
    }
  }

  // Measure text width for bounds checking
  private measureText(text: string): number {
    return this.doc.getTextWidth(text);
  }

  /**
   * Calculate optimal column widths for a table.
   * 
   * Algorithm:
   * 1. Start with equal column widths
   * 2. For each non-final column (left to right), measure max content width
   * 3. If content fits in less space, shrink column and redistribute to remaining columns
   * 4. Never shrink below content needs or expand beyond original equal width
   */
  private calculateColumnWidths(rows: string[][], cols: number, cellPadding: number): number[] {
    const equalWidth = CONTENT_WIDTH / cols;
    const minColWidth = 30; // Absolute minimum column width
    
    // Measure the maximum content width needed for each column
    this.font(true, false, 9); // Use header font for measurement (slightly wider)
    const maxContentWidths: number[] = [];
    for (let ci = 0; ci < cols; ci++) {
      let maxWidth = 0;
      for (const row of rows) {
        const cellText = row[ci] || "";
        const textWidth = this.measureText(cellText);
        maxWidth = Math.max(maxWidth, textWidth);
      }
      maxContentWidths.push(maxWidth + cellPadding * 2);
    }
    
    // Start with equal widths
    const colWidths = Array(cols).fill(equalWidth);
    
    // Redistribute from left to right (skip final column)
    let availableForRedistribution = 0;
    
    for (let ci = 0; ci < cols - 1; ci++) {
      const currentWidth = colWidths[ci] + availableForRedistribution / (cols - ci);
      const neededWidth = Math.max(minColWidth, maxContentWidths[ci]);
      
      if (neededWidth < currentWidth) {
        // This column has excess space - shrink it and save the excess
        // But don't shrink below what we'd have with equal distribution
        const shrunkWidth = Math.max(neededWidth, equalWidth * 0.5);
        const excess = currentWidth - shrunkWidth;
        colWidths[ci] = shrunkWidth;
        availableForRedistribution += excess;
      } else {
        // This column needs all its space (and maybe more from redistribution)
        colWidths[ci] = Math.min(currentWidth, equalWidth * 1.5); // Cap growth
        availableForRedistribution = Math.max(0, currentWidth - colWidths[ci]);
      }
    }
    
    // Give all remaining space to the final column
    colWidths[cols - 1] = equalWidth + availableForRedistribution;
    
    return colWidths;
  }

  private newPageIfNeeded(need: number) {
    if (this.y + need > PAGE_HEIGHT - MARGIN) {
      this.doc.addPage();
      this.currentPage++;
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
      .replace(/☑/g, "[X]")
      .replace(/☐/g, "[ ]")
      .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/==(.+?)==/g, "$1")
      // Strip markdown links to display text only
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  }

  // Parse text into segments, distinguishing ==filled== values, links, and plain text.
  // [X] and [x] are always treated as filled (checked boxes are patient actions).
  private parseSegments(str: string): Array<{ text: string; filled: boolean; url?: string }> {
    // Auto-highlight checked boxes before parsing ==...== markers
    const normalized = str.replace(/(?<!=)(\[[xX]\])(?!=)/g, "==$1==");
    const segments: Array<{ text: string; filled: boolean; url?: string }> = [];
    const re = /==((?:(?!==).)+)==/g;
    let lastIndex = 0;
    let match;
    while ((match = re.exec(normalized)) !== null) {
      if (match.index > lastIndex) {
        this.extractLinks(normalized.slice(lastIndex, match.index), false, segments);
      }
      this.extractLinks(match[1], true, segments);
      lastIndex = re.lastIndex;
    }
    if (lastIndex < normalized.length) {
      this.extractLinks(normalized.slice(lastIndex), false, segments);
    }
    return segments.length ? segments : [{ text: this.clean(str), filled: false }];
  }

  // Extract markdown links and bare URLs from text into segments
  private extractLinks(str: string, filled: boolean, out: Array<{ text: string; filled: boolean; url?: string }>) {
    // Match markdown links [text](url) and bare URLs
    const re = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(https?:\/\/[^\s<>)\]]+)/g;
    let lastIndex = 0;
    let match;
    while ((match = re.exec(str)) !== null) {
      if (match.index > lastIndex) {
        out.push({ text: this.clean(str.slice(lastIndex, match.index)), filled });
      }
      if (match[1] !== undefined) {
        // Markdown link: [text](url)
        out.push({ text: this.clean(match[1]), filled, url: match[2] });
      } else {
        // Bare URL
        out.push({ text: match[3], filled, url: match[3] });
      }
      lastIndex = re.lastIndex;
    }
    if (lastIndex < str.length) {
      out.push({ text: this.clean(str.slice(lastIndex)), filled });
    }
  }

  // Render a line with ==filled== segments in bold+blue, links in blue+underline, rest in normal+black
  private drawSegments(segments: Array<{ text: string; filled: boolean; url?: string }>, x: number, y: number, baseBold: boolean, baseSize: number, opts?: { baseline?: string }) {
    let curX = x;
    for (const seg of segments) {
      if (!seg.text) continue;
      if (seg.url) {
        this.font(baseBold, false, baseSize);
        this.doc.setTextColor(0, 0, 180);
      } else if (seg.filled) {
        this.font(true, false, baseSize);
        this.doc.setTextColor(0, 0, 180);
      } else {
        this.font(baseBold, false, baseSize);
        this.doc.setTextColor(0, 0, 0);
      }
      const textW = this.measureText(seg.text);
      this.doc.text(seg.text, curX, y, opts as any);
      if (seg.url) {
        // Add clickable link annotation covering the full text width
        this.doc.link(curX, y - baseSize, textW, baseSize + 2, { url: seg.url });
      }
      curX += textW;
    }
    // Reset to defaults
    this.doc.setTextColor(0, 0, 0);
  }

  // Wrap text respecting max width, then render each line with highlight segments
  private textWithSegments(str: string, x: number, maxW: number, baseBold: boolean, baseSize: number, context = "paragraph"): number {
    const clean = this.clean(str);
    const lines = this.doc.splitTextToSize(clean, maxW);
    // Build a flat cleaned string and a parallel segment map from the original
    const segments = this.parseSegments(str);
    // For each wrapped line, find matching segments by walking through segment text
    let segIdx = 0, segOffset = 0;
    for (const line of lines) {
      this.newPageIfNeeded(LINE_HEIGHT);
      // Build segments for this specific line
      const lineSegs: Array<{ text: string; filled: boolean; url?: string }> = [];
      let remaining = line.length;
      while (remaining > 0 && segIdx < segments.length) {
        const seg = segments[segIdx];
        const available = seg.text.length - segOffset;
        const take = Math.min(available, remaining);
        lineSegs.push({ text: seg.text.slice(segOffset, segOffset + take), filled: seg.filled, url: seg.url });
        segOffset += take;
        remaining -= take;
        if (segOffset >= seg.text.length) { segIdx++; segOffset = 0; }
      }
      this.drawSegments(lineSegs, x, this.y, baseBold, baseSize);
      this.checkVertical(this.y, context);
      this.y += LINE_HEIGHT;
    }
    return lines.length;
  }

  private text(str: string, x: number, maxW: number, context = "paragraph"): number {
    return this.textWithSegments(str, x, maxW, false, 10, context);
  }

  private loadImage(src: string): string | null {
    if (src.startsWith("data:")) return src;
    const p = resolve(this.basePath, src);
    if (!existsSync(p)) return null;
    const ext = src.split(".").pop()?.toLowerCase() || "png";
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
    return `data:${mime};base64,${readFileSync(p).toString("base64")}`;
  }

  render(md: string, outputPath?: string) {
    // Save input markdown alongside the output PDF when EHI_KEEP_INTERMEDIATES is set (e.g., during test runs)
    if (outputPath && process.env.EHI_KEEP_INTERMEDIATES) {
      const inputPath = outputPath.replace(/\.pdf$/i, ".input.keepme.md");
      try { writeFileSync(inputPath, md); console.error(`[md-to-pdf] Saved input markdown to ${inputPath}`); } catch {}
    }

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
          const w = this.measureText(wl);
          this.checkHorizontal(MARGIN, w, "H1", wl);
          this.doc.text(wl, MARGIN, this.y);
          this.checkVertical(this.y, "H1");
          this.y += 22;
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
          const w = this.measureText(wl);
          this.checkHorizontal(MARGIN, w, "H2", wl);
          this.doc.text(wl, MARGIN, this.y);
          this.checkVertical(this.y, "H2");
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
          const w = this.measureText(wl);
          this.checkHorizontal(MARGIN, w, "H3", wl);
          this.doc.text(wl, MARGIN, this.y);
          this.checkVertical(this.y, "H3");
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

      // Blockquote - thin border box (fax-friendly)
      if (line.startsWith(">")) {
        const qLines: string[] = [];
        while (i < lines.length && lines[i].startsWith(">")) {
          qLines.push(lines[i].replace(/^>\s?/, ""));
          i++;
        }
        
        this.font(false, true, 10);
        const qText = this.clean(qLines.join(" "));
        const wrapped = this.doc.splitTextToSize(qText, CONTENT_WIDTH - 20);
        const pad = 8;
        
        this.y += 10; // space before box
        this.newPageIfNeeded(wrapped.length * LINE_HEIGHT + pad * 2);
        
        const boxTop = this.y;
        this.y += pad + 10; // top padding + baseline offset
        
        for (const wl of wrapped) {
          this.doc.text(wl, MARGIN + 10, this.y);
          this.y += LINE_HEIGHT;
        }
        
        const boxHeight = this.y - boxTop + pad - 4;
        this.doc.setDrawColor(0);
        this.doc.setLineWidth(0.5);
        this.doc.rect(MARGIN, boxTop, CONTENT_WIDTH, boxHeight);
        this.doc.setLineWidth(1);
        
        this.y += 10; // space after box
        continue;
      }

      // Image
      const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (imgMatch) {
        const src = this.loadImage(imgMatch[2]);
        if (src) {
          try {
            const props = this.doc.getImageProperties(src);
            const targetH = 50; // ~0.7 inches (50pt at 72pt/inch)
            const scale = targetH / props.height;
            const w = Math.min(props.width * scale, CONTENT_WIDTH);
            const h = targetH;
            this.newPageIfNeeded(h + 10);
            this.doc.addImage(src, MARGIN, this.y, w, h);
            this.y += h + 10;
          } catch {}
        }
        i++; continue;
      }

      // Table
      if (line.startsWith("|")) {
        const rows: string[][] = [];
        const rawRows: string[][] = [];
        while (i < lines.length && lines[i].startsWith("|")) {
          const rawCells = lines[i].split("|").slice(1, -1).map(c => c.trim());
          const cells = rawCells.map(c => this.clean(c));
          if (!cells.every(c => /^[-:]+$/.test(c))) {
            rows.push(cells);
            rawRows.push(rawCells);
          }
          i++;
        }
        if (rows.length) {
          const cols = rows[0].length;
          const cellPadding = 4;
          const cellLineHeight = 12;
          
          // Calculate optimal column widths
          const colWidths = this.calculateColumnWidths(rows, cols, cellPadding);
          
          // Calculate column start positions
          const colStarts: number[] = [MARGIN];
          for (let ci = 0; ci < cols - 1; ci++) {
            colStarts.push(colStarts[ci] + colWidths[ci]);
          }
          
          // Draw top border of table
          this.doc.setDrawColor(200);
          this.doc.line(MARGIN, this.y, PAGE_WIDTH - MARGIN, this.y);
          
          for (let ri = 0; ri < rows.length; ri++) {
            const isHeader = ri === 0;
            this.font(isHeader, false, 9);
            
            // Wrap all cells and find max lines needed for this row
            const wrappedCells: string[][] = [];
            let maxLines = 1;
            for (let ci = 0; ci < rows[ri].length; ci++) {
              const cellText = rows[ri][ci] || "";
              const availableWidth = colWidths[ci] - cellPadding * 2;
              const wrapped = this.doc.splitTextToSize(cellText, availableWidth);
              wrappedCells.push(wrapped);
              maxLines = Math.max(maxLines, wrapped.length);
            }
            
            // Row geometry using jsPDF's baseline:"middle" for proper centering
            // This lets jsPDF handle font metrics internally
            const minPadding = 4; // space from line to text edge
            const textBlockHeight = maxLines * cellLineHeight;
            const rowHeight = textBlockHeight + minPadding * 2;
            
            this.newPageIfNeeded(rowHeight);
            
            const rowTop = this.y;
            
            // Draw header background
            if (isHeader) {
              this.doc.setFillColor(240, 240, 240);
              this.doc.rect(MARGIN, rowTop, CONTENT_WIDTH, rowHeight, "F");
            }
            
            // Each cell's text block should be vertically centered in the row
            // Row center is at: rowTop + rowHeight/2
            const rowCenterY = rowTop + rowHeight / 2;
            
            for (let ci = 0; ci < Math.min(wrappedCells.length, cols); ci++) {
              const cellX = colStarts[ci] + cellPadding;
              const cellLines = wrappedCells[ci].length;
              // This cell's text block height
              const cellTextHeight = cellLines * cellLineHeight;
              // Center this cell's text block in the row
              const cellFirstLineCenter = rowCenterY - cellTextHeight / 2 + cellLineHeight / 2;
              
              // Parse segments from raw cell text for highlight rendering
              const rawCell = rawRows[ri]?.[ci] || "";
              const cellSegments = this.parseSegments(rawCell);
              let segIdx = 0, segOffset = 0;
              
              for (let li = 0; li < cellLines; li++) {
                const lineCenter = cellFirstLineCenter + li * cellLineHeight;
                // Build segments for this wrapped line
                const lineSegs: Array<{ text: string; filled: boolean }> = [];
                let remaining = wrappedCells[ci][li].length;
                while (remaining > 0 && segIdx < cellSegments.length) {
                  const seg = cellSegments[segIdx];
                  const available = seg.text.length - segOffset;
                  const take = Math.min(available, remaining);
                  lineSegs.push({ text: seg.text.slice(segOffset, segOffset + take), filled: seg.filled });
                  segOffset += take;
                  remaining -= take;
                  if (segOffset >= seg.text.length) { segIdx++; segOffset = 0; }
                }
                this.drawSegments(lineSegs, cellX, lineCenter, isHeader, 9, { baseline: "middle" });
              }
            }
            
            // Move to bottom of row and draw separator
            this.y = rowTop + rowHeight;
            this.doc.setDrawColor(200);
            this.doc.line(MARGIN, this.y, PAGE_WIDTH - MARGIN, this.y);
          }
          this.y += 14; // gap after table (accounts for following text ascent)
        }
        continue;
      }

      // Checkbox list
      if (line.match(/^[-*]\s+\[[ xX]\]/)) {
        const indent = 24; // Space for checkbox
        while (i < lines.length && lines[i].match(/^[-*]\s+\[[ xX]\]/)) {
          const m = lines[i].match(/^[-*]\s+\[([ xX])\]\s*(.*)$/);
          if (m) {
            this.font(false, false, 10);
            const checked = m[1].toLowerCase() === "x";
            const box = checked ? "[X]" : "[ ]";
            const rawTxt = m[2];
            const txt = this.clean(rawTxt);
            const wrapped = this.doc.splitTextToSize(txt, CONTENT_WIDTH - indent);
            const segments = this.parseSegments(rawTxt);
            let segIdx = 0, segOffset = 0;
            
            for (let li = 0; li < wrapped.length; li++) {
              this.newPageIfNeeded(LINE_HEIGHT);
              if (li === 0) {
                // Render checkbox in blue+bold if checked
                if (checked) {
                  this.font(true, false, 10);
                  this.doc.setTextColor(0, 0, 180);
                }
                this.doc.text(box, MARGIN, this.y);
                this.doc.setTextColor(0, 0, 0);
              }
              const lineSegs: Array<{ text: string; filled: boolean }> = [];
              let remaining = wrapped[li].length;
              while (remaining > 0 && segIdx < segments.length) {
                const seg = segments[segIdx];
                const available = seg.text.length - segOffset;
                const take = Math.min(available, remaining);
                lineSegs.push({ text: seg.text.slice(segOffset, segOffset + take), filled: seg.filled });
                segOffset += take;
                remaining -= take;
                if (segOffset >= seg.text.length) { segIdx++; segOffset = 0; }
              }
              this.drawSegments(lineSegs, MARGIN + indent, this.y, false, 10);
              this.checkVertical(this.y, "checkbox");
              this.y += LINE_HEIGHT;
            }
          }
          i++;
        }
        this.y += 4;
        continue;
      }

      // Bullet list
      if (line.match(/^[-*]\s+[^\[]/)) {
        const indent = 16; // Space for bullet
        while (i < lines.length && lines[i].match(/^[-*]\s+[^\[]/)) {
          this.font(false, false, 10);
          const rawTxt = lines[i].replace(/^[-*]\s+/, "");
          const txt = this.clean(rawTxt);
          const wrapped = this.doc.splitTextToSize(txt, CONTENT_WIDTH - indent);
          const segments = this.parseSegments(rawTxt);
          let segIdx = 0, segOffset = 0;
          
          for (let li = 0; li < wrapped.length; li++) {
            this.newPageIfNeeded(LINE_HEIGHT);
            if (li === 0) {
              this.doc.text("•", MARGIN, this.y);
            }
            const lineSegs: Array<{ text: string; filled: boolean }> = [];
            let remaining = wrapped[li].length;
            while (remaining > 0 && segIdx < segments.length) {
              const seg = segments[segIdx];
              const available = seg.text.length - segOffset;
              const take = Math.min(available, remaining);
              lineSegs.push({ text: seg.text.slice(segOffset, segOffset + take), filled: seg.filled });
              segOffset += take;
              remaining -= take;
              if (segOffset >= seg.text.length) { segIdx++; segOffset = 0; }
            }
            this.drawSegments(lineSegs, MARGIN + indent, this.y, false, 10);
            this.checkVertical(this.y, "bullet");
            this.y += LINE_HEIGHT;
          }
          i++;
        }
        this.y += 4;
        continue;
      }

      // Numbered list
      if (line.match(/^\d+\.\s/)) {
        const indent = 24; // Space for number
        let n = 1;
        while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
          this.font(false, false, 10);
          const rawTxt = lines[i].replace(/^\d+\.\s+/, "");
          const txt = this.clean(rawTxt);
          const wrapped = this.doc.splitTextToSize(txt, CONTENT_WIDTH - indent);
          const segments = this.parseSegments(rawTxt);
          let segIdx = 0, segOffset = 0;
          
          for (let li = 0; li < wrapped.length; li++) {
            this.newPageIfNeeded(LINE_HEIGHT);
            if (li === 0) {
              this.doc.text(`${n}.`, MARGIN, this.y);
            }
            const lineSegs: Array<{ text: string; filled: boolean }> = [];
            let remaining = wrapped[li].length;
            while (remaining > 0 && segIdx < segments.length) {
              const seg = segments[segIdx];
              const available = seg.text.length - segOffset;
              const take = Math.min(available, remaining);
              lineSegs.push({ text: seg.text.slice(segOffset, segOffset + take), filled: seg.filled });
              segOffset += take;
              remaining -= take;
              if (segOffset >= seg.text.length) { segIdx++; segOffset = 0; }
            }
            this.drawSegments(lineSegs, MARGIN + indent, this.y, false, 10);
            this.checkVertical(this.y, "numbered list");
            this.y += LINE_HEIGHT;
          }
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

// CLI entry point - only runs when executed directly
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length < 1) { console.log("Usage: bun md-to-pdf.ts <input.md> [output.pdf]"); process.exit(1); }
  const input = args[0];
  const output = args[1] || input.replace(/\.md$/, ".pdf");
  if (!existsSync(input)) { console.error(`Not found: ${input}`); process.exit(1); }

  const r = new MdPdf(dirname(resolve(input)));
  r.render(readFileSync(input, "utf-8"), resolve(output));
  r.save(output);
}
