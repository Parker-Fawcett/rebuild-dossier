#!/usr/bin/env bash
# Prepares N independent rep directories for the Claude-Code-specific version
# of the contract-locking ablation (../README.md, ../activity-log.ts — this
# is the same experiment, ported from OpenCode's plugin API onto Claude
# Code's native PreToolUse/PostToolUse hooks and a real `claude -p`
# subprocess, confirmed to consult a target directory's own settings.json
# independently of the Agent tool — see docs/v0-findings.md, "Closing part
# of the Claude-Code-specific hook-liveness gap").
#
# Usage: ./setup.sh <path/to/app-rebuild> <reps-per-condition>
#   e.g. ./setup.sh "/Users/you/Downloads/catchandtrade/apps/web-rebuild" 3
#
# Requires: <path/to/app-rebuild> must already exist — i.e. you've already
# run ingest_repo + generate_spec against the target app once, normally.
#
# Every rep (both conditions) gets the IDENTICAL settings-template.json and
# hooks/ scripts — the with/without difference lives ENTIRELY in a sibling
# .claude-plugin-state/<rep-name>/enforce marker file, never inside the rep
# itself. Confirm this with `diff -rq` between a with-rep and a without-rep
# after running this script — it should report zero difference, the same
# invariant the OpenCode harness enforces.

set -euo pipefail

SOURCE_REBUILD_DIR="$1"
REPS="${2:-3}"
OUT_ROOT="$(dirname "$SOURCE_REBUILD_DIR")/ablation-cc-$(basename "$SOURCE_REBUILD_DIR")"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -d "$SOURCE_REBUILD_DIR" ]; then
  echo "Error: $SOURCE_REBUILD_DIR does not exist. Run generate_spec against the target app first." >&2
  exit 1
fi

rm -rf "$OUT_ROOT"
mkdir -p "$OUT_ROOT"

for condition in with without; do
  for i in $(seq 1 "$REPS"); do
    rep_name="${condition}-rep${i}"
    dest="$OUT_ROOT/$rep_name"
    plugin_state_dir="$OUT_ROOT/.claude-plugin-state/$rep_name"
    echo "Preparing $dest ..."
    cp -r "$SOURCE_REBUILD_DIR" "$dest"
    # Never let a real npm install or prior next dev/build leak between reps.
    rm -rf "$dest/node_modules" "$dest/.next"

    # Replace the rep's own generated settings.json wholesale — the two
    # production hooks it already contains (spec/ lock, untested-contracts
    # block) are exactly what this ablation studies, so this harness's own
    # merged log-then-decide script (see hooks/tool-log.mjs) reimplements the
    # identical detection logic rather than running both the original and the
    # ablation's hooks side by side, which would reintroduce the exact
    # two-hooks-for-one-tool-call uncertainty this design deliberately avoids.
    mkdir -p "$dest/.claude/hooks"
    cp "$SCRIPT_DIR/hooks/tool-log.mjs" "$dest/.claude/hooks/tool-log.mjs"
    cp "$SCRIPT_DIR/hooks/tool-log-readonly.mjs" "$dest/.claude/hooks/tool-log-readonly.mjs"
    cp "$SCRIPT_DIR/hooks/tool-heartbeat.mjs" "$dest/.claude/hooks/tool-heartbeat.mjs"
    cp "$SCRIPT_DIR/hooks/tool-log-bash-output.mjs" "$dest/.claude/hooks/tool-log-bash-output.mjs"
    cp "$SCRIPT_DIR/settings-template.json" "$dest/.claude/settings.json"

    mkdir -p "$plugin_state_dir"
    if [ "$condition" = "with" ]; then
      touch "$plugin_state_dir/enforce"
    fi
    # "without" reps get the identical hooks, just no enforce marker — the
    # one isolated variable this ablation tests.
  done
done

echo ""
echo "Prepared $((REPS * 2)) rep directories under: $OUT_ROOT"
echo ""
echo "Sanity check before trusting any of this — confirm reps are byte-identical"
echo "except for the external enforce marker:"
echo "  diff -rq \"$OUT_ROOT/with-rep1\" \"$OUT_ROOT/without-rep1\""
echo "(expect: no output at all)"
echo ""
echo "Then run ./run-all.sh \"$OUT_ROOT\" <model> to execute all reps."
