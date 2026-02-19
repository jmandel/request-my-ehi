# ROI Form Quality Study: How Well Do Healthcare Providers Serve Patients Online?

## Overview

This study evaluates how well U.S. healthcare providers make their Release of Information (ROI) / Authorization forms available to patients online. We use an LLM-powered pipeline to systematically discover organizations, retrieve their forms, and score them against a structured rubric — producing a dataset that quantifies the current state of patient access to these critical documents.

### Research Question

> How common is it for healthcare providers to publish well-designed, digitally accessible release-of-information forms — and how does form quality vary by organization size, type, EHR vendor, and geography?

### Motivation

HIPAA's Right of Access (45 CFR § 164.524) requires that patients be able to request their health information. In practice, the first step is often filling out a provider-specific authorization form. If that form is hard to find, impossible to fill electronically, or poorly designed, it creates an unnecessary barrier. This study quantifies how widespread these barriers are.

---

## Pipeline Architecture

The study runs as a multi-stage LLM pipeline. Each stage takes structured input, uses prompts + tools (web search, web fetch, curl, pdftotext, etc.), and produces structured output for the next stage.

```
Stage 1: Define Sampling Frame
    ↓ org_categories.json
Stage 2: Discover Organizations
    ↓ organizations.json
Stage 3: Retrieve Forms
    ↓ forms/ (PDFs + retrieval metadata)
Stage 4: Evaluate Forms (Qualitative)
    ↓ evaluations/ (detailed write-ups)
Stage 5: Score Forms (Quantitative)
    ↓ scores.json (structured rubric scores)
Stage 6: Analyze & Report
    ↓ report.md / report.html
```

---

## Stage 1: Define Sampling Frame

### Purpose
Produce a structured set of organization categories that ensures diverse, representative coverage across the U.S. healthcare landscape.

### Stratification Axes

| Axis | Values |
|------|--------|
| **Organization size** | Large health system (10+ hospitals), Regional system (2-9 hospitals), Community hospital (single), Physician group (multi-specialty), Small practice (1-5 providers), FQHC, Critical access hospital |
| **EHR vendor** | Epic, Oracle Cerner, MEDITECH, athenahealth, eClinicalWorks, NextGen, Veradigm/Allscripts, Other/Unknown |
| **Geography** | Northeast, Southeast, Midwest, Southwest, West, Rural, Urban, Suburban |
| **Ownership type** | Non-profit, For-profit, Government/public, Academic medical center, VA/military |

### Output: `org_categories.json`

```json
[
  {
    "category_id": "large-nonprofit-epic-midwest",
    "size": "Large health system",
    "ehr": "Epic",
    "region": "Midwest",
    "ownership": "Non-profit",
    "target_count": 3,
    "description": "Large non-profit health systems in the Midwest running Epic"
  }
]
```

### Sampling Strategy

Not every cell in the full cross-product needs to be filled (many combinations don't exist in practice). The prompt should:

1. Enumerate realistic combinations (e.g., Critical Access + Epic is uncommon but exists; Critical Access + MEDITECH is very common)
2. Target 5-10 organizations per major size category
3. Ensure geographic spread within each category
4. Aim for ~200-300 total organizations across all categories
5. Over-sample categories where we expect more variance (e.g., small practices may vary more than large systems)

### Prompt Template

```
You are designing a sampling frame for a study of healthcare provider ROI
(Release of Information) forms. Your goal is to define organization categories
that will give us broad, representative coverage of the U.S. healthcare
landscape.

Define categories by crossing these axes where realistic combinations exist:
- Organization size: [list]
- EHR vendor: [list]
- Geography: [list]
- Ownership type: [list]

For each category, specify how many organizations we should try to find
(target_count). Prioritize diversity. Skip combinations that rarely exist
in practice. Aim for ~200-300 total organizations.

Output as JSON array of category objects.
```

---

## Stage 2: Discover Organizations

### Purpose
For each category from Stage 1, identify real organizations that match the description — with enough metadata to find their forms.

### Approach

For each category, the LLM uses web search to find matching organizations. The prompt should guide it to:

1. **Search for organizations matching the category description** using queries like:
   - `"[size] [region] hospital [EHR vendor] EHR"`
   - CHNA (Community Health Needs Assessment) reports that list hospital characteristics
   - CMS Hospital Compare data references
   - EHR vendor customer lists and case studies
   - State hospital association directories

2. **Verify each candidate** by confirming:
   - The organization exists and is currently operating
   - It matches the stated size/type
   - Its EHR vendor is confirmed (via published info, job postings mentioning the vendor, or news articles)
   - It has a website with a patient-facing section

3. **Collect metadata** for each organization

### Output: `organizations.json`

```json
[
  {
    "org_id": "mayo-clinic",
    "name": "Mayo Clinic",
    "category_id": "large-nonprofit-epic-midwest",
    "size": "Large health system",
    "ehr": "Epic",
    "ehr_confidence": "high",
    "region": "Midwest",
    "state": "MN",
    "city": "Rochester",
    "ownership": "Non-profit",
    "website": "https://www.mayoclinic.org",
    "bed_count": 2059,
    "notes": "Academic medical center, multi-state system"
  }
]
```

### Prompt Template (per category)

```
Find {target_count} healthcare organizations matching this description:
- Size: {size}
- EHR vendor: {ehr}
- Region: {region}
- Ownership: {ownership}

For each organization, verify:
1. It currently operates and has a patient-facing website
2. The EHR vendor is confirmed (cite your source: job posting, news article,
   vendor case study, etc.)
3. It matches the size and ownership type described

Use web search to find and verify candidates. Provide structured output
with the fields listed below.

Output as JSON array.
```

---

## Stage 3: Retrieve Forms

### Purpose
For each organization, attempt to find and download their ROI / authorization / medical records release form(s). Document the retrieval process and any difficulties.

### Approach

For each organization, the LLM should:

1. **Search for the form** using multiple strategies (mirroring our SKILL.md approach):
   - Web search: `"[org name]" "authorization" "release" "health information" filetype:pdf`
   - Web search: `"[org name]" "medical records" "release form" filetype:pdf`
   - Web search: `site:[org-domain] authorization release`
   - Navigate the org's website → Patient Resources / Medical Records / HIM
   - Check parent health system's website if applicable

2. **Download each candidate form** using curl with a realistic user agent

3. **Classify what was found**:
   - Correct ROI/authorization form
   - Wrong document type (privacy notice, patient rights, etc.)
   - Form for third-party release (not patient access)
   - Generic state/federal form (not org-specific)
   - No form found online

4. **Extract technical metadata** from each downloaded PDF:
   - `pdftotext` output (full text or empty = image-only)
   - `pdffonts` output (embedded fonts)
   - `pdfimages -list` output (embedded images)
   - `list-form-fields.ts` output (fillable field count and names)
   - Page count
   - File size

### Output: `forms/{org_id}/` directory per organization

```
forms/mayo-clinic/
├── retrieval.json          # Search process and results
├── form-1.pdf              # Downloaded form(s)
├── form-1-metadata.json    # Technical metadata
├── form-2.pdf              # (if multiple forms found)
└── form-2-metadata.json
```

#### `retrieval.json`
```json
{
  "org_id": "mayo-clinic",
  "search_queries": [
    { "query": "...", "results_found": 3 }
  ],
  "forms_found": [
    {
      "url": "https://...",
      "filename": "form-1.pdf",
      "download_success": true,
      "document_type": "roi_form",
      "is_patient_access_specific": false,
      "notes": "General ROI form, not patient-access specific"
    }
  ],
  "no_form_found": false,
  "retrieval_difficulty": "easy|moderate|hard|impossible",
  "notes": "Form was 3 clicks deep under Patient Resources > Medical Records"
}
```

#### `form-1-metadata.json`
```json
{
  "filename": "form-1.pdf",
  "file_size_bytes": 245000,
  "page_count": 2,
  "has_text_layer": true,
  "text_preview": "AUTHORIZATION FOR RELEASE OF HEALTH INFORMATION...",
  "full_text_chars": 3200,
  "fillable_field_count": 0,
  "fillable_field_names": [],
  "font_count": 3,
  "embedded_image_count": 0,
  "is_image_only_scan": false,
  "pdf_version": "1.4"
}
```

### Prompt Template (per organization)

```
Find the Release of Information / Authorization for Medical Records form
for: {org_name} ({website})

Search strategy:
1. Try these web searches (adapt the org name as needed):
   - "{org_name}" "authorization" "release" "health information" filetype:pdf
   - "{org_name}" "medical records" "release form" filetype:pdf
   - site:{domain} authorization release medical records
2. Navigate the website looking for Patient Resources, Medical Records, or HIM pages
3. Check the parent health system's website if this is part of a larger system

For each form you find:
- Download it with: curl -sL -o form.pdf -A "Mozilla/5.0 ..." "<URL>"
- Run: pdftotext form.pdf - | head -80
- Run: pdfimages -list form.pdf
- Run: bun list-form-fields.ts form.pdf
- Classify the document type (ROI form, privacy notice, patient rights, etc.)

Report what you found, including any difficulties (broken links, bot blocking,
forms behind patient portals, etc.).
```

---

## Stage 4: Evaluate Forms (Qualitative)

### Purpose
For each successfully retrieved form, produce a detailed written evaluation against the quality rubric. This is the "reasoning" step — the LLM reads the form content and writes a thorough assessment before we ask it to boil things down to scores.

### Evaluation Dimensions

#### A. Findability
- How many clicks/searches to locate the form?
- Is it linked from obvious places (Medical Records page, Patient Resources)?
- Is the URL/filename descriptive?
- Does the page clearly explain what the form is for?

#### B. Technical Accessibility
- **Text layer**: Is there extractable text, or is it an image-only scan?
- **Fillable fields**: Are there interactive form fields? How complete are they?
- **File format**: PDF version, file size relative to content
- **Digital-first design**: Was this clearly designed as a digital document, or is it a scan of a paper form?

#### C. Content Design
- **Length**: How many pages? Is the length proportionate to what's needed?
- **Clarity**: Is the language plain and understandable, or is it dense legalese?
- **Organization**: Are sections logically ordered? Is there clear visual hierarchy?
- **Whitespace and layout**: Is it visually clean or cramped and busy?
- **Font size**: Is text readable (10pt+) or tiny?

#### D. Patient-Centeredness
- **Patient access vs. third-party release**: Is there a form specifically for patients requesting their own records, or only a general release-to-third-party form?
- **Scope options**: Can the patient request specific record types, date ranges?
- **Format options**: Does the form offer electronic delivery?
- **Right of Access language**: Does the form reference HIPAA § 164.524 or patient rights?
- **EHI Export awareness**: Any mention of electronic health information export or bulk data?

#### E. Compliance Signals
- **Unreasonable barriers**: Does the form impose requirements beyond what HIPAA allows (e.g., notarization, in-person submission only, fees disclosed upfront)?
- **Expiration/auto-revocation**: Does the authorization expire in an unreasonably short time?
- **Broad consent bundling**: Does it try to bundle records release with other authorizations?

### Output: `evaluations/{org_id}.md`

A 500-1000 word written evaluation covering each dimension, with specific observations and quotes from the form content.

### Prompt Template

```
You are evaluating a healthcare provider's Release of Information form
for patient accessibility and quality.

Organization: {org_name}
Form URL: {url}
Form text (extracted via pdftotext):
---
{full_text}
---

Technical metadata:
- Pages: {page_count}
- Fillable fields: {field_count} ({field_names})
- Has text layer: {has_text}
- Image-only scan: {is_scan}
- File size: {file_size}

Write a detailed evaluation covering these dimensions:

A. FINDABILITY: How easy was this form to locate online? (Use retrieval notes.)
B. TECHNICAL ACCESSIBILITY: Text layer, fillable fields, digital-first design.
C. CONTENT DESIGN: Length, clarity, organization, layout, readability.
D. PATIENT-CENTEREDNESS: Patient access focus, scope options, format options.
E. COMPLIANCE SIGNALS: Any unreasonable barriers or concerning requirements.

Be specific — quote form text, note exact field counts, describe layout issues.
This evaluation will be used to generate quantitative scores, so include enough
detail to justify scoring decisions.
```

---

## Stage 5: Score Forms (Quantitative)

### Purpose
Convert each qualitative evaluation into a fixed-schema JSON score object. This is a separate stage so the LLM can focus purely on mapping observations to scores without needing to read the form again.

### Rubric

Each dimension is scored 1-5:

| Score | Label | Meaning |
|-------|-------|---------|
| 5 | Excellent | Best-practice example; other orgs should emulate this |
| 4 | Good | Meets expectations with minor issues |
| 3 | Adequate | Functional but has notable shortcomings |
| 2 | Poor | Significant barriers to patient use |
| 1 | Very Poor | Effectively unusable or inaccessible |
| 0 | N/A | Form not found or not retrievable |

### Output: entry in `scores.json`

```json
{
  "org_id": "mayo-clinic",
  "org_name": "Mayo Clinic",
  "category_id": "large-nonprofit-epic-midwest",
  "form_url": "https://...",
  "scores": {
    "findability": {
      "score": 3,
      "rationale": "Form is on the website but buried 4 clicks deep under Patient Resources > Medical Records > Release of Information > Download Form"
    },
    "technical_accessibility": {
      "score": 2,
      "subscores": {
        "text_layer": true,
        "fillable_fields": false,
        "field_count": 0,
        "is_scan": false,
        "is_digital_first": false
      },
      "rationale": "Flat PDF with text layer but no fillable fields. Designed as a print form."
    },
    "content_design": {
      "score": 3,
      "subscores": {
        "page_count": 2,
        "estimated_reading_level": "college",
        "has_clear_hierarchy": true,
        "is_visually_clean": true,
        "min_font_size_pt": 10
      },
      "rationale": "Well-organized 2-page form with clear sections, but dense legal language."
    },
    "patient_centeredness": {
      "score": 2,
      "subscores": {
        "is_patient_access_form": false,
        "offers_electronic_delivery": false,
        "references_hipaa_right_of_access": false,
        "mentions_ehi_export": false
      },
      "rationale": "General third-party release form, not patient-access specific. No electronic delivery option."
    },
    "compliance_signals": {
      "score": 4,
      "subscores": {
        "requires_notarization": false,
        "requires_in_person": false,
        "discloses_fees": false,
        "has_unreasonable_expiry": false,
        "bundles_other_authorizations": false
      },
      "rationale": "Standard authorization language without unusual barriers."
    },
    "overall": {
      "score": 2.8,
      "grade": "C",
      "summary": "Form exists online but is not fillable, not patient-access-specific, and offers no electronic delivery option."
    }
  },
  "evaluated_at": "2026-02-19T12:00:00Z"
}
```

### Overall Score Calculation

`overall.score = weighted average of dimension scores`

Suggested weights:
- Findability: 15%
- Technical Accessibility: 25%
- Content Design: 15%
- Patient-Centeredness: 25%
- Compliance Signals: 20%

Grade mapping: A (4.5-5.0), B (3.5-4.4), C (2.5-3.4), D (1.5-2.4), F (0-1.4)

### Prompt Template

```
Convert this form evaluation into structured scores.

Organization: {org_name}

Evaluation:
---
{evaluation_text}
---

Score each dimension 1-5 using this scale:
5=Excellent, 4=Good, 3=Adequate, 2=Poor, 1=Very Poor, 0=N/A

Dimensions:
A. Findability (1-5)
B. Technical Accessibility (1-5) — also fill subscores
C. Content Design (1-5) — also fill subscores
D. Patient-Centeredness (1-5) — also fill subscores
E. Compliance Signals (1-5) — also fill subscores

For each dimension, provide:
- score (integer 0-5)
- rationale (1-2 sentences justifying the score)
- subscores (boolean/numeric fields as specified in the schema)

Compute overall score as weighted average (findability 15%, technical 25%,
content 15%, patient-centeredness 25%, compliance 20%).

Output as JSON matching the schema provided.
```

---

## Stage 6: Analyze & Report

### Purpose
Aggregate scores across all organizations and produce summary statistics, visualizations, and narrative findings.

### Analyses to Produce

1. **Distribution of overall grades** — histogram of A/B/C/D/F across all orgs
2. **Dimension breakdown** — which dimensions are strongest/weakest overall?
3. **By organization size** — do large systems score better or worse than small practices?
4. **By EHR vendor** — do Epic sites tend to have better forms than Cerner sites?
5. **By geography** — regional patterns?
6. **By ownership type** — non-profit vs. for-profit vs. government?
7. **Worst barriers** — most common compliance issues
8. **Best practices** — exemplary forms worth highlighting
9. **Image-only scans** — what percentage of forms are image-only?
10. **Fillable fields** — what percentage have any fillable fields? Complete fields?
11. **No form online** — what percentage of orgs have no form findable online?

### Output

- `report.md` — narrative report with embedded statistics
- `scores.json` — complete scored dataset for further analysis
- `summary-stats.json` — pre-computed aggregations

---

## Implementation Plan

### Directory Structure

```
scripts/roi-form-study/
├── DESIGN.md                    # This document
├── config.json                  # Study parameters (sample sizes, weights, etc.)
├── prompts/
│   ├── 01-sampling-frame.md     # Stage 1 prompt
│   ├── 02-discover-orgs.md      # Stage 2 prompt template
│   ├── 03-retrieve-forms.md     # Stage 3 prompt template
│   ├── 04-evaluate-form.md      # Stage 4 prompt template
│   ├── 05-score-form.md         # Stage 5 prompt template
│   └── 06-analyze.md            # Stage 6 prompt
├── run-pipeline.sh              # Orchestrator script
├── data/
│   ├── org_categories.json      # Stage 1 output
│   ├── organizations.json       # Stage 2 output
│   ├── forms/                   # Stage 3 output (per-org subdirectories)
│   ├── evaluations/             # Stage 4 output (per-org markdown)
│   ├── scores.json              # Stage 5 output
│   └── report.md                # Stage 6 output
└── lib/
    ├── extract-pdf-metadata.sh  # Wrapper for pdftotext, pdfimages, pdffonts
    └── schemas.ts               # TypeScript types for JSON outputs
```

### Orchestration

The pipeline orchestrator (`run-pipeline.sh`) should:

1. Run stages sequentially (each depends on the previous)
2. Within each stage, parallelize across organizations (like our test matrix runner)
3. Support resumption — skip organizations that already have outputs
4. Log progress with timestamps
5. Support `--stage N` to run only a specific stage
6. Support `--org-id X` to run a single organization through all stages
7. Support `--sample N` to limit to N organizations per category (for testing)
8. Store all intermediate outputs so any stage can be re-run independently

### LLM Invocation

Each stage that requires LLM reasoning should:

1. Construct a prompt from the template + input data
2. Invoke the LLM (via copilot CLI, API, or similar)
3. Parse and validate the structured output (JSON schema validation)
4. Retry on malformed output (up to 3 attempts)
5. Save both the raw LLM response and the parsed output

### Cost & Scale Estimates

For ~250 organizations:
- Stage 1: 1 LLM call (sampling frame design)
- Stage 2: ~30-50 LLM calls (one per category, each finding 5-10 orgs)
- Stage 3: ~250 LLM calls (one per org, with web search tool use)
- Stage 4: ~250 LLM calls (one per successfully retrieved form)
- Stage 5: ~250 LLM calls (short extraction, cheapest per-call)
- Stage 6: 1-3 LLM calls (aggregation and report writing)

Total: ~800 LLM calls. Stages 3-4 are the most expensive due to tool use and long context.

### Validation & Quality Control

- **Inter-rater reliability**: Run Stage 4-5 twice on a random 10% sample with different prompts; compare scores for consistency
- **Spot checks**: Manually verify 5-10 evaluations against the actual forms
- **Schema validation**: Every JSON output is validated against a TypeScript schema before proceeding
- **Outlier review**: Flag scores that are surprising given the org's category (e.g., large academic center scoring 1 on findability)

---

## Ethical Considerations

- All data is publicly available (forms published on provider websites)
- No patient data is involved
- Organizations are identified by name (this is public accountability, not private information)
- Findings should be framed constructively — the goal is to improve patient access, not to shame specific organizations
- Consider sharing findings with organizations that score poorly, with specific improvement suggestions

---

## Extensions (Future Work)

- **Longitudinal tracking**: Re-run quarterly to track improvements
- **State-level policy correlation**: Do states with stronger patient access laws have better-scoring forms?
- **Portal integration**: Extend to evaluate whether forms are available through patient portals
- **Accessibility audit**: Add WCAG compliance checks (color contrast, screen reader compatibility)
- **OCR integration**: When we add OCR support, re-evaluate image-only scans
- **International comparison**: Extend to other countries' patient access frameworks
