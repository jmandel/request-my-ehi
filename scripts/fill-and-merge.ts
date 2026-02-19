#!/usr/bin/env bun
/**
 * Example reference script for filling a PDF form and merging with an appendix.
 * This is a template -- the agent should adapt field names and mappings
 * based on the specific provider's form.
 *
 * Usage: bun fill-and-merge.ts <config.json>
 *
 * config.json should contain:
 * {
 *   "formPath": "/tmp/provider_form.pdf",
 *   "appendixPath": "/tmp/appendix.pdf",
 *   "coverLetterPath": "/tmp/cover-letter.pdf",  (optional)
 *   "outputPath": "./ehi-request-complete.pdf",
 *   "signaturePath": "/tmp/signature-transparent.png",  (optional)
 *   "patient": {
 *     "name": "...",
 *     "dob": "MM/DD/YYYY",
 *     "street": "...",
 *     "cityStateZip": "...",
 *     "phone": "...",
 *     "email": "..."
 *   },
 *   "provider": {
 *     "name": "...",
 *     "street": "...",
 *     "cityStateZip": "..."
 *   },
 *   "fieldMappings": {
 *     "patientName": "field-name-in-pdf",
 *     "dob": "field-name-in-pdf",
 *     ...
 *   },
 *   "signaturePosition": { "x": 60, "topY": 686, "height": 18 }
 * }
 */
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { existsSync } from 'fs';

interface Patient {
  name: string;
  dob: string;
  street: string;
  cityStateZip: string;
  phone?: string;
  email?: string;
}

interface Provider {
  name: string;
  street: string;
  cityStateZip: string;
}

interface FieldMappings {
  patientName?: string;
  dob?: string;
  patientStreet?: string;
  patientCityStateZip?: string;
  phone?: string;
  providerName?: string;
  providerStreet?: string;
  providerCityStateZip?: string;
  recipientName?: string;
  recipientStreet?: string;
  recipientCityStateZip?: string;
  email?: string;
  date?: string;
  includeImages?: string;
  ehiExport?: string;
}

interface SignaturePosition {
  page?: number;  // 0-indexed, defaults to 0 (first page)
  x?: number;
  topY?: number;
  height?: number;
}

interface PhiDescriptionPosition {
  x: number;
  topY: number;
}

interface Config {
  formPath: string;
  appendixPath: string;
  coverLetterPath?: string;
  outputPath: string;
  signaturePath?: string;
  patient: Patient;
  provider: Provider;
  fieldMappings: FieldMappings;
  signaturePosition?: SignaturePosition;
  phiDescriptionPosition?: PhiDescriptionPosition;
}

const configPath = Bun.argv[2];
if (!configPath) {
  console.error('Usage: bun fill-and-merge.ts <config.json>');
  process.exit(1);
}

const configFile = Bun.file(configPath);
const config: Config = await configFile.json();
const { formPath, appendixPath, coverLetterPath, outputPath, signaturePath, patient, provider, fieldMappings, signaturePosition } = config;

// Load the provider's form
const formBytes = await Bun.file(formPath).arrayBuffer();
const doc = await PDFDocument.load(formBytes);
const form = doc.getForm();
const pages = doc.getPages();
const page = pages[0];  // First page for form fields
const { height } = page.getSize();

// Helper to safely set a text field
function setText(fieldName: string | undefined, value: string | undefined) {
  if (!fieldName || value === undefined) return;
  try {
    form.getTextField(fieldName).setText(value);
  } catch (e: any) {
    console.warn(`Could not set field "${fieldName}": ${e.message}`);
  }
}

// Helper to safely check a checkbox
function checkBox(fieldName: string | undefined) {
  if (!fieldName) return;
  try {
    form.getCheckBox(fieldName).check();
  } catch (e: any) {
    console.warn(`Could not check "${fieldName}": ${e.message}`);
  }
}

// Fill patient info
setText(fieldMappings.patientName, patient.name);
setText(fieldMappings.dob, patient.dob);
setText(fieldMappings.patientStreet, patient.street);
setText(fieldMappings.patientCityStateZip, patient.cityStateZip);
setText(fieldMappings.phone, patient.phone);

// Fill provider info (Section 2: I request records from)
setText(fieldMappings.providerName, provider.name);
setText(fieldMappings.providerStreet, provider.street);
setText(fieldMappings.providerCityStateZip, provider.cityStateZip);

// Fill recipient info (Section 3: Deliver to -- patient themselves)
setText(fieldMappings.recipientName, `${patient.name} (myself)`);
setText(fieldMappings.recipientStreet, patient.street);
setText(fieldMappings.recipientCityStateZip, patient.cityStateZip);
setText(fieldMappings.email, patient.email);

// Check information requested boxes
checkBox(fieldMappings.includeImages);
checkBox(fieldMappings.ehiExport);

// Fill date
const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
setText(fieldMappings.date, today);

// Draw "See Appendix A (attached)" if needed (no form field for PHI description)
const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
if (config.phiDescriptionPosition) {
  const pos = config.phiDescriptionPosition;
  page.drawText('See Appendix A (attached)', {
    x: pos.x,
    y: height - pos.topY,
    size: 10,
    font: fontBold,
    color: rgb(0.05, 0.05, 0.15),
  });
}

// Embed signature if provided
if (signaturePath && existsSync(signaturePath) && signaturePosition) {
  const sigBytes = await Bun.file(signaturePath).arrayBuffer();
  const sigImage = await doc.embedPng(sigBytes);
  const sigDims = sigImage.scale(1);
  const sigH = signaturePosition.height || 18;
  const sigW = sigH * (sigDims.width / sigDims.height);
  
  // Get the correct page for signature (default to first page)
  const sigPageIndex = signaturePosition.page ?? 0;
  const sigPage = pages[sigPageIndex] || pages[0];
  const { height: sigPageHeight } = sigPage.getSize();
  
  sigPage.drawImage(sigImage, {
    x: signaturePosition.x || 60,
    y: sigPageHeight - (signaturePosition.topY || 686),
    width: sigW,
    height: sigH,
  });
  console.log(`Signature placed on page ${sigPageIndex + 1} at (${signaturePosition.x || 60}, ${signaturePosition.topY || 686})`);
}

// Update checkbox appearances before flattening — pdf-lib's flatten() can't
// extract appearance refs from pdflatex-generated checkboxes, so we force
// pdf-lib to regenerate them in its own format first.
for (const field of form.getFields()) {
  try {
    const cb = form.getCheckBox(field.getName());
    cb.updateAppearances();
  } catch {
    // Not a checkbox — skip
  }
}

// Flatten form
form.flatten();
const filledBytes = await doc.save();
await Bun.write('/tmp/provider_form_filled.pdf', filledBytes);

// Merge: cover letter (if provided) + page 1 of form + appendix
const filledDoc = await PDFDocument.load(filledBytes);
const appendixBytes = await Bun.file(appendixPath).arrayBuffer();
const appendixDoc = await PDFDocument.load(appendixBytes);
const merged = await PDFDocument.create();

// Add cover letter as page 1 if provided
if (coverLetterPath && existsSync(coverLetterPath)) {
  const coverBytes = await Bun.file(coverLetterPath).arrayBuffer();
  const coverDoc = await PDFDocument.load(coverBytes);
  const coverPages = await merged.copyPages(coverDoc, coverDoc.getPageIndices());
  for (const p of coverPages) merged.addPage(p);
}

const [formPage1] = await merged.copyPages(filledDoc, [0]);
merged.addPage(formPage1);

const appPages = await merged.copyPages(appendixDoc, appendixDoc.getPageIndices());
for (const p of appPages) merged.addPage(p);

const finalBytes = await merged.save();
await Bun.write(outputPath, finalBytes);
console.log(`Complete! ${merged.getPageCount()}-page PDF saved to ${outputPath}`);
