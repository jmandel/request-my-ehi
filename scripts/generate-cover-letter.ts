#!/usr/bin/env bun
/**
 * Generate a cover letter PDF for EHI Export access requests.
 * Includes patient name and DOB for identification if pages separate.
 *
 * Usage:
 *   bun generate-cover-letter.ts                                    # generic (no patient info)
 *   bun generate-cover-letter.ts '{"patientName": "...", "dob": "..."}' # with patient info
 *
 * Config fields:
 *   patientName  - Patient's full name (optional)
 *   dob          - Date of birth (optional)
 *   date         - Date of request, defaults to today (optional)
 *   outputPath   - Output file path, defaults to /tmp/cover-letter.pdf
 *
 * Output: /tmp/cover-letter.pdf (or configurable path)
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';

interface Config {
  patientName?: string;
  dob?: string;
  date?: string;
  outputPath?: string;
}

const config: Config = Bun.argv[2] ? JSON.parse(Bun.argv[2]) : {};
const outputPath = config.outputPath || '/tmp/cover-letter.pdf';
const patientName = config.patientName || null;
const dob = config.dob || null;
const requestDate = config.date || new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });

// ---------------------------------------------------------------------------
// Colours & layout
// ---------------------------------------------------------------------------
const DARK_BLUE  = rgb(0x1a / 255, 0x3c / 255, 0x5e / 255);
const GRAY       = rgb(0.45, 0.45, 0.45);
const BLACK      = rgb(0, 0, 0);

const PAGE_W = 612, PAGE_H = 792;
const ML = 58, MR = 58, MT = 50;
const CW = PAGE_W - ML - MR;

const TITLE_SIZE = 18;
const HEADING_SIZE = 12;
const BODY_SIZE = 11;
const BODY_LEADING = BODY_SIZE * 1.55;

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------
interface TextSegment {
  text: string;
  font: PDFFont;
  size?: number;
  color?: RGB;
}

function wrapSegments(segments: TextSegment[], defaultSize: number, maxWidth: number): TextSegment[][] {
  interface Token { word: string; font: PDFFont; size: number; color?: RGB; glue: boolean; }
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
{
  const t = 'COVER LETTER';
  const tw = hb.widthOfTextAtSize(t, TITLE_SIZE);
  page.drawText(t, { x: (PAGE_W - tw) / 2, y, size: TITLE_SIZE, font: hb, color: DARK_BLUE });
  y -= 16;
}
{
  const t = 'Patient Request for Access to Electronic Health Information';
  const tw = ho.widthOfTextAtSize(t, 10.5);
  page.drawText(t, { x: (PAGE_W - tw) / 2, y, size: 10.5, font: ho, color: GRAY });
  y -= 18;
}
page.drawLine({ start: { x: ML, y }, end: { x: PAGE_W - MR, y }, thickness: 0.75, color: DARK_BLUE });
y -= 20;

// --- Patient identification line ---
if (patientName) {
  let idLine = `**${patientName}**`;
  if (dob) idLine += ` \u00B7 DOB: ${dob}`;
  y = drawWrapped(page, md(idLine, h, hb), ML, y, BODY_SIZE, CW, BODY_LEADING, BLACK);
  y -= 10;
}

// --- To ---
page.drawText('To:', { x: ML, y, size: HEADING_SIZE, font: hb, color: DARK_BLUE });
y -= BODY_LEADING + 2;
y = drawWrapped(page, md('**Medical Records / Health Information Management Department**', tr, tb), ML + 14, y, BODY_SIZE, CW - 14, BODY_LEADING, BLACK);
y -= 14;

// --- Body paragraphs ---
function para(text: string) {
  y = drawWrapped(page, md(text, tr, tb), ML, y, BODY_SIZE, CW, BODY_LEADING, BLACK);
  y -= BODY_LEADING * 0.5;
}

function bullet(text: string) {
  page.drawText('\u2022', { x: ML + 1, y, size: BODY_SIZE, font: h, color: BLACK });
  y = drawWrapped(page, md(text, tr, tb), ML + 14, y, BODY_SIZE, CW - 14, BODY_LEADING, BLACK);
  y -= 2;
}

para(
  'I\u2019m writing to request access to my health information under the **HIPAA Right of Access ' +
  '(45 CFR \u00A7 164.524)**. My signed request form and a detailed appendix with instructions are attached.'
);

para(
  'I want to flag that **this is different from a standard records release.** I\u2019m not asking for a ' +
  'CCDA, patient summary, or portal download \u2014 I\u2019m requesting a complete **Electronic Health ' +
  'Information (EHI) Export**, which is a specific built-in feature of your EHR system. The attached ' +
  'appendix explains what this is and how to produce it.'
);

para(
  'If you\u2019re in the medical records department and this isn\u2019t something you typically handle, ' +
  'that\u2019s okay \u2014 **please forward this entire request to your HIM director, IT department, or ' +
  'EHR administration team.** They\u2019ll be familiar with this feature, and the appendix includes ' +
  'step-by-step instructions and links to your EHR vendor\u2019s documentation.'
);

y -= 2;
page.drawText('A few things worth noting:', { x: ML, y, size: BODY_SIZE, font: tr, color: BLACK });
y -= BODY_LEADING + 2;

bullet(
  'Under HIPAA, this request should be acted on within **30 calendar days**. If more time is needed, ' +
  'I\u2019d just need written notice with a reason and a new target date.'
);
bullet(
  'Because the EHI Export is produced using built-in certified EHR functionality, **no fee should apply** ' +
  '(45 CFR \u00A7 164.524(c)(4)).'
);
bullet(
  'This request applies even if my records are held by a business associate on your behalf \u2014 ' +
  'the obligation to provide access runs through to whoever maintains the data (45 CFR \u00A7 164.524(b)(2)(iii)).'
);
bullet(
  'If this request isn\u2019t fulfilled, I have the right to file a complaint with the HHS Office for Civil Rights.'
);

y -= 6;

para(
  'I\u2019m happy to help coordinate on delivery logistics \u2014 you can reach me using the contact ' +
  'information on the attached form.'
);

para('Thank you for your help with this.');

// --- Footer note ---
y = 58;
page.drawLine({ start: { x: ML, y: y + 14 }, end: { x: PAGE_W - MR, y: y + 14 }, thickness: 0.3, color: GRAY });
{
  const note = 'This letter accompanies my signed access request form and a detailed appendix.';
  const nw = ho.widthOfTextAtSize(note, 8.5);
  page.drawText(note, { x: (PAGE_W - nw) / 2, y, size: 8.5, font: ho, color: GRAY });
}

// --- Save ---
const bytes = await doc.save();
await Bun.write(outputPath, bytes);
console.log(`Wrote ${outputPath}` + (patientName ? ` (${patientName})` : ' (generic)'));
