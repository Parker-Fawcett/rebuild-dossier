#!/usr/bin/env bash
# Waits for the running gpt-5.5 batch (run-astra.sh), then runs the §11 effort
# follow-up unless Codex hit its usage limit, then rescores E5.
H="/Users/parkerfawcett/Rebuild Dossier/ablation/review-2026-09"; L="$HOME/sealed-runs/full-chain.log"
log() { echo "$(date -u +%H:%M:%SZ) [codex] $*" >> "$L"; }
while kill -0 6221 2>/dev/null; do sleep 30; done
cd "$H"; log "gpt-5.5 batch finished"
if tail -5 "$HOME/sealed-runs/astra-2026-09/run-astra.log" | grep -q "usage limit hit"; then log "usage limit; skipping effort follow-up"
else log "effort follow-up"; ./run-effort.sh < /dev/null >> "$L" 2>&1; log "run-effort exit=$?"; fi
node rescore-astra.mjs > "$HOME/sealed-runs/astra-2026-09/astra-results-rescored.json" && log "E5 rescored"
log "CODEX DONE"
