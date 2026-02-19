import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { info, fail } from "./log";

const DEFAULT_MODEL = "claude-opus-4.6-fast";

export interface LLMOptions {
  prompt: string;
  systemPrompt?: string;
  tools?: string[];
  workDir?: string;
  model?: string;
  maxRetries?: number;
}

export async function callLLM(opts: LLMOptions): Promise<string> {
  const model = opts.model ?? DEFAULT_MODEL;
  const retries = opts.maxRetries ?? 2;
  const args = ["-p", opts.prompt, "--model", model, "--yolo"];

  if (opts.systemPrompt) {
    args.push("--system-prompt", opts.systemPrompt);
  }
  if (opts.tools?.length) {
    args.push("--available-tools", ...opts.tools);
  }

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const proc = Bun.spawn(["copilot", ...args], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: opts.workDir,
      });

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        throw new Error(
          `copilot exited ${exitCode}: ${stderr.slice(0, 500)}`
        );
      }
      return stdout;
    } catch (e) {
      if (attempt <= retries) {
        info("LLM", `Attempt ${attempt} failed, retrying...`);
      } else {
        throw e;
      }
    }
  }
  throw new Error("unreachable");
}

export function extractJson<T>(text: string): T {
  // Try JSON in fenced code blocks first
  const codeBlock = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (codeBlock) {
    return JSON.parse(codeBlock[1]);
  }
  // Try to find a top-level JSON array or object
  const start = text.search(/[\[{]/);
  if (start === -1) throw new Error("No JSON found in LLM output");
  // Find the matching closing bracket
  const open = text[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) depth--;
    if (depth === 0) {
      return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error("Unterminated JSON in LLM output");
}

/** Call LLM and extract typed JSON from the response */
export async function callLLMJson<T>(opts: LLMOptions): Promise<T> {
  const raw = await callLLM(opts);
  return extractJson<T>(raw);
}
