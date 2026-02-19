---
name: request-my-ehi
description: Help a patient request their complete Electronic Health Information (EHI) Export from their healthcare provider. Supports Epic and 70+ other certified EHR vendors. Explains what EHI is, why it matters, identifies the provider's EHR system, generates a vendor-specific appendix, guides through gathering details, finding forms, and producing a ready-to-submit PDF package.
argument-hint: [provider-name]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, WebFetch, WebSearch, Task
---

# Request My EHI Export

## First-Time Setup

**Before using any scripts**, install dependencies in the skill's scripts directory:

```bash
cd <skill-dir>/scripts && bun install
```

This installs `pdf-lib` for PDF generation/manipulation. All scripts in this skill use **Bun** (not Node.js).

Optional: `pdftoppm` from **poppler-utils** (`apt install poppler-utils`) is useful for rendering PDFs to images for visual verification.

**Script usage pattern:**
```bash
bun <skill-dir>/scripts/<script-name>.ts [arguments]
```

## Background: What Is an EHI Export and Why Does It Matter?

Every patient has a right to their complete medical record. In practice, when patients request "their records," they usually get a small, curated summary (a CCDA document or MyChart printout) that omits the vast majority of the data their provider actually stores about them.

The **EHI Export** is different. It's a certified feature (ONC § 170.315(b)(10)) that all EHR vendors have been required to support since December 31, 2023. It produces a **bulk export of all structured data** in a patient's record -- the format varies by vendor (TSV files for Epic, CSV/NDJSON/SQL for others) but the result is the same: the closest thing to a complete copy of everything the provider's system knows about the patient.

Most patients don't know this feature exists, and many providers haven't used it before. Your job is to be a knowledgeable, patient, and supportive guide -- helping the patient understand what they're asking for, why they're entitled to it, and how to navigate any friction they encounter.

This skill supports **Epic** and **70+ other certified EHR vendors**. You can identify the vendor from the patient's portal URL or provider name, then generate vendor-specific documentation.

### Key concepts to convey to the patient

- **EHI Export is NOT the same as a CCDA, patient portal download, or standard records release.** Those are summaries. The EHI Export is the full database extract.
- **It's their legal right.** HIPAA's Right of Access (45 CFR § 164.524) entitles patients to receive their PHI in the electronic form and format they request, if readily producible. Since EHI Export is a built-in certified feature, it is readily producible.
- **Refusing is potentially information blocking.** Under the 21st Century Cures Act (45 CFR Part 171), declining to use an available, certified export feature when a patient requests it could constitute information blocking.
- **The provider must act within 30 days** (with one 30-day extension if they notify the patient in writing).
- **Patient identifiers should NOT be encrypted** in the patient's own copy -- since it's their data, encrypted IDs make it unusable.
- **Every certified EHR has this feature.** The format varies by vendor -- Epic uses TSV, others use CSV, NDJSON, SQL, etc. -- but the legal requirement is the same across all vendors.

## What You're Producing

A **ready-to-submit PDF package** consisting of:
1. A cover letter (page 1) addressed to the records department -- explains what's being requested and suggests routing
2. An access request form (page 2) filled with the patient's details -- ideally the provider's own ROI form, or our generic HIPAA-compliant access request form if the provider's form isn't available
3. An appendix (page 3) explaining what EHI Export is, legal basis, and how to produce it

## Step 1: Identify the Provider

**Your first question should be: "What's the name of the doctor or clinic you want to request records from?"** A website or patient portal URL is also great if they have one.

Don't ask about EHR systems, vendors, or technical details -- that's your job to figure out, not the patient's. If the patient already told you the provider name (e.g., as an argument when invoking the skill), skip ahead.

Be ready to explain things in plain language if the patient has questions. Many patients are frustrated because they've asked for "all my records" before and received an incomplete summary. Validate that experience and explain how the EHI Export addresses it.

## Step 2: Identify the EHR Vendor

Once you know the provider, figure out which EHR system they use. This determines the vendor-specific details in the appendix (export format, documentation URL, entity counts, etc.). **This is a web research task -- search for information about the provider online. Don't ask the patient what EHR their doctor uses.**

### How to identify the vendor

1. **Check their patient portal URL** (if the patient provided one) -- the domain often reveals the vendor:
   - `mychart.*` or `*.epic.com` → Epic
   - `*.athenahealth.com` or `*.athenanet.athenahealth.com` → athenahealth
   - `*.eclinicalworks.com` → eClinicalWorks
   - `*.nextgen.com` → NextGen
   - `*.allscripts.com` or `*.veradigm.com` → Veradigm/Allscripts
   - `*.elationhealth.com` → Elation Health
   - `*.drchrono.com` → DrChrono
   - `*.kareo.com` → Kareo/Tebra
   - `*.advancedmd.com` → AdvancedMD
   - `*.modmed.com` → Modernizing Medicine
2. **Search the web** for `"[provider name]" EHR` or `"[provider name]" "electronic health record"` or `"[provider name]" "patient portal"`
3. **Check CHPL** (ONC Certified Health IT Product List) if needed
4. **Ask the patient as a last resort** -- they may know (e.g., "we use Epic" or "we use athena")

### Look up vendor details

Use the vendor database at `https://joshuamandel.com/ehi-export-analysis/data/vendors.json` (71 vendors with detailed export information). The lookup script makes this easy:

```bash
bun <skill-dir>/scripts/lookup-vendor.ts "athena"
```

This returns the vendor's:
- **Product name** and developer
- **Export formats** (CSV, NDJSON, TSV, SQL, etc.)
- **EHI documentation URL** -- the official vendor page documenting their export
- **Entity/field counts** -- how many data tables and fields the export includes
- **Grade and coverage** -- quality assessment of the export
- **Analysis report URL** -- a detailed markdown report you can fetch for deeper details

If the vendor has an analysis report, fetch it to learn:
- How the export is produced (UI-based? API? bulk?)
- What data categories are included (clinical, billing, scheduling, etc.)
- Any quirks or limitations
- Specific instructions for the provider's IT team

```bash
# The analysis report URL follows this pattern:
# https://joshuamandel.com/ehi-export-analysis/data/analyses/{slug}.md
```

### If you can't identify the vendor

If you can't determine the vendor from web searches, ask the patient if they happen to know. If not, default to generic language in the appendix. The legal requirements are the same regardless of vendor -- every certified EHR must support EHI Export.

## Step 3: Gather Patient Details

Ask the patient for their information. They can either:
- **Upload a file** (e.g., a FHIR Patient resource JSON, or any structured file with their details)
- **Provide details directly** in conversation

You need:
- Full name
- Date of birth
- Street address, city, state, zip
- Phone number
- Email address

If they provide a FHIR Patient resource or similar file, extract all details from it. Confirm the details with the patient before proceeding.

## Step 4: Find and Obtain a Request Form

Using the provider's own ROI (Release of Information) form reduces friction -- staff recognize their own paperwork and are more likely to process it without pushback. Always attempt the provider's form first, whether it has fillable fields or not. But it's not required. HIPAA requires that the patient put the request in writing if the covered entity asks (45 CFR § 164.524(b)(1)). If you can't find the provider's form, use our generic access request template instead.

### Finding the provider's form

Help the patient get this form through multiple approaches:

1. **Ask if they have it already** -- they may have downloaded it from their provider's website or picked one up at the office.
2. **Search the web** with several query variations:
   - `"[provider name]" "authorization" "release" "protected health information" filetype:pdf`
   - `"[provider name]" "medical records" "release form" filetype:pdf`
   - `"[provider name]" "ROI" OR "release of information" form filetype:pdf`
   - `site:[provider-domain] authorization release`
3. **Navigate the provider's website** -- look for sections like:
   - "Patients & Visitors" / "Patient Resources" / "Forms"
   - "Medical Records" / "Health Information Management (HIM)"
   - "Release of Information" / "Request Your Records"
4. **Check if the provider is part of a larger health system** -- the form may be on the parent system's website rather than the individual clinic's.
5. **Look for the provider's patient portal** -- some portals have downloadable forms.

Download the PDF form to `/tmp/provider_form.pdf`. If you find the URL but can't fetch it (network errors, bot blocking, CAPTCHA, etc.), share the link with the patient and ask them to download and share the file back to you:

> "I found what looks like your provider's records release form at [URL], but I'm having trouble downloading it directly. Could you click that link, download the PDF, and share it with me? Then I can fill it out for you."

**After downloading, check if the form has fillable fields:**
```bash
bun <skill-dir>/scripts/list-form-fields.ts /tmp/provider_form.pdf
```

### Decision flow

```
Found provider's form?
├── Yes, has fillable AcroForm fields
│   └── Fill via form field API → flatten → visual check → proceed
├── Yes, flat/scanned PDF (no fields)
│   └── Transcribe to markdown with filled values → convert to PDF → visual check → proceed
└── No form found
    └── Use generic form (fillable fields)
```

**⚠️ IMPORTANT: When the form has 0 fillable fields, do NOT skip straight to the generic form.** The provider's own form reduces friction with records staff. Transcribe the flat form to markdown (preserving all sections, text, and structure) and convert to a clean PDF.

### The generic access request form

If the provider's own form can't be found, use the generic fillable PDF at `templates/authorization-form.pdf`. This is a last resort when no provider form exists, or a fallback after coordinate-based filling of a flat provider form has been tried and rejected by the user. It is a proper interactive PDF form with labeled fields that any user could open and fill in a standard PDF reader. It frames the request as an exercise of the HIPAA Right of Access (45 CFR § 164.524). It includes:
- Description of information to be disclosed
- Who the request is directed to
- Who the records should be delivered to
- Acknowledgment
- Signature and date

To use it programmatically, copy it to `/tmp/provider_form.pdf` and fill it with pdf-lib's form field API -- the same approach used for provider forms:
```javascript
const form = doc.getForm();
form.getTextField('patientName').setText(patient.name);
form.getTextField('dob').setText(patient.dob);
form.getCheckBox('ehiExport').check();
// ... etc
form.flatten();
```

The generic form is clean and professional. Let the patient know you're using a standard access request form and explain that providers must accept any written request for access -- they cannot insist on their own form.

### Either way, also suggest the patient:
- Call the provider's medical records department to confirm the best way to submit
- Ask about turnaround time and preferred delivery method (fax, mail, in person, portal)

## Step 5: Find the Provider's Fax Number and Address

While searching for the form, also look for the provider's **medical records / HIM department fax number and mailing address**. The patient will need these to submit the completed request. Search for:
- `"[provider name]" "medical records" fax`
- `"[provider name]" "release of information" fax`
- `"[provider name]" "HIM" OR "health information management" fax`

Note these for the delivery guidance at the end.

## Step 6: Fill the Request Form

### Filling a provider form with AcroForm fields

Use the reference script to enumerate all form fields:
```bash
bun <skill-dir>/scripts/list-form-fields.ts /tmp/provider_form.pdf
```

This will show each field's type, name, current value, and widget position (x, topY, width, height). Use this to understand the form's structure.

Then write a script to fill the form using pdf-lib's form field API. Map fields intelligently:

- **Patient name fields**: Look for fields containing "name", "patient" -- note that field names are sometimes misleading (e.g., "Address" might actually be the patient name field if it's the first field at the top). Use widget positions to disambiguate.
- **Date of birth**: Fields with "birth", "dob", "date of birth"
- **Address fields**: "street", "address", "city", "state", "zip"
- **Provider/facility fields** (the "I request records from" section): Fill with the provider's own name and address
- **Recipient fields** (the "Deliver to" section): Fill with the patient's name and address (they are requesting their own records), appending "(myself)" to the name
- **Email/fax fields**: Patient's email
- **PHI description**: Write "See Appendix A (attached)" -- use drawText if no form field exists for this area
- **Include Images**: Check if available
- **Date fields**: Today's date
- **Signature**: Handle in the next step

Always flatten the form after filling so fields render as static text.

**Important**: Fill all pages of the provider's form that have fields to fill out. Only skip pages that have no fillable content (e.g., "For Office Use Only" pages, instruction-only pages).

### Filling a flat/scanned provider form (markdown transcription)

When the provider's form has no fillable fields, transcribe it to markdown with filled values, then convert to PDF. This produces a clean, readable document that faithfully represents the original form's content.

**Step 1: Transcribe the form to markdown**

Create a markdown file that reproduces the form's structure and content with the patient's information filled in. **Start with a note explaining the transcription:**

```markdown
> **Note to Medical Records Department:** Your authorization form is a non-fillable
> PDF (it lacks interactive form fields), which prevents electronic completion.
> Pursuant to 45 CFR § 164.524(b)(1), covered entities may not impose unreasonable
> measures that serve as barriers to individuals requesting access. This document
> faithfully reproduces all content from your authorization form with the required
> information completed.
>
> Form source: https://example-health.org/forms/medical-records-release.pdf

(Include the actual URL where the form was retrieved, when known, for easy verification.)

---

# Authorization for Release of Health Information

**Provider:** University Health Partners

---

## Patient Information

| Field | Value |
| ----- | ----- |
| Patient Name | **Jane Doe** |
| Date of Birth | January 15, 1985 |
| Address | 123 Main Street, Madison, WI 53711 |
| Phone | (608) 555-0123 |

## Information Requested

- [ ] Complete Medical Record
- [ ] Discharge Summary
- [x] Other (see below)

> **Electronic Health Information (EHI) Export** — Complete export of all 
> structured data pursuant to 45 CFR § 170.315(b)(10). See attached Appendix A.

## Authorization

I authorize the release of my protected health information as described above.

**Patient Signature:** __________________ **Date:** February 19, 2025

![Signature](/tmp/signature.png)

**Printed Name:** Jane Doe
```

**Important:** Do not place signature images inside table cells — the renderer does not support images in tables. Use the format above: signature label and date on one line, image below, printed name below that.

**Tips for high-fidelity transcription:**

- **Preserve all original text** — Include section headers, instructions, legal language, and fine print exactly as they appear
- **Use `[x]` / `[ ]` for checkboxes** — Renders as `[X]` checked or `[ ]` unchecked
- **Use `>` for callouts** — Renders with a border box
- **Match the original form's organization** — Same sections in same order

**Step 2: Add the signature**

The signature can be included in two ways:

1. **File path** — If you have the signature saved to disk:
   ```markdown
   ![Signature](/tmp/signature.png)
   ```

2. **Base64 data URL** — Embed the image directly:
   ```markdown
   ![Signature](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...)
   ```

To get a base64 data URL from a file:
```bash
echo "data:image/png;base64,$(base64 -w0 /tmp/signature.png)"
```

Place the signature image in the appropriate location (usually above or next to "Patient Signature" and the date).

**Step 3: Convert to PDF**

```bash
bun <skill-dir>/scripts/md-to-pdf.ts /tmp/filled_form.md /tmp/provider_form_filled.pdf
```

This produces a clean PDF with:
- Proper typography and spacing
- Tables rendered with borders
- Checkboxes as `[X]` or `[ ]`
- Embedded signature image
- Automatic page breaks

**Step 4: Verify the result**

```bash
pdftoppm -png -r 150 -singlefile /tmp/provider_form_filled.pdf /tmp/preview
```

Review the rendered PDF. The markdown approach typically produces clean results on the first try, but verify the signature placement and overall layout before proceeding.

**When to use markdown transcription:**
- Coordinate-based filling failed after 1-2 attempts
- The original form is a poor scan or has complex layout
- The form has many sections that are hard to overlay accurately
- You want a guaranteed clean result

**What to tell the patient:**
> "Your provider's form isn't digitally fillable, so I've created a clean version that includes all the same information and sections. It's formatted as a standard authorization form with your details filled in. Providers are required to accept any written request that meets HIPAA requirements."

### Visual review

After filling the form (via form fields or markdown transcription), verify the result:

1. **Render the filled PDF to an image** and visually inspect it
2. **Check for problems:** signature placement, text legibility, checkbox states, overall layout
3. **For markdown-transcribed forms**, the output is typically clean on the first try since it's generated fresh (not overlaid on an existing PDF)

### What to say to the user

**When transcribing a flat form to markdown:**
> "Your provider's form isn't digitally fillable, so I've created a clean version that includes all the same sections and content with your information filled in. Providers are required to accept any written request that meets HIPAA requirements."

**When using the generic form:**
> "I'm using a standard HIPAA access request form. This is equally valid -- providers are required to accept any written request that meets the requirements of the HIPAA Right of Access."

## Step 7: Handle Signature

There are three options for getting the patient's signature, in order of preference:

### Option A: Electronic Signature (Recommended)

If the signature service is configured (check `scripts/config.json` -- `relayUrl` must be set), collect an electronic signature. The patient draws their signature on a secure webpage using their phone or computer.

**When presenting this option to the patient, say something like:**
> "Now let's collect your electronic signature to include in the form. I'll send you a link to a secure page where you can draw your signature."

**Do NOT use technical terms** like "relay server", "E2EE", "encrypted session", etc. with the patient. Just call it "electronic signature" or "e-signature".

1. **Create a session:**
```bash
bun <skill-dir>/scripts/create-signature-session.ts \
  --signer-name "Jane Doe" \
  --expiry-minutes 60
```
Optionally pass `--instructions "Custom text"` to override the default instructions shown to the signer. Outputs JSON to stdout:
```json
{
  "sessionId": "62ee3034-...",
  "signUrl": "https://relay.example.com/sign/62ee3034-...",
  "privateKeyJwk": { "kty": "EC", "crv": "P-256", "d": "...", "x": "...", "y": "..." }
}
```
Save all three fields.

2. **Present the `signUrl` to the patient** — show them the link and tell them what to expect on the page. The patient cannot sign without this URL, so you must output it before starting the poll.

3. **Poll for completion** (run in background while the patient signs):
```bash
bun <skill-dir>/scripts/poll-signature.ts <session-id> '<private-key-jwk-json>' \
  --output-dir /tmp
```
This blocks until the patient signs (or the session expires). On success it writes:
- `/tmp/signature.png` -- transparent-background PNG of the drawn signature
- `/tmp/signature-metadata.json` -- timestamp, audit log

And outputs JSON to stdout:
```json
{
  "signaturePath": "/tmp/signature.png",
  "metadataPath": "/tmp/signature-metadata.json",
  "timestamp": "2026-02-18T18:05:00.000Z"
}
```
Progress goes to stderr. Exits with code 1 if the session expires.

4. **Embed the signature PNG** directly on the form using `page.drawImage()` — it already has a transparent background, so no ImageMagick processing is needed. See Option B steps 2-4 for positioning guidance.

### Option B: Signature Image Upload

Ask the patient if they have a signature image to embed. If they provide one:
1. Make white pixels transparent: `convert input.png -fuzz 20% -transparent white /tmp/signature-transparent.png` (or use `magick` depending on the ImageMagick version available)
2. Embed the transparent PNG on the signature line using `page.drawImage()`
3. Scale to approximately 28-30px height, positioned just above the signature label line
4. Remove the PDF's signature form field (if any) so it doesn't overlay the image

### Option C: Print and Sign

If they don't have a signature image and live capture isn't available, let them know they'll need to print the final PDF and sign by hand before submitting.

## Step 8: Generate the Cover Letter and Appendix

### Cover Letter

The cover letter includes the patient's name and DOB (for identification if pages separate) and routes the request to the right team. Generate it with:

```bash
bun <skill-dir>/scripts/generate-cover-letter.ts '{
  "patientName": "Jane Doe",
  "dob": "03/15/1985",
  "outputPath": "/tmp/cover-letter.pdf"
}'
```

The `patientName` and `dob` fields are optional (the script produces a generic version without them), but you should always include them when patient info is available. The `date` field defaults to today if omitted.

A pre-built generic version (without patient info) exists at `templates/cover-letter.pdf` as a fallback.

### Appendix

The appendix contains no patient-specific information -- it explains what an EHI Export is, the legal basis, how to produce it, and delivery preferences. It accepts an optional `date` parameter to add a self-orienting reference line ("Accompanies Request for Access to PHI dated ...").

#### For Epic providers

For the quickest path, copy the pre-built `templates/appendix.pdf` to `/tmp/appendix.pdf`. To include the date reference line, regenerate:
```bash
bun <skill-dir>/scripts/generate-appendix.ts '{"date": "02/18/2026", "outputPath": "/tmp/appendix.pdf"}'
```

#### For non-Epic providers

Generate a vendor-specific appendix using the `scripts/generate-appendix.ts` script. Pass the vendor details from Step 2:

```bash
bun <skill-dir>/scripts/generate-appendix.ts '{
  "date": "02/18/2026",
  "vendor": {
    "developer": "athenahealth, Inc.",
    "product_name": "athenaClinicals",
    "export_formats": ["NDJSON", "HTML", "PDF"],
    "ehi_documentation_url": "https://docs.athenahealth.com/athenaone-dataexports/",
    "entity_count": 133,
    "field_count": 6809
  }
}'
```

This generates `/tmp/appendix.pdf` with:
- The vendor's product name and developer in the request description
- The vendor's official EHI documentation URL in the reference table
- Export format details (CSV, NDJSON, etc.) and entity/field counts
- Vendor-appropriate delivery language (MyChart for Epic, generic for others)
- A footer reference line tying the appendix to the dated request

All fields are optional -- the script gracefully falls back to generic language for any missing details.

## Step 9: Merge into Final Package

Use pdf-lib to merge:
1. The cover letter (1 page)
2. Page 1 of the filled provider form
3. The appendix PDF (1 page)

If the provider form was filled via AcroForm fields, `scripts/fill-and-merge.ts` handles both filling and merging in one step (pass `coverLetterPath` in the config).

If the provider form was filled via coordinate-based drawing (or you already have a filled PDF from the user), just write a simple pdf-lib merge script — load each PDF with `PDFDocument.load()`, copy pages with `copyPages()`, and save:

```typescript
import { PDFDocument } from "pdf-lib";
const merged = await PDFDocument.create();
for (const path of ["/tmp/cover.pdf", "/tmp/filled_form.pdf", "/tmp/appendix.pdf"]) {
  const doc = await PDFDocument.load(await Bun.file(path).arrayBuffer());
  const pages = await merged.copyPages(doc, doc.getPageIndices());
  pages.forEach(p => merged.addPage(p));
}
await Bun.write("/tmp/ehi-request-provider.pdf", await merged.save());
```

Save the final PDF to the working directory with a descriptive name like `ehi-request-[provider].pdf`.

**⚠️ Verify signature placement:** After generating the PDF with a signature:
1. Use a PDF-to-image tool or your environment's screenshot capability to visually inspect the signature location
2. Check that the signature appears in the correct position on the correct page (note: `signaturePosition.page` specifies which page, 0-indexed)
3. Confirm the signature is not overlapping other text or cut off at edges
4. If placement is wrong, adjust the coordinates in your config and regenerate

Only proceed once you've verified the PDF looks correct.

## Step 10: Help the Patient Submit

This is where many patients get stuck. Don't just hand them the PDF -- help them actually submit it.

**⚠️ CRITICAL: Always get explicit user approval before submitting.**

Before faxing, mailing, or otherwise submitting the request:
1. Show the user the completed PDF (provide a download link or display it)
2. Summarize what will be sent: recipient fax number/address, document contents, page count
3. Ask the user to confirm: "Ready to send this {N}-page fax to {fax number}?"
4. Only proceed after receiving explicit confirmation (e.g., "yes", "send it", "go ahead")

**Never auto-submit without user approval.** The patient must review and approve before any transmission.

### Submission options:

1. **Send fax directly** (recommended if `relayUrl` is configured in `scripts/config.json`): If you found the provider's fax number and the user has approved, send the fax. Present this to the patient as simply "I can fax this directly to the provider for you" -- no need to mention technical details:
```bash
bun <skill-dir>/scripts/send-fax.ts "+15551234567" ./ehi-request-provider.pdf
```
Outputs JSON to stdout with `faxId`, `provider`, and `status` (initially `"queued"` or `"sending"`). Check delivery status:
```bash
bun <skill-dir>/scripts/check-fax-status.ts <fax-id>
```
Returns `status` (`queued` | `sending` | `delivered` | `failed`), plus `pages`, `completedAt`, and `errorMessage` when applicable.

2. **Fax** (manual): If you found the fax number earlier, tell them exactly where to fax. Many online fax services work if they don't have a physical fax machine.
3. **In person**: They can print and drop it off at the provider's medical records or HIM department.
4. **Mail**: Provide the mailing address if known.
5. **Patient portal**: Some providers accept ROI requests electronically -- check if this is an option.
6. **Email**: Some providers accept scanned/emailed forms -- less common but worth mentioning.

Also prepare them for potential pushback:
- The records department may not be familiar with "EHI Export" -- the appendix explains it and points them to their vendor's documentation.
- They may try to give the patient a CCDA, portal download, or printed summary instead -- the patient should politely insist on the full EHI Export, which is a specific certified feature in their EHR system.
- If the provider claims they can't do it, the patient can reference the ONC certification requirement (it's been mandatory since Dec 31, 2023) and suggest the provider contact their EHR vendor's support team.
- If the provider misses the 30-day deadline, the patient can file a complaint with the HHS Office for Civil Rights (OCR).

## Key Legal References

- **HIPAA Right of Access**: 45 CFR § 164.524
- **Information Blocking**: 45 CFR Part 171 (21st Century Cures Act)
- **ONC Certification**: § 170.315(b)(10) - EHI Export (required since December 31, 2023)
- **ONC certification test method**: https://www.healthit.gov/test-method/electronic-health-information-export
- **File a HIPAA complaint**: https://www.hhs.gov/hipaa/filing-a-complaint/index.html
- **Vendor EHI export database**: https://joshuamandel.com/ehi-export-analysis/data/vendors.json (71 vendors)

## Technical Notes

- **All scripts require Bun** -- run with `bun <script>.ts`, not `node`
- **First-time setup**: Run `cd <skill-dir>/scripts && bun install` to install pdf-lib
- **Service URL**: Scripts for signatures and faxing (`create-signature-session.ts`, `poll-signature.ts`, `send-fax.ts`, `check-fax-status.ts`) read the server URL from `scripts/config.json` (`relayUrl` field). You can also pass a URL as the first argument to override. Note: Use patient-friendly language ("electronic signature", "send the fax") -- avoid technical jargon like "relay server" when communicating with the patient.
- Use pdf-lib's form field API (not coordinate-based text drawing) wherever possible
- The appendix is a static PDF (`templates/appendix.pdf`) with no patient-specific content -- just copy and merge it
- The generic access request form (`templates/authorization-form.pdf`) is a fillable PDF (16 fields) with these field names: `patientName`, `dob`, `phone`, `patientAddress`, `email`, `providerName`, `providerAddress`, `recipientName`, `recipientAddress`, `recipientEmail`, `ehiExport` (checkbox), `includeDocuments` (checkbox), `additionalDescription`, `signature`, `signatureDate`, `representativeAuth`. The form is generated by `scripts/build-authorization-form.ts` and is a Right of Access request under 45 CFR § 164.524.
- **When the provider's form has no fillable fields (0 AcroForm fields), do NOT skip to the generic form.** Use pdf-lib with coordinate-based drawing as described in Step 6. Use `pdftohtml -xml` output for coordinate calibration. Only fall back to the generic form after coordinate-based filling has been tried and the user rejects the result
- No browser engine (Chrome/Chromium) is required -- all PDFs are generated and manipulated with pdf-lib

### Script Reference

| Script | Usage |
|--------|-------|
| `lookup-vendor.ts` | `bun lookup-vendor.ts <search-term>` |
| `list-form-fields.ts` | `bun list-form-fields.ts <pdf-path>` |
| `generate-appendix.ts` | `bun generate-appendix.ts ['{"vendor": {...}}']` |
| `generate-cover-letter.ts` | `bun generate-cover-letter.ts ['{"outputPath": "..."}']` |
| `fill-and-merge.ts` | `bun fill-and-merge.ts <config.json>` |
| `md-to-pdf.ts` | `bun md-to-pdf.ts <input.md> [output.pdf]` |
| `create-signature-session.ts` | `bun create-signature-session.ts [--instructions <text>] [--signer-name <name>]` |
| `poll-signature.ts` | `bun poll-signature.ts <session-id> '<private-key-jwk>'` |
| `send-fax.ts` | `bun send-fax.ts <fax-number> <pdf-path>` |
| `check-fax-status.ts` | `bun check-fax-status.ts <fax-id>` |

