import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
let relayUrl;
try {
  relayUrl = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8')).relayUrl;
} catch {}

export function resolveServerUrl(cliArg) {
  if (cliArg && !cliArg.startsWith('--')) return cliArg.replace(/\/$/, '');
  if (relayUrl) return relayUrl.replace(/\/$/, '');
  console.error('Error: No server URL. Pass as first argument or set relayUrl in scripts/config.json');
  process.exit(1);
}
