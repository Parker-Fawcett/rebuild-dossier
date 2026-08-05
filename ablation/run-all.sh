#!/usr/bin/env bash
# Runs every rep setup.sh prepared (with-rep1..N, without-rep1..N) and
# collects their mechanical summary.json files into one aggregate report.
# Sequential, not parallel — a shared free-tier model rate limit or local
# resource contention across N concurrent OpenCode sessions is a real risk
# this hasn't been tested against; parallelize deliberately later if you
# need to, don't assume it's safe by default.
#
# Usage: ./run-all.sh <path/to/ablation-app-rebuild-dir> <model>
#   e.g. ./run-all.sh ".../ablation-web-rebuild" opencode/deepseek-v4-flash-free

set -euo pipefail

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

  # Merge this rep's summary into the aggregate report, tagged with its
  # condition/rep name — plain node, no extra dependency needed. Read from
  # .plugin-state/, not the rep dir itself — see setup.sh's own header for why
  # nothing this harness creates lives inside a rep.
  node -e "
    const fs = require('node:fs');
    const report = JSON.parse(fs.readFileSync('$REPORT', 'utf-8'));
    const summary = JSON.parse(fs.readFileSync('$ABLATION_ROOT/.plugin-state/$rep_name/summary.json', 'utf-8'));
    report.push({ rep: '$rep_name', condition: '$rep_name'.startsWith('with-') ? 'with' : 'without', ...summary });
    fs.writeFileSync('$REPORT', JSON.stringify(report, null, 2));
  "
done

echo ""
echo "All reps done. Aggregate report: $REPORT"
echo "Report the RANGE per condition, not just an average — see ablation/README.md."
