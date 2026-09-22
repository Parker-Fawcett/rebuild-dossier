#!/usr/bin/env bash
# Runs all 20 sealed reps in the pre-committed order (run-order.txt), one at
# a time, never concurrently. Safe to re-invoke: reps that already have a
# summary.json are skipped, so an interrupted batch resumes where it stopped
# rather than re-running (and silently replacing) a finished rep.
#
# Usage: ./run-review.sh [root]   (default ~/sealed-runs/review-2026-09)
set -uo pipefail
ROOT="${1:-$HOME/sealed-runs/review-2026-09}"
HERE="$(cd "$(dirname "$0")" && pwd)"
grep -v '^#' "$ROOT/run-order.txt" | while read -r rep; do
  [ -n "$rep" ] || continue
  if [ -e "$ROOT/.claude-plugin-state/$rep/summary.json" ]; then
    echo "skip $rep (already run)"; continue
  fi
  echo "=== $rep  $(date -u +%H:%M:%SZ)"
  "$HERE/run-sealed-trial.sh" "$ROOT" "$rep" || { echo "stopped at $rep; fix the cause, then re-invoke" >&2; exit 1; }
done
node "$HERE/aggregate-review.mjs" "$ROOT" > "$ROOT/review-results.json" && echo "wrote $ROOT/review-results.json"
