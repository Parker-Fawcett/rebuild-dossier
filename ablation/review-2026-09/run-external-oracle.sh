#!/usr/bin/env bash
# E6 runner: applies an independently written check suite (an evaluator who is
# not the author, per PREREGISTRATION.md) to every frozen rebuild snapshot, once.
#
# Usage: ./run-external-oracle.sh <checks-dir> [root ...]
#   checks-dir: a folder of vitest *.spec.ts files, written without seeing any
#               rebuild. It is hashed before anything runs, and that hash is
#               recorded as the freeze point.
#   roots:      sealed-run roots whose .claude-plugin-state/<rep>/snapshot.tar
#               to evaluate (default: the Haiku and Sonnet sealed roots)
#
# Each snapshot is extracted into <root>/.oracle/<rep>/, never into the rep
# itself. The checks are copied to tests/oracle/ there and run once with the
# JSON reporter. Scoring uses a fixed denominator: every check file counts, and
# one that fails to import counts as a failed obligation.
set -euo pipefail
CHECKS="$(cd "$1" && pwd)"; shift
ROOTS=("$@")
[ ${#ROOTS[@]} -gt 0 ] || ROOTS=("$HOME/sealed-runs/review-2026-09" "$HOME/sealed-runs/review-2026-09-strong")
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${ORACLE_OUT:-$HERE/results/E6-external-oracle}"
mkdir -p "$OUT"

FREEZE="$(cd "$CHECKS" && find . -type f -name '*.ts' | sort | xargs shasum -a 256 | shasum -a 256 | cut -c1-64)"
if [ -f "$OUT/checks-freeze.sha256" ] && [ "$(cat "$OUT/checks-freeze.sha256")" != "$FREEZE" ]; then
  echo "checks changed since the recorded freeze ($(cat "$OUT/checks-freeze.sha256")); refusing to re-score with a different oracle" >&2
  exit 1
fi
echo "$FREEZE" > "$OUT/checks-freeze.sha256"
( cd "$CHECKS" && find . -type f | sort | xargs shasum -a 256 ) > "$OUT/checks-manifest.sha256"
NCHECKS=$(find "$CHECKS" -name '*.spec.ts' | wc -l | tr -d ' ')

for root in "${ROOTS[@]}"; do
  tier=$(basename "$root")
  for state in "$root"/.claude-plugin-state/*/; do
    rep=$(basename "$state")
    [ -f "$state/snapshot.tar" ] || continue
    dest="$root/.oracle/$rep"
    rm -rf "$dest"; mkdir -p "$dest"
    tar -C "$dest" -xf "$state/snapshot.tar"
    cp -Rc "$root/.deps/node_modules" "$dest/node_modules"
    mkdir -p "$dest/tests/oracle"; cp -R "$CHECKS"/. "$dest/tests/oracle/"
    ( cd "$dest" && npx vitest run tests/oracle --passWithNoTests \
        --reporter=default --reporter=json --outputFile.json="$OUT/$tier-$rep.json" ) > "$OUT/$tier-$rep.log" 2>&1 || true
    passed=$(node -e "try{const j=JSON.parse(require('fs').readFileSync('$OUT/$tier-$rep.json','utf-8'));console.log(j.testResults.filter(t=>t.status==='passed').length)}catch(e){console.log(0)}")
    echo "$tier,$rep,${rep%%-*},$passed,$NCHECKS,$(cat "$state/snapshot.sha256" | cut -c1-12)"
  done
done | { echo "tier,rep,arm,checkFilesPassed,checkFilesTotal,snapshotSha"; cat; } | tee "$OUT/summary.csv"
echo "oracle freeze: $FREEZE"
