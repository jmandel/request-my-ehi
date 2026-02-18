#!/usr/bin/env node
/**
 * Send a PDF as a fax via the relay server.
 *
 * Usage:
 *   node send-fax.mjs [server-url] <fax-number> <pdf-path>
 *
 * Server URL is read from scripts/config.json (relayUrl) if not provided.
 *
 * Output (JSON to stdout):
 *   { faxId, provider, status }
 */
import { readFileSync } from 'fs';
import { basename } from 'path';
import { resolveServerUrl } from './_resolve-server.mjs';

const args = process.argv.slice(2);
// If first arg looks like a URL, use it; otherwise treat as fax number (server from config)
const hasExplicitUrl = args[0] && (args[0].startsWith('http') || args[0].includes('://'));
const serverUrl = resolveServerUrl(hasExplicitUrl ? args[0] : undefined);
const faxNumber = hasExplicitUrl ? args[1] : args[0];
const pdfPath = hasExplicitUrl ? args[2] : args[1];

if (!faxNumber || !pdfPath) {
  console.error('Usage: node send-fax.mjs [server-url] <fax-number> <pdf-path>');
  process.exit(1);
}

const pdfBytes = readFileSync(pdfPath);
const fileBase64 = pdfBytes.toString('base64');
const filename = basename(pdfPath);

const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/fax/send`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ to: faxNumber, filename, fileBase64 }),
});

if (!res.ok) {
  const err = await res.text();
  console.error(`Server error (${res.status}): ${err}`);
  process.exit(1);
}

const data = await res.json();
console.log(JSON.stringify(data, null, 2));
