#!/usr/bin/env bash
# Prepares N independent rep directories for the contract-locking ablation,
# all built from ONE generate_spec output — so the spec/tests/kickoff-prompt
# are byte-identical across every rep and condition, and the only thing that
# varies is whether contract-locking is mechanically enforced. Run this once
# per app being ablated.
#
# Usage: ./setup.sh <path/to/app-rebuild> <reps-per-condition>
#   e.g. ./setup.sh "/Users/you/Downloads/OSS clone/catchandtrade/apps/web-rebuild" 3
#
# Requires: the <path/to/app-rebuild> directory must already exist — i.e.
# you've already run ingest_repo + generate_spec against the target app once,
# normally, before running this script.

set -euo pipefail

SOURCE_REBUILD_DIR="$1"
REPS="${2:-3}"
OUT_ROOT="$(dirname "$SOURCE_REBUILD_DIR")/ablation-$(basename "$SOURCE_REBUILD_DIR")"

if [ ! -d "$SOURCE_REBUILD_DIR" ]; then
  echo "Error: $SOURCE_REBUILD_DIR does not exist. Run generate_spec against the target app first." >&2
  exit 1
fi

rm -rf "$OUT_ROOT"
mkdir -p "$OUT_ROOT"

PLUGIN_SRC="$(dirname "$0")/contract-locking.ts"

for condition in with without; do
  for i in $(seq 1 "$REPS"); do
    dest="$OUT_ROOT/${condition}-rep${i}"
    echo "Preparing $dest ..."
    cp -r "$SOURCE_REBUILD_DIR" "$dest"
    # Never let a real npm install or generated test run leak between reps.
    rm -rf "$dest/node_modules" "$dest/.next"

    if [ "$condition" = "with" ]; then
      mkdir -p "$dest/.opencode/plugin"
      cp "$PLUGIN_SRC" "$dest/.opencode/plugin/contract-locking.ts"
    fi
    # "without" reps get nothing under .opencode/plugin/ — no contract-locking
    # enforcement at all, the one isolated variable this ablation tests.
  done
done

echo ""
echo "Prepared $((REPS * 2)) rep directories under: $OUT_ROOT"
echo "For each one: cd into it, npm install, then start a FRESH OpenCode"
echo "session there and paste in trial-prompt.txt's contents."
