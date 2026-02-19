#!/usr/bin/env bun
/**
 * Generate an EHI Export request appendix PDF using pdf-lib.
 * Supports both Epic (default) and non-Epic vendors.
 *
 * Usage:
 *   # Epic (default -- static content):
 *   bun generate-appendix.ts
 *
 *   # Non-Epic vendor with custom details:
 *   bun generate-appendix.ts '{"vendor": {...}}'
 *
 * The vendor object can include:
 *   developer       - Company name (e.g., "athenahealth")
 *   product_name    - Product (e.g., "athenaClinicals")
 *   export_formats  - Array of formats (e.g., ["CSV"])
 *   ehi_documentation_url - Official vendor documentation URL
 *   entity_count    - Number of data entities in export
 *   field_count     - Total documented fields
 *   summary         - Brief description of export quality
 *   grade           - A/B/C rating
 *   coverage        - "comprehensive" or "partial"
 *   approach        - "native", "standards_based", or "hybrid"
 *   userwebTip      - Optional: instructions for finding docs in the vendor's support portal
 *
 * Output: /tmp/appendix.pdf
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';

interface VendorConfig {
  developer?: string;
  product_name?: string;
  export_formats?: string[];
  ehi_documentation_url?: string;
  entity_count?: number;
  field_count?: number;
  summary?: string;
  grade?: string;
  coverage?: string;
  approach?: string;
  userwebTip?: string;
}

interface Config {
  vendor?: VendorConfig;
  date?: string;
  outputPath?: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const config: Config = Bun.argv[2] ? JSON.parse(Bun.argv[2]) : {};
const vendor = config.vendor || null;
const requestDate = config.date || null;
const outputPath = config.outputPath || '/tmp/appendix.pdf';

const isEpic = !vendor;
const vendorName = vendor?.developer || 'Epic Systems';
const productName = vendor?.product_name || 'Epic EHR';
const exportFormats = vendor?.export_formats?.join(', ') || 'TSV';
const ehiDocsUrl = vendor?.ehi_documentation_url || 'https://open.epic.com/EHITables';
const entityCount = vendor?.entity_count;
const fieldCount = vendor?.field_count;

// ---------------------------------------------------------------------------
// Colours & layout
// ---------------------------------------------------------------------------
const DARK_BLUE  = rgb(0x1a / 255, 0x3c / 255, 0x5e / 255);
const GRAY       = rgb(0.45, 0.45, 0.45);
const LIGHT_GRAY = rgb(0.85, 0.85, 0.85);
const WHITE      = rgb(1, 1, 1);
const BLACK      = rgb(0, 0, 0);
const TABLE_ALT  = rgb(0.95, 0.96, 0.98);

const PAGE_W = 612, PAGE_H = 792;
const ML = 58, MR = 58, MT = 40;
const CW = PAGE_W - ML - MR;

const TITLE_SIZE = 21, SUBTITLE_SIZE = 10.5;
const SECTION_SIZE = 12, BODY_SIZE = 11;
const TABLE_HDR_SIZE = 9.5, TABLE_BODY_SIZE = 9;
const BODY_LEADING = BODY_SIZE * 1.5;

// ---------------------------------------------------------------------------
// Text helpers (word-wrapping with inline bold)
// ---------------------------------------------------------------------------
interface TextSegment {
  text: string;
  font: PDFFont;
  size?: number;
  color?: RGB;
}

interface Token {
  word: string;
  font: PDFFont;
  size: number;
  color?: RGB;
  glue: boolean;
}

function wrapSegments(segments: TextSegment[], defaultSize: number, maxWidth: number): TextSegment[][] {
  const tokens: Token[] = [];
  let prevEnd = true;
  for (const seg of segments) {
    const sz = seg.size ?? defaultSize;
    if (seg.text === '') continue;
    const starts = /^\s/.test(seg.text);
    const words = seg.text.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      const glue = (i === 0 && !starts && !prevEnd && tokens.length > 0);
      tokens.push({ word: words[i], font: seg.font, size: sz, color: seg.color, glue });
    }
    prevEnd = /\s$/.test(seg.text);
  }
  const lines: TextSegment[][] = [];
  let cur: TextSegment[] = [], cw = 0;
  for (const t of tokens) {
    const ww = t.font.widthOfTextAtSize(t.word, t.size);
    if (t.glue && cur.length > 0) { cur.push({ text: t.word, font: t.font, size: t.size, color: t.color }); cw += ww; continue; }
    const sp = cur.length > 0 ? t.font.widthOfTextAtSize(' ', t.size) : 0;
    if (cw + sp + ww > maxWidth && cur.length > 0) { lines.push(cur); cur = []; cw = 0; }
    const pfx = cur.length > 0 ? ' ' : '';
    cur.push({ text: pfx + t.word, font: t.font, size: t.size, color: t.color });
    cw += (pfx ? t.font.widthOfTextAtSize(' ', t.size) : 0) + ww;
  }
  if (cur.length > 0) lines.push(cur);
  return lines;
}

function drawWrapped(page: PDFPage, segs: TextSegment[], x: number, y: number, sz: number, maxW: number, lead: number, color: RGB): number {
  for (const line of wrapSegments(segs, sz, maxW)) {
    let cx = x;
    for (const s of line) {
      page.drawText(s.text, { x: cx, y, size: s.size ?? sz, font: s.font, color: s.color ?? color });
      cx += s.font.widthOfTextAtSize(s.text, s.size ?? sz);
    }
    y -= lead;
  }
  return y;
}

function md(text: string, roman: PDFFont, bold: PDFFont): TextSegment[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map(p =>
    p.startsWith('**') && p.endsWith('**')
      ? { text: p.slice(2, -2), font: bold }
      : { text: p, font: roman }
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const doc = await PDFDocument.create();
const page = doc.addPage([PAGE_W, PAGE_H]);

const hb = await doc.embedFont(StandardFonts.HelveticaBold);
const h  = await doc.embedFont(StandardFonts.Helvetica);
const ho = await doc.embedFont(StandardFonts.HelveticaOblique);
const tr = await doc.embedFont(StandardFonts.TimesRoman);
const tb = await doc.embedFont(StandardFonts.TimesRomanBold);

let y = PAGE_H - MT;

// --- Title ---
{ const t = 'APPENDIX A'; const tw = hb.widthOfTextAtSize(t, TITLE_SIZE);
  page.drawText(t, { x: (PAGE_W - tw) / 2, y, size: TITLE_SIZE, font: hb, color: DARK_BLUE }); y -= 16; }
{ const t = 'Detailed Description of Health Information Requested'; const tw = ho.widthOfTextAtSize(t, SUBTITLE_SIZE);
  page.drawText(t, { x: (PAGE_W - tw) / 2, y, size: SUBTITLE_SIZE, font: ho, color: GRAY }); y -= 18; }

page.drawLine({ start: { x: ML, y }, end: { x: PAGE_W - MR, y }, thickness: 0.75, color: DARK_BLUE });
y -= 14;

// --- Helpers ---
function section(title: string) {
  page.drawText(title, { x: ML, y, size: SECTION_SIZE, font: hb, color: DARK_BLUE });
  y -= 4;
  page.drawLine({ start: { x: ML, y }, end: { x: PAGE_W - MR, y }, thickness: 0.5, color: DARK_BLUE, opacity: 0.3 });
  y -= BODY_LEADING + 2;
}
function para(text: string, indent = 0) {
  y = drawWrapped(page, md(text, tr, tb), ML + indent, y, BODY_SIZE, CW - indent, BODY_LEADING, BLACK);
  y -= 2;
}
function numbered(num: number, text: string) {
  const label = `${num}. `;
  const lw = tb.widthOfTextAtSize(label, BODY_SIZE);
  page.drawText(label, { x: ML, y, size: BODY_SIZE, font: tb, color: BLACK });
  y = drawWrapped(page, md(text, tr, tb), ML + lw + 2, y, BODY_SIZE, CW - lw - 2, BODY_LEADING, BLACK);
  y -= 1;
}
function bullet(text: string) {
  page.drawText('\u2022', { x: ML + 1, y, size: BODY_SIZE, font: h, color: BLACK });
  y = drawWrapped(page, md(text, tr, tb), ML + 14, y, BODY_SIZE, CW - 14, BODY_LEADING, BLACK);
  y -= 1;
}

// ── Section 1: What I Am Requesting ──
section('What I Am Requesting');

if (isEpic) {
  para(
    'I am requesting a complete **Electronic Health Information (EHI) Export** of my patient record, ' +
    'produced using the **EHI Export** feature built into your Epic electronic health record system. ' +
    'This is a specific, named feature in Epic \u2014 distinct from a CCDA, MyChart download, or standard ' +
    'records release \u2014 that produces a bulk export of all structured data in my record as **tab-separated ' +
    'value (TSV) files**, plus any associated documents and images. The full specification is published by ' +
    'Epic at **open.epic.com/EHITables**.'
  );
} else {
  let text =
    'I am requesting a complete **Electronic Health Information (EHI) Export** of my patient record, ' +
    `produced using the certified EHI Export feature of your **${productName}** system (by **${vendorName}**). ` +
    'This is a specific, certified feature \u2014 distinct from a patient summary, portal download, or standard ' +
    `records release \u2014 that produces a bulk export of all structured data in my record as **${exportFormats}** files`;
  if (entityCount && fieldCount) {
    text += ` (covering ${entityCount} data tables and ${fieldCount}+ documented fields)`;
  }
  text += '.';
  if (ehiDocsUrl) {
    text += ` The vendor\u2019s official documentation is published at **${ehiDocsUrl}**.`;
  }
  para(text);
}
y -= 8;

// ── Section 2: Legal Basis ──
section('Legal Basis');
numbered(1,
  '**HIPAA Right of Access (45 CFR \u00A7 164.524):** I have the right to receive my PHI in the electronic ' +
  'form and format I request, if readily producible. The EHI Export is a built-in, certified feature, so it is **readily producible**.'
);
numbered(2,
  '**21st Century Cures Act (45 CFR Part 171):** Declining to use an available, certified EHI Export feature ' +
  'when a patient requests it could constitute **information blocking**.'
);
numbered(3,
  '**ONC Certification \u00A7 170.315(b)(10):** Since December 31, 2023, all certified EHR systems must support ' +
  'single-patient EHI export in a computable format.' +
  (isEpic ? ' Epic\u2019s EHI Export satisfies this requirement.' : ` **${productName}** is certified to meet this requirement.`)
);
y -= 8;

// ── Section 3: How to Produce This Export ──
section('How to Produce This Export');

if (isEpic) {
  numbered(1, 'Search the **Epic UserWeb** (userweb.epic.com) for "EHI Export" \u2014 it contains configuration guides and step-by-step instructions.');
  numbered(2, 'Contact your **Epic Technical Services (TS)** rep if the feature hasn\u2019t been configured yet. It\u2019s a standard certified feature, not a custom build.');
  numbered(3, 'The export produces a **zip file of TSV files** (one per database table), plus rich-text documents and images.');
} else {
  numbered(1, `Refer to the vendor\u2019s official EHI Export documentation at **${ehiDocsUrl || 'your vendor\u2019s support portal'}**.`);
  if (vendor?.userwebTip) {
    numbered(2, vendor.userwebTip);
  } else {
    numbered(2, `Contact **${vendorName}** support or your system administrator if the feature hasn\u2019t been configured. It is a standard certified feature required for ONC certification.`);
  }
  numbered(3, `The export produces **${exportFormats}** files containing the structured data from my record.`);
}
y -= 8;

// ── Reference table ──
{
  const colW = [CW * 0.42, CW * 0.58];
  const rowH = 18, headerH = 20, tableX = ML;
  const rows: string[][] = [];

  if (isEpic) {
    rows.push(['Epic EHI Tables spec', 'https://open.epic.com/EHITables']);
  } else if (ehiDocsUrl) {
    rows.push([`${vendorName} EHI docs`, ehiDocsUrl]);
  }
  rows.push(['ONC certification test method', 'healthit.gov/test-method/electronic-health-information-export']);
  rows.push(['21st Century Cures Act Final Rule', 'federalregister.gov/d/2020-07419']);

  const totalH = headerH + rowH * rows.length;
  page.drawRectangle({ x: tableX, y: y - headerH, width: CW, height: headerH, color: DARK_BLUE });
  const hdrs = ['Reference', 'URL / Citation'];
  let hx = tableX;
  for (let c = 0; c < 2; c++) {
    page.drawText(hdrs[c], { x: hx + 6, y: y - headerH + 6, size: TABLE_HDR_SIZE, font: hb, color: WHITE });
    hx += colW[c];
  }
  y -= headerH;
  for (let r = 0; r < rows.length; r++) {
    const ry = y - rowH;
    if (r % 2 === 0) page.drawRectangle({ x: tableX, y: ry, width: CW, height: rowH, color: TABLE_ALT });
    page.drawLine({ start: { x: tableX, y: ry }, end: { x: tableX + CW, y: ry }, thickness: 0.3, color: LIGHT_GRAY });
    let cx = tableX;
    for (let c = 0; c < 2; c++) {
      const font = c === 0 ? tb : tr;
      const color = c === 1 ? DARK_BLUE : BLACK;
      let txt = rows[r][c];
      while (font.widthOfTextAtSize(txt, TABLE_BODY_SIZE) > colW[c] - 12 && txt.length > 10) {
        txt = txt.slice(0, -4) + '...';
      }
      page.drawText(txt, { x: cx + 6, y: ry + 5, size: TABLE_BODY_SIZE, font, color });
      cx += colW[c];
    }
    y -= rowH;
  }
  page.drawRectangle({ x: tableX, y, width: CW, height: totalH, borderColor: LIGHT_GRAY, borderWidth: 0.5, color: WHITE, opacity: 0 });
  page.drawLine({ start: { x: tableX + colW[0], y }, end: { x: tableX + colW[0], y: y + totalH }, thickness: 0.3, color: LIGHT_GRAY });
  y -= 18;
}

// ── Section 4: Delivery & Notes ──
section('Delivery & Notes');

if (isEpic) {
  bullet('Epic supports delivering EHI Export results directly through **MyChart** \u2014 this is the preferred delivery method. If MyChart delivery is not available, please provide the export via secure download link, encrypted USB drive, or encrypted email.');
} else {
  bullet('Please provide the export electronically \u2014 via your patient portal, secure download link, encrypted USB drive, or encrypted email. I am happy to coordinate logistics.');
}
bullet('**Please do not substitute** a CCDA, patient summary, or portal download. I am specifically requesting the **full EHI Export** as certified under ONC \u00A7 170.315(b)(10).');
bullet('Under HIPAA, you must act on this request **within 30 days** (with one 30-day extension if you notify me in writing).');

// ── Footer reference line ──
if (requestDate) {
  const refLine = `Accompanies Request for Access to PHI dated ${requestDate}`;
  const refW = ho.widthOfTextAtSize(refLine, 8);
  page.drawText(refLine, { x: (PAGE_W - refW) / 2, y: 24, size: 8, font: ho, color: GRAY });
}

// ── Save ──
const bytes = await doc.save();
await Bun.write(outputPath, bytes);
console.log(`Wrote ${outputPath}` + (vendor ? ` (${vendorName} / ${productName})` : ' (Epic default)'));
