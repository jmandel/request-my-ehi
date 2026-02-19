import type { RunOptions, OrgCategory, Organization } from "../lib/types";
import { callLLMJson } from "../lib/llm";
import { readJson, writeJson, dataPath, exists } from "../lib/store";
import { runParallel } from "../lib/parallel";
import { banner, info, success, fail, warn } from "../lib/log";

const CATEGORIES_PATH = "categories.json";
const ORGS_DIR = "organizations";

function orgPath(categoryId: string): string {
  return `${ORGS_DIR}/${categoryId}.json`;
}

function makePrompt(cat: OrgCategory): string {
  return `Find ${cat.target_count} real, currently operating U.S. healthcare organizations matching:
- Size: ${cat.size}
- Region: ${cat.region}
- Ownership: ${cat.ownership}

For each organization:
1. Confirm it currently operates and has a patient-facing website
2. Confirm it matches the size and ownership type
3. Find its main website URL

Use web search to find and verify candidates. Prioritize well-known organizations
that are likely to have a web presence with downloadable forms.

Output a JSON array where each element has these exact fields:
  org_id (kebab-case, e.g. "mayo-clinic")
  name (official name)
  category_id ("${cat.category_id}")
  size ("${cat.size}")
  region ("${cat.region}")
  state (2-letter abbreviation)
  city (city name)
  ownership ("${cat.ownership}")
  website (main URL, e.g. "https://www.mayoclinic.org")
  bed_count (integer or null if unknown/not applicable)
  notes (brief notes, optional)

Output ONLY the JSON array.`;
}

export async function run(opts: RunOptions) {
  const categories = readJson<OrgCategory[]>(CATEGORIES_PATH);
  if (!categories) {
    fail("Stage 2", "No categories.json found. Run stage1 first.");
    process.exit(1);
  }

  // Filter and limit
  let work = categories.filter((c) => {
    if (opts.filter && !c.category_id.includes(opts.filter)) return false;
    if (!opts.force && exists(orgPath(c.category_id))) return false;
    return true;
  });
  if (opts.limit) work = work.slice(0, opts.limit);

  const skipped = categories.length - work.length;
  banner("Stage 2: Discover Organizations", {
    Categories: `${work.length} to process (${skipped} skipped)`,
    Parallel: opts.parallel,
    Model: opts.model,
    Output: dataPath(ORGS_DIR),
  });

  if (work.length === 0) {
    info("Stage 2", "Nothing to do.");
    return;
  }

  for (const c of work) {
    console.log(`  • ${c.category_id} (target: ${c.target_count})`);
  }
  console.log();

  if (opts.dryRun) {
    info("Stage 2", "Dry run — would process above categories");
    return;
  }

  const results = await runParallel({
    items: work,
    concurrency: opts.parallel,
    onStart: (cat, i) =>
      info("Stage 2", `START  ${cat.category_id} (${cat.target_count} orgs)`),
    onDone: (cat, orgs, i) =>
      success("Stage 2", `DONE   ${cat.category_id} — found ${orgs.length} orgs`),
    onError: (cat, err, i) =>
      fail("Stage 2", `FAIL   ${cat.category_id} — ${err.message.slice(0, 100)}`),
    fn: async (cat) => {
      const orgs = await callLLMJson<Organization[]>({
        prompt: makePrompt(cat),
        model: opts.model,
        tools: ["WebSearch", "WebFetch"],
      });
      writeJson(orgPath(cat.category_id), orgs);
      return orgs;
    },
  });

  // Summary
  const succeeded = results.filter((r) => r.result).length;
  const totalOrgs = results
    .filter((r) => r.result)
    .reduce((s, r) => s + r.result!.length, 0);
  console.log(
    `\nStage 2 complete: ${succeeded}/${work.length} categories, ${totalOrgs} organizations found`
  );
}
