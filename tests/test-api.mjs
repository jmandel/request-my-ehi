/**
 * API test suite for the relay server (fax + signature endpoints)
 * Run with: bun tests/test-api.mjs
 * Requires the relay server running on localhost:8001
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:8001';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log(`\n=== EHI Relay API Test Suite ===`);
console.log(`Server: ${SERVER_URL}\n`);

// ───────────────────────────────────────────────────────────────────────────
// Health check
// ───────────────────────────────────────────────────────────────────────────
console.log('\n--- Health Check ---\n');

await test('health: returns ok', async () => {
  const res = await fetch(`${SERVER_URL}/health`);
  assert(res.ok, `Status ${res.status}`);
  const data = await res.json();
  assert(data.status === 'ok', 'Expected status: ok');
  assert(data.timestamp, 'Missing timestamp');
});

// ───────────────────────────────────────────────────────────────────────────
// Fax API
// ───────────────────────────────────────────────────────────────────────────
console.log('\n--- Fax API ---\n');

let faxId;

await test('fax/send: queues a fax job', async () => {
  const pdfBytes = readFileSync(join(ROOT, 'templates/appendix.pdf'));
  const res = await fetch(`${SERVER_URL}/api/fax/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: '+1-555-TEST-001',
      filename: 'test.pdf',
      fileBase64: pdfBytes.toString('base64'),
    }),
  });
  assert(res.status === 201, `Expected 201, got ${res.status}`);
  const data = await res.json();
  assert(data.faxId, 'Missing faxId');
  assert(data.status === 'queued', `Expected queued, got ${data.status}`);
  faxId = data.faxId;
});

await test('fax/status: retrieves job status', async () => {
  const res = await fetch(`${SERVER_URL}/api/fax/status/${faxId}`);
  assert(res.ok, `Status ${res.status}`);
  const data = await res.json();
  assert(data.faxId === faxId, 'faxId mismatch');
  assert(data.to === '+1-555-TEST-001', 'to mismatch');
  assert(data.events?.length > 0, 'Missing events');
});

await test('fax/jobs: lists all jobs', async () => {
  const res = await fetch(`${SERVER_URL}/api/fax/jobs`);
  assert(res.ok, `Status ${res.status}`);
  const data = await res.json();
  assert(Array.isArray(data), 'Expected array');
  const job = data.find(j => j.faxId === faxId);
  assert(job, 'Our job not found in list');
});

await test('fax/jobs/:id/simulate: transitions to sending', async () => {
  const res = await fetch(`${SERVER_URL}/api/fax/jobs/${faxId}/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'sending' }),
  });
  assert(res.ok, `Status ${res.status}`);
  const data = await res.json();
  assert(data.status === 'sending', `Expected sending, got ${data.status}`);
});

await test('fax/jobs/:id/simulate: transitions to delivered', async () => {
  const res = await fetch(`${SERVER_URL}/api/fax/jobs/${faxId}/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delivered' }),
  });
  assert(res.ok, `Status ${res.status}`);
  const data = await res.json();
  assert(data.status === 'delivered', `Expected delivered, got ${data.status}`);
});

await test('fax/jobs/:id/download: returns PDF', async () => {
  const res = await fetch(`${SERVER_URL}/api/fax/jobs/${faxId}/download`);
  assert(res.ok, `Status ${res.status}`);
  assert(res.headers.get('content-type') === 'application/pdf', 'Expected PDF content-type');
  const bytes = await res.arrayBuffer();
  assert(bytes.byteLength > 1000, 'PDF too small');
});

await test('fax/send: rejects missing fields', async () => {
  const res = await fetch(`${SERVER_URL}/api/fax/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: '+1-555-TEST' }),
  });
  assert(res.status === 400, `Expected 400, got ${res.status}`);
});

// ───────────────────────────────────────────────────────────────────────────
// Signature API
// ───────────────────────────────────────────────────────────────────────────
console.log('\n--- Signature API ---\n');

let sessionId;
let privateKey;

await test('signatures/sessions: creates a session', async () => {
  // Generate ECDH keypair
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  privateKey = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

  const authText = 'Test authorization text for signature';
  const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(authText));
  const authHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

  const res = await fetch(`${SERVER_URL}/api/signatures/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: publicKeyJwk,
      authorizationText: authText,
      authorizationTextHash: authHash,
      signerName: 'Test Signer',
    }),
  });
  assert(res.status === 201, `Expected 201, got ${res.status}`);
  const data = await res.json();
  assert(data.sessionId, 'Missing sessionId');
  assert(data.signUrl, 'Missing signUrl');
  sessionId = data.sessionId;
});

await test('signatures/sessions/:id/info: returns session info', async () => {
  const res = await fetch(`${SERVER_URL}/api/signatures/sessions/${sessionId}/info`);
  assert(res.ok, `Status ${res.status}`);
  const data = await res.json();
  assert(data.authorizationText === 'Test authorization text for signature', 'authText mismatch');
  assert(data.signerName === 'Test Signer', 'signerName mismatch');
  assert(data.publicKeyJwk, 'Missing publicKeyJwk');
});

await test('signatures/sessions/:id/poll: returns waiting', async () => {
  const res = await fetch(`${SERVER_URL}/api/signatures/sessions/${sessionId}/poll?timeout=1`);
  assert(res.ok, `Status ${res.status}`);
  const data = await res.json();
  assert(data.status === 'waiting', `Expected waiting, got ${data.status}`);
});

await test('signatures/sessions/:id/submit: accepts encrypted payload', async () => {
  // Generate ephemeral keypair for submission
  const ephKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const ephPubJwk = await crypto.subtle.exportKey('jwk', ephKeyPair.publicKey);

  // Fake ciphertext (in real use, this would be encrypted signature data)
  const iv = Array.from(crypto.getRandomValues(new Uint8Array(12)));
  const ciphertext = Array.from(crypto.getRandomValues(new Uint8Array(64)));

  const res = await fetch(`${SERVER_URL}/api/signatures/sessions/${sessionId}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ciphertext,
      iv,
      ephemeralPublicKey: ephPubJwk,
    }),
  });
  assert(res.ok, `Status ${res.status}`);
  const data = await res.json();
  assert(data.status === 'completed', `Expected completed, got ${data.status}`);
});

await test('signatures/sessions/:id/poll: returns completed with payload', async () => {
  const res = await fetch(`${SERVER_URL}/api/signatures/sessions/${sessionId}/poll`);
  assert(res.ok, `Status ${res.status}`);
  const data = await res.json();
  assert(data.status === 'completed', `Expected completed, got ${data.status}`);
  assert(data.encryptedPayload, 'Missing encryptedPayload');
  assert(data.auditLog?.length > 0, 'Missing auditLog');
});

await test('signatures/sessions/:id/submit: rejects duplicate submission', async () => {
  const res = await fetch(`${SERVER_URL}/api/signatures/sessions/${sessionId}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ciphertext: [], iv: [], ephemeralPublicKey: {} }),
  });
  assert(res.status === 409, `Expected 409, got ${res.status}`);
});

await test('signatures/sessions: rejects missing fields', async () => {
  const res = await fetch(`${SERVER_URL}/api/signatures/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey: {} }),
  });
  assert(res.status === 400, `Expected 400, got ${res.status}`);
});

// ───────────────────────────────────────────────────────────────────────────
// Sign page
// ───────────────────────────────────────────────────────────────────────────
console.log('\n--- Sign Page ---\n');

await test('/sign/:sessionId: serves HTML for valid session', async () => {
  // Create a fresh session
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('test'));
  const authHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

  const createRes = await fetch(`${SERVER_URL}/api/signatures/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey: publicKeyJwk, authorizationText: 'test', authorizationTextHash: authHash }),
  });
  const { sessionId: newId } = await createRes.json();

  const res = await fetch(`${SERVER_URL}/sign/${newId}`);
  assert(res.ok, `Status ${res.status}`);
  const html = await res.text();
  assert(html.includes('Authorization Signature'), 'Missing expected content');
});

await test('/sign/:sessionId: 404 for invalid session', async () => {
  const res = await fetch(`${SERVER_URL}/sign/nonexistent-session-id`);
  assert(res.status === 404, `Expected 404, got ${res.status}`);
});

// ───────────────────────────────────────────────────────────────────────────
// Summary
// ───────────────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
