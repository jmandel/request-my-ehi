import type { RunOptions, Organization, FormEvaluation } from "../lib/types";
import type { PdfMetadata } from "../lib/pdf";
import { callLLM } from "../lib/llm";
import {
  readJson,
  writeJson,
  dataPath,
  exists,
  listFiles,
  listDirs,
} from "../lib/store";
import { runParallel } from "../lib/parallel";
import { banner, info, success, fail } from "../lib/log";
import { readFileSync } from "fs";
import { join } from "path";

const ORGS_DIR = "organizations";
const FORMS_DIR = "forms";
const EVALS_DIR = "evaluations";

function allOrganizations(): Organization[] {
  const files = listFiles(ORGS_DIR, ".json");
  const orgs: Organization[] = [];
  for (const f of files) {
    const data = readJson<Organization[]>(`${ORGS_DIR}/${f}.json`);
    if (data) orgs.push(...data);
  }
  return orgs;
}

interface EvalCandidate {
  org: Organization;
  formUrl: string;
  metadata: PdfMetadata;
}

function findCandidates(): EvalCandidate[] {
  const orgs = allOrganizations();
  const orgMap = new Map(orgs.map((o) => [o.org_id, o]));
  const candidates: EvalCandidate[] = [];

  for (const orgId of listDirs(FORMS_DIR)) {
    const org = orgMap.get(orgId);
    if (!org) continue;

    const retrieval = readJson<any>(`${FORMS_DIR}/${orgId}/retrieval.json`);
    if (!retrieval || retrieval.no_form_found) continue;

    // Find the best form (first ROI form with successful download)
    const bestForm = retrieval.forms_found?.find(
      (f: any) => f.download_success && f.document_type === "roi_form"
    );
    if (!bestForm) continue;

    const metaPath = `${FORMS_DIR}/${orgId}/${bestForm.filename.replace(
      ".pdf",
      "-metadata.json"
    )}`;
    const metadata = readJson<PdfMetadata>(metaPath);
    if (!metadata) continue;

    candidates.push({
      org,
      formUrl: bestForm.url,
      metadata,
    });
  }
  return candidates;
}

function makePrompt(c: EvalCandidate): string {
  // Load the retrieval notes
  const retrieval = readJson<any>(
    `${FORMS_DIR}/${c.org.org_id}/retrieval.json`
  );

  return `You are evaluating a healthcare provider's Release of Information form
for patient accessibility and quality.

Organization: ${c.org.name} (${c.org.city}, ${c.org.state})
Organization type: ${c.org.size}, ${c.org.ownership}
Form URL: ${c.formUrl}

Form text (extracted via pdftotext):
---
${c.metadata.full_text.slice(0, 8000)}
---

Technical metadata:
- Pages: ${c.metadata.page_count}
- File size: ${(c.metadata.file_size_bytes / 1024).toFixed(0)}KB
- Fillable fields: ${c.metadata.fillable_field_count} (${c.metadata.fillable_field_names.join(", ") || "none"})
- Has text layer: ${c.metadata.has_text_layer}
- Image-only scan: ${c.metadata.is_image_only_scan}
- Fonts: ${c.metadata.font_count}
- Embedded images: ${c.metadata.embedded_image_count}

Retrieval notes: ${retrieval?.notes || "none"}
Retrieval difficulty: ${retrieval?.retrieval_difficulty || "unknown"}

Write a detailed evaluation (500-1000 words) covering these dimensions:

A. FINDABILITY: How easy was this form to locate online?
B. TECHNICAL ACCESSIBILITY: Text layer, fillable fields, digital-first design.
C. CONTENT DESIGN: Length, clarity, organization, layout, readability.
D. PATIENT-CENTEREDNESS: Patient access focus, scope options, format options,
   HIPAA Right of Access references, EHI Export awareness.
E. COMPLIANCE SIGNALS: Any unreasonable barriers (notarization, in-person only,
   fees, unreasonable expiry, consent bundling)?

Be specific — quote form text, note exact field counts, describe layout issues.
This evaluation will be used to generate quantitative scores, so include enough
detail to justify scoring decisions.`;
}

export async function run(opts: RunOptions) {
  const candidates = findCandidates();
  if (candidates.length === 0) {
    fail("Stage 4", "No forms with metadata found. Run stage3 first.");
    process.exit(1);
  }

  let work = candidates.filter((c) => {
    if (opts.filter && !c.org.org_id.includes(opts.filter)) return false;
    if (!opts.force && exists(`${EVALS_DIR}/${c.org.org_id}.json`))
      return false;
    return true;
  });
  if (opts.limit) work = work.slice(0, opts.limit);

  const skipped = candidates.length - work.length;
  banner("Stage 4: Evaluate Forms", {
    Forms: `${work.length} to evaluate (${skipped} skipped)`,
    Parallel: opts.parallel,
    Model: opts.model,
    Output: dataPath(EVALS_DIR),
  });

  if (work.length === 0) {
    info("Stage 4", "Nothing to do.");
    return;
  }

  for (const c of work) {
    console.log(`  • ${c.org.org_id} (${c.org.name})`);
  }
  console.log();

  if (opts.dryRun) {
    info("Stage 4", "Dry run — would evaluate above forms");
    return;
  }

  const results = await runParallel({
    items: work,
    concurrency: opts.parallel,
    onStart: (c) => info("Stage 4", `START  ${c.org.org_id}`),
    onDone: (c) => success("Stage 4", `DONE   ${c.org.org_id}`),
    onError: (c, err) =>
      fail("Stage 4", `FAIL   ${c.org.org_id} — ${err.message.slice(0, 100)}`),
    fn: async (c) => {
      const evaluationText = await callLLM({
        prompt: makePrompt(c),
        model: opts.model,
      });

      const evaluation: FormEvaluation = {
        org_id: c.org.org_id,
        org_name: c.org.name,
        form_url: c.formUrl,
        evaluation_text: evaluationText,
        evaluated_at: new Date().toISOString(),
      };

      writeJson(`${EVALS_DIR}/${c.org.org_id}.json`, evaluation);
      return evaluation;
    },
  });

  const succeeded = results.filter((r) => r.result).length;
  console.log(`\nStage 4 complete: ${succeeded}/${work.length} evaluated`);
}
