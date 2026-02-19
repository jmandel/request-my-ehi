#!/usr/bin/env bash
set -euo pipefail

# ─── E2E Test Matrix Runner ───
# Runs run-test.sh for a matrix of provider organizations with configurable
# parallelism. Test cases are defined in test-cases.json.
# Results are collected in a timestamped directory.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_TEST="$SCRIPT_DIR/run-test.sh"
TEST_CASES_FILE="$SCRIPT_DIR/test-cases.json"

# ─── Defaults ───
JOBS=1
MODEL=""
FILTER=""
FILTER_SIZE=""
FILTER_EHR=""
FILTER_FORM=""
REPEAT=1
LIST_ONLY=false
RESULTS_DIR=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  -j, --jobs <n>         Max parallel runs (default: 1)
  --model <model>        Override model for all runs (default: per run-test.sh)
  --filter <pattern>     Filter by test ID or provider name (case-insensitive regex)
  --size <pattern>       Filter by org size (case-insensitive regex)
                         Values: Large, Community, Mid-group, FQHC, Small,
                                 Critical Access
  --ehr <pattern>        Filter by EHR vendor (case-insensitive regex)
                         Values: Epic, Cerner, MEDITECH, MEDITECH Expanse,
                                 athenahealth, eClinicalWorks, NextGen, Mixed
  --form <pattern>       Filter by form type (case-insensitive regex)
                         Values: Fillable, Flat, Multiple
  --repeat <n>           Run each test case n times (default: 1)
                         Useful for checking consistency across runs
  --list                 List all test cases and exit
  --results-dir <dir>    Directory for results (default: /tmp/ehi-matrix-<timestamp>)
  -h, --help             Show this help

Filters are AND-ed together. Each filter value is a case-insensitive regex,
so "Epic|Cerner" matches either vendor.

Examples:
  $(basename "$0")                          # Run all tests sequentially
  $(basename "$0") -j 4                     # Run 4 tests in parallel
  $(basename "$0") --filter "mayo|geisinger" # Match by ID or provider name
  $(basename "$0") --size Large             # All large health systems
  $(basename "$0") --ehr Cerner             # All Cerner-based providers
  $(basename "$0") --size Large --ehr Epic  # Large + Epic (intersection)
  $(basename "$0") --form "Flat"            # Only flat/scanned PDF tests
  $(basename "$0") --list                   # Show available test cases
  $(basename "$0") --list --size Community  # Show only community hospitals
  $(basename "$0") --size Mid-group --repeat 3 -j 9  # All mid-group × 3 runs
EOF
  exit 0
}

# ─── Parse arguments ───
while [[ $# -gt 0 ]]; do
  case "$1" in
    -j|--jobs)        JOBS="$2"; shift 2 ;;
    --model)          MODEL="$2"; shift 2 ;;
    --filter)         FILTER="$2"; shift 2 ;;
    --size)           FILTER_SIZE="$2"; shift 2 ;;
    --ehr)            FILTER_EHR="$2"; shift 2 ;;
    --form)           FILTER_FORM="$2"; shift 2 ;;
    --repeat)         REPEAT="$2"; shift 2 ;;
    --list)           LIST_ONLY=true; shift ;;
    --results-dir)    RESULTS_DIR="$2"; shift 2 ;;
    -h|--help)        usage ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done

# ─── Check dependencies ───
if ! command -v jq &>/dev/null; then
  echo "Error: jq is required. Install with: apt install jq / brew install jq" >&2
  exit 1
fi

# ─── Build jq filter from CLI flags ───
JQ_FILTER="."
if [[ -n "$FILTER" ]]; then
  JQ_FILTER+=" | select((.id + \" \" + .provider) | test(\"$FILTER\"; \"i\"))"
fi
if [[ -n "$FILTER_SIZE" ]]; then
  JQ_FILTER+=" | select(.size | test(\"$FILTER_SIZE\"; \"i\"))"
fi
if [[ -n "$FILTER_EHR" ]]; then
  JQ_FILTER+=" | select(.ehr | test(\"$FILTER_EHR\"; \"i\"))"
fi
if [[ -n "$FILTER_FORM" ]]; then
  JQ_FILTER+=" | select((.form // \"\") | test(\"$FILTER_FORM\"; \"i\"))"
fi

# ─── Load and filter test cases ───
FILTERED_JSON=$(jq -c "[ .[] | $JQ_FILTER ]" "$TEST_CASES_FILE")
FILTERED_COUNT=$(echo "$FILTERED_JSON" | jq 'length')
TOTAL_COUNT=$(jq 'length' "$TEST_CASES_FILE")

if [[ "$FILTERED_COUNT" -eq 0 ]]; then
  echo "No test cases match the given filters." >&2
  [[ -n "$FILTER" ]]      && echo "  --filter: $FILTER" >&2
  [[ -n "$FILTER_SIZE" ]] && echo "  --size:   $FILTER_SIZE" >&2
  [[ -n "$FILTER_EHR" ]]  && echo "  --ehr:    $FILTER_EHR" >&2
  [[ -n "$FILTER_FORM" ]] && echo "  --form:   $FILTER_FORM" >&2
  exit 1
fi

# ─── List mode ───
if $LIST_ONLY; then
  printf "%-25s %-45s %-17s %-16s %-10s %s\n" "ID" "PROVIDER" "SIZE" "EHR" "FORM" "NOTES"
  printf "%-25s %-45s %-17s %-16s %-10s %s\n" "---" "---" "---" "---" "---" "---"
  echo "$FILTERED_JSON" | jq -r '.[] | [.id, .provider, .size, .ehr, (.form // "-"), (.notes // "")] | @tsv' | \
    while IFS=$'\t' read -r id provider size ehr form notes; do
      printf "%-25s %-45s %-17s %-16s %-10s %s\n" "$id" "$provider" "$size" "$ehr" "$form" "$notes"
    done
  echo ""
  echo "$FILTERED_COUNT test cases (of $TOTAL_COUNT total)"
  [[ $REPEAT -gt 1 ]] && echo "× $REPEAT repeats = $(( FILTERED_COUNT * REPEAT )) total runs"
  exit 0
fi

# ─── Expand repeats ───
EXPANDED=()
for (( i=0; i<FILTERED_COUNT; i++ )); do
  row=$(echo "$FILTERED_JSON" | jq -r ".[$i] | [.id, .provider, (.location // \"\"), .size, .ehr, (.form // \"\")] | join(\"|\")")
  for (( r=1; r<=REPEAT; r++ )); do
    if [[ $REPEAT -eq 1 ]]; then
      EXPANDED+=("$row|")
    else
      EXPANDED+=("$row|$r")
    fi
  done
done
TOTAL_RUNS=${#EXPANDED[@]}

# ─── Set up results directory ───
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
if [[ -z "$RESULTS_DIR" ]]; then
  RESULTS_DIR="/tmp/ehi-matrix-${TIMESTAMP}"
fi
mkdir -p "$RESULTS_DIR"

# Save filtered test cases to results for later analysis
echo "$FILTERED_JSON" | jq '.' > "$RESULTS_DIR/test-cases.json"

echo "═══════════════════════════════════════════════════════════════"
echo "  E2E Test Matrix"
echo "═══════════════════════════════════════════════════════════════"
echo "  Tests:      $FILTERED_COUNT test cases"
echo "$FILTERED_JSON" | jq -r '.[] | "              • \(.id) — \(.provider)"'
[[ $REPEAT -gt 1 ]] && echo "  Repeat:     ×$REPEAT ($TOTAL_RUNS total runs)"
echo "  Parallel:   $JOBS"
[[ -n "$MODEL" ]] && echo "  Model:      $MODEL"
echo "  Results:    $RESULTS_DIR"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ─── Run tests ───
run_one() {
  local id="$1" provider="$2" location="$3" size="$4" ehr="$5" form="$6" run_num="$7"
  local run_id="$id"
  [[ -n "$run_num" ]] && run_id="${id}-run${run_num}"
  local test_dir="$RESULTS_DIR/$run_id"
  local log_file="$RESULTS_DIR/${run_id}.log"
  local start_time end_time duration exit_code
  local ts

  ts="$(date +%H:%M:%S)"
  start_time=$(date +%s)
  echo "[$ts] ▶ START  $run_id — $provider ($location; $size / $ehr)"

  # Build command
  local cmd=("$RUN_TEST" --provider "$provider" --output-dir "$test_dir")
  if [[ -n "$location" ]]; then
    cmd+=(--location "$location")
  fi
  if [[ -n "$MODEL" ]]; then
    cmd+=(--model "$MODEL")
  fi

  # Run and capture exit code
  exit_code=0
  "${cmd[@]}" > "$log_file" 2>&1 || exit_code=$?

  end_time=$(date +%s)
  duration=$(( end_time - start_time ))
  local mins=$(( duration / 60 ))
  local secs=$(( duration % 60 ))
  ts="$(date +%H:%M:%S)"

  # Locate any produced PDFs
  local provider_slug pdf_file pdf_path=""
  provider_slug="$(echo "$provider" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')"
  pdf_file="ehi-request-${provider_slug}.pdf"
  if [[ -f "$test_dir/$pdf_file" ]]; then
    pdf_path="$test_dir/$pdf_file"
  else
    # Check for any PDF produced with a different name
    pdf_path="$(find "$test_dir" -maxdepth 1 -name '*.pdf' -not -name 'skill.zip' 2>/dev/null | head -1 || true)"
  fi

  if [[ $exit_code -eq 0 ]]; then
    echo "[$ts] ✅ PASS   $run_id — ${mins}m${secs}s"
  else
    echo "[$ts] ❌ FAIL   $run_id — exit $exit_code — ${mins}m${secs}s"
    echo "         log: $log_file"
  fi

  if [[ -n "$pdf_path" && -f "$pdf_path" ]]; then
    local file_size
    file_size="$(du -h "$pdf_path" | cut -f1)"
    echo "         pdf: $pdf_path ($file_size)"
  elif [[ $exit_code -eq 0 ]]; then
    echo "         pdf: (none found)"
  fi

  # Write result metadata
  cat > "$RESULTS_DIR/${run_id}.result" <<RESULT
id=$id
run_id=$run_id
run_num=$run_num
provider=$provider
location=$location
size=$size
ehr=$ehr
form=$form
exit_code=$exit_code
duration=${duration}s
pdf=$pdf_path
log=$log_file
output_dir=$test_dir
RESULT

  return $exit_code
}
export -f run_one
export RUN_TEST MODEL RESULTS_DIR

# Track overall results
OVERALL_EXIT=0

if [[ $JOBS -eq 1 ]]; then
  # Sequential execution — stream output directly
  for entry in "${EXPANDED[@]}"; do
    IFS='|' read -r id provider location size ehr form run_num <<< "$entry"
    run_one "$id" "$provider" "$location" "$size" "$ehr" "$form" "$run_num" || OVERALL_EXIT=1
  done
else
  # Parallel execution via xargs
  printf '%s\n' "${EXPANDED[@]}" | \
    xargs -P "$JOBS" -I{} bash -c '
      IFS="|" read -r id provider location size ehr form run_num <<< "{}"
      run_one "$id" "$provider" "$location" "$size" "$ehr" "$form" "$run_num"
    ' || OVERALL_EXIT=1
fi

# ─── Summary ───
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Summary"
echo "═══════════════════════════════════════════════════════════════"

pass=0 fail=0 total=0
for result_file in "$RESULTS_DIR"/*.result; do
  [[ -f "$result_file" ]] || continue
  total=$((total + 1))
  if grep -q "exit_code=0" "$result_file"; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    # Show failed test info
    run_id=$(grep "^run_id=" "$result_file" | cut -d= -f2)
    provider=$(grep "^provider=" "$result_file" | cut -d= -f2)
    echo "  ❌ $run_id ($provider)"
  fi
done

echo ""
echo "  ✅ Passed: $pass"
[[ $fail -gt 0 ]] && echo "  ❌ Failed: $fail"
echo "  Total:   $total"
echo ""
echo "  Results: $RESULTS_DIR"
echo "═══════════════════════════════════════════════════════════════"

exit $OVERALL_EXIT
