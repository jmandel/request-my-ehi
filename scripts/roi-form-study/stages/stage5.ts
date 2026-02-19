import type { RunOptions, FormScores, FormEvaluation } from "../lib/types";
import { callLLMJson } from "../lib/llm";
import { readJson, writeJson, dataPath, exists, listFiles } from "../lib/store";
import { runParallel } from "../lib/parallel";
import { banner, info, success, fail } from "../lib/log";

const EVALS_DIR = "evaluations";
const SCORES_DIR = "scores";

function allEvaluations(): FormEvaluation[] {
  const files = listFiles(EVALS_DIR, ".json");
  const evals: FormEvaluation[] = [];
  for (const f of files) {
    const data = readJson<FormEvaluation>(`${EVALS_DIR}/${f}.json`);
    if (data) evals.push(data);
  }
  return evals;
}

function makePrompt(ev: FormEvaluation): string {
  return `Convert this form evaluation into structured scores.

Organization: ${ev.org_name}

Evaluation:
---
${ev.evaluation_text}
---

Score each dimension 1-5:
  5=Excellent (best practice), 4=Good, 3=Adequate, 2=Poor, 1=Very Poor, 0=N/A

Output a JSON object with this exact structure:
{
  "org_id": "${ev.org_id}",
  "org_name": "${ev.org_name}",
  "form_url": "${ev.form_url}",
  "scores": {
    "findability": {
      "score": <0-5>,
      "rationale": "<1-2 sentences>"
    },
    "technical_accessibility": {
      "score": <0-5>,
      "subscores": {
        "text_layer": <boolean>,
        "fillable_fields": <boolean>,
        "field_count": <number>,
        "is_scan": <boolean>,
        "is_digital_first": <boolean>
      },
      "rationale": "<1-2 sentences>"
    },
    "content_design": {
      "score": <0-5>,
      "subscores": {
        "page_count": <number>,
        "estimated_reading_level": "<grade|high_school|college>",
        "has_clear_hierarchy": <boolean>,
        "is_visually_clean": <boolean>
      },
      "rationale": "<1-2 sentences>"
    },
    "patient_centeredness": {
      "score": <0-5>,
      "subscores": {
        "is_patient_access_form": <boolean>,
        "offers_electronic_delivery": <boolean>,
        "references_hipaa_right_of_access": <boolean>,
        "mentions_ehi_export": <boolean>
      },
      "rationale": "<1-2 sentences>"
    },
    "compliance_signals": {
      "score": <0-5>,
      "subscores": {
        "requires_notarization": <boolean>,
        "requires_in_person": <boolean>,
        "discloses_fees": <boolean>,
        "has_unreasonable_expiry": <boolean>,
        "bundles_other_authorizations": <boolean>
      },
      "rationale": "<1-2 sentences>"
    },
    "overall": {
      "score": <weighted average: findability 15%, technical 25%, content 15%, patient-centeredness 25%, compliance 20%>,
      "grade": "<A|B|C|D|F based on: A=4.5-5, B=3.5-4.4, C=2.5-3.4, D=1.5-2.4, F=0-1.4>",
      "summary": "<one sentence>"
    }
  },
  "evaluated_at": "${new Date().toISOString()}"
}

Output ONLY the JSON object.`;
}

export async function run(opts: RunOptions) {
  const evals = allEvaluations();
  if (evals.length === 0) {
    fail("Stage 5", "No evaluations found. Run stage4 first.");
    process.exit(1);
  }

  let work = evals.filter((ev) => {
    if (opts.filter && !ev.org_id.includes(opts.filter)) return false;
    if (!opts.force && exists(`${SCORES_DIR}/${ev.org_id}.json`)) return false;
    return true;
  });
  if (opts.limit) work = work.slice(0, opts.limit);

  const skipped = evals.length - work.length;
  banner("Stage 5: Score Forms", {
    Evaluations: `${work.length} to score (${skipped} skipped)`,
    Parallel: opts.parallel,
    Model: opts.model,
    Output: dataPath(SCORES_DIR),
  });

  if (work.length === 0) {
    info("Stage 5", "Nothing to do.");
    return;
  }

  if (opts.dryRun) {
    info("Stage 5", "Dry run — would score above evaluations");
    return;
  }

  const results = await runParallel({
    items: work,
    concurrency: opts.parallel,
    onStart: (ev) => info("Stage 5", `START  ${ev.org_id}`),
    onDone: (ev, scores) =>
      success(
        "Stage 5",
        `DONE   ${ev.org_id} — ${scores.scores.overall.grade} (${scores.scores.overall.score.toFixed(1)})`
      ),
    onError: (ev, err) =>
      fail("Stage 5", `FAIL   ${ev.org_id} — ${err.message.slice(0, 100)}`),
    fn: async (ev) => {
      const scores = await callLLMJson<FormScores>({
        prompt: makePrompt(ev),
        model: opts.model,
      });
      writeJson(`${SCORES_DIR}/${ev.org_id}.json`, scores);
      return scores;
    },
  });

  const succeeded = results.filter((r) => r.result).length;
  console.log(`\nStage 5 complete: ${succeeded}/${work.length} scored`);

  // Grade distribution
  const grades: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const r of results) {
    if (r.result) {
      const g = r.result.scores.overall.grade;
      grades[g] = (grades[g] || 0) + 1;
    }
  }
  console.log("\nGrade distribution:");
  for (const [g, n] of Object.entries(grades)) {
    if (n > 0) console.log(`  ${g}: ${n}`);
  }
}
