#!/usr/bin/env bun
/**
 * Unit tests for md-to-pdf.ts bounds checking and rendering
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { MdPdf, BoundsError, BoundsViolation } from "../md-to-pdf";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let tempDir: string;

function setup() {
  tempDir = mkdtempSync(join(tmpdir(), "md-to-pdf-test-"));
}

function cleanup() {
  rmSync(tempDir, { recursive: true, force: true });
}

function renderMd(md: string, strict = true): { violations: BoundsViolation[], output: string } {
  const violations: BoundsViolation[] = [];
  const inputPath = join(tempDir, "test.md");
  const outputPath = join(tempDir, "test.pdf");
  writeFileSync(inputPath, md);
  
  const renderer = new MdPdf(tempDir, {
    strict,
    onViolation: (v) => violations.push(v),
  });
  renderer.render(md);
  renderer.save(outputPath);
  
  return { violations, output: outputPath };
}

describe("md-to-pdf bounds checking", () => {
  beforeEach(() => {
    setup();
  });

  describe("table cell wrapping", () => {
    test("short text in cells passes", () => {
      const md = `
| Name | Value |
|------|-------|
| foo  | bar   |
`;
      const { violations } = renderMd(md, false);
      const tableViolations = violations.filter(v => v.context.includes("Table cell"));
      expect(tableViolations).toHaveLength(0);
      cleanup();
    });

    test("long text in single cell wraps (no overflow)", () => {
      const longText = "A".repeat(200); // Would be too long without wrapping
      const md = `
| Column 1 | Column 2 |
|----------|----------|
| ${longText} | short |
`;
      const { violations } = renderMd(md, false);
      const tableViolations = violations.filter(v => v.context.includes("Table cell"));
      expect(tableViolations).toHaveLength(0);
      cleanup();
    });

    test("long text in narrow table (many columns) wraps (no overflow)", () => {
      const md = `
| A | B | C | D | E | F |
|---|---|---|---|---|---|
| This text is definitely way too long for a narrow cell but should wrap | x | x | x | x | x |
`;
      const { violations } = renderMd(md, false);
      const tableViolations = violations.filter(v => v.context.includes("Table cell"));
      expect(tableViolations).toHaveLength(0);
      cleanup();
    });

    test("multi-row wrapped cells maintain alignment", () => {
      const longText = "This is a long description that needs to wrap";
      const md = `
| Field | Description |
|-------|-------------|
| Name | ${longText} |
| DOB | Short |
`;
      const { violations } = renderMd(md, false);
      expect(violations).toHaveLength(0);
      cleanup();
    });
  });

  describe("list item wrapping", () => {
    test("short bullet items pass", () => {
      const md = `
- Item one
- Item two
- Item three
`;
      const { violations } = renderMd(md, false);
      const bulletViolations = violations.filter(v => v.context.includes("bullet"));
      expect(bulletViolations).toHaveLength(0);
      cleanup();
    });

    test("long bullet item wraps correctly", () => {
      const longItem = "Word ".repeat(100);
      const md = `- ${longItem}`;
      const { violations } = renderMd(md, false);
      const bulletViolations = violations.filter(v => v.context.includes("bullet") && v.type === "horizontal_overflow");
      expect(bulletViolations).toHaveLength(0);
      cleanup();
    });

    test("long checkbox item wraps correctly", () => {
      const longItem = "Task ".repeat(80);
      const md = `- [x] ${longItem}`;
      const { violations } = renderMd(md, false);
      const checkboxViolations = violations.filter(v => v.context.includes("checkbox") && v.type === "horizontal_overflow");
      expect(checkboxViolations).toHaveLength(0);
      cleanup();
    });

    test("long numbered list item wraps correctly", () => {
      const longItem = "Step ".repeat(80);
      const md = `1. ${longItem}`;
      const { violations } = renderMd(md, false);
      const numberedViolations = violations.filter(v => v.context.includes("numbered") && v.type === "horizontal_overflow");
      expect(numberedViolations).toHaveLength(0);
      cleanup();
    });
  });

  describe("paragraph text", () => {
    test("paragraphs wrap correctly (no overflow)", () => {
      const longPara = "This is a long paragraph. ".repeat(50);
      const md = longPara;
      const { violations } = renderMd(md, false);
      // Paragraphs use splitTextToSize so should wrap
      const paraViolations = violations.filter(v => v.context === "paragraph");
      expect(paraViolations).toHaveLength(0);
      cleanup();
    });
  });

  describe("headers", () => {
    test("headers wrap correctly (no overflow)", () => {
      const longTitle = "Word ".repeat(30);
      const md = `# ${longTitle}\n\n## ${longTitle}\n\n### ${longTitle}`;
      const { violations } = renderMd(md, false);
      const headerViolations = violations.filter(v => 
        v.context.includes("H1") || v.context.includes("H2") || v.context.includes("H3")
      );
      expect(headerViolations).toHaveLength(0);
      cleanup();
    });
  });

  describe("page overflow", () => {
    test("many lines trigger page break without overflow", () => {
      const lines = Array(100).fill("This is a line of text.").join("\n\n");
      const { violations } = renderMd(lines, false);
      const pageViolations = violations.filter(v => v.type === "vertical_overflow");
      expect(pageViolations).toHaveLength(0);
      cleanup();
    });

    test("large blockquote triggers page break correctly", () => {
      const longQuote = Array(50).fill("> Line of quoted text").join("\n");
      const { violations } = renderMd(longQuote, false);
      const pageViolations = violations.filter(v => v.type === "vertical_overflow");
      expect(pageViolations).toHaveLength(0);
      cleanup();
    });
  });

  describe("mixed content", () => {
    test("realistic form transcription with tables", () => {
      const md = `
# Medical Records Request Form

## Patient Information

| Field | Value |
|-------|-------|
| Name | John Doe |
| DOB | 01/15/1980 |
| Phone | (555) 123-4567 |

## Request Type

- [x] Complete medical records
- [ ] Lab results only
- [ ] Imaging only

## Authorization

I authorize the release of my medical records.

**Signature:** _________________  **Date:** _________
`;
      const { violations } = renderMd(md, false);
      expect(violations).toHaveLength(0);
      cleanup();
    });
  });
});

describe("md-to-pdf wrapping behavior", () => {
  beforeEach(() => {
    setup();
  });

  test("long table cell text wraps within cell", () => {
    const longText = "This is a very long piece of text that should wrap within the table cell instead of overflowing";
    const md = `
| Description | Notes |
|-------------|-------|
| ${longText} | OK |
`;
    const { violations } = renderMd(md, false);
    const tableOverflows = violations.filter(v => 
      v.type === "horizontal_overflow" && v.context.includes("Table cell")
    );
    expect(tableOverflows).toHaveLength(0);
    cleanup();
  });

  test("long bullet item wraps to multiple lines", () => {
    const longItem = "This is a very long bullet point that contains a lot of text and should wrap to multiple lines instead of overflowing the page margins";
    const md = `- ${longItem}`;
    const { violations } = renderMd(md, false);
    const bulletOverflows = violations.filter(v => 
      v.type === "horizontal_overflow" && v.context.includes("bullet")
    );
    expect(bulletOverflows).toHaveLength(0);
    cleanup();
  });

  test("long checkbox item wraps to multiple lines", () => {
    const longItem = "Complete this very important task that has a long description explaining what needs to be done in detail";
    const md = `- [x] ${longItem}`;
    const { violations } = renderMd(md, false);
    const checkboxOverflows = violations.filter(v => 
      v.type === "horizontal_overflow" && v.context.includes("checkbox")
    );
    expect(checkboxOverflows).toHaveLength(0);
    cleanup();
  });

  test("long numbered list item wraps to multiple lines", () => {
    const longItem = "First step involves doing something that requires a detailed explanation that spans multiple lines on the page";
    const md = `1. ${longItem}`;
    const { violations } = renderMd(md, false);
    const numberedOverflows = violations.filter(v => 
      v.type === "horizontal_overflow" && v.context.includes("numbered")
    );
    expect(numberedOverflows).toHaveLength(0);
    cleanup();
  });
});

describe("md-to-pdf column width optimization", () => {
  beforeEach(() => {
    setup();
  });

  test("narrow label column gives space to value column", () => {
    const md = `
| Field | Value |
|-------|-------|
| Name | This is a very long value that should have plenty of room to display |
| DOB | 1980-01-15 |
`;
    const { violations } = renderMd(md, false);
    expect(violations).toHaveLength(0);
    cleanup();
  });

  test("multiple narrow columns redistribute to final column", () => {
    const md = `
| # | A | B | Result |
|---|---|---|--------|
| 1 | X |   | This result column should get much more space than the narrow columns |
| 2 |   | X | Another detailed result description |
`;
    const { violations } = renderMd(md, false);
    expect(violations).toHaveLength(0);
    cleanup();
  });

  test("equal content keeps roughly equal columns", () => {
    const md = `
| Col A | Col B | Col C |
|-------|-------|-------|
| Medium text | Medium text | Medium text |
| More words | More words | More words |
`;
    const { violations } = renderMd(md, false);
    expect(violations).toHaveLength(0);
    cleanup();
  });
});

describe("md-to-pdf edge cases", () => {
  beforeEach(() => {
    setup();
  });

  test("empty table cells don't crash", () => {
    const md = `
| A | B | C |
|---|---|---|
|   |   |   |
| x |   | y |
`;
    expect(() => renderMd(md, true)).not.toThrow();
    cleanup();
  });

  test("uneven table rows don't crash", () => {
    const md = `
| A | B | C |
|---|---|---|
| x | y |
| a | b | c | d |
`;
    expect(() => renderMd(md, true)).not.toThrow();
    cleanup();
  });

  test("very long single word wraps (word break)", () => {
    const longWord = "Supercalifragilisticexpialidocious".repeat(10);
    const md = `| Header |\n|--------|\n| ${longWord} |`;
    // jsPDF should break the word even without spaces
    const { violations } = renderMd(md, false);
    expect(violations.filter(v => v.type === "horizontal_overflow")).toHaveLength(0);
    cleanup();
  });

  test("nested formatting in lists", () => {
    const md = `
- **Bold item** with text
- *Italic item* with text
- Normal item with ***bold italic***
`;
    expect(() => renderMd(md, true)).not.toThrow();
    cleanup();
  });

  test("mixed content page breaks correctly", () => {
    const longTable = Array(20).fill("| Cell content here | More content |\n").join("");
    const md = `
# Header

Some paragraph text.

| Col A | Col B |
|-------|-------|
${longTable}

## Another Section

- Item 1
- Item 2
`;
    const { violations } = renderMd(md, false);
    const pageViolations = violations.filter(v => v.type === "vertical_overflow");
    expect(pageViolations).toHaveLength(0);
    cleanup();
  });

  test("blockquote with long text wraps", () => {
    const longQuote = "This is a very long quote that should wrap properly within the blockquote box. ".repeat(10);
    const md = `> ${longQuote}`;
    const { violations } = renderMd(md, false);
    expect(violations.filter(v => v.type === "horizontal_overflow")).toHaveLength(0);
    cleanup();
  });

  test("image reference that doesn't exist doesn't crash", () => {
    const md = `![Alt text](nonexistent.png)`;
    expect(() => renderMd(md, true)).not.toThrow();
    cleanup();
  });

  test("unicode characters render", () => {
    const md = `
# Test Unicode

- Bullet with emoji: ✔ ✘
- Currency: €100, £50
- Arrows: → ← ↑ ↓
`;
    expect(() => renderMd(md, true)).not.toThrow();
    cleanup();
  });
});
