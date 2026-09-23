#!/usr/bin/env bash
# Runs every remaining pre-registered rep, strictly one at a time:
#   1. E5: remaining gpt-5.5 reps (run-astra.sh), then the §11 effort reps (run-effort.sh)
#   2. once the claude CLI is authenticated: remaining Haiku reps (run-review.sh),
#      then the Sonnet arm (run-strong.sh)
# Each stage's runner is resumable and skips finished reps. A Codex usage-limit
# stop skips the rest of stage 1 but does not block stage 2.
H="/Users/parkerfawcett/Rebuild Dossier/ablation/review-2026-09"
L="$HOME/sealed-runs/full-chain.log"
log() { echo "$(date -u +%H:%M:%SZ) $*" >> "$L"; }
cd "$H"
log "stage 1: gpt-5.5"
./run-astra.sh < /dev/null >> "$HOME/sealed-runs/astra-2026-09/run-astra.log" 2>&1; log "run-astra exit=$?"
if tail -5 "$HOME/sealed-runs/astra-2026-09/run-astra.log" | grep -q "usage limit hit"; then
  log "Codex usage limit; skipping effort follow-up"
else
  log "stage 1b: effort follow-up"
  ./run-effort.sh < /dev/null >> "$L" 2>&1; log "run-effort exit=$?"
fi
node rescore-astra.mjs > "$HOME/sealed-runs/astra-2026-09/astra-results-rescored.json" && log "E5 rescored"
log "stage 2: waiting for claude CLI auth"
until (cd /tmp && claude -p "Reply with exactly: ok" --model claude-haiku-4-5-20251001 --output-format text < /dev/null 2>&1 | grep -qx "ok"); do sleep 300; done
log "claude auth ok; Haiku"
./run-review.sh < /dev/null >> "$HOME/sealed-runs/review-2026-09/run-review.log" 2>&1; log "run-review exit=$?"
log "Sonnet"
./run-strong.sh < /dev/null > "$HOME/sealed-runs/review-2026-09-strong/run-strong.log" 2>&1; log "run-strong exit=$?"
log "CHAIN DONE"
