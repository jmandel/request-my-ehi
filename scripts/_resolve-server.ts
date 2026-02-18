import { readFileSync } from 'fs';
import { dirname, join } from 'path';

const scriptDir = dirname(Bun.main);
let relayUrl: string | undefined;

try {
  const config = JSON.parse(readFileSync(join(scriptDir, 'config.json'), 'utf-8'));
  relayUrl = config.relayUrl;
} catch {}

export function resolveServerUrl(cliArg?: string): string {
  if (cliArg && !cliArg.startsWith('--')) return cliArg.replace(/\/$/, '');
  if (relayUrl) return relayUrl.replace(/\/$/, '');
  console.error('Error: No server URL. Pass as first argument or set relayUrl in scripts/config.json');
  process.exit(1);
}
