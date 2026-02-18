/**
 * Test suite for request-my-ehi scripts
 * Run with: node tests/test-scripts.mjs
 */

import { execSync, spawn } from 'child_process';
import { existsSync, unlinkSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SCRIPTS = join(ROOT, 'scripts');
const TEMPLATES = join(ROOT, 'templates');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${e.message}`);
    failed++;
  }
}

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', ...opts });
}

function cleanup(...files) {
  files.forEach(f => { try { unlinkSync(f); } catch {} });
}

console.log('\n=== request-my-ehi Test Suite ===\n');

// ─────────────────────────────────────────────────────────────────────────────
// lookup-vendor.mjs tests
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- lookup-vendor.mjs ---\n');

test('lookup-vendor: finds Epic', () => {
  const out = run('node scripts/lookup-vendor.mjs epic');
  if (!out.includes('Epic Systems Corporation')) throw new Error('Epic not found');
  if (!out.includes('Grade:')) throw new Error('Missing grade');
  if (!out.includes('EpicCare')) throw new Error('Missing product name');
});

test('lookup-vendor: finds athenahealth', () => {
  const out = run('node scripts/lookup-vendor.mjs athena');
  if (!out.includes('athenahealth')) throw new Error('athenahealth not found');
});

test('lookup-vendor: finds Cerner', () => {
  const out = run('node scripts/lookup-vendor.mjs cerner');
  if (!out.toLowerCase().includes('cerner') && !out.toLowerCase().includes('oracle')) {
    throw new Error('Cerner/Oracle not found');
  }
});

test('lookup-vendor: handles no results gracefully', () => {
  const out = run('node scripts/lookup-vendor.mjs xyznonexistent123');
  if (!out.includes('No vendors matched')) throw new Error('Missing no-match message');
});

test('lookup-vendor: shows usage without args', () => {
  try {
    run('node scripts/lookup-vendor.mjs', { stdio: 'pipe' });
    throw new Error('Should have exited');
  } catch (e) {
    if (!e.stderr?.includes('Usage:') && !e.message?.includes('Usage')) {
      // Check if it exited with error (expected)
      if (e.status !== 1) throw e;
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// list-form-fields.mjs tests  
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- list-form-fields.mjs ---\n');

test('list-form-fields: enumerates authorization form fields', () => {
  const out = run(`node scripts/list-form-fields.mjs ${TEMPLATES}/authorization-form.pdf`);
  if (!out.includes('patientName')) throw new Error('Missing patientName field');
  if (!out.includes('providerName')) throw new Error('Missing providerName field');
  if (!out.includes('PDFTextField')) throw new Error('Missing field types');
  if (!out.includes('PDFCheckBox')) throw new Error('Missing checkbox fields');
  if (!out.includes('Total:')) throw new Error('Missing total count');
});

test('list-form-fields: reports field positions', () => {
  const out = run(`node scripts/list-form-fields.mjs ${TEMPLATES}/authorization-form.pdf`);
  if (!out.includes('x=')) throw new Error('Missing x position');
  if (!out.includes('topY=')) throw new Error('Missing y position');
});

test('list-form-fields: shows usage without args', () => {
  try {
    run('node scripts/list-form-fields.mjs');
    throw new Error('Should have exited');
  } catch (e) {
    if (e.status !== 1) throw e;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// generate-appendix.mjs tests
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- generate-appendix.mjs ---\n');

test('generate-appendix: creates Epic default PDF', () => {
  const outPath = '/tmp/test-appendix-epic.pdf';
  cleanup(outPath);
  run(`node scripts/generate-appendix.mjs '{"outputPath": "${outPath}"}'`);
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
  run(`node scripts/generate-appendix.mjs '${config}'`);
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
  run(`node scripts/generate-appendix.mjs '${config}'`);
  if (!existsSync(outPath)) throw new Error('Output file not created');
  cleanup(outPath);
});

// ─────────────────────────────────────────────────────────────────────────────
// fill-and-merge.mjs tests
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- fill-and-merge.mjs ---\n');

test('fill-and-merge: creates complete 2-page PDF', () => {
  const appendixPath = '/tmp/test-fm-appendix.pdf';
  const outputPath = '/tmp/test-fm-complete.pdf';
  const configPath = '/tmp/test-fm-config.json';
  cleanup(appendixPath, outputPath, configPath);
  
  // First generate an appendix
  run(`node scripts/generate-appendix.mjs '{"outputPath": "${appendixPath}"}'`);
  
  // Create config
  const config = {
    formPath: `${TEMPLATES}/authorization-form.pdf`,
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
      date: 'signatureDate',
      ehiExport: 'ehiExport',
      purposePersonal: 'purposePersonal'
    }
  };
  
  writeFileSync(configPath, JSON.stringify(config));
  run(`node scripts/fill-and-merge.mjs ${configPath}`);
  
  if (!existsSync(outputPath)) throw new Error('Output file not created');
  const size = readFileSync(outputPath).length;
  if (size < 15000) throw new Error(`PDF too small for 2 pages: ${size} bytes`);
  
  cleanup(appendixPath, outputPath, configPath);
});

test('fill-and-merge: shows usage without args', () => {
  try {
    run('node scripts/fill-and-merge.mjs');
    throw new Error('Should have exited');
  } catch (e) {
    if (e.status !== 1) throw e;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration tests
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Integration Tests ---\n');

test('end-to-end: lookup vendor -> generate appendix -> fill form', () => {
  const appendixPath = '/tmp/test-e2e-appendix.pdf';
  const outputPath = '/tmp/test-e2e-complete.pdf';
  const configPath = '/tmp/test-e2e-config.json';
  cleanup(appendixPath, outputPath, configPath);
  
  // Step 1: Look up a vendor
  const vendorOut = run('node scripts/lookup-vendor.mjs nextgen');
  if (!vendorOut.toLowerCase().includes('nextgen')) throw new Error('Vendor lookup failed');
  
  // Step 2: Generate vendor-specific appendix (using NextGen-like config)
  const appendixConfig = JSON.stringify({
    outputPath: appendixPath,
    vendor: {
      developer: 'NextGen Healthcare',
      product_name: 'NextGen Enterprise EHR',
      export_formats: ['CSV'],
      entity_count: 85,
      field_count: 1200
    }
  });
  run(`node scripts/generate-appendix.mjs '${appendixConfig}'`);
  if (!existsSync(appendixPath)) throw new Error('Appendix not created');
  
  // Step 3: Fill form and merge
  const formConfig = {
    formPath: `${TEMPLATES}/authorization-form.pdf`,
    appendixPath,
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
      date: 'signatureDate'
    }
  };
  writeFileSync(configPath, JSON.stringify(formConfig));
  run(`node scripts/fill-and-merge.mjs ${configPath}`);
  
  if (!existsSync(outputPath)) throw new Error('Final PDF not created');
  cleanup(appendixPath, outputPath, configPath);
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
