#!/usr/bin/env node
/**
 * Check the status of a fax job.
 *
 * Usage:
 *   node check-fax-status.mjs [server-url] <fax-id>
 *
 * Server URL is read from scripts/config.json (relayUrl) if not provided.
 *
 * Output (JSON to stdout):
 *   { faxId, status, to, filename, pages?, createdAt, completedAt?, errorMessage?, events }
 */

import { resolveServerUrl } from './_resolve-server.mjs';

const args = process.argv.slice(2);
const hasExplicitUrl = args[0] && (args[0].startsWith('http') || args[0].includes('://'));
const serverUrl = resolveServerUrl(hasExplicitUrl ? args[0] : undefined);
const faxId = hasExplicitUrl ? args[1] : args[0];

if (!faxId) {
  console.error('Usage: node check-fax-status.mjs [server-url] <fax-id>');
  process.exit(1);
}

const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/fax/status/${faxId}`);

if (!res.ok) {
  const err = await res.text();
  console.error(`Server error (${res.status}): ${err}`);
  process.exit(1);
}

const data = await res.json();
console.log(JSON.stringify(data, null, 2));
