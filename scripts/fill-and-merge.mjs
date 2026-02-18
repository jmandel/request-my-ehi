/**
 * Example reference script for filling a PDF form and merging with an appendix.
 * This is a template -- the agent should adapt field names and mappings
 * based on the specific provider's form.
 *
 * Usage: node fill-and-merge.mjs <config.json>
 *
 * config.json should contain:
 * {
 *   "formPath": "/tmp/provider_form.pdf",
 *   "appendixPath": "/tmp/appendix.pdf",
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
 *     "patientStreet": "field-name-in-pdf",
 *     "patientCityStateZip": "field-name-in-pdf",
 *     "providerName": "field-name-in-pdf",
 *     "providerStreet": "field-name-in-pdf",
 *     "providerCityStateZip": "field-name-in-pdf",
 *     "recipientName": "field-name-in-pdf",
 *     "recipientStreet": "field-name-in-pdf",
 *     "recipientCityStateZip": "field-name-in-pdf",
 *     "email": "field-name-in-pdf",
 *     "date": "field-name-in-pdf",
 *     "purposePersonal": "checkbox-field-name",
 *     "purposeOther": "checkbox-field-name",
 *     "otherText": "field-name-in-pdf",
 *     "includeImages": "checkbox-field-name"
 *   },
 *   "signaturePosition": { "x": 60, "topY": 686, "height": 18 }
 * }
 */
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const configPath = process.argv[2];
if (!configPath) {
  console.error('Usage: node fill-and-merge.mjs <config.json>');
  process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const { formPath, appendixPath, outputPath, signaturePath, patient, provider, fieldMappings, signaturePosition } = config;

// Load the provider's form
const doc = await PDFDocument.load(readFileSync(formPath));
const form = doc.getForm();
const page = doc.getPages()[0];
const { height } = page.getSize();

// Helper to safely set a text field
function setText(fieldName, value) {
  if (!fieldName) return;
  try {
    form.getTextField(fieldName).setText(value);
  } catch (e) {
    console.warn(`Could not set field "${fieldName}": ${e.message}`);
  }
}

// Helper to safely check a checkbox
function checkBox(fieldName) {
  if (!fieldName) return;
  try {
    form.getCheckBox(fieldName).check();
  } catch (e) {
    console.warn(`Could not check "${fieldName}": ${e.message}`);
  }
}

// Fill patient info
setText(fieldMappings.patientName, patient.name);
setText(fieldMappings.dob, patient.dob);
setText(fieldMappings.patientStreet, patient.street);
setText(fieldMappings.patientCityStateZip, patient.cityStateZip);

// Fill provider info (Section 2: I authorize)
setText(fieldMappings.providerName, provider.name);
setText(fieldMappings.providerStreet, provider.street);
setText(fieldMappings.providerCityStateZip, provider.cityStateZip);

// Fill recipient info (Section 3: Release to -- patient themselves)
setText(fieldMappings.recipientName, `${patient.name} (myself)`);
setText(fieldMappings.recipientStreet, patient.street);
setText(fieldMappings.recipientCityStateZip, patient.cityStateZip);
setText(fieldMappings.email, patient.email);

// Fill purpose
checkBox(fieldMappings.purposePersonal);
checkBox(fieldMappings.purposeOther);
setText(fieldMappings.otherText, 'See Appendix A');
checkBox(fieldMappings.includeImages);

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
  const sigBytes = readFileSync(signaturePath);
  const sigImage = await doc.embedPng(sigBytes);
  const sigDims = sigImage.scale(1);
  const sigH = signaturePosition.height || 18;
  const sigW = sigH * (sigDims.width / sigDims.height);
  page.drawImage(sigImage, {
    x: signaturePosition.x || 60,
    y: height - (signaturePosition.topY || 686),
    width: sigW,
    height: sigH,
  });
}

// Remove signature field if it exists (to avoid overlay)
try {
  const sigField = form.getFields().find(f => f.constructor.name === 'PDFSignature');
  if (sigField) form.removeField(sigField);
} catch (e) {}

// Flatten form
form.flatten();
const filledBytes = await doc.save();
writeFileSync('/tmp/provider_form_filled.pdf', filledBytes);

// Merge: page 1 of form + appendix
const filledDoc = await PDFDocument.load(filledBytes);
const appendixDoc = await PDFDocument.load(readFileSync(appendixPath));
const merged = await PDFDocument.create();

const [formPage1] = await merged.copyPages(filledDoc, [0]);
merged.addPage(formPage1);

const appPages = await merged.copyPages(appendixDoc, appendixDoc.getPageIndices());
for (const p of appPages) merged.addPage(p);

const finalBytes = await merged.save();
writeFileSync(outputPath, finalBytes);
console.log(`Complete! ${merged.getPageCount()}-page PDF saved to ${outputPath}`);
