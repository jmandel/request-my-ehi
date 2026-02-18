#!/usr/bin/env bun
/**
 * Enumerate all form fields in a PDF, with their types and positions.
 * Usage: bun list-form-fields.ts <path-to-pdf>
 */
import { PDFDocument } from 'pdf-lib';

const pdfPath = Bun.argv[2];
if (!pdfPath) {
  console.error('Usage: bun list-form-fields.ts <path-to-pdf>');
  process.exit(1);
}

const pdfBytes = await Bun.file(pdfPath).arrayBuffer();
const doc = await PDFDocument.load(pdfBytes);
const form = doc.getForm();
const fields = form.getFields();

for (const field of fields) {
  const type = field.constructor.name;
  const name = field.getName();
  let info = `${type}: "${name}"`;

  if (type === 'PDFTextField') {
    try { info += ` value="${(field as any).getText() || ''}"`; } catch {}
  } else if (type === 'PDFCheckBox') {
    try { info += ` checked=${(field as any).isChecked()}`; } catch {}
  } else if (type === 'PDFDropdown' || type === 'PDFOptionList') {
    try { info += ` options=${JSON.stringify((field as any).getOptions())}`; } catch {}
  }

  const widgets = (field as any).acroField.getWidgets();
  for (const w of widgets) {
    const rect = w.getRectangle();
    const page = doc.getPages()[0];
    const { height } = page.getSize();
    const topY = height - rect.y - rect.height;
    info += ` | x=${rect.x.toFixed(0)}, topY=${topY.toFixed(0)}, w=${rect.width.toFixed(0)}, h=${rect.height.toFixed(0)}`;
  }

  console.log(info);
}

console.log(`\nTotal: ${fields.length} fields`);
