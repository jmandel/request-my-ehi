import { readFileSync } from 'fs';

interface ConfigFile {
  port?: number;
  baseUrl?: string;
  sessionTtlMs?: number;
}

let fileConfig: ConfigFile = {};

// Load config from JSON file if passed as argument
const configPath = process.argv[2];
if (configPath) {
  try {
    fileConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    console.log(`Loaded config from ${configPath}`);
  } catch (e) {
    console.error(`Failed to load config from ${configPath}:`, e);
    process.exit(1);
  }
}

export const config = {
  port: fileConfig.port ?? parseInt(process.env.PORT || "3000", 10),
  baseUrl: fileConfig.baseUrl ?? process.env.BASE_URL ?? `http://localhost:${fileConfig.port ?? process.env.PORT ?? "3000"}`,
  sessionTtlMs: fileConfig.sessionTtlMs ?? parseInt(process.env.SESSION_TTL_MS || "900000", 10), // 15 min default
};
