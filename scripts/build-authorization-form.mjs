#!/usr/bin/env node
/**
 * Build templates/authorization-form.pdf — a single-page, US Letter fillable
 * PDF form for requesting access to Protected Health Information.
 *
 * Usage:
 *   node scripts/build-authorization-form.mjs
 *
 * Output: templates/authorization-form.pdf (overwritten if exists)
 *
 * Requires: pdf-lib (npm install pdf-lib)
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(__dirname, '..', 'templates', 'authorization-form.pdf');

// ── Page geometry ──────────────────────────────────────────────────────────
const W = 612, H = 792;
const ML = 55, MR = 55, MT = 45, MB = 40;
const CW = W - ML - MR; // 502
const RIGHT = ML + CW;  // 557

// Convert "from-top" Y to pdf-lib bottom-left Y
const pdfY = (fromTop) => H - fromTop;

// ── Colors ─────────────────────────────────────────────────────────────────
const ACCENT    = rgb(0.102, 0.235, 0.369); // navy
const BODY      = rgb(0.102, 0.102, 0.102); // near-black
const SUBTLE    = rgb(0.392, 0.392, 0.392); // gray
const LINE_CLR  = rgb(0.6,   0.6,   0.6);   // field lines

// ── Font sizes ─────────────────────────────────────────────────────────────
const TITLE_SZ      = 14;
const SUBTITLE_SZ   = 8.5;
const SECTION_SZ    = 10.5;
const BODY_SZ       = 9.5;
const LABEL_SZ      = 8.5;
const RIGHTS_SZ     = 8.5;
const FOOTER_SZ     = 7.5;
const ANNOT_SZ      = 8;

// ── Field geometry ─────────────────────────────────────────────────────────
const FIELD_H       = 18;
const SIG_H         = 24;
const REP_H         = 15;
const CB_SIZE       = 11;
const ROW_STEP      = 33;   // label + field + gap
const HALF_W        = 245;
const HALF_GAP      = 12;

// ── Build ──────────────────────────────────────────────────────────────────
const doc  = await PDFDocument.create();
const page = doc.addPage([W, H]);
const form = doc.getForm();

const regular = await doc.embedFont(StandardFonts.Helvetica);
const bold    = await doc.embedFont(StandardFonts.HelveticaBold);
const italic  = await doc.embedFont(StandardFonts.HelveticaOblique);

// ── Helpers ────────────────────────────────────────────────────────────────

/** Draw section header, return Y position after the underline */
function drawSectionHeader(text, fromTop) {
  page.drawText(text, {
    x: ML, y: pdfY(fromTop), size: SECTION_SZ, font: bold, color: ACCENT,
  });
  const underY = fromTop + SECTION_SZ + 2;
  page.drawLine({
    start: { x: ML, y: pdfY(underY) },
    end:   { x: RIGHT, y: pdfY(underY) },
    thickness: 0.75, color: ACCENT,
  });
  return underY;
}

function drawLabel(text, x, fromTop) {
  page.drawText(text, {
    x, y: pdfY(fromTop), size: LABEL_SZ, font: regular, color: SUBTLE,
  });
}

function drawFieldUnderline(x, fromTop, width) {
  const bottomY = pdfY(fromTop + FIELD_H);
  page.drawLine({
    start: { x, y: bottomY }, end: { x: x + width, y: bottomY },
    thickness: 0.5, color: LINE_CLR,
  });
}

function addTextField(name, x, fromTop, width, height = FIELD_H) {
  const f = form.createTextField(name);
  f.addToPage(page, {
    x, y: pdfY(fromTop + height), width, height, borderWidth: 0,
  });
  f.setFontSize(height > 20 ? 12 : 10);
  return f;
}

function addCheckbox(name, x, fromTop) {
  const cb = form.createCheckBox(name);
  cb.addToPage(page, {
    x, y: pdfY(fromTop + CB_SIZE), width: CB_SIZE, height: CB_SIZE,
    borderWidth: 0.75, borderColor: LINE_CLR,
  });
  return cb;
}

function drawCheckboxLabel(text, x, fromTop) {
  // vertically center label with checkbox
  page.drawText(text, {
    x: x + CB_SIZE + 5,
    y: pdfY(fromTop + CB_SIZE - 1.5),
    size: BODY_SZ, font: regular, color: BODY,
  });
}

/** Wrap and draw static text. Returns Y position after last line. */
function drawWrappedText(text, x, fromTop, opts = {}) {
  const { size = BODY_SZ, font: f = regular, color = BODY, maxWidth = CW, leading = size + 2 } = opts;
  const words = text.split(' ');
  let line = '';
  let curY = fromTop;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (f.widthOfTextAtSize(test, size) > maxWidth && line) {
      page.drawText(line, { x, y: pdfY(curY), size, font: f, color });
      curY += leading;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) {
    page.drawText(line, { x, y: pdfY(curY), size, font: f, color });
    curY += leading;
  }
  return curY;
}

// ── Layout ─────────────────────────────────────────────────────────────────
// All section header calls return underline Y. We add a small gap (G) after.
const G = 10;       // gap after header underline before first content (must exceed label ascent ~7pt)
const LBL_GAP = 9;  // gap from label baseline to field top
const ROW_GAP = 25;  // gap between field rows
const CB_GAP  = 14;  // gap between checkbox rows

let y; // tracks current "from-top" position

// ── Title Block ────────────────────────────────────────────────────────────
const titleText = 'Request for Access to Protected Health Information';
const titleW = bold.widthOfTextAtSize(titleText, TITLE_SZ);
page.drawText(titleText, {
  x: (W - titleW) / 2, y: pdfY(MT), size: TITLE_SZ, font: bold, color: ACCENT,
});

const subtitleText = 'Pursuant to 45 CFR \u00A7 164.524 \u00B7 Also satisfies 45 CFR \u00A7 164.508';
const subtitleW = italic.widthOfTextAtSize(subtitleText, SUBTITLE_SZ);
page.drawText(subtitleText, {
  x: (W - subtitleW) / 2, y: pdfY(MT + TITLE_SZ + 4), size: SUBTITLE_SZ, font: italic, color: SUBTLE,
});

// ── Section 1: Patient Information ─────────────────────────────────────────
y = drawSectionHeader('Section 1: Patient Information', 76) + G;
drawLabel('Patient Name', ML, y);
y += LBL_GAP;
addTextField('patientName', ML, y, CW);
drawFieldUnderline(ML, y, CW);

y += ROW_GAP;
drawLabel('Date of Birth', ML, y);
drawLabel('Phone', ML + HALF_W + HALF_GAP, y);
y += LBL_GAP;
addTextField('dob', ML, y, HALF_W);
drawFieldUnderline(ML, y, HALF_W);
addTextField('phone', ML + HALF_W + HALF_GAP, y, HALF_W);
drawFieldUnderline(ML + HALF_W + HALF_GAP, y, HALF_W);

y += ROW_GAP;
drawLabel('Address (Street, City, State, ZIP)', ML, y);
y += LBL_GAP;
addTextField('patientAddress', ML, y, CW);
drawFieldUnderline(ML, y, CW);

y += ROW_GAP;
drawLabel('Email', ML, y);
y += LBL_GAP;
addTextField('email', ML, y, CW);
drawFieldUnderline(ML, y, CW);

// ── Section 2: Provider ────────────────────────────────────────────────────
y = drawSectionHeader('Section 2: I Request Records From', y + FIELD_H + 8) + G;
drawLabel('Provider / Facility', ML, y);
y += LBL_GAP;
addTextField('providerName', ML, y, CW);
drawFieldUnderline(ML, y, CW);

y += ROW_GAP;
drawLabel('Provider Address', ML, y);
y += LBL_GAP;
addTextField('providerAddress', ML, y, CW);
drawFieldUnderline(ML, y, CW);

// ── Section 3: Deliver To ──────────────────────────────────────────────────
y = drawSectionHeader('Section 3: Deliver Records To', y + FIELD_H + 8) + G;
drawLabel('Recipient Name', ML, y);
y += LBL_GAP;
addTextField('recipientName', ML, y, CW);
drawFieldUnderline(ML, y, CW);

y += ROW_GAP;
drawLabel('Recipient Address', ML, y);
y += LBL_GAP;
addTextField('recipientAddress', ML, y, CW);
drawFieldUnderline(ML, y, CW);

y += ROW_GAP;
drawLabel('Recipient Email', ML, y);
y += LBL_GAP;
addTextField('recipientEmail', ML, y, CW);
drawFieldUnderline(ML, y, CW);

// Annotation
y += FIELD_H + 1;
page.drawText('If requesting records for yourself, enter your own name and address above.', {
  x: ML, y: pdfY(y), size: 7.5, font: italic, color: SUBTLE,
});

// ── Section 4: Information Requested ───────────────────────────────────────
y = drawSectionHeader('Section 4: Information Requested', y + 14) + G;
addCheckbox('ehiExport', ML + 2, y);
drawCheckboxLabel('Complete Electronic Health Information (EHI) Export', ML + 2, y);

y += CB_GAP;
addCheckbox('includeDocuments', ML + 2, y);
drawCheckboxLabel('All associated documents and images', ML + 2, y);

y += CB_GAP + 8;
drawLabel('Additional Description / See Appendix A if attached', ML, y);
y += LBL_GAP;
addTextField('additionalDescription', ML, y, CW);
drawFieldUnderline(ML, y, CW);

// ── Section 5: Purpose ─────────────────────────────────────────────────────
y = drawSectionHeader('Section 5: Purpose', y + FIELD_H + 8) + G;
addCheckbox('purposePersonal', ML + 2, y);
drawCheckboxLabel('Personal use / At the request of the individual', ML + 2, y);

y += CB_GAP;
addCheckbox('purposeOther', ML + 2, y);
drawCheckboxLabel('Other:', ML + 2, y);
const otherLabelW = regular.widthOfTextAtSize('Other:', BODY_SZ);
const otherFieldX = ML + 2 + CB_SIZE + 5 + otherLabelW + 8;
const otherFieldW = RIGHT - otherFieldX;
addTextField('purposeOtherText', otherFieldX, y - 1, otherFieldW, 16);
drawFieldUnderline(otherFieldX, y - 1, otherFieldW);

// ── Section 6: Expiration & Patient Rights (combined to save space) ────────
y = drawSectionHeader('Section 6: Expiration & Patient Rights', y + CB_GAP + 12) + G;
y = drawWrappedText(
  'This request expires one year from the date of signature, or upon fulfillment, whichever is first.',
  ML, y, { size: 8, font: regular, color: BODY, leading: 9.5 }
);
y += 1;
y = drawWrappedText(
  'I may revoke this request at any time by written notice to the provider named in Section 2, except to the extent that action has already been taken in reliance on it.',
  ML, y, { size: 8, font: regular, color: BODY, leading: 9.5 }
);
y += 1;
y = drawWrappedText(
  'My treatment, payment, enrollment, or eligibility for benefits will not be conditioned on whether I sign this request.',
  ML, y, { size: 8, font: regular, color: BODY, leading: 9.5 }
);
y += 1;
y = drawWrappedText(
  'Information disclosed under this request may be subject to redisclosure by the recipient and may no longer be protected by federal privacy regulations.',
  ML, y, { size: 8, font: regular, color: BODY, leading: 9.5 }
);

// ── Section 7: Signature ───────────────────────────────────────────────────
y = drawSectionHeader('Section 7: Signature', y + 4) + G;

const sigW = 327;
const dateW = 141;
const dateX = RIGHT - dateW;

addTextField('signature', ML, y, sigW, SIG_H);
page.drawLine({
  start: { x: ML, y: pdfY(y + SIG_H) },
  end:   { x: ML + sigW, y: pdfY(y + SIG_H) },
  thickness: 0.5, color: LINE_CLR,
});

addTextField('signatureDate', dateX, y + (SIG_H - FIELD_H), dateW);
drawFieldUnderline(dateX, y + (SIG_H - FIELD_H), dateW);

// Labels below
page.drawText('Signature of Patient or Authorized Representative', {
  x: ML, y: pdfY(y + SIG_H + 9), size: ANNOT_SZ, font: regular, color: SUBTLE,
});
page.drawText('Date', {
  x: dateX, y: pdfY(y + SIG_H + 9), size: ANNOT_SZ, font: regular, color: SUBTLE,
});

// representativeAuth
y += SIG_H + 14;
drawLabel('If signed by representative: describe authority (e.g., parent, guardian, POA)', ML, y);
y += 8;
addTextField('representativeAuth', ML, y, CW, REP_H);
drawFieldUnderline(ML, y, CW);

// ── Footer ─────────────────────────────────────────────────────────────────
const footerText = 'This form satisfies the requirements of 45 CFR \u00A7 164.524 (Right of Access) and 45 CFR \u00A7 164.508 (Authorization).';
const footerW = italic.widthOfTextAtSize(footerText, FOOTER_SZ);
page.drawText(footerText, {
  x: (W - footerW) / 2, y: 14, size: FOOTER_SZ, font: italic, color: SUBTLE,
});

// ── Save ───────────────────────────────────────────────────────────────────
const bytes = await doc.save();
writeFileSync(OUTPUT, bytes);

console.log(`Wrote ${OUTPUT} (${bytes.length} bytes, ${form.getFields().length} fields)`);
