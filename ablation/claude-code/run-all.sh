#!/usr/bin/env bash
# Runs every rep setup.sh prepared (with-rep1..N, without-rep1..N) and
# collects their mechanical summary.json files into one aggregate report.
# Sequential, not parallel — same reasoning as the OpenCode harness: running
# N concurrent claude sessions against a shared rate limit or local resource
# contention hasn't been tested, don't assume it's safe by default.
#
# Usage: ./run-all.sh <path/to/ablation-cc-app-rebuild-dir> <model>

set -uo pipefail

ABLATION_ROOT="$1"
MODEL="${2:?Usage: ./run-all.sh <ablation-root-dir> <model>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -d "$ABLATION_ROOT" ]; then
  echo "Error: $ABLATION_ROOT does not exist. Run setup.sh first." >&2
  exit 1
fi

REPORT="$ABLATION_ROOT/aggregate-report.json"
echo "[]" > "$REPORT"

for rep_dir in "$ABLATION_ROOT"/with-rep* "$ABLATION_ROOT"/without-rep*; do
  [ -d "$rep_dir" ] || continue
  rep_name="$(basename "$rep_dir")"
  echo ""
  echo "=== $rep_name ==="
  "$SCRIPT_DIR/run-trial.sh" "$rep_dir" "$MODEL"

  node -e "
    const fs = require('node:fs');
    const report = JSON.parse(fs.readFileSync('$REPORT', 'utf-8'));
    const summary = JSON.parse(fs.readFileSync('$ABLATION_ROOT/.claude-plugin-state/$rep_name/summary.json', 'utf-8'));
    report.push({ rep: '$rep_name', condition: '$rep_name'.startsWith('with-') ? 'with' : 'without', ...summary });
    fs.writeFileSync('$REPORT', JSON.stringify(report, null, 2));
  "
done

echo ""
echo "All reps done. Aggregate report: $REPORT"
echo "Report the RANGE per condition, not just an average — see README.md."
