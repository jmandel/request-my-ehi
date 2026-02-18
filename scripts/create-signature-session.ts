#!/usr/bin/env bun
/**
 * Create an E2EE signature session on the relay server.
 *
 * Usage:
 *   bun create-signature-session.ts [server-url] [options]
 *
 * Options:
 *   --instructions <text|@file>   Instructions shown to signer (optional, has default)
 *   --signer-name <name>          Pre-fill signer name (optional)
 *   --expiry-minutes <n>          Session expiry (default: 60)
 *
 * Output (JSON to stdout):
 *   { sessionId, signUrl, privateKeyJwk }
 */
import { readFileSync } from 'fs';
import { resolveServerUrl } from './_resolve-server.ts';

const DEFAULT_INSTRUCTIONS = 'Please draw your signature below. It will be placed on your health records request form.';

const args = Bun.argv.slice(2);
const serverUrl = resolveServerUrl(args[0]);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

let instructions = getArg('--instructions') || DEFAULT_INSTRUCTIONS;
if (instructions.startsWith('@')) {
  instructions = readFileSync(instructions.slice(1), 'utf-8');
}

const signerName = getArg('--signer-name');
const expiryMinutes = parseInt(getArg('--expiry-minutes') || '60', 10);

// Generate ECDH P-256 keypair
const keyPair = await crypto.subtle.generateKey(
  { name: 'ECDH', namedCurve: 'P-256' },
  true,
  ['deriveBits']
);

const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

// Create session on server
const res = await fetch(`${serverUrl}/api/signatures/sessions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    publicKey: publicKeyJwk,
    instructions,
    signerName,
    expiryMinutes,
  }),
});

if (!res.ok) {
  const err = await res.text();
  console.error(`Server error (${res.status}): ${err}`);
  process.exit(1);
}

const data = await res.json();

console.log(JSON.stringify({
  sessionId: data.sessionId,
  signUrl: data.signUrl,
  privateKeyJwk,
}, null, 2));
