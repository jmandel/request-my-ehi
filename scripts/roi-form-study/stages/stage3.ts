import type { RunOptions, Organization, FormRetrieval } from "../lib/types";
import { callLLM, extractJson } from "../lib/llm";
import { readJson, writeJson, dataDir, dataPath, exists, listFiles } from "../lib/store";
import { extractPdfMetadata } from "../lib/pdf";
import { runParallel } from "../lib/parallel";
import { banner, info, success, fail } from "../lib/log";
import { readdirSync } from "fs";
import { join } from "path";

const ORGS_DIR = "organizations";
const FORMS_DIR = "forms";

function formDir(orgId: string): string {
  return `${FORMS_DIR}/${orgId}`;
}

function allOrganizations(): Organization[] {
  const dir = dataPath(ORGS_DIR);
  const files = listFiles(ORGS_DIR, ".json");
  const orgs: Organization[] = [];
  for (const f of files) {
    const data = readJson<Organization[]>(`${ORGS_DIR}/${f}.json`);
    if (data) orgs.push(...data);
  }
  return orgs;
}

function makePrompt(org: Organization, workDir: string): string {
  return `Find and download the Release of Information (ROI) / Authorization for
Medical Records form for this healthcare organization:

  Name: ${org.name}
  Website: ${org.website}
  Location: ${org.city}, ${org.state}
  Type: ${org.size}, ${org.ownership}

Search strategy (try all of these):
1. Web search variations:
   - "${org.name}" "authorization" "release" "health information" filetype:pdf
   - "${org.name}" "medical records" "release form" filetype:pdf
   - site:${new URL(org.website).hostname} authorization release medical records
   - "${org.name}" "request" "own records" OR "own medical records" filetype:pdf
2. Navigate ${org.website} looking for Patient Resources, Medical Records, or HIM pages
3. If part of a larger health system, check the parent system's website

For each form you find, download it:
  curl -sL -o "${workDir}/form-N.pdf" \\
    -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" \\
    "<URL>"

Then verify it's actually an ROI/authorization form (not a privacy notice, patient rights brochure, etc.):
  pdftotext "${workDir}/form-N.pdf" - | head -40

Number downloaded forms sequentially: form-1.pdf, form-2.pdf, etc.

After searching and downloading, output a JSON object with these exact fields:
{
  "org_id": "${org.org_id}",
  "search_queries": [{"query": "...", "results_found": N}, ...],
  "forms_found": [
    {
      "url": "https://...",
      "filename": "form-1.pdf",
      "download_success": true,
      "document_type": "roi_form | privacy_notice | patient_rights | other",
      "is_patient_access_specific": false,
      "notes": "..."
    }
  ],
  "no_form_found": false,
  "retrieval_difficulty": "easy | moderate | hard | impossible",
  "notes": "any relevant notes about the search process"
}

Output ONLY the JSON object.`;
}

export async function run(opts: RunOptions) {
  const orgs = allOrganizations();
  if (orgs.length === 0) {
    fail("Stage 3", "No organizations found. Run stage2 first.");
    process.exit(1);
  }

  // Filter and limit
  let work = orgs.filter((o) => {
    if (opts.filter && !o.org_id.includes(opts.filter)) return false;
    if (!opts.force && exists(`${formDir(o.org_id)}/retrieval.json`)) return false;
    return true;
  });
  if (opts.limit) work = work.slice(0, opts.limit);

  const skipped = orgs.length - work.length;
  banner("Stage 3: Retrieve Forms", {
    Organizations: `${work.length} to process (${skipped} skipped)`,
    Parallel: opts.parallel,
    Model: opts.model,
    Output: dataPath(FORMS_DIR),
  });

  if (work.length === 0) {
    info("Stage 3", "Nothing to do.");
    return;
  }

  for (const o of work) {
    console.log(`  • ${o.org_id} (${o.name})`);
  }
  console.log();

  if (opts.dryRun) {
    info("Stage 3", "Dry run — would process above organizations");
    return;
  }

  const results = await runParallel({
    items: work,
    concurrency: opts.parallel,
    onStart: (org) =>
      info("Stage 3", `START  ${org.org_id} — ${org.name} (${org.website})`),
    onDone: (org, result) => {
      const formCount = result.forms_found.filter((f) => f.download_success).length;
      success("Stage 3", `DONE   ${org.org_id} — ${formCount} form(s) retrieved`);
    },
    onError: (org, err) =>
      fail("Stage 3", `FAIL   ${org.org_id} — ${err.message.slice(0, 100)}`),
    fn: async (org) => {
      const dir = dataDir(formDir(org.org_id));

      // Call LLM to search and download
      const raw = await callLLM({
        prompt: makePrompt(org, dir),
        model: opts.model,
        tools: ["Bash", "WebSearch", "WebFetch"],
        workDir: dir,
      });

      // Parse retrieval info
      let retrieval: FormRetrieval;
      try {
        retrieval = extractJson<FormRetrieval>(raw);
      } catch {
        retrieval = {
          org_id: org.org_id,
          search_queries: [],
          forms_found: [],
          no_form_found: true,
          retrieval_difficulty: "impossible",
          notes: "Failed to parse LLM output",
        };
      }

      // Extract metadata for any downloaded PDFs
      const pdfs = readdirSync(dir).filter((f) => f.endsWith(".pdf"));
      for (const pdf of pdfs) {
        try {
          const metadata = await extractPdfMetadata(join(dir, pdf));
          writeJson(
            join(dir, pdf.replace(".pdf", "-metadata.json")),
            metadata
          );
        } catch (e) {
          info("Stage 3", `  Could not extract metadata from ${pdf}`);
        }
      }

      writeJson(join(dir, "retrieval.json"), retrieval);
      // Save raw LLM output for debugging
      await Bun.write(join(dir, "llm-output.txt"), raw);

      return retrieval;
    },
  });

  const succeeded = results.filter((r) => r.result).length;
  const withForms = results.filter(
    (r) => r.result && !r.result.no_form_found
  ).length;
  console.log(
    `\nStage 3 complete: ${succeeded}/${work.length} processed, ${withForms} found forms`
  );
}
