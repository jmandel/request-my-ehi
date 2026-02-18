# request-my-ehi

A [Claude Code skill](https://agentskills.io) that helps patients request their complete **Electronic Health Information (EHI) Export** from healthcare providers.

Every certified EHR system in the US has been required to support single-patient EHI Export since December 31, 2023 (ONC § 170.315(b)(10)). This feature produces a bulk export of all structured data in a patient's record -- far more complete than a CCDA, patient portal download, or standard records release. Most patients don't know it exists, and many providers haven't used it before.

This skill walks the patient through the entire process: identifying their provider's EHR system, gathering their details, finding (or generating) the right authorization form, filling it out, attaching a detailed appendix explaining the request, and producing a ready-to-submit PDF package.

## What It Produces

A 2-page PDF package:
1. **Authorization form** -- either the provider's own ROI form (filled via pdf-lib's form field API) or a generic HIPAA-compliant fillable form
2. **Appendix A** -- a one-page document explaining what EHI Export is, the legal basis, how the provider's IT team can produce it, and delivery preferences

The appendix is customized per EHR vendor, citing the specific product name, export formats, documentation URL, and entity/field counts from a database of 70+ certified vendors.

## Supported Vendors

Supports **Epic** plus **70+ other certified EHR vendors** via the [EHI Export Analysis](https://joshuamandel.com/ehi-export-analysis/) vendor database. The skill identifies the provider's EHR system from their patient portal URL, web search, or the patient's knowledge, then generates vendor-specific documentation.

## Prerequisites

- [Claude Code](https://claude.ai/code) CLI
- Node.js >= 18
- pdf-lib (`npm install --prefix /tmp pdf-lib` -- the skill handles this automatically)
- ImageMagick (optional, for signature transparency)

## Installation

```bash
# Clone into your Claude Code skills directory
git clone https://github.com/jmandel/request-my-ehi.git ~/.claude/skills/request-my-ehi
```

Or for a project-level install:
```bash
mkdir -p .claude/skills
git clone https://github.com/jmandel/request-my-ehi.git .claude/skills/request-my-ehi
```

## Usage

Once installed, just tell Claude Code what you need:

```
I need to request my complete medical records from Associated Physicians of Madison.
```

```
Help me get my EHI export from my doctor. They use athenahealth.
```

```
I want to request all my health data from my provider. Their patient portal is at mychart.myhealthsystem.org.
```

Claude will recognize the intent and activate the skill. It will guide you through:
1. Understanding your situation and explaining EHI Export
2. Identifying your provider's EHR system
3. Collecting your details (or extracting from an uploaded file like a FHIR Patient resource)
4. Finding the provider's authorization form (or using the generic one)
5. Finding the provider's fax/mailing address for submission
6. Filling out the form programmatically
7. Capturing an e-signature (via E2EE relay, image upload, or print-and-sign)
8. Generating a vendor-specific appendix
9. Merging into a final PDF
10. Helping you actually submit the request (including fax via relay server)

## Files

```
request-my-ehi/
├── SKILL.md                              # Skill definition and instructions
├── scripts/
│   ├── config.json                       # Relay server URL (set relayUrl here)
│   ├── _resolve-server.mjs              # Shared helper: resolves server URL from config or CLI
│   ├── lookup-vendor.mjs                 # Search the 71-vendor EHI database
│   ├── generate-appendix.mjs             # Generate vendor-specific appendix PDF
│   ├── list-form-fields.mjs              # Enumerate fields in any PDF form
│   ├── fill-and-merge.mjs                # Reference: fill form + merge with appendix
│   ├── create-signature-session.mjs      # Create an E2EE signature capture session
│   ├── poll-signature.mjs                # Poll for and decrypt a completed signature
│   ├── send-fax.mjs                      # Send a PDF via the relay server fax outbox
│   └── check-fax-status.mjs             # Check fax delivery status
├── server/                               # Relay server (deployed separately)
│   ├── src/                              # Bun + Hono server source
│   ├── public/                           # sign.html, fax-outbox.html
│   ├── Dockerfile
│   └── package.json
└── templates/
    ├── appendix.pdf                      # Pre-built Epic appendix (static)
    ├── appendix.html                     # HTML source for the appendix
    ├── authorization-form.pdf            # Generic fillable HIPAA authorization form
    └── authorization-form.html           # HTML source for the authorization form
```

## Relay Server

The `server/` directory contains an optional relay server (Bun + Hono) that provides:

- **E2EE Signature Capture** -- patient draws their signature on a mobile-friendly web page; encrypted in-browser with ECDH P-256 + AES-256-GCM before reaching the server
- **Simulated Fax Outbox** -- faxes queue in-memory with a web UI for viewing PDFs and advancing delivery workflow

The relay scripts (`create-signature-session`, `poll-signature`, `send-fax`, `check-fax-status`) read the server URL from `scripts/config.json`. Set `relayUrl` there after deploying.

```bash
cd server && bun install && bun run dev  # localhost:3000
```

## Legal Context

- **HIPAA Right of Access** (45 CFR § 164.524) -- patients can request their PHI in electronic form
- **21st Century Cures Act** (45 CFR Part 171) -- declining to use a certified export feature may constitute information blocking
- **ONC Certification** § 170.315(b)(10) -- EHI Export has been required since December 31, 2023
- **Vendor EHI database** -- https://joshuamandel.com/ehi-export-analysis/

## License

Apache-2.0. See [LICENSE](LICENSE).
