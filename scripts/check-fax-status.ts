#!/usr/bin/env bun
/**
 * Check the status of a fax job.
 *
 * Usage:
 *   bun check-fax-status.ts [server-url] <fax-id>
 *
 * Server URL is read from scripts/config.json (relayUrl) if not provided.
 *
 * Output (JSON to stdout):
 *   { faxId, status, to, filename, pages, createdAt, completedAt, errorMessage, events }
 */
import { resolveServerUrl } from './_resolve-server.ts';

const args = Bun.argv.slice(2);
const hasExplicitUrl = args[0] && (args[0].startsWith('http') || args[0].includes('://'));
const serverUrl = resolveServerUrl(hasExplicitUrl ? args[0] : undefined);
const faxId = hasExplicitUrl ? args[1] : args[0];

if (!faxId) {
  console.error('Usage: bun check-fax-status.ts [server-url] <fax-id>');
  process.exit(1);
}

const res = await fetch(`${serverUrl}/api/fax/status/${faxId}`);

if (!res.ok) {
  const err = await res.text();
  console.error(`Server error (${res.status}): ${err}`);
  process.exit(1);
}

const data = await res.json();
console.log(JSON.stringify(data, null, 2));
