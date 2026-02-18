#!/usr/bin/env bun
/**
 * Poll for a completed signature session, decrypt the payload, and write files.
 *
 * Usage:
 *   bun poll-signature.ts [server-url] <session-id> <private-key-jwk> [options]
 *
 * Options:
 *   --output-dir <dir>          Output directory (default: /tmp)
 *   --max-attempts <n>          Max poll attempts (default: 120)
 *   --poll-timeout <sec>        Long-poll timeout per attempt (default: 30)
 *
 * Output files:
 *   <dir>/signature.png              Drawn signature (transparent background)
 *   <dir>/signature-metadata.json    Audit trail and metadata
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { resolveServerUrl } from './_resolve-server.ts';

const args = Bun.argv.slice(2);
const hasExplicitUrl = args[0] && (args[0].startsWith('http') || args[0].includes('://'));
const serverUrl = resolveServerUrl(hasExplicitUrl ? args[0] : undefined);
const sessionId = hasExplicitUrl ? args[1] : args[0];
const privateKeyJwkStr = hasExplicitUrl ? args[2] : args[1];

if (!sessionId || !privateKeyJwkStr) {
  console.error('Usage: bun poll-signature.ts [server-url] <session-id> <private-key-jwk> [options]');
  process.exit(1);
}

function getArg(name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const outputDir = getArg('--output-dir') || '/tmp';
const maxAttempts = parseInt(getArg('--max-attempts') || '120', 10);
const pollTimeout = parseInt(getArg('--poll-timeout') || '30', 10);

mkdirSync(outputDir, { recursive: true });

const privateKeyJwk = JSON.parse(privateKeyJwkStr);
const privateKey = await crypto.subtle.importKey(
  'jwk', privateKeyJwk,
  { name: 'ECDH', namedCurve: 'P-256' },
  false,
  ['deriveBits']
);

const baseUrl = `${serverUrl}/api/signatures/sessions/${sessionId}`;
console.error(`Polling for signature (session ${sessionId})...`);

function base64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  const res = await fetch(`${baseUrl}/poll?timeout=${pollTimeout}`);
  if (!res.ok) {
    console.error(`Poll error (${res.status}): ${await res.text()}`);
    process.exit(1);
  }

  const data = await res.json() as any;

  if (data.status === 'waiting') {
    if (attempt % 5 === 0) {
      console.error(`  Still waiting... (attempt ${attempt}/${maxAttempts})`);
    }
    continue;
  }

  if (data.status === 'expired') {
    console.error('Session expired before signature was submitted.');
    process.exit(1);
  }

  if (data.status === 'completed') {
    console.error('Signature received! Decrypting...');
    const { ciphertext, iv, ephemeralPublicKey } = data.encryptedPayload;

    // Import browser's ephemeral public key
    const browserPubKey = await crypto.subtle.importKey(
      'jwk', ephemeralPublicKey,
      { name: 'ECDH', namedCurve: 'P-256' },
      false, []
    );

    // Derive shared secret
    const sharedBits = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: browserPubKey },
      privateKey,
      256
    );

    // Import as AES key
    const aesKey = await crypto.subtle.importKey(
      'raw', sharedBits, 'AES-GCM', false, ['decrypt']
    );

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBuf(iv) },
      aesKey,
      base64ToBuf(ciphertext)
    );

    const payload = JSON.parse(new TextDecoder().decode(decrypted)) as any;

    // Write signature PNG
    const sigDataUrl = payload.signatureImage;
    const base64Data = sigDataUrl.replace(/^data:image\/png;base64,/, '');
    const sigPath = join(outputDir, 'signature.png');
    writeFileSync(sigPath, Buffer.from(base64Data, 'base64'));
    console.error(`  Signature saved to ${sigPath}`);

    // Write metadata
    const metadata = {
      timestamp: payload.timestamp,
      auditLog: data.auditLog,
    };
    const metaPath = join(outputDir, 'signature-metadata.json');
    writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
    console.error(`  Metadata saved to ${metaPath}`);

    // Output summary to stdout
    console.log(JSON.stringify({
      signaturePath: sigPath,
      metadataPath: metaPath,
      timestamp: payload.timestamp,
    }, null, 2));

    process.exit(0);
  }

  console.error(`Unexpected status: ${data.status}`);
  process.exit(1);
}

console.error(`Timed out after ${maxAttempts} attempts.`);
process.exit(1);
