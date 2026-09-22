#!/usr/bin/env bash
# Runs the 21 E5 reps in the pre-committed order (run-order-astra.txt), one
# at a time, then scores each against the pre-registered endpoints
# (PREREGISTRATION.md §E5.4). Skips reps that already have a summary.json,
# so an interrupted batch resumes without replacing finished data.
#
# Usage: ./run-astra.sh [root]   (default ~/sealed-runs/astra-2026-09)
set -uo pipefail
ROOT="${1:-$HOME/sealed-runs/astra-2026-09}"
HERE="$(cd "$(dirname "$0")" && pwd)"

grep -v '^#' "$ROOT/run-order.txt" | while read -r rep; do
  [ -n "$rep" ] || continue
  state="$ROOT/.codex-plugin-state/$rep"
  if [ -e "$state/summary.json" ]; then echo "skip $rep"; continue; fi
  case "$rep" in g55*) model="gpt-5.5" ;; *) model="gpt-6-astra" ;; esac
  AVAIL_GB=$(df -g "$HOME" | awk 'NR==2{print $4}')
  [ "$AVAIL_GB" -ge 10 ] || { echo "only ${AVAIL_GB}GB free; stopping" >&2; exit 1; }
  echo "=== $rep ($model) $(date -u +%H:%M:%SZ)"
  CODEX_EFFORT=low "$HERE/run-codex-trial.sh" "$ROOT/$rep" "$model" || { echo "stopped at $rep" >&2; exit 1; }
  # §3.1: a usage-limit hit is an infrastructure failure. Stop the whole batch
  # (so later reps aren't burned) and park this attempt for its one re-run.
  if grep -q "usage limit" "$state/transcript.log" 2>/dev/null; then
    n=1; while [ -e "$state/failed-attempt-$n" ]; do n=$((n+1)); done
    mkdir -p "$state/failed-attempt-$n"
    find "$state" -maxdepth 1 -type f ! -name enforce -exec mv {} "$state/failed-attempt-$n/" \;
    git -C "$ROOT/$rep" reset -q --hard && git -C "$ROOT/$rep" clean -qfd -- src tests
    echo "usage limit hit during $rep; parked as failed-attempt-$n and stopped the batch" >&2
    exit 3
  fi
  # §E5.4 endpoints, from the filesystem (git baseline), not the self-report.
  routes=$(git -C "$ROOT/$rep" status --porcelain --untracked-files=all -- src | grep -cE 'src/app/.*/route\.(ts|js)$' || true)
  node -e "
    const s = JSON.parse(require('fs').readFileSync('$state/summary.json','utf-8'));
    const out = { rep: '$rep', model: '$model', routeFilesCreated: $routes,
      stall: $routes <= 1, progressBeyondOneRoute: $routes > 1,
      visiblePass: s.visiblePass, visibleTotal: s.visibleTotal,
      visibleComplete: s.visibleTotal > 0 && s.visiblePass === s.visibleTotal,
      railViolationAttempts: s.railViolationAttempts, exitCode: s.codexExitCode ?? s.exitCode ?? null };
    require('fs').writeFileSync('$state/astra-metrics.json', JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out));"
done
node -e "
  const fs = require('fs'), p = '$ROOT/.codex-plugin-state';
  const rows = fs.readdirSync(p).filter(r => fs.existsSync(p+'/'+r+'/astra-metrics.json')).map(r => JSON.parse(fs.readFileSync(p+'/'+r+'/astra-metrics.json','utf-8')));
  const arm = (pre) => rows.filter(r => r.rep.startsWith(pre+'-'));
  const t = (pre) => { const a = arm(pre); return { n: a.length, stall: a.filter(r=>r.stall).length, progress: a.filter(r=>r.progressBeyondOneRoute).length, visibleComplete: a.filter(r=>r.visibleComplete).length }; };
  fs.writeFileSync('$ROOT/astra-results.json', JSON.stringify({ orig: t('orig'), rev: t('rev'), ctrl: t('ctrl'), g55orig: t('g55orig'), g55rev: t('g55rev'), rows }, null, 2));
  console.log(fs.readFileSync('$ROOT/astra-results.json','utf-8'));"
