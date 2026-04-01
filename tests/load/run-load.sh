#!/bin/bash

set -euo pipefail

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
REPORT_DIR="tests/load/reports"
BASE_URL="${BASE_URL:-https://app.praxisengine.xyz}"
TARGET="${1:-all}"

mkdir -p "$REPORT_DIR"

echo "Target: $BASE_URL"

run_k6() {
  local label="$1"
  local script_path="$2"
  local report_path="$3"

  echo "Running $label ..."
  k6 run -e BASE_URL="$BASE_URL" --out "json=$report_path" "$script_path"
}

case "$TARGET" in
  r1)
    run_k6 "Round 1 load" "tests/load/round1-load.js" "$REPORT_DIR/r1-$TIMESTAMP.json"
    ;;
  r2)
    run_k6 "Round 2 load" "tests/load/round2-load.js" "$REPORT_DIR/r2-$TIMESTAMP.json"
    ;;
  progressive)
    run_k6 "Progressive load" "tests/load/progressive-load.js" "$REPORT_DIR/progressive-$TIMESTAMP.json"
    ;;
  all)
    run_k6 "Round 1 load" "tests/load/round1-load.js" "$REPORT_DIR/r1-$TIMESTAMP.json"
    sleep 5
    run_k6 "Round 2 load" "tests/load/round2-load.js" "$REPORT_DIR/r2-$TIMESTAMP.json"
    sleep 5
    run_k6 "Progressive load" "tests/load/progressive-load.js" "$REPORT_DIR/progressive-$TIMESTAMP.json"
    ;;
  *)
    echo "Usage: bash tests/load/run-load.sh [r1|r2|progressive|all]" >&2
    exit 1
    ;;
esac

echo "Reports saved to $REPORT_DIR"
