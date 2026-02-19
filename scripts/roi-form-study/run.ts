#!/usr/bin/env bun
import { parseArgs } from "util";
import type { RunOptions } from "./lib/types";

const DEFAULT_MODEL = "claude-opus-4.6-fast";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    limit: { type: "string", short: "n" },
    filter: { type: "string", short: "f" },
    parallel: { type: "string", short: "j", default: "2" },
    "dry-run": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    model: { type: "string", short: "m", default: DEFAULT_MODEL },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help || positionals.length === 0) {
  printHelp();
  process.exit(0);
}

const opts: RunOptions = {
  limit: values.limit ? parseInt(values.limit) : undefined,
  filter: values.filter,
  parallel: parseInt(values.parallel!),
  dryRun: values["dry-run"]!,
  force: values.force!,
  model: values.model!,
};

const command = positionals[0];

switch (command) {
  case "stage1":
  case "sampling-frame":
    await (await import("./stages/stage1")).run(opts);
    break;
  case "stage2":
  case "discover-orgs":
    await (await import("./stages/stage2")).run(opts);
    break;
  case "stage3":
  case "retrieve-forms":
    await (await import("./stages/stage3")).run(opts);
    break;
  case "stage4":
  case "evaluate":
    await (await import("./stages/stage4")).run(opts);
    break;
  case "stage5":
  case "score":
    await (await import("./stages/stage5")).run(opts);
    break;
  case "status":
    await (await import("./stages/status")).run();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}

function printHelp() {
  console.log(`
ROI Form Quality Study Pipeline

Usage: bun run.ts <stage> [options]

Stages:
  stage1, sampling-frame    Generate organization categories
  stage2, discover-orgs     Find organizations per category (uses WebSearch)
  stage3, retrieve-forms    Download and analyze ROI forms (uses WebSearch + Bash)
  stage4, evaluate          Qualitative evaluation of each form
  stage5, score             Quantitative scoring from evaluations
  status                    Show pipeline progress

Options:
  -n, --limit <N>           Process at most N items
  -f, --filter <pattern>    Filter items by ID (substring match)
  -j, --parallel <N>        Max parallel LLM calls (default: 2)
  -m, --model <model>       LLM model (default: ${DEFAULT_MODEL})
      --dry-run             Show what would run without executing
      --force               Re-run even if output already exists
  -h, --help                Show this help

Examples:
  bun run.ts stage1
  bun run.ts stage2 --limit 3
  bun run.ts stage3 --filter mayo-clinic
  bun run.ts stage3 -j 4 --force
  bun run.ts status
`);
}
