#!/usr/bin/env bun
/**
 * Geometry tests for table rendering - verifies text doesn't intersect lines
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { MdPdf } from "../md-to-pdf";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let tempDir: string;

function setup() {
  tempDir = mkdtempSync(join(tmpdir(), "table-geom-test-"));
}

function cleanup() {
  rmSync(tempDir, { recursive: true, force: true });
}

interface DrawOp {
  type: "text" | "line" | "rect";
  x: number;
  y: number;
  // For text: approximate bounds based on font size
  top?: number;
  bottom?: number;
  content?: string;
  // For line
  x2?: number;
  y2?: number;
  // For rect
  width?: number;
  height?: number;
}

/**
 * Parse PDF content stream to extract drawing operations
 * This is a simplified parser that looks for text and line operations
 */
function extractDrawOps(pdfBuffer: Buffer): DrawOp[] {
  const content = pdfBuffer.toString("latin1");
  const ops: DrawOp[] = [];
  
  // Find all content streams (between "stream" and "endstream")
  const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
  let match;
  
  while ((match = streamRegex.exec(content)) !== null) {
    const stream = match[1];
    
    // Look for text operations: "BT ... (text) Tj ... ET"
    // Text position set by "x y Td" or "x y Tm"
    const textBlocks = stream.matchAll(/BT\s+([\s\S]*?)ET/g);
    for (const block of textBlocks) {
      const blockContent = block[1];
      
      // Find position commands (Td or Tm)
      const posMatch = blockContent.match(/([\d.]+)\s+([\d.]+)\s+Td/);
      const tmMatch = blockContent.match(/[\d.]+\s+[\d.]+\s+[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)\s+Tm/);
      
      // Find text content
      const textMatch = blockContent.match(/\(([^)]*)\)\s*Tj/);
      
      if ((posMatch || tmMatch) && textMatch) {
        const x = parseFloat(posMatch?.[1] || tmMatch?.[1] || "0");
        const y = parseFloat(posMatch?.[2] || tmMatch?.[2] || "0");
        const text = textMatch[1];
        
        // Font size 9pt: ascent ~7pt, descent ~2pt
        ops.push({
          type: "text",
          x,
          y, // baseline
          top: y + 7, // approximate top (PDF y increases upward)
          bottom: y - 2, // approximate bottom with descenders
          content: text,
        });
      }
    }
    
    // Look for line operations: "x1 y1 m x2 y2 l S"
    const lineRegex = /([\d.]+)\s+([\d.]+)\s+m\s+([\d.]+)\s+([\d.]+)\s+l\s+S/g;
    let lineMatch;
    while ((lineMatch = lineRegex.exec(stream)) !== null) {
      ops.push({
        type: "line",
        x: parseFloat(lineMatch[1]),
        y: parseFloat(lineMatch[2]),
        x2: parseFloat(lineMatch[3]),
        y2: parseFloat(lineMatch[4]),
      });
    }
    
    // Look for rectangles: "x y w h re f" or "x y w h re S"
    const rectRegex = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+re\s+[fS]/g;
    let rectMatch;
    while ((rectMatch = rectRegex.exec(stream)) !== null) {
      ops.push({
        type: "rect",
        x: parseFloat(rectMatch[1]),
        y: parseFloat(rectMatch[2]),
        width: parseFloat(rectMatch[3]),
        height: parseFloat(rectMatch[4]),
      });
    }
  }
  
  return ops;
}

function renderAndExtract(md: string): DrawOp[] {
  const outputPath = join(tempDir, "test.pdf");
  const renderer = new MdPdf(tempDir, { strict: false });
  renderer.render(md);
  renderer.save(outputPath);
  return extractDrawOps(readFileSync(outputPath));
}

describe("table geometry", () => {
  beforeEach(() => setup());

  test("horizontal lines don't intersect text bounds", () => {
    const md = `
| Header 1 | Header 2 |
|----------|----------|
| Row 1 Col 1 | Row 1 Col 2 |
| Row 2 Col 1 | Row 2 Col 2 |
`;
    const ops = renderAndExtract(md);
    
    const textOps = ops.filter(o => o.type === "text");
    const lineOps = ops.filter(o => o.type === "line" && o.y === o.y2); // horizontal lines
    
    console.log("Text operations:");
    textOps.forEach(t => console.log(`  "${t.content}" at y=${t.y} (top=${t.top}, bottom=${t.bottom})`));
    console.log("Line operations:");
    lineOps.forEach(l => console.log(`  line at y=${l.y}`));
    
    // Check that no horizontal line intersects any text's vertical bounds
    for (const line of lineOps) {
      for (const text of textOps) {
        const lineY = line.y!;
        const textTop = text.top!;
        const textBottom = text.bottom!;
        
        // Line should not be between text bottom and top
        const intersects = lineY >= textBottom && lineY <= textTop;
        if (intersects) {
          console.log(`INTERSECTION: line at y=${lineY} intersects text "${text.content}" (${textBottom} to ${textTop})`);
        }
        expect(intersects).toBe(false);
      }
    }
    
    cleanup();
  });

  test("text baseline is reasonably centered in row", () => {
    const md = `
| A | B |
|---|---|
| x | y |
`;
    const ops = renderAndExtract(md);
    
    const textOps = ops.filter(o => o.type === "text");
    const lineOps = ops.filter(o => o.type === "line" && o.y === o.y2);
    
    // Sort by y position (PDF coordinates: higher y = higher on page)
    lineOps.sort((a, b) => b.y! - a.y!);
    
    console.log("Sorted lines (top to bottom):", lineOps.map(l => l.y));
    console.log("Text positions:", textOps.map(t => ({ content: t.content, y: t.y })));
    
    // For each text, find the lines above and below it
    for (const text of textOps) {
      const linesAbove = lineOps.filter(l => l.y! > text.y!);
      const linesBelow = lineOps.filter(l => l.y! < text.y!);
      
      if (linesAbove.length > 0 && linesBelow.length > 0) {
        const lineAbove = linesAbove[linesAbove.length - 1]; // closest above
        const lineBelow = linesBelow[0]; // closest below
        
        const spaceAbove = lineAbove.y! - text.top!;
        const spaceBelow = text.bottom! - lineBelow.y!;
        
        console.log(`Text "${text.content}": space above=${spaceAbove.toFixed(1)}, space below=${spaceBelow.toFixed(1)}`);
        
        // Should have at least 2pt clearance on each side
        expect(spaceAbove).toBeGreaterThan(2);
        expect(spaceBelow).toBeGreaterThan(2);
      }
    }
    
    cleanup();
  });

  test("multi-line cells have adequate spacing", () => {
    const md = `
| Short | Long text that will wrap to multiple lines in this cell |
|-------|----------------------------------------------------------|
| A | B |
`;
    const ops = renderAndExtract(md);
    
    const textOps = ops.filter(o => o.type === "text");
    const lineOps = ops.filter(o => o.type === "line" && o.y === o.y2);
    
    console.log("All text ops:", textOps.map(t => ({ y: t.y, content: t.content?.substring(0, 20) })));
    console.log("All line ops:", lineOps.map(l => l.y));
    
    // Verify no intersections
    for (const line of lineOps) {
      for (const text of textOps) {
        const intersects = line.y! >= text.bottom! && line.y! <= text.top!;
        expect(intersects).toBe(false);
      }
    }
    
    cleanup();
  });
});
