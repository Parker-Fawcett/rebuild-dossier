#!/usr/bin/env bash
# Runs the §11 effort follow-up, then rescores E5.
H="/Users/parkerfawcett/Rebuild Dossier/ablation/review-2026-09"; L="$HOME/sealed-runs/full-chain.log"
log() { echo "$(date -u +%H:%M:%SZ) [codex] $*" >> "$L"; }
cd "$H"; log "effort follow-up"
./run-effort.sh < /dev/null >> "$L" 2>&1; log "run-effort exit=$?"
node rescore-astra.mjs > "$HOME/sealed-runs/astra-2026-09/astra-results-rescored.json" && log "E5 rescored"
log "CODEX DONE"
