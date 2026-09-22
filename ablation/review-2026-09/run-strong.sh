#!/usr/bin/env bash
# Runs the 10 strong-tier sealed reps (PREREGISTRATION.md §10) in the
# pre-committed order, one at a time, then aggregates. Resumable.
set -uo pipefail
ROOT="${1:-$HOME/sealed-runs/review-2026-09-strong}"
HERE="$(cd "$(dirname "$0")" && pwd)"
grep -v '^#' "$ROOT/run-order.txt" | while read -r rep; do
  [ -n "$rep" ] || continue
  [ -e "$ROOT/.claude-plugin-state/$rep/summary.json" ] && { echo "skip $rep"; continue; }
  echo "=== $rep  $(date -u +%H:%M:%SZ)"
  MODEL=claude-sonnet-5 "$HERE/run-sealed-trial-model.sh" "$ROOT" "$rep" || { echo "stopped at $rep" >&2; exit 1; }
done
node "$HERE/aggregate-review.mjs" "$ROOT" > "$ROOT/review-results.json" && echo "wrote $ROOT/review-results.json"
