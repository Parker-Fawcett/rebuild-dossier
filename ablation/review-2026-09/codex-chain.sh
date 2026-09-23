#!/usr/bin/env bash
H="/Users/parkerfawcett/Rebuild Dossier/ablation/review-2026-09"
L="$HOME/sealed-runs/astra-2026-09/codex-chain.log"
T=$(date -j -u -f '%Y-%m-%dT%H:%M:%S' '2026-09-23T10:25:00' +%s)
echo "chain waiting for 10:25Z (started $(date -u +%H:%M:%SZ))" >> "$L"
while [ "$(date -u +%s)" -lt "$T" ]; do sleep 60; done
cd "$H"
echo "=== gpt-5.5 resume $(date -u +%H:%M:%SZ)" | tee -a "$L" >> "$HOME/sealed-runs/astra-2026-09/run-astra.log"
./run-astra.sh < /dev/null >> "$HOME/sealed-runs/astra-2026-09/run-astra.log" 2>&1
A=$?; echo "run-astra exit=$A at $(date -u +%H:%M:%SZ)" >> "$L"
if grep -q "usage limit hit" <(tail -5 "$HOME/sealed-runs/astra-2026-09/run-astra.log"); then echo "usage limit again; not starting effort follow-up" >> "$L"; exit 0; fi
echo "=== effort follow-up $(date -u +%H:%M:%SZ)" >> "$L"
./run-effort.sh < /dev/null >> "$L" 2>&1
echo "run-effort exit=$? at $(date -u +%H:%M:%SZ)" >> "$L"
node rescore-astra.mjs > "$HOME/sealed-runs/astra-2026-09/astra-results-rescored.json" && echo "rescored $(date -u +%H:%M:%SZ)" >> "$L"
echo "CHAIN DONE" >> "$L"
