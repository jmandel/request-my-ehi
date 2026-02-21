#!/usr/bin/env bun
/**
 * Test suite for request-my-ehi scripts
 * Run with: bun tests/test-scripts.ts
 */

import { execSync } from 'child_process';
import { existsSync, unlinkSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

const ROOT = join(dirname(import.meta.path), '..');
const SCRIPTS = join(ROOT, 'scripts');
const TEMPLATES = join(ROOT, 'templates');

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`\u2713 ${name}`);
    passed++;
  } catch (e: any) {
    console.log(`\u2717 ${name}`);
    console.log(`  Error: ${e.message}`);
    failed++;
  }
}

function run(cmd: string, opts: any = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', ...opts });
}

function cleanup(...files: string[]) {
  files.forEach(f => { try { unlinkSync(f); } catch {} });
}

console.log('\n=== request-my-ehi Test Suite ===\n');

// ─────────────────────────────────────────────────────────────────────────────
// lookup-vendor tests
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- lookup-vendor ---\n');

test('lookup-vendor: finds Epic', () => {
  const out = run('bun scripts/lookup-vendor.ts epic');
  if (!out.includes('Epic Systems Corporation')) throw new Error('Epic not found');
  if (!out.includes('Grade:')) throw new Error('Missing grade');
  if (!out.includes('EpicCare')) throw new Error('Missing product name');
});

test('lookup-vendor: finds athenahealth', () => {
  const out = run('bun scripts/lookup-vendor.ts athena');
  if (!out.includes('athenahealth')) throw new Error('athenahealth not found');
});

test('lookup-vendor: finds Cerner', () => {
  const out = run('bun scripts/lookup-vendor.ts cerner');
  if (!out.toLowerCase().includes('cerner') && !out.toLowerCase().includes('oracle')) {
    throw new Error('Cerner/Oracle not found');
  }
});

test('lookup-vendor: handles no results gracefully', () => {
  const out = run('bun scripts/lookup-vendor.ts xyznonexistent123');
  if (!out.includes('No vendors matched')) throw new Error('Missing no-match message');
});

test('lookup-vendor: shows usage without args', () => {
  try {
    run('bun scripts/lookup-vendor.ts', { stdio: 'pipe' });
    throw new Error('Should have exited');
  } catch (e: any) {
    if (!e.stderr?.includes('Usage:') && !e.message?.includes('Usage')) {
      // Check if it exited with error (expected)
      if (e.status !== 1) throw e;
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// list-form-fields tests
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- list-form-fields ---\n');

test('list-form-fields: enumerates access request form fields', () => {
  const out = run(`bun scripts/list-form-fields.ts ${TEMPLATES}/right-of-access-form.pdf`);
  if (!out.includes('patientName')) throw new Error('Missing patientName field');
  if (!out.includes('providerName')) throw new Error('Missing providerName field');
  if (!out.includes('PDFTextField')) throw new Error('Missing field types');
  if (!out.includes('PDFCheckBox')) throw new Error('Missing checkbox fields');
  if (!out.includes('Total:')) throw new Error('Missing total count');
});

test('list-form-fields: reports field positions', () => {
  const out = run(`bun scripts/list-form-fields.ts ${TEMPLATES}/right-of-access-form.pdf`);
  if (!out.includes('x=')) throw new Error('Missing x position');
  if (!out.includes('topY=')) throw new Error('Missing y position');
});

test('list-form-fields: shows usage without args', () => {
  try {
    run('bun scripts/list-form-fields.ts');
    throw new Error('Should have exited');
  } catch (e: any) {
    if (e.status !== 1) throw e;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// generate-appendix tests
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- generate-appendix ---\n');

test('generate-appendix: creates Epic default PDF', () => {
  const outPath = '/tmp/test-appendix-epic.pdf';
  cleanup(outPath);
  run(`bun scripts/generate-appendix.ts '{"outputPath": "${outPath}"}'`);
  if (!existsSync(outPath)) throw new Error('Output file not created');
  const size = readFileSync(outPath).length;
  if (size < 5000) throw new Error(`PDF too small: ${size} bytes`);
  cleanup(outPath);
});

test('generate-appendix: creates vendor-specific PDF', () => {
  const outPath = '/tmp/test-appendix-vendor.pdf';
  cleanup(outPath);
  const config = JSON.stringify({
    outputPath: outPath,
    vendor: {
      developer: 'Test Vendor Inc.',
      product_name: 'TestEHR Pro',
      export_formats: ['CSV', 'JSON'],
      ehi_documentation_url: 'https://example.com/ehi-docs',
      entity_count: 42,
      field_count: 500,
      summary: 'Test vendor summary',
      grade: 'B'
    }
  });
  run(`bun scripts/generate-appendix.ts '${config}'`);
  if (!existsSync(outPath)) throw new Error('Output file not created');
  cleanup(outPath);
});

test('generate-appendix: handles minimal vendor config', () => {
  const outPath = '/tmp/test-appendix-minimal.pdf';
  cleanup(outPath);
  const config = JSON.stringify({
    outputPath: outPath,
    vendor: { developer: 'Minimal Vendor' }
  });
  run(`bun scripts/generate-appendix.ts '${config}'`);
  if (!existsSync(outPath)) throw new Error('Output file not created');
  cleanup(outPath);
});

// ─────────────────────────────────────────────────────────────────────────────
// generate-cover-letter tests
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- generate-cover-letter ---\n');

test('generate-cover-letter: creates generic cover letter PDF', () => {
  const outPath = '/tmp/test-cover-letter-generic.pdf';
  cleanup(outPath);
  run(`bun scripts/generate-cover-letter.ts '{"outputPath": "${outPath}"}'`);
  if (!existsSync(outPath)) throw new Error('Output file not created');
  const size = readFileSync(outPath).length;
  if (size < 3000) throw new Error(`PDF too small: ${size} bytes`);
  cleanup(outPath);
});

test('generate-cover-letter: creates personalized cover letter with patient info', () => {
  const outPath = '/tmp/test-cover-letter-patient.pdf';
  cleanup(outPath);
  const config = JSON.stringify({ patientName: 'Test Patient', dob: '01/01/1990', outputPath: outPath });
  run(`bun scripts/generate-cover-letter.ts '${config}'`);
  if (!existsSync(outPath)) throw new Error('Output file not created');
  const size = readFileSync(outPath).length;
  if (size < 3000) throw new Error(`PDF too small: ${size} bytes`);
  cleanup(outPath);
});

// ─────────────────────────────────────────────────────────────────────────────
// fill-and-merge tests
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- fill-and-merge ---\n');

test('fill-and-merge: creates complete 3-page PDF with cover letter', () => {
  const appendixPath = '/tmp/test-fm-appendix.pdf';
  const coverLetterPath = '/tmp/test-fm-cover-letter.pdf';
  const outputPath = '/tmp/test-fm-complete.pdf';
  const configPath = '/tmp/test-fm-config.json';
  cleanup(appendixPath, coverLetterPath, outputPath, configPath);

  // First generate an appendix (with date) and cover letter (with patient info)
  run(`bun scripts/generate-appendix.ts '{"date": "01/01/2026", "outputPath": "${appendixPath}"}'`);
  run(`bun scripts/generate-cover-letter.ts '{"patientName": "Test Patient", "dob": "01/01/1990", "outputPath": "${coverLetterPath}"}'`);

  // Create config
  const config = {
    formPath: `${TEMPLATES}/right-of-access-form.pdf`,
    appendixPath,
    coverLetterPath,
    outputPath,
    patient: {
      name: 'Test Patient',
      dob: '01/01/1990',
      street: '100 Test Ave',
      cityStateZip: 'Test City, TS 12345',
      phone: '555-555-5555',
      email: 'test@example.com'
    },
    provider: {
      name: 'Test Medical Center',
      street: '200 Provider Blvd',
      cityStateZip: 'Provider City, PC 54321'
    },
    fieldMappings: {
      patientName: 'patientName',
      dob: 'dob',
      patientStreet: 'patientAddress',
      phone: 'phone',
      email: 'email',
      providerName: 'providerName',
      providerStreet: 'providerAddress',
      recipientName: 'recipientName',
      recipientStreet: 'recipientAddress',
      recipientEmail: 'recipientEmail',
      date: 'signatureDate',
      ehiExport: 'ehiExport',
      includeImages: 'includeDocuments'
    }
  };

  writeFileSync(configPath, JSON.stringify(config));
  run(`bun scripts/fill-and-merge.ts ${configPath}`);

  if (!existsSync(outputPath)) throw new Error('Output file not created');
  const size = readFileSync(outputPath).length;
  if (size < 20000) throw new Error(`PDF too small for 3 pages: ${size} bytes`);

  cleanup(appendixPath, coverLetterPath, outputPath, configPath);
});

test('fill-and-merge: works without cover letter (2-page fallback)', () => {
  const appendixPath = '/tmp/test-fm2-appendix.pdf';
  const outputPath = '/tmp/test-fm2-complete.pdf';
  const configPath = '/tmp/test-fm2-config.json';
  cleanup(appendixPath, outputPath, configPath);

  run(`bun scripts/generate-appendix.ts '{"outputPath": "${appendixPath}"}'`);

  const config = {
    formPath: `${TEMPLATES}/right-of-access-form.pdf`,
    appendixPath,
    outputPath,
    patient: {
      name: 'Test Patient',
      dob: '01/01/1990',
      street: '100 Test Ave',
      cityStateZip: 'Test City, TS 12345',
      phone: '555-555-5555',
      email: 'test@example.com'
    },
    provider: {
      name: 'Test Medical Center',
      street: '200 Provider Blvd',
      cityStateZip: 'Provider City, PC 54321'
    },
    fieldMappings: {
      patientName: 'patientName',
      dob: 'dob',
      patientStreet: 'patientAddress',
      phone: 'phone',
      email: 'email',
      providerName: 'providerName',
      providerStreet: 'providerAddress',
      recipientName: 'recipientName',
      recipientStreet: 'recipientAddress',
      recipientEmail: 'recipientEmail',
      date: 'signatureDate'
    }
  };

  writeFileSync(configPath, JSON.stringify(config));
  run(`bun scripts/fill-and-merge.ts ${configPath}`);

  if (!existsSync(outputPath)) throw new Error('Output file not created');
  const size = readFileSync(outputPath).length;
  if (size < 15000) throw new Error(`PDF too small for 2 pages: ${size} bytes`);

  cleanup(appendixPath, outputPath, configPath);
});

test('fill-and-merge: shows usage without args', () => {
  try {
    run('bun scripts/fill-and-merge.ts');
    throw new Error('Should have exited');
  } catch (e: any) {
    if (e.status !== 1) throw e;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration tests
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Integration Tests ---\n');

test('end-to-end: lookup vendor -> generate cover letter + appendix -> fill form', () => {
  const appendixPath = '/tmp/test-e2e-appendix.pdf';
  const coverLetterPath = '/tmp/test-e2e-cover-letter.pdf';
  const outputPath = '/tmp/test-e2e-complete.pdf';
  const configPath = '/tmp/test-e2e-config.json';
  cleanup(appendixPath, coverLetterPath, outputPath, configPath);

  // Step 1: Look up a vendor
  const vendorOut = run('bun scripts/lookup-vendor.ts nextgen');
  if (!vendorOut.toLowerCase().includes('nextgen')) throw new Error('Vendor lookup failed');

  // Step 2: Generate cover letter (with patient info) and vendor-specific appendix (with date)
  run(`bun scripts/generate-cover-letter.ts '{"patientName": "Integration Test Patient", "dob": "06/15/1980", "outputPath": "${coverLetterPath}"}'`);
  const appendixConfig = JSON.stringify({
    outputPath: appendixPath,
    date: '02/18/2026',
    vendor: {
      developer: 'NextGen Healthcare',
      product_name: 'NextGen Enterprise EHR',
      export_formats: ['CSV'],
      entity_count: 85,
      field_count: 1200
    }
  });
  run(`bun scripts/generate-appendix.ts '${appendixConfig}'`);
  if (!existsSync(appendixPath)) throw new Error('Appendix not created');
  if (!existsSync(coverLetterPath)) throw new Error('Cover letter not created');

  // Step 3: Fill form and merge (3 pages)
  const formConfig = {
    formPath: `${TEMPLATES}/right-of-access-form.pdf`,
    appendixPath,
    coverLetterPath,
    outputPath,
    patient: {
      name: 'Integration Test Patient',
      dob: '06/15/1980',
      street: '500 E2E Street',
      cityStateZip: 'Integration City, IC 99999',
      phone: '555-123-4567',
      email: 'e2e@test.com'
    },
    provider: {
      name: 'E2E Medical Group',
      street: '600 Provider Lane',
      cityStateZip: 'Provider Town, PT 88888'
    },
    fieldMappings: {
      patientName: 'patientName',
      dob: 'dob',
      patientStreet: 'patientAddress',
      phone: 'phone',
      email: 'email',
      providerName: 'providerName',
      providerStreet: 'providerAddress',
      recipientName: 'recipientName',
      recipientStreet: 'recipientAddress',
      recipientEmail: 'recipientEmail',
      date: 'signatureDate',
      ehiExport: 'ehiExport',
      includeImages: 'includeDocuments'
    }
  };
  writeFileSync(configPath, JSON.stringify(formConfig));
  run(`bun scripts/fill-and-merge.ts ${configPath}`);

  if (!existsSync(outputPath)) throw new Error('Final PDF not created');
  cleanup(appendixPath, coverLetterPath, outputPath, configPath);
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
