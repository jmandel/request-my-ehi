import type { RunOptions, OrgCategory } from "../lib/types";
import { callLLMJson } from "../lib/llm";
import { writeJson, readJson, dataPath } from "../lib/store";
import { banner, info, success } from "../lib/log";

const OUTPUT_PATH = "categories.json";

const PROMPT = `You are designing a sampling frame for a study of healthcare provider
Release of Information (ROI) forms. Your goal is to define organization categories
that give broad, representative coverage of the U.S. healthcare landscape.

Define categories by crossing these axes where realistic combinations exist:

Organization sizes:
- Large health system (10+ hospitals)
- Regional system (2-9 hospitals)
- Community hospital (single facility)
- Physician group (multi-specialty)
- Small practice (1-5 providers)
- FQHC (Federally Qualified Health Center)
- Critical access hospital

Regions:
- Northeast, Southeast, Midwest, Southwest, West
- Mix of Rural, Urban, Suburban within each

Ownership types:
- Non-profit
- For-profit
- Government/public
- Academic medical center
- VA/military

Guidelines:
- Skip combinations that rarely exist (e.g., for-profit academic medical centers)
- Target 5-10 organizations per major size category
- Ensure geographic spread
- Aim for ~200-300 total organizations across all categories
- Over-sample categories where you expect more variance in form quality

For each category, output a JSON object with these exact fields:
  category_id (kebab-case, e.g. "large-nonprofit-midwest")
  size (from the list above)
  region (from the list above)
  ownership (from the list above)
  target_count (integer, how many orgs to find)
  description (human-readable, one sentence)

Output a single JSON array of category objects. No other text.`;

export async function run(opts: RunOptions) {
  const existing = readJson<OrgCategory[]>(OUTPUT_PATH);
  if (existing && !opts.force) {
    info("Stage 1", `Already have ${existing.length} categories. Use --force to regenerate.`);
    return;
  }

  banner("Stage 1: Sampling Frame", {
    Model: opts.model,
    Output: dataPath(OUTPUT_PATH),
  });

  if (opts.dryRun) {
    info("Stage 1", "Dry run — would generate sampling frame");
    return;
  }

  info("Stage 1", "Generating organization categories...");

  const categories = await callLLMJson<OrgCategory[]>({
    prompt: PROMPT,
    model: opts.model,
  });

  const totalOrgs = categories.reduce((s, c) => s + c.target_count, 0);
  writeJson(OUTPUT_PATH, categories);

  success(
    "Stage 1",
    `Generated ${categories.length} categories targeting ${totalOrgs} organizations`
  );

  // Print summary by size
  const bySize: Record<string, { count: number; target: number }> = {};
  for (const c of categories) {
    const s = bySize[c.size] ?? { count: 0, target: 0 };
    s.count++;
    s.target += c.target_count;
    bySize[c.size] = s;
  }
  console.log("\nBreakdown by size:");
  for (const [size, { count, target }] of Object.entries(bySize)) {
    console.log(`  ${size.padEnd(40)} ${count} categories, ${target} orgs`);
  }
}
