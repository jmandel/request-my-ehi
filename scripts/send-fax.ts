#!/usr/bin/env bun
/**
 * Send a PDF as a fax via the relay server.
 *
 * Usage:
 *   bun send-fax.ts [server-url] <fax-number> <pdf-path>
 *
 * Server URL is read from scripts/config.json (relayUrl) if not provided.
 *
 * Output (JSON to stdout):
 *   { faxId, provider, status }
 */
import { basename } from 'path';
import { resolveServerUrl } from './_resolve-server.ts';

const args = Bun.argv.slice(2);
const hasExplicitUrl = args[0] && (args[0].startsWith('http') || args[0].includes('://'));
const serverUrl = resolveServerUrl(hasExplicitUrl ? args[0] : undefined);
const faxNumber = hasExplicitUrl ? args[1] : args[0];
const pdfPath = hasExplicitUrl ? args[2] : args[1];

if (!faxNumber || !pdfPath) {
  console.error('Usage: bun send-fax.ts [server-url] <fax-number> <pdf-path>');
  process.exit(1);
}

const file = Bun.file(pdfPath);
const pdfBytes = await file.arrayBuffer();
const fileBase64 = Buffer.from(pdfBytes).toString('base64');
const filename = basename(pdfPath);

const res = await fetch(`${serverUrl}/api/fax/send`, {
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
