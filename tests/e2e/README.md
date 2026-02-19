# E2E Test Harness

Non-interactive end-to-end testing of the request-my-ehi skill across different
healthcare providers and AI models.

## Prerequisites

- `copilot` CLI (GitHub Copilot CLI) — authenticated
- `bun` — used by skill scripts
- `poppler-utils` (`pdftoppm`, `pdfinfo`) — for PDF rendering/inspection
- `zip` — for packaging the skill

## Usage

```bash
./tests/e2e/run-test.sh --model <model> --provider <provider>
```

### Examples

```bash
# Test with Claude Sonnet against Tufts Medical Center
./tests/e2e/run-test.sh --model claude-sonnet-4.5 --provider "Tufts Medical Center"

# Test with GPT against Mass General Brigham
./tests/e2e/run-test.sh --model gpt-5.1-codex --provider "Mass General Brigham"

# Custom demographics and output directory
./tests/e2e/run-test.sh \
  --model claude-sonnet-4.5 \
  --provider "Kaiser Permanente" \
  --name "Jane Smith" \
  --dob "03/15/1985" \
  --address "456 Oak Ave, San Francisco, CA 94102" \
  --output-dir /tmp/my-test
```

### All Flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--model` | Yes | — | AI model (e.g. `claude-sonnet-4.5`, `gpt-5.1-codex`) |
| `--provider` | Yes | — | Healthcare provider name |
| `--name` | No | `John Doe` | Patient name |
| `--dob` | No | `01/01/1990` | Date of birth |
| `--address` | No | `123 Main St, Anytown, MA 02101` | Full address |
| `--phone` | No | `(555) 123-4567` | Phone number |
| `--email` | No | `test@example.com` | Email address |
| `--output-dir` | No | `/tmp/ehi-test-<slug>-<timestamp>` | Working directory |

### Available Models

Run `copilot --help` for the current list. Examples: `claude-sonnet-4.5`,
`claude-opus-4.5`, `gpt-5.1-codex`, `gpt-5-mini`, `gemini-3-pro-preview`.

## What Happens

1. The skill (`SKILL.md`, `scripts/`, `templates/`) is zipped from the repo
2. A clean workspace is created with the zip + a test signature image
3. `copilot` is invoked in non-interactive mode (`-p`) with `--allow-all --no-ask-user`
4. The agent unzips the skill, reads SKILL.md, and runs the full pipeline:
   identify EHR vendor → find provider form → fill form → generate appendix →
   generate cover letter → merge into final PDF
5. Results are checked and reported

## Output

After a run, the working directory contains:

| File | Description |
|------|-------------|
| `ehi-request-<provider>.pdf` | The final merged PDF package |
| `ehi-request-preview.png` | Preview image of page 1 |
| `session.md` | Full agent session transcript |
| `copilot-output.log` | Raw copilot stdout/stderr |
| `prompt.txt` | The prompt that was sent |
| `skill.zip` | The packaged skill |
| `SKILL.md`, `scripts/`, `templates/` | Extracted skill contents |

## Reviewing Results

```bash
# Check if PDF was produced
ls -la /tmp/ehi-test-*/ehi-request-*.pdf

# View the preview image
open /tmp/ehi-test-*/ehi-request-preview.png   # macOS
xdg-open /tmp/ehi-test-*/ehi-request-preview.png  # Linux

# Read the session transcript
less /tmp/ehi-test-*/session.md
```
