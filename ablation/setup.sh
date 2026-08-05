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
#
# Every rep (both conditions) gets activity-log.ts inside .opencode/plugin/ —
# it always logs, whether or not it enforces. Enforcement is a marker file in
# a SIBLING .plugin-state/<rep-name>/ directory, not inside the rep itself —
# confirmed live that a harness artifact living inside a rep's own project
# root gets surfaced to the model the moment it lists its own directory (a
# real session read a lock file this way). Nothing this harness creates at
# setup or run time lives inside a rep except activity-log.ts, which OpenCode
# itself requires at that exact path to discover the plugin at all.

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

PLUGIN_SRC="$(dirname "$0")/activity-log.ts"

for condition in with without; do
  for i in $(seq 1 "$REPS"); do
    rep_name="${condition}-rep${i}"
    dest="$OUT_ROOT/$rep_name"
    plugin_state_dir="$OUT_ROOT/.plugin-state/$rep_name"
    echo "Preparing $dest ..."
    cp -r "$SOURCE_REBUILD_DIR" "$dest"
    # Never let a real npm install leak between reps.
    rm -rf "$dest/node_modules" "$dest/.next"

    mkdir -p "$dest/.opencode/plugin"
    cp "$PLUGIN_SRC" "$dest/.opencode/plugin/activity-log.ts"

    mkdir -p "$plugin_state_dir"
    if [ "$condition" = "with" ]; then
      touch "$plugin_state_dir/enforce"
    fi
    # "without" reps get the same logging plugin, just no enforce marker —
    # the one isolated variable this ablation tests.
  done
done

echo ""
echo "Prepared $((REPS * 2)) rep directories under: $OUT_ROOT"
echo "Run ./run-all.sh \"$OUT_ROOT\" to execute all reps and collect results."
