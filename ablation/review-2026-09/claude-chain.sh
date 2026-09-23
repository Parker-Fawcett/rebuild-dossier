#!/usr/bin/env bash
# Runs the remaining Haiku reps, then the Sonnet arm, one rep at a time.
H="/Users/parkerfawcett/Rebuild Dossier/ablation/review-2026-09"; L="$HOME/sealed-runs/full-chain.log"
log() { echo "$(date -u +%H:%M:%SZ) [claude] $*" >> "$L"; }
cd "$H"; log "Haiku"
./run-review.sh < /dev/null >> "$HOME/sealed-runs/review-2026-09/run-review.log" 2>&1; log "run-review exit=$?"
log "Sonnet"; ./run-strong.sh < /dev/null > "$HOME/sealed-runs/review-2026-09-strong/run-strong.log" 2>&1; log "run-strong exit=$?"
log "CLAUDE DONE"
