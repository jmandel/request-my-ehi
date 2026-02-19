import { join } from "path";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "fs";

const STUDY_DIR = join(import.meta.dir, "..");
const DATA_DIR = join(STUDY_DIR, "data");

export function dataDir(...segments: string[]): string {
  const dir = join(DATA_DIR, ...segments);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function dataPath(...segments: string[]): string {
  return join(DATA_DIR, ...segments);
}

export function studyDir(...segments: string[]): string {
  return join(STUDY_DIR, ...segments);
}

export function readJson<T>(path: string): T | null {
  const full = path.startsWith("/") ? path : join(DATA_DIR, path);
  if (!existsSync(full)) return null;
  return JSON.parse(readFileSync(full, "utf-8"));
}

export function writeJson(path: string, data: unknown): void {
  const full = path.startsWith("/") ? path : join(DATA_DIR, path);
  const dir = join(full, "..");
  mkdirSync(dir, { recursive: true });
  writeFileSync(full, JSON.stringify(data, null, 2) + "\n");
}

export function exists(path: string): boolean {
  const full = path.startsWith("/") ? path : join(DATA_DIR, path);
  return existsSync(full);
}

export function listDirs(path: string): string[] {
  const full = path.startsWith("/") ? path : join(DATA_DIR, path);
  if (!existsSync(full)) return [];
  return readdirSync(full, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

export function listFiles(path: string, ext?: string): string[] {
  const full = path.startsWith("/") ? path : join(DATA_DIR, path);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((f) => !ext || f.endsWith(ext))
    .map((f) => f.replace(ext ?? "", ""));
}
