#!/usr/bin/env bash
# Runs the §11 conditional effort follow-up (PREREGISTRATION.md §11) in the
# pre-committed order (run-order-effort.txt): gpt-6-astra, blocking enabled,
# reasoning effort taken from the rep name (xhigh / ultra). Same per-rep flow
# and usage-limit stop as run-astra.sh; scored by rescore-astra.mjs.
set -uo pipefail
ROOT="${1:-$HOME/sealed-runs/astra-2026-09}"
HERE="$(cd "$(dirname "$0")" && pwd)"
grep -v '^#' "$HERE/run-order-effort.txt" | while read -r rep; do
  [ -n "$rep" ] || continue
  state="$ROOT/.codex-plugin-state/$rep"
  [ -e "$state/summary.json" ] && { echo "skip $rep"; continue; }
  case "$rep" in *-xhigh-*) effort=xhigh ;; *-ultra-*) effort=ultra ;; *) echo "no effort level in $rep" >&2; exit 1 ;; esac
  AVAIL_GB=$(df -g "$HOME" | awk 'NR==2{print $4}')
  [ "$AVAIL_GB" -ge 10 ] || { echo "only ${AVAIL_GB}GB free; stopping" >&2; exit 1; }
  echo "=== $rep (gpt-6-astra, $effort) $(date -u +%H:%M:%SZ)"
  CODEX_EFFORT=$effort "$HERE/run-codex-trial.sh" "$ROOT/$rep" gpt-6-astra || { echo "stopped at $rep" >&2; exit 1; }
  if grep -q "usage limit" "$state/transcript.log" 2>/dev/null; then
    n=1; while [ -e "$state/failed-attempt-$n" ]; do n=$((n+1)); done
    mkdir -p "$state/failed-attempt-$n"
    find "$state" -maxdepth 1 -type f ! -name enforce -exec mv {} "$state/failed-attempt-$n/" \;
    git -C "$ROOT/$rep" reset -q --hard && git -C "$ROOT/$rep" clean -qfd -- src tests
    echo "usage limit hit during $rep; parked as failed-attempt-$n and stopped the batch" >&2
    exit 3
  fi
  grep -m1 "reasoning effort:" "$state/transcript.log"
done
