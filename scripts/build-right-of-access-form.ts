#!/usr/bin/env bun
/**
 * Build templates/right-of-access-form.pdf from LaTeX source.
 *
 * Usage: bun scripts/build-right-of-access-form.ts
 *
 * Runs pdflatex on templates/right-of-access-form.tex, validates that all 16
 * expected form fields exist with correct names and types, then copies the
 * result to templates/right-of-access-form.pdf.
 *
 * Requires (Arch Linux):
 *   sudo pacman -S texlive-basic texlive-bin texlive-latex \
 *     texlive-fontsrecommended texlive-latexrecommended texlive-latexextra
 *   sudo fmtutil-sys --byfmt pdflatex
 *
 * texlive-basic        — pdflatex binary, kpathsea
 * texlive-bin          — engine binaries
 * texlive-latex        — LaTeX format files (pdflatex.fmt), base classes
 * texlive-fontsrecommended — CM fonts with T1 encoding
 * texlive-latexrecommended — geometry, hyperref, parskip
 * texlive-latexextra   — xcolor
 */
import { PDFDocument } from 'pdf-lib';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, copyFileSync, unlinkSync } from 'fs';

const ROOT = join(dirname(import.meta.path), '..');
const TEX_SRC = join(ROOT, 'templates', 'right-of-access-form.tex');
const OUTPUT = join(ROOT, 'templates', 'right-of-access-form.pdf');
const BUILD_DIR = '/tmp/build-auth-form';

// ── Expected fields ─────────────────────────────────────────────────────────
const EXPECTED_TEXT_FIELDS = [
  'patientName', 'dob', 'phone', 'patientAddress', 'email',
  'providerName', 'providerAddress',
  'recipientName', 'recipientAddress', 'recipientEmail',
  'additionalDescription',
  'signature', 'signatureDate', 'representativeAuth',
] as const;

const EXPECTED_CHECKBOXES = [
  'ehiExport', 'includeDocuments',
] as const;

const ALL_FIELDS = [...EXPECTED_TEXT_FIELDS, ...EXPECTED_CHECKBOXES];

// ── Build ───────────────────────────────────────────────────────────────────
if (!existsSync(TEX_SRC)) {
  console.error(`LaTeX source not found: ${TEX_SRC}`);
  process.exit(1);
}

mkdirSync(BUILD_DIR, { recursive: true });

console.log('Running pdflatex...');
const proc = Bun.spawnSync([
  'pdflatex',
  '-interaction=nonstopmode',
  `-output-directory=${BUILD_DIR}`,
  TEX_SRC,
], { stdout: 'pipe', stderr: 'pipe' });

const builtPdf = join(BUILD_DIR, 'right-of-access-form.pdf');

if (!existsSync(builtPdf)) {
  console.error('pdflatex failed to produce output PDF.');
  console.error(proc.stdout.toString());
  console.error(proc.stderr.toString());
  process.exit(1);
}

// ── Validate fields ─────────────────────────────────────────────────────────
console.log('Validating form fields...');
const pdfBytes = await Bun.file(builtPdf).arrayBuffer();
const doc = await PDFDocument.load(pdfBytes);
const form = doc.getForm();
const fields = form.getFields();
const fieldNames = new Set(fields.map(f => f.getName()));

let errors = 0;

for (const name of ALL_FIELDS) {
  if (!fieldNames.has(name)) {
    console.error(`  MISSING field: ${name}`);
    errors++;
  }
}

// Check types
for (const name of EXPECTED_TEXT_FIELDS) {
  if (!fieldNames.has(name)) continue;
  try {
    form.getTextField(name);
  } catch {
    console.error(`  WRONG TYPE: ${name} should be TextField`);
    errors++;
  }
}

for (const name of EXPECTED_CHECKBOXES) {
  if (!fieldNames.has(name)) continue;
  try {
    form.getCheckBox(name);
  } catch {
    console.error(`  WRONG TYPE: ${name} should be CheckBox`);
    errors++;
  }
}

// Check for unexpected fields
for (const f of fields) {
  const n = f.getName();
  if (!ALL_FIELDS.includes(n as any)) {
    console.warn(`  UNEXPECTED field: ${n}`);
  }
}

if (errors > 0) {
  console.error(`\nValidation failed with ${errors} error(s).`);
  console.error(`Found ${fields.length} fields: ${fields.map(f => f.getName()).join(', ')}`);
  process.exit(1);
}

console.log(`  All ${ALL_FIELDS.length} fields validated.`);

// ── Copy to output ──────────────────────────────────────────────────────────
copyFileSync(builtPdf, OUTPUT);

// ── Clean up aux files ──────────────────────────────────────────────────────
for (const ext of ['.aux', '.log', '.out', '.pdf']) {
  const f = join(BUILD_DIR, `right-of-access-form${ext}`);
  try { unlinkSync(f); } catch {}
}

const stat = await Bun.file(OUTPUT).stat();
console.log(`\nWrote ${OUTPUT} (${stat?.size} bytes, ${fields.length} fields)`);
