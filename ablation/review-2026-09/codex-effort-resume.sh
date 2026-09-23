#!/usr/bin/env bash
# Waits for the Codex reset, confirms quota with a one-line probe (retrying
# every 10 min), then resumes the §11 effort follow-up.
L="$HOME/sealed-runs/full-chain.log"
log() { echo "$(date -u +%H:%M:%SZ) [codex] $*" >> "$L"; }
T=$(date -j -u -f '%Y-%m-%dT%H:%M:%S' '2026-09-23T18:00:00' +%s)
log "effort resume waiting for 18:00Z"
while [ "$(date -u +%s)" -lt "$T" ]; do sleep 60; done
until (cd /tmp/codex-probe && codex exec --skip-git-repo-check -c model_reasoning_effort=low --model gpt-6-astra "Reply with exactly: ok" < /dev/null 2>&1 | grep -qx "ok"); do log "probe: Codex not yet available"; sleep 600; done
log "probe ok; resuming effort follow-up"
exec "/Users/parkerfawcett/Rebuild Dossier/ablation/review-2026-09/codex-effort-chain.sh"
