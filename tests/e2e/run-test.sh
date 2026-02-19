#!/usr/bin/env bash
set -euo pipefail
set -m  # Enable job control so background jobs get their own process group

# ─── E2E Test Harness for request-my-ehi ───
# Packages the skill into a zip, creates a clean workspace, and invokes
# copilot CLI in non-interactive mode to run the full EHI request pipeline.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ─── Defaults ───
MODEL="claude-opus-4.6-fast"
PROVIDER=""
LOCATION=""
PATIENT_NAME="John Doe"
PATIENT_DOB="01/01/1990"
PATIENT_ADDRESS="123 Main St, Anytown, MA 02101"
PATIENT_PHONE="(555) 123-4567"
PATIENT_EMAIL="test@example.com"
OUTPUT_DIR=""

usage() {
  cat <<EOF
Usage: $(basename "$0") --provider <provider> [options]

Required:
  --provider <name>      Healthcare provider name (e.g. "Tufts Medical Center")

Optional:
  --location <loc>       Provider location (e.g. "Boston, MA") — added to prompt
  --model <model>        AI model to use (default: claude-opus-4.6-fast)
  --name <name>          Patient name (default: "$PATIENT_NAME")
  --dob <date>           Date of birth (default: "$PATIENT_DOB")
  --address <addr>       Full address (default: "$PATIENT_ADDRESS")
  --phone <phone>        Phone number (default: "$PATIENT_PHONE")
  --email <email>        Email address (default: "$PATIENT_EMAIL")
  --output-dir <dir>     Working directory (default: auto-generated in /tmp)
  -h, --help             Show this help
EOF
  exit 0
}

# ─── Parse arguments ───
while [[ $# -gt 0 ]]; do
  case "$1" in
    --model)     MODEL="$2"; shift 2 ;;
    --provider)  PROVIDER="$2"; shift 2 ;;
    --location)  LOCATION="$2"; shift 2 ;;
    --name)      PATIENT_NAME="$2"; shift 2 ;;
    --dob)       PATIENT_DOB="$2"; shift 2 ;;
    --address)   PATIENT_ADDRESS="$2"; shift 2 ;;
    --phone)     PATIENT_PHONE="$2"; shift 2 ;;
    --email)     PATIENT_EMAIL="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    -h|--help)   usage ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done

if [[ -z "$PROVIDER" ]]; then
  echo "Error: --provider is required" >&2; exit 1
fi

# ─── Create provider slug for filenames ───
PROVIDER_SLUG="$(echo "$PROVIDER" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR="$(mktemp -d "/tmp/ehi-test-${PROVIDER_SLUG}-${TIMESTAMP}-XXXXXX")"
else
  mkdir -p "$OUTPUT_DIR"
fi

echo "═══════════════════════════════════════════════════════"
echo "  E2E Test: request-my-ehi"
echo "═══════════════════════════════════════════════════════"
echo "  Model:    $MODEL"
echo "  Provider: $PROVIDER"
[[ -n "$LOCATION" ]] && echo "  Location: $LOCATION"
echo "  Patient:  $PATIENT_NAME"
echo "  Workdir:  $OUTPUT_DIR"
echo "═══════════════════════════════════════════════════════"

# ─── Step 1: Package the skill into a zip ───
echo ""
echo "▸ Packaging skill into zip..."
SKILL_ZIP="$OUTPUT_DIR/skill.zip"
(cd "$REPO_ROOT" && zip -qr "$SKILL_ZIP" \
  SKILL.md \
  scripts/ \
  templates/ \
  -x "scripts/node_modules/*" "scripts/bun.lock" "scripts/.env*")
echo "  Created: $SKILL_ZIP ($(du -h "$SKILL_ZIP" | cut -f1))"

# ─── Step 2: Copy test signature ───
cp "$SCRIPT_DIR/test-signature.png" "$OUTPUT_DIR/test-signature.png"
echo "  Copied:  test-signature.png"

# ─── Step 3: Build the prompt ───
PROMPT="$(cat <<PROMPT_EOF
Unzip the skill package at ./skill.zip into this working directory. After
unzipping, run \`cd scripts && bun install && cd ..\` to install dependencies.
Then read the extracted SKILL.md in full — it contains complete instructions
and scripts for requesting medical records.

Then help me request my complete EHI Export from: ${PROVIDER}$(
[[ -n "$LOCATION" ]] && echo " (located in ${LOCATION})"
)

My details:
- Name: ${PATIENT_NAME}
- Date of Birth: ${PATIENT_DOB}
- Address: ${PATIENT_ADDRESS}
- Phone: ${PATIENT_PHONE}
- Email: ${PATIENT_EMAIL}

Use the signature image at ./test-signature.png for any signature fields.
Use today's date for the signature date.

Work fully non-interactively. Do not ask me any questions — make reasonable
choices when multiple options exist. Preferences:
- Prefer the provider's own ROI form over the generic template
- Prefer electronic format when the form offers a choice
- Purpose of disclosure is "myself" / personal use
- For the "release to" or "send records to" section, use my own name and address
- If the form has a field for who is requesting, it is the patient (me)

Produce the final merged PDF package in this directory.
Name it: ehi-request-${PROVIDER_SLUG}.pdf

After producing the PDF, render the first page to a PNG for visual verification:
  pdftoppm -png -r 200 -f 1 -l 1 -singlefile ehi-request-${PROVIDER_SLUG}.pdf ehi-request-preview
PROMPT_EOF
)"

# Save the prompt for reference
echo "$PROMPT" > "$OUTPUT_DIR/prompt.txt"
echo "  Saved:   prompt.txt"

# ─── Step 4: Run copilot ───
echo ""
echo "▸ Launching copilot (model: $MODEL)..."
echo "  This may take several minutes."
echo ""

# Ensure Ctrl+C kills the copilot process tree instead of leaving it running
COPILOT_PID=""
cleanup() {
  if [[ -n "$COPILOT_PID" ]]; then
    echo ""
    echo "Interrupted — stopping copilot session..."
    # Kill the entire process group rooted at copilot
    kill -TERM -"$COPILOT_PID" 2>/dev/null || kill -TERM "$COPILOT_PID" 2>/dev/null || true
    wait "$COPILOT_PID" 2>/dev/null || true
  fi
  exit 130
}
trap cleanup INT TERM

COPILOT_EXIT=0
cd "$OUTPUT_DIR"
EHI_KEEP_INTERMEDIATES=1 copilot \
  -p "$PROMPT" \
  --model "$MODEL" \
  --allow-all \
  --no-ask-user \
  --share session.md \
  > >(tee copilot-output.log) 2>&1 &
COPILOT_PID=$!

wait "$COPILOT_PID" || COPILOT_EXIT=$?
trap - INT TERM

# ─── Step 5: Check results ───
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Results"
echo "═══════════════════════════════════════════════════════"

FINAL_PDF="$OUTPUT_DIR/ehi-request-${PROVIDER_SLUG}.pdf"
PREVIEW_PNG="$OUTPUT_DIR/ehi-request-preview.png"

if [[ -f "$FINAL_PDF" ]]; then
  PAGE_COUNT="unknown"
  if command -v pdfinfo &>/dev/null; then
    PAGE_COUNT="$(pdfinfo "$FINAL_PDF" 2>/dev/null | grep '^Pages:' | awk '{print $2}')"
  fi
  FILE_SIZE="$(du -h "$FINAL_PDF" | cut -f1)"
  echo "  ✅ PDF produced: $FINAL_PDF"
  echo "     Size: $FILE_SIZE, Pages: $PAGE_COUNT"
else
  echo "  ❌ No PDF produced at: $FINAL_PDF"
  # Check if any PDFs were produced with other names
  OTHER_PDFS="$(find "$OUTPUT_DIR" -maxdepth 1 -name '*.pdf' 2>/dev/null)"
  if [[ -n "$OTHER_PDFS" ]]; then
    echo "     Other PDFs found:"
    echo "$OTHER_PDFS" | while read -r f; do echo "       - $(basename "$f")"; done
  fi
fi

if [[ -f "$PREVIEW_PNG" ]]; then
  echo "  ✅ Preview: $PREVIEW_PNG"
else
  echo "  ⚠️  No preview image generated"
fi

if [[ -f "$OUTPUT_DIR/session.md" ]]; then
  echo "  📝 Session transcript: $OUTPUT_DIR/session.md"
fi

echo ""
echo "  Working directory: $OUTPUT_DIR"
echo "  Copilot exit code: $COPILOT_EXIT"
echo "═══════════════════════════════════════════════════════"

exit $COPILOT_EXIT
